// Taking the voices out of a match's sound (players' shouts, coaches, people
// talking by the court) with Demucs (MIT licence, github.com/facebookresearch/demucs),
// run as a separate Python program on the GPU from analysis/.venv, which
// analysis/setup.ps1 sets up. Everything else, shuttle hits included, stays
// as it was (analysis/remove_voices.py). The result is kept as court.flac in
// the match's work folder, in the source video's timeline, and rendering
// takes the sound from there instead of from the video. It is made again only
// when the source file or the model changes.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './ffmpeg.js';
import { runPython } from './track.js';

const ROOT = fileURLToPath(new URL('../analysis/', import.meta.url));
export const VOICE_MODEL = 'htdemucs_ft';
const SAMPLE_RATE = 44100; // Demucs' own

/** Where the voice remover's parts are, and whether they are all there. */
export function voiceRemover(root = ROOT) {
  const win = process.platform === 'win32';
  const python = join(root, '.venv', win ? 'Scripts\\python.exe' : 'bin/python');
  const script = join(root, 'remove_voices.py');
  const demucs = win ? join(root, '.venv', 'Lib', 'site-packages', 'demucs') : null;
  return { python, script, ready: [python, script, demucs].filter(Boolean).every((p) => existsSync(p)) };
}

/** What the saved sound was made from: it is reused only while this stays the same. */
export const soundKey = (path, { size, mtimeMs }, model = VOICE_MODEL) => ({ source: path, size, modified: Math.round(mtimeMs), model });

export const sameKey = (a, b) => Boolean(a && b) && ['source', 'size', 'modified', 'model'].every((k) => a[k] === b[k]);

/** Progress through Demucs' "chunk i/n" lines, 0-1, or null for other lines. */
export function chunkProgress(line) {
  const m = /chunk (\d+)\/(\d+)/.exec(line);
  return m ? Number(m[1]) / Math.max(1, Number(m[2])) : null;
}

/**
 * The match's sound without voices, as a file in the source video's timeline:
 * the saved one when it is still current, else made now (FFmpeg reads the
 * sound, Demucs takes the voices out, FFmpeg packs it as FLAC).
 */
export async function voiceFreeSound(tools, settings, id, source, { signal, job, onProgress = (p) => { job.progress = p; } }) {
  const remover = voiceRemover();
  if (!remover.ready) throw new Error('Removing voices isn’t set up yet: run analysis\\setup.ps1 once (see the README).');
  const dir = join(settings.outputFolder, '.work', `match-${id}`, 'voices');
  const out = join(dir, 'court.flac');
  const keyFile = join(dir, 'voices.json');
  const key = soundKey(source.path, await stat(source.path));
  if (existsSync(out)) {
    const saved = await readFile(keyFile, 'utf8').then(JSON.parse, () => null);
    if (sameKey(saved, key)) return out;
  }
  await mkdir(dir, { recursive: true });
  const log = (text) => job.log(text);
  const input = join(dir, 'input.wav');
  const clean = join(dir, 'clean.wav');
  const t0 = Date.now();
  job.message = 'Removing voices: reading the sound';
  await run(tools, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', source.path, '-map', '0:a:0', '-vn',
    '-af', 'aresample=async=1:first_pts=0', '-ac', '2', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', input], {
    signal, onProgress: (s) => onProgress(Math.min(0.1, (s / Math.max(1, source.duration)) * 0.1)),
  });
  job.message = 'Removing voices (Demucs on the GPU)';
  await runPython(remover, ['-I', remover.script, input, clean, '--model', VOICE_MODEL], {
    cwd: ROOT, signal, log, what: 'Removing voices', program: 'Demucs',
    onLine: (line) => {
      const p = chunkProgress(line);
      if (p !== null) onProgress(0.1 + p * 0.85);
    },
  });
  job.message = 'Removing voices: saving the sound';
  await run(tools, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', clean, '-c:a', 'flac', out], { signal });
  await Promise.all([rm(input, { force: true }), rm(clean, { force: true })]);
  await writeFile(keyFile, JSON.stringify(key));
  log(`Voices removed from match ${id} in ${Math.round((Date.now() - t0) / 1000)} s: ${out}`);
  return out;
}
