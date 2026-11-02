// Suggesting who won each rally from the tracked shuttle (TrackNetV3, run by
// lib/track.js). No I/O here; tested in tests/winners.test.js.
//
// Two clues, from a camera behind one baseline:
// - The serve. Whoever won a rally serves the next one. A serve from the near
//   end flies away from the camera (up the picture); one from the far end comes
//   towards it (down the picture). That says which end won the rally before.
// - The landing. Where the shuttle was last seen, mapped onto the court: the end
//   it came down in lost the rally (or, when it landed out, the end that hit it).
//   A shuttle in the air maps wrongly, so this clue is weaker.
// Ends are known from where team A starts and the score: players change ends
// after each game and when the leader reaches the mid-point of a deciding game.

import { apply } from '../public/shared/court.js';
import { COURT } from '../public/shared/court.js';
import { cleanFormat, gameOver, midPoint } from '../public/shared/score.js';

const other = (s) => (s === 'a' ? 'b' : 'a');
const flip = (end) => (end === 'near' ? 'far' : 'near');

/** Visible shuttle points between two times, in time order. Points are { t, x, y } with x, y as fractions of the picture. */
const between = (points, from, to) => points.filter((p) => p.t >= from && p.t <= to);

/**
 * Which end served a rally: 'near' when the shuttle's first flight goes up the
 * picture, 'far' when it comes down. `strength` is how far it moved (fraction
 * of the picture height). Null when the shuttle wasn't seen at the start.
 */
export function serveEnd(points, rally) {
  const first = between(points, rally.start - 0.5, rally.start + 2.5)[0];
  if (!first) return null;
  const flight = between(points, first.t + 0.3, first.t + 0.9);
  if (flight.length < 3) return null;
  const dy = flight.reduce((s, p) => s + p.y, 0) / flight.length - first.y;
  if (Math.abs(dy) < 0.03) return null;
  return { end: dy < 0 ? 'near' : 'far', strength: Math.abs(dy) };
}

/**
 * Where the shuttle came down at the end of a rally, on the court: which end
 * lost it ('near' or 'far'), and whether it landed out. Null without a court
 * mapping or a sighting near the end.
 */
export function landing(points, rally, toCourt) {
  if (!toCourt) return null;
  const seen = between(points, rally.start, rally.end + 1);
  const last = seen.at(-1);
  if (!last || last.t < rally.end - 2.5) return null;
  const [x, y] = apply(toCourt, [last.x, last.y]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const margin = 0.1;
  const out = x < -margin || x > COURT.width + margin || y < -margin || y > COURT.length + margin;
  const half = y < COURT.net ? 'near' : 'far';
  // Close to a line, the call could go either way.
  const close = Math.min(Math.abs(x), Math.abs(x - COURT.width), Math.abs(y), Math.abs(y - COURT.length), Math.abs(y - COURT.net)) < 0.4;
  return { lost: out ? flip(half) : half, out, court: [Math.round(x * 100) / 100, Math.round(y * 100) / 100], close };
}

/** The score after a rally won by `w` (games, points, server), ending at a game when `oneGame`. */
function step(state, w, rules, oneGame) {
  const points = w === 'a' ? [state.points[0] + 1, state.points[1]] : [state.points[0], state.points[1] + 1];
  const won = gameOver(points, rules);
  if (!won) return { ...state, points, over: false };
  return { games: [...state.games, points], points: [0, 0], over: oneGame };
}

/**
 * Which end team A is at for a rally starting at `state`: from `nearAtStart`
 * (the team at the near end when the video starts), changing after each game
 * since then and at the mid-point of a deciding game.
 */
export function endOf(team, state, start, nearAtStart, rules) {
  const deciding = (s) => rules.bestOf !== 1 && s.games.length === 2;
  const past = (s) => deciding(s) && Math.max(...s.points) >= midPoint(rules.points);
  const swaps = (state.games.length - start.games.length) + (past(state) ? 1 : 0) - (past(start) && state.games.length === start.games.length ? 1 : 0);
  const aEnd = (nearAtStart === 'a' ? 'near' : 'far');
  const end = swaps % 2 ? flip(aEnd) : aEnd;
  return team === 'a' ? end : flip(end);
}

/**
 * A suggested winner for each rally without one.
 * @param {{ rallies: object[], points: object[], toCourt: number[][]|null, nearAtStart: 'a'|'b',
 *   format: object, start: { games: number[][], points: number[] }, oneGame?: boolean }} o
 * @returns {{ winner: 'a'|'b'|null, sure: boolean, serve: string|null, landing: string|null }[]} one per rally;
 *   rallies already tagged (or lets) get their own winner back.
 */
export function suggestWinners({ rallies, points, toCourt = null, nearAtStart = 'a', format, start, oneGame = false }) {
  const rules = cleanFormat(format);
  const begin = { games: start?.games ?? [], points: start?.points ?? [0, 0] };
  let state = { ...begin };
  const serves = rallies.map((r) => serveEnd(points, r));
  return rallies.map((r, i) => {
    if (r.winner === 'let') return { winner: 'let', sure: true, serve: null, landing: null };
    // Clue 1: the next rally's serve, read against the ends after each possible winner.
    const next = serves[i + 1];
    let byServe = null;
    if (next && rallies[i + 1]?.winner !== 'let') {
      const fits = ['a', 'b'].filter((w) => endOf(w, step(state, w, rules, oneGame), begin, nearAtStart, rules) === next.end);
      if (fits.length === 1) byServe = fits[0];
    }
    // Clue 2: where it came down.
    const land = landing(points, r, toCourt);
    const byLanding = land ? other(['a', 'b'].find((t) => endOf(t, state, begin, nearAtStart, rules) === land.lost)) : null;
    let winner = r.winner === 'a' || r.winner === 'b' ? r.winner : byServe ?? byLanding;
    const sure = Boolean(r.winner) || (byServe && (byServe === byLanding || (next.strength >= 0.08 && !byLanding)));
    if (r.winner !== 'a' && r.winner !== 'b' && byServe && byLanding && byServe !== byLanding) winner = byServe;
    const result = { winner, sure: Boolean(sure), serve: next?.end ?? null, landing: land ? `${land.lost} end lost${land.out ? ' (out)' : ''}` : null };
    if (winner === 'a' || winner === 'b') {
      if (state.over) return result;
      state = step(state, winner, rules, oneGame);
    }
    return result;
  });
}

// ---- winners from the official result ----
//
// Measured on match 249 (27 hand-tagged rallies, camera low at a court corner), with some winners hidden:
// the result alone got 63% of the hidden ones right with 75% tagged and 73% with 90% tagged, and its
// "sure" answers were always right. Adding the shuttle clues above (serve end, landing) made it worse
// (55% and 69%), and reading which service court the players stood in (person detection at the serve)
// was worse still, so neither is used here.

const stateKey = (s) => `${s.games.map((g) => g.join('-')).join(',')}|${s.points.join('-')}|${s.server}|${s.over ? 1 : 0}`;

/**
 * Who won each rally without a winner, worked out from the official result:
 * every sequence of winners that agrees with the rallies already tagged and
 * ends at the official score (`finalGames`) counts once, so a rally's chance
 * is the share of those sequences in which that side won it. With most
 * rallies tagged, the last ones follow from the result alone ("sure").
 * The winners given are the most likely sequence taken together, so filling
 * them all in reaches the result.
 * @returns {{ winner: 'a'|'b'|'let'|null, chance: number, sure: boolean, possible: boolean }[]} one per
 *   rally; tagged rallies get their own winner back (chance 1). `possible` is false when no sequence
 *   fits (the tagged winners can't reach the result: a rally missing or extra, or a winner wrong).
 */
export function inferWinners({ rallies, format, start, firstServer = 'a', finalGames, oneGame = false, sureAt = 0.9 }) {
  const rules = cleanFormat(format);
  const first = { games: start?.games ?? [], points: start?.points ?? [0, 0], server: firstServer, over: false };
  const target = JSON.stringify(finalGames ?? []);
  // At the end the games played must be the official ones (a finished game's points have moved into games).
  const fits = (s) => JSON.stringify(s.games) === target && !s.points[0] && !s.points[1];
  const choices = (r) => (r.winner === 'a' || r.winner === 'b' ? [r.winner] : r.winner === 'let' ? [null] : ['a', 'b']);
  // The score after rally i if `w` won it (null: a let), or null when that can't happen.
  const move = (s, r, w) => {
    if (w === null) return s;
    if (s.over) return r.winner === 'a' || r.winner === 'b' ? null : s; // untagged rallies after the end of the game don't count
    const next = step(s, w, rules, oneGame);
    return { games: next.games, points: next.points, over: next.over, server: w };
  };

  // Forward: how many sequences reach each score before each rally (as shares, so the numbers stay small).
  const forward = [new Map([[stateKey(first), { s: first, n: 1 }]])];
  for (const r of rallies) {
    const next = new Map();
    for (const { s, n } of forward.at(-1).values()) {
      for (const w of choices(r)) {
        const to = move(s, r, w);
        if (!to) continue;
        const k = stateKey(to);
        next.set(k, { s: to, n: (next.get(k)?.n ?? 0) + n });
      }
    }
    const total = [...next.values()].reduce((t, x) => t + x.n, 0);
    for (const x of next.values()) x.n /= total || 1;
    forward.push(next);
  }
  // Backward: from each score, how many ways the rest can still reach the result (scaled each step).
  const backward = new Array(rallies.length + 1);
  backward[rallies.length] = new Map([...forward[rallies.length]].map(([k, { s }]) => [k, fits(s) ? 1 : 0]));
  for (let i = rallies.length - 1; i >= 0; i--) {
    const here = new Map();
    for (const [k, { s }] of forward[i]) {
      let ways = 0;
      for (const w of choices(rallies[i])) {
        const to = move(s, rallies[i], w);
        if (to) ways += backward[i + 1].get(stateKey(to)) ?? 0;
      }
      here.set(k, ways);
    }
    const top = Math.max(...here.values(), 0);
    if (top) for (const [k, v] of here) here.set(k, v / top);
    backward[i] = here;
  }

  const possible = [...backward[0].values()].some((v) => v > 0);
  const best = possible ? likeliest(rallies, first, move, choices, fits) : [];
  return rallies.map((r, i) => {
    if (r.winner === 'a' || r.winner === 'b' || r.winner === 'let') return { winner: r.winner, chance: 1, sure: true, possible };
    const weight = { a: 0, b: 0 };
    for (const { s, n } of forward[i].values()) {
      for (const w of ['a', 'b']) {
        const to = move(s, r, w);
        if (to) weight[w] += n * (backward[i + 1].get(stateKey(to)) ?? 0);
      }
    }
    const total = weight.a + weight.b;
    if (!total) return { winner: null, chance: 0, sure: false, possible };
    const winner = best[i] ?? (weight.a >= weight.b ? 'a' : 'b');
    const chance = weight[winner] / total;
    return { winner, chance: Math.round(chance * 1000) / 1000, sure: chance >= sureAt, possible };
  });
}

/**
 * The likeliest sequence of winners that reaches the result: at each rally the
 * side with more ways through, so the sequence as a whole fits.
 */
function likeliest(rallies, first, move, choices, fits) {
  // Ways from each score at each rally to the result, worked out backwards with memory.
  const memo = new Map();
  const ways = (i, s) => {
    if (i === rallies.length) return fits(s) ? 1 : 0;
    const k = `${i}|${stateKey(s)}`;
    if (memo.has(k)) return memo.get(k);
    let n = 0;
    for (const w of choices(rallies[i])) {
      const to = move(s, rallies[i], w);
      if (to) n += ways(i + 1, to);
    }
    memo.set(k, n);
    return n;
  };
  const path = [];
  let s = first;
  for (let i = 0; i < rallies.length; i++) {
    let pick = null;
    let most = -1;
    for (const w of choices(rallies[i])) {
      const to = move(s, rallies[i], w);
      const n = to ? ways(i + 1, to) : 0;
      if (n > most) {
        most = n;
        pick = w;
      }
    }
    path.push(pick);
    s = move(s, rallies[i], pick);
  }
  return path;
}
