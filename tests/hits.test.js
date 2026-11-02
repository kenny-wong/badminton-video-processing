import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findHits, frameLevels } from '../lib/hits.js';

/** Frame levels (dB) for `seconds` of hall noise with loud hits at the given times. */
function levels(seconds, hits, { noise = 40, hit = 62 } = {}) {
  const out = new Float32Array(Math.round(seconds * 100));
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] = noise + (seed / 2147483647) * 4; // a little flutter
  }
  for (const t of hits) {
    const f = Math.round(t * 100);
    out[f] = hit;
    if (f + 1 < out.length) out[f + 1] = hit - 8;
  }
  return out;
}

test('frameLevels turns 16-bit samples into dB per frame', () => {
  const quiet = new Int16Array(320);
  const loud = Int16Array.from({ length: 320 }, (_, i) => (i % 2 ? 10000 : -10000));
  assert.equal(frameLevels(quiet).length, 2);
  assert.equal(frameLevels(quiet)[0], 0);
  assert.ok(Math.abs(frameLevels(loud)[0] - 80) < 0.1);
});

test('findHits picks out sharp jumps above the recent level', () => {
  const times = [3, 4.1, 5.0, 6.2, 15, 16.1];
  const found = findHits(levels(20, times));
  assert.deepEqual(found.map((t) => Math.round(t * 10) / 10), times);
  // A loud noise that carries on (a whistle, applause) is not a hit.
  const steady = levels(20, []).map((v, i) => (i > 500 && i < 900 ? 65 : v));
  assert.deepEqual(findHits(steady), []);
});

test('lower sensitivity ignores quieter clicks', () => {
  const soft = levels(10, [3, 4, 5], { hit: 53 });
  assert.equal(findHits(soft, { sensitivity: 8 }).length, 3);
  assert.equal(findHits(soft, { sensitivity: 2 }).length, 0);
});

test('sound levels for the timeline keep the loudest of each tenth of a second', async () => {
  const { downsample, LEVEL_STEP } = await import('../lib/levels.js');
  assert.equal(LEVEL_STEP, 0.1);
  const levels = Float32Array.from({ length: 25 }, (_, i) => (i === 13 ? 60.04 : 20));
  assert.deepEqual(downsample(levels), [20, 60, 20]);
});
