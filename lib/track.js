// Shuttle tracking with TrackNetV3 (MIT licence, github.com/qaz812345/TrackNetV3),
// run as a separate Python program on the GPU. It isn't part of the repo: the
// set-up in Settings (lib/analysis-setup.js) puts its code in vendor/TrackNetV3,
// its trained models in ckpts and PyTorch in .venv, in the tools folder.
//
// The match part of the video is first shrunk to 30 frames a second at 640 px
// wide (TrackNet works at 512×288 anyway), which halves the work for 60 fps
// phone video. The shuttle's position in each frame where it is seen is saved
// as track.json in the match's work folder.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run, pickEncoder } from './ffmpeg.js';
import { loadMatch, sourceFor } from './pipeline.js';
import { nowIso } from './db.js';
import { notSetUp, pythonIn, SCRIPTS, toolsFolder } from './analysis.js';

export const TRACK_FPS = 30;
const TRACK_WIDTH = 640;

/** Where the tracker's parts are, and whether they are all there. */
export function tracker(root, scripts = SCRIPTS) {
  const python = pythonIn(root);
  const vendor = join(root, 'vendor', 'TrackNetV3');
  const parts = {
    python,
    runner: join(scripts, 'run_tracknet.py'), // runs predict.py without DataLoader worker processes (see that file)
    predict: join(vendor, 'predict.py'),
    tracknet: join(root, 'ckpts', 'TrackNet_best.pt'),
    inpaintnet: join(root, 'ckpts', 'InpaintNet_best.pt'),
  };
  return { ...parts, vendor, ready: Object.values(parts).every((p) => existsSync(p)) };
}

/**
 * TrackNetV3's CSV (Frame,Visibility,X,Y in pixels) as the sightings to keep:
 * [[frame, x, y], ...] for frames where the shuttle was seen.
 */
export function parseTrackCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const head = lines.shift()?.split(',').map((s) => s.trim()) ?? [];
  const col = (name) => head.indexOf(name);
  const [f, vis, x, y] = ['Frame', 'Visibility', 'X', 'Y'].map(col);
  if ([f, vis, x, y].some((i) => i < 0)) return [];
  const out = [];
  for (const line of lines) {
    const c = line.split(',');
    if (Number(c[vis]) !== 1) continue;
    const point = [Number(c[f]), Number(c[x]), Number(c[y])];
    if (point.every(Number.isFinite)) out.push(point);
  }
  return out;
}

/** Saved tracking as points in the match video's time: [{ t, x, y }] with x, y as fractions of the picture. */
export function trackPoints(track) {
  if (!track?.points) return [];
  return track.points.map(([f, x, y]) => ({ t: track.offset + f / track.fps, x: x / track.width, y: y / track.height }));
}

export async function readTrack(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Seconds as "4:05". */
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A tqdm progress line ("37%|###  | 260/700 [01:02<01:45, 4.19it/s]"). */
const isProgress = (line) => /\d+it\b|\|\s*\d+\/\d+\s*\[/.test(line);

/**
 * Why the tracker (or another Python program) failed, from the end of its
 * output: a short `message` (the Python error line, or the exit code) and a
 * longer `detail` for the page.
 */
export function trackFailure(output, code, logFile = null, { what = 'Shuttle tracking', program = 'TrackNetV3' } = {}) {
  const lines = String(output).split(/[\r\n]+/).map((l) => l.trimEnd()).filter((l) => l.trim() && !isProgress(l));
  const error = [...lines].reverse().find((l) => /^\w+(\.\w+)*(Error|Exception|Interrupt)\b/.test(l.trim()));
  const how = code === null ? 'was ended by Windows or another program' : `exited with code ${code}`;
  const crash = code === 3221225477 ? ' (an access violation: the program crashed)' : code === 3221225725 ? ' (stack overflow)' : code === 3221226505 ? ' (a crash in a native library)' : '';
  return {
    message: `${what} failed: ${error ? error.trim() : `${program} ${how}${crash}`}`,
    detail: [`${program} ${how}${crash}.`, logFile ? `Full log: ${logFile}` : null, '', 'Last lines of its output:', ...lines.slice(-30)].filter((l) => l !== null).join('\n'),
  };
}

/** Runs a program (`t.python`, with `t.env` added), logging its output; `what` and `program` name it in messages. */
export function runPython(t, args, { cwd, signal, onLine, log, logFile, what = 'Shuttle tracking', program = 'TrackNetV3' }) {
  return new Promise((resolve, reject) => {
    log(`Running: "${t.python}" ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n  in ${cwd}`);
    const p = spawn(t.python, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1', ...t.env } });
    log(`${program} started (process ${p.pid})`);
    let tail = '';
    let lastProgress = 0;
    const abort = () => p.kill();
    signal?.addEventListener('abort', abort, { once: true });
    const read = (d) => {
      const text = String(d);
      tail = (tail + text).slice(-8000);
      for (const line of text.split(/[\r\n]+/)) {
        if (!line.trim()) continue;
        onLine?.(line);
        // Every line goes in the log, except progress bars: one every 10 s is enough to see the speed.
        if (!isProgress(line)) log(line);
        else if (Date.now() - lastProgress > 10000) {
          lastProgress = Date.now();
          log(line.trim());
        }
      }
    };
    p.stdout.on('data', read);
    p.stderr.on('data', read);
    p.on('error', (err) => {
      log(`Couldn’t start Python: ${err.message}`);
      reject(err);
    });
    p.on('close', (code, sig) => {
      signal?.removeEventListener('abort', abort);
      log(`${program} ended: exit code ${code}${sig ? `, signal ${sig}` : ''}`);
      if (signal?.aborted) return reject(Object.assign(new Error('Stopped'), { code: 'stopped' }));
      if (code !== 0) {
        const { message, detail } = trackFailure(tail, code, logFile, { what, program });
        return reject(Object.assign(new Error(message), { detail }));
      }
      resolve();
    });
  });
}

/** Tracks the shuttle through the marked match (or the whole video) and saves track.json. */
export async function trackMatch(db, tools, settings, id, { signal, job }) {
  const t = tracker(toolsFolder(settings));
  if (!t.ready) throw new Error(notSetUp('Shuttle tracking'));
  const loaded = loadMatch(db, id);
  const source = sourceFor(loaded);
  if (!source.ready) throw new Error('The match video isn’t ready');
  const from = loaded.match.matchStart ?? 0;
  const to = loaded.match.matchEnd ?? source.duration;
  const dir = join(settings.outputFolder, '.work', `match-${id}`, 'track');
  await mkdir(dir, { recursive: true });
  job.logFile = join(dir, 'tracking.log');
  await writeFile(job.logFile, '');
  const log = (text) => job.log(text);
  log(`Tracking match ${id}: ${source.path}, ${mmss(from)} to ${mmss(to)} (${Math.round(to - from)} s)`);
  const input = join(dir, 'input.mp4');
  job.message = 'Preparing the video for tracking';
  const encoder = pickEncoder(tools);
  const t0 = Date.now();
  await run(tools, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', String(from), '-to', String(to), '-i', source.path,
    '-an', '-vf', `fps=${TRACK_FPS},scale=${TRACK_WIDTH}:-2,format=yuv420p`,
    ...(encoder === 'h264_nvenc' ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']), input], {
    signal, onProgress: (s) => { job.progress = Math.min(0.1, (s / Math.max(1, to - from)) * 0.1); },
  }).catch((err) => {
    log(`Preparing the video failed: ${err.message}`);
    throw err;
  });
  const frames = Math.round((to - from) * TRACK_FPS);
  log(`Prepared ${input} (${frames} frames at ${TRACK_FPS} fps, ${encoder}) in ${Math.round((Date.now() - t0) / 1000)} s`);
  job.message = 'Tracking the shuttle (TrackNetV3 on the GPU): starting';
  let stage = 0;
  let stageStart = Date.now();
  let lastCount = 0;
  await runPython(t, [t.runner, t.vendor, '--video_file', input.replace(/\\/g, '/'), '--tracknet_file', t.tracknet, '--inpaintnet_file', t.inpaintnet,
    '--save_dir', dir, '--large_video', '--batch_size', '16'], {
    cwd: t.vendor,
    signal,
    log,
    logFile: job.logFile,
    onLine: (line) => {
      // tqdm counts batches of 16 overlapping frames; TrackNet first, then the trajectory rectification.
      // "260/700 [..., 4.19it/s]" when it knows the total, "260it [..., 4.19it/s]" when it doesn't.
      const it = /\|\s*(\d+)\/\d+/.exec(line) ?? /(?<![\d.])(\d+)it\b/.exec(line);
      // "Video length" starts TrackNet; a count starting again from the beginning is InpaintNet's pass.
      const n = it ? Number(it[1]) : null;
      if (/Video length/i.test(line) || (n !== null && n < lastCount)) {
        stage += 1;
        stageStart = Date.now();
      }
      if (n !== null) lastCount = n;
      if (it) {
        const done = Math.min(1, (Number(it[1]) * 16) / Math.max(1, frames));
        job.progress = stage <= 1 ? 0.1 + done * 0.8 : 0.9 + done * 0.09;
        const spent = (Date.now() - stageStart) / 1000;
        const left = done > 0.02 ? ` · about ${mmss((spent / done) * (1 - done))} left` : '';
        job.message = stage <= 1
          ? `Tracking the shuttle: frame ${Math.min(frames, Number(it[1]) * 16).toLocaleString('en-GB')} of ${frames.toLocaleString('en-GB')} · ${mmss(spent)} so far${left}`
          : `Tidying the shuttle’s path${left}`;
      }
    },
  });
  const csvPath = join(dir, 'input_ball.csv');
  if (!existsSync(csvPath)) {
    throw Object.assign(new Error('Shuttle tracking failed: TrackNetV3 finished without writing its results'), { detail: `Expected ${csvPath}\nFull log: ${job.logFile}` });
  }
  const csv = await readFile(csvPath, 'utf8');
  const points = parseTrackCsv(csv);
  const track = { fps: TRACK_FPS, offset: from, width: TRACK_WIDTH, height: Math.round((TRACK_WIDTH * (source.height ?? 1080)) / (source.width ?? 1920) / 2) * 2, frames, points };
  const out = join(dir, 'track.json');
  await writeFile(out, JSON.stringify(track));
  db.prepare('UPDATE matches SET track_path = ?, tracked_at = ? WHERE id = ?').run(out, nowIso(), id);
  return { frames, seen: points.length };
}
