import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apiUrl, badminfoId, getJson, playerApiUrl, summarize, summarizePlayer } from '../lib/badminfo.js';
import { ID, PLAYER, PLAYER_ID, SAMPLE, playerId } from './fixtures/badminfo-sample.js';

test('badminfoId takes the id from a badminfo tournament link and nothing else', () => {
  assert.equal(badminfoId(`https://badminfo.com/Tournament/${ID}?t=OD&s=g`), ID);
  assert.equal(badminfoId(`  https://www.badminfo.com/tournament/${ID.toUpperCase()}/  `), ID);
  assert.equal(badminfoId(`https://badminfo.com.evil.example/Tournament/${ID}`), null);
  assert.equal(badminfoId(`https://evil.example/?u=https://badminfo.com/Tournament/${ID}`), null);
  assert.equal(badminfoId(`https://be.tournamentsoftware.com/tournament/${ID}/draw/1`), null);
  assert.equal(badminfoId('https://badminfo.com/Tournament/not-a-guid'), null);
  assert.equal(badminfoId(`ftp://badminfo.com/Tournament/${ID}`), null);
  assert.equal(badminfoId('not a link'), null);
  assert.equal(badminfoId(null), null);
});

test('summarize keeps the round-robin groups with their teams and scores', () => {
  const s = summarize(SAMPLE, ID);
  assert.equal(s.name, 'Example Super Series');
  assert.equal(s.start, '2026-10-25');
  assert.equal(s.end, '2027-04-18');
  assert.equal(s.url, `https://badminfo.com/Tournament/${ID}`);
  // The elimination draw and the empty group are left out.
  assert.deepEqual(s.groups.map((g) => g.name), ['WD Example']);
  const [group] = s.groups;
  assert.deepEqual(group.teams, [['Amy', 'Bea'], ['Cat', 'Dee'], ['Eve', 'Fay']]);
  assert.deepEqual(group.ids, [[playerId(0), playerId(1)], [playerId(2), playerId(3)], [playerId(4), playerId(5)]]);
  assert.deepEqual(group.matches[0], { a: 0, b: 1, games: [[21, 15], [21, 11]], winner: 'a', note: null });
  assert.deepEqual(group.matches[1].games, [[22, 20], [17, 21], [22, 20]]);
  // The same pair in another order is the same team.
  assert.deepEqual(group.matches[2], { a: 2, b: 1, games: [], winner: 'b', note: 'Walkover' });
});

test('summarize rejects JSON that is not a tournament and tolerates bad values', () => {
  assert.equal(summarize(null, ID), null);
  assert.equal(summarize({ beTournament: null }, ID), null);
  const s = summarize({ beTournament: { events: [{ draws: [{ type: 'Round Robin', rubbers: [
    { team1PlayerIndexes: [1], team2PlayerIndexes: [2], games: [{ team1Score: 21, team2Score: 'x' }, null] },
    { team1PlayerIndexes: [1], team2PlayerIndexes: [1] },
    null,
  ] }] }] } }, ID);
  assert.deepEqual(s.groups[0].teams, [['?'], ['?']]);
  assert.deepEqual(s.groups[0].matches, [{ a: 0, b: 1, games: [], winner: null, note: null }]);
});

function stubFetch(t, response) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  });
  return calls;
}

test('getJson reads badminfo JSON, and reports a missing id or an unreachable badminfo', async (t) => {
  t.mock.method(console, 'error', () => {});
  let calls = stubFetch(t, new Response(JSON.stringify(SAMPLE), { status: 200 }));
  assert.deepEqual(await getJson(apiUrl(ID), 60), { json: SAMPLE });
  assert.equal(calls[0].url, `https://badstats.azurewebsites.net/api/tournaments/${ID}`);
  t.mock.restoreAll();
  t.mock.method(console, 'error', () => {});
  calls = stubFetch(t, new Response(null, { status: 204 }));
  assert.deepEqual(await getJson(playerApiUrl(PLAYER_ID), 60), { status: 404, error: 'notFound' });
  t.mock.restoreAll();
  t.mock.method(console, 'error', () => {});
  stubFetch(t, new Error('offline'));
  assert.deepEqual(await getJson(apiUrl(ID), 60), { status: 502, error: 'unavailable' });
});

test('badminfoId reads player links only when asked for a player', () => {
  assert.equal(badminfoId(`https://badminfo.com/Player/${PLAYER_ID}`, 'player'), PLAYER_ID);
  assert.equal(badminfoId(`https://badminfo.com/Player/${PLAYER_ID}`), null);
  assert.equal(badminfoId(`https://badminfo.com/Tournament/${ID}`, 'player'), null);
});

test('summarizePlayer keeps the latest grade in each discipline, the BE number and ratings', () => {
  assert.deepEqual(summarizePlayer(PLAYER, PLAYER_ID), {
    source: 'badminfo',
    id: PLAYER_ID,
    url: `https://badminfo.com/Player/${PLAYER_ID}`,
    name: 'Kim Example',
    beNumber: '1234567',
    grades: { singles: 'H', doubles: 'I', mixed: 'H' },
    gradeDates: { singles: '2026-10-30', doubles: '2026-02-27', mixed: '2026-10-30' },
    ratings: { singles: 515, doubles: 463, mixed: 473 },
    ratingsDate: '2026-10-30',
    // Oldest first, each once; the league is left out.
    tournaments: [
      { id: 'aaaa0002-0000-4000-8000-000000000002', name: 'Example U15 Bronze October', start: '2026-10-24', end: '2026-10-24' },
      { id: 'aaaa0001-0000-4000-8000-000000000001', name: 'Example U15 Silver', start: '2026-11-01', end: '2026-11-01' },
    ],
  });
  const bare = summarizePlayer({ name: 'Lee', gradings: [{ key: 'Single', value: 'Z' }], beNumber: 'x', ratings: { singlesRating: -5 } }, PLAYER_ID);
  assert.deepEqual([bare.beNumber, bare.grades.singles, bare.ratings.singles, bare.ratingsDate], ['', '', null, null]);
  assert.equal(summarizePlayer(null, PLAYER_ID), null);
});

