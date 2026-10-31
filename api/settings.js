// GET /api/settings: the settings, the app version and whether FFmpeg was found.
// PUT /api/settings: saves them.

import { readFileSync } from 'node:fs';
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
  return json({ settings, ...status(settings) });
}

export async function onRequestPut({ request, app }) {
  const body = await readJson(request);
  if (!body) return fail(400, 'badInput', 'Settings must be JSON');
  const settings = cleanSettings(body, readSettings(app.db));
  writeSettings(app.db, settings);
  return json({ settings, ...status(settings) });
}
