// Planning the edited video: which parts of the match video to keep, where the
// chapters fall in the result, and the FFmpeg commands that cut each part,
// draw the scoreboard and join them. No I/O here; tested in tests/render.test.js.

export const DEFAULT_CUT = { pre: 2, post: 2.5, mergeGap: 4 };

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

/** Where a moment of the match video lands in the result, or null when it is cut out. */
export function toOutput(t, parts) {
  const p = parts.find((x) => t >= x.start && t <= x.end);
  return p ? p.outStart + (t - p.start) : null;
}

/** Total length of the result in seconds. */
export const outputLength = (parts) => parts.reduce((s, p) => s + p.end - p.start, 0);

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

/** Video encoder settings: NVIDIA's hardware encoder when present, else x264. */
export function encoderArgs(encoder) {
  return encoder === 'h264_nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
}

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
 * same codec settings so they can be joined without re-encoding.
 */
export function partArgs({ src, start, end, out, overlay = true, encoder = 'libx264', fps = 30, hasAudio = true, hdr = false, logo = null }) {
  const chain = [
    // iPhones film in HDR by default; without tone mapping it looks washed out in ordinary (SDR) video.
    hdr ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv' : null,
    overlay ? `setpts=PTS+${start}/TB,ass=overlay.ass,setpts=PTS-STARTPTS` : null,
  ].filter(Boolean);
  const audioInput = logo ? 2 : 1;
  const video = logo
    ? ['-filter_complex', `[0:v]${chain.join(',') || 'null'}[base];${logoFilter(logo)};[base][logo]overlay=${logoPosition(logo.corner)}:eof_action=repeat,format=yuv420p[v]`, '-map', '[v]']
    : ['-map', '0:v:0', '-vf', [...chain, 'format=yuv420p'].join(',')];
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-ss', String(start), '-to', String(end), '-i', src,
    ...(logo ? ['-i', logo.path] : []),
    ...(hasAudio ? [] : ['-f', 'lavfi', '-t', String(end - start), '-i', 'anullsrc=r=48000:cl=stereo']),
    ...video,
    '-map', hasAudio ? '0:a:0' : `${audioInput}:a:0`,
    '-fps_mode', 'cfr', '-r', String(fps),
    ...encoderArgs(encoder),
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
export function cardArgs({ out, width, height, fps = 30, seconds = 3, colour = '#0f3b2d', encoder = 'libx264', ass = 'card.ass' }) {
  const fade = Math.min(0.4, seconds / 4);
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x${colour.slice(1)}:s=${width}x${height}:r=${fps}:d=${seconds}`,
    '-f', 'lavfi', '-t', String(seconds), '-i', 'anullsrc=r=48000:cl=stereo',
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', `ass=${ass},fade=t=in:st=0:d=${fade},fade=t=out:st=${seconds - fade}:d=${fade},format=yuv420p`,
    '-fps_mode', 'cfr', '-r', String(fps),
    ...encoderArgs(encoder),
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

/** FFmpeg arguments that join a match's video files, untouched, into one. */
export function sourceJoinArgs({ list, out }) {
  return ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', out];
}
