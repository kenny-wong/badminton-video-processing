import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openDb } from '../lib/db.js';
import { addFavourite, favourites, favouriteTournaments, linkFavourite, removeFavourite, setStarred } from '../lib/favourites.js';
import {
  addMatch, cleanMatch, cleanTournament, createCustom, customTournament, deleteMatch, rosterOf, setRoster, updateCustom, updateMatch, winnerOf,
} from '../lib/custom.js';
import { saveTournament } from '../lib/tournaments.js';
import { parseMatches } from '../lib/schedule.js';
import { PAGE } from './fixtures/be-pages.js';

const match = (db, id) => db.prepare('SELECT * FROM matches WHERE id = ?').get(id);

test('custom tournament details: a name is needed, dates are checked, the last day defaults to the first', () => {
  assert.throws(() => cleanTournament({ name: '  ' }), /name/);
  assert.throws(() => cleanTournament({ name: 'Club night', start: '24/10/2026' }), /Dates/);
  assert.throws(() => cleanTournament({ name: 'Club night', start: '2026-10-24', end: '2026-10-23' }), /before/);
  assert.deepEqual(cleanTournament({ name: ' Club   night ', start: '2026-10-24', format: { points: 15, bestOf: 3 } }),
    { name: 'Club night', start: '2026-10-24', end: '2026-10-24', venue: null, format: { points: 15, setting: true, bestOf: 3 } });
});

test('a custom tournament is made with today’s date, edited, and imported ones can’t be edited', () => {
  const db = openDb();
  const id = createCustom(db, { name: 'Club night' }, '2026-11-01');
  const t = customTournament(db, id);
  assert.deepEqual([t.kind, t.name, t.start, t.end, t.beId], ['custom', 'Club night', '2026-11-01', '2026-11-01', null]);
  updateCustom(db, id, { venue: 'Sports hall', end: '2026-11-02' });
  assert.deepEqual([customTournament(db, id).venue, customTournament(db, id).end, customTournament(db, id).name], ['Sports hall', '2026-11-02', 'Club night']);
  const imported = saveTournament(db, { beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });
  assert.equal(customTournament(db, imported), null);
  assert.equal(updateCustom(db, imported, { name: 'x' }), null);
  assert.equal(addMatch(db, imported, { teamA: ['A'], teamB: ['B'] }), null);
});

test('the winner follows the games under the scoring format', () => {
  assert.equal(winnerOf([[21, 15], [21, 18]], null), 1);
  assert.equal(winnerOf([[21, 15], [18, 21]], null), null);
  assert.equal(winnerOf([[15, 11], [13, 15], [9, 15]], { points: 15 }), 2);
  assert.equal(winnerOf([[21, 19]], { points: 21, bestOf: 1 }), 1);
});

test('match input: teams of one or two, the result as text, checked', () => {
  const t = { start: '2026-11-01', format: { points: 15, bestOf: 3 } };
  const m = cleanMatch({ time: '19:30', draw: 'MD', teamA: ['Amy Lee', ' Ben Ng '], teamB: 'Cat Ho', games: '15-11 15-9' }, t);
  assert.deepEqual([m.date, m.time, m.teamA, m.teamB, m.games, m.winner, m.format.points], ['2026-11-01', '19:30', ['Amy Lee', 'Ben Ng'], ['Cat Ho'], [[15, 11], [15, 9]], 1, 15]);
  assert.throws(() => cleanMatch({ teamA: [], teamB: ['B'] }, t), /side A/);
  assert.throws(() => cleanMatch({ teamA: ['a', 'b', 'c'], teamB: ['B'] }, t), /one or two/);
  assert.throws(() => cleanMatch({ teamA: ['A'], teamB: ['B'], games: '21 to 15' }, t), /result/);
  assert.throws(() => cleanMatch({ teamA: ['A'], teamB: ['B'], time: '25:00' }, t), /Times/);
  assert.deepEqual(cleanMatch({ teamA: ['A'], teamB: ['B'], games: '' }, t).games, []);
});

test('custom matches: added with a UK start time and a “Match n” round, edited with their game rows, deleted', () => {
  const db = openDb();
  const id = createCustom(db, { name: 'Club night', format: { points: 15 } }, '2026-07-01');
  const m1 = addMatch(db, id, { time: '19:00', teamA: ['Amy Lee'], teamB: ['Cat Ho'] });
  const row = match(db, m1);
  assert.deepEqual([row.round, row.match_date, row.starts_at, JSON.parse(row.format).points], ['Match 1', '2026-07-01', '2026-07-01T18:00:00.000Z', 15]); // BST
  assert.equal(match(db, addMatch(db, id, { teamA: ['Amy Lee'], teamB: ['Cat Ho'] })).round, 'Match 2');
  assert.throws(() => addMatch(db, id, { round: 'Match 1', teamA: ['Amy Lee'], teamB: ['Cat Ho'] }), (e) => e.code === 'conflict');

  // A game's row (made when a game gets its own video) follows the match.
  db.prepare(`INSERT INTO matches (tournament_id, parent_id, game, match_date, match_time, draw, round, team_a, team_b) SELECT tournament_id, id, 1, match_date, match_time, draw, round, team_a, team_b FROM matches WHERE id = ?`).run(m1);
  updateMatch(db, id, m1, { date: '2026-07-01', time: '20:15', teamA: ['Amy Lee'], teamB: ['Cat Ho'], games: '15-10 15-12', round: 'Final' });
  assert.deepEqual([match(db, m1).match_time, match(db, m1).winner, match(db, m1).round], ['20:15', 1, 'Final']);
  assert.deepEqual({ ...db.prepare('SELECT match_time, round, games FROM matches WHERE parent_id = ?').get(m1) }, { match_time: '20:15', round: 'Final', games: '[[15,10],[15,12]]' });

  // A new scoring format reaches the matches that had the old one, not one chosen separately.
  db.prepare("UPDATE matches SET format = '{\"points\":21,\"setting\":true,\"bestOf\":1}' WHERE round = 'Match 2'").run();
  updateCustom(db, id, { format: { points: 11, bestOf: 3 } });
  assert.equal(JSON.parse(match(db, m1).format).points, 11);
  assert.equal(JSON.parse(db.prepare("SELECT format FROM matches WHERE round = 'Match 2'").get().format).points, 21);

  assert.equal(deleteMatch(db, id, m1), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE id = ? OR parent_id = ?').get(m1, m1).n, 0);
});

test('the Players list keeps unstarred players; custom tournaments take listed players and count for them', () => {
  const db = openDb();
  const amy = addFavourite(db, { name: 'Amy Lee' });
  const ben = addFavourite(db, { name: 'Ben Ng', starred: false });
  assert.deepEqual(favourites(db).map((f) => f.name), ['Amy Lee']);
  assert.deepEqual(favourites(db, { all: true }).map((f) => [f.name, f.starred]), [['Amy Lee', true], ['Ben Ng', false]]);
  setStarred(db, amy, false);
  assert.deepEqual(favourites(db), []);
  assert.equal(favourites(db, { all: true }).length, 2, 'unstarring keeps the player listed');
  assert.equal(addFavourite(db, { name: 'amy lee' }), amy, 'adding again stars the same entry');
  assert.equal(favourites(db)[0].key, amy);

  const id = createCustom(db, { name: 'Club night' }, '2026-11-01');
  assert.deepEqual(setRoster(db, id, [amy, ben, 999]).map((r) => r.name), ['Amy Lee', 'Ben Ng']);
  assert.deepEqual(favouriteTournaments(db, favourites(db))[amy], { [id]: 0 }, 'assigned counts as joining');
  addMatch(db, id, { teamA: ['Amy Lee'], teamB: ['Cat Ho'] });
  assert.deepEqual(favouriteTournaments(db, favourites(db))[amy], { [id]: 1 });

  // Linking a name-only entry to a player already listed merges them, keeping the tournament place.
  db.prepare("INSERT INTO players (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Ben Ng')").run();
  const benLinked = addFavourite(db, { id: '00000000-0000-0000-0000-000000000001', name: 'Ben Ng', starred: false });
  assert.equal(linkFavourite(db, ben, '00000000-0000-0000-0000-000000000001', 'Ben Ng'), benLinked);
  assert.deepEqual(rosterOf(db, id).map((r) => r.key), [amy, benLinked]);
  removeFavourite(db, amy);
  assert.deepEqual(rosterOf(db, id).map((r) => r.name), ['Ben Ng'], 'removed from the list, out of the tournament');
});
