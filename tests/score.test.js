import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkResult, cleanFormat, cleanRallies, defaultServer, gameOver, gamesText, inferFormat, mergeWinners, replay, scoreAt, serviceCourt } from '../public/shared/score.js';

/** Rallies one second apart from a string of winners: 'aab' -> a, a, b. */
const rallies = (winners) => [...winners].map((w, i) => ({ start: i * 10, end: i * 10 + 5, winner: w === 'a' || w === 'b' ? w : w === 'l' ? 'let' : null }));
const game = (a, b, lastTo = a > b ? 'a' : 'b') => {
  // a points to A and b to B, ending with the winner's last point.
  const loser = lastTo === 'a' ? 'b' : 'a';
  const wins = lastTo === 'a' ? a : b;
  const losses = lastTo === 'a' ? b : a;
  let s = '';
  let w = 0;
  let l = 0;
  while (w < wins - 1 || l < losses) {
    if (l < losses && (l <= w || w >= wins - 1)) { s += loser; l += 1; } else { s += lastTo; w += 1; }
  }
  return s + lastTo;
};

test('gameOver follows 21 points with setting to 30, and other formats', () => {
  assert.equal(gameOver([21, 19]), 'a');
  assert.equal(gameOver([20, 21]), null);
  assert.equal(gameOver([22, 20]), 'a');
  assert.equal(gameOver([29, 30]), 'b');
  assert.equal(gameOver([15, 13], { points: 15 }), 'a');
  assert.equal(gameOver([21, 20], { points: 15 }), 'a'); // capped at 21
  assert.equal(gameOver([21, 20], { points: 21, setting: false }), 'a');
});

test('replay builds games, a winner, server and events from rally winners', () => {
  const r = rallies(game(21, 15) + game(18, 21) + game(21, 19));
  const out = replay(r);
  assert.deepEqual(out.games, [[21, 15], [18, 21], [21, 19]]);
  assert.equal(out.winner, 'a');
  assert.equal(out.steps.filter((s) => s.event === 'game').length, 2);
  assert.equal(out.steps.at(-1).event, 'match');
  assert.ok(out.steps.some((s) => s.event === 'interval'));
  // The winner of a rally serves the next; the game winner serves the next game.
  assert.equal(out.steps[0].before.server, 'a');
  assert.equal(out.steps[0].after.server, r[0].winner);
});

test('lets, untagged rallies and rallies after the end count for nothing', () => {
  const r = rallies(`al${'?'}b`);
  const out = replay(r);
  assert.deepEqual(out.games, [[1, 1]]);
  assert.deepEqual(out.steps.map((s) => s.counted), [true, false, false, true]);
  assert.deepEqual(out.steps.map((s) => s.reason ?? null), [null, 'let', 'untagged', null]);
  const oneGame = replay(rallies(`${game(21, 3)}a`), { points: 21, bestOf: 1 });
  assert.equal(oneGame.winner, 'a');
  assert.equal(oneGame.steps.at(-1).reason, 'afterMatch');
});

test('a first server of b and the service court', () => {
  const out = replay(rallies('b'), undefined, 'b');
  assert.equal(out.steps[0].before.server, 'b');
  assert.equal(serviceCourt({ points: [0, 0], server: 'a' }), 'right');
  assert.equal(serviceCourt({ points: [3, 4], server: 'a' }), 'left');
  assert.equal(serviceCourt({ points: [3, 4], server: 'b' }), 'right');
});

test('scoreAt shows the score after the last rally that has ended', () => {
  const r = rallies('aab');
  const { steps } = replay(r);
  assert.deepEqual(scoreAt(r, steps, 0).points, [0, 0]);
  assert.deepEqual(scoreAt(r, steps, 5).points, [1, 0]);
  assert.deepEqual(scoreAt(r, steps, 26).points, [2, 1]);
});

test('checkResult finds the first game that differs from the official result', () => {
  assert.deepEqual(checkResult([[21, 15]], [[21, 15]]), { ok: true, game: null });
  assert.deepEqual(checkResult([[21, 15], [19, 21]], [[21, 15], [20, 22]]), { ok: false, game: 1 });
  assert.deepEqual(checkResult([[21, 15]], [[21, 15], [21, 10]]), { ok: false, game: 1 });
  assert.deepEqual(checkResult([[5, 3]], []), { ok: true, game: null });
});

test('inferFormat guesses 15 or 11 points and single games from the result', () => {
  assert.deepEqual(inferFormat([[21, 15], [21, 19]], true), { points: 21, setting: true, bestOf: 3 });
  assert.deepEqual(inferFormat([[15, 9], [21, 20]], true), { points: 15, setting: true, bestOf: 3 });
  assert.deepEqual(inferFormat([[11, 4]], true), { points: 11, setting: true, bestOf: 1 });
  assert.deepEqual(inferFormat([[21, 4]], false), { points: 21, setting: true, bestOf: 3 }); // not finished yet
  assert.deepEqual(cleanFormat({ points: 17, bestOf: 5 }), { points: 21, setting: true, bestOf: 3 });
});

test('cleanRallies keeps valid rallies in time order and drops bad winners', () => {
  assert.deepEqual(cleanRallies([{ start: 9, end: 12, winner: 'x' }, { start: 1, end: 3.333, winner: 'b' }, { start: 5, end: 4 }, null]),
    [{ start: 1, end: 3.33, winner: 'b' }, { start: 9, end: 12, winner: null }]);
  assert.deepEqual(cleanRallies('nope'), []);
});

test('mergeWinners gives found rallies the winner of the tagged rally they overlap most', () => {
  const found = [{ start: 0, end: 6 }, { start: 10, end: 16 }, { start: 30, end: 35 }];
  const tagged = [{ start: 1, end: 5, winner: 'a' }, { start: 9, end: 12, winner: 'b' }, { start: 12, end: 17, winner: 'a' }];
  assert.deepEqual(mergeWinners(found, tagged).map((r) => r.winner), ['a', 'a', null]);
  assert.equal(gamesText([[21, 18], [15, 21]]), '21-18 15-21');
});

test('a game’s own video starts with A serving in games 1 and 3, B in game 2', () => {
  assert.deepEqual([1, 2, 3].map(defaultServer), ['a', 'b', 'a']);
  assert.equal(defaultServer(0), 'a');
});
