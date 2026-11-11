// GET /api/version: the version this server runs, its run id, when it started and whether it's a development copy.
// POST /api/restart { force? }: restarts the server (409 while jobs run, unless force).
// GET /api/settings: the settings, the app version, whether FFmpeg was found, and a
//   frame of the latest linked video for the scoreboard preview.
// PUT /api/settings: saves them.
// PUT /api/settings/logo (the PNG or JPEG itself as the body): sets the logo. DELETE removes it.
// PUT /api/settings/music (an MP3, M4A or WAV file as the body): sets the music for highlights. DELETE removes it.

import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, json, readJson } from '../lib/http.js';
import { cleanSettings, readSettings, writeSettings } from '../lib/settings.js';
import { findTools, pickEncoder } from '../lib/ffmpeg.js';
import { BOOT, listJobs } from '../lib/jobs.js';
import { restartSoon } from '../lib/restart.js';
import { voiceRemover } from '../lib/voices.js';
import { toolsFolder } from '../lib/analysis.js';

// Read once at start: the version this server runs, even if the files are updated under it.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const STARTED = new Date().toISOString();

// dev: not the installed app (a development copy: `npm run app`, `npm start`), so the page can say so.
export const versionRoute = () => json({ version, boot: BOOT, startedAt: STARTED, dev: process.env.BADMINTON_VIDEO_DEV === '1' });

export async function restart({ request, app }) {
  const body = (await readJson(request)) ?? {};
  const running = listJobs().filter((j) => j.status === 'running' || j.status === 'queued');
  if (running.length && body.force !== true) {
    return fail(409, 'jobsRunning', `${running.length} job${running.length === 1 ? ' is' : 's are'} still running and would stop: ${running.map((j) => j.label || j.key).join('; ')}`);
  }
  if (app.noRestart) return json({ ok: true, restarting: false }); // tests
  console.log(`Restart asked for from the page${running.length ? ` (stopping ${running.length} job${running.length === 1 ? '' : 's'})` : ''}`);
  // The desktop app restarts itself (Electron relaunches); after the answer has gone.
  if (app.restart) setTimeout(app.restart, 300);
  else if (!restartSoon())return fail(400, 'devMode', 'The server restarts by itself when its files change (development mode)');
  return json({ ok: true, restarting: true, boot: BOOT }, 202);
}

function status(settings) {
  const tools = findTools(settings.ffmpegFolder);
  return { version, ffmpeg: Boolean(tools), encoder: tools ? pickEncoder(tools) : null, voices: voiceRemover(toolsFolder(settings)).ready };
}

export function onRequestGet({ app }) {
  const settings = readSettings(app.db);
  const latest = app.db.prepare('SELECT match_id FROM videos WHERE match_id IS NOT NULL AND missing = 0 ORDER BY recorded_at DESC LIMIT 1').get();
  return json({ settings, ...status(settings), previewThumb: latest ? `/media/thumb/${latest.match_id}` : null });
}

export async function onRequestPut({ request, app }) {
  const body = await readJson(request);
  if (!body) return fail(400, 'badInput', 'Settings must be JSON');
  const settings = cleanSettings(body, readSettings(app.db));
  writeSettings(app.db, settings);
  return json({ settings, ...status(settings) });
}

const MAX_LOGO = 5_000_000;

/** 'png' or 'jpg' from a file's first bytes, else null. */
export function imageKind(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

const logoDir = (app) => app.dataDir ?? join(tmpdir(), 'badminton-video');

const MAX_MUSIC = 40_000_000;

/** 'mp3', 'm4a' or 'wav' from a file's first bytes, else null. */
export function audioKind(bytes) {
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (bytes.length > 12 && ascii(4, 8) === 'ftyp') return 'm4a';
  if (bytes.length > 3 && (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return 'mp3';
  return null;
}

export async function putMusic({ request, app }) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_MUSIC) return fail(400, 'tooBig', 'The music file must be under 40 MB');
  const kind = audioKind(bytes);
  if (!kind) return fail(400, 'badAudio', 'The music must be an MP3, M4A or WAV file');
  const dir = logoDir(app);
  await mkdir(dir, { recursive: true });
  for (const other of ['mp3', 'm4a', 'wav']) if (other !== kind) await rm(join(dir, `music.${other}`), { force: true });
  const file = join(dir, `music.${kind}`);
  await writeFile(file, bytes);
  const settings = readSettings(app.db);
  settings.music = { ...settings.music, file };
  writeSettings(app.db, settings);
  return json({ settings, ...status(settings) });
}

export async function deleteMusic({ app }) {
  const settings = readSettings(app.db);
  if (settings.music.file) await rm(settings.music.file, { force: true });
  settings.music = { ...settings.music, file: '' };
  writeSettings(app.db, settings);
  return json({ settings, ...status(settings) });
}

export async function putLogo({ request, app }) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_LOGO) return fail(400, 'tooBig', 'The logo must be under 5 MB');
  const kind = imageKind(bytes);
  if (!kind) return fail(400, 'badImage', 'The logo must be a PNG (best, with a see-through background) or a JPEG');
  const dir = logoDir(app);
  await mkdir(dir, { recursive: true });
  await rm(join(dir, kind === 'png' ? 'logo.jpg' : 'logo.png'), { force: true });
  const file = join(dir, `logo.${kind}`);
  await writeFile(file, bytes);
  const settings = readSettings(app.db);
  settings.logo = { ...settings.logo, file };
  writeSettings(app.db, settings);
  return json({ settings, ...status(settings) });
}

export async function deleteLogo({ app }) {
  const settings = readSettings(app.db);
  if (settings.logo.file) await rm(settings.logo.file, { force: true });
  settings.logo = { ...settings.logo, file: '' };
  writeSettings(app.db, settings);
  return json({ settings, ...status(settings) });
}
