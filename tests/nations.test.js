import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createApp } from '../server.js';
import { matchFromRow, openDb } from '../lib/db.js';
import { saveTournament } from '../lib/tournaments.js';
import { parseMatches } from '../lib/schedule.js';
import { saveEntrants, saveProfile } from '../lib/players.js';
import { addFavourite, favourites } from '../lib/favourites.js';
import { matchBoard, matchCountries, nationOf, playerNations, setNation, teamNation } from '../lib/nations.js';
import { PAGE } from './fixtures/be-pages.js';

const fetched = () => ({ beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });
const ID = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const entrant = (n, name) => ({ id: ID(n), name, grades: {}, ratings: {}, ratingsDate: '2026-10-01' });
const profile = (n, name, nation) => ({ id: ID(n), name, beNumber: '', county: '', nation, grades: {}, ratings: {}, ratingsDate: '2026-10-01', rubbers: [] });

test('a badminfo player’s nation is the federation they are registered with, England when none', () => {
  assert.equal(nationOf({ beId: 'x', bsId: 'y' }), 'ENG');
  assert.equal(nationOf({ beId: null, beNumber: null, bsCode: 'S123' }), 'SCO');
  assert.equal(nationOf({ biNumber: 42 }), 'IRL');
  assert.equal(nationOf({ name: 'Someone' }), 'ENG');
});

test('badminfo players start as England, profiles refine it, and the Players list can choose', () => {
  const db = openDb();
  const tid = saveTournament(db, fetched());
  saveEntrants(db, tid, [entrant(1, 'Eli Ma'), entrant(2, "Fin O'Neil")]);
  saveProfile(db, profile(2, "Fin O'Neil", 'SCO'));
  saveEntrants(db, tid, [entrant(2, "Fin O'Neil")]); // a later import keeps what the profile said
  assert.deepEqual(db.prepare('SELECT nation FROM players ORDER BY id').all().map((r) => r.nation), ['ENG', 'SCO']);

  const eli = addFavourite(db, { id: ID(1), name: 'Eli Ma' });
  const typed = addFavourite(db, { name: 'Nobody Known' });
  const nations = () => Object.fromEntries(favourites(db).map((f) => [f.name, [f.nation, f.nationChosen]]));
  assert.deepEqual(nations(), { 'Eli Ma': ['ENG', false], 'Nobody Known': ['', false] }); // added by name: no flag
  setNation(db, eli, 'jpn');
  setNation(db, typed, 'WAL'); // not a country we draw: no flag
  assert.deepEqual(nations(), { 'Eli Ma': ['JPN', true], 'Nobody Known': ['', true] });
  setNation(db, eli, null); // back to badminfo's
  assert.deepEqual(nations()['Eli Ma'], ['ENG', false]);
});

test('a match’s flags come from its players unless the match chose its own', () => {
  const db = openDb();
  const tid = saveTournament(db, fetched());
  const tournament = { id: tid };
  saveEntrants(db, tid, [entrant(1, 'Amy Lee'), entrant(2, 'Ben Ng'), entrant(3, 'Gus Yu')]);
  saveProfile(db, profile(3, 'Gus Yu', 'SCO'));
  const amy = addFavourite(db, { id: ID(1), name: 'Amy Lee' });
  setNation(db, amy, 'HKG');
  addFavourite(db, { name: 'Hal Li' }); // added by hand: no nation
  // Partners from different nations: the first player's flag; nobody known: none.
  assert.deepEqual(playerNations(db, tid, ['Amy Lee', 'Ben Ng']), ['HKG', 'ENG']);
  assert.deepEqual(playerNations(db, tid, ['Gus Yu', 'Hal Li']), ['SCO', '']);
  assert.deepEqual(playerNations(db, tid, ['Zed Unknown']), ['']);
  assert.equal(teamNation(['', 'SCO']), 'SCO');
  const row = db.prepare("SELECT * FROM matches WHERE draw = 'XD U15'").get();
  const match = matchFromRow(row);
  assert.deepEqual(matchCountries(db, match, tournament), ['HKG', 'SCO']);
  assert.deepEqual(matchBoard(db, { preset: 'international' }, match, tournament).countries, ['HKG', 'SCO']);
  assert.deepEqual(matchBoard(db, { preset: 'international' }, { ...match, boardStyle: { countries: ['DEN', ''] } }, tournament).countries, ['DEN', '']);
});

test('the Players page sets a listed player’s flag through the API', async () => {
  const app = { db: openDb(), port: 0 };
  const server = createApp(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  app.port = server.address().port;
  const base = `http://127.0.0.1:${app.port}`;
  const put = (key, body) => fetch(`${base}/api/favourites/${key}`, { method: 'PUT', headers: { Origin: base }, body: JSON.stringify(body) });
  try {
    const key = addFavourite(app.db, { name: 'Cat Ho' });
    const set = await put(key, { nation: 'DEN' });
    assert.deepEqual(await set.json(), { key, nation: 'DEN', nationChosen: true });
    assert.equal((await put(key, { nation: 7 })).status, 400);
    assert.deepEqual(await (await put(key, { nation: null })).json(), { key, nation: '', nationChosen: false });
    const cards = await (await fetch(`${base}/api/players`)).json();
    assert.equal(cards.favourites[0].nation, '');
  } finally {
    server.close();
  }
});
