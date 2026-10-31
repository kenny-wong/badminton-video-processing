import assert from 'node:assert/strict';
import { test } from 'node:test';

import { landings, matchStats, shotsIn, statsLine } from '../public/shared/stats.js';
import { replay } from '../public/shared/score.js';
import { courtMapping } from '../public/shared/court.js';
import { assScript, scoreSpans } from '../lib/overlay.js';
import { bannerText, cleanBoard } from '../public/shared/board.js';
import { endLines } from '../lib/cards.js';

const F11 = { points: 11, setting: false, bestOf: 3 };
const rally = (i, winner, len = 5) => ({ start: i * 20, end: i * 20 + len, winner });

test('shotsIn counts the hits inside a rally', () => {
  const hits = [1, 2.5, 3, 7, 7.5, 12];
  assert.equal(shotsIn(hits, { start: 2, end: 7.2 }), 3);
  assert.equal(shotsIn(hits, { start: 20, end: 30 }), 0);
  assert.equal(shotsIn(null, { start: 0, end: 1 }), null);
});

test('matchStats: points on serve and receive, runs, leads and comebacks', () => {
  // Game 1 to 11: B goes 0-4 up, then A wins 11 in a row. Game 2: B 1-0.
  const winners = ['b', 'b', 'b', 'b', ...Array(11).fill('a'), 'b'];
  const rallies = winners.map((w, i) => rally(i, w, i === 6 ? 25 : 5));
  const { steps } = replay(rallies, F11);
  const s = matchStats(rallies, steps, { hits: [100.5, 101, 102, 121, 122] });
  assert.equal(s.rallies, 16);
  assert.deepEqual(s.points, [11, 5]);
  // A served first and lost it; B served the next 4 (won 3); A served the rest of game 1 and, having won it, game 2's first.
  assert.deepEqual(s.serve, { a: { won: 10, of: 12 }, b: { won: 3, of: 4 } });
  assert.deepEqual(s.receive, { a: { won: 1, of: 4 }, b: { won: 2, of: 12 } });
  assert.deepEqual(s.longestRun, { side: 'a', points: 11, game: 1 });
  assert.deepEqual(s.longestRally, { index: 6, seconds: 25 });
  assert.equal(s.mostShots.shots, 3); // rally 5 (100-105)
  const [g1, g2] = s.games;
  assert.deepEqual([g1.score, g1.winner, g1.biggestLead, g1.runs, g1.comeback], [[11, 4], 'a', [7, 4], [11, 4], 4]);
  assert.deepEqual(g1.lead.map((x) => x.lead).slice(0, 6), [0, -1, -2, -3, -4, -3]);
  assert.equal(g2.score, null);
  assert.deepEqual(g2.lead.map((x) => x.lead), [0, -1]);
  assert.equal(statsLine(s, ['LEE', 'HO']), 'Longest rally 3 shots · Best run LEE 11 points');
});

test('landings put the last sighting of each rally on the court', () => {
  // Corners as if the camera looked straight down at a court filling the picture.
  const map = courtMapping([[0, 1], [1, 1], [1, 0], [0, 0]]);
  const rallies = [{ start: 0, end: 4, winner: 'a' }, { start: 10, end: 14, winner: 'b' }, { start: 20, end: 24, winner: null }];
  const points = [[1, 0.5, 0.5], [3.9, 0.25, 0.1], [11, 0.5, 0.9], [14.4, 0.75, 0.75], [21, 0.5, 0.5]];
  assert.deepEqual(landings(rallies, points, map.toCourt), [
    { index: 0, winner: 'a', x: 1.53, y: 12.06 },
    { index: 1, winner: 'b', x: 4.57, y: 3.35 },
  ]);
  assert.deepEqual(landings(rallies, points, null), []);
});

test('a long rally gets a banner when chosen, and the end card can carry a stats line', () => {
  assert.equal(cleanBoard({ longRally: 3 }).longRally, 8);
  assert.equal(cleanBoard({ longRally: 0 }).longRally, 0);
  assert.equal(bannerText({ kind: 'rally', shots: 24 }, ['A', 'B']), '24-SHOT RALLY');
  const rallies = [rally(0, 'a'), rally(1, 'b')];
  const { steps } = replay(rallies);
  const spans = scoreSpans(rallies, steps, 60, null, { shots: [25, 4], longRally: 20 });
  assert.deepEqual(spans.map((s) => s.event?.kind ?? null), [null, 'rally', null]);
  const ass = assScript({ width: 1280, height: 720, teams: [['Amy Lee'], ['Cat Ho']], spans, style: { longRally: 20 } });
  assert.match(ass, /\}25-SHOT RALLY\n/);
  const lines = endLines({ tournament: { name: 'Example Open' }, match: { draw: 'WS', round: 'F', game: 0, teamA: ['Amy Lee'], teamB: ['Cat Ho'], winner: 1 }, games: [[21, 3], [21, 5]], extra: 'Longest rally 25 shots' });
  assert.ok(lines.some((l) => l.text === 'LONGEST RALLY 25 SHOTS'));
});
