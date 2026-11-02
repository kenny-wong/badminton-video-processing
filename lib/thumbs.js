// Thumbnails for the tournament page's grid: one frame of each match video,
// taken by FFmpeg a little way into the match and cached as a small JPEG. The
// cache name includes the source and the moment, so a re-linked video or a
// moved match start makes a new one.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './ffmpeg.js';
import { loadMatch, sourceFor } from './pipeline.js';
import { hdrFilter } from './render.js';
import { hdrNpl, readSettings } from './settings.js';

const AT_MOST = 2; // FFmpeg runs at once, so a grid of many matches doesn't swamp the PC
let running = 0;
const waiting = [];

async function limited(work) {
  if (running >= AT_MOST) await new Promise((r) => waiting.push(r));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/**
 * The filter for a small picture of a match video: an HDR (phone) video is shrunk first, then tone-mapped
 * like the render at the brightness chosen in Settings, so thumbnails look like the finished video
 * rather than flat and washed out. `look` goes into the cache name.
 */
function pictureFilter(db, source, width) {
  if (!source.hdr) return { vf: `scale=${width}:-2`, look: '' };
  const npl = hdrNpl(readSettings(db).output);
  return { vf: `scale=${width}:-2,${hdrFilter(npl)},scale=out_color_matrix=bt709:out_range=pc`, look: `|hdr${npl}` };
}

/** Where to take the frame: a minute into the match, or a tenth of the way for short videos. */
export function thumbTime(matchStart, duration) {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 1;
  return Math.round(Math.max(0, Math.min((matchStart ?? 0) + Math.min(60, d * 0.1), d - 1)) * 10) / 10;
}

/** The thumbnail file for a match, made on first use; null when it has no playable video. */
export async function thumbnail(db, tools, dir, id) {
  const loaded = loadMatch(db, id);
  if (!loaded?.videos.length || loaded.videos.some((v) => v.missing)) return null;
  const source = sourceFor(loaded);
  const { path, duration } = source;
  const at = thumbTime(loaded.match.matchStart, duration);
  const { vf, look } = pictureFilter(db, source, 480);
  const key = createHash('sha1').update(`${path}|${at}${look}`).digest('hex').slice(0, 12);
  const file = join(dir, `match-${id}-${key}.jpg`);
  if (existsSync(file)) return file;
  await mkdir(dir, { recursive: true });
  await limited(() => run(tools, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', String(at), '-i', path,
    '-frames:v', '1', '-vf', vf, '-q:v', '5', file]));
  return existsSync(file) ? file : null;
}

/**
 * A frame of the newest HDR video in the library as the render would make it with
 * `npl` (settings HDR_LOOKS), for choosing in Settings; null when there's no HDR video.
 */
export async function hdrPreview(db, tools, dir, npl) {
  const video = db.prepare('SELECT path, duration FROM videos WHERE hdr = 1 AND missing = 0 ORDER BY recorded_at DESC LIMIT 1').get();
  if (!video || !existsSync(video.path)) return null;
  const at = thumbTime(0, video.duration);
  const key = createHash('sha1').update(`${video.path}|${at}|${npl}`).digest('hex').slice(0, 16);
  const file = join(dir, 'hdr', `${key}.jpg`);
  if (existsSync(file)) return file;
  await mkdir(join(dir, 'hdr'), { recursive: true });
  await limited(() => run(tools, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', String(at), '-i', video.path,
    '-frames:v', '1', '-vf', `${hdrFilter(npl)},scale=480:-2:out_color_matrix=bt709:out_range=pc`, '-q:v', '4', file]));
  return existsSync(file) ? file : null;
}

/** A small frame of a match video at `at` seconds (whole seconds), for the editor's timeline; null when there is no playable video. */
export async function frameAt(db, tools, dir, id, at, width = 192) {
  const loaded = loadMatch(db, id);
  if (!loaded?.videos.length || loaded.videos.some((v) => v.missing)) return null;
  const source = sourceFor(loaded);
  if (!source.ready) return null;
  const t = Math.max(0, Math.min(Math.round(at), Math.floor(source.duration) - 1));
  const { vf, look } = pictureFilter(db, source, width);
  const key = createHash('sha1').update(`${source.path}|${t}|${width}${look}`).digest('hex').slice(0, 16);
  const file = join(dir, 'frames', `${key}.jpg`);
  if (existsSync(file)) return file;
  await mkdir(join(dir, 'frames'), { recursive: true });
  await limited(() => run(tools, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', String(t), '-i', source.path,
    '-frames:v', '1', '-vf', vf, '-q:v', '6', file]));
  return existsSync(file) ? file : null;
}
