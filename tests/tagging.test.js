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
    await call(`/api/matches/${first}/videos`, 'PUT', { videoIds: [] });
    // Tagging left on a match with no video (from before tagging followed videos).
    db.prepare('UPDATE matches SET rallies = ? WHERE id = ?').run(JSON.stringify([{ start: 1, end: 2, winner: 'a' }]), second);
    const r = await call(`/api/matches/${second}/videos`, 'PUT', { videoIds: [1] });
    assert.deepEqual(r.body.tagging, { moved: false, rallies: 2 });
    assert.equal(get(db, second).rallies.length, 1);
    assert.match(db.prepare('SELECT carried_tagging FROM videos WHERE id = 1').get().carried_tagging, /"rallies"/);
  });
});

test('a match or game takes one video; linking another replaces it, which carries its tagging away', async () => {
  await withServer(async ({ db, call, matches: [first] }) => {
    await call(`/api/matches/${first}/videos`, 'PUT', { videoIds: [1] });
    await call(`/api/matches/${first}`, 'PUT', { rallies: RALLIES });
    const two = await call(`/api/matches/${first}/videos`, 'PUT', { videoIds: [1, 2] });
    assert.equal(two.status, 400);
    assert.equal(two.body.error, 'oneVideo');
    const r = await call(`/api/matches/${first}/videos`, 'PUT', { videoIds: [2] });
    assert.equal(r.status, 200);
    assert.deepEqual(db.prepare('SELECT id FROM videos WHERE match_id = ?').all(first).map((v) => v.id), [2]);
    assert.equal(get(db, first).rallies.length, 0);
    assert.match(db.prepare('SELECT carried_tagging FROM videos WHERE id = 1').get().carried_tagging, /"rallies"/);
  });
});

test('unlink all clears a tournament’s links; each video takes its tagging', async () => {
  await withServer(async ({ db, call, matches: [first, second] }) => {
    await call(`/api/matches/${first}/videos`, 'PUT', { videoIds: [1] });
    await call(`/api/matches/${first}`, 'PUT', { rallies: RALLIES });
    await call(`/api/matches/${second}/videos`, 'PUT', { videoIds: [2] });
    const tid = db.prepare('SELECT tournament_id FROM matches WHERE id = ?').get(first).tournament_id;
    const r = await call(`/api/tournaments/${tid}/unlink-all`, 'POST');
    assert.deepEqual(r.body, { ok: true, unlinked: 2 });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM videos WHERE match_id IS NOT NULL').get().n, 0);
    assert.match(db.prepare('SELECT carried_tagging FROM videos WHERE id = 1').get().carried_tagging, /"rallies"/);
    assert.equal((await call('/api/tournaments/999/unlink-all', 'POST')).status, 404);
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

test('a comment is saved on its own, tagging untouched, and cleared with an empty one', async () => {
  await withServer(async ({ db, call, matches: [first] }) => {
    await call(`/api/matches/${first}/videos`, 'PUT', { videoIds: [1] });
    await call(`/api/matches/${first}`, 'PUT', { rallies: RALLIES });
    const r = await call(`/api/matches/${first}`, 'PUT', { comment: '  Hayley’s best game.\r\n' });
    assert.equal(r.body.comment, 'Hayley’s best game.');
    assert.equal(db.prepare('SELECT comment FROM matches WHERE id = ?').get(first).comment, 'Hayley’s best game.');
    assert.equal(get(db, first).rallies.length, 2);
    await call(`/api/matches/${first}`, 'PUT', { comment: '' });
    assert.equal(db.prepare('SELECT comment FROM matches WHERE id = ?').get(first).comment, null);
  });
});

test('starring a match, also from one of its games, marks the whole match', async () => {
  await withServer(async ({ db, call, matches: [first] }) => {
    const r = await call(`/api/matches/${first}/favourite`, 'PUT', { favourite: true });
    assert.deepEqual(r.body, { ok: true, id: first, favourite: true });
    assert.equal(db.prepare('SELECT favourite FROM matches WHERE id = ?').get(first).favourite, 1);
    // A game's row, made when a video is linked to it, stars its parent.
    await call(`/api/matches/${first}/games/1/videos`, 'PUT', { videoIds: [1] });
    const game = db.prepare('SELECT id FROM matches WHERE parent_id = ? AND game = 1').get(first).id;
    const off = await call(`/api/matches/${game}/favourite`, 'PUT', { favourite: false });
    assert.equal(off.body.id, first);
    assert.equal(db.prepare('SELECT favourite FROM matches WHERE id = ?').get(first).favourite, null);
    assert.equal((await call(`/api/matches/${first}/favourite`, 'PUT', { favourite: 'yes' })).status, 400);
  });
});

test('the Players list order is saved by PUT /api/favourites/order', async () => {
  await withServer(async ({ db, call }) => {
    const add = db.prepare('INSERT INTO favourites (name, starred) VALUES (?, 1)');
    const [a, b] = ['Zoe Ng', 'Bea Ho'].map((n) => Number(add.run(n).lastInsertRowid));
    assert.deepEqual((await call('/api/favourites/order', 'PUT', { keys: [a, b] })).body, { ok: true, moved: 2 });
    assert.deepEqual((await call('/api/favourites')).body.favourites.map((f) => f.name), ['Zoe Ng', 'Bea Ho']);
    for (const keys of [null, ['x'], [a, a]]) assert.equal((await call('/api/favourites/order', 'PUT', { keys })).status, 400);
  });
});
