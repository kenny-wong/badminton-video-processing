// The app's server: runs on this PC only (127.0.0.1), serves the page from
// public/, the API from api/, and match videos (with byte ranges, so the
// player can seek). Start it with `npm start`; it opens a Chrome app window.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { openDb } from './lib/db.js';
import { fail, idParam, serverError } from './lib/http.js';
import { loadMatch, sourceFor } from './lib/pipeline.js';
import { renderedFile } from './lib/rendered.js';
import { frameAt, thumbnail } from './lib/thumbs.js';
import { findTools } from './lib/ffmpeg.js';
import { readSettings } from './lib/settings.js';
import { startLog } from './lib/log.js';
import { BOOT } from './lib/jobs.js';
import { listenWhenFree } from './lib/restart.js';
import * as settings from './api/settings.js';
import * as tournaments from './api/tournaments.js';
import * as matches from './api/matches.js';
import * as videos from './api/videos.js';
import * as jobs from './api/jobs.js';
import * as players from './api/players.js';
import * as overview from './api/overview.js';
import * as reels from './api/reels.js';
import * as youtube from './api/youtube.js';
import * as videoTools from './api/tools.js';

export const PORT = Number(process.env.PORT) || 8791;
const ROOT = fileURLToPath(new URL('./public/', import.meta.url));

const ROUTES = [
  ['GET', '/api/version', settings.versionRoute],
  ['POST', '/api/restart', settings.restart],
  ['GET', '/api/settings', settings.onRequestGet],
  ['PUT', '/api/settings', settings.onRequestPut],
  ['PUT', '/api/settings/logo', settings.putLogo],
  ['DELETE', '/api/settings/logo', settings.deleteLogo],
  ['PUT', '/api/settings/music', settings.putMusic],
  ['DELETE', '/api/settings/music', settings.deleteMusic],
  ['GET', '/api/tournaments', tournaments.onRequestGet],
  ['POST', '/api/tournaments', tournaments.onRequestPost],
  ['GET', '/api/tournaments/:id', tournaments.getOne],
  ['POST', '/api/tournaments/:id/refresh', tournaments.refresh],
  ['DELETE', '/api/tournaments/:id', tournaments.onRequestDelete],
  ['POST', '/api/tournaments/:id/unlink-all', tournaments.unlinkAll],
  ['POST', '/api/tournaments/:id/render-all', tournaments.renderAll],
  ['PUT', '/api/tournaments/:id', tournaments.update],
  ['PUT', '/api/tournaments/:id/complete', tournaments.setComplete],
  ['PUT', '/api/tournaments/:id/players', tournaments.setPlayers],
  ['POST', '/api/tournaments/:id/matches', tournaments.addMatchRoute],
  ['PUT', '/api/tournaments/:id/matches/:mid', tournaments.updateMatchRoute],
  ['DELETE', '/api/tournaments/:id/matches/:mid', tournaments.deleteMatchRoute],
  ['GET', '/api/overview', overview.onRequestGet],
  ['GET', '/api/search', overview.searchRoute],
  ['GET', '/api/matches/:id', matches.onRequestGet],
  ['PUT', '/api/matches/:id', matches.onRequestPut],
  ['PUT', '/api/matches/:id/favourite', matches.setFavourite],
  ['PUT', '/api/matches/:id/videos', matches.linkVideos],
  ['PUT', '/api/matches/:id/games/:game/videos', matches.linkGameVideos],
  ['POST', '/api/matches/:id/analyse', matches.analyse],
  ['POST', '/api/matches/:id/render', matches.render],
  ['POST', '/api/matches/:id/reveal', matches.reveal],
  ['POST', '/api/matches/:id/take-tagging', matches.takeTagging],
  ['POST', '/api/matches/:id/track', matches.track],
  ['GET', '/api/matches/:id/track', matches.trackData],
  ['POST', '/api/matches/:id/detections', matches.findPlayers],
  ['GET', '/api/matches/:id/detections', matches.detections],
  ['PUT', '/api/matches/:id/detections', matches.setSwap],
  ['GET', '/api/matches/:id/levels', matches.levels],
  ['POST', '/api/matches/:id/levels', matches.startLevels],
  ['POST', '/api/matches/:id/clip', matches.clip],
  ['POST', '/api/reveal', matches.revealPath],
  ['POST', '/api/matches/:id/youtube', youtube.upload],
  ['GET', '/api/matches/:id/rendered', youtube.renderedList],
  ['DELETE', '/api/matches/:id/rendered', youtube.renderedDelete],
  ['GET', '/api/youtube', youtube.onRequestGet],
  ['POST', '/api/youtube/signin', youtube.signIn],
  ['GET', '/api/youtube/callback', youtube.callback],
  ['POST', '/api/youtube/signout', youtube.signOutRoute],
  ['POST', '/api/youtube/open', youtube.openPage],
  ['GET', '/api/reels', reels.onRequestGet],
  ['POST', '/api/reels', reels.onRequestPost],
  ['GET', '/api/matches/:id/suggestions', matches.suggestions],
  ['GET', '/api/matches/:id/people', players.matchPeopleRoute],
  ['GET', '/api/players', players.onRequestGet],
  ['POST', '/api/players/refresh', players.refresh],
  ['GET', '/api/players/search', players.search],
  ['GET', '/api/players/:id', players.getOne],
  ['POST', '/api/players/:id/tournaments', players.importTournaments],
  ['GET', '/api/favourites', players.favouritesList],
  ['POST', '/api/favourites', players.addFavouriteRoute],
  ['PUT', '/api/favourites/:key', players.linkFavouriteRoute],
  ['DELETE', '/api/favourites/:key', players.removeFavouriteRoute],
  ['GET', '/api/videos', videos.onRequestGet],
  ['POST', '/api/videos/scan', videos.scan],
  ['PUT', '/api/videos/:id', videos.onRequestPut],
  ['GET', '/api/videos/:id/keyframes', videoTools.keyframesRoute],
  ['POST', '/api/videos/:id/reveal', videoTools.reveal],
  ['POST', '/api/tools/merge', videoTools.merge],
  ['POST', '/api/tools/split', videoTools.split],
  ['GET', '/api/jobs', jobs.list],
  ['GET', '/api/jobs/:id', jobs.onRequestGet],
  ['POST', '/api/jobs/:id/stop', jobs.stop],
  ['GET', '/api/jobs/:id/log', jobs.log],
  ['POST', '/api/jobs/:id/log/open', jobs.openLog],
  ['POST', '/api/log/open', jobs.openAppLog],
];

/** The handler and parameters for a request, or null. */
export function route(method, pathname) {
  for (const [m, pattern, handler] of ROUTES) {
    const names = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
    const hit = re.exec(pathname);
    if (hit && m === method) return { handler, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])])) };
  }
  return null;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; media-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function sendStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY });
  createReadStream(file).pipe(res);
}

/** Streams a match's video, honouring Range requests so the player can seek. */
function sendVideo(req, res, path) {
  const size = statSync(path).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0;
  let end = size - 1;
  if (range) {
    if (range[1]) start = Number(range[1]);
    if (range[2]) end = range[1] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!range[1] && range[2]) start = Math.max(0, size - Number(range[2]));
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
  }
  res.writeHead(range ? 206 : 200, {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path, { start, end }).pipe(res);
}

/** Only this PC's own pages may use the API: the Host must be ours, and writes must come from our Origin. */
export function allowed(headers, method, port = PORT) {
  const ours = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!ours.includes(headers.host)) return false;
  if (method !== 'GET' && method !== 'HEAD' && headers.origin && !ours.map((h) => `http://${h}`).includes(headers.origin)) return false;
  return true;
}

export function createApp(app) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (!allowed(req.headers, req.method, app.port ?? PORT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
        return;
      }
      const thumb = /^\/media\/thumb\/(\d+)$/.exec(url.pathname);
      if (thumb && req.method === 'GET') {
        const tools = findTools(readSettings(app.db).ffmpegFolder);
        const file = tools && await thumbnail(app.db, tools, app.thumbDir ?? join(tmpdir(), 'badminton-video-thumbs'), idParam(thumb[1])).catch((err) => {
          console.error('thumbnail', thumb[1], err.message);
          return null;
        });
        if (!file) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        createReadStream(file).pipe(res);
        return;
      }
      if (url.pathname === '/media/logo' && req.method === 'GET') {
        const { file } = readSettings(app.db).logo;
        if (!file || !existsSync(file)) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        createReadStream(file).pipe(res);
        return;
      }
      const frame = /^\/media\/frame\/(\d+)$/.exec(url.pathname);
      if (frame && req.method === 'GET') {
        const at = Number(url.searchParams.get('t'));
        const tools = Number.isFinite(at) && findTools(readSettings(app.db).ffmpegFolder);
        const file = tools && await frameAt(app.db, tools, app.thumbDir ?? join(tmpdir(), 'badminton-video-thumbs'), idParam(frame[1]), at).catch((err) => {
          console.error('frame', frame[1], at, err.message);
          return null;
        });
        if (!file) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        createReadStream(file).pipe(res);
        return;
      }
      const media = /^\/media\/match\/(\d+)$/.exec(url.pathname);
      if (media && (req.method === 'GET' || req.method === 'HEAD')) {
        const loaded = loadMatch(app.db, idParam(media[1]));
        const source = loaded && sourceFor(loaded);
        if (!source?.ready) {
          res.writeHead(404).end();
          return;
        }
        sendVideo(req, res, source.path);
        return;
      }
      // One video of the library, for the Tools page's splitter.
      const libraryVideo = /^\/media\/video\/(\d+)$/.exec(url.pathname);
      if (libraryVideo && (req.method === 'GET' || req.method === 'HEAD')) {
        const row = app.db.prepare('SELECT path FROM videos WHERE id = ?').get(idParam(libraryVideo[1]));
        if (!row || !existsSync(row.path)) {
          res.writeHead(404).end();
          return;
        }
        sendVideo(req, res, row.path);
        return;
      }
      // A finished file of the match (whole video, highlights or a rally clip), for the editor's player.
      const rendered = /^\/media\/rendered\/(\d+)$/.exec(url.pathname);
      if (rendered && (req.method === 'GET' || req.method === 'HEAD')) {
        const loaded = loadMatch(app.db, idParam(rendered[1]));
        const file = loaded && renderedFile(loaded, readSettings(app.db), url.searchParams.get('key') ?? '');
        if (!file) {
          res.writeHead(404).end();
          return;
        }
        sendVideo(req, res, file.path);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const hit = route(req.method, url.pathname);
        let response;
        if (!hit) response = fail(404, 'notFound', 'No such API route');
        else {
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req);
          const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' });
          try {
            response = await hit.handler({ request, params: hit.params, app });
          } catch (err) {
            response = serverError(err, `${req.method} ${url.pathname}`);
          }
        }
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      sendStatic(res, url.pathname);
    } catch (err) {
      console.error(req.method, url.pathname, err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
    }
  });
}

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/**
 * Opens the log and database in `dataDir` and listens on 127.0.0.1:`port`.
 * Used by `npm start` below and by the desktop app (electron/main.js), which
 * passes its own folder, port and `restart`.
 */
export function startServer({ dataDir, dbPath = join(dataDir, 'badminton-video.db'), port = PORT, restart = null, onListening = () => {} }) {
  mkdirSync(dataDir, { recursive: true });
  startLog(join(dataDir, 'logs', 'app.log'));
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  console.log(`---- Badminton Video ${version} starting (process ${process.pid}, run ${BOOT}) ----`);
  // A server that is ended outright (Task Manager, taskkill /F) can't log anything:
  // a job "started" in the log with no "finished" or "failed" after it is how that shows.
  process.on('exit', (code) => console.log(`Server stopping (exit code ${code})`));
  const db = openDb(dbPath);
  const server = createApp({ db, port, thumbDir: join(dataDir, 'thumbs'), dataDir, restart });
  listenWhenFree(server, port, '127.0.0.1', () => {
    const address = `http://127.0.0.1:${port}/`;
    console.log(`Badminton Video running at ${address}`);
    onListening(address);
  });
  return { server, db };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => process.exit(0));
  process.on('uncaughtException', (err) => {
    console.error('Uncaught error, stopping:', err);
    process.exit(1);
  });
  const dataDir = fileURLToPath(new URL('./data/', import.meta.url));
  startServer({ dataDir, dbPath: process.env.DB_PATH || undefined, onListening: (address) => {
    if (process.argv.includes('--open') && existsSync(CHROME)) {
      spawn(CHROME, [`--app=${address}`, '--window-size=1400,900'], { detached: true, stdio: 'ignore' }).unref();
    }
  } });
}

