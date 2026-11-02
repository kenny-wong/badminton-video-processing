// Planning the edited video: which parts of the match video to keep, where the
// chapters fall in the result, and the FFmpeg commands that cut each part,
// draw the scoreboard and join them. No I/O here; tested in tests/render.test.js.

export const DEFAULT_CUT = { pre: 1.5, post: 1.5, mergeGap: 4 };

/** The folder, inside a working folder, holding the app's fonts (copied there by lib/fonts.js). */
export const FONTS_SUBDIR = 'fonts';
/** The ass filter for a subtitle file in the working folder, able to use the app's own fonts. */
export const assFilter = (file) => `ass=${file}:fontsdir=${FONTS_SUBDIR}`;

/**
 * The parts to keep: each rally from `pre` seconds before it starts to `post`
 * seconds after it ends, clipped to the video, with parts that overlap or are
 * less than `mergeGap` seconds apart joined. With `cut` false, the whole video.
 * `from` and `to` (the marked match start and end) bound everything kept.
 * @returns {{ start: number, end: number, outStart: number }[]}
 */
export function plan(rallies, duration, { cut = true, pre = DEFAULT_CUT.pre, post = DEFAULT_CUT.post, mergeGap = DEFAULT_CUT.mergeGap, from = null, to = null } = {}) {
  const lo = Math.max(0, from ?? 0);
  const hi = Math.min(duration, to ?? duration);
  const parts = [];
  const inside = rallies.filter((r) => r.end > lo && r.start < hi);
  if (!cut || !inside.length) {
    parts.push({ start: lo, end: hi });
  } else {
    for (const r of [...inside].sort((x, y) => x.start - y.start)) {
      const start = Math.max(lo, r.start - pre);
      const end = Math.min(hi, r.end + post);
      if (end <= start) continue;
      const last = parts.at(-1);
      if (last && start - last.end < mergeGap) last.end = Math.max(last.end, end);
      else parts.push({ start, end });
    }
  }
  let out = 0;
  return parts.map((p) => {
    const part = { start: round3(p.start), end: round3(p.end), outStart: round3(out) };
    out += p.end - p.start;
    return part;
  });
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/** Where a moment of the match video lands in the result (its first showing, not a replay), or null when it is cut out. */
export function toOutput(t, parts) {
  const p = parts.find((x) => !x.replay && t >= x.start && t <= x.end);
  return p ? p.outStart + (t - p.start) : null;
}

/** How long a part lasts in the result (a slow-motion replay longer than its source). */
export const partLength = (p) => (p.end - p.start) * (p.slow ?? 1);

/** Total length of the result in seconds. */
export const outputLength = (parts) => parts.reduce((s, p) => s + partLength(p), 0);

export const REPLAY = { seconds: 3, slow: 2 };

/**
 * Adds a slow-motion replay of the last few seconds of each favourite rally
 * right after the part holding it, and works out every part's place in the
 * result again. Replay parts are { start, end, slow, replay: true }.
 */
export function withReplays(parts, favourites, { seconds = REPLAY.seconds, slow = REPLAY.slow } = {}) {
  const out = [];
  for (const p of parts) {
    out.push({ ...p });
    for (const r of favourites.filter((f) => f.end > p.start && f.end <= p.end + 0.01).sort((x, y) => x.end - y.end)) {
      const end = Math.min(r.end, p.end);
      out.push({ start: round3(Math.max(r.start, end - seconds)), end: round3(end), slow, replay: true });
    }
  }
  let at = 0;
  for (const p of out) {
    p.outStart = round3(at);
    at += partLength(p);
  }
  return out;
}

/**
 * The size to encode at: the video's own, or with its shorter side brought
 * down to 1080 or 720 (never up), in even numbers as H.264 needs.
 */
export function outputSize(width, height, preset = 'source') {
  const w = width || 1920;
  const hgt = height || 1080;
  const target = { 1080: 1080, 720: 720 }[preset];
  const short = Math.min(w, hgt);
  const k = target && target < short ? target / short : 1;
  const even = (x) => Math.max(2, Math.round((x * k) / 2) * 2);
  return { w: even(w), h: even(hgt) };
}

/**
 * Chapters for the result: each game's first rally, and the first rally after
 * its interval ("Game 1 – from 11"), at their times in the result, counting
 * from `firstGame` when the video starts mid-match. The first always starts at
 * 0, as YouTube requires.
 * @returns {{ at: number, title: string }[]}
 */
export function chapters(rallies, steps, parts, midPoint = 11, firstGame = 1) {
  const out = [];
  let game = firstGame;
  let wantGameStart = true;
  let wantInterval = false;
  rallies.forEach((r, i) => {
    const s = steps[i];
    if (!s?.counted) return;
    const at = toOutput(Math.max(r.start - 1, 0), parts) ?? toOutput(r.start, parts);
    if (at !== null && wantGameStart) out.push({ at, title: `Game ${game}` });
    else if (at !== null && wantInterval) out.push({ at, title: `Game ${game} – from ${midPoint}` });
    wantGameStart = false;
    wantInterval = false;
    if (s.event === 'interval') wantInterval = true;
    if (s.event === 'game') {
      game += 1;
      wantGameStart = true;
    }
  });
  if (out.length) out[0].at = 0;
  // Later chapters closer than 10 s to the one before would be ignored by YouTube.
  return out.filter((c, i) => i === 0 || c.at - out[i - 1].at >= 10).map((c) => ({ ...c, at: Math.floor(c.at) }));
}

/** "0:00 Game 1" lines for a YouTube description. */
export function chapterLines(list, clock) {
  return list.map((c) => `${clock(c.at)} ${c.title}`).join('\n');
}

/** FFmpeg's chapter metadata file (FFMETADATA1) for the result. */
export function chapterMetadata(list, total) {
  const lines = [';FFMETADATA1'];
  list.forEach((c, i) => {
    const end = i < list.length - 1 ? list[i + 1].at : total;
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.at * 1000)}`, `END=${Math.round(end * 1000)}`, `title=${c.title.replace(/[=;#\\\n]/g, ' ')}`);
  });
  return lines.join('\n') + '\n';
}

/** Video encoder settings: NVIDIA's hardware encoder when present, else x264; `maxRate` (Mbit/s) caps the bitrate. */
export function encoderArgs(encoder, { maxRate = 0 } = {}) {
  const cap = maxRate > 0 ? ['-maxrate', `${maxRate}M`, '-bufsize', `${maxRate * 2}M`] : [];
  return [
    ...(encoder === 'h264_nvenc'
      ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', '0', ...cap]
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', ...cap]),
    ...SDR_TAGS,
  ];
}

// Every output is ordinary HD video, and says so in the file, so YouTube and players don't have to guess its colours.
export const SDR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/**
 * HDR (HLG/PQ) to ordinary video: linear light, with `npl` nits taken as the
 * picture's peak (higher = darker; settings HDR_LOOKS), tone mapped with hable.
 */
export const hdrFilter = (npl = 200) => `zscale=t=linear:npl=${npl},format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv`;

/** A whole frame rate to encode at: 59.94 -> 60, 29.97 -> 30, anything odd -> 30. */
export function outputFps(fps) {
  const r = Math.round(fps ?? 30);
  return [24, 25, 30, 48, 50, 60].includes(r) ? r : 30;
}

/**
 * FFmpeg arguments for one kept part, run in the folder holding `overlay.ass`
 * (Windows drive letters can't easily be written inside a filter). Seeking
 * before the input restarts timestamps at 0, so they are shifted back to the
 * match video's time for the scoreboard, then back to 0. Every part gets the
 * same codec settings so they can be joined without re-encoding. `audio` is a
 * sound file in the match video's time to use instead of the video's own
 * (the sound without voices, lib/voices.js).
 */
export function partArgs({ src, start, end, out, overlay = true, encoder = 'libx264', fps = 30, hasAudio = true, hdr = false, npl = 200, logo = null, size = null, slow = 1, label = null, maxRate = 0, audio = null }) {
  const chain = [
    // Phones film in HDR by default; without tone mapping it looks washed out in ordinary (SDR) video.
    hdr ? hdrFilter(npl) : null,
    overlay ? `setpts=PTS+${start}/TB,${assFilter('overlay.ass')},setpts=PTS-STARTPTS` : null,
    // A replay: every frame shown `slow` times as long (the constant frame rate repeats them), with its label.
    slow !== 1 ? `setpts=${slow}*PTS` : null,
    label ? assFilter(label) : null,
  ].filter(Boolean);
  // To a smaller size; `fit` keeps the picture whole inside it (black bars), for joining videos of different shapes.
  const scale = size ? (size.fit ? `scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1` : `scale=${size.w}:${size.h},setsar=1`) : null;
  const silent = !hasAudio || slow !== 1; // replays are silent
  const audioInput = logo ? 2 : 1;
  const tail = [scale, 'format=yuv420p'].filter(Boolean).join(',');
  const video = logo
    ? ['-filter_complex', `[0:v]${chain.join(',') || 'null'}[base];${logoFilter(logo)};[base][logo]overlay=${logoPosition(logo.corner)}:eof_action=repeat,${tail}[v]`, '-map', '[v]']
    : ['-map', '0:v:0', '-vf', [...chain, tail].join(',')];
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-ss', String(start), '-to', String(end), '-i', src,
    ...(logo ? ['-i', logo.path] : []),
    ...(silent ? ['-f', 'lavfi', '-t', String(Math.round((end - start) * slow * 1000) / 1000), '-i', 'anullsrc=r=48000:cl=stereo']
      : audio ? ['-ss', String(start), '-to', String(end), '-i', audio] : []),
    ...video,
    '-map', silent || audio ? `${audioInput}:a:0` : '0:a:0',
    '-fps_mode', 'cfr', '-r', String(fps),
    ...encoderArgs(encoder, { maxRate }),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-video_track_timescale', '90000',
    '-shortest',
    out,
  ];
}

/** The logo (input 1) scaled to `width` pixels across and faded to `opacity` (0-1), as [logo]. */
export const logoFilter = ({ width, opacity = 1 }) => `[1:v]scale=${Math.max(8, Math.round(width))}:-1,format=rgba,colorchannelmixer=aa=${Math.round(opacity * 100) / 100}[logo]`;

/** Where the logo goes: the chosen corner, the same margins as the scoreboard. */
export function logoPosition(corner = 'tr') {
  const x = corner[1] === 'l' ? 'x=main_w*0.025' : 'x=main_w-overlay_w-main_w*0.025';
  const y = corner[0] === 't' ? 'y=main_h*0.04' : 'y=main_h-overlay_h-main_h*0.04';
  return `${x}:${y}`;
}

/**
 * FFmpeg arguments for a title or end card: `seconds` of `colour` at the
 * video's size and frame rate with `card.ass` (in the working folder) drawn on
 * it, fading in and out, with silence, encoded like the parts.
 */
export function cardArgs({ out, width, height, fps = 30, seconds = 3, colour = '#0f3b2d', encoder = 'libx264', ass = 'card.ass', maxRate = 0 }) {
  const fade = Math.min(0.4, seconds / 4);
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x${colour.slice(1)}:s=${width}x${height}:r=${fps}:d=${seconds}`,
    '-f', 'lavfi', '-t', String(seconds), '-i', 'anullsrc=r=48000:cl=stereo',
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', `${assFilter(ass)},fade=t=in:st=0:d=${fade},fade=t=out:st=${seconds - fade}:d=${fade},format=yuv420p`,
    '-fps_mode', 'cfr', '-r', String(fps),
    ...encoderArgs(encoder, { maxRate }),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-video_track_timescale', '90000',
    '-shortest',
    out,
  ];
}

/** A line of FFmpeg's concat list: file 'C:/x/it''s.mp4' */
export const concatLine = (path) => `file '${String(path).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;

/** FFmpeg arguments that join the parts listed in `list` and add the chapters. */
export function joinArgs({ list, chapters: meta = null, out }) {
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list,
    ...(meta ? ['-i', meta, '-map_metadata', '1', '-map_chapters', '1'] : []),
    '-map', '0', '-c', 'copy', '-movflags', '+faststart',
    out,
  ];
}

/**
 * FFmpeg arguments that lay music under a finished video: the music looped
 * and faded at the end, at `music` volume, the court's own sound at `court`
 * (0-1 each). The picture is copied as it is.
 */
export function musicArgs({ video, music, out, length, musicVolume = 0.35, courtVolume = 0.6 }) {
  const fade = Math.min(3, Math.max(0.5, length / 10));
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-i', video, '-stream_loop', '-1', '-i', music,
    '-filter_complex', `[1:a]volume=${musicVolume},afade=t=out:st=${Math.max(0, Math.round((length - fade) * 100) / 100)}:d=${fade}[m];[0:a]volume=${courtVolume}[c];[c][m]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map', '0:v', '-map', '[a]', '-map_metadata', '0', '-map_chapters', '0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart',
    out,
  ];
}
