import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanRallies, mergeWinners } from '../public/shared/score.js';
import { outputPath, videoTitle } from '../lib/naming.js';
import { plan } from '../lib/render.js';
import { thumbTime } from '../lib/thumbs.js';

const tournament = { name: 'Example Junior Gold', start: '2026-10-24' };
const match = { date: '2026-10-24', time: '09:40', draw: 'XD U15 - Group A', round: 'Round 1', teamA: ['Amy Lee'], teamB: ['Cat Ho'] };

test('favourite marks survive saving and finding rallies again', () => {
  assert.deepEqual(cleanRallies([{ start: 1, end: 4, winner: 'a', fav: true }, { start: 6, end: 9, winner: 'b', fav: 'yes' }]),
    [{ start: 1, end: 4, winner: 'a', fav: true }, { start: 6, end: 9, winner: 'b' }]);
  const merged = mergeWinners([{ start: 0, end: 5 }, { start: 10, end: 15 }], [{ start: 1, end: 4, winner: null, fav: true }]);
  assert.deepEqual(merged, [{ start: 0, end: 5, winner: null, fav: true }, { start: 10, end: 15, winner: null }]);
});

test('highlights get their own title and file name', () => {
  assert.match(videoTitle({ tournament, match, games: [[21, 3]], highlights: true }), /^Highlights: Example Junior Gold/);
  assert.equal(outputPath({ tournament, match, highlights: true })[2], '0940 XD U15 - Group A Round 1 - Lee v Ho (highlights).mp4');
});

test('highlights keep each favourite rally as its own clip', () => {
  const favs = [{ start: 10, end: 20 }, { start: 23, end: 30 }];
  assert.equal(plan(favs, 100, { pre: 2, post: 2, mergeGap: 0 }).length, 1); // overlapping clips still join
  assert.equal(plan([{ start: 10, end: 20 }, { start: 26, end: 30 }], 100, { pre: 2, post: 2, mergeGap: 0 }).length, 2);
});

test('thumbnails are taken a minute into the match, or a tenth of a short video', () => {
  assert.equal(thumbTime(null, 2400), 60);
  assert.equal(thumbTime(300, 2400), 360);
  assert.equal(thumbTime(null, 120), 12);
  assert.equal(thumbTime(null, 0.5), 0);
  assert.equal(thumbTime(null, null), 0);
});
