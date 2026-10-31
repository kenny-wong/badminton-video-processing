// GET /api/settings: the settings, the app version, whether FFmpeg was found, and a
//   frame of the latest linked video for the scoreboard preview.
// PUT /api/settings: saves them.
// PUT /api/settings/logo (the PNG or JPEG itself as the body): sets the logo. DELETE removes it.

import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, json, readJson } from '../lib/http.js';
import { cleanSettings, readSettings, writeSettings } from '../lib/settings.js';
import { findTools, pickEncoder } from '../lib/ffmpeg.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function status(settings) {
  const tools = findTools(settings.ffmpegFolder);
  return { version, ffmpeg: Boolean(tools), encoder: tools ? pickEncoder(tools) : null };
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
