import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apply, cleanCorners, COURT, courtLines, courtMapping, homography } from '../public/shared/court.js';
import { endOf, landing, serveEnd, suggestWinners } from '../lib/winners.js';

// A camera behind the near baseline: the near corners wide at the bottom, the far ones narrow higher up.
const CORNERS = [[0.15, 0.9], [0.85, 0.9], [0.65, 0.35], [0.35, 0.35]];
const { toCourt, toPicture } = courtMapping(CORNERS);
const at = (x, y) => toPicture && apply(toPicture, [x, y]); // court metres -> picture

test('the homography maps the clicked corners onto the court and back', () => {
  for (const [i, [x, y]] of [[0, 0], [COURT.width, 0], [COURT.width, COURT.length], [0, COURT.length]].entries()) {
    const [u, v] = apply(toCourt, CORNERS[i]);
    assert.ok(Math.abs(u - x) < 1e-9 && Math.abs(v - y) < 1e-9);
  }
  const [u, v] = at(3.05, COURT.net);
  assert.ok(u > 0.49 && u < 0.51 && v > 0.35 && v < 0.9); // the net's middle is between the baselines
  assert.equal(homography([[0, 0], [1, 1], [2, 2], [3, 3]], [[0, 0], [1, 0], [1, 1], [0, 1]]), null); // corners in a line
  assert.equal(courtMapping([[0, 0]]), null);
  assert.deepEqual(cleanCorners(CORNERS), CORNERS);
  assert.equal(cleanCorners([[0, 0], [9, 9], [1, 1], [2, 2]]), null);
  assert.equal(courtLines().length, 13);
});

/** Shuttle sightings every 1/30 s along straight paths through picture points: [[t, x, y], ...] corners of the path. */
function path(...knots) {
  const out = [];
  for (let k = 0; k < knots.length - 1; k++) {
    const [t0, x0, y0] = knots[k];
    const [t1, x1, y1] = knots[k + 1];
    for (let t = t0; t < t1; t += 1 / 30) {
      const f = (t - t0) / (t1 - t0);
      out.push({ t: Math.round(t * 1000) / 1000, x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f });
    }
  }
  return out;
}

test('a serve going up the picture came from the near end, one coming down from the far end', () => {
  const near = path([10, 0.5, 0.8], [11, 0.5, 0.42], [12, 0.5, 0.7]);
  assert.equal(serveEnd(near, { start: 10, end: 14 }).end, 'near');
  const far = path([20, 0.5, 0.38], [21, 0.5, 0.8]);
  assert.equal(serveEnd(far, { start: 20, end: 24 }).end, 'far');
  assert.equal(serveEnd([], { start: 20, end: 24 }), null);
});

test('the landing says which end lost, and an out shot loses for the end that hit it', () => {
  const [nx, ny] = at(3, 3); // near half, in
  assert.deepEqual(landing([{ t: 13.9, x: nx, y: ny }], { start: 10, end: 14 }, toCourt).lost, 'near');
  const [fx, fy] = at(3, 11); // far half, in
  assert.equal(landing([{ t: 13.9, x: fx, y: fy }], { start: 10, end: 14 }, toCourt).lost, 'far');
  const [ox, oy] = at(3, 14.5); // beyond the far baseline: the near end hit it out
  const out = landing([{ t: 13.9, x: ox, y: oy }], { start: 10, end: 14 }, toCourt);
  assert.deepEqual([out.lost, out.out], ['near', true]);
  assert.equal(landing([{ t: 5, x: nx, y: ny }], { start: 10, end: 14 }, toCourt), null); // last seen long before the end
  assert.equal(landing([{ t: 13.9, x: nx, y: ny }], { start: 10, end: 14 }, null), null);
});

test('ends change after a game and at 11 in the deciding game', () => {
  const rules = { points: 21, setting: true, bestOf: 3 };
  const start = { games: [], points: [0, 0] };
  assert.equal(endOf('a', { games: [], points: [5, 5] }, start, 'a', rules), 'near');
  assert.equal(endOf('a', { games: [[21, 10]], points: [0, 0] }, start, 'a', rules), 'far');
  assert.equal(endOf('a', { games: [[21, 10], [10, 21]], points: [10, 3] }, start, 'a', rules), 'near');
  assert.equal(endOf('a', { games: [[21, 10], [10, 21]], points: [11, 3] }, start, 'a', rules), 'far');
  assert.equal(endOf('b', { games: [[21, 10], [10, 21]], points: [11, 3] }, start, 'a', rules), 'near');
  // Video starting in game 3 after the change of ends: no further change counted.
  const late = { games: [[21, 10], [10, 21]], points: [12, 8] };
  assert.equal(endOf('a', { games: late.games, points: [15, 9] }, late, 'a', rules), 'near');
});

test('winners come from the next serve, confirmed by the landing', () => {
  // A at the near end. Rally 1: A wins (A serves rally 2 from the near end; rally 1 lands in the far half).
  // Rally 2: B wins (B serves rally 3 from the far end; rally 2 lands in the near half).
  const [fx, fy] = at(3, 11);
  const [nx, ny] = at(3, 3);
  const points = [
    ...path([10, 0.5, 0.8], [11, 0.5, 0.45], [13.5, fx, fy]),
    ...path([20, 0.5, 0.8], [21, 0.5, 0.45], [23.5, nx, ny]),
    ...path([30, 0.5, 0.38], [31, 0.5, 0.8], [33, 0.5, 0.6]),
  ];
  const rallies = [{ start: 10, end: 14, winner: null }, { start: 20, end: 24, winner: null }, { start: 30, end: 34, winner: null }];
  const s = suggestWinners({ rallies, points, toCourt, nearAtStart: 'a', format: { points: 21 }, start: { games: [], points: [0, 0] } });
  assert.deepEqual(s.map((x) => x.winner), ['a', 'b', 'b']); // rally 3 has no next serve: its landing (near half... after B's serve, last seen at 0.6) decides
  assert.deepEqual(s.slice(0, 2).map((x) => x.sure), [true, true]);
  assert.equal(s[2].sure, false);
  // A tagged winner is kept, and the same clues with B at the near end give the opposite teams.
  const flipped = suggestWinners({ rallies: [{ ...rallies[0], winner: 'b' }, ...rallies.slice(1)], points, toCourt, nearAtStart: 'b', format: { points: 21 }, start: { games: [], points: [0, 0] } });
  assert.deepEqual(flipped.slice(0, 2).map((x) => x.winner), ['b', 'a']);
  assert.equal(flipped[0].sure, true);
});
