// Suggesting which match each video shows, from when it was recorded and when
// matches were due on court. No I/O here; tested in tests/matching.test.js.
//
// Videos recorded back to back (the next starting within PART_GAP of the last
// ending) are taken as one match. Each group is then lined up with the day's
// matches in time order, at most one group per match, choosing the line-up
// with the lowest total cost: minutes the group started after the match was
// due (tournaments run late), with starting early costing EARLY_COST times as
// much, and leaving a group unmatched costing UNMATCHED. A match or game takes
// one video, so a group of several is suggested game by game (perVideo).

export const PART_GAP_S = 5 * 60;
const EARLY_COST = 3;
const UNMATCHED = 90;
const MAX_EARLY_MIN = 45;
const MAX_LATE_MIN = 240;

/**
 * @param {{ id: number, recordedAt: number, duration: number }[]} videos times in ms, duration in s
 * @returns {{ ids: number[], start: number, end: number }[]} in time order
 */
export function groupParts(videos, gapS = PART_GAP_S) {
  const sorted = videos.filter((v) => Number.isFinite(v.recordedAt)).sort((x, y) => x.recordedAt - y.recordedAt);
  const groups = [];
  for (const v of sorted) {
    const end = v.recordedAt + (v.duration ?? 0) * 1000;
    const last = groups.at(-1);
    if (last && v.recordedAt - last.end <= gapS * 1000) {
      last.ids.push(v.id);
      last.end = Math.max(last.end, end);
    } else {
      groups.push({ ids: [v.id], start: v.recordedAt, end });
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

/**
 * Lines groups up with matches (both in time order) without crossing.
 * @param {{ ids: number[], start: number, end: number }[]} groups
 * @param {{ id: number, startsAt: number, duration?: number|null }[]} matches
 * @returns {{ ids: number[], matchId: number, lateMin: number }[]}
 */
export function suggest(groups, matches) {
  const g = [...groups].sort((x, y) => x.start - y.start);
  const m = matches.filter((x) => Number.isFinite(x.startsAt)).sort((x, y) => x.startsAt - y.startsAt);
  // best[i][j]: lowest cost for the first i groups and first j matches.
  const best = Array.from({ length: g.length + 1 }, () => new Array(m.length + 1).fill(Infinity));
  const how = Array.from({ length: g.length + 1 }, () => new Array(m.length + 1).fill(null));
  for (let j = 0; j <= m.length; j++) best[0][j] = 0;
  for (let i = 1; i <= g.length; i++) {
    best[i][0] = best[i - 1][0] + UNMATCHED;
    how[i][0] = 'skipGroup';
    for (let j = 1; j <= m.length; j++) {
      const options = [
        [best[i][j - 1], 'skipMatch'],
        [best[i - 1][j] + UNMATCHED, 'skipGroup'],
        [best[i - 1][j - 1] + pairCost(g[i - 1].start, m[j - 1].startsAt, m[j - 1].duration, (g[i - 1].end - g[i - 1].start) / 60000), 'pair'],
      ];
      for (const [cost, step] of options) {
        if (cost < best[i][j]) {
          best[i][j] = cost;
          how[i][j] = step;
        }
      }
    }
  }
  const out = [];
  let i = g.length;
  let j = m.length;
  while (i > 0 && j >= 0) {
    const step = how[i][j];
    if (step === 'pair') {
      out.push({ ids: g[i - 1].ids, matchId: m[j - 1].id, lateMin: Math.round((g[i - 1].start - m[j - 1].startsAt) / 60000) });
      i -= 1;
      j -= 1;
    } else if (step === 'skipMatch') j -= 1;
    else i -= 1;
  }
  return out.reverse();
}

/**
 * One suggestion per video, as a match or game takes one video: a group of one
 * goes to the whole match (game 0); a group of several goes to the match's
 * games in recording order, as many as `gamesOf(matchId)` allows (the rest
 * stay unsuggested).
 * @returns {{ ids: [number], matchId: number, game: number, lateMin: number }[]}
 */
export function perVideo(suggestions, gamesOf) {
  return suggestions.flatMap((s) => (s.ids.length === 1
    ? [{ ...s, game: 0 }]
    : s.ids.slice(0, gamesOf(s.matchId)).map((id, i) => ({ ids: [id], matchId: s.matchId, game: i + 1, lateMin: s.lateMin }))));
}
