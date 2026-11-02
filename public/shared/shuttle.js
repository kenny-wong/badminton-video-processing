// Which tracked shuttle sightings to show on the video: only the shuttle in
// play over the marked court. No DOM code here; tests/shuttle.test.js.
//
// - Over the court: the shuttle is mostly in the air, so it isn't inside the
//   court's outline on the picture, but straight above it. A sighting counts
//   when a vertical line through it meets the court (with a metre around it, for
//   shots landing out) at or below it: above the court, not beside it.
// - In play: a sighting that hardly moves for half a second or more is the
//   shuttle lying on the floor (or something that isn't a shuttle at all).
// - On a path: a sighting with nothing close by just before or after is a stray
//   (another court's shuttle, a flash of light).
// The tracked data itself keeps every sighting: where the shuttle came to rest
// is what the landing map and clips use.

import { apply, COURT, courtMapping } from './court.js';

const AROUND = 1; // metres around the court that still count, for shots landing out
const STILL_FOR = 0.5; // seconds a shuttle in play never stays put for
const STILL_MOVE = 0.006; // ... "put" being within this much of the picture's size
const STRAY_GAP = 0.2; // seconds either side to look for the rest of a shuttle's path
const STRAY_NEAR = 0.08; // ... within this much of the picture

/**
 * The court and a metre around it, as a polygon on the picture (fractions), or
 * null without corners. A corner's metre may lie behind the camera (a phone
 * close to the court), where the picture has no place for it: that corner then
 * gets half a metre, or none.
 */
export function courtOutline(corners) {
  const map = courtMapping(corners);
  if (!map) return null;
  const H = map.toPicture;
  const depth = ([u, v]) => H[2][0] * u + H[2][1] * v + H[2][2]; // its sign says which side of the camera a point is
  const { width: w, length: l } = COURT;
  const front = Math.sign(depth([w / 2, l / 2]));
  return [[0, 0, -1, -1], [w, 0, 1, -1], [w, l, 1, 1], [0, l, -1, 1]].map(([x, y, dx, dy]) => {
    for (const m of [AROUND, AROUND / 2, 0]) {
      const p = [x + dx * m, y + dy * m];
      if (Math.sign(depth(p)) !== front || Math.abs(depth(p)) < 1e-9) continue;
      const at = apply(H, p);
      // Just in front of the camera, perspective throws a point far off the picture: that's no border either.
      if (m === 0 || at.every((n) => n > -1 && n < 2)) return at;
    }
    return apply(H, [x, y]);
  });
}

/** Whether a picture point [x, y] is over the outline: a vertical line through it meets the outline at or below it. */
export function overCourt([x, y], outline) {
  let lowest = -Infinity;
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % outline.length];
    if ((x < Math.min(ax, bx)) || (x > Math.max(ax, bx)) || ax === bx) continue;
    lowest = Math.max(lowest, ay + ((by - ay) * (x - ax)) / (bx - ax)); // the outline's edge at this x
  }
  return lowest > -Infinity && y <= lowest + 0.01;
}

/**
 * The sightings ([t, x, y], in time order) to draw: over the court when there
 * is one, and not lying still.
 */
export function shuttleInPlay(points, corners) {
  const outline = courtOutline(corners);
  const kept = outline ? points.filter(([, x, y]) => overCourt([x, y], outline)) : points;
  // Still: every sighting within STILL_FOR either side stays near this one, and there are enough to tell.
  let from = 0;
  let to = 0;
  const moving = kept.filter(([t, x, y]) => {
    while (kept[from][0] < t - STILL_FOR / 2) from += 1;
    while (to + 1 < kept.length && kept[to + 1][0] <= t + STILL_FOR / 2) to += 1;
    if (to - from < 5) return true;
    for (let k = from; k <= to; k++) {
      if (Math.abs(kept[k][1] - x) > STILL_MOVE || Math.abs(kept[k][2] - y) > STILL_MOVE) return true;
    }
    return false; // all of them within a hair of this one: lying still
  });
  // Strays: the shuttle in play flies a path, so a sighting with no other one close by just before
  // or after is something else (another court's shuttle, a flash of light).
  from = 0;
  to = 0;
  return moving.filter(([t, x, y], i) => {
    while (moving[from][0] < t - STRAY_GAP) from += 1;
    while (to + 1 < moving.length && moving[to + 1][0] <= t + STRAY_GAP) to += 1;
    for (let k = from; k <= to; k++) {
      if (k !== i && Math.hypot(moving[k][1] - x, moving[k][2] - y) <= STRAY_NEAR) return true;
    }
    return false;
  });
}
