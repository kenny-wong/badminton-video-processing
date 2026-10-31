// Finding rallies in a match video by sound: FFmpeg decodes the audio,
// high-passed (shuttle hits are sharp clicks) at 16 kHz mono, and lib/hits.js
// turns it into hits and rallies.

import { run } from './ffmpeg.js';
import { findHits, frameLevels, groupRallies } from './hits.js';

const RATE = 16000;
const FRAME = 160; // 10 ms

/** Loudness per 10 ms of the high-passed sound track, as a Float32Array of dB. */
export async function soundLevels(tools, src, { duration, onProgress, signal } = {}) {
  const levels = [];
  let carry = Buffer.alloc(0);
  const bytesPerFrame = FRAME * 2;
  await run(tools, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', String(RATE),
    '-af', 'highpass=f=1800,highpass=f=1800,lowpass=f=7500', '-f', 's16le', 'pipe:1'], {
    signal,
    onProgress: duration && onProgress ? (s) => onProgress(Math.min(1, s / duration)) : undefined,
    onData: (chunk) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const whole = Math.floor(buf.length / bytesPerFrame) * bytesPerFrame;
      // Copied so the samples start on an even byte, as Int16Array needs.
      const samples = new Int16Array(Uint8Array.prototype.slice.call(buf, 0, whole).buffer);
      for (const v of frameLevels(samples, FRAME)) levels.push(v);
      carry = buf.subarray(whole);
    },
  });
  return Float32Array.from(levels);
}

/** Suggested rallies for a match video. */
export async function findRallies(tools, src, { duration, sensitivity = 5, onProgress, signal } = {}) {
  const levels = await soundLevels(tools, src, { duration, onProgress, signal });
  const hits = findHits(levels, { sensitivity });
  return { hits: hits.length, rallies: groupRallies(hits, { duration: duration ?? levels.length / 100 }) };
}
