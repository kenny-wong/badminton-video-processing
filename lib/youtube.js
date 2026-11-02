// Uploads to YouTube through the YouTube Data API v3, signed in with Google's
// desktop-app OAuth flow (PKCE, with Google sending the browser back to this
// server on 127.0.0.1).
//
// Files in data/youtube/ (gitignored; nothing here is ever sent to the page):
//   client.json     the "Desktop app" OAuth client downloaded from Google Cloud
//   token.json      refresh token, current access token and the channel's name
//   playlists.json  tournament id -> playlist id, so each tournament has one playlist
//
// Uploads are resumable: the file goes up in 16 MB pieces, and after a dropped
// connection or a YouTube hiccup the upload asks how much arrived and carries on.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DESCRIPTION_MAX, TITLE_MAX } from './naming.js';

export const SCOPE = 'https://www.googleapis.com/auth/youtube'; // upload, playlists, the channel's name
const AUTH_URI = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const REVOKE_URI = 'https://oauth2.googleapis.com/revoke';
export const API = 'https://www.googleapis.com/youtube/v3';
export const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
export const CHUNK = 16 * 1024 * 1024; // resumable pieces must be multiples of 256 KiB
export const PRIVACY = ['unlisted', 'private', 'public'];
const SPORTS = '17'; // YouTube's category id
const RETRY = new Set([500, 502, 503, 504]);
const TRIES = 8;

export class YouTubeError extends Error {
  constructor(message, { code = 'youtube', status = 0, reason = '', detail = null } = {}) {
    super(message);
    Object.assign(this, { code, status, reason, detail });
  }
}
const signinError = (message) => new YouTubeError(message, { code: 'signin' });

export const youtubeDir = (dataDir) => join(dataDir, 'youtube');

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonFile(path, value) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

/** The OAuth client in client.json ("installed" for a desktop app), or null. */
export async function readClient(dir) {
  const j = await readJsonFile(join(dir, 'client.json'));
  const c = j?.installed ?? j?.web;
  return c?.client_id && c?.client_secret ? { clientId: c.client_id, clientSecret: c.client_secret, desktop: Boolean(j.installed) } : null;
}

export const readToken = (dir) => readJsonFile(join(dir, 'token.json'));
const saveToken = (dir, token) => writeJsonFile(join(dir, 'token.json'), token);

/** A PKCE verifier and its S256 challenge. */
export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Google's sign-in page; prompt=consent so a refresh token always comes back. */
export function authUrl({ clientId, redirectUri, state, challenge }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, state,
    code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
  });
  return `${AUTH_URI}?${q}`;
}

async function tokenRequest(fields, fetchImpl) {
  const res = await fetchImpl(TOKEN_URI, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new YouTubeError(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`, { status: res.status, reason: body.error ?? '' });
  return body;
}

/** Swaps the code from Google's redirect for tokens, saves them with the channel's name, and returns that. */
export async function exchangeCode(dir, { code, verifier, redirectUri }, fetchImpl = fetch) {
  const client = await readClient(dir);
  if (!client) throw new YouTubeError('No OAuth client file (data/youtube/client.json)');
  const t = await tokenRequest({
    code, code_verifier: verifier, redirect_uri: redirectUri, client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'authorization_code',
  }, fetchImpl);
  if (!t.refresh_token) throw new YouTubeError('Google sent no refresh token: sign in again');
  const token = { refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000, scope: t.scope, signedInAt: new Date().toISOString() };
  token.channel = await channelOf(token.accessToken, fetchImpl).catch(() => null);
  await saveToken(dir, token);
  return token.channel;
}

/** A current access token, refreshed when it has under a minute left. */
export async function accessToken(dir, fetchImpl = fetch, now = Date.now()) {
  const token = await readToken(dir);
  if (!token?.refreshToken) throw signinError('Sign in to YouTube first');
  if (token.accessToken && token.expiresAt - 60_000 > now) return token.accessToken;
  const client = await readClient(dir);
  if (!client) throw new YouTubeError('No OAuth client file (data/youtube/client.json)');
  let t;
  try {
    t = await tokenRequest({ refresh_token: token.refreshToken, client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'refresh_token' }, fetchImpl);
  } catch (err) {
    if (err.reason !== 'invalid_grant') throw err;
    await rm(join(dir, 'token.json'), { force: true });
    // Google ends refresh tokens after 7 days while the consent screen is in Testing.
    throw signinError('Google ended the YouTube sign-in (it does after 7 days while the Google project is in Testing): sign in again');
  }
  await saveToken(dir, { ...token, accessToken: t.access_token, expiresAt: now + t.expires_in * 1000, ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}) });
  return t.access_token;
}

/** Forgets the sign-in, and asks Google to revoke it. */
export async function signOut(dir, fetchImpl = fetch) {
  const token = await readToken(dir);
  await rm(join(dir, 'token.json'), { force: true });
  if (token?.refreshToken) {
    await fetchImpl(REVOKE_URI, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: token.refreshToken }) }).catch(() => {});
  }
}

/** A Google API error response as a sentence, with the raw body as detail. */
export async function apiError(res, what) {
  const text = await res.text().catch(() => '');
  let reason = '';
  let message = '';
  try {
    const e = JSON.parse(text).error;
    reason = e?.errors?.[0]?.reason ?? e?.status ?? '';
    message = e?.message ?? '';
  } catch { /* not JSON */ }
  const opts = { status: res.status, reason, detail: text.slice(0, 2000) || null };
  if (res.status === 401) return new YouTubeError('YouTube didn’t accept the sign-in: sign in again', { ...opts, code: 'signin' });
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded' || reason === 'rateLimitExceeded') return new YouTubeError('YouTube’s daily limit for this Google project is used up: try again tomorrow', opts);
  if (reason === 'youtubeSignupRequired') return new YouTubeError('This Google account has no YouTube channel yet: create one on youtube.com first', opts);
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') return new YouTubeError('The YouTube Data API isn’t turned on in the Google Cloud project', opts);
  return new YouTubeError(`${what} failed (${res.status}${reason ? ` ${reason}` : ''})${message ? `: ${message}` : ''}`, opts);
}

async function call(method, url, accessTokenValue, body, fetchImpl, what) {
  const res = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${accessTokenValue}`, ...(body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await apiError(res, what);
  return res.json();
}

/** The signed-in account's channel: { id, title }. */
export async function channelOf(accessTokenValue, fetchImpl = fetch) {
  const r = await call('GET', `${API}/channels?part=snippet&mine=true`, accessTokenValue, null, fetchImpl, 'Reading the channel');
  const c = r.items?.[0];
  return c ? { id: c.id, title: c.snippet?.title ?? '' } : null;
}

const noAngles = (s) => String(s ?? '').replace(/[<>]/g, ''); // YouTube rejects < and > in titles and descriptions

/** Cuts text to at most `max` UTF-8 bytes without splitting a character. */
export function cutBytes(text, max) {
  const buf = Buffer.from(text);
  return buf.length <= max ? text : buf.subarray(0, max).toString().replace(/�+$/, '');
}

/** The video resource for videos.insert: title, description, Sports category, privacy, recording date. */
export function videoResource({ title, description = '', privacy = 'unlisted', recordedOn = null }) {
  const resource = {
    snippet: { title: noAngles(title).trim().slice(0, TITLE_MAX) || 'Badminton match', description: cutBytes(noAngles(description).trim(), DESCRIPTION_MAX), categoryId: SPORTS },
    status: { privacyStatus: PRIVACY.includes(privacy) ? privacy : 'unlisted' },
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(recordedOn ?? '')) resource.recordingDetails = { recordingDate: `${recordedOn}T00:00:00Z` };
  return resource;
}

/** The render's .txt next to the video: the title, a blank line, then the description. */
export function parseDescribed(text) {
  const [title = '', ...rest] = String(text).replace(/\r\n/g, '\n').split('\n');
  return { title: title.trim(), description: rest.join('\n').trim() };
}

/** "bytes=0-1048575" from a 308 reply -> the next byte to send (0 when YouTube has nothing yet). */
export const nextOffset = (range) => {
  const m = /bytes=\d+-(\d+)/.exec(range ?? '');
  return m ? Number(m[1]) + 1 : 0;
};

const stopped = () => Object.assign(new Error('Stopped'), { code: 'stopped' });

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(stopped());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(stopped()); }, { once: true });
  });
}

/**
 * Uploads a video file with YouTube's resumable protocol and returns the new
 * video resource. `token()` gives a current access token (it's asked for
 * each piece, so a long upload outlives the hour an access token lasts).
 * Network errors and 5xx replies are retried with growing waits, resuming
 * from what YouTube says it has.
 */
export async function uploadVideo({ path, resource, token, signal, onProgress = () => {}, fetchImpl = fetch, base = UPLOAD_API, chunk = CHUNK, wait = sleep }) {
  const size = (await stat(path)).size;
  const start = await fetchImpl(`${base}/videos?uploadType=resumable&part=${Object.keys(resource).join(',')}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
    body: JSON.stringify(resource),
    signal,
  });
  if (!start.ok) throw await apiError(start, 'Starting the upload');
  const session = start.headers.get('location');
  if (!session) throw new YouTubeError('YouTube gave no upload address');
  const file = await open(path, 'r');
  try {
    let offset = 0;
    let failures = 0;
    let ask = false; // after a failure: ask YouTube how much arrived before sending more
    let lastError = '';
    for (;;) {
      let res = null;
      try {
        const auth = { Authorization: `Bearer ${await token()}` };
        if (ask) {
          res = await fetchImpl(session, { method: 'PUT', headers: { ...auth, 'Content-Range': `bytes */${size}` }, body: Buffer.alloc(0), signal, redirect: 'manual' });
        } else {
          const length = Math.min(chunk, size - offset);
          const buf = Buffer.alloc(length);
          await file.read(buf, 0, length, offset);
          res = await fetchImpl(session, { method: 'PUT', headers: { ...auth, 'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}` }, body: buf, signal, redirect: 'manual' });
        }
      } catch (err) {
        if (signal?.aborted) throw stopped();
        if (err.code === 'signin') throw err;
        lastError = err.message;
      }
      if (res && (res.status === 200 || res.status === 201)) {
        onProgress(size, size);
        return res.json();
      }
      if (res?.status === 308) {
        offset = nextOffset(res.headers.get('range'));
        ask = false;
        failures = 0;
        onProgress(offset, size);
        continue;
      }
      if (res && !RETRY.has(res.status)) throw await apiError(res, 'Uploading');
      if (res) lastError = `YouTube answered ${res.status}`;
      if (++failures > TRIES) throw new YouTubeError(`The upload kept failing (${lastError}): try again later`, { detail: lastError });
      await wait(Math.min(2 ** failures, 60) * 1000, signal);
      ask = true;
    }
  } finally {
    await file.close();
  }
}

/** What YouTube now says about a video: { privacyStatus, uploadStatus, ... }. */
export async function videoStatus(videoId, accessTokenValue, fetchImpl = fetch) {
  const r = await call('GET', `${API}/videos?part=status&id=${encodeURIComponent(videoId)}`, accessTokenValue, null, fetchImpl, 'Reading the video’s status');
  return r.items?.[0]?.status ?? null;
}

/**
 * Deletes one of the channel's videos: true when deleted, false when YouTube
 * no longer has it (deleted already). It also leaves every playlist it was in.
 */
export async function deleteVideo(videoId, accessTokenValue, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/videos?id=${encodeURIComponent(videoId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessTokenValue}` } });
  if (res.status === 404) return false;
  if (res.status === 403) {
    const err = await apiError(res, 'Deleting the old video');
    if (err.code === 'signin' || /quota|limit/i.test(err.message)) throw err;
    throw new YouTubeError('The old video couldn’t be deleted: it belongs to another channel, or YouTube refused. Delete it in YouTube Studio', { status: 403, reason: err.reason, detail: err.detail });
  }
  if (!res.ok) throw await apiError(res, 'Deleting the old video');
  return true;
}

/** Where a video sits in a playlist (0 = first), or null when it isn't in it. */
export async function playlistPosition(playlistId, videoId, accessTokenValue, fetchImpl = fetch) {
  const r = await call('GET', `${API}/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&videoId=${encodeURIComponent(videoId)}`,
    accessTokenValue, null, fetchImpl, 'Reading the playlist');
  const position = r.items?.[0]?.snippet?.position;
  return Number.isInteger(position) ? position : null;
}

/** A playlist name as YouTube will take it. */
export const playlistTitle = (name) => noAngles(name).trim().slice(0, 150) || 'Badminton';

/** The name a tournament's playlist gets: "2026 Sankey Academy U15 Silver Sept" (no second year when the name has it). */
export function tournamentPlaylistTitle({ name, start } = {}) {
  const year = /^\d{4}/.exec(start ?? '')?.[0];
  const plain = String(name ?? '').trim();
  return playlistTitle(year && !new RegExp(`\\b${year}\\b`).test(plain) ? `${year} ${plain}` : plain);
}

async function createPlaylist(title, privacy, accessTokenValue, fetchImpl) {
  const r = await call('POST', `${API}/playlists?part=snippet,status`, accessTokenValue,
    { snippet: { title: playlistTitle(title) }, status: { privacyStatus: privacy } }, fetchImpl, 'Making the playlist');
  return r.id;
}

/** The playlist id remembered for a tournament, or null. */
export async function knownPlaylist(dir, tournamentId) {
  return ((await readJsonFile(join(dir, 'playlists.json'))) ?? {})[tournamentId] ?? null;
}

export const playlistUrl = (id) => `https://www.youtube.com/playlist?list=${id}`;

/** Every remembered tournament playlist's link, by tournament id (as text); {} when there are none. */
export async function tournamentPlaylistUrls(dir) {
  const map = (await readJsonFile(join(dir, 'playlists.json'))) ?? {};
  return Object.fromEntries(Object.entries(map).filter(([, id]) => typeof id === 'string' && id).map(([t, id]) => [t, playlistUrl(id)]));
}

/** A playlist's current title on YouTube, or null when it's gone (deleted there). */
export async function playlistInfo(playlistId, accessTokenValue, fetchImpl = fetch) {
  const r = await call('GET', `${API}/playlists?part=snippet&id=${encodeURIComponent(playlistId)}`, accessTokenValue, null, fetchImpl, 'Reading the playlist');
  const p = r.items?.[0];
  return p ? { id: p.id, title: p.snippet?.title ?? '' } : null;
}

const ADD_RETRY = new Set([404, 409, 500, 502, 503, 504]);
const ADD_TRIES = 5; // waits of 2, 4, 8 and 16 s: about 30 s in all

/**
 * Adds a video to the tournament's playlist, making the playlist (unlisted,
 * or public for public videos) the first time, or again if it was deleted on
 * YouTube. A playlist made a moment ago can answer "not found" for a few
 * seconds (the first real upload lost its playlist that way), so adding is
 * retried with growing waits; a remembered playlist is only replaced once
 * YouTube confirms it's gone. `position` (0 = first) puts it in that place, as
 * when it replaces another video; at the end when the playlist isn't sorted by hand.
 */
export async function addToTournamentPlaylist(dir, { tournamentId, title, privacy, position = null }, videoId, accessTokenValue, fetchImpl = fetch, { wait = sleep } = {}) {
  const file = join(dir, 'playlists.json');
  const map = (await readJsonFile(file)) ?? {};
  const listPrivacy = privacy === 'public' ? 'public' : 'unlisted';
  const add = async (playlistId) => {
    let at = Number.isInteger(position) ? position : null;
    for (let i = 1; ; i++) {
      try {
        return await call('POST', `${API}/playlistItems?part=snippet`, accessTokenValue,
          { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId }, ...(at === null ? {} : { position: at }) } }, fetchImpl, 'Adding to the playlist');
      } catch (err) {
        if (at !== null && err.reason === 'manualSortRequired') {
          at = null; // sorted by date or popularity on YouTube: it goes where YouTube's order puts it
          continue;
        }
        if (i >= ADD_TRIES || !ADD_RETRY.has(err.status)) throw err;
        await wait(2000 * 2 ** (i - 1));
      }
    }
  };
  let id = map[tournamentId];
  if (id && await playlistInfo(id, accessTokenValue, fetchImpl)) {
    await add(id);
    return id;
  }
  id = await createPlaylist(title, listPrivacy, accessTokenValue, fetchImpl);
  await writeJsonFile(file, { ...map, [tournamentId]: id });
  await add(id);
  return id;
}
