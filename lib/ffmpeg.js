// Running FFmpeg and ffprobe. They are separate programs (winget install
// Gyan.FFmpeg), found in the settings' folder, the copy that comes with the
// desktop app (BADMINTON_VIDEO_FFMPEG), on PATH, or where winget puts them.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let found = null;

/** { ffmpeg, ffprobe } paths, or null when FFmpeg can't be found. */
export function findTools(folder = '') {
  if (found && found.folder === folder) return found.tools;
  const exe = process.platform === 'win32' ? '.exe' : '';
  const candidates = [];
  if (folder) candidates.push(folder);
  if (process.env.BADMINTON_VIDEO_FFMPEG) candidates.push(process.env.BADMINTON_VIDEO_FFMPEG);
  candidates.push(null); // PATH
  const local = process.env.LOCALAPPDATA;
  if (local) {
    candidates.push(join(local, 'Microsoft', 'WinGet', 'Links'));
    const pkgs = join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const p of readdirSync(pkgs).filter((n) => /^Gyan\.FFmpeg/i.test(n))) {
        for (const build of readdirSync(join(pkgs, p))) candidates.push(join(pkgs, p, build, 'bin'));
      }
    } catch { /* winget not used */ }
  }
  let tools = null;
  for (const dir of candidates) {
    const ffmpeg = dir ? join(dir, `ffmpeg${exe}`) : 'ffmpeg';
    const ffprobe = dir ? join(dir, `ffprobe${exe}`) : 'ffprobe';
    if (dir && !existsSync(ffmpeg)) continue;
    const ok = spawnSync(ffmpeg, ['-hide_banner', '-version'], { windowsHide: true }).status === 0;
    if (ok) {
      tools = { ffmpeg, ffprobe };
      break;
    }
  }
  found = { folder, tools };
  return tools;
}

let encoder = null;

/** 'h264_nvenc' when an NVIDIA encoder works on this PC, else 'libx264'. */
export function pickEncoder(tools) {
  if (encoder) return encoder;
  const test = spawnSync(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=0.5', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { windowsHide: true });
  encoder = test.status === 0 ? 'h264_nvenc' : 'libx264';
  return encoder;
}

/** ffprobe's JSON for a file. */
export function probe(tools, path) {
  return new Promise((resolve, reject) => {
    const p = spawn(tools.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `ffprobe exited ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Runs FFmpeg. `onProgress(seconds)` gets how far into the output it is.
 * `onData(buffer)` receives stdout when the output is piped ('-' / pipe:1).
 * Rejects with the last lines FFmpeg printed when it fails. `signal` stops it.
 */
export function run(tools, args, { cwd, onProgress, onData, signal } = {}) {
  return new Promise((resolve, reject) => {
    const withProgress = onProgress ? ['-progress', 'pipe:2', '-stats_period', '0.5', ...args] : args;
    const p = spawn(tools.ffmpeg, withProgress, { cwd, windowsHide: true });
    let err = '';
    const abort = () => p.kill();
    signal?.addEventListener('abort', abort, { once: true });
    if (onData) p.stdout.on('data', onData);
    p.stderr.on('data', (d) => {
      const text = String(d);
      if (onProgress) {
        for (const m of text.matchAll(/out_time_us=(\d+)/g)) onProgress(Number(m[1]) / 1e6);
      }
      err = (err + text.replace(/^(\w+=.*\n?)+/gm, '')).slice(-4000);
    });
    p.on('error', reject);
    p.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(Object.assign(new Error('Stopped'), { code: 'stopped' }));
      if (code !== 0) return reject(new Error(err.trim().split('\n').slice(-6).join('\n') || `ffmpeg exited ${code}`));
      resolve();
    });
  });
}
