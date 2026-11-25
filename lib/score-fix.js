// Correcting a match's result by hand when Badminton England has it wrong. The
// correction is what the app then uses everywhere (games, winner); what
// Badminton England says is kept beside it (be_games, be_winner) and updated by
// imports, which leave the correction alone until they agree with it.

import { matchFromRow, nowIso } from './db.js';
import { winnerOf } from './custom.js';
import { matchFormat } from '../public/shared/score.js';
import { settleServers } from './tagging.js';

const badInput = (message) => Object.assign(new Error(message), { code: 'badInput' });

/** The games of a correction, checked: 1-5 pairs of points. Throws a badInput error. */
export function cleanGames(games) {
  if (!Array.isArray(games) || !games.length || games.length > 5) throw badInput('Give one to five games');
  if (games.some((g) => !Array.isArray(g) || g.length !== 2 || !g.every((n) => Number.isInteger(n) && n >= 0 && n <= 99))) throw badInput('Each game needs both sides’ points, 0 to 99');
  if (games.some(([x, y]) => x === y)) throw badInput('A game can’t end level');
  return games.map(([x, y]) => [x, y]);
}

/** A match's games' own rows take its result. */
function followMatch(db, parentId) {
  db.prepare(`UPDATE matches AS g SET games = p.games, winner = p.winner, be_games = p.be_games, be_winner = p.be_winner
    FROM matches AS p WHERE g.parent_id = p.id AND p.id = ?`).run(parentId);
  settleServers(db, { parentId });
}

/**
 * Corrects a match's result (`id` may be a game's row: its match is corrected), or with null
 * goes back to Badminton England's. Throws a badInput error.
 * @returns {{ games: [number, number][], winner: 1|2|null, beGames: [number, number][]|null }|null} null: no such match.
 */
export function fixScore(db, id, games) {
  const row = db.prepare('SELECT p.* FROM matches m JOIN matches p ON p.id = COALESCE(m.parent_id, m.id) WHERE m.id = ?').get(id);
  if (!row) return null;
  if (db.prepare('SELECT kind FROM tournaments WHERE id = ?').get(row.tournament_id)?.kind === 'custom') throw badInput('This is your own tournament’s match: change its result with Edit on the tournament’s page');
  const theirs = { games: row.be_games ?? row.games, winner: row.be_games === null ? row.winner : row.be_winner };
  const wanted = games === null ? null : JSON.stringify(cleanGames(games));
  db.exec('BEGIN');
  try {
    if (wanted === null || wanted === theirs.games) {
      db.prepare('UPDATE matches SET games = ?, winner = ?, be_games = NULL, be_winner = NULL, updated_at = ? WHERE id = ?').run(theirs.games, theirs.winner, nowIso(), row.id);
    } else {
      // A walkover or retirement keeps its winner when the games don't decide one.
      const winner = winnerOf(JSON.parse(wanted), matchFormat({ ...matchFromRow(row), games: JSON.parse(wanted) })) ?? theirs.winner;
      db.prepare('UPDATE matches SET games = ?, winner = ?, be_games = ?, be_winner = ?, updated_at = ? WHERE id = ?').run(wanted, winner, theirs.games, theirs.winner, nowIso(), row.id);
    }
    followMatch(db, row.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const m = matchFromRow(db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id));
  return { games: m.games, winner: m.winner, beGames: m.beGames };
}
