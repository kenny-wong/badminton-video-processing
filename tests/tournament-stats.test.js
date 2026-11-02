import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openDb } from '../lib/db.js';
import { addFavourite, favourites } from '../lib/favourites.js';
import { addMatch, createCustom } from '../lib/custom.js';
import { progress, tournamentStats } from '../lib/tournament-stats.js';

const m = (games, linked = false, rows = [], extra = {}) => ({ games, linked, rows, output: false, youtube: false, ...extra });

test('progress: a whole-match video films every game; game by game counts the games with video', () => {
  const s = progress([
    m([[21, 15], [21, 18]], true, [], { output: true, youtube: true }), // filmed whole, rendered, on YouTube
    m([[21, 15], [18, 21], [21, 19]], false, [{ game: 1, linked: true, output: true }, { game: 2, linked: true }]), // 2 of 3 games filmed
    m([]), // not played yet: one game, no video
  ], 40);
  assert.deepEqual(s, { total: 40, matches: 3, filmedMatches: 1, games: 6, filmedGames: 4, taggedGames: 0, videos: 3, rendered: 2, uploaded: 1 });
});

test('progress: every filmed game needs tagging; a tagged whole-match video tags all its games', () => {
  const s = progress([
    m([[21, 15], [21, 18]], true, [], { tagged: true }), // both games, one tagged video
    m([[21, 15], [18, 21], [21, 19]], false, [{ game: 1, linked: true, tagged: true }, { game: 2, linked: true }, { game: 3, linked: false, tagged: true }]),
  ], 2);
  assert.deepEqual([s.taggedGames, s.filmedGames], [3, 4]); // game 2 still to tag; game 3 has no video
});

test('progress: a match filmed game by game is filmed once every game has its video', () => {
  const s = progress([m([[21, 15], [21, 18]], false, [{ game: 1, linked: true }, { game: 2, linked: true }])], 1);
  assert.deepEqual([s.filmedMatches, s.filmedGames, s.games, s.videos], [1, 2, 2, 2]);
});

test('tournament stats: per favourite and for all favourites; tournaments without them count nothing to do', () => {
  const db = openDb();
  const amy = addFavourite(db, { name: 'Amy Lee' });
  const ben = addFavourite(db, { name: 'Ben Ng' });
  const club = createCustom(db, { name: 'Club night' }, '2026-11-01');
  const m1 = addMatch(db, club, { teamA: ['Amy Lee'], teamB: ['Cat Ho'], games: '21-15 21-18' });
  addMatch(db, club, { teamA: ['Ben Ng'], teamB: ['Dan Wu'] });
  addMatch(db, club, { teamA: ['Eve Fox'], teamB: ['Gus Hay'] });
  db.prepare("INSERT INTO videos (path, size, modified_at, match_id) VALUES ('C:/v/a.mp4', 1, 'x', ?)").run(m1);
  db.prepare("UPDATE matches SET output_path = 'C:/out/a.mp4' WHERE id = ?").run(m1);
  const other = createCustom(db, { name: 'Elsewhere' }, '2026-11-01');
  addMatch(db, other, { teamA: ['Eve Fox'], teamB: ['Gus Hay'] });

  const stats = tournamentStats(db, favourites(db));
  assert.deepEqual(stats[club].players[amy], { total: 3, matches: 1, filmedMatches: 1, games: 2, filmedGames: 2, taggedGames: 0, videos: 1, rendered: 1, uploaded: 0 });
  // Tagged once it has rallies and every one has a winner.
  db.prepare("UPDATE matches SET rallies = ? WHERE id = ?").run(JSON.stringify([{ start: 1, end: 5, winner: 'a' }, { start: 9, end: 12 }]), m1);
  assert.equal(tournamentStats(db, favourites(db))[club].players[amy].taggedGames, 0);
  db.prepare("UPDATE matches SET rallies = ? WHERE id = ?").run(JSON.stringify([{ start: 1, end: 5, winner: 'a' }, { start: 9, end: 12, winner: 'let' }]), m1);
  assert.equal(tournamentStats(db, favourites(db))[club].players[amy].taggedGames, 2);
  assert.deepEqual([stats[club].players[ben].matches, stats[club].players[ben].filmedMatches], [1, 0]);
  assert.deepEqual([stats[club].mine.matches, stats[club].mine.filmedMatches, stats[club].mine.games], [2, 1, 3]);
  assert.deepEqual(stats[other].mine, { total: 1, matches: 0, filmedMatches: 0, games: 0, filmedGames: 0, taggedGames: 0, videos: 0, rendered: 0, uploaded: 0 });
  assert.deepEqual(stats[other].players, {});
});
