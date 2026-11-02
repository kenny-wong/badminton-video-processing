// Badminton scoring for tagged rallies: replays who won each rally into the
// score, game by game, and checks the result against the official one. No DOM
// code here, so the page and the server share it and it is unit tested in
// tests/score.test.js.
//
// A rally is { start, end, winner } with times in seconds of the match video
// and winner 'a', 'b', 'let' (replayed, no point) or null (not tagged yet).

// Games to `points` (21, 15 or 11). With setting, a game at points-1 all goes on
// until someone leads by two, up to a cap (21 -> 30, 15 -> 21, 11 -> 15).
export const CAPS = { 21: 30, 15: 21, 11: 15 };
export const DEFAULT_FORMAT = { points: 21, setting: true, bestOf: 3 };

export function cleanFormat(f) {
  const points = [21, 15, 11].includes(f?.points) ? f.points : 21;
  return { points, setting: f?.setting !== false, bestOf: f?.bestOf === 1 ? 1 : 3 };
}

/** 'a' or 'b' once a game at this score is over, else null. */
export function gameOver([x, y], { points = 21, setting = true } = {}) {
  const [w, l] = x > y ? [x, y] : [y, x];
  const side = x > y ? 'a' : 'b';
  if (w < points) return null;
  if (!setting) return side;
  const cap = CAPS[points] ?? points + 9;
  return w >= cap || w - l >= 2 ? side : null;
}

/** The score at which players change ends in the deciding game (11 of 21). */
export const midPoint = (points) => Math.ceil(points / 2);

/**
 * Which end ('near' or 'far') `team` is at for a rally starting at `state`
 * ({ games, points }): from `nearAtStart` (the team at the near end when the
 * video starts at `start`), changing after each game since then and at the
 * mid-point of a deciding game. `state` may also come before `start` (an
 * earlier game's video of the same match).
 */
export function endOf(team, state, start, nearAtStart, rules) {
  const flip = (end) => (end === 'near' ? 'far' : 'near');
  const deciding = (s) => rules.bestOf !== 1 && s.games.length === 2;
  const past = (s) => deciding(s) && Math.max(...s.points) >= midPoint(rules.points);
  const swaps = (state.games.length - start.games.length) + (past(state) ? 1 : 0) - (past(start) ? 1 : 0);
  const aEnd = (nearAtStart === 'a' ? 'near' : 'far');
  const end = swaps % 2 ? flip(aEnd) : aEnd;
  return team === 'a' ? end : flip(end);
}

/**
 * Replays the rallies in order, from `start` when the video begins mid-match
 * (see cleanStart) and with `firstServer` serving the first rally. With
 * `oneGame` (a video of a single game), it ends when that game does.
 * @returns {{ steps: object[], games: number[][], winner: 'a'|'b'|null, initial: object, final: object }}
 *   steps[i] says what rally i did: `before` and `after` are scores
 *   ({ games: [[a, b], …] finished games, points: [a, b], won: [a, b], server }),
 *   `counted` is false for untagged rallies, lets and rallies after the match
 *   ended, and `event` is 'game', 'match', 'interval' (a leader reaching the
 *   mid-point; ends change there in the deciding game) or null.
 */
export function replay(rallies, format = DEFAULT_FORMAT, firstServer = 'a', start = null, { oneGame = false } = {}) {
  const rules = cleanFormat(format);
  const need = rules.bestOf === 1 ? 1 : 2;
  const from = cleanStart(start, rules) ?? { games: [], points: [0, 0] };
  const won = [0, 1].map((k) => from.games.filter((g) => g[k] > g[1 - k]).length);
  const initial = { games: from.games, points: from.points, won, server: firstServer === 'b' ? 'b' : 'a' };
  let state = initial;
  let winner = null;
  const steps = [];
  for (const r of rallies) {
    const before = state;
    const w = r?.winner;
    if (winner || (w !== 'a' && w !== 'b')) {
      steps.push({ before, after: before, counted: false, event: null, reason: winner ? 'afterMatch' : w === 'let' ? 'let' : 'untagged' });
      continue;
    }
    const points = w === 'a' ? [before.points[0] + 1, before.points[1]] : [before.points[0], before.points[1] + 1];
    let event = null;
    let after = { ...before, points, server: w };
    const mid = midPoint(rules.points);
    if (Math.max(...points) === mid && Math.max(...before.points) < mid) event = 'interval';
    const gameWinner = gameOver(points, rules);
    if (gameWinner) {
      const won = gameWinner === 'a' ? [before.won[0] + 1, before.won[1]] : [before.won[0], before.won[1] + 1];
      after = { games: [...before.games, points], points: [0, 0], won, server: gameWinner };
      event = 'game';
      if (oneGame || won[0] === need || won[1] === need) {
        winner = gameWinner;
        event = 'match';
      }
    }
    steps.push({ before, after, counted: true, event });
    state = after;
  }
  const games = [...state.games];
  if (!winner && (state.points[0] || state.points[1])) games.push(state.points);
  return { steps, games, winner, initial, final: state };
}

/**
 * The score a match video starts at. A game's own video (match.game 1-3)
 * starts after the earlier games of the official result, at 0-0 unless a
 * different score in that game was set.
 */
export function startFor(match) {
  const game = match?.game ?? 0;
  if (!game) return match?.startScore ?? null;
  const earlier = (match.games ?? []).slice(0, game - 1);
  return { games: earlier, points: match.startScore?.points ?? [0, 0] };
}

/** Who won a finished game ([a, b] points): 'a', 'b', or null for a tie or no game. */
const gameWinnerOf = (g) => (Array.isArray(g) && g[0] !== g[1] ? (g[0] > g[1] ? 'a' : 'b') : null);

/**
 * Who serves first in a game's own video. The winner of a game serves first in
 * the next (the Laws), so in games 2 and 3 that is the winner of the game
 * before in the official result `games`. Game 1 (the toss) is A; without that
 * result, B in game 2.
 */
export function defaultServer(game, games = []) {
  if (game < 2) return 'a';
  return gameWinnerOf(Array.isArray(games) ? games[game - 2] : null) ?? (game === 2 ? 'b' : 'a');
}

/** Replays a match's (or a game's) saved tagging. */
export const replayMatch = (match, format) => replay(match.rallies, format, match.firstServer, startFor(match), { oneGame: (match.game ?? 0) > 0 });

/**
 * Which service court the server stands in: the right when their own score is
 * even, the left when it is odd (singles and doubles alike).
 */
export function serviceCourt({ points, server }) {
  const own = server === 'a' ? points[0] : points[1];
  return own % 2 === 0 ? 'right' : 'left';
}

/**
 * What the scoreboard shows after a rally (a replay step): its score after,
 * except once the match is over (or a game's own video's game): then the last
 * game's final points stay up, not the next game's 0-0, and nobody serves.
 */
export function shownAfter(step) {
  const after = step.after;
  if (step.event !== 'match' || !after.games.length) return after;
  return { ...after, games: after.games.slice(0, -1), points: after.games.at(-1), server: null, final: true };
}

/** What the scoreboard shows at `time` seconds: the score after the last rally that ended by then (see shownAfter). */
export function boardAt(rallies, steps, time, initial = null) {
  let state = initial ?? steps[0]?.before ?? { games: [], points: [0, 0], won: [0, 0], server: 'a' };
  for (let i = 0; i < rallies.length; i++) {
    if (rallies[i].end <= time) state = steps[i]?.counted ? shownAfter(steps[i]) : state;
    else break;
  }
  return state;
}

/** The score shown at `time` seconds: the state after the last rally that ended by then. */
export function scoreAt(rallies, steps, time, initial = null) {
  let state = initial ?? steps[0]?.before ?? { games: [], points: [0, 0], won: [0, 0], server: 'a' };
  for (let i = 0; i < rallies.length; i++) {
    if (rallies[i].end <= time) state = steps[i].after;
    else break;
  }
  return state;
}

/**
 * Compares the replayed games with the official result (each game [a, b]).
 * @returns {{ ok: boolean, game: number|null }} game is the first game (0-based)
 *   that differs, null when they agree or there is no official result.
 */
export function checkResult(games, official) {
  if (!Array.isArray(official) || !official.length) return { ok: true, game: null };
  const n = Math.max(games.length, official.length);
  for (let i = 0; i < n; i++) {
    const g = games[i];
    const o = official[i];
    if (!g || !o || g[0] !== o[0] || g[1] !== o[1]) return { ok: false, game: i };
  }
  return { ok: true, game: null };
}

/**
 * A best guess at the format from the official games: 15 or 11 points when a
 * game ended there by two or more, a single game when a finished match had one.
 */
export function inferFormat(official, finished = false) {
  const games = Array.isArray(official) ? official.filter((g) => Array.isArray(g) && g.length === 2) : [];
  let points = 21;
  for (const p of [15, 11]) {
    if (games.some(([x, y]) => Math.max(x, y) === p && Math.abs(x - y) >= 2)) points = p;
  }
  return { points, setting: true, bestOf: finished && games.length === 1 ? 1 : 3 };
}

/**
 * The score when the video starts, if not 0-0: `games` finished before it
 * ([[a, b], …]) and `points` in the game under way. Null when it is 0-0 at the
 * start of game 1 or isn't a possible score (a finished game in `points`, an
 * unfinished one in `games`, or a match already decided).
 */
export function cleanStart(start, format = DEFAULT_FORMAT) {
  if (!start || typeof start !== 'object') return null;
  const rules = cleanFormat(format);
  const need = rules.bestOf === 1 ? 1 : 2;
  const cap = rules.setting ? CAPS[rules.points] : rules.points;
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= cap;
  const games = Array.isArray(start.games) ? start.games : [];
  const points = Array.isArray(start.points) ? start.points : [0, 0];
  if (!games.every((g) => Array.isArray(g) && g.length === 2 && g.every(ok) && gameOver(g, rules))) return null;
  if (points.length !== 2 || !points.every(ok) || gameOver(points, rules)) return null;
  for (const k of [0, 1]) {
    if (games.filter((g) => gameOver(g, rules) === (k ? 'b' : 'a')).length >= need) return null;
  }
  if (!games.length && !points[0] && !points[1]) return null;
  return { games: games.map((g) => [...g]), points: [...points] };
}

/** "21-18, 15-21" or "21-18 15-21" -> [[21, 18], [15, 21]]; null when not readable. */
export function parseGames(text) {
  const parts = String(text ?? '').trim().split(/[\s,;]+/).filter(Boolean);
  const games = parts.map((p) => /^(\d{1,2})-(\d{1,2})$/.exec(p)).map((m) => m && [Number(m[1]), Number(m[2])]);
  return games.every(Boolean) ? games : null;
}

/**
 * Where a rally tagged with only its end (A or B pressed without S) began:
 * `gap` seconds after the rally before it ended (or the match start, or `back`
 * seconds before the end when there is neither), and at least 1 s before its end.
 */
export function assumedStart(rallies, end, { matchStart = null, gap = 3, back = 10 } = {}) {
  const before = rallies.filter((r) => r.end <= end).reduce((t, r) => Math.max(t, r.end), -Infinity);
  const from = Number.isFinite(before) ? before + gap : matchStart ?? end - back;
  return Math.round(Math.max(0, Math.min(from, end - 1)) * 100) / 100;
}

/** "21-18 15-21" */
export const gamesText = (games) => (games ?? []).map(([x, y]) => `${x}-${y}`).join(' ');

/** Rallies in time order, each start before its end, winners kept only when valid. */
export function cleanRallies(list, maxCount = 2000) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.start >= 0 && r.end > r.start)
    .slice(0, maxCount)
    .map((r) => ({
      start: Math.round(r.start * 100) / 100,
      end: Math.round(r.end * 100) / 100,
      winner: ['a', 'b', 'let'].includes(r.winner) ? r.winner : null,
      ...(r.fav === true ? { fav: true } : {}),
    }))
    .sort((x, y) => x.start - y.start);
}

