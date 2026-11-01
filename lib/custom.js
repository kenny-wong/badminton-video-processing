// Custom tournaments: made by hand on the Tournaments page instead of imported.
// Everything about them can be edited (name, dates, venue, scoring), matches
// are added, changed and deleted by hand, and players from the Players list are
// assigned to them. Their matches are ordinary match rows, so linking videos,
// tagging and rendering work as for imported ones. Tested in tests/custom.test.js.

import { matchFromRow, nowIso, tournamentFromRow } from './db.js';
import { londonDate, londonTime } from './uk-time.js';
import { cleanFormat, gameOver, parseGames } from '../public/shared/score.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const badInput = (message) => Object.assign(new Error(message), { code: 'badInput' });

/** A tournament's details from a form: { name, start, end, venue, format }; throws a badInput error. */
export function cleanTournament(input, current = {}) {
  const name = input.name === undefined ? current.name : text(input.name, 120);
  if (!name) throw badInput('Give the tournament a name');
  const start = input.start === undefined ? current.start ?? null : input.start || null;
  const end = input.end === undefined ? current.end ?? null : input.end || null;
  for (const d of [start, end]) if (d !== null && !DATE.test(d)) throw badInput('Dates are like 2026-10-24');
  if (start && end && end < start) throw badInput('The last day can’t be before the first');
  const venue = input.venue === undefined ? current.venue ?? null : text(input.venue, 120) || null;
  const format = input.format === undefined ? current.format ?? null : input.format ? cleanFormat(input.format) : null;
  return { name, start, end: end ?? start, venue, format };
}

/** Makes a custom tournament (dated today in the UK until edited); returns its id. */
export function createCustom(db, input, today = londonDate(Date.now())) {
  const t = cleanTournament({ start: today, ...input });
  return Number(db.prepare("INSERT INTO tournaments (kind, name, start_date, end_date, venue, format) VALUES ('custom', ?, ?, ?, ?, ?)")
    .run(t.name, t.start, t.end, t.venue, t.format ? JSON.stringify(t.format) : null).lastInsertRowid);
}

/** The custom tournament with that id, or null (imported ones can't be edited). */
export function customTournament(db, id) {
  const t = tournamentFromRow(db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id));
  return t?.kind === 'custom' ? t : null;
}

/**
 * Changes a custom tournament's details. A new scoring format also goes to its
 * matches that still had the old one (a format chosen for one match stays).
 */
export function updateCustom(db, id, input) {
  const current = customTournament(db, id);
  if (!current) return null;
  const t = cleanTournament(input, current);
  db.prepare('UPDATE tournaments SET name = ?, start_date = ?, end_date = ?, venue = ?, format = ? WHERE id = ?')
    .run(t.name, t.start, t.end, t.venue, t.format ? JSON.stringify(t.format) : null, id);
  const was = current.format ? JSON.stringify(cleanFormat(current.format)) : null;
  const now = t.format ? JSON.stringify(t.format) : null;
  if (now !== was) {
    db.prepare(`UPDATE matches SET format = ?, updated_at = ? WHERE tournament_id = ? AND (format IS NULL OR format = ?)`).run(now, nowIso(), id, was ?? '');
  }
  return t;
}

/** 1 or 2 when the games decide the match under the format, else null. */
export function winnerOf(games, format) {
  const f = cleanFormat(format);
  const need = f.bestOf === 1 ? 1 : 2;
  let a = 0;
  let b = 0;
  for (const g of games) {
    const side = gameOver(g, f);
    if (side === 'a') a += 1;
    if (side === 'b') b += 1;
  }
  return a >= need ? 1 : b >= need ? 2 : null;
}

/** A team from a form: one or two names. */
function team(value, label) {
  const names = (Array.isArray(value) ? value : [value]).map((n) => text(n, 80)).filter(Boolean);
  if (!names.length) throw badInput(`Choose or type the player${label === 'A' ? '' : 's'} on side ${label}`);
  if (names.length > 2) throw badInput('A side has one or two players');
  return names;
}

/**
 * A match from a form: { date, time, draw, round, court, teamA, teamB, games,
 * winner, format }. `games` may be text ("21-15 18-21 21-19") or pairs; the
 * winner follows from them. Throws a badInput error.
 */
export function cleanMatch(input, tournament) {
  const date = input.date || tournament.start;
  if (!DATE.test(date ?? '')) throw badInput('Give the match a date, like 2026-10-24');
  const time = input.time || '00:00';
  if (!TIME.test(time)) throw badInput('Times are like 09:30');
  const games = typeof input.games === 'string' ? parseGames(input.games) ?? (input.games.trim() ? null : []) : Array.isArray(input.games) ? input.games : [];
  if (!games || games.some((g) => !Array.isArray(g) || g.length !== 2 || !g.every((n) => Number.isInteger(n) && n >= 0 && n <= 99))) {
    throw badInput('Write the result like 21-15 18-21 21-19 (side A’s points first), or leave it empty');
  }
  if (games.length > 5) throw badInput('At most five games');
  const format = input.format ? cleanFormat(input.format) : tournament.format ? cleanFormat(tournament.format) : null;
  return {
    date, time, draw: text(input.draw, 80), round: text(input.round, 80), court: text(input.court, 80),
    teamA: team(input.teamA, 'A'), teamB: team(input.teamB, 'B'), games, winner: winnerOf(games, format), format,
  };
}

const conflict = (err) => (String(err?.message).includes('UNIQUE') ? Object.assign(new Error('There’s already a match with the same event, round and players: change the round'), { code: 'conflict' }) : err);

/** Adds a match to a custom tournament; a match without a round is called “Match n”. Returns its id. */
export function addMatch(db, tournamentId, input) {
  const t = customTournament(db, tournamentId);
  if (!t) return null;
  const m = cleanMatch(input, t);
  if (!m.round) m.round = `Match ${db.prepare('SELECT COUNT(*) AS n FROM matches WHERE tournament_id = ? AND game = 0').get(tournamentId).n + 1}`;
  try {
    return Number(db.prepare(`INSERT INTO matches (tournament_id, match_date, match_time, starts_at, draw, round, court, team_a, team_b, games, winner, format)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(tournamentId, m.date, m.time, new Date(londonTime(m.date, m.time)).toISOString(), m.draw, m.round, m.court,
      JSON.stringify(m.teamA), JSON.stringify(m.teamB), JSON.stringify(m.games), m.winner, m.format ? JSON.stringify(m.format) : null).lastInsertRowid);
  } catch (err) {
    throw conflict(err);
  }
}

/** The match with that id when it's a whole match (not a game's row) in a custom tournament, else null. */
export function customMatch(db, tournamentId, matchId) {
  const m = matchFromRow(db.prepare('SELECT * FROM matches WHERE id = ? AND tournament_id = ? AND game = 0').get(matchId, tournamentId));
  return m && customTournament(db, tournamentId) ? m : null;
}

/** Changes a custom tournament's match; its games' rows follow its time, court and result. Tagging and videos stay. */
export function updateMatch(db, tournamentId, matchId, input) {
  const current = customMatch(db, tournamentId, matchId);
  if (!current) return null;
  const t = customTournament(db, tournamentId);
  const m = cleanMatch({ ...input, format: input.format === undefined ? current.format : input.format }, t);
  const startsAt = new Date(londonTime(m.date, m.time)).toISOString();
  try {
    db.prepare(`UPDATE matches SET match_date = ?, match_time = ?, starts_at = ?, draw = ?, round = ?, court = ?, team_a = ?, team_b = ?, games = ?, winner = ?, format = ?, updated_at = ?
      WHERE id = ?`).run(m.date, m.time, startsAt, m.draw, m.round || current.round, m.court, JSON.stringify(m.teamA), JSON.stringify(m.teamB),
      JSON.stringify(m.games), m.winner, m.format ? JSON.stringify(m.format) : null, nowIso(), matchId);
  } catch (err) {
    throw conflict(err);
  }
  db.prepare(`UPDATE matches SET match_date = ?, match_time = ?, starts_at = ?, draw = ?, round = ?, court = ?, team_a = ?, team_b = ?, games = ?, winner = ?, updated_at = ?
    WHERE parent_id = ?`).run(m.date, m.time, startsAt, m.draw, m.round || current.round, m.court, JSON.stringify(m.teamA), JSON.stringify(m.teamB),
    JSON.stringify(m.games), m.winner, nowIso(), matchId);
  return m;
}

/** Deletes a custom tournament's match with its games' rows; its videos become unlinked (the files stay). */
export function deleteMatch(db, tournamentId, matchId) {
  if (!customMatch(db, tournamentId, matchId)) return false;
  db.prepare('DELETE FROM matches WHERE id = ? OR parent_id = ?').run(matchId, matchId);
  return true;
}

/** The listed players assigned to a custom tournament: [{ key, name, id, starred }]. */
export function rosterOf(db, tournamentId) {
  return db.prepare(`SELECT f.id AS key, f.name, f.player_id AS id, f.starred FROM tournament_roster r JOIN favourites f ON f.id = r.favourite_id
    WHERE r.tournament_id = ? ORDER BY f.name COLLATE NOCASE`).all(tournamentId).map((r) => ({ key: r.key, name: r.name, id: r.id, starred: Boolean(r.starred) }));
}

/** Sets which listed players are in a custom tournament; unknown keys are ignored. */
export function setRoster(db, tournamentId, keys) {
  if (!customTournament(db, tournamentId)) return null;
  const known = new Set(db.prepare('SELECT id FROM favourites').all().map((r) => r.id));
  db.prepare('DELETE FROM tournament_roster WHERE tournament_id = ?').run(tournamentId);
  const add = db.prepare('INSERT OR IGNORE INTO tournament_roster (tournament_id, favourite_id) VALUES (?, ?)');
  for (const k of keys) if (known.has(k)) add.run(tournamentId, k);
  return rosterOf(db, tournamentId);
}
