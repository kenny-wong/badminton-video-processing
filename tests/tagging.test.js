import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createApp } from '../server.js';
import { matchFromRow, openDb } from '../lib/db.js';
import { saveTournament } from '../lib/tournaments.js';
import { parseMatches } from '../lib/schedule.js';
import { PAGE } from './fixtures/be-pages.js';

async function withServer(fn) {
  const app = { db: openDb(), port: 0 };
  const server = createApp(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  app.port = server.address().port;
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, { method, headers: { Origin: base }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const tid = saveTournament(app.db, { beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });
    const ids = app.db.prepare('SELECT id FROM matches WHERE tournament_id = ? ORDER BY id').all(tid).map((r) => r.id);
    app.db.prepare(`INSERT INTO videos (path, size, modified_at, recorded_at, duration) VALUES ('C:/v/a.mp4', 1, 'x', '2026-10-24T08:20:00Z', 900), ('C:/v/b.mp4', 1, 'x', '2026-10-24T13:50:00Z', 900)`).run();
    await fn({ db: app.db, call, matches: ids, tid });
  } finally {
    server.close();
  }
}

const RALLIES = [{ start: 3, end: 9, winner: 'a', fav: true }, { start: 15, end: 22, winner: 'b' }];
const get = (db, id) => matchFromRow(db.prepare('SELECT * FROM matches WHERE id = ?').get(id));

test('unlinking clears the match, and the tagging follows the video to its next match', async () => {
  await withServer(async ({ db, call, matches: [wrong, right] }) => {
    await call(`/api/matches/${wrong}/videos`, 'PUT', { videoIds: [1] });
    await call(`/api/matches/${wrong}`, 'PUT', { rallies: RALLIES, startScore: { games: [], points: [2, 1] }, matchStart: 1, firstServer: 'b', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' });

    assert.equal((await call(`/api/matches/${wrong}/videos`, 'PUT', { videoIds: [] })).body.tagging, null);
    const cleared = get(db, wrong);
    assert.deepEqual([cleared.rallies, cleared.startScore, cleared.matchStart, cleared.youtubeUrl, cleared.firstServer], [[], null, null, null, 'a']);
    const t = await call('/api/tournaments/1');
    assert.equal(t.body.matches.find((m) => m.id === wrong).rallyCount, 0);

    const linked = await call(`/api/matches/${right}/videos`, 'PUT', { videoIds: [1] });
    assert.deepEqual(linked.body.tagging, { moved: true, rallies: 2 });
    const moved = get(db, right);
    assert.deepEqual(moved.rallies, RALLIES);
    assert.deepEqual([moved.startScore, moved.matchStart, moved.firstServer], [{ games: [], points: [2, 1] }, 1, 'b']);
    assert.equal(db.prepare('SELECT carried_tagging FROM videos WHERE id = 1').get().carried_tagging, null);
  });
});

test('linking a video straight from another match brings its tagging too', async () => {
  await withServer(async ({ db, call, matches: [first, second] }) => {
    await call(`/api/matches/${first}/videos`, 'PUT', { videoIds: [1] });
    await call(`/api/matches/${first}`, 'PUT', { rallies: RALLIES });
    const r = await call(`/api/matches/${second}/videos`, 'PUT', { videoIds: [1] });
    assert.deepEqual(r.body.tagging, { moved: true, rallies: 2 });
    assert.deepEqual([get(db, first).rallies.length, get(db, second).rallies.length], [0, 2]);
  });
});

test('a match with its own tagging keeps it; the video holds on to the other', async () => {
  await withServer(async ({ db, call, matches: [first, second] }) => {
    await call(`/api/matches/${first}/videos`, 'PUT', { videoIds: [1] });
    await call(`/api/matches/${first}`, 'PUT', { rallies: RALLIES });
    await call(`/api/matches/${second}/videos`, 'PUT', { videoIds: [2] });
    await call(`/api/matches/${second}`, 'PUT', { rallies: [{ start: 1, end: 2, winner: 'a' }] });
    await call(`/api/matches/${first}/videos`, 'PUT', { videoIds: [] });
    const r = await call(`/api/matches/${second}/videos`, 'PUT', { videoIds: [2, 1] });
    assert.deepEqual(r.body.tagging, { moved: false, rallies: 2 });
    assert.equal(get(db, second).rallies.length, 1);
    assert.match(db.prepare('SELECT carried_tagging FROM videos WHERE id = 1').get().carried_tagging, /"rallies"/);
  });
});

test('tagging stranded on a match with no video can be brought over', async () => {
  await withServer(async ({ db, call, matches: [old, target, other] }) => {
    // Tagging left behind before tagging followed videos.
    db.prepare('UPDATE matches SET rallies = ? WHERE id = ?').run(JSON.stringify(RALLIES), old);
    await call(`/api/matches/${target}/videos`, 'PUT', { videoIds: [1] });
    const m = await call(`/api/matches/${target}`);
    assert.deepEqual(m.body.stranded.map((s) => [s.id, s.rallies]), [[old, 2]]);
    assert.equal((await call(`/api/matches/${target}/take-tagging`, 'POST', { from: other })).status, 404); // nothing there
    assert.equal((await call(`/api/matches/${target}/take-tagging`, 'POST', { from: old })).status, 200);
    assert.deepEqual([get(db, old).rallies.length, get(db, target).rallies.length], [0, 2]);
    // A match that has tagging asks before replacing it.
    db.prepare('UPDATE matches SET rallies = ? WHERE id = ?').run(JSON.stringify(RALLIES.slice(0, 1)), old);
    assert.equal((await call(`/api/matches/${target}/take-tagging`, 'POST', { from: old })).status, 409);
    assert.equal((await call(`/api/matches/${target}/take-tagging`, 'POST', { from: old, replace: true })).status, 200);
    assert.equal(get(db, target).rallies.length, 1);
  });
});
