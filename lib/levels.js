// The sound level along a match video, for the editor's timeline: shuttle
// hits stand out as spikes, so missed rallies show at a glance. Worked out
// once per video file (FFmpeg reads only the sound) and kept in the match's
// work folder, with the times of the hits found in it (for shot counts).

import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { soundLevels } from './analyse.js';
import { FRAME_SECONDS, findHits } from './hits.js';
import { loadMatch, sourceFor } from './pipeline.js';

export const LEVEL_STEP = 0.1; // seconds per value sent to the page

/** The loudest of every `per` values (dB, to one decimal). */
export function downsample(levels, per = Math.round(LEVEL_STEP / FRAME_SECONDS)) {
  const out = [];
  for (let i = 0; i < levels.length; i += per) {
    let max = -Infinity;
    for (let j = i; j < Math.min(levels.length, i + per); j++) if (levels[j] > max) max = levels[j];
    out.push(Math.round(max * 10) / 10);
  }
  return out;
}

const cacheFile = (settings, id) => join(settings.outputFolder, '.work', `match-${id}`, 'levels.json');
const keyOf = (path) => `${path}|${statSync(path).size}`;

/** The cached levels for the match's current video, or null. */
export async function cachedLevels(db, settings, id) {
  const loaded = loadMatch(db, id);
  const source = loaded && sourceFor(loaded);
  const file = cacheFile(settings, id);
  if (!source?.ready || !existsSync(file)) return null;
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    // A cache from before hit times were kept is worked out again.
    return data.key === keyOf(source.path) && Array.isArray(data.hits) ? { step: data.step, levels: data.levels, hits: data.hits } : null;
  } catch {
    return null;
  }
}

/** Works out (and caches) the levels for the match's video. */
export async function matchLevels(db, tools, settings, id, { signal, job }) {
  const loaded = loadMatch(db, id);
  const source = sourceFor(loaded);
  if (!source.ready) throw new Error('The match video isn’t ready');
  job.message = 'Reading the sound';
  const raw = await soundLevels(tools, source.path, { duration: source.duration, signal, onProgress: (p) => { job.progress = p; } });
  const levels = downsample(raw);
  const hits = findHits(raw, { sensitivity: settings.sensitivity }).map((t) => Math.round(t * 100) / 100);
  const file = cacheFile(settings, id);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify({ key: keyOf(source.path), step: LEVEL_STEP, levels, hits }));
  return { step: LEVEL_STEP, levels, hits };
}
