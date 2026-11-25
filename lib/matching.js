// Suggesting which match each video shows, from when it was recorded, when
// matches were due on court and how long the video is for the points played.
// No I/O here; tested in tests/matching.test.js.
//
// Videos recorded back to back (the next starting within PART_GAP of the last
// ending) are taken as one match. Each group is then lined up with the day's
// matches in time order, at most one group per match, choosing the line-up
// with the lowest total cost: minutes the group started before or after the
// match was due, plus how far its videos' lengths are from what the games'
// points take (fitGames), and leaving a group unmatched costing UNMATCHED. A
// match or game takes one video, so a group of several goes game by game.
//
// Checked against 19 videos linked by hand at one tournament (25 November 2026):
// by time alone 7 were right, with the lengths 17, and with only the filmed
// player's matches all 19. A point took 11 to 19 s, 14 s on average.

export const PART_GAP_S = 5 * 60;
const EARLY_COST = 1.25; // tournaments run late more often than early
const UNMATCHED = 90;
const MAX_EARLY_MIN = 75;
const MAX_LATE_MIN = 240;

const SECONDS_PER_POINT = 14;
const BREAK_S = 90;       // between two games of a match filmed whole
const LENGTH_COST = 80;   // times |ln(length / expected)|
const MAX_LENGTH_COST = 70;
const GAME_MISSING = 10;  // a game played and not filmed
const VIDEO_EXTRA = 25;   // a video more than the games played

/**
 * @param {{ id: number, recordedAt: number, duration: number }[]} videos times in ms, duration in s
 * @returns {{ ids: number[], lengths: number[], start: number, end: number }[]} in time order
 */
export function groupParts(videos, gapS = PART_GAP_S) {
  const sorted = videos.filter((v) => Number.isFinite(v.recordedAt)).sort((x, y) => x.recordedAt - y.recordedAt);
  const groups = [];
  for (const v of sorted) {
    const end = v.recordedAt + (v.duration ?? 0) * 1000;
    const last = groups.at(-1);
    if (last && v.recordedAt - last.end <= gapS * 1000) {
      last.ids.push(v.id);
      last.lengths.push(v.duration ?? 0);
      last.end = Math.max(last.end, end);
    } else {
      groups.push({ ids: [v.id], lengths: [v.duration ?? 0], start: v.recordedAt, end });
    }
  }
  return groups;
}

/** Cost of showing a match due at `due` (ms) in a group starting at `start`; Infinity when implausible. */
export function pairCost(start, due, durationMin = null, groupMin = null) {
  const late = (start - due) / 60000;
  if (late < -MAX_EARLY_MIN || late > MAX_LATE_MIN) return Infinity;
  let cost = late >= 0 ? late : -late * EARLY_COST;
  if (durationMin && groupMin) cost += Math.abs(groupMin - durationMin) * 0.5;
  return cost;
}

/** Every way to pick `k` of 0..n-1, in order. */
const picks = (n, k, from = 0) => (k === 0 ? [[]] : Array.from({ length: Math.max(0, n - from - k + 1) }, (_, i) => picks(n, k - 1, from + i + 1).map((rest) => [from + i, ...rest])).flat());

const lengthCost = (seconds, expected) => Math.min(MAX_LENGTH_COST, LENGTH_COST * Math.abs(Math.log(Math.max(1, seconds) / Math.max(1, expected))));

/**
 * How well a group's videos fit the games played, and which video shows which game
 * (0: the whole match in one video). The videos keep their order.
 * @param {number[]} lengths seconds
 * @param {[number, number][]} games the score
 * @returns {{ cost: number, slots: [number, number][] }} slots: [index of the video, game]
 */
export function fitGames(lengths, games) {
  const expected = games.map(([x, y]) => (x + y) * SECONDS_PER_POINT);
  const k = lengths.length;
  const n = expected.length;
  let best = { cost: Infinity, slots: [] };
  const offer = (cost, slots) => { if (cost < best.cost) best = { cost, slots }; };
  if (k === 1) offer(lengthCost(lengths[0], expected.reduce((x, y) => x + y, 0) + BREAK_S * (n - 1)), [[0, 0]]);
  if (k === 1 && n === 1) return best;
  // A long run of clips can't be tried every way; its first videos are.
  const used = Math.min(k, 8);
  const m = Math.min(used, n);
  for (const vs of picks(used, m)) {
    for (const gs of picks(n, m)) {
      offer(vs.reduce((sum, v, i) => sum + lengthCost(lengths[v], expected[gs[i]]), 0) + GAME_MISSING * (n - m) + VIDEO_EXTRA * (k - m), vs.map((v, i) => [v, gs[i] + 1]));
    }
  }
  return best;
}

/** The cheapest line-up: { total, pairs: [[group, match]] } (indexes into the rows and columns of `cost`). */
function lineUp(cost, groups, matches) {
  // best[i][j]: lowest cost for the first i groups and first j matches.
  const best = Array.from({ length: groups + 1 }, () => new Array(matches + 1).fill(Infinity));
  const how = Array.from({ length: groups + 1 }, () => new Array(matches + 1).fill(null));
  for (let j = 0; j <= matches; j++) best[0][j] = 0;
  for (let i = 1; i <= groups; i++) {
    best[i][0] = best[i - 1][0] + UNMATCHED;
    how[i][0] = 'skipGroup';
    for (let j = 1; j <= matches; j++) {
      const options = [
        [best[i][j - 1], 'skipMatch'],
        [best[i - 1][j] + UNMATCHED, 'skipGroup'],
        [best[i - 1][j - 1] + cost[i - 1][j - 1], 'pair'],
      ];
      for (const [c, step] of options) {
        if (c < best[i][j]) {
          best[i][j] = c;
          how[i][j] = step;
        }
      }
    }
  }
  const pairs = [];
  let i = groups;
  let j = matches;
  while (i > 0 && j >= 0) {
    const step = how[i][j];
    if (step === 'pair') {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (step === 'skipMatch') j -= 1;
    else i -= 1;
  }
  return { total: best[groups][matches], pairs: pairs.reverse() };
}

/**
 * Lines groups up with matches (both in time order) without crossing. A match's
 * `games` (its score), when known, also judge the videos' lengths. Each
 * suggestion says how sure it is: `margin`, how much worse the best line-up
 * without it would be, and `fit`, the length cost per video (null: no score).
 * @param {{ ids: number[], lengths?: number[], start: number, end: number }[]} groups
 * @param {{ id: number, startsAt: number, duration?: number|null, games?: [number, number][] }[]} matches
 * @returns {{ ids: number[], matchId: number, lateMin: number, slots: [number, number][]|null, fit: number|null, margin: number }[]}
 *   slots: [video id, game] when the score is known
 */
export function suggest(groups, matches) {
  return lineUpAll(groups, matches).suggestions;
}

/**
 * As suggest, with the line-up's total cost: what explaining these videos by
 * these matches takes. Videos already linked take part as fixed points, so
 * that what is left is judged with all the evidence: a group with `pin` (a
 * match id) goes with that match or none, and a match that is `taken` with no other.
 */
export function lineUpAll(groups, matches) {
  const g = [...groups].sort((x, y) => x.start - y.start);
  const m = matches.filter((x) => Number.isFinite(x.startsAt)).sort((x, y) => x.startsAt - y.startsAt);
  const fits = g.map((group) => m.map((match) => (match.games?.length && group.lengths ? fitGames(group.lengths, match.games) : null)));
  const cost = g.map((group, i) => m.map((match, j) => (group.pin ? (group.pin === match.id ? 0 : Infinity) : match.taken ? Infinity : pairCost(group.start, match.startsAt, match.duration, (group.end - group.start) / 60000) + (fits[i][j]?.cost ?? 0))));
  const { total, pairs } = lineUp(cost, g.length, m.length);
  const suggestions = pairs.filter(([i]) => !g[i].pin).map(([i, j]) => {
    const without = cost.map((row, r) => (r === i ? row.map((c, k) => (k === j ? Infinity : c)) : row));
    const fit = fits[i][j];
    return {
      ids: g[i].ids,
      matchId: m[j].id,
      lateMin: Math.round((g[i].start - m[j].startsAt) / 60000),
      slots: fit ? fit.slots.map(([v, game]) => [g[i].ids[v], game]) : null,
      fit: fit ? fit.cost / Math.max(1, fit.slots.length) : null,
      margin: lineUp(without, g.length, m.length).total - total,
    };
  });
  return { total, suggestions };
}

/**
 * One suggestion per video, as a match or game takes one video. With the score
 * known, fitGames chose each video's game; without it, a group of one goes to
 * the whole match (game 0) and a group of several to the match's games in
 * recording order, as many as `gamesOf(matchId)` allows (the rest stay unsuggested).
 * @returns {{ ids: [number], matchId: number, game: number, lateMin: number, fit: number|null, margin: number }[]}
 */
export function perVideo(suggestions, gamesOf) {
  return suggestions.flatMap(({ slots, ...s }) => {
    if (slots) return slots.map(([id, game]) => ({ ...s, ids: [id], game }));
    return s.ids.length === 1
      ? [{ ...s, game: 0 }]
      : s.ids.slice(0, gamesOf(s.matchId)).map((id, i) => ({ ...s, ids: [id], game: i + 1 }));
  });
}
