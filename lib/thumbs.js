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

/** Where to take the frame: a minute into the match, or a tenth of the way for short videos. */
export function thumbTime(matchStart, duration) {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 1;
  return Math.round(Math.max(0, Math.min((matchStart ?? 0) + Math.min(60, d * 0.1), d - 1)) * 10) / 10;
}

/** The thumbnail file for a match, made on first use; null when it has no playable video. */
export async function thumbnail(db, tools, dir, id) {
  const loaded = loadMatch(db, id);
  if (!loaded?.videos.length || loaded.videos.some((v) => v.missing)) return null;
  const { path, duration } = sourceFor(loaded);
  const at = thumbTime(loaded.match.matchStart, duration);
  const key = createHash('sha1').update(`${path}|${at}`).digest('hex').slice(0, 12);
  const file = join(dir, `match-${id}-${key}.jpg`);
  if (existsSync(file)) return file;
  await mkdir(dir, { recursive: true });
  await limited(() => run(tools, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', String(at), '-i', path,
    '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', file]));
  return existsSync(file) ? file : null;
}

/** A small frame of a match video at `at` seconds (whole seconds), for the editor's timeline; null when there is no playable video. */
export async function frameAt(db, tools, dir, id, at, width = 192) {
  const loaded = loadMatch(db, id);
  if (!loaded?.videos.length || loaded.videos.some((v) => v.missing)) return null;
  const source = sourceFor(loaded);
  if (!source.ready) return null;
  const t = Math.max(0, Math.min(Math.round(at), Math.floor(source.duration) - 1));
  const key = createHash('sha1').update(`${source.path}|${t}|${width}`).digest('hex').slice(0, 16);
  const file = join(dir, 'frames', `${key}.jpg`);
  if (existsSync(file)) return file;
  await mkdir(join(dir, 'frames'), { recursive: true });
  await limited(() => run(tools, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', String(t), '-i', source.path,
    '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '6', file]));
  return existsSync(file) ? file : null;
}
