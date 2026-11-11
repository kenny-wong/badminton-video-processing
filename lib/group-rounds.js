// Group (round-robin) matches numbered in the order they were played.
// Badminton England's "Round n" in a group is the match's place in the
// fixture list, not when it's played: organisers often play Round 3 before
// Round 2. A group draw is one whose every round is "Round n" (knockouts use
// "Round of 16", "Quarter final" and so on). Each side of a match gets the
// match's place among that side's own group matches by start time; the label
// is "Group match k", or "Match k" when the draw's name says Group already
// ("XD U15 - Group A Match 2"). In a group with an odd number of entries someone sits
// out each round, so the two sides can be on different numbers: the side with
// a starred player wins, else both are shown ("Group match 1/2").
// The label goes in matches.round_label (the match's game rows too); the
// stored round stays BE's, as it's part of the match's identity on re-import.
// Tested in tests/group-rounds.test.js.

import { favouriteMatcher, favourites } from './favourites.js';

const ROUND_N = /^Round (\d+)$/;
const teamKey = (team) => team.map((n) => String(n).trim().toLowerCase()).sort().join(' / ');

/**
 * Labels for one tournament's matches (game 0 only).
 * @param {{ id: number, draw: string, round: string, date: string, time: string, teamA: string[], teamB: string[] }[]} matches
 * @param {(team: string[]) => boolean} [isMine] whether a side has a starred player
 * @returns {Map<number, string>} match id -> label, only for group matches
 */
export function groupLabels(matches, isMine = () => false) {
  const draws = new Map();
  for (const m of matches) {
    if (!draws.has(m.draw)) draws.set(m.draw, []);
    draws.get(m.draw).push(m);
  }
  const out = new Map();
  for (const [draw, list] of draws) {
    if (!list.every((m) => ROUND_N.test(m.round))) continue;
    const word = /\bgroup\b/i.test(draw) ? 'Match' : 'Group match';
    const num = (m) => Number(ROUND_N.exec(m.round)[1]);
    const byPlay = (x, y) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`) || num(x) - num(y) || x.id - y.id;
    const place = new Map(); // `${id}|${team}` -> k
    const sides = new Map();
    for (const m of list) for (const t of [m.teamA, m.teamB]) {
      const key = teamKey(t);
      if (!sides.has(key)) sides.set(key, []);
      sides.get(key).push(m);
    }
    for (const [key, own] of sides) own.sort(byPlay).forEach((m, i) => place.set(`${m.id}|${key}`, i + 1));
    for (const m of list) {
      const a = place.get(`${m.id}|${teamKey(m.teamA)}`);
      const b = place.get(`${m.id}|${teamKey(m.teamB)}`);
      const mineA = isMine(m.teamA), mineB = isMine(m.teamB);
      const k = a === b ? a : mineA && !mineB ? a : mineB && !mineA ? b : `${a}/${b}`;
      out.set(m.id, `${word} ${k}`);
    }
  }
  return out;
}

/**
 * Writes the labels into matches.round_label for one tournament, or every imported one;
 * clears it where a match is no longer in a group. Returns how many rows changed.
 */
export function labelGroupMatches(db, { tournamentId = null } = {}) {
  const tournaments = db.prepare(`SELECT id FROM tournaments WHERE kind <> 'custom'${tournamentId ? ' AND id = ?' : ''}`).all(...(tournamentId ? [tournamentId] : []));
  const favs = favourites(db);
  const read = db.prepare('SELECT id, draw, round, match_date, match_time, team_a, team_b, round_label FROM matches WHERE tournament_id = ? AND game = 0');
  const write = db.prepare('UPDATE matches SET round_label = ? WHERE (id = ? OR parent_id = ?) AND round_label IS NOT ?');
  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const { id } of tournaments) {
      const rows = read.all(id);
      const parse = (s) => { try { return JSON.parse(s); } catch { return []; } };
      const matches = rows.map((r) => ({ id: r.id, draw: r.draw, round: r.round, date: r.match_date, time: r.match_time, teamA: parse(r.team_a), teamB: parse(r.team_b) }));
      const mine = favs.length ? favouriteMatcher(db, id, favs) : () => [];
      const labels = groupLabels(matches, (team) => mine(team).length > 0);
      for (const r of rows) changed += write.run(labels.get(r.id) ?? null, r.id, r.id, labels.get(r.id) ?? null).changes;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return changed;
}
