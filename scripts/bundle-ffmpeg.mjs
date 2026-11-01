// Copies this PC's FFmpeg (ffmpeg.exe, ffprobe.exe and the build's licence
// notes) into build/ffmpeg/, which the installer ships as resources/ffmpeg.
// Run by `npm run dist`. FFMPEG_DIR picks a folder; otherwise the app's own
// search finds it (winget's Gyan.FFmpeg on this PC).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTools } from '../lib/ffmpeg.js';

const out = fileURLToPath(new URL('../build/ffmpeg/', import.meta.url));
const tools = findTools(process.env.FFMPEG_DIR ?? '');
// Found on PATH, it is just 'ffmpeg': `where` gives its folder.
const exe = tools && (existsSync(tools.ffmpeg) ? tools.ffmpeg : spawnSync('where', [tools.ffmpeg], { encoding: 'utf8' }).stdout?.split(/\r?\n/)[0]);
if (!exe || !existsSync(exe)) {
  console.error('FFmpeg not found: install it (winget install Gyan.FFmpeg) or set FFMPEG_DIR to the folder holding ffmpeg.exe.');
  process.exit(1);
}
const bin = dirname(exe);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const name of ['ffmpeg.exe', 'ffprobe.exe']) copyFileSync(join(bin, name), join(out, name));
// Gyan's builds are GPL v3: the licence and the README (with the source links) go with them.
for (const name of ['LICENSE', 'README.txt']) {
  const file = join(bin, '..', name);
  if (existsSync(file)) copyFileSync(file, join(out, name === 'LICENSE' ? 'LICENSE.txt' : name));
}
console.log(`FFmpeg from ${bin} copied to ${out}`);
