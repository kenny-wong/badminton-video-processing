// Match statistics from the tagged rallies: points won on serve and on
// receive, runs of points, biggest leads and comebacks, rally lengths (and
// shots, from the hit sounds), the lead after every rally for the momentum
// chart, and where rallies ended on court (from the tracked shuttle). No DOM
// code here; the editor's Stats tab and the end card use it. Tested in
// tests/stats.test.js.

import { apply } from './court.js';

const round1 = (x) => Math.round(x * 10) / 10;

/** How many of the sorted hit times fall within the rally. */
export function shotsIn(hits, { start, end }) {
  if (!hits?.length) return null;
  let lo = 0;
  let hi = hits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hits[mid] < start) lo = mid + 1;
    else hi = mid;
  }
  let n = 0;
  for (let i = lo; i < hits.length && hits[i] <= end; i++) n += 1;
  return n;
}

/**
 * Statistics for the counted rallies (`steps` from replay()). `hits` (sorted
 * times of shuttle hits, seconds) adds shot counts.
 */
export function matchStats(rallies, steps, { hits = null } = {}) {
  const games = [];
  const serve = { a: { won: 0, of: 0 }, b: { won: 0, of: 0 } };
  const points = [0, 0];
  let best = null; // longest run of points
  let longest = null;
  let mostShots = null;
  const lengths = [];
  const shotCounts = [];
  let run = { side: null, n: 0 };
  rallies.forEach((r, i) => {
    const s = steps[i];
    if (!s?.counted) return;
    const k = r.winner === 'a' ? 0 : 1;
    const number = s.before.games.length + 1;
    let g = games.at(-1);
    if (!g || g.number !== number) {
      g = { number, start: r.start, end: r.end, rallies: 0, lead: [{ i: null, lead: s.before.points[0] - s.before.points[1] }], biggestLead: [0, 0], runs: [0, 0], deficit: [0, 0], score: null, winner: null };
      games.push(g);
      run = { side: null, n: 0 };
    }
    g.rallies += 1;
    g.end = r.end;
    points[k] += 1;
    const server = s.before.server;
    serve[server].of += 1;
    if (r.winner === server) serve[server].won += 1;
    run = run.side === r.winner ? { side: r.winner, n: run.n + 1 } : { side: r.winner, n: 1 };
    g.runs[k] = Math.max(g.runs[k], run.n);
    if (!best || run.n > best.points) best = { side: r.winner, points: run.n, game: number };
    const after = s.event === 'game' || s.event === 'match' ? s.after.games.at(-1) : s.after.points;
    const lead = after[0] - after[1];
    g.lead.push({ i, lead });
    if (lead > 0) g.biggestLead[0] = Math.max(g.biggestLead[0], lead);
    if (lead < 0) g.biggestLead[1] = Math.max(g.biggestLead[1], -lead);
    if (s.event === 'game' || s.event === 'match') {
      g.score = after;
      g.winner = after[0] > after[1] ? 'a' : 'b';
    }
    const seconds = r.end - r.start;
    lengths.push(seconds);
    if (!longest || seconds > longest.seconds) longest = { index: i, seconds: round1(seconds) };
    const shots = shotsIn(hits, r);
    if (shots !== null) {
      shotCounts.push(shots);
      if (!mostShots || shots > mostShots.shots) mostShots = { index: i, shots };
    }
  });
  // A comeback: the most points the game's winner was behind by at some point.
  for (const g of games) {
    if (!g.winner) continue;
    const w = g.winner === 'a' ? 1 : -1;
    g.comeback = Math.max(0, ...g.lead.map((x) => -x.lead * w));
    g.seconds = Math.round(g.end - g.start);
  }
  const avg = (list) => (list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : null);
  return {
    rallies: lengths.length,
    points,
    serve,
    receive: { a: { won: serve.b.of - serve.b.won, of: serve.b.of }, b: { won: serve.a.of - serve.a.won, of: serve.a.of } },
    longestRun: best,
    averageRally: avg(lengths),
    longestRally: longest,
    averageShots: avg(shotCounts),
    mostShots,
    games,
  };
}

/** One line for the end card: "Longest rally 24 s · Best run: LEE 6 points". */
export function statsLine(stats, names) {
  const bits = [];
  if (stats.mostShots?.shots >= 2) bits.push(`Longest rally ${stats.mostShots.shots} shots`);
  else if (stats.longestRally) bits.push(`Longest rally ${Math.round(stats.longestRally.seconds)} s`);
  if (stats.longestRun?.points >= 3) bits.push(`Best run ${names[stats.longestRun.side === 'a' ? 0 : 1]} ${stats.longestRun.points} points`);
  return bits.join(' · ');
}

/**
 * Where each rally ended on court: the last sighting of the shuttle during the
 * rally (or within `after` seconds of its end), mapped to metres on the
 * court. `points` are sightings [t, x, y] (picture fractions), sorted by time;
 * `toCourt` the picture-to-court homography.
 * @returns {{ index, winner, x, y }[]}
 */
export function landings(rallies, points, toCourt, { after = 0.6 } = {}) {
  if (!toCourt || !points?.length) return [];
  const out = [];
  let j = 0;
  rallies.forEach((r, index) => {
    if (r.winner !== 'a' && r.winner !== 'b') return;
    while (j < points.length && points[j][0] < r.start) j += 1;
    let last = null;
    for (let k = j; k < points.length && points[k][0] <= r.end + after; k++) last = points[k];
    if (!last) return;
    const [x, y] = apply(toCourt, [last[1], last[2]]);
    if (Number.isFinite(x) && Number.isFinite(y) && x > -3 && x < 9 && y > -3 && y < 16.4) out.push({ index, winner: r.winner, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  });
  return out;
}

/**
 * The line under the landing map: how many of the rallies with a winner got a
 * dot, and why the others didn't. The map treats the last sighting as a point
 * on the floor, so a shuttle last seen in the air lands far off the court
 * (or behind the camera) and is left out.
 */
export function landingNote(placed, withWinner) {
  if (!withWinner) return 'No rally has a winner yet.';
  const of = `${placed} of ${withWinner} ${withWinner === 1 ? 'rally' : 'rallies'}`;
  if (placed === withWinner) return `All ${of} placed, at the last place the shuttle was seen. Click a dot to play its rally.`;
  const rest = withWinner - placed;
  return `${of} placed. ${rest === 1 ? 'The other one was' : `The other ${rest} were`} last seen in the air or not seen at all: `
    + 'the map reads the last sighting as a spot on the floor, which only works when the shuttle was seen landing (best with a camera high behind a baseline). '
    + (placed ? 'Click a dot to play its rally.' : '');
}

