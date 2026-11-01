// Players in the database: everyone entered in an imported badminfo
// tournament (with grades and ratings), whose profiles are read from badminfo
// when needed (favourites' after an import, a match's when its editor opens,
// one player's on their page), at most every few hours.

import { getJson, playerApiUrl, playerProfile } from './badminfo.js';
import { nowIso, parseJson } from './db.js';
import { disciplineOf, isUpset, matchChance, resultWinner, standing } from '../public/shared/players.js';

export const PROFILE_MAX_AGE_MS = 6 * 3600 * 1000;

/** A players row as the API shows it (`rubbers` only when asked for). */
export function playerFromRow(r, { rubbers = false } = {}) {
  return r && {
    id: r.id,
    name: r.name,
    beNumber: r.be_number || '',
    county: r.county || '',
    grades: parseJson(r.grades, { singles: '', doubles: '', mixed: '' }),
    ratings: parseJson(r.ratings, { singles: null, doubles: null, mixed: null }),
    ratingsDate: r.ratings_date,
    fetchedAt: r.fetched_at,
    ...(rubbers ? { rubbers: parseJson(r.rubbers, []) } : {}),
  };
}

/** Saves badminfo's entrants of a tournament and ties their names to it. */
export function saveEntrants(db, tournamentId, list) {
  const put = db.prepare(`INSERT INTO players (id, name, grades, ratings, ratings_date, seen_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, seen_at = excluded.seen_at,
      grades = CASE WHEN players.ratings_date IS NULL OR excluded.ratings_date >= players.ratings_date THEN excluded.grades ELSE players.grades END,
      ratings = CASE WHEN players.ratings_date IS NULL OR excluded.ratings_date >= players.ratings_date THEN excluded.ratings ELSE players.ratings END,
      ratings_date = CASE WHEN players.ratings_date IS NULL OR excluded.ratings_date >= players.ratings_date THEN excluded.ratings_date ELSE players.ratings_date END`);
  const tie = db.prepare('INSERT INTO tournament_players (tournament_id, name, player_id) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET player_id = excluded.player_id');
  const now = nowIso();
  for (const p of list) {
    put.run(p.id, p.name, JSON.stringify(p.grades), JSON.stringify(p.ratings), p.ratingsDate, now);
    tie.run(tournamentId, p.name, p.id);
  }
}

/** Saves a profile read from badminfo. */
export function saveProfile(db, p) {
  db.prepare(`INSERT INTO players (id, name, be_number, county, grades, ratings, ratings_date, rubbers, fetched_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, be_number = excluded.be_number, county = excluded.county, grades = excluded.grades,
      ratings = excluded.ratings, ratings_date = excluded.ratings_date, rubbers = excluded.rubbers, fetched_at = excluded.fetched_at`)
    .run(p.id, p.name, p.beNumber, p.county, JSON.stringify(p.grades), JSON.stringify(p.ratings), p.ratingsDate, JSON.stringify(p.rubbers), nowIso(), nowIso());
}

/**
 * Reads a player's profile from badminfo unless it was read in the last few
 * hours. Never throws: a failed read leaves what was there.
 * @returns {Promise<boolean>} whether it was read now.
 */
export async function refreshProfile(db, id, { maxAge = PROFILE_MAX_AGE_MS, fetchJson = getJson } = {}) {
  const row = db.prepare('SELECT fetched_at FROM players WHERE id = ?').get(id);
  if (row?.fetched_at && Date.now() - Date.parse(row.fetched_at) < maxAge) return false;
  const got = await fetchJson(playerApiUrl(id), 3600);
  const p = got.json && playerProfile(got.json, id);
  if (!p) return false;
  saveProfile(db, p);
  return true;
}

/** Reads several profiles, two at a time. */
export async function refreshProfiles(db, ids, opts) {
  const queue = [...new Set(ids.filter(Boolean))];
  let read = 0;
  const worker = async () => {
    while (queue.length) if (await refreshProfile(db, queue.shift(), opts).catch(() => false)) read += 1;
  };
  await Promise.all([worker(), worker()]);
  return read;
}

/** The badminfo ids of a team's players in a tournament ('' when unknown). */
export function teamIds(db, tournamentId, team) {
  const find = db.prepare('SELECT player_id FROM tournament_players WHERE tournament_id = ? AND name = ?');
  return (team ?? []).map((n) => find.get(tournamentId, n)?.player_id ?? '');
}

/**
 * For a tournament page: a function giving each match its players' badminfo
 * ids, rating and grade for the match's discipline, the win chance and
 * whether the result was an upset. Reads the tournament's players once.
 */
export function tournamentPeople(db, tournament) {
  const rows = db.prepare(`SELECT tp.name AS entry, p.* FROM tournament_players tp JOIN players p ON p.id = tp.player_id WHERE tp.tournament_id = ?`).all(tournament.id);
  const byName = new Map(rows.map((r) => [r.entry.toLowerCase(), r]));
  const profiles = rows.filter((r) => r.rubbers).map((r) => playerFromRow(r, { rubbers: true }));
  return (match) => {
    if (!rows.length) return null;
    const discipline = disciplineOf(match.draw);
    const found = [match.teamA, match.teamB].map((team) => team.map((n) => byName.get(String(n).toLowerCase()) ?? null));
    const ids = found.map((team) => team.map((r) => r?.id ?? ''));
    const chance = matchChance({ tournamentId: tournament.badminfoId, ids, profiles });
    const winner = resultWinner(match);
    return {
      ids,
      teams: found.map((team) => team.map((r) => standing(playerFromRow(r), discipline))),
      chance: chance?.a ?? null,
      upset: chance ? isUpset(chance.a, winner) : false,
    };
  };
}

/**
 * A match's players for the page: both teams with each player's id, rating
 * and grade for the match's discipline, badminfo's win chance, and whether
 * the result was an upset.
 */
export function matchPeople(db, { match, tournament }) {
  const ids = [teamIds(db, tournament.id, match.teamA), teamIds(db, tournament.id, match.teamB)];
  const rows = new Map(db.prepare(`SELECT * FROM players WHERE id IN (${ids.flat().map(() => '?').join(',') || "''"})`).all(...ids.flat()).map((r) => [r.id, r]));
  const discipline = disciplineOf(match.draw);
  const teams = [match.teamA, match.teamB].map((team, k) => team.map((name, i) => {
    const player = playerFromRow(rows.get(ids[k][i]));
    return { name, id: ids[k][i] || null, county: player?.county ?? '', fetched: Boolean(player?.fetchedAt), ...standing(player, discipline) };
  }));
  const profiles = [...rows.values()].filter((r) => r.rubbers).map((r) => playerFromRow(r, { rubbers: true }));
  const chance = matchChance({ tournamentId: tournament.badminfoId, ids, profiles });
  const winner = resultWinner(match);
  return { discipline, teams, chance, winner, upset: chance ? isUpset(chance.a, winner) : false };
}
