import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { allowed, createApp, route } from '../server.js';
import { openDb } from '../lib/db.js';
import { saveTournament } from '../lib/tournaments.js';
import { parseMatches } from '../lib/schedule.js';
import { PAGE } from './fixtures/be-pages.js';
import { selectArg } from '../api/matches.js';

test('Show in folder quotes only the path for Explorer, with Windows slashes', () => {
  assert.equal(selectArg('D:/Badminton videos/2026/0940 XD U15 - Lee v Ho.mp4'), '/select,"D:\\Badminton videos\\2026\\0940 XD U15 - Lee v Ho.mp4"');
});

test('routes match methods and fill in ids', () => {
  assert.deepEqual(route('GET', '/api/matches/12').params, { id: '12' });
  assert.equal(route('DELETE', '/api/matches/12'), null);
  assert.equal(route('GET', '/api/nothing'), null);
});

test('only this PC’s own pages may call the API', () => {
  assert.ok(allowed({ host: '127.0.0.1:8791' }, 'GET', 8791));
  assert.ok(allowed({ host: 'localhost:8791', origin: 'http://localhost:8791' }, 'PUT', 8791));
  assert.ok(!allowed({ host: 'evil.test:8791' }, 'GET', 8791)); // DNS rebinding
  assert.ok(!allowed({ host: '127.0.0.1:8791', origin: 'https://evil.test' }, 'POST', 8791)); // cross-site write
});

async function withServer(fn) {
  const app = { db: openDb(), port: 0 };
  const server = createApp(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  app.port = server.address().port; // the Host check reads it per request
  try {
    await fn({ db: app.db, base: `http://127.0.0.1:${app.port}` });
  } finally {
    server.close();
  }
}

test('the API serves settings, tournaments and match tagging', async () => {
  await withServer(async ({ db, base }) => {
    const settings = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(settings.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version);
    const star = await fetch(`${base}/api/favourites`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name: ' Amy ' }) });
    assert.equal(star.status, 201);
    assert.deepEqual((await (await fetch(`${base}/api/favourites`)).json()).favourites.map((f) => f.name), ['Amy']);

    const tid = saveTournament(db, { beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });
    db.prepare(`INSERT INTO videos (path, size, modified_at, recorded_at, duration, width, height, fps) VALUES ('C:/v/a.mp4', 1, 'x', '2026-10-24T08:20:00Z', 900, 1920, 1080, 30)`).run();
    const t = await (await fetch(`${base}/api/tournaments/${tid}`)).json();
    assert.equal(t.matches.length, 3);
    // Sorted by time, then event; Amy plays in both XD matches.
    assert.deepEqual(t.matches.map((m) => [m.draw, m.mine]), [['OS U15 - Group B', false], ['XD U15 - Group A', true], ['XD U15', true]]);
    assert.deepEqual(t.matches[1].favs, { a: [1], b: [] });
    assert.deepEqual(t.favourites.map((f) => f.name), ['Amy']);
    // The 9:20 video is Amy's 9:00 match.
    assert.equal(t.suggestions.length, 1);
    assert.equal(t.suggestions[0].matchId, t.matches[1].id);

    const mid = t.matches[1].id;
    const link = await fetch(`${base}/api/matches/${mid}/videos`, { method: 'PUT', headers: { Origin: base }, body: JSON.stringify({ videoIds: [1] }) });
    assert.equal(link.status, 200);
    const save = await fetch(`${base}/api/matches/${mid}`, { method: 'PUT', headers: { Origin: base }, body: JSON.stringify({ rallies: [{ start: 3, end: 9, winner: 'a' }], firstServer: 'b' }) });
    assert.equal(save.status, 200);
    const m = await (await fetch(`${base}/api/matches/${mid}`)).json();
    assert.deepEqual(m.match.rallies, [{ start: 3, end: 9, winner: 'a' }]);
    assert.equal(m.match.firstServer, 'b');
    assert.equal(m.source.ready, true);
    assert.equal(m.source.url, `/media/match/${mid}`);
    assert.match(m.output.title, /^Example · XD U15 - Group A Round 1 · Lee\/Ng v Ho\/Wu · 21-13$/);

    // Start score, match bounds and the YouTube link.
    const putMatch = (body) => fetch(`${base}/api/matches/${mid}`, { method: 'PUT', headers: { Origin: base }, body: JSON.stringify(body) });
    let r = await (await putMatch({ startScore: { games: [], points: [5, 3] }, matchStart: 12.345, matchEnd: 600, youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).json();
    assert.deepEqual([r.startScore, r.matchStart, r.matchEnd, r.youtubeUrl], [{ games: [], points: [5, 3] }, 12.35, 600, 'https://youtu.be/dQw4w9WgXcQ']);
    assert.match(r.uploadedAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal((await putMatch({ youtubeUrl: 'https://example.test/video' })).status, 400);
    assert.equal((await putMatch({ matchEnd: 5 })).status, 400); // before the start
    assert.equal((await putMatch({ startScore: { games: [], points: [25, 3] } })).status, 400);
    const t2 = await (await fetch(`${base}/api/tournaments/${tid}`)).json();
    assert.equal(t2.matches[1].youtubeUrl, 'https://youtu.be/dQw4w9WgXcQ');
    assert.deepEqual(t2.matches[1].tagGames, [[6, 3]]); // 5-3 at the start, then A's rally
    assert.equal((await (await fetch(`${base}/api/tournaments`)).json()).tournaments[0].uploaded, 1);
    r = await (await putMatch({ youtubeUrl: '', startScore: null, matchStart: null })).json();
    assert.deepEqual([r.youtubeUrl, r.uploadedAt, r.startScore, r.matchStart], [null, null, null, null]);

    // Grid thumbnails: offered only for matches with a video; none can be made for a file that isn't there.
    assert.equal(t2.matches[1].thumb, `/media/thumb/${mid}`);
    assert.equal(t2.matches[0].thumb, null);
    assert.equal((await fetch(`${base}/media/thumb/${t2.matches[0].id}`)).status, 404);

    assert.equal((await fetch(`${base}/api/matches/999`)).status, 404);
    assert.equal((await fetch(`${base}/api/matches/${mid}`, { method: 'PUT', headers: { Origin: 'https://evil.test' }, body: '{}' })).status, 403);
  });
});

test('the page and its scripts are served with a content security policy', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await res.text(), /<main id="app"/);
    assert.equal((await fetch(`${base}/shared/score.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await fetch(`${base}/..%2fserver.js`)).status, 404);
  });
});

test('a tournament can be marked complete and reopened', async () => {
  await withServer(async ({ db, base }) => {
    const id = saveTournament(db, { beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });
    const put = (body) => fetch(`${base}/api/tournaments/${id}/complete`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
    assert.equal((await put({})).status, 400);
    const done = await (await put({ complete: true })).json();
    assert.match(done.completedAt, /^\d{4}-\d{2}-\d{2}T/);
    const list = await (await fetch(`${base}/api/tournaments`)).json();
    assert.equal(list.tournaments[0].completedAt, done.completedAt);
    assert.equal((await (await put({ complete: false })).json()).completedAt, null);
    assert.equal((await fetch(`${base}/api/tournaments/999/complete`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{"complete":true}' })).status, 404);
  });
});
