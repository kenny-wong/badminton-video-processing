import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

import { migrate, openDb } from '../lib/db.js';
import { addFavourite, favouriteMatcher, favourites, favouriteTournaments, linkFavourite, orderFavourites, removeFavourite } from '../lib/favourites.js';
import { playerId } from './fixtures/badminfo-sample.js';

const [AMY, AMY2, CAT] = [1, 2, 3].map(playerId);

/** Two tournaments: one from badminfo (two players called Amy), one from Badminton England only (names, no ids). */
function setUp() {
  const db = openDb();
  const t = db.prepare("INSERT INTO tournaments (be_id, badminfo_id, name, start_date, end_date) VALUES (?, ?, ?, '2026-10-24', '2026-10-24')");
  t.run('b1', 'f1', 'Example Open');
  t.run('b2', null, 'Example Cup');
  const p = db.prepare('INSERT INTO players (id, name) VALUES (?, ?)');
  for (const [id, name] of [[AMY, 'Amy Lee'], [AMY2, 'Amy Lee'], [CAT, 'Cat Ho']]) p.run(id, name);
  const tp = db.prepare('INSERT INTO tournament_players (tournament_id, name, player_id) VALUES (1, ?, ?)');
  tp.run('Amy Lee', AMY);
  tp.run('Cat Ho', CAT);
  const m = db.prepare("INSERT INTO matches (tournament_id, draw, round, team_a, team_b, match_date, match_time) VALUES (?, ?, 'R1', ?, ?, '2026-10-24', '09:00')");
  m.run(1, 'WS', JSON.stringify(['Amy Lee']), JSON.stringify(['Cat Ho']));
  m.run(2, 'WS', JSON.stringify(['amy lee']), JSON.stringify(['Eve Ng']));
  m.run(2, 'WD', JSON.stringify(['Eve Ng', 'Fay Wu']), JSON.stringify(['Cat Ho', 'Gil Yu']));
  return db;
}

test('the old "My players" settings move to favourites, with their pasted links', () => {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x < '0011').sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  db.exec('PRAGMA user_version = 10');
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  put.run('players', JSON.stringify(['Zed', 'Amy', 'Zed']));
  put.run('playerLinks', JSON.stringify({ Amy: AMY }));
  put.run('sensitivity', '5');
  migrate(db);
  assert.deepEqual(db.prepare('SELECT name, player_id FROM favourites ORDER BY id').all().map((r) => ({ ...r })), [{ name: 'Zed', player_id: null }, { name: 'Amy', player_id: AMY }]);
  assert.deepEqual(db.prepare('SELECT key FROM settings').all().map((r) => r.key), ['sensitivity']);
});

test('the Players list keeps the order it was dragged into; players never moved come after, by name', () => {
  const db = setUp();
  const [zoe, bea, kit] = ['Zoe Ng', 'Bea Ho', 'Kit Yu'].map((name) => addFavourite(db, { name, starred: name !== 'Kit Yu' }));
  assert.deepEqual(favourites(db, { all: true }).map((f) => f.name), ['Bea Ho', 'Kit Yu', 'Zoe Ng']);
  assert.equal(orderFavourites(db, [zoe, kit, 999]), 2);
  const late = addFavourite(db, { name: 'Ann Lo' });
  assert.deepEqual(favourites(db, { all: true }).map((f) => f.name), ['Zoe Ng', 'Kit Yu', 'Ann Lo', 'Bea Ho']);
  assert.deepEqual(favourites(db).map((f) => f.key), [zoe, late, bea], 'favourites only, in the same order');
});

test('favourites: a name is tied to its player once only one player has it', () => {
  const db = setUp();
  const amy = addFavourite(db, { name: 'Amy' });
  const cat = addFavourite(db, { name: 'cat' });
  assert.equal(addFavourite(db, { name: 'Amy' }), amy); // no duplicates
  // Two Amy Lees: Amy stays a name; one Cat Ho: cat becomes her.
  assert.deepEqual(favourites(db), [{ key: amy, name: 'Amy', id: null, candidates: 2, starred: true }, { key: cat, name: 'Cat Ho', id: CAT, candidates: 0, starred: true }]);
  assert.equal(addFavourite(db, { id: CAT, name: 'Cat Ho' }), cat);
  // Pasting the right Amy's link ties her; pasting someone already starred merges the two.
  assert.equal(linkFavourite(db, amy, AMY, 'Amy Lee'), amy);
  const dup = addFavourite(db, { name: 'Ho' });
  assert.equal(linkFavourite(db, dup, CAT, 'Cat Ho'), cat);
  assert.deepEqual(favourites(db).map((f) => [f.name, f.id]), [['Amy Lee', AMY], ['Cat Ho', CAT]]);
  assert.equal(removeFavourite(db, cat), true);
  assert.equal(removeFavourite(db, cat), false);
});

test('favourites are picked out by id in badminfo draws and by name elsewhere, with the tournaments they joined', () => {
  const db = setUp();
  const amy2 = addFavourite(db, { id: AMY2, name: 'Amy Lee' }); // the other Amy Lee
  const cat = addFavourite(db, { id: CAT, name: 'Cat Ho' });
  const favs = favourites(db);
  const inOpen = favouriteMatcher(db, 1, favs);
  assert.deepEqual(inOpen(['Amy Lee']), []); // her namesake, by id
  assert.deepEqual(inOpen(['cat ho']), [cat]);
  const inCup = favouriteMatcher(db, 2, favs);
  assert.deepEqual(inCup(['amy lee']), [amy2]); // no ids there: by name
  assert.deepEqual(inCup(['Cat Ho', 'Gil Yu']), [cat]);
  assert.deepEqual(favouriteTournaments(db, favs), { [amy2]: { 2: 1 }, [cat]: { 1: 1, 2: 1 } });
  assert.deepEqual(favouriteTournaments(db, []), {});
});
