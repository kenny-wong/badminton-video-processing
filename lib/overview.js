// The home page's "to do" lists and search: where each filmed match (or game
// filmed on its own) stands, from linked to uploaded, and finding matches by
// player, tournament or event. The sorting into stages is pure and tested in
// tests/overview.test.js.

import { matchFromRow, parseJson } from './db.js';
import { existsSync } from 'node:fs';

export const MAX_ITEMS = 30;

/**
 * Where a match's videos are: [{ id, game }] for the match itself (game 0) or each of its games
 * filmed on its own, in game order, only those with a video. The editor opens these ids.
 */
export function filmedUnits(db, matchId) {
  return db.prepare(`SELECT g.id, g.game FROM matches g WHERE (g.id = ? OR g.parent_id = ?) AND EXISTS (SELECT 1 FROM videos v WHERE v.match_id = g.id)
    ORDER BY g.game`).all(matchId, matchId).map((r) => ({ id: r.id, game: r.game }));
}

/**
 * Where a filmed match stands: 'tag' (rallies to find or winners to give),
 * 'render', 'upload' (rendered, no YouTube link yet) or 'done'.
 * `rendered` says whether its finished video is still on disk.
 */
export function stageOf({ rallies, outputPath, youtubeUrl, serverSet }, rendered = Boolean(outputPath)) {
  if (youtubeUrl) return 'done';
  if (rendered) return 'upload';
  // Tagged: rallies, each with a winner, and who served first chosen (serverSet false = not yet).
  if (!rallies.length || rallies.some((r) => !r.winner) || serverSet === false) return 'tag';
  return 'render';
}

/** A match row as the lists show it. */
const item = (m, r) => ({
  id: m.id, tournamentId: m.tournamentId, tournament: r.tournament_name, date: m.date, time: m.time, draw: m.draw, round: m.round, game: m.game,
  teamA: m.teamA, teamB: m.teamB, rallies: m.rallies.length, tagged: m.rallies.filter((x) => x.winner).length, serverSet: m.serverSet, youtubeUrl: m.youtubeUrl,
});

/** Filmed matches by stage, newest first, plus how many videos aren't linked to anything. */
export function overview(db) {
  const rows = db.prepare(`SELECT m.*, t.name AS tournament_name FROM matches m JOIN tournaments t ON t.id = m.tournament_id
    WHERE EXISTS (SELECT 1 FROM videos v WHERE v.match_id = m.id) ORDER BY m.match_date DESC, m.match_time DESC, m.game`).all();
  const stages = { tag: [], render: [], upload: [], done: [] };
  for (const r of rows) {
    const m = matchFromRow(r);
    stages[stageOf(m, Boolean(m.outputPath && existsSync(m.outputPath)))].push(item(m, r));
  }
  const unlinked = db.prepare('SELECT COUNT(*) AS n FROM videos WHERE match_id IS NULL AND missing = 0').get().n;
  return {
    unlinked,
    counts: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, v.length])),
    ...Object.fromEntries(Object.entries(stages).filter(([k]) => k !== 'done').map(([k, v]) => [k, v.slice(0, MAX_ITEMS)])),
  };
}

/** True when every word of the query is in the text (any case). */
export function matchesQuery(text, q) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const hay = String(text ?? '').toLowerCase();
  return words.length > 0 && words.every((w) => hay.includes(w));
}

/**
 * Matches (whole matches, any tournament) whose players, tournament, event or
 * round hold every word of `q`, newest first; `only` narrows to 'video',
 * 'tagged' or 'uploaded'.
 */
export function search(db, q, only = '') {
  const rows = db.prepare(`SELECT m.*, t.name AS tournament_name,
      (SELECT COUNT(*) FROM videos v JOIN matches g ON g.id = v.match_id WHERE g.id = m.id OR g.parent_id = m.id) AS videos,
      (SELECT MAX(g.youtube_url) FROM matches g WHERE g.id = m.id OR g.parent_id = m.id) AS any_youtube,
      (SELECT COUNT(*) FROM matches g WHERE (g.id = m.id OR g.parent_id = m.id) AND g.rallies <> '[]') AS tagged_units
    FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE m.game = 0 ORDER BY m.match_date DESC, m.match_time DESC`).all();
  const out = [];
  for (const r of rows) {
    const text = [r.tournament_name, r.draw, r.round, ...parseJson(r.team_a, []), ...parseJson(r.team_b, [])].join(' ');
    if (!matchesQuery(text, q)) continue;
    if (only === 'video' && !r.videos) continue;
    if (only === 'tagged' && !r.tagged_units) continue;
    if (only === 'uploaded' && !r.any_youtube) continue;
    out.push({ ...item(matchFromRow(r), r), videos: r.videos, units: r.videos ? filmedUnits(db, r.id) : [], youtubeUrl: r.any_youtube, games: parseJson(r.games, []) });
    if (out.length >= 50) break;
  }
  return out;
}
