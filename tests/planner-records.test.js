// Rallies filled in from the planner's recorded games (2.1.0). Made-up people and ids only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../lib/db.js';
import { PAD_AFTER, PAD_BEFORE, fillFromRecords, placeRecords, recordsStatus } from '../lib/planner-records.js';

const T = '99999999-9999-4999-8999-999999999999';
const AMY = '11111111-1111-4111-8111-111111111111';
const MIA = '33333333-3333-4333-8333-333333333333';
const KEY = [T, 6, AMY, MIA].join('|');
const START = Date.parse('2026-11-01T09:00:00Z'); // the video began recording
const JSON_T = { beTournament: { players: [{ index: 1, id: AMY, playerEntryName: 'Amy Sample' }, { index: 3, id: MIA, playerEntryName: 'Mia Madeup' }],
  events: [{ name: 'WS U15', draws: [{ index: 6, name: 'Group A', type: 'Round Robin', rubbers: [{ team1PlayerIndexes: [1], team2PlayerIndexes: [3], games: [] }] }] }] } };

/** A game as the planner gives it: `points` like 'aab' for side a, a, b (the planner's own sides), one rally every 30 s from `from` s into the video. */
function game(number, points, { from = 60, sides = { a: [MIA], b: [AMY] }, timed = true, over = true, firstServer = 'a', startA = 0, startB = 0 } = {}) {
  const score = { a: startA, b: startB };
  const rallies = Array.from(points, (p, i) => {
    score[p] += 1;
    const at = START + (from + i * 30) * 1000;
    return { at: timed ? at : null, end: timed ? at + 8000 : null, winner: p, a: score.a, b: score.b };
  });
  return { number, sides, firstServer, startA, startB, done: false, over, winner: over ? (score.a > score.b ? 'a' : 'b') : '', score: { ...score }, timed, rallies, rev: 1 };
}
const teams = [[{ id: AMY, name: 'Amy Sample' }], [{ id: MIA, name: 'Mia Madeup' }]]; // this app's team a is Amy

test('rallies put on the video by the clock, from this app’s side, with who served and the score it starts at', () => {
  const got = placeRecords([game(1, 'aab')], { game: 1, recordedAt: START, duration: 3600, teams });
  // The planner's side a is Mia, this app's team b.
  assert.deepEqual(got.rallies, [
    { start: 60 - PAD_BEFORE, end: 68 + PAD_AFTER, winner: 'b' },
    { start: 90 - PAD_BEFORE, end: 98 + PAD_AFTER, winner: 'b' },
    { start: 120 - PAD_BEFORE, end: 128 + PAD_AFTER, winner: 'a' }]);
  assert.deepEqual([got.firstServer, got.startScore, got.placed, got.total], ['b', null, 3, 3]);
  // The video began after the first rally: the rest, from the score at that point, served by its winner.
  const late = placeRecords([game(1, 'aabbb', { from: -10 })], { game: 1, recordedAt: START, duration: 3600, teams });
  assert.deepEqual([late.placed, late.total, late.firstServer, late.startScore], [4, 5, 'b', { games: [], points: [0, 1] }]);
  // The whole match's video: game 1, then game 2, whose score before it is game 1's.
  const whole = placeRecords([game(2, 'b', { from: 300 }), game(1, 'aa')], { game: 0, recordedAt: START, duration: 3600, teams });
  assert.deepEqual([whole.rallies.map((r) => r.winner), whole.startScore], [['b', 'b', 'a'], null]);
});

test('a record is used only when it fits: finished, every tap timed, the same people, mostly on this video', () => {
  const unit = { game: 1, recordedAt: START, duration: 600, teams };
  assert.equal(placeRecords([], unit).reason, 'noRecord');
  assert.equal(placeRecords([game(2, 'a')], unit).reason, 'noRecord');
  assert.equal(placeRecords([game(1, 'aab', { timed: false })], unit).reason, 'untimed');
  assert.equal(placeRecords([game(1, 'aab', { over: false })], unit).reason, 'unfinished');
  assert.equal(placeRecords([game(1, 'aab', { sides: { a: [MIA], b: ['44444444-4444-4444-8444-444444444444'] } })], unit).reason, 'otherPeople');
  assert.equal(placeRecords([game(1, 'aab', { from: 5000 })], unit).reason, 'outside', 'another video, or a phone clock far out');
  // Rallies are never laid over each other.
  const tight = placeRecords([{ ...game(1, 'ab'), rallies: game(1, 'ab').rallies.map((r, i) => ({ ...r, at: START + 60000 + i * 3000, end: START + 62000 + i * 3000 })) }], unit);
  assert.ok(tight.rallies[1].start >= tight.rallies[0].end);
});

/** The app with one match whose game 1 has a video, connected to a pretend planner. */
function setUp(t, records) {
  const db = openDb();
  db.prepare("INSERT INTO tournaments (id, be_id, badminfo_id, name) VALUES (1, 'be', ?, 'Example')").run(T);
  const m = Number(db.prepare(`INSERT INTO matches (tournament_id, match_date, match_time, draw, round, team_a, team_b, games, parent_id, game) VALUES (1, '2026-11-01', '09:00', 'WS U15 - Group A', 'Round 1', ?, ?, '[[21,15]]', NULL, 0)`)
    .run(JSON.stringify(['Amy Sample']), JSON.stringify(['Mia Madeup'])).lastInsertRowid);
  const g1 = Number(db.prepare(`INSERT INTO matches (tournament_id, match_date, match_time, draw, round, team_a, team_b, games, parent_id, game) VALUES (1, '2026-11-01', '09:00', 'WS U15 - Group A', 'Round 1', ?, ?, '[[21,15]]', ?, 1)`)
    .run(JSON.stringify(['Amy Sample']), JSON.stringify(['Mia Madeup']), m).lastInsertRowid);
  const v = Number(db.prepare("INSERT INTO videos (path, size, modified_at, recorded_at, duration, match_id) VALUES ('C:/v/one.mp4', 1, 'x', ?, 1800, ?)").run(new Date(START).toISOString(), g1).lastInsertRowid);
  const dataDir = mkdtempSync(join(tmpdir(), 'records-'));
  writeFileSync(join(dataDir, 'planner.json'), JSON.stringify({ origin: 'https://planner.test', token: `bv_${'a'.repeat(43)}`, account: 'Kim' }));
  const asked = [];
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async (url, opts = {}) => {
    asked.push(String(url));
    if (String(url).startsWith('https://badstats.')) return Response.json(JSON_T);
    assert.equal(opts.headers.Authorization, `Bearer bv_${'a'.repeat(43)}`);
    return Response.json({ records: records() });
  };
  return { db, app: { db, dataDir }, g1, m, v, asked };
}

test('an untagged video takes the record once; tagging already there is never touched', async (t) => {
  let records = {};
  const s = setUp(t, () => records);
  await fillFromRecords(s.app);
  assert.equal(JSON.parse(s.db.prepare('SELECT rallies FROM matches WHERE id = ?').get(s.g1).rallies).length, 0, 'nothing recorded yet');
  assert.ok(s.asked.some((u) => u.includes(`/api/video-records?keys=${encodeURIComponent(KEY)}`)), 'asked by the planner’s key');

  records = { [KEY]: [game(1, 'aab')] };
  assert.equal((await fillFromRecords(s.app)).filled, 1);
  const row = s.db.prepare('SELECT * FROM matches WHERE id = ?').get(s.g1);
  assert.deepEqual([JSON.parse(row.rallies).map((r) => r.winner), row.first_server, row.server_set, row.start_score], [['b', 'b', 'a'], 'b', 1, null]);
  assert.ok(row.auto_tagged, 'marked to review');
  assert.equal(recordsStatus().filled[0].rallies, 3);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM planner_keys').get().n, 1, 'badminfo asked once, the key kept');

  // Cleared by hand: not filled again for the same video.
  s.db.prepare("UPDATE matches SET rallies = '[]', auto_tagged = NULL WHERE id = ?").run(s.g1);
  assert.equal((await fillFromRecords(s.app)).filled, 0);
  // Tagged by hand on another video: left alone.
  s.db.prepare('DELETE FROM planner_records').run();
  s.db.prepare(`UPDATE matches SET rallies = '[{"start":1,"end":2,"winner":"a"}]' WHERE id = ?`).run(s.g1);
  assert.equal((await fillFromRecords(s.app)).filled, 0);
  assert.equal(JSON.parse(s.db.prepare('SELECT rallies FROM matches WHERE id = ?').get(s.g1).rallies).length, 1);
});

test('a record that doesn’t fit is said why, and the video waits', async (t) => {
  const s = setUp(t, () => ({ [KEY]: [game(1, 'aab', { timed: false })] }));
  await fillFromRecords(s.app);
  assert.deepEqual(recordsStatus().waiting.map((w) => [w.matchId, /without tap times/.test(w.why)]), [[s.g1, true]]);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM planner_records').get().n, 0, 'looked at again next time');
});
