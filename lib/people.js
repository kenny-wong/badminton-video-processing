// Finding the people in a match video with Ultralytics YOLO11 pose and its
// ByteTrack tracker (analysis/find_people.py, in the same Python set-up as
// the shuttle tracker, from Settings). The page names the
// players from this (public/shared/people.js).
//
// The whole video is first shrunk to 10 frames a second at 1280 px wide (enough
// to follow players, and quick: a 6-minute game takes about 2 minutes on an
// RTX 3090). The result is people.json in the match's work folder; it also
// keeps which way round each doubles pair's names go (`swap`).

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pickEncoder, run } from './ffmpeg.js';
import { loadMatch, sourceFor } from './pipeline.js';
import { runPython } from './track.js';
import { notSetUp, pythonIn, SCRIPTS, toolsFolder } from './analysis.js';

export const PEOPLE_FPS = 10;
const PEOPLE_WIDTH = 1280;
export const PEOPLE_MODEL = 'yolo11m-pose.pt';

/** Where the player finder's parts are, and whether they are there (the model downloads itself on first use). */
export function peopleFinder(root, scripts = SCRIPTS) {
  const python = pythonIn(root);
  const script = join(scripts, 'find_people.py');
  const weights = join(root, 'ckpts');
  return { python, script, weights, ready: existsSync(python) && existsSync(script) };
}

const peopleFile = (settings, id) => join(settings.outputFolder, '.work', `match-${id}`, 'people', 'people.json');

/** The people found in a match's video, or null when they haven't been looked for (or the video changed since). */
export async function readPeople(settings, loaded) {
  const file = peopleFile(settings, loaded.match.id);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data.source === sourceFor(loaded).path ? data : null;
  } catch {
    return null;
  }
}

/** Saves which way round each doubles pair's names go: { a, b } booleans. */
export async function saveSwap(settings, loaded, swap) {
  const data = await readPeople(settings, loaded);
  if (!data) return null;
  data.swap = { a: swap?.a === true, b: swap?.b === true };
  await writeFile(peopleFile(settings, loaded.match.id), JSON.stringify(data));
  return data.swap;
}

/** Finds and follows the people through the whole video and saves people.json. */
export async function findPeople(db, tools, settings, id, { signal, job }) {
  const finder = peopleFinder(toolsFolder(settings));
  if (!finder.ready) throw new Error(notSetUp('Finding players'));
  const loaded = loadMatch(db, id);
  const source = sourceFor(loaded);
  if (!source.ready) throw new Error('The match video isn’t ready');
  const dir = join(settings.outputFolder, '.work', `match-${id}`, 'people');
  await mkdir(dir, { recursive: true });
  await mkdir(finder.weights, { recursive: true });
  job.logFile = join(dir, 'people.log');
  await writeFile(job.logFile, '');
  const log = (text) => job.log(text);
  log(`Finding players in match ${id}: ${source.path} (${Math.round(source.duration)} s)`);
  const input = join(dir, 'input.mp4');
  job.message = 'Preparing the video';
  const encoder = pickEncoder(tools);
  await run(tools, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', source.path,
    '-an', '-vf', `fps=${PEOPLE_FPS},scale=${PEOPLE_WIDTH}:-2,format=yuv420p`,
    ...(encoder === 'h264_nvenc' ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']), input], {
    signal, onProgress: (s) => { job.progress = Math.min(0.15, (s / Math.max(1, source.duration)) * 0.15); },
  });
  const raw = join(dir, 'found.json');
  const frames = Math.round(source.duration * PEOPLE_FPS);
  const started = Date.now();
  job.message = 'Finding the players (YOLO on the GPU): starting';
  await runPython(finder, [finder.script, '--video', input, '--out', raw, '--model', PEOPLE_MODEL], {
    cwd: finder.weights, // the model's weights download here the first time
    signal,
    log,
    logFile: job.logFile,
    what: 'Finding players',
    program: 'YOLO',
    onLine: (line) => {
      const m = /^frame (\d+)\/(\d+)/.exec(line);
      if (!m) return;
      const done = Math.min(1, Number(m[1]) / Math.max(1, Number(m[2]) || frames));
      job.progress = 0.15 + done * 0.85;
      const spent = (Date.now() - started) / 1000;
      const left = done > 0.03 ? `, about ${Math.ceil(((spent / done) * (1 - done)) / 60)} min left` : '';
      job.message = `Finding the players: ${Math.round(done * 100)}%${left}`;
    },
  });
  const found = JSON.parse(await readFile(raw, 'utf8'));
  const old = await readPeople(settings, loaded);
  const data = { ...found, offset: 0, source: source.path, model: PEOPLE_MODEL, swap: old?.swap ?? { a: false, b: false } };
  await writeFile(peopleFile(settings, id), JSON.stringify(data));
  const seen = found.frames.reduce((n, [, list]) => n + list.length, 0);
  log(`Found ${seen} people across ${found.frames.length} frames`);
  return { frames: found.frames.length, people: seen };
}
