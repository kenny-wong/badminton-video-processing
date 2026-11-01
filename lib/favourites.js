// Favourite players (★ on the Players tab): whose matches the tournament
// pages pick out and suggest videos for, whose profiles are read after an
// import, and whose side the editor's scouting takes. A favourite is a
// badminfo player, or only a name for players in Badminton England-only
// imports. Tested in tests/favourites.test.js.

import { parseJson } from './db.js';
import { namesMatch } from '../public/shared/names.js';

/**
 * The favourites by name, each with its badminfo id. A name-only one is tied
 * to its player (taking the player's name) once exactly one known player
 * matches it; `candidates` counts them when several do.
 * @returns {{ key: number, name: string, id: string|null, candidates: number }[]}
 */
export function favourites(db) {
  const rows = db.prepare('SELECT id, name, player_id FROM favourites ORDER BY name COLLATE NOCASE, id').all();
  const taken = new Set(rows.map((r) => r.player_id).filter(Boolean));
  let all = null;
  const out = [];
  for (const r of rows) {
    if (r.player_id) {
      out.push({ key: r.id, name: r.name, id: r.player_id, candidates: 0 });
      continue;
    }
    all ??= db.prepare('SELECT id, name FROM players').all();
    const found = [...new Map(all.filter((p) => namesMatch(r.name, p.name)).map((p) => [p.id, p])).values()];
    if (found.length === 1 && taken.has(found[0].id)) {
      db.prepare('DELETE FROM favourites WHERE id = ?').run(r.id); // the same player, starred again since
      continue;
    }
    if (found.length === 1) {
      db.prepare('UPDATE favourites SET player_id = ?, name = ? WHERE id = ?').run(found[0].id, found[0].name, r.id);
      taken.add(found[0].id);
      out.push({ key: r.id, name: found[0].name, id: found[0].id, candidates: 0 });
      continue;
    }
    out.push({ key: r.id, name: r.name, id: null, candidates: found.length > 1 ? found.length : 0 });
  }
  return out;
}

/** Stars a badminfo player (`id`, with their name) or a name; returns the favourite's key. */
export function addFavourite(db, { id = null, name }) {
  const same = id
    ? db.prepare('SELECT id FROM favourites WHERE player_id = ?').get(id)
    : db.prepare('SELECT id FROM favourites WHERE player_id IS NULL AND name = ? COLLATE NOCASE').get(name);
  if (same) return same.id;
  return Number(db.prepare('INSERT INTO favourites (name, player_id) VALUES (?, ?)').run(name, id).lastInsertRowid);
}

/** Ties a name-only favourite to a badminfo player; returns the key it ends up under (another one when that player was starred already). */
export function linkFavourite(db, key, id, name) {
  const other = db.prepare('SELECT id FROM favourites WHERE player_id = ? AND id <> ?').get(id, key);
  if (other) {
    db.prepare('DELETE FROM favourites WHERE id = ?').run(key);
    return other.id;
  }
  db.prepare('UPDATE favourites SET player_id = ?, name = ? WHERE id = ?').run(id, name, key);
  return key;
}

export function removeFavourite(db, key) {
  return db.prepare('DELETE FROM favourites WHERE id = ?').run(key).changes > 0;
}

/**
 * For one tournament: a function giving the keys of the favourites in a team
 * (an array of names). A name in the tournament's badminfo entrants counts by
 * id, so a namesake isn't picked out; other names count by name.
 */
export function favouriteMatcher(db, tournamentId, favs) {
  const entries = new Map(favs.length
    ? db.prepare('SELECT name, player_id FROM tournament_players WHERE tournament_id = ?').all(tournamentId).map((r) => [r.name.toLowerCase(), r.player_id])
    : []);
  return (team) => {
    const keys = new Set();
    for (const n of team ?? []) {
      const pid = entries.get(String(n).toLowerCase());
      for (const f of favs) if (pid && f.id ? f.id === pid : namesMatch(f.name, n)) keys.add(f.key);
    }
    return [...keys];
  };
}

/**
 * The tournaments each favourite joined: entered (badminfo) or in a match.
 * @returns {Record<number, Record<number, number>>} key -> tournament id -> their matches there.
 */
export function favouriteTournaments(db, favs) {
  const out = Object.fromEntries(favs.map((f) => [f.key, {}]));
  if (!favs.length) return out;
  const byId = new Map(favs.filter((f) => f.id).map((f) => [f.id, f.key]));
  for (const r of db.prepare('SELECT DISTINCT tournament_id, player_id FROM tournament_players').all()) {
    if (byId.has(r.player_id)) out[byId.get(r.player_id)][r.tournament_id] ??= 0;
  }
  let tid = null;
  let sides = null;
  for (const r of db.prepare('SELECT tournament_id, team_a, team_b FROM matches WHERE game = 0 ORDER BY tournament_id').all()) {
    if (r.tournament_id !== tid) [tid, sides] = [r.tournament_id, favouriteMatcher(db, r.tournament_id, favs)];
    for (const k of new Set([...sides(parseJson(r.team_a, [])), ...sides(parseJson(r.team_b, []))])) out[k][tid] = (out[k][tid] ?? 0) + 1;
  }
  return out;
}
