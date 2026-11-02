// The Players list: players added by name or badminfo link, each a favourite
// (★, starred) or not. Favourites are whose matches the tournament pages pick
// out and suggest videos for, whose profiles are read after an import, and
// whose side the editor's scouting takes; unstarring keeps a player on the
// list (for custom tournaments) until removed. A listed player is a badminfo
// player, or only a name. Tested in tests/favourites.test.js.

import { parseJson } from './db.js';
import { namesMatch } from '../public/shared/names.js';

/** Moves a duplicate entry's custom-tournament places and star onto `keep`, then deletes it. */
function mergeInto(db, gone, keep) {
  db.prepare('INSERT OR IGNORE INTO tournament_roster (tournament_id, favourite_id) SELECT tournament_id, ? FROM tournament_roster WHERE favourite_id = ?').run(keep, gone);
  db.prepare('UPDATE favourites SET starred = MAX(starred, (SELECT starred FROM favourites WHERE id = ?)) WHERE id = ?').run(gone, keep);
  db.prepare('DELETE FROM favourites WHERE id = ?').run(gone);
}

/**
 * The listed players in the list's order (players never moved come after, by
 * name), each with its badminfo id: only the favourites
 * (★), or with `all` everyone on the list. A name-only one is tied to its
 * player (taking the player's name) once exactly one known player matches it;
 * `candidates` counts them when several do.
 * @returns {{ key: number, name: string, id: string|null, candidates: number, starred: boolean }[]}
 */
export function favourites(db, { all = false } = {}) {
  const rows = db.prepare('SELECT id, name, player_id, starred FROM favourites ORDER BY position IS NULL, position, name COLLATE NOCASE, id').all();
  const taken = new Map(rows.filter((r) => r.player_id).map((r) => [r.player_id, r.id]));
  let known = null;
  const out = [];
  const merged = new Set(); // keys that took over a starred duplicate
  for (const r of rows) {
    const starred = Boolean(r.starred);
    if (r.player_id) {
      out.push({ key: r.id, name: r.name, id: r.player_id, candidates: 0, starred });
      continue;
    }
    known ??= db.prepare('SELECT id, name FROM players').all();
    const found = [...new Map(known.filter((p) => namesMatch(r.name, p.name)).map((p) => [p.id, p])).values()];
    if (found.length === 1 && taken.has(found[0].id)) {
      mergeInto(db, r.id, taken.get(found[0].id)); // the same player, listed again since
      if (starred) merged.add(taken.get(found[0].id));
      continue;
    }
    if (found.length === 1) {
      db.prepare('UPDATE favourites SET player_id = ?, name = ? WHERE id = ?').run(found[0].id, found[0].name, r.id);
      taken.set(found[0].id, r.id);
      out.push({ key: r.id, name: found[0].name, id: found[0].id, candidates: 0, starred });
      continue;
    }
    out.push({ key: r.id, name: r.name, id: null, candidates: found.length > 1 ? found.length : 0, starred });
  }
  for (const f of out) if (merged.has(f.key)) f.starred = true;
  return all ? out : out.filter((f) => f.starred);
}

/** Lists a badminfo player (`id`, with their name) or a name, starred unless `starred` is false; returns the key. An entry already there is starred if asked. */
export function addFavourite(db, { id = null, name, starred = true }) {
  const same = id
    ? db.prepare('SELECT id FROM favourites WHERE player_id = ?').get(id)
    : db.prepare('SELECT id FROM favourites WHERE player_id IS NULL AND name = ? COLLATE NOCASE').get(name);
  if (same) {
    if (starred) setStarred(db, same.id, true);
    return same.id;
  }
  return Number(db.prepare('INSERT INTO favourites (name, player_id, starred) VALUES (?, ?, ?)').run(name, id, starred ? 1 : 0).lastInsertRowid);
}

/** Stars or unstars a listed player (unstarred ones stay on the list); false when there's no such entry. */
export function setStarred(db, key, starred) {
  return db.prepare('UPDATE favourites SET starred = ? WHERE id = ?').run(starred ? 1 : 0, key).changes > 0;
}

/** Ties a name-only entry to a badminfo player; returns the key it ends up under (another one when that player was listed already). */
export function linkFavourite(db, key, id, name) {
  const other = db.prepare('SELECT id FROM favourites WHERE player_id = ? AND id <> ?').get(id, key);
  if (other) {
    mergeInto(db, key, other.id);
    return other.id;
  }
  db.prepare('UPDATE favourites SET player_id = ?, name = ? WHERE id = ?').run(id, name, key);
  return key;
}

/** Puts the listed players in the order of `keys` (the others keep their places after them); returns how many moved. */
export function orderFavourites(db, keys) {
  const set = db.prepare('UPDATE favourites SET position = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    let n = 0;
    keys.forEach((key, i) => { n += set.run(i, key).changes; });
    db.exec('COMMIT');
    return n;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Takes a player off the list (and out of custom tournaments' players). */
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
  // Assigned to a custom tournament.
  for (const r of db.prepare('SELECT tournament_id, favourite_id FROM tournament_roster').all()) {
    if (out[r.favourite_id]) out[r.favourite_id][r.tournament_id] ??= 0;
  }
  let tid = null;
  let sides = null;
  for (const r of db.prepare('SELECT tournament_id, team_a, team_b FROM matches WHERE game = 0 ORDER BY tournament_id').all()) {
    if (r.tournament_id !== tid) [tid, sides] = [r.tournament_id, favouriteMatcher(db, r.tournament_id, favs)];
    for (const k of new Set([...sides(parseJson(r.team_a, [])), ...sides(parseJson(r.team_b, []))])) out[k][tid] = (out[k][tid] ?? 0) + 1;
  }
  return out;
}
