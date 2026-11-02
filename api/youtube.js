// YouTube sign-in and upload.
//
// GET  /api/youtube?match=<id>: { ready, signedIn, channel, uploading: job, playlist: { title, exists, url } }
//      (ready = the OAuth client file is there; playlist = where an upload of this match would go).
// POST /api/youtube/signin: { url } of Google's sign-in page; Google then sends the browser to
// GET  /api/youtube/callback, which saves the sign-in and shows a page saying so.
// POST /api/youtube/signout: forgets the sign-in.
// POST /api/youtube/open { url }: opens a YouTube or Google page in the normal browser, outside the app's window.
// POST /api/matches/:id/youtube { file?, privacy?, playlist?, replace? }: uploads one of the match's finished files ('video' by default,
//      'highlights' or 'clip:<name>'; a job, one upload at a time) and marks the match with its link. With `replace`, the
//      video the match links to now is deleted from YouTube once the upload is done, and the new one takes its place in the playlist.
// GET  /api/matches/:id/rendered: the finished files, with URLs to play them.
// DELETE /api/matches/:id/rendered?key=<key>: deletes one finished file (the original video can't be: it isn't one).

import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, idParam, json, readJson } from '../lib/http.js';
import { findJob, jobView, listJobs, startJob } from '../lib/jobs.js';
import { loadMatch } from '../lib/pipeline.js';
import { nowIso } from '../lib/db.js';
import { readSettings } from '../lib/settings.js';
import { matchPeople } from '../lib/players.js';
import { deleteRendered, originalFile, renderedFile, renderedFiles } from '../lib/rendered.js';
import { youtubeId, youtubeUrl } from '../lib/links.js';
import { matchLabel } from './matches.js';
import { openInBrowser } from '../lib/browser.js';
import {
  accessToken, addToTournamentPlaylist, authUrl, deleteVideo, exchangeCode, knownPlaylist, pkce, playlistInfo, playlistPosition, playlistUrl, PRIVACY, readClient, readToken, retryAfter,
  signOut as forget, tournamentPlaylistTitle, tournamentPlaylistUrls, uploadVideo, videoResource, videoStatus, youtubeDir,
} from '../lib/youtube.js';

const SIGNIN_MAX_AGE = 10 * 60_000;
const pending = new Map(); // state -> { verifier, redirectUri, at }

const dirOf = (app) => youtubeDir(app.dataDir ?? join(tmpdir(), 'badminton-video'));
/** Tournament id (as text) -> its playlist's link, for the playlists uploads made. */
export const tournamentPlaylists = (app) => tournamentPlaylistUrls(dirOf(app));
const redirectOf = (app) => `http://127.0.0.1:${app.port || Number(process.env.PORT) || 8791}/api/youtube/callback`;
const jobKey = (id, file) => `upload:${id}:${file}`;

export async function onRequestGet({ request, app }) {
  const dir = dirOf(app);
  const token = await readToken(dir);
  const id = idParam(new URL(request.url).searchParams.get('match'));
  return json({
    ready: Boolean(await readClient(dir)),
    signedIn: Boolean(token?.refreshToken),
    channel: token?.channel ?? null,
    uploading: id ? jobView(listJobs().find((j) => j.key.startsWith(jobKey(id, '')) && (j.status === 'running' || j.status === 'queued'))) ?? null : null,
    playlist: id && token?.refreshToken ? await playlistFor(dir, loadMatch(app.db, id)?.tournament) : null,
    current: id ? currentVideo(loadMatch(app.db, id)?.match) : null, // what Replace would delete
  });
}

const PLAYLIST_CACHE_MS = 2 * 60_000;
const playlistCache = new Map(); // playlist id -> { info, at }

/**
 * The playlist an upload from this tournament goes into: { title, exists, url }.
 * An existing one's title is read from YouTube (it may have been renamed there);
 * one deleted on YouTube counts as new, as the next upload makes it again.
 */
async function playlistFor(dir, tournament) {
  if (!tournament) return null;
  const fresh = { title: tournamentPlaylistTitle(tournament), exists: false, url: null };
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

export async function openPage({ request }) {
  const body = (await readJson(request)) ?? {};
  return openInBrowser(body.url) ? json({ ok: true }) : fail(400, 'badInput', 'Only YouTube and Google pages open from here');
}

export async function signOutRoute({ app }) {
  await forget(dirOf(app));
  console.log('YouTube: signed out');
  return json({ ok: true });
}

const mb = (n) => (n / 1048576).toFixed(n < 1048576 * 10 ? 1 : 0);

/** The video a match (or game) links to now: { url, videoId }, or null. */
const currentVideo = (match) => {
  const videoId = match?.youtubeUrl ? youtubeId(match.youtubeUrl) : null;
  return videoId ? { url: youtubeUrl(videoId), videoId } : null;
};

export async function upload({ request, params, app }) {
  const loaded = loadMatch(app.db, idParam(params.id));
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const body = (await readJson(request)) ?? {};
  const key = typeof body.file === 'string' ? body.file : body.highlights === true ? 'highlights' : 'video';
  const privacy = PRIVACY.includes(body.privacy) ? body.privacy : 'unlisted';
  // 'original': the match's video itself, uploaded without rendering.
  const opts = { people: matchPeople(app.db, loaded) };
  const file = key === 'original' ? originalFile(loaded, readSettings(app.db), opts) : renderedFile(loaded, readSettings(app.db), key, opts);
  if (!file) return fail(404, 'notFound', key === 'original' ? 'The original video isn’t there any more' : 'That video isn’t there any more: render it again');
  const notReady = await uploadNotReady(app);
  if (notReady) return notReady;
  const old = body.replace === true ? currentVideo(loaded.match) : null;
  if (body.replace === true && !old) return fail(409, 'nothingToReplace', 'This match has no YouTube video to replace');
  const job = queueUpload(app, loaded, { key, file, privacy, playlist: body.playlist !== false, old });
  return json(jobView(job), 202);
}

/** A failure response when uploading can't start (no OAuth client, not signed in), else null. */
async function uploadNotReady(app) {
  const dir = dirOf(app);
  if (!(await readClient(dir))) return fail(409, 'noClient', 'YouTube upload isn’t set up: the OAuth client file is missing');
  if (!(await readToken(dir))?.refreshToken) return fail(401, 'signin', 'Sign in to YouTube first');
  return null;
}

/**
 * Queues the upload of one file of a match (key: 'video', 'highlights', 'clip:…' or 'original') in the
 * 'upload' queue: added to the tournament's playlist unless `playlist` is false; with `old`, it takes the
 * old video's place there and the old video is deleted once the new one is up.
 */
function queueUpload(app, loaded, { key, file, privacy, playlist = true, old = null }) {
  const dir = dirOf(app);
  const body = { playlist };
  const { match, tournament } = loaded;
  return startJob('upload', jobKey(match.id, key), async (j, signal) => {
    const resource = videoResource({ title: file.title, description: file.description, privacy, recordedOn: match.date });
    j.log(`Uploading ${file.path} as ${privacy}: ${resource.snippet.title}`);
    j.message = 'Starting the upload';
    const token = () => accessToken(dir);
    // The old video's place in the tournament's playlist, read before anything changes, for the new one to take.
    const listId = old && body.playlist !== false && tournament ? await knownPlaylist(dir, tournament.id) : null;
    const position = listId ? await playlistPosition(listId, old.videoId, await token()).catch((err) => { j.log(`Couldn’t read the old video’s place in the playlist: ${err.message}`); return null; }) : null;
    if (old) j.log(`Replacing ${old.url}${position === null ? '' : ` (number ${position + 1} in the playlist)`}`);
    const video = await uploadVideo({
      path: file.path, resource, token, signal,
      onProgress: (sent, size) => {
        j.progress = size ? sent / size : 0;
        j.message = `${mb(sent)} of ${mb(size)} MB sent`;
      },
    }).catch((err) => {
      // Refused for a limit: when it can go again, for the page to suggest.
      const recentUploads = app.db.prepare("SELECT uploaded_at FROM matches WHERE uploaded_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')").all().map((r) => r.uploaded_at);
      err.retryAt = retryAfter(err.reason, { recentUploads });
      throw err;
    });
    const url = youtubeUrl(video.id);
    j.log(`Uploaded: ${url} (YouTube replied ${video.status?.privacyStatus ?? '?'})`);
    // The match keeps the link of its latest upload, whichever file it was.
    app.db.prepare('UPDATE matches SET youtube_url = ?, uploaded_at = ?, updated_at = ? WHERE id = ?').run(url, nowIso(), nowIso(), match.id);
    const result = { videoId: video.id, url, file: key, label: file.label, privacy, privacyNow: video.status?.privacyStatus ?? null, uploadStatus: video.status?.uploadStatus ?? null, playlist: null, playlistError: null, replaced: null, replaceError: null };
    // Asked again after the upload: an unaudited Google project's videos may be locked to private.
    const now = await videoStatus(video.id, await token()).catch((err) => { j.log(`Couldn’t read the status: ${err.message}`); return null; });
    if (now) Object.assign(result, { privacyNow: now.privacyStatus ?? result.privacyNow, uploadStatus: now.uploadStatus ?? result.uploadStatus });
    result.locked = privacy !== 'private' && result.privacyNow === 'private';
    j.log(`Status: ${result.privacyNow}, ${result.uploadStatus}${result.locked ? ' (locked to private)' : ''}`);
    if (body.playlist !== false && tournament) {
      j.message = 'Adding to the tournament’s playlist';
      try {
        const id = await addToTournamentPlaylist(dir, { tournamentId: tournament.id, title: tournamentPlaylistTitle(tournament), privacy, position }, video.id, await token());
        result.playlist = { id, url: playlistUrl(id) };
        playlistCache.delete(id);
      } catch (err) {
        result.playlistError = err.message;
        j.log(`Playlist: ${err.message}`);
      }
    }
    // Only now, with the new video safely up: the old one goes (and leaves the playlist with it).
    if (old && old.videoId !== video.id) {
      j.message = 'Deleting the old video';
      try {
        const deleted = await deleteVideo(old.videoId, await token());
        result.replaced = { url: old.url, deleted };
        j.log(deleted ? `Deleted ${old.url}` : `${old.url} was already gone from YouTube`);
      } catch (err) {
        result.replaceError = err.message;
        result.replaced = { url: old.url, deleted: false };
        j.log(`Deleting ${old.url}: ${err.message}`);
      }
    }
    return result;
  }, { queue: 'upload', label: `YouTube${old ? ' replace' : ''} (${file.label}): ${matchLabel(match)}` });
}

/**
 * POST /api/tournaments/:id/upload-all { kind: 'rendered' | 'original', privacy?, playlist? }: queues an upload
 * of every filmed match (or game) here that has no YouTube link yet: 'rendered' its rendered whole video,
 * 'original' the original of each one not rendered (so nothing goes up twice). They run one after another.
 */
export async function uploadAll({ request, params, app }) {
  const id = idParam(params.id);
  if (!id || !app.db.prepare('SELECT 1 FROM tournaments WHERE id = ?').get(id)) return fail(404, 'notFound', 'No such tournament');
  const body = (await readJson(request)) ?? {};
  if (!['rendered', 'original'].includes(body.kind)) return fail(400, 'badInput', 'Send kind: rendered or original');
  const notReady = await uploadNotReady(app);
  if (notReady) return notReady;
  const privacy = PRIVACY.includes(body.privacy) ? body.privacy : 'unlisted';
  const settings = readSettings(app.db);
  const units = app.db.prepare(`SELECT m.id FROM matches m WHERE m.tournament_id = ? AND m.youtube_url IS NULL
      AND EXISTS (SELECT 1 FROM videos v WHERE v.match_id = m.id) ORDER BY m.match_date, m.match_time, m.game`).all(id);
  const jobs = [];
  for (const { id: unit } of units) {
    const loaded = loadMatch(app.db, unit);
    const opts = { people: matchPeople(app.db, loaded) };
    const rendered = renderedFile(loaded, settings, 'video', opts);
    const key = body.kind === 'rendered' ? 'video' : 'original';
    const file = body.kind === 'rendered' ? rendered : rendered ? null : originalFile(loaded, settings, opts);
    const busy = findJob(jobKey(unit, key));
    if (!file || (busy && (busy.status === 'queued' || busy.status === 'running'))) continue;
    jobs.push(jobView(queueUpload(app, loaded, { key, file, privacy, playlist: body.playlist !== false })));
  }
  return json({ queued: jobs.length, jobs }, jobs.length ? 202 : 200);
}

/** GET /api/matches/:id/rendered: the match's finished files, newest first, with a URL to play each. */
export function renderedList({ params, app }) {
  const loaded = loadMatch(app.db, idParam(params.id));
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const settings = readSettings(app.db);
  const opts = { people: matchPeople(app.db, loaded) };
  const files = renderedFiles(loaded, settings, opts);
  // The original as well, for the YouTube box (uploading it without rendering); not one of the finished files.
  return json({ files: files.map((f) => ({ ...f, url: `/media/rendered/${loaded.match.id}?key=${encodeURIComponent(f.key)}&v=${encodeURIComponent(f.mtime)}` })),
    original: originalFile(loaded, settings, opts) });
}

export async function renderedDelete({ request, params, app }) {
  const loaded = loadMatch(app.db, idParam(params.id));
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const key = new URL(request.url).searchParams.get('key') ?? '';
  try {
    const file = await deleteRendered(app.db, loaded, readSettings(app.db), key);
    if (!file) return fail(404, 'notFound', 'That video isn’t there any more');
    console.log(`Deleted ${file.path}`);
    return json({ ok: true, key: file.key, kind: file.kind });
  } catch (err) {
    if (['EBUSY', 'EPERM'].includes(err.code)) return fail(409, 'busy', 'The file is still open (in the player or another program): close it and try again');
    throw err;
  }
}
