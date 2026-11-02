import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, courtMapping } from '../public/shared/court.js';
import { courtOutline, overCourt, shuttleInPlay } from '../public/shared/shuttle.js';

// A camera well behind the near baseline, so the court (and the metre around it) leaves room on either side.
const CORNERS = [[0.3, 0.85], [0.7, 0.85], [0.6, 0.4], [0.4, 0.4]];
const { toPicture } = courtMapping(CORNERS);
const outline = courtOutline(CORNERS);

test('a shuttle above the court counts, one beside it or below its near edge doesn’t', () => {
  const [mx, my] = apply(toPicture, [3, 6.7]); // the middle of the net on the floor
  assert.ok(overCourt([mx, my], outline));
  assert.ok(overCourt([mx, 0.05], outline)); // high in the air above it
  assert.ok(!overCourt([0.02, my], outline)); // well to the side: the next court
  assert.ok(!overCourt([mx, 0.99], outline)); // below the near edge (and its metre)
  const [ox, oy] = apply(toPicture, [6.6, 4]); // just out over the sideline: still counts
  assert.ok(overCourt([ox, oy], outline));
});

/** Sightings every 1/30 s: [t, x, y]. */
const series = (from, to, at) => {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += 1 / 30) out.push([Math.round(t * 1000) / 1000, ...at(t)]);
  return out;
};

test('a shuttle lying still on the floor isn’t shown; one in flight is', () => {
  const flying = series(0, 1, (t) => [0.3 + t * 0.3, 0.6 - t * 0.2]);
  const lying = series(1.1, 3, () => [0.62, 0.42]);
  const shown = shuttleInPlay([...flying, ...lying], CORNERS);
  assert.equal(shown.filter(([t]) => t <= 1).length, flying.length);
  assert.ok(shown.filter(([t]) => t > 1.5).length === 0); // gone once it has lain still
});

test('beside the court is left out when the court is marked; without it only stillness counts', () => {
  const nextCourt = series(0, 1, (t) => [0.02, 0.5 - t * 0.2]);
  assert.equal(shuttleInPlay(nextCourt, CORNERS).length, 0);
  assert.equal(shuttleInPlay(nextCourt, null).length, nextCourt.length);
});

test('a stray sighting away from the shuttle’s path isn’t shown', () => {
  const flying = series(0, 1, (t) => [0.4 + t * 0.2, 0.6 - t * 0.2]);
  const stray = [0.5, 0.2, 0.75];
  const shown = shuttleInPlay([...flying, stray].sort((a, b) => a[0] - b[0]), CORNERS);
  assert.equal(shown.length, flying.length);
  assert.ok(!shown.includes(stray));
});
