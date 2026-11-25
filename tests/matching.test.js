import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitGames, groupParts, pairCost, perVideo, suggest } from '../lib/matching.js';

const at = (hhmm) => Date.parse(`2026-10-24T${hhmm}:00Z`);
const min = 60;

test('videos recorded back to back are one match', () => {
  const groups = groupParts([
    { id: 3, recordedAt: at('10:40'), duration: 20 * min },
    { id: 1, recordedAt: at('09:10'), duration: 15 * min },
    { id: 2, recordedAt: at('09:27'), duration: 12 * min }, // 2 minutes after video 1 ended
    { id: 4, recordedAt: null, duration: 60 },
  ]);
  assert.deepEqual(groups.map((g) => g.ids), [[1, 2], [3]]);
  assert.equal(groups[0].end, at('09:39'));
});

test('a match running late costs its delay; starting early costs more; implausible is Infinity', () => {
  assert.equal(pairCost(at('09:20'), at('09:00')), 20);
  assert.equal(pairCost(at('08:50'), at('09:00')), 12.5);
  assert.equal(pairCost(at('14:00'), at('09:00')), Infinity);
  assert.equal(pairCost(at('09:20'), at('09:00'), 30, 40), 25);
});

test('suggest lines videos up with matches in order, one each', () => {
  const groups = groupParts([
    { id: 1, recordedAt: at('09:55'), duration: 25 * min },
    { id: 2, recordedAt: at('10:40'), duration: 30 * min },
  ]);
  const matches = [
    { id: 10, startsAt: at('09:30') },
    { id: 11, startsAt: at('10:00') },
    { id: 12, startsAt: at('11:30') },
  ];
  // Taking the nearest match for the first video (10:00) would leave the second
  // with none; running 25-40 minutes late explains both.
  assert.deepEqual(suggest(groups, matches).map((s) => [s.ids, s.matchId, s.lateMin]), [[[1], 10, 25], [[2], 11, 40]]);
});

test('a video with no plausible match is left out', () => {
  const groups = groupParts([{ id: 1, recordedAt: at('18:00'), duration: 600 }]);
  assert.deepEqual(suggest(groups, [{ id: 10, startsAt: at('09:00') }]), []);
  assert.deepEqual(suggest([], [{ id: 10, startsAt: at('09:00') }]), []);
});

test('a match takes one video: back-to-back videos are suggested game by game', () => {
  const suggestions = [{ ids: [1], matchId: 10, lateMin: 5 }, { ids: [2, 3, 4], matchId: 11, lateMin: 12 }, { ids: [5, 6], matchId: 12, lateMin: 0 }];
  const games = { 10: 2, 11: 2, 12: 3 };
  assert.deepEqual(perVideo(suggestions, (id) => games[id]).map((s) => [s.ids, s.matchId, s.game]), [
    [[1], 10, 0], // one video: the whole match
    [[2], 11, 1], [[3], 11, 2], // two games played: the third video isn't suggested
    [[5], 12, 1], [[6], 12, 2],
  ]);
});

test('the videos’ lengths choose between matches due at the same time, and say which game each shows', () => {
  // 12 s and 15 s a point: 25 points, then 34.
  const groups = groupParts([{ id: 1, recordedAt: at('09:45'), duration: 300 }, { id: 2, recordedAt: at('09:51'), duration: 500 }]);
  const matches = [
    { id: 10, startsAt: at('09:50'), games: [[13, 15], [11, 15]] },
    { id: 11, startsAt: at('09:50'), games: [[10, 15], [16, 18]] },
  ];
  const s = suggest(groups, matches);
  assert.deepEqual(s.map((x) => [x.matchId, x.slots]), [[11, [[1, 1], [2, 2]]]]);
  assert.ok(s[0].margin > 12);
  assert.deepEqual(perVideo(s, () => 3).map((x) => [x.ids, x.matchId, x.game]), [[[1], 11, 1], [[2], 11, 2]]);
  // Nothing to choose between them by time or length: hardly sure.
  const twins = suggest(groups, [{ ...matches[1], id: 20 }, { ...matches[1], id: 21 }]);
  assert.ok(twins[0].margin < 1);
});

test('games are fitted in order, leaving out a game not filmed or a clip too many', () => {
  const games = [[15, 8], [5, 15], [15, 13]]; // 23, 20 and 28 points
  assert.deepEqual(fitGames([322, 392], games).slots, [[0, 1], [1, 3]]);
  assert.deepEqual(fitGames([322, 120, 280, 392], games).slots, [[0, 1], [2, 2], [3, 3]]);
  assert.deepEqual(fitGames([71 * 14 + 180], games).slots, [[0, 0]]); // the whole match in one video
  assert.deepEqual(fitGames([290], games).slots, [[0, 2]]); // one game of it
  assert.deepEqual(fitGames([500], [[21, 15]]).slots, [[0, 0]]); // a match of one game
});
