import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  accessToken, addToTournamentPlaylist, apiError, authUrl, cutBytes, knownPlaylist, nextOffset, parseDescribed, pkce, playlistInfo, playlistTitle, readClient, tournamentPlaylistTitle,
  uploadVideo, videoResource,
} from '../lib/youtube.js';

const scratch = () => mkdtempSync(join(tmpdir(), 'yt-test-'));
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('PKCE challenge is the base64url SHA-256 of the verifier', () => {
  const { verifier, challenge } = pkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
});

test('the sign-in link asks for offline access with PKCE and comes back to this server', () => {
  const u = new URL(authUrl({ clientId: 'abc.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:8791/api/youtube/callback', state: 's1', challenge: 'c1' }));
  assert.equal(u.origin, 'https://accounts.google.com');
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.redirect_uri, 'http://127.0.0.1:8791/api/youtube/callback');
  assert.equal(q.code_challenge_method, 'S256');
  assert.equal(q.access_type, 'offline');
  assert.equal(q.prompt, 'consent');
  assert.equal(q.scope, 'https://www.googleapis.com/auth/youtube');
});

test('reads a desktop OAuth client file, and nothing from a missing one', async () => {
  const dir = scratch();
  assert.equal(await readClient(dir), null);
  writeFileSync(join(dir, 'client.json'), JSON.stringify({ installed: { client_id: 'id1', client_secret: 'made-up' } }));
  assert.deepEqual(await readClient(dir), { clientId: 'id1', clientSecret: 'made-up', desktop: true });
});

test('video resource: angle brackets out, title and description cut to YouTube’s limits, Sports, recording date', () => {
  const r = videoResource({ title: `<Lee> v Ho ${'x'.repeat(200)}`, description: `a <b> ${'é'.repeat(4000)}`, privacy: 'nonsense', recordedOn: '2026-09-27' });
  assert.equal(r.snippet.title.length, 100);
  assert.ok(!/[<>]/.test(r.snippet.title + r.snippet.description));
  assert.ok(Buffer.byteLength(r.snippet.description) <= 5000);
  assert.ok(!r.snippet.description.includes('�'));
  assert.equal(r.snippet.categoryId, '17');
  assert.equal(r.status.privacyStatus, 'unlisted');
  assert.equal(r.recordingDetails.recordingDate, '2026-09-27T00:00:00Z');
  assert.equal(videoResource({ title: 'T', privacy: 'public' }).status.privacyStatus, 'public');
  assert.equal(videoResource({ title: 'T' }).recordingDetails, undefined);
});

test('cutBytes never splits a character', () => {
  assert.equal(cutBytes('aé', 2), 'a');
  assert.equal(cutBytes('abc', 5), 'abc');
});

test('the render’s .txt splits into title and description', () => {
  assert.deepEqual(parseDescribed('Lee v Ho | XD U15\r\n\r\nLine 1\r\nLine 2\r\n'), { title: 'Lee v Ho | XD U15', description: 'Line 1\nLine 2' });
});

test('resume offsets from YouTube’s Range header', () => {
  assert.equal(nextOffset('bytes=0-262143'), 262144);
  assert.equal(nextOffset(null), 0);
});

test('API errors become sentences people can act on', async () => {
  const quota = await apiError(jsonRes({ error: { code: 403, message: 'x', errors: [{ reason: 'quotaExceeded' }] } }, 403), 'Uploading');
  assert.match(quota.message, /daily limit/);
  const auth = await apiError(jsonRes({ error: { code: 401 } }, 401), 'Uploading');
  assert.equal(auth.code, 'signin');
  const other = await apiError(jsonRes({ error: { code: 400, message: 'Bad title', errors: [{ reason: 'invalidTitle' }] } }, 400), 'Uploading');
  assert.equal(other.message, 'Uploading failed (400 invalidTitle): Bad title');
});

test('access token: reused while fresh, refreshed near expiry, sign-in dropped when Google ends it', async () => {
  const dir = scratch();
  writeFileSync(join(dir, 'client.json'), JSON.stringify({ installed: { client_id: 'id1', client_secret: 'made-up' } }));
  await assert.rejects(accessToken(dir, null), (e) => e.code === 'signin');
  writeFileSync(join(dir, 'token.json'), JSON.stringify({ refreshToken: 'r1', accessToken: 'a1', expiresAt: 10_000_000 }));
  assert.equal(await accessToken(dir, null, 1_000), 'a1');
  let asked = null;
  const refresh = async (url, opts) => { asked = Object.fromEntries(opts.body); return jsonRes({ access_token: 'a2', expires_in: 3600 }); };
  assert.equal(await accessToken(dir, refresh, 9_990_000), 'a2');
  assert.equal(asked.grant_type, 'refresh_token');
  assert.equal(asked.refresh_token, 'r1');
  assert.equal(JSON.parse(readFileSync(join(dir, 'token.json'), 'utf8')).refreshToken, 'r1');
  const ended = async () => jsonRes({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
  await assert.rejects(accessToken(dir, ended, 99_000_000), (e) => e.code === 'signin' && /7 days/.test(e.message));
  await assert.rejects(accessToken(dir, ended), (e) => e.code === 'signin' && /first/.test(e.message));
});

/** A stand-in for YouTube's resumable upload endpoint; drops the connection on the second piece once. */
function fakeYouTube() {
  const got = [];
  let dropped = false;
  let received = Buffer.alloc(0);
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const range = req.headers['content-range'];
      got.push({ method: req.method, url: req.url, range, auth: req.headers.authorization });
      if (req.method === 'POST') {
        res.writeHead(200, { Location: `http://127.0.0.1:${server.address().port}/session/1` }).end();
        return;
      }
      const total = Number(range.split('/')[1]);
      if (range.startsWith('bytes */')) {
        res.writeHead(308, received.length ? { Range: `bytes=0-${received.length - 1}` } : {}).end();
        return;
      }
      const [from] = range.slice(6).split('-').map(Number);
      if (from > 0 && !dropped) {
        dropped = true;
        req.socket.destroy(); // the connection drops mid-upload
        return;
      }
      received = Buffer.concat([received.subarray(0, from), body]);
      if (received.length === total) res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'vid123', status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' } }));
      else res.writeHead(308, { Range: `bytes=0-${received.length - 1}` }).end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, got, received: () => received, base: `http://127.0.0.1:${server.address().port}` })));
}

test('resumable upload sends pieces, rides out a dropped connection and returns the video', async () => {
  const dir = scratch();
  const file = join(dir, 'match.mp4');
  const data = Buffer.from(Array.from({ length: 700_000 }, (_, i) => i % 251));
  writeFileSync(file, data);
  const yt = await fakeYouTube();
  try {
    const progress = [];
    const waits = [];
    const video = await uploadVideo({
      path: file, resource: videoResource({ title: 'Lee v Ho' }), token: async () => 'tok', base: yt.base, chunk: 262144,
      onProgress: (sent, size) => progress.push([sent, size]), wait: async (ms) => { waits.push(ms); },
    });
    assert.equal(video.id, 'vid123');
    assert.ok(yt.received().equals(data));
    assert.equal(yt.got[0].method, 'POST');
    assert.match(yt.got[0].url, /uploadType=resumable&part=snippet,status/);
    assert.ok(yt.got.every((g) => g.auth === 'Bearer tok'));
    assert.ok(yt.got.some((g) => g.range === 'bytes */700000'), 'asked how much arrived after the drop');
    assert.deepEqual(waits, [2000]);
    assert.deepEqual(progress.at(-1), [700000, 700000]);
  } finally {
    yt.server.close();
  }
});

test('playlist: made once per tournament, remembered, and made again when deleted on YouTube', async () => {
  const dir = scratch();
  const calls = [];
  let playlists = 0;
  const existing = new Set();
  const fake = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(url.replace(/\?.*/, ''));
    if (url.includes('/playlists?')) {
      const id = `PL${++playlists}`;
      existing.add(id);
      assert.equal(body.status.privacyStatus, 'unlisted');
      return jsonRes({ id });
    }
    return existing.has(body.snippet.playlistId) ? jsonRes({ id: 'item' }) : jsonRes({ error: { code: 404, errors: [{ reason: 'playlistNotFound' }] } }, 404);
  };
  const where = { tournamentId: 7, title: 'Sankey <U15>', privacy: 'unlisted' };
  assert.equal(await addToTournamentPlaylist(dir, where, 'v1', 'tok', fake), 'PL1');
  assert.equal(await addToTournamentPlaylist(dir, where, 'v2', 'tok', fake), 'PL1');
  existing.delete('PL1');
  assert.equal(await addToTournamentPlaylist(dir, where, 'v3', 'tok', fake), 'PL2');
  assert.equal(calls.filter((c) => c.endsWith('/playlists')).length, 2);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'playlists.json'), 'utf8')), { 7: 'PL2' });
});

test('playlist name shown before upload: the tournament name, as the playlist will be made', async () => {
  assert.equal(playlistTitle('  Sankey Academy <U15> Silver  '), 'Sankey Academy U15 Silver');
  assert.equal(playlistTitle(''), 'Badminton');
  const dir = scratch();
  assert.equal(await knownPlaylist(dir, 7), null);
  writeFileSync(join(dir, 'playlists.json'), JSON.stringify({ 7: 'PL9' }));
  assert.equal(await knownPlaylist(dir, 7), 'PL9');
  const renamed = async (url) => {
    assert.match(url, /\/playlists\?part=snippet&id=PL9$/);
    return jsonRes({ items: [{ id: 'PL9', snippet: { title: 'Sankey (renamed)' } }] });
  };
  assert.deepEqual(await playlistInfo('PL9', 'tok', renamed), { id: 'PL9', title: 'Sankey (renamed)' });
  assert.equal(await playlistInfo('PL9', 'tok', async () => jsonRes({ items: [] })), null); // deleted on YouTube
});

test('a tournament’s playlist starts with the year, unless its name has it already', () => {
  assert.equal(tournamentPlaylistTitle({ name: 'Sankey Academy U15 Silver Sept', start: '2026-09-27' }), '2026 Sankey Academy U15 Silver Sept');
  assert.equal(tournamentPlaylistTitle({ name: '2026 Junior Gold', start: '2026-10-04' }), '2026 Junior Gold');
  assert.equal(tournamentPlaylistTitle({ name: 'Autumn Open 2026', start: '2026-10-04' }), 'Autumn Open 2026');
  assert.equal(tournamentPlaylistTitle({ name: 'No Date Open' }), 'No Date Open');
});
