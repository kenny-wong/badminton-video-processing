// YouTube sign-in and upload.
//
// GET  /api/youtube?match=<id>: { ready, signedIn, channel, jobs: { video, highlights }, playlist: { title, exists, url } }
//      (ready = the OAuth client file is there; playlist = where an upload of this match would go).
// POST /api/youtube/signin: { url } of Google's sign-in page; Google then sends the browser to
// GET  /api/youtube/callback, which saves the sign-in and shows a page saying so.
// POST /api/youtube/signout: forgets the sign-in.
// POST /api/matches/:id/youtube { highlights?, privacy?, playlist? }: uploads the rendered video (a job; one upload at a time).

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, idParam, json, readJson } from '../lib/http.js';
import { findJob, jobView, startJob } from '../lib/jobs.js';
import { loadMatch } from '../lib/pipeline.js';
import { nowIso } from '../lib/db.js';
import { youtubeUrl } from '../lib/links.js';
import { matchLabel } from './matches.js';
import {
  accessToken, addToTournamentPlaylist, authUrl, exchangeCode, knownPlaylist, parseDescribed, pkce, playlistInfo, playlistTitle, PRIVACY, readClient, readToken,
  signOut as forget, uploadVideo, videoResource, videoStatus, youtubeDir,
} from '../lib/youtube.js';

const SIGNIN_MAX_AGE = 10 * 60_000;
const pending = new Map(); // state -> { verifier, redirectUri, at }

const dirOf = (app) => youtubeDir(app.dataDir ?? join(tmpdir(), 'badminton-video'));
const redirectOf = (app) => `http://127.0.0.1:${app.port || Number(process.env.PORT) || 8791}/api/youtube/callback`;
const jobKey = (id, highlights) => `upload:${id}:${highlights ? 'highlights' : 'video'}`;

export async function onRequestGet({ request, app }) {
  const dir = dirOf(app);
  const token = await readToken(dir);
  const id = idParam(new URL(request.url).searchParams.get('match'));
  return json({
    ready: Boolean(await readClient(dir)),
    signedIn: Boolean(token?.refreshToken),
    channel: token?.channel ?? null,
    jobs: id ? { video: jobView(findJob(jobKey(id, false))), highlights: jobView(findJob(jobKey(id, true))) } : null,
    playlist: id && token?.refreshToken ? await playlistFor(dir, loadMatch(app.db, id)?.tournament) : null,
  });
}

const PLAYLIST_CACHE_MS = 2 * 60_000;
const playlistCache = new Map(); // playlist id -> { info, at }
const playlistUrl = (id) => `https://www.youtube.com/playlist?list=${id}`;

/**
 * The playlist an upload from this tournament goes into: { title, exists, url }.
 * An existing one's title is read from YouTube (it may have been renamed there);
 * one deleted on YouTube counts as new, as the next upload makes it again.
 */
async function playlistFor(dir, tournament) {
  if (!tournament) return null;
  const fresh = { title: playlistTitle(tournament.name), exists: false, url: null };
  const known = await knownPlaylist(dir, tournament.id);
  if (!known) return fresh;
  let cached = playlistCache.get(known);
  if (!cached || Date.now() - cached.at > PLAYLIST_CACHE_MS) {
    try {
      cached = { info: await playlistInfo(known, await accessToken(dir)), at: Date.now() };
      playlistCache.set(known, cached);
    } catch {
      return { ...fresh, exists: true, url: playlistUrl(known) }; // couldn't ask YouTube: assume it's still there
    }
  }
  return cached.info ? { title: cached.info.title, exists: true, url: playlistUrl(known) } : fresh;
}

export async function signIn({ app }) {
  const client = await readClient(dirOf(app));
  if (!client) return fail(409, 'noClient', 'Put the Google Cloud “Desktop app” OAuth client file at data/youtube/client.json first');
  const state = randomBytes(16).toString('base64url');
  const { verifier, challenge } = pkce();
  const redirectUri = redirectOf(app);
  for (const [k, v] of pending) if (Date.now() - v.at > SIGNIN_MAX_AGE) pending.delete(k);
  pending.set(state, { verifier, redirectUri, at: Date.now() });
  return json({ url: authUrl({ clientId: client.clientId, redirectUri, state, challenge }) });
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The small page the browser lands on after Google's sign-in. */
function page(heading, text, ok) {
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>YouTube sign-in</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 16px}h1{font-size:1.4rem;color:${ok ? '#1b7f3b' : '#b3261e'}}</style></head>
<body><h1>${escape(heading)}</h1><p>${escape(text)}</p></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' },
  });
}

export async function callback({ request, app }) {
  const q = new URL(request.url).searchParams;
  const wait = pending.get(q.get('state') ?? '');
  if (!wait || Date.now() - wait.at > SIGNIN_MAX_AGE) return page('Sign-in link expired', 'Start again with Sign in to YouTube in Badminton Video.', false);
  pending.delete(q.get('state'));
  if (q.get('error')) return page('Not signed in', q.get('error') === 'access_denied' ? 'The sign-in was cancelled. You can close this tab.' : `Google said: ${q.get('error')}. You can close this tab.`, false);
  try {
    const channel = await exchangeCode(dirOf(app), { code: q.get('code') ?? '', verifier: wait.verifier, redirectUri: wait.redirectUri });
    console.log(`YouTube: signed in${channel ? ` as ${channel.title}` : ''}`);
    return page('Signed in to YouTube', `${channel ? `Channel: ${channel.title}. ` : ''}You can close this tab and go back to Badminton Video.`, true);
  } catch (err) {
    console.error('YouTube sign-in', err);
    return page('Not signed in', err.message, false);
  }
}

export async function signOutRoute({ app }) {
  await forget(dirOf(app));
  console.log('YouTube: signed out');
  return json({ ok: true });
}

const mb = (n) => (n / 1048576).toFixed(n < 1048576 * 10 ? 1 : 0);

export async function upload({ request, params, app }) {
  const loaded = loadMatch(app.db, idParam(params.id));
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const body = (await readJson(request)) ?? {};
  const highlights = body.highlights === true;
  const privacy = PRIVACY.includes(body.privacy) ? body.privacy : 'unlisted';
  const path = highlights ? loaded.match.highlightsPath : loaded.match.outputPath;
  if (!path || !existsSync(path)) return fail(404, 'notFound', 'Render the video first');
  const dir = dirOf(app);
  if (!(await readClient(dir))) return fail(409, 'noClient', 'YouTube upload isn’t set up: the OAuth client file is missing');
  if (!(await readToken(dir))?.refreshToken) return fail(401, 'signin', 'Sign in to YouTube first');
  const { match, tournament } = loaded;
  const job = startJob('upload', jobKey(match.id, highlights), async (j, signal) => {
    const txt = path.replace(/\.mp4$/i, '.txt');
    const described = existsSync(txt) ? parseDescribed(await readFile(txt, 'utf8')) : { title: '', description: '' };
    const resource = videoResource({ ...described, privacy, recordedOn: match.date });
    j.log(`Uploading ${path} as ${privacy}: ${resource.snippet.title}`);
    j.message = 'Starting the upload';
    const token = () => accessToken(dir);
    const video = await uploadVideo({
      path, resource, token, signal,
      onProgress: (sent, size) => {
        j.progress = size ? sent / size : 0;
        j.message = `${mb(sent)} of ${mb(size)} MB sent`;
      },
    });
    const url = youtubeUrl(video.id);
    j.log(`Uploaded: ${url} (YouTube replied ${video.status?.privacyStatus ?? '?'})`);
    if (!highlights) app.db.prepare('UPDATE matches SET youtube_url = ?, uploaded_at = ?, updated_at = ? WHERE id = ?').run(url, nowIso(), nowIso(), match.id);
    const result = { videoId: video.id, url, highlights, privacy, privacyNow: video.status?.privacyStatus ?? null, uploadStatus: video.status?.uploadStatus ?? null, playlist: null, playlistError: null };
    // Asked again after the upload: an unaudited Google project's videos may be locked to private.
    const now = await videoStatus(video.id, await token()).catch((err) => { j.log(`Couldn’t read the status: ${err.message}`); return null; });
    if (now) Object.assign(result, { privacyNow: now.privacyStatus ?? result.privacyNow, uploadStatus: now.uploadStatus ?? result.uploadStatus });
    result.locked = privacy !== 'private' && result.privacyNow === 'private';
    j.log(`Status: ${result.privacyNow}, ${result.uploadStatus}${result.locked ? ' (locked to private)' : ''}`);
    if (body.playlist !== false && tournament) {
      try {
        const id = await addToTournamentPlaylist(dir, { tournamentId: tournament.id, title: tournament.name, privacy }, video.id, await token());
        result.playlist = { id, url: playlistUrl(id) };
        playlistCache.delete(id);
      } catch (err) {
        result.playlistError = err.message;
        j.log(`Playlist: ${err.message}`);
      }
    }
    return result;
  }, { queue: 'upload', label: `YouTube${highlights ? ' highlights' : ''}: ${matchLabel(match)}` });
  return json(jobView(job), 202);
}
