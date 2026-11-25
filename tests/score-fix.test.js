// Correcting a result Badminton England has wrong: used everywhere, kept through imports, and undone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { matchFromRow, openDb } from '../lib/db.js';
import { cleanGames, fixScore } from '../lib/score-fix.js';
import { saveTournament } from '../lib/tournaments.js';
import { gameRow } from '../lib/tagging.js';
import { linkedMatches } from '../lib/planner.js';
import { createCustom, addMatch } from '../lib/custom.js';

const BE = [[8, 15], [16, 14], [15, 9]];
const RIGHT = [[12, 15], [16, 14], [15, 9]];
const fetched = (games = BE, winner = 1) => ({ beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: 'bi', name: 'Example', start: '2026-10-24', end: '2026-10-24',
  matches: [{ date: '2026-10-24', time: '09:40', draw: 'XD U15', round: 'Final', court: '3', duration: 40, teams: [['Amy Lee'], ['Bea Ng']], games, winner }] });

function setUp() {
  const db = openDb();
  saveTournament(db, fetched());
  const { id } = db.prepare('SELECT id FROM matches WHERE game = 0').get();
  const get = (x) => matchFromRow(db.prepare('SELECT * FROM matches WHERE id = ?').get(x));
  return { db, id, get };
}

test('a correction counts for the match and its games’ rows, also new ones, and can be undone', () => {
  const { db, id, get } = setUp();
  const g1 = gameRow(db, id, 1);
  assert.deepEqual(fixScore(db, g1, RIGHT), { games: RIGHT, winner: 1, beGames: BE }); // by a game's row: its match
  assert.deepEqual([get(id).games, get(g1).games, get(g1).beGames], [RIGHT, RIGHT, BE]);
  assert.deepEqual([get(gameRow(db, id, 2)).games, get(gameRow(db, id, 3)).beGames], [RIGHT, BE]);
  // Changed again: Badminton England's is still remembered.
  assert.deepEqual(fixScore(db, id, [[11, 15], [16, 14], [15, 9]]).beGames, BE);
  // The winner and an untagged game's first server follow.
  assert.equal(fixScore(db, id, [[8, 15], [14, 16]]).winner, 2);
  assert.equal(get(gameRow(db, id, 3)).firstServer, 'b');
  assert.deepEqual(fixScore(db, id, null), { games: BE, winner: 1, beGames: null });
  assert.deepEqual([get(g1).games, get(g1).beGames, get(gameRow(db, id, 3)).firstServer], [BE, null, 'a']);
  // Saving Badminton England's own score is no correction.
  fixScore(db, id, RIGHT);
  assert.equal(fixScore(db, id, BE).beGames, null);
  assert.equal(fixScore(db, 999, RIGHT), null);
  db.close();
});

test('importing again keeps a correction, until Badminton England says the same', () => {
  const { db, id, get } = setUp();
  const g1 = gameRow(db, id, 1);
  fixScore(db, id, RIGHT);
  saveTournament(db, fetched());
  assert.deepEqual([get(id).games, get(id).beGames, get(g1).games], [RIGHT, BE, RIGHT]);
  const other = [[9, 15], [16, 14], [15, 9]];
  saveTournament(db, fetched(other));
  assert.deepEqual([get(id).games, get(id).beGames, get(g1).beGames], [RIGHT, other, other]);
  saveTournament(db, fetched(RIGHT));
  assert.deepEqual([get(id).games, get(id).winner, get(id).beGames, get(g1).beGames], [RIGHT, 1, null, null]);
  saveTournament(db, fetched(BE)); // not corrected any more: the import's result counts
  assert.deepEqual(get(id).games, BE);
  db.close();
});

test('a match is still found in badminfo by Badminton England’s score, and its corrected score is sent', () => {
  const { db, id } = setUp();
  db.prepare("UPDATE matches SET youtube_url = 'https://youtu.be/x' WHERE id = ?").run(id);
  fixScore(db, id, RIGHT);
  const [m] = linkedMatches(db);
  assert.deepEqual([m.games, m.about.score], [BE, RIGHT]);
  db.close();
});

test('only a possible result is taken, and custom matches are edited on their page', async () => {
  for (const bad of [[], [[1]], [[15, 15]], [[null, 15]], [[15, 100]], [[15, -1]], Array(6).fill([15, 1]), 'x']) assert.throws(() => cleanGames(bad), { code: 'badInput' });
  const { db, id } = setUp();
  const tid = createCustom(db, { name: 'Club night' });
  const own = addMatch(db, tid, { teamA: ['Amy Lee'], teamB: ['Bea Ng'], games: '15-9' });
  const app = { db, port: 0 };
  const server = createApp(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  app.port = server.address().port;
  const base = `http://127.0.0.1:${app.port}`;
  const put = async (mid, body) => (await fetch(`${base}/api/matches/${mid}/score`, { method: 'PUT', headers: { Origin: base }, body: JSON.stringify(body) })).status;
  try {
    assert.deepEqual([await put(id, { games: RIGHT }), await put(id, { games: [[15, 15]] }), await put(id, {}), await put(own, { games: RIGHT }), await put(9999, { games: RIGHT }), await put(id, { games: null })],
      [200, 400, 400, 400, 404, 200]);
  } finally {
    server.close();
    db.close();
  }
});
