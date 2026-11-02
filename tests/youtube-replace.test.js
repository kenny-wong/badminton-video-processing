import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../lib/db.js';
import { saveTournament } from '../lib/tournaments.js';
import { parseMatches } from '../lib/schedule.js';
import { getJob } from '../lib/jobs.js';
import { onRequestGet, renderedList, upload, uploadAll } from '../api/youtube.js';
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

/** A pretend YouTube: records each call; `uploadFails` makes the upload itself fail. */
function fakeYouTube({ uploadFails = false } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    const u = String(url);
    calls.push(`${method} ${u.replace('https://www.googleapis.com', '')}`);
    if (u.includes('uploadType=resumable')) return new Response(null, { status: 200, headers: { Location: 'https://upload.test/session' } });
    if (u === 'https://upload.test/session') return uploadFails ? jsonRes({ error: { code: 400, message: 'Bad video' } }, 400) : jsonRes({ id: 'NEW0000000b', status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' } });
    if (u.includes('/videos?part=status')) return jsonRes({ items: [{ status: { privacyStatus: 'unlisted', uploadStatus: 'processed' } }] });
    if (u.includes('/playlistItems?part=snippet&playlistId=')) return jsonRes({ items: [{ snippet: { position: 1 } }] });
    if (u.includes('/playlists?part=snippet&id=')) return jsonRes({ items: [{ id: 'PL1', snippet: { title: 'Example' } }] });
    if (method === 'POST' && u.includes('/playlistItems')) {
      calls.push(`  position ${JSON.parse(opts.body).snippet.position}`);
      return jsonRes({ id: 'item' });
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`unexpected ${method} ${u}`);
  };
  return { calls, fetch };
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
