import assert from 'node:assert/strict';
import { test } from 'node:test';

import { entrants, playerProfile } from '../lib/badminfo.js';
import { openDb } from '../lib/db.js';
import { matchPeople, myPlayers, refreshProfile, saveEntrants, teamIds, tournamentPeople } from '../lib/players.js';
import { videoDescription, videoTitle } from '../lib/naming.js';
import { disciplineOf, isUpset, matchChance, percents, ratingSeries, record } from '../public/shared/players.js';
import { playerId } from './fixtures/badminfo-sample.js';

const T = 'c7fa0c7e-1adb-412f-a229-190bd893db4f';
const [AMY, CAT, BEN, DEE] = [1, 2, 3, 4].map(playerId);

// badminfo's tournament JSON players, cut down, made-up names.
const TOURNAMENT = {
  beTournament: {
    players: [
      { index: 0, playerEntryName: 'Amy  Lee', id: AMY, latestGradings: [{ key: 'Single', value: 'H', firstSeenUtc: '2026-06-26T11:55:00Z' }, { key: 'Single', value: 'I', firstSeenUtc: '2025-06-26T11:55:00Z' }],
        currentRatings: { ratingsDate: '2026-10-31T00:00:00Z', singlesRating: 526, doublesRating: null, mixedRating: 480 } },
      { index: 1, playerEntryName: 'Cat Ho', id: CAT, latestGradings: [], currentRatings: { ratingsDate: '2026-10-31T00:00:00Z', singlesRating: 461 } },
      { index: 2, playerEntryName: 'No Id', id: 'nope' },
    ],
  },
};

// badminfo's player JSON for Amy, cut down.
const AMY_JSON = {
  id: AMY, name: 'Amy Lee', beNumber: 1234, county: 'Exampleshire',
  gradings: [{ key: 'Single', value: 'H', firstSeenUtc: '2026-06-26T11:55:00Z' }],
  ratings: { ratingsDate: '2026-10-31T00:00:00Z', singlesRating: 518 },
  competitionsWithRubbers: [
    { tournament: { id: T, name: 'Example Open', startDate: '2026-10-24T00:00:00' }, rubbers: [
      { eventName: 'WS U15', roundText: 'Group D', discipline: 0, winningTeam: 2, team1Players: [{ id: AMY, name: 'Amy Lee', previousRating: 526 }], team2Players: [{ id: CAT, name: 'Cat Ho', previousRating: 461 }],
        games: [{ team1Score: 19, team2Score: 21 }], ratingsEffect: { rubberProcessingStatus: 0, thisPlayerWinChance: 0.814, thisPlayerRatingChange: -8 } },
    ] },
    { tournament: { id: '11111111-0000-4000-8000-000000000000', name: 'Older', startDate: '2026-09-01T00:00:00' }, rubbers: [
      { eventName: 'WS U15', discipline: 0, winningTeam: 1, team1Players: [{ id: AMY, previousRating: 500 }], team2Players: [{ id: DEE, previousRating: 470 }], games: [], ratingsEffect: { rubberProcessingStatus: 0, thisPlayerWinChance: 0.6 } },
      { eventName: 'Someone else', discipline: 0, winningTeam: 1, team1Players: [{ id: BEN }], team2Players: [{ id: DEE }] },
    ] },
  ],
};

test('entrants reads names, latest grades and ratings from a badminfo tournament', () => {
  const list = entrants(TOURNAMENT);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { id: AMY, name: 'Amy Lee', grades: { singles: 'H', doubles: '', mixed: '' }, ratings: { singles: 526, doubles: null, mixed: 480 }, ratingsDate: '2026-10-31' });
});

test('playerProfile keeps the player’s matches, oldest first, with badminfo’s win chance', () => {
  const p = playerProfile(AMY_JSON, AMY);
  assert.equal(p.county, 'Exampleshire');
  assert.equal(p.beNumber, '1234');
  assert.equal(p.rubbers.length, 2); // the match without Amy is left out
  assert.equal(p.rubbers[0].tournament, 'Older');
  const r = p.rubbers[1];
  assert.deepEqual([r.side, r.winner, r.chance, r.change, r.discipline], [1, 2, 0.814, -8, 'singles']);
  assert.deepEqual(r.games, [[19, 21]]);
  assert.equal(playerProfile({}, AMY), null);
});

test('disciplineOf reads the draw code', () => {
  assert.deepEqual(['WS U15', 'GS U13 - Group A', 'BD U17', 'XD U15 - Group B', 'MX Open', 'Main draw'].map(disciplineOf), ['singles', 'singles', 'doubles', 'mixed', 'mixed', null]);
});

test('matchChance finds the match in a profile, from either side', () => {
  const profiles = [playerProfile(AMY_JSON, AMY)];
  assert.equal(matchChance({ tournamentId: T, ids: [[AMY], [CAT]], profiles }).a, 0.814);
  assert.equal(matchChance({ tournamentId: T, ids: [[CAT], [AMY]], profiles }).a, 0.186);
  assert.deepEqual(matchChance({ tournamentId: T, ids: [[CAT], [AMY]], profiles }).ratings, [[461], [526]]);
  assert.equal(matchChance({ tournamentId: T, ids: [[AMY], [DEE]], profiles }), null);
  assert.equal(matchChance({ tournamentId: null, ids: [[AMY], [CAT]], profiles }), null);
});

test('an upset is a win with under a 35% chance', () => {
  assert.equal(isUpset(0.814, 'b'), true);
  assert.equal(isUpset(0.6, 'b'), false);
  assert.equal(isUpset(0.2, 'a'), true);
  assert.equal(isUpset(null, 'a'), false);
});

test('ratingSeries and record', () => {
  const p = playerProfile(AMY_JSON, AMY);
  assert.deepEqual(ratingSeries(p.rubbers, AMY, p.ratings, p.ratingsDate), { singles: [{ date: '2026-09-01', rating: 500 }, { date: '2026-10-24', rating: 526 }, { date: '2026-10-31', rating: 518 }] });
  assert.deepEqual(record([{ won: true }, { won: false }, { won: null }, { won: true }]), { played: 3, won: 2, lost: 1 });
  assert.deepEqual(percents(0.635), ['64%', '36%']); // always adding up to 100
});

test('players are saved from imports, found for my names, and matched to a draw', async () => {
  const db = openDb();
  db.prepare("INSERT INTO tournaments (be_id, badminfo_id, name, start_date, end_date) VALUES ('b', ?, 'Example Open', '2026-10-24', '2026-10-24')").run(T);
  saveEntrants(db, 1, entrants(TOURNAMENT));
  assert.deepEqual(teamIds(db, 1, ['amy lee', 'Nobody']), [AMY, '']);
  const mine = myPlayers(db, ['Amy', 'Zed'], {});
  assert.deepEqual(mine.map((p) => p.id), [AMY, null]);
  assert.equal(myPlayers(db, ['Zed'], { Zed: DEE })[0].id, DEE);

  // Profiles are read only when stale; a failed read keeps what was there.
  let calls = 0;
  const fetchJson = async () => { calls += 1; return { json: AMY_JSON }; };
  assert.equal(await refreshProfile(db, AMY, { fetchJson }), true);
  assert.equal(await refreshProfile(db, AMY, { fetchJson }), false);
  assert.equal(calls, 1);
  assert.equal(await refreshProfile(db, CAT, { fetchJson: async () => ({ error: 'unavailable' }) }), false);

  const match = { draw: 'WS U15', round: 'Group D', teamA: ['Cat Ho'], teamB: ['Amy Lee'], winner: 1, games: [[21, 19]] };
  const tournament = { id: 1, badminfoId: T };
  const people = matchPeople(db, { match, tournament });
  assert.equal(people.discipline, 'singles');
  assert.deepEqual(people.teams.map((t) => t.map((p) => [p.name, p.rating, p.grade])), [[['Cat Ho', 461, '']], [['Amy Lee', 518, 'H']]]);
  assert.equal(people.chance.a, 0.186);
  assert.equal(people.upset, true);
  const forPage = tournamentPeople(db, tournament)(match);
  assert.deepEqual(forPage.ids, [[CAT], [AMY]]);
  assert.equal(forPage.chance, 0.186);
  assert.equal(forPage.upset, true);
});

test('the YouTube description can add badminfo pages, the win chance and an upset', () => {
  const tournament = { name: 'Example Open' };
  const match = { date: '2026-10-24', draw: 'WS U15', round: 'Group D', teamA: ['Cat Ho'], teamB: ['Amy Lee'], game: 0 };
  const people = { teams: [[{ name: 'Cat Ho', id: CAT, county: '' }], [{ name: 'Amy Lee', id: AMY, county: 'Exampleshire' }]], chance: { a: 0.186 }, upset: true };
  const plain = videoDescription({ tournament, match, games: [[21, 19]], people, options: { playerLinks: false, winChance: false } });
  assert.doesNotMatch(plain, /badminfo/);
  const full = videoDescription({ tournament, match, games: [[21, 19]], people, options: { playerLinks: true, winChance: true } });
  assert.match(full, /badminfo's chance before the match: Cat Ho 19%, Amy Lee 81% \(an upset!\)/);
  assert.match(full, new RegExp(`Amy Lee \\(Exampleshire\\): https://badminfo.com/Player/${AMY}`));
  assert.match(videoTitle({ tournament, match, games: [[21, 19]], upset: true }), / · 21-19 · \(upset\)$/);
});
