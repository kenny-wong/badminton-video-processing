// The Tools page's merge and split, the parts that need no files: which parts
// to cut, where a lossless cut can start, the new files' names and the times
// they carry. Shared by the page (to show what will be made) and the server
// (lib/video-tools.js); unit tested in tests/video-files.test.js.
//
// Times are ms since 1970. A video's own timestamps (its file's created and
// modified times, the MP4's creation_time, an iPhone's creation date) each mark
// either when recording started or when it ended: Samsung phones name the file
// at the start but stamp creation_time and the file at the end. A timestamp is
// taken to mark whichever of the two it is closer to, and keeps marking it in
// the new file.

/** On YouTube, and rendered since: the finished file is newer than what's up there. Times are ISO-8601 UTC, so they compare as text. */
export const reRendered = ({ outputPath, youtubeUrl, renderedAt, uploadedAt }) => Boolean(outputPath && youtubeUrl && renderedAt && uploadedAt && renderedAt > uploadedAt);

export const MAX_PARTS = 3;
export const MIN_PART = 1; // seconds

/** 'start' or 'end': which moment of recording a timestamp marks. */
export function markerOf(t, start, duration) {
  if (!Number.isFinite(t) || !Number.isFinite(start)) return 'start';
  const end = start + (duration ?? 0) * 1000;
  return Math.abs(t - end) < Math.abs(t - start) ? 'end' : 'start';
}

/**
 * A timestamp of the original moved to a part `offset` seconds in and
 * `length` seconds long: a start time moves on by the offset, an end time
 * back by what is left after the part.
 */
export function splitTime(t, { start, duration, offset, length }) {
  if (!Number.isFinite(t)) return null;
  if (markerOf(t, start, duration) === 'start') return t + offset * 1000;
  return t - (duration - offset - length) * 1000;
}

/**
 * A timestamp of a merged file: a start time is the first video's, an end
 * time the last video's (`last`, or the first's moved on by the videos after
 * it when the last has none).
 */
export function mergeTime(first, last, { start, duration, total }) {
  if (!Number.isFinite(first)) return Number.isFinite(last) ? last : null;
  if (markerOf(first, start, duration) === 'start') return first;
  return Number.isFinite(last) ? last : first + (total - duration) * 1000;
}

/** The key frame a lossless cut at `t` starts from: the last one at or before it. */
export function snapStart(keys, t) {
  let best = 0;
  for (const k of keys ?? []) {
    if (k <= t + 0.001) best = Math.max(best, k);
  }
  return best;
}

/**
 * The parts to cut, in the order given: up to three { start, end } in seconds
 * of the video, each at least a second long. Unset ones ({ start: null }) are
 * left out. `problems` says what's wrong with the rest.
 */
export function cleanParts(parts, duration) {
  const out = [];
  const problems = [];
  (Array.isArray(parts) ? parts : []).slice(0, MAX_PARTS).forEach((p, i) => {
    const start = Number(p?.start);
    const end = Number(p?.end);
    if (p?.start == null && p?.end == null) return;
    const n = i + 1;
    if (p?.start == null || p?.end == null || !Number.isFinite(start) || !Number.isFinite(end)) problems.push(`Part ${n} needs a start and an end`);
    else if (start < 0 || end > (duration ?? Infinity) + 0.5) problems.push(`Part ${n} goes past the end of the video`);
    else if (end - start < MIN_PART) problems.push(`Part ${n} must end at least ${MIN_PART} s after it starts`);
    else out.push({ n, start, end: Math.min(end, duration ?? end) });
  });
  if (!out.length && !problems.length) problems.push('Set a start and an end for at least one part');
  return { parts: out, problems };
}

/** Parts that overlap another, as "1 and 2". */
export function overlaps(parts) {
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (parts[i].start < parts[j].end && parts[j].start < parts[i].end) out.push(`${parts[i].n} and ${parts[j].n}`);
    }
  }
  return out;
}

// A recording time in a phone's file name: 20261024_091233 (Samsung),
// VID_20261024_091233, vid-20261024-091233, PXL_20261024_081233123 (with ms).
const NAME_TIME = /(20\d{2})(\d{2})(\d{2})([_-])(\d{2})(\d{2})(\d{2})(\d{3})?(?!\d)/;

const two = (n) => String(n).padStart(2, '0');

/**
 * The file name with the time in it moved on by `ms`, so the new file's name
 * says when its own recording started. The digits are shifted as they are
 * (no time zone), which is right except across a clock change. Names without
 * a time come back as they were.
 */
export function shiftNameTime(name, ms) {
  const m = NAME_TIME.exec(name);
  if (!m) return name;
  const [all, y, mo, d, sep, hh, mi, ss, milli] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss, milli ? +milli : 0) + ms;
  const at = new Date(milli ? t : Math.floor(t / 1000) * 1000);
  const text = `${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}${sep}${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}${milli ? String(at.getUTCMilliseconds()).padStart(3, '0') : ''}`;
  return name.slice(0, m.index) + text + name.slice(m.index + all.length);
}

const splitExt = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
};

/** "20261101_121214.mp4", 95.2 s in, part 2 -> "20261101_121349 part 2.mp4" */
export function splitName(name, offset, n) {
  const [stem, ext] = splitExt(shiftNameTime(name, Math.floor(offset * 1000)));
  return `${stem} part ${n}${ext}`;
}

/** "20261101_121214.mp4" -> "20261101_121214 merged.mp4" (the first video's name: its start). */
export function mergedName(name) {
  const [stem, ext] = splitExt(name);
  return `${stem} merged${ext}`;
}

/**
 * Why these videos (rows from GET /api/videos) can't be joined without
 * re-encoding: they must have the same kind of picture and sound. The server
 * checks the streams themselves again before it starts.
 */
export function mergeProblems(videos) {
  const problems = [];
  if (videos.length < 2) problems.push('Choose at least two videos');
  const [a] = videos;
  for (const v of videos.slice(1)) {
    if (v.codec !== a.codec) problems.push(`${v.name} is ${v.codec ?? '?'}, ${a.name} is ${a.codec ?? '?'}`);
    if (v.width !== a.width || v.height !== a.height) problems.push(`${v.name} is ${v.width}×${v.height}, ${a.name} is ${a.width}×${a.height}`);
    if (Math.abs((v.fps ?? 0) - (a.fps ?? 0)) > Math.max(1, (a.fps ?? 0) * 0.05)) problems.push(`${v.name} is ${Math.round(v.fps ?? 0)} fps, ${a.name} is ${Math.round(a.fps ?? 0)} fps`);
    if (v.hasAudio !== a.hasAudio) problems.push(`${v.hasAudio ? v.name : a.name} has sound and ${v.hasAudio ? a.name : v.name} hasn’t`);
    if (v.hdr !== a.hdr) problems.push(`${v.hdr ? v.name : a.name} is HDR and ${v.hdr ? a.name : v.name} isn’t`);
  }
  for (const v of videos) if (v.missing) problems.push(`${v.name} isn’t in its folder any more`);
  const ids = videos.map((v) => v.id);
  if (new Set(ids).size !== ids.length) problems.push('A video is in the list twice');
  return problems;
}

/** "1:02.40" for a time in seconds (hundredths), "1:02:03.40" past an hour. */
export function timeText(seconds) {
  const s = Math.max(0, seconds ?? 0);
  const whole = Math.floor(s);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const rest = `${two(whole % 60)}.${two(Math.floor((s - whole) * 100 + 1e-6))}`;
  return h ? `${h}:${two(m)}:${rest}` : `${m}:${rest}`;
}

/** "1:02.4", "62.4", "1:02:03" -> seconds; null when it isn't a time. */
export function parseTime(text) {
  const t = String(text ?? '').trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d*)?$/.test(t)) return null;
  return Math.round(t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) * 1000) / 1000;
}
