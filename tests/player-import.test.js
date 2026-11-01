import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openDb } from '../lib/db.js';
import { importPlayerTournaments } from '../lib/player-import.js';
import { saveTournament } from '../lib/tournaments.js';
import { parseMatches } from '../lib/schedule.js';
import { PAGE } from './fixtures/be-pages.js';

const PLAYER = '00000000-0000-0000-0000-0000000000aa';
const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
const T3 = '33333333-3333-3333-3333-333333333333';
const BE = { [T1]: 'b997c3c5-38fb-4caf-a402-009664189ad6', [T2]: 'c997c3c5-38fb-4caf-a402-009664189ad6' };

// badminfo's player JSON, cut down: one upcoming tournament and two past ones (T3 has no BE page).
const playerJson = {
  name: 'Amy Lee',
  upcomingTournaments: [{ id: T2, name: 'Example Autumn Gold', startDate: '2026-11-21T00:00:00', endDate: '2026-11-22T00:00:00' }],
  competitionsWithRubbers: [
    { tournament: { id: T1, name: 'Example Junior Gold', startDate: '2026-10-24T00:00:00', endDate: '2026-10-24T00:00:00' }, rubbers: [] },
    { tournament: { id: T3, name: 'County League Night', startDate: '2026-09-01T00:00:00' }, rubbers: [] },
    { league: { name: 'A league' }, rubbers: [] },
  ],
};

function fakes() {
  const fetched = [];
  return {
    fetched,
    fetchJson: async (url) => (url.endsWith(PLAYER) ? { json: playerJson } : { error: 'notFound' }),
    fetchOne: async (link) => {
      const id = link.split('/').pop();
      fetched.push(id);
      if (!BE[id]) throw new Error('badminfo has no Badminton England link for this tournament');
      return { beId: BE[id], badminfoId: id, name: id === T1 ? 'Example Junior Gold' : 'Example Autumn Gold', start: '2026-10-24', end: '2026-10-24', matches: id === T1 ? parseMatches(PAGE, '20261024') : [] };
    },
  };
}

test('a player’s badminfo tournaments are imported once: ones already in the app are skipped, failures reported', async () => {
  const db = openDb();
  const f = fakes();
  // T1 was imported before, from its Badminton England link (no badminfo id yet).
  saveTournament(db, { beId: BE[T1], badminfoId: null, name: 'Example Junior Gold', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });

  const first = await importPlayerTournaments(db, PLAYER, f);
  assert.equal(first.player, 'Amy Lee');
  assert.deepEqual(first.imported.map((t) => t.name), ['Example Junior Gold', 'Example Autumn Gold']);
  assert.deepEqual(first.skipped.map((t) => t.name), ['County League Night']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tournaments').get().n, 2, 'the BE-imported one merged, not doubled');
  assert.equal(db.prepare('SELECT badminfo_id FROM tournaments WHERE be_id = ?').get(BE[T1]).badminfo_id, T1);

  f.fetched.length = 0;
  const again = await importPlayerTournaments(db, PLAYER, f);
  assert.deepEqual(f.fetched, [T3], 'only the one not imported is tried again');
  assert.deepEqual([again.imported.length, again.already], [0, 2]);

  f.fetched.length = 0;
  const update = await importPlayerTournaments(db, PLAYER, { ...f, update: true });
  assert.deepEqual(f.fetched.sort(), [T1, T2].sort(), 'update reads only the imported ones');
  assert.deepEqual([update.imported.length, update.already], [2, 1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tournaments').get().n, 2);
});

test('an unknown player is an error, not an empty import', async () => {
  await assert.rejects(importPlayerTournaments(openDb(), '00000000-0000-0000-0000-0000000000bb', fakes()), /no player/);
});
