import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openDb } from '../lib/db.js';
import { matchesQuery, overview, search, stageOf } from '../lib/overview.js';
import { jobView, listJobs, startJob, stopJob } from '../lib/jobs.js';

test('stageOf: tag, then render, then upload, then done', () => {
  const r = (winner) => ({ start: 1, end: 2, winner });
  assert.equal(stageOf({ rallies: [] }), 'tag');
  assert.equal(stageOf({ rallies: [r('a'), r(null)] }), 'tag');
  assert.equal(stageOf({ rallies: [r('a'), r('let')] }), 'render');
  assert.equal(stageOf({ rallies: [r('a')], outputPath: 'x.mp4' }), 'upload');
  assert.equal(stageOf({ rallies: [r('a')], outputPath: 'x.mp4' }, false), 'render'); // the file was deleted
  assert.equal(stageOf({ rallies: [], youtubeUrl: 'https://youtu.be/x' }), 'done');
});

test('matchesQuery needs every word, in any case', () => {
  assert.ok(matchesQuery('Example Open WS U15 Amy Lee', 'lee ws'));
  assert.ok(!matchesQuery('Example Open WS U15 Amy Lee', 'lee xd'));
  assert.ok(!matchesQuery('anything', '  '));
});

test('overview sorts filmed matches by stage; search finds them by player or event', () => {
  const db = openDb();
  db.prepare("INSERT INTO tournaments (be_id, name, start_date, end_date) VALUES ('b', 'Example Open', '2026-10-24', '2026-10-24')").run();
  const add = (teamA, teamB, rallies, extra = '') => db.prepare(`INSERT INTO matches (tournament_id, match_date, match_time, draw, round, team_a, team_b, games, rallies${extra ? ', youtube_url' : ''})
    VALUES (1, '2026-10-24', ?, 'WS U15', 'Final', ?, ?, '[[21,3]]', ?${extra ? ', ?' : ''})`).run(`0${teamA.length}:00`, JSON.stringify(teamA), JSON.stringify(teamB), JSON.stringify(rallies), ...(extra ? [extra] : [])).lastInsertRowid;
  const tagged = [{ start: 1, end: 2, winner: 'a' }];
  const ids = [add(['Amy Lee'], ['Cat Ho'], []), add(['Ben Ng'], ['Dee Wu'], tagged), add(['Eve Ma'], ['Fay Yu'], tagged, 'https://youtu.be/abc'), add(['Gil Oh'], ['Hal Ip'], tagged)];
  ids.slice(0, 3).forEach((id, i) => db.prepare(`INSERT INTO videos (path, size, modified_at, recorded_at, match_id) VALUES (?, 1, 'x', '2026-10-24T08:00:00Z', ?)`).run(`C:/v/${i}.mp4`, id));
  db.prepare(`INSERT INTO videos (path, size, modified_at, recorded_at) VALUES ('C:/v/free.mp4', 1, 'x', '2026-10-24T08:00:00Z')`).run();
  const o = overview(db);
  assert.deepEqual(o.counts, { tag: 1, render: 1, upload: 0, done: 1 });
  assert.equal(o.unlinked, 1);
  assert.equal(o.tag[0].teamA[0], 'Amy Lee');
  assert.equal(o.render[0].tagged, 1);
  assert.deepEqual(search(db, 'example ws').map((m) => m.teamA[0]).sort(), ['Amy Lee', 'Ben Ng', 'Eve Ma', 'Gil Oh']);
  assert.deepEqual(search(db, 'u15', 'uploaded').map((m) => m.teamA[0]), ['Eve Ma']);
  assert.deepEqual(search(db, 'hal').map((m) => m.videos), [0]);
  assert.equal(search(db, 'hal', 'video').length, 0);
});

const settled = (job) => new Promise((resolve) => {
  const check = () => (job.status === 'running' || job.status === 'queued' ? setTimeout(check, 5) : resolve(job));
  check();
});

test('jobs on a queue run one at a time, in order; a waiting one can be stopped', async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = startJob('render', 'render:q1', async (j) => { order.push('1 start'); j.message = 'Joining'; await gate; order.push('1 end'); return 1; }, { queue: 'test-gpu', label: 'First' });
  const second = startJob('render', 'render:q2', async () => { order.push('2 start'); return 2; }, { queue: 'test-gpu' });
  const third = startJob('render', 'render:q3', async () => { order.push('3 start'); }, { queue: 'test-gpu' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(first.status, 'running');
  assert.equal(second.status, 'queued');
  assert.equal(jobView(third).ahead, 2);
  assert.equal(jobView(first).label, 'First');
  assert.equal(startJob('render', 'render:q2', async () => {}, { queue: 'test-gpu' }), second); // same key while waiting: the same job
  stopJob(third.id);
  assert.equal(third.status, 'stopped');
  release();
  await settled(second);
  await settled(third);
  assert.deepEqual(order, ['1 start', '1 end', '2 start']);
  assert.equal(second.result, 2);
  assert.equal(first.message, 'Finished'); // not its last step's "Joining"
  assert.equal(third.status, 'stopped');
  assert.ok(listJobs().indexOf(third) < listJobs().indexOf(first)); // newest first
});

test('a match’s videos: the match itself, or each game filmed on its own, in game order', async () => {
  const { openDb } = await import('../lib/db.js');
  const { filmedUnits } = await import('../lib/overview.js');
  const db = openDb();
  db.exec('PRAGMA foreign_keys = OFF');
  const tid = db.prepare("INSERT INTO tournaments (name, kind) VALUES ('T', 'custom') RETURNING id").get().id;
  const add = (game, parent) => db.prepare(`INSERT INTO matches (tournament_id, parent_id, game, match_date, match_time, draw, round, team_a, team_b)
    VALUES (?, ?, ?, '2026-11-01', '09:00', 'WS', 'R1', '["A"]', '["B"]') RETURNING id`).get(tid, parent, game).id;
  const whole = add(0, null);
  const g2 = add(2, whole);
  const g1 = add(1, whole);
  const video = (path, matchId) => db.prepare("INSERT INTO videos (path, size, modified_at, match_id) VALUES (?, 1, '2026-11-01T00:00:00Z', ?)").run(path, matchId);
  assert.deepEqual(filmedUnits(db, whole), []);
  video('g2.mp4', g2);
  video('g1.mp4', g1);
  assert.deepEqual(filmedUnits(db, whole), [{ id: g1, game: 1 }, { id: g2, game: 2 }]);
  db.close();
});
