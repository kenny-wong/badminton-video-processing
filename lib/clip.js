// A clip of one rally, for sharing: the rally with a little either side, as
// filmed or cut to an upright 9:16 picture (Shorts, Reels, TikTok). The
// upright cut follows the shuttle where it was tracked, smoothly, else it
// stays on the middle of the court. The planning is pure and tested in
// tests/clip.test.js; renderClip runs FFmpeg.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { run, pickEncoder } from './ffmpeg.js';
import { assScript, scoreSpans } from './overlay.js';
import { encoderArgs, outputFps } from './render.js';
import { loadMatch, matchFormat, sourceFor } from './pipeline.js';
import { readTrack, trackPoints } from './track.js';
import { outputPath, safeName } from './naming.js';
import { boardHeading, resolveBoard } from '../public/shared/board.js';
import { replayMatch } from '../public/shared/score.js';
import { teamName } from '../public/shared/names.js';
import { voiceFreeSound } from './voices.js';

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Where the upright window's left edge is (pixels) every `step` seconds from
 * `start` to `end`: centred on the shuttle's middle sighting within `window`
 * seconds, eased towards it so the picture doesn't jump, held when the
 * shuttle isn't seen, and kept inside the picture. `points` are tracked
 * sightings { t, x (0-1) }; `fallback` is where to look before any.
 */
export function cropPath(points, { start, end, width, cropW, step = 0.2, window = 0.6, ease = 0.35, fallback = 0.5 }) {
  const near = points.filter((p) => p.t >= start - window && p.t <= end + window);
  const out = [];
  let centre = null;
  for (let t = start; t <= end + 1e-9; t += step) {
    const xs = near.filter((p) => Math.abs(p.t - t) <= window).map((p) => p.x).sort((a, b) => a - b);
    const target = xs.length ? xs[xs.length >> 1] : centre ?? fallback;
    centre = centre === null ? target : centre + (target - centre) * ease;
    out.push({ t: round2(t), x: Math.round(Math.min(width - cropW, Math.max(0, centre * width - cropW / 2))) });
  }
  return out;
}

/** FFmpeg's sendcmd file moving the crop window: "12.4 crop x 512;" per line. */
export const cropCommands = (path) => path.map((p) => `${p.t} crop x ${p.x};`).join('\n') + '\n';

/** The upright window for a picture: its full height, 9:16 wide (even pixels); null when it is already upright. */
export function uprightCrop(width, height) {
  if (!width || !height || width / height <= 9 / 16 + 0.01) return null;
  return { w: Math.round((height * 9) / 16 / 2) * 2, h: height - (height % 2) };
}

/** The middle of the court across the picture (0-1), from its marked corners, else the middle of the picture. */
export const courtMiddle = (corners) => (Array.isArray(corners) && corners.length === 4 ? corners.reduce((s, c) => s + c[0], 0) / 4 : 0.5);

/**
 * FFmpeg arguments for a clip: cut, optionally cropped upright (following `clip.cmd`), with the scoreboard (`clip.ass`),
 * and the sound from `audio` (the sound without voices) instead of the video's when given.
 */
export function clipArgs({ src, start, end, out, crop = null, startX = 0, upright = null, overlay = true, encoder = 'libx264', fps = 30, hasAudio = true, hdr = false, audio = null }) {
  const vf = [
    hdr ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv' : null,
    `setpts=PTS+${start}/TB`,
    crop ? `sendcmd=f=clip.cmd,crop=${crop.w}:${crop.h}:${startX}:0` : null,
    overlay ? 'ass=clip.ass' : null,
    'setpts=PTS-STARTPTS',
    upright ? `scale=${upright.w}:${upright.h},setsar=1` : null,
    'format=yuv420p',
  ].filter(Boolean).join(',');
  return [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-ss', String(start), '-to', String(end), '-i', src,
    ...(!hasAudio ? ['-f', 'lavfi', '-t', String(end - start), '-i', 'anullsrc=r=48000:cl=stereo'] : audio ? ['-ss', String(start), '-to', String(end), '-i', audio] : []),
    '-map', '0:v:0', '-map', hasAudio && !audio ? '0:a:0' : '1:a:0',
    '-vf', vf,
    '-fps_mode', 'cfr', '-r', String(fps),
    ...encoderArgs(encoder),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-shortest',
    out,
  ];
}

/** Renders a clip of rally `index` (0-based) of a match. */
export async function renderClip(db, tools, settings, id, { index, upright = true, removeVoices = settings.output?.removeVoices, signal, job }) {
  const loaded = loadMatch(db, id);
  const { match } = loaded;
  const source = sourceFor(loaded);
  if (!source.ready) throw new Error('The match video isn’t ready');
  const rally = match.rallies[index];
  if (!rally) throw new Error('No such rally');
  const start = round2(Math.max(0, rally.start - settings.pre));
  const end = round2(Math.min(source.duration, rally.end + settings.post));
  const dir = join(settings.outputFolder, '.work', `match-${id}`, 'clip');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const crop = upright ? uprightCrop(source.width, source.height) : null;
  const format = matchFormat(match);
  const { steps, initial } = replayMatch(match, format);
  const style = resolveBoard(settings.board, match.boardStyle);
  // In the upright picture the scoreboard is laid out for the narrow frame, a little smaller.
  const boardStyle = crop ? { ...style, scale: Math.round(style.scale * 0.8), corner: style.corner[0] === 'b' ? 'bl' : 'tl' } : style;
  await writeFile(join(dir, 'clip.ass'), assScript({
    width: crop?.w ?? source.width ?? 1920, height: crop?.h ?? source.height ?? 1080, teams: [match.teamA, match.teamB],
    spans: scoreSpans(match.rallies, steps, source.duration, initial), title: match.draw, nameStyle: settings.nameStyle, style: boardStyle, format,
    heading: boardHeading(boardStyle, loaded),
  }));
  let startX = 0;
  let followed = false;
  if (crop) {
    const track = await readTrack(match.trackPath);
    const points = track ? trackPoints(track).filter((p) => p.t >= start && p.t <= end) : [];
    followed = points.length >= 10;
    const path = cropPath(points, { start, end, width: source.width, cropW: crop.w, fallback: courtMiddle(match.corners) });
    startX = path[0]?.x ?? 0;
    await writeFile(join(dir, 'clip.cmd'), cropCommands(path));
  }
  const name = outputPath({ tournament: loaded.tournament, match });
  const file = join(settings.outputFolder, name[0], name[1], 'Clips', `${safeName(name[2].replace(/\.mp4$/, ''), 100)} - rally ${index + 1}${crop ? ' (upright)' : ''}.mp4`);
  await mkdir(dirname(file), { recursive: true });
  job.message = crop ? `Cutting rally ${index + 1} upright${followed ? ', following the shuttle' : ''}` : `Cutting rally ${index + 1}`;
  const audio = removeVoices && source.hasAudio ? await voiceFreeSound(tools, settings, id, source, { signal, job }) : null;
  const upr = crop ? { w: 1080, h: 1920 } : null;
  await run(tools, clipArgs({
    src: source.path, start, end, out: file, crop, startX, upright: upr && crop.h > 1920 ? upr : null, encoder: pickEncoder(tools), fps: outputFps(source.fps), hasAudio: source.hasAudio, hdr: source.hdr, audio,
  }), { cwd: dir, signal, onProgress: (s) => { job.progress = Math.min(0.99, s / (end - start)); } });
  const title = `${teamName(match.teamA)} v ${teamName(match.teamB)} · rally ${index + 1} · ${loaded.tournament.name}`.slice(0, 100);
  await writeFile(file.replace(/\.mp4$/, '.txt'), `${title}\n`);
  return { path: file, seconds: Math.round(end - start), upright: Boolean(crop), followed, exists: existsSync(file) };
}
