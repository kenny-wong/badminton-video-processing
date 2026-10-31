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
