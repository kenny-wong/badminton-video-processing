import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupParts, pairCost, suggest } from '../lib/matching.js';

const at = (hhmm) => Date.parse(`2026-10-24T${hhmm}:00Z`);
const min = 60;

test('videos recorded back to back are parts of one match', () => {
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
  assert.equal(pairCost(at('08:50'), at('09:00')), 30);
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
