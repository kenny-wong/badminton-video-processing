// Importing a tournament: its name and dates (from badminfo, or BE's own
// page), then every match of every match day from BE's day pages (lib/schedule.js),
// saved into the database. Re-importing updates times, courts and results and
// keeps tagging. A badminfo import also saves everyone entered (lib/players.js).
// The page parsers are pure and tested in tests/tournaments.test.js.

import { apiUrl, entrants, getJson, summarize } from './badminfo.js';
import { saveEntrants } from './players.js';
import { consentCookie, decode, fetchDay, fetchPage, parseMatches, scheduleDays } from './schedule.js';
import { parseTournamentLink } from './links.js';
import { londonTime } from './uk-time.js';
import { nowIso } from './db.js';
import { settleServers } from './tagging.js';
import { labelGroupMatches } from './group-rounds.js';

export const MAX_MATCH_DAYS = 30;

/** Name and dates from BE's tournament page: "<name> | BADMINTON England" and its <time> tags. */
export function parseTournamentPage(html) {
  const title = decode(/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s*\|\s*BADMINTON England\s*$/i, '');
  const dates = [...html.matchAll(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
  return { name: title.slice(0, 120), start: dates[0] ?? null, end: dates[1] ?? dates[0] ?? null };
}

/** The days with matches, YYYYMMDD, from the links on BE's matches page. */
export function parseMatchDays(html) {
  return [...new Set([...html.matchAll(/\/matches\/(\d{8})(?!\d)/g)].map((m) => m[1]))].sort();
}

/** Reads a tournament from a badminfo or BE link. Throws Error with `code` 'badLink' | 'notFound' | 'unavailable'. */
export async function fetchTournament(link) {
  const parsed = parseTournamentLink(link);
  if (!parsed) throw Object.assign(new Error('Not a badminfo or Badminton England tournament link'), { code: 'badLink' });
  let info = { badminfoId: null, beId: parsed.kind === 'be' ? parsed.id : null, name: '', start: null, end: null };
  if (parsed.kind === 'badminfo') {
    const got = await getJson(apiUrl(parsed.id), 60);
    if (got.error) throw Object.assign(new Error(`badminfo: ${got.error}`), { code: got.error });
    const t = summarize(got.json, parsed.id);
    if (!t?.beId) throw Object.assign(new Error('badminfo has no Badminton England link for this tournament'), { code: 'notFound' });
    info = { badminfoId: parsed.id, beId: t.beId, name: t.name, start: t.start, end: t.end, players: entrants(got.json) };
  }
  let cookie;
  let days;
  try {
    cookie = await consentCookie();
    if (!info.name) Object.assign(info, parseTournamentPage(await fetchPage(`/tournament/${info.beId}`, cookie)));
    days = parseMatchDays(await fetchPage(`/tournament/${info.beId}/matches`, cookie)).slice(0, MAX_MATCH_DAYS);
    // A one-day tournament's matches page lists no days: read the tournament's own dates instead.
    if (!days.length) days = scheduleDays(info.start, info.end) ?? [];
  } catch (err) {
    throw Object.assign(new Error(`Badminton England's pages couldn't be read (${err.message})`), { code: 'unavailable' });
  }
  if (!info.name) throw Object.assign(new Error('Tournament not found on Badminton England'), { code: 'notFound' });
  const matches = [];
  for (const day of days) matches.push(...parseMatches(await fetchDay(info.beId, day, cookie), day));
  return { ...info, matches };
}

/** Saves a fetched tournament and its matches; returns the tournament's row id. */
export function saveTournament(db, t) {
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO tournaments (be_id, badminfo_id, name, start_date, end_date) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (be_id) DO UPDATE SET badminfo_id = COALESCE(excluded.badminfo_id, badminfo_id), name = excluded.name,
        start_date = excluded.start_date, end_date = excluded.end_date, imported_at = ?`)
      .run(t.beId, t.badminfoId, t.name, t.start, t.end, nowIso());
    const { id } = db.prepare('SELECT id FROM tournaments WHERE be_id = ?').get(t.beId);
    const upsert = db.prepare(`INSERT INTO matches (tournament_id, match_date, match_time, starts_at, draw, round, court, duration, team_a, team_b, games, winner)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tournament_id, draw, round, team_a, team_b, game) DO UPDATE SET match_date = excluded.match_date, match_time = excluded.match_time,
        starts_at = excluded.starts_at, court = excluded.court, duration = excluded.duration, games = excluded.games, winner = excluded.winner, updated_at = ?`);
    for (const m of t.matches) {
      const at = m.time ? new Date(londonTime(m.date, m.time)).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
      upsert.run(id, m.date, m.time || '00:00', at, m.draw, m.round, m.court, m.duration, JSON.stringify(m.teams[0]), JSON.stringify(m.teams[1]),
        JSON.stringify(m.games), m.winner, nowIso());
    }
    if (t.players?.length) saveEntrants(db, id, t.players);
    // A game's own row follows its match's time, court and result.
    db.prepare(`UPDATE matches AS g SET match_date = p.match_date, match_time = p.match_time, starts_at = p.starts_at, court = p.court,
        duration = p.duration, games = p.games, winner = p.winner FROM matches AS p WHERE g.parent_id = p.id AND p.tournament_id = ?`).run(id);
    settleServers(db, { tournamentId: id });
    db.exec('COMMIT');
    labelGroupMatches(db, { tournamentId: id });
    return id;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
