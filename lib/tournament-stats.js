// Progress on the Tournaments page's cards, for one favourite player's matches
// or for all the favourites' together: how many of their matches and games have
// video, how many of those games are tagged, how many videos are rendered, how
// many renders are on YouTube.
// Tested in tests/tournament-stats.test.js.

import { parseJson } from './db.js';
import { favouriteMatcher } from './favourites.js';

/**
 * The counts for a set of whole matches, each { games, linked, output, youtube,
 * tagged, rows } where rows are its games' own rows ({ game, linked, output,
 * youtube, tagged }). A match's games are its played games (at least one, for a
 * match not played yet); one whole-match video films all of them. Every filmed
 * game needs tagging: `taggedGames` counts those whose video has rallies, each
 * with a winner (a whole-match video's games all at once).
 */
export function progress(list, total) {
  const s = { total, matches: list.length, filmedMatches: 0, games: 0, filmedGames: 0, taggedGames: 0, videos: 0, rendered: 0, uploaded: 0 };
  for (const m of list) {
    const games = Math.max(m.games.length, ...m.rows.map((r) => r.game), 1);
    const filmed = m.linked ? games : m.rows.filter((r) => r.linked && r.game <= games).length;
    s.games += games;
    s.filmedGames += filmed;
    if (filmed === games) s.filmedMatches += 1;
    if (m.linked && m.tagged) s.taggedGames += games;
    else if (!m.linked) s.taggedGames += m.rows.filter((r) => r.linked && r.tagged && r.game <= games).length;
    for (const u of [...(m.linked ? [m] : []), ...m.rows.filter((r) => r.linked)]) {
      s.videos += 1;
      if (u.output) s.rendered += 1;
      if (u.output && u.youtube) s.uploaded += 1;
    }
  }
  return s;
}

/**
 * Every tournament's progress: { [tournamentId]: { mine, players: { [key]: counts } } },
 * `mine` over the matches with any favourite, `players` per favourite with matches there.
 */
export function tournamentStats(db, favs) {
  // Tagged: it has rallies and none is still without a winner (A, B or let).
  const rows = db.prepare(`SELECT m.id, m.tournament_id, m.parent_id, m.game, m.team_a, m.team_b, m.games, m.output_path, m.youtube_url,
      EXISTS (SELECT 1 FROM videos v WHERE v.match_id = m.id) AS linked,
      (json_valid(m.rallies) AND json_array_length(m.rallies) > 0
        AND NOT EXISTS (SELECT 1 FROM json_each(m.rallies) j WHERE json_extract(j.value, '$.winner') IS NULL)) AS tagged
    FROM matches m ORDER BY m.tournament_id, m.game`).all();
  const unit = (r) => ({ game: r.game, linked: Boolean(r.linked), output: Boolean(r.output_path), youtube: Boolean(r.youtube_url), tagged: Boolean(r.tagged) });
  const byTournament = new Map();
  const parents = new Map();
  for (const r of rows) {
    if (r.game) continue;
    const m = { ...unit(r), teamA: parseJson(r.team_a, []), teamB: parseJson(r.team_b, []), games: parseJson(r.games, []), rows: [] };
    parents.set(r.id, m);
    if (!byTournament.has(r.tournament_id)) byTournament.set(r.tournament_id, []);
    byTournament.get(r.tournament_id).push(m);
  }
  for (const r of rows) if (r.game && parents.has(r.parent_id)) parents.get(r.parent_id).rows.push(unit(r));
  const out = {};
  for (const [tid, list] of byTournament) {
    const sides = favs.length ? favouriteMatcher(db, tid, favs) : () => [];
    const keysOf = new Map(list.map((m) => [m, new Set([...sides(m.teamA), ...sides(m.teamB)])]));
    const players = {};
    for (const f of favs) {
      const theirs = list.filter((m) => keysOf.get(m).has(f.key));
      if (theirs.length) players[f.key] = progress(theirs, list.length);
    }
    out[tid] = { mine: progress(list.filter((m) => keysOf.get(m).size), list.length), players };
  }
  return out;
}
