import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apply, cleanCorners, COURT, courtLines, courtMapping, homography } from '../public/shared/court.js';
import { endOf } from '../public/shared/score.js';

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
