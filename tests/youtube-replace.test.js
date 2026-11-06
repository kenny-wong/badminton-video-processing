import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../lib/db.js';
import { saveTournament } from '../lib/tournaments.js';
import { parseMatches } from '../lib/schedule.js';
import { getJob } from '../lib/jobs.js';
import { gameRow } from '../api/matches.js';
import { onRequestGet, renderedList, upload, uploadAll, videosInMatchOrder } from '../api/youtube.js';
import { rmSync } from 'node:fs';
import { PAGE } from './fixtures/be-pages.js';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A match with a rendered video and an earlier upload (OLD, second in the tournament's playlist), signed in to YouTube. */
function setUp() {
  const dataDir = mkdtempSync(join(tmpdir(), 'yt-replace-'));
  const db = openDb();
  const tid = saveTournament(db, { beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });
  const id = db.prepare('SELECT id FROM matches WHERE tournament_id = ? ORDER BY id LIMIT 1').get(tid).id;
  const video = join(dataDir, 'match.mp4');
  writeFileSync(video, 'video bytes');
  writeFileSync(join(dataDir, 'match.txt'), 'The title\n\nThe description\n');
  db.prepare("UPDATE matches SET output_path = ?, youtube_url = 'https://youtu.be/OLD0000000a' WHERE id = ?").run(video, id);
  const yt = join(dataDir, 'youtube');
  mkdirSync(yt);
  writeFileSync(join(yt, 'client.json'), JSON.stringify({ installed: { client_id: 'c', client_secret: 's' } }));
  writeFileSync(join(yt, 'token.json'), JSON.stringify({ refreshToken: 'r', accessToken: 'tok', expiresAt: Date.now() + 3600_000 }));
  writeFileSync(join(yt, 'playlists.json'), JSON.stringify({ [tid]: 'PL1' }));
  return { app: { db, dataDir }, id };
}

/**
 * A pretend YouTube: records each call; `uploadFails` makes the upload itself fail (true, or Google's error reply),
 * after `uploadsOk` good ones. `playlist` (video ids) is the playlist's order, kept up to date. `ids` names the uploads
 * in turn; `manual` false refuses moves as for a playlist sorted by date.
 */
function fakeYouTube({ uploadFails = false, uploadsOk = 0, playlist = [], ids = ['NEW0000000b'], manual = true } = {}) {
  const calls = [];
  let sent = 0;
  const state = { manual };
  const fetch = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    const u = String(url);
    calls.push(`${method} ${u.replace('https://www.googleapis.com', '')}`);
    if (u.includes('uploadType=resumable')) return new Response(null, { status: 200, headers: { Location: 'https://upload.test/session' } });
    if (u === 'https://upload.test/session') {
      if (uploadFails && sent >= uploadsOk) return jsonRes(uploadFails === true ? { error: { code: 400, message: 'Bad video' } } : uploadFails, 400);
      return jsonRes({ id: ids[Math.min(sent++, ids.length - 1)], status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' } });
    }
    if (u.includes('/videos?part=status')) return jsonRes({ items: [{ status: { privacyStatus: 'unlisted', uploadStatus: 'processed' } }] });
    if (u.includes('/playlistItems?part=snippet&playlistId=')) return jsonRes({ items: [{ snippet: { position: 1 } }] });
    if (u.includes('/playlistItems?part=snippet&maxResults=')) return jsonRes({ items: playlist.map((videoId, i) => ({ id: `item-${videoId}`, snippet: { position: i, resourceId: { videoId } } })) });
    if (u.includes('/playlists?part=snippet&id=')) return jsonRes({ items: [{ id: 'PL1', snippet: { title: 'Example' } }] });
    if (method === 'POST' && u.includes('/playlistItems')) {
      const { position, resourceId } = JSON.parse(opts.body).snippet;
      calls.push(`  position ${position}`);
      playlist.splice(position ?? playlist.length, 0, resourceId.videoId);
      return jsonRes({ id: 'item' });
    }
    if (method === 'PUT' && u.includes('/playlistItems')) {
      if (!state.manual) return jsonRes({ error: { code: 400, message: 'Not manual', errors: [{ reason: 'manualSortRequired' }] } }, 400);
      const { id, snippet } = JSON.parse(opts.body);
      assert.equal(id, `item-${snippet.resourceId.videoId}`);
      playlist.splice(playlist.indexOf(snippet.resourceId.videoId), 1);
      playlist.splice(snippet.position, 0, snippet.resourceId.videoId);
      return jsonRes({ id });
    }
    if (method === 'DELETE') {
      const gone = new URL(u).searchParams.get('id');
      if (playlist.includes(gone)) playlist.splice(playlist.indexOf(gone), 1);
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${method} ${u}`);
  };
  return { calls, fetch, state, playlist };
}

async function finished(res) {
  const { id } = await res.json();
  for (;;) {
    const job = getJob(id);
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const post = (id, body) => ({ request: new Request(`http://127.0.0.1/api/matches/${id}/youtube`, { method: 'POST', body: JSON.stringify(body) }), params: { id: String(id) } });

test('Replace uploads first, puts the new video in the old one’s place in the playlist, then deletes the old one', async () => {
  const { app, id } = setUp();
  const status = await (await onRequestGet({ request: new Request(`http://127.0.0.1/api/youtube?match=${id}`), app })).json();
  assert.deepEqual(status.current, { url: 'https://youtu.be/OLD0000000a', videoId: 'OLD0000000a' });
  const yt = fakeYouTube();
  const job = await withFetch(yt.fetch, async () => finished(await upload({ ...post(id, { file: 'video', replace: true }), app })));
  assert.equal(job.status, 'done', job.error);
  const steps = yt.calls.filter((c) => !c.includes('playlists?part=snippet&id=')); // checking the playlist still exists
  assert.deepEqual(steps, [
    'GET /youtube/v3/playlistItems?part=snippet&playlistId=PL1&videoId=OLD0000000a',
    'POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status,recordingDetails',
    'PUT https://upload.test/session',
    'GET /youtube/v3/videos?part=status&id=NEW0000000b',
    'POST /youtube/v3/playlistItems?part=snippet',
    '  position 1',
    'DELETE /youtube/v3/videos?id=OLD0000000a',
    'GET /youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=PL1', // nothing out of place: nothing moves
  ]);
  assert.deepEqual(job.result.replaced, { url: 'https://youtu.be/OLD0000000a', deleted: true });
  assert.equal(app.db.prepare('SELECT youtube_url FROM matches WHERE id = ?').get(id).youtube_url, 'https://youtu.be/NEW0000000b');
});

test('Replace never deletes the old video when the upload fails', async () => {
  const { app, id } = setUp();
  const yt = fakeYouTube({ uploadFails: true });
  const job = await withFetch(yt.fetch, async () => finished(await upload({ ...post(id, { file: 'video', replace: true }), app })));
  assert.equal(job.status, 'failed');
  assert.ok(!yt.calls.some((c) => c.startsWith('DELETE')));
  assert.equal(app.db.prepare('SELECT youtube_url FROM matches WHERE id = ?').get(id).youtube_url, 'https://youtu.be/OLD0000000a');
});

test('a plain upload deletes nothing, and Replace needs a video to replace', async () => {
  const { app, id } = setUp();
  const yt = fakeYouTube();
  const job = await withFetch(yt.fetch, async () => finished(await upload({ ...post(id, { file: 'video' }), app })));
  assert.equal(job.status, 'done', job.error);
  assert.ok(!yt.calls.some((c) => c.startsWith('DELETE')));
  assert.equal(job.result.replaced, null);
  app.db.prepare('UPDATE matches SET youtube_url = NULL WHERE id = ?').run(id);
  const res = await upload({ ...post(id, { file: 'video', replace: true }), app });
  assert.equal(res.status, 409);
});

test('the original video can go to YouTube as it is, with the whole match’s title, before any render', async () => {
  const { app, id } = setUp();
  app.db.prepare('UPDATE matches SET output_path = NULL, youtube_url = NULL WHERE id = ?').run(id);
  const original = join(app.dataDir, 'phone.mp4');
  writeFileSync(original, 'phone video bytes');
  app.db.prepare("INSERT INTO videos (path, size, modified_at, recorded_at, duration, match_id) VALUES (?, 17, 'x', '2026-10-24T08:05:00Z', 600, ?)").run(original, id);
  // The YouTube box gets it beside the finished files (none yet).
  const listed = await (await renderedList({ params: { id: String(id) }, app })).json();
  assert.deepEqual([listed.files.length, listed.original.key, listed.original.path], [0, 'original', original]);
  assert.match(listed.original.title, /^Example · /);
  const yt = fakeYouTube();
  const job = await withFetch(yt.fetch, async () => finished(await upload({ ...post(id, { file: 'original', playlist: false }), app })));
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.file, 'original');
  assert.ok(yt.calls.some((c) => c.includes('upload.test/session'))); // the phone's file was sent
  assert.equal(app.db.prepare('SELECT youtube_url FROM matches WHERE id = ?').get(id).youtube_url, 'https://youtu.be/NEW0000000b');
});

test('Upload all: the rendered whole videos, or the originals of the ones not rendered; nothing already on YouTube', async () => {
  const { app, id } = setUp(); // id: rendered, on YouTube as OLD
  const tid = app.db.prepare('SELECT tournament_id FROM matches WHERE id = ?').get(id).tournament_id;
  const others = app.db.prepare('SELECT id FROM matches WHERE tournament_id = ? AND id <> ? AND game = 0 ORDER BY id LIMIT 2').all(tid, id).map((r) => r.id);
  const phone = (name, match) => {
    const path = join(app.dataDir, name);
    writeFileSync(path, 'phone video bytes');
    app.db.prepare("INSERT INTO videos (path, size, modified_at, recorded_at, duration, match_id) VALUES (?, 17, 'x', '2026-10-24T08:05:00Z', 600, ?)").run(path, match);
  };
  phone('a.mp4', id);
  // Another match: rendered, not on YouTube; a third: filmed only.
  phone('b.mp4', others[0]);
  const rendered = join(app.dataDir, 'b-render.mp4');
  writeFileSync(rendered, 'rendered bytes');
  app.db.prepare('UPDATE matches SET output_path = ? WHERE id = ?').run(rendered, others[0]);
  phone('c.mp4', others[1]);
  const all = (kind) => ({ request: new Request(`http://127.0.0.1/api/tournaments/${tid}/upload-all`, { method: 'POST', body: JSON.stringify({ kind, playlist: false }) }), params: { id: String(tid) }, app });
  const yt = fakeYouTube();
  await withFetch(yt.fetch, async () => {
    const r = await (await uploadAll(all('rendered'))).json();
    assert.deepEqual(r.jobs.map((j) => j.key), [`upload:${others[0]}:video`]); // the one on YouTube is left alone
    for (const j of r.jobs) await finished(new Response(JSON.stringify(j)));
    const o = await (await uploadAll(all('original'))).json();
    assert.deepEqual(o.jobs.map((j) => j.key), [`upload:${others[1]}:original`]); // not the rendered one again
    for (const j of o.jobs) await finished(new Response(JSON.stringify(j)));
  });
  assert.equal((await uploadAll({ ...all('original'), request: new Request('http://x', { method: 'POST', body: '{}' }) })).status, 400);
  rmSync(join(app.dataDir, 'youtube', 'token.json'));
  assert.equal((await uploadAll(all('rendered'))).status, 401); // signed out: nothing queued
});

test('an upload refused for the channel’s limit says when it can go again: a day after the oldest upload of the last day', async () => {
  const { app, id } = setUp();
  const earlier = new Date(Date.now() - 5 * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
  app.db.prepare('UPDATE matches SET uploaded_at = ? WHERE id = ?').run(earlier, id);
  const yt = fakeYouTube({ uploadFails: { error: { code: 400, message: 'The user has exceeded the number of videos they may upload.', errors: [{ reason: 'uploadLimitExceeded' }] } } });
  const job = await withFetch(yt.fetch, async () => finished(await upload({ ...post(id, { privacy: 'unlisted' }), app })));
  assert.equal(job.status, 'failed');
  assert.match(job.error, /upload limit/);
  assert.equal(job.retryAt, new Date(Date.parse(earlier) + 86400_000).toISOString());
});

/** The tournament's first `n` matches by time, each rendered with a phone video and none on YouTube. */
function renderedMatches(app, id, n) {
  const tid = app.db.prepare('SELECT tournament_id FROM matches WHERE id = ?').get(id).tournament_id;
  app.db.prepare('UPDATE matches SET youtube_url = NULL WHERE tournament_id = ?').run(tid);
  const ids = app.db.prepare('SELECT id FROM matches WHERE tournament_id = ? AND game = 0 ORDER BY match_date, match_time, id LIMIT ?').all(tid, n).map((r) => r.id);
  for (const m of ids) {
    const path = join(app.dataDir, `render-${m}.mp4`);
    writeFileSync(path, 'rendered bytes');
    app.db.prepare('UPDATE matches SET output_path = ? WHERE id = ?').run(path, m);
    app.db.prepare("INSERT INTO videos (path, size, modified_at, recorded_at, duration, match_id) VALUES (?, 14, 'x', '2026-10-24T08:05:00Z', 600, ?)").run(path, m);
  }
  return { tid, ids };
}

const uploadAllRendered = async (app, tid) => {
  const r = await (await uploadAll({ request: new Request(`http://127.0.0.1/api/tournaments/${tid}/upload-all`, { method: 'POST', body: JSON.stringify({ kind: 'rendered' }) }), params: { id: String(tid) }, app })).json();
  const jobs = [];
  for (const j of r.jobs) jobs.push(await finished(new Response(JSON.stringify(j))));
  return jobs;
};

test('the playlist goes into match order once, after the tournament’s last upload, leaving unknown videos in place', async () => {
  const { app, id } = setUp();
  const { tid, ids } = renderedMatches(app, id, 3);
  app.db.prepare("UPDATE matches SET youtube_url = 'https://youtu.be/LATE0000000' WHERE id = ?").run(ids[2]); // uploaded first, played last
  const yt = fakeYouTube({ playlist: ['LATE0000000', 'HAND0000000'], ids: ['FIRST000000', 'SECOND00000'] });
  const jobs = await withFetch(yt.fetch, () => uploadAllRendered(app, tid));
  assert.deepEqual(jobs.map((j) => j.status), ['done', 'done']);
  assert.deepEqual(yt.playlist, ['FIRST000000', 'HAND0000000', 'SECOND00000', 'LATE0000000']);
  assert.equal(jobs[0].result.sorted, undefined); // more were waiting
  assert.deepEqual(jobs[1].result.sorted, { moved: 3, videos: 4 });
  const lastUpload = yt.calls.findLastIndex((c) => c.includes('upload.test/session'));
  assert.ok(yt.calls.findIndex((c) => c.startsWith('PUT') && c.includes('playlistItems')) > lastUpload);
});

test('a last upload YouTube refuses still leaves the ones before it in match order', async () => {
  const { app, id } = setUp();
  const { tid, ids } = renderedMatches(app, id, 3);
  app.db.prepare("UPDATE matches SET youtube_url = 'https://youtu.be/LATE0000000' WHERE id = ?").run(ids[2]);
  const refused = { error: { code: 400, message: 'Too many', errors: [{ reason: 'uploadLimitExceeded' }] } };
  const yt = fakeYouTube({ playlist: ['LATE0000000'], ids: ['FIRST000000'], uploadFails: refused, uploadsOk: 1 });
  const jobs = await withFetch(yt.fetch, () => uploadAllRendered(app, tid));
  assert.deepEqual(jobs.map((j) => j.status), ['done', 'failed']);
  assert.deepEqual(yt.playlist, ['FIRST000000', 'LATE0000000']);
});

test('a playlist YouTube won’t reorder says why, keeps the upload, and is tried again after the next one', async () => {
  const { app, id } = setUp();
  const { ids } = renderedMatches(app, id, 3);
  app.db.prepare("UPDATE matches SET youtube_url = 'https://youtu.be/LATE0000000' WHERE id = ?").run(ids[2]);
  const yt = fakeYouTube({ playlist: ['LATE0000000'], ids: ['FIRST000000', 'SECOND00000'], manual: false });
  const first = await withFetch(yt.fetch, async () => finished(await upload({ ...post(ids[0], {}), app })));
  assert.equal(first.status, 'done', first.error);
  assert.match(first.result.sortError, /Manual/);
  assert.equal(app.db.prepare('SELECT youtube_url FROM matches WHERE id = ?').get(ids[0]).youtube_url, 'https://youtu.be/FIRST000000');
  yt.state.manual = true;
  const second = await withFetch(yt.fetch, async () => finished(await upload({ ...post(ids[1], {}), app })));
  assert.equal(second.result.sortError, undefined);
  assert.deepEqual(yt.playlist, ['FIRST000000', 'SECOND00000', 'LATE0000000']);
});

test('an upload kept out of the playlist doesn’t touch its order', async () => {
  const { app, id } = setUp();
  const { ids } = renderedMatches(app, id, 1);
  const yt = fakeYouTube({ playlist: ['HAND0000000'] });
  const job = await withFetch(yt.fetch, async () => finished(await upload({ ...post(ids[0], { playlist: false }), app })));
  assert.equal(job.status, 'done', job.error);
  assert.ok(!yt.calls.some((c) => c.includes('maxResults')));
});

test('match order is by start time, with a match’s games together and in order', () => {
  const { app, id } = setUp();
  const { tid, ids } = renderedMatches(app, id, 2);
  const [earlier, later] = ids;
  const games = [2, 1].map((g) => gameRow(app.db, earlier, g));
  const links = [[later, 'LATE0000000'], [games[0], 'GAME2000000'], [games[1], 'GAME1000000']];
  for (const [m, video] of links) app.db.prepare('UPDATE matches SET youtube_url = ? WHERE id = ?').run(`https://youtu.be/${video}`, m);
  assert.deepEqual(videosInMatchOrder(app.db, tid), ['GAME1000000', 'GAME2000000', 'LATE0000000']);
});
