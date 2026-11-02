// The Tools page: merging videos and splitting one (lib/video-tools.js).
// GET  /api/videos/:id/keyframes: { keys, duration }, where a lossless cut can start.
// POST /api/tools/merge { ids, setAside }: joins the videos in that order (a job).
// POST /api/tools/split { id, parts: [{ start, end }], setAside }: cuts up to 3 parts (a job).
// POST /api/videos/:id/reveal: shows a library video in Explorer.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fail, idParam, json, readJson } from '../lib/http.js';
import { readSettings } from '../lib/settings.js';
import { findTools } from '../lib/ffmpeg.js';
import { jobView, startJob } from '../lib/jobs.js';
import { keyframes, mergeVideos, splitVideo } from '../lib/video-tools.js';
import { cleanParts } from '../public/shared/video-files.js';
import { selectArg } from './matches.js';

const noFfmpeg = () => fail(503, 'noFfmpeg', 'FFmpeg wasn’t found. Install it (winget install Gyan.FFmpeg) or set its folder in Settings.');
const tools = (app) => findTools(readSettings(app.db).ffmpegFolder);
const videoRow = (app, id) => (id ? app.db.prepare('SELECT * FROM videos WHERE id = ?').get(id) : null);

export async function keyframesRoute({ params, app }) {
  const row = videoRow(app, idParam(params.id));
  if (!row || !existsSync(row.path)) return fail(404, 'notFound', 'That video isn’t in its folder any more');
  const t = tools(app);
  if (!t) return noFfmpeg();
  return json({ keys: await keyframes(t, row.path), duration: row.duration });
}

export async function merge({ request, app }) {
  const body = (await readJson(request)) ?? {};
  const ids = Array.isArray(body.ids) ? body.ids.map((x) => idParam(String(x))) : [];
  if (ids.length < 2 || ids.includes(null)) return fail(400, 'badInput', 'Choose at least two videos');
  if (new Set(ids).size !== ids.length) return fail(400, 'badInput', 'A video is in the list twice');
  for (const id of ids) if (!videoRow(app, id)) return fail(404, 'notFound', `No video ${id}`);
  const t = tools(app);
  if (!t) return noFfmpeg();
  const job = startJob('merge', `merge:${ids.join(',')}`, (j, signal) => mergeVideos(app.db, t, { ids, setAside: body.setAside === true, signal, job: j }),
    { queue: 'files', label: `Merge ${ids.length} videos` });
  return json(jobView(job), 202);
}

export async function split({ request, app }) {
  const body = (await readJson(request)) ?? {};
  const id = idParam(String(body.id ?? ''));
  const row = videoRow(app, id);
  if (!row) return fail(404, 'notFound', 'No such video');
  const { problems } = cleanParts(body.parts, row.duration);
  if (problems.length) return fail(400, 'badInput', problems[0]);
  const t = tools(app);
  if (!t) return noFfmpeg();
  const name = row.path.split(/[\\/]/).pop();
  const job = startJob('split', `split:${id}`, (j, signal) => splitVideo(app.db, t, { id, parts: body.parts, setAside: body.setAside === true, signal, job: j }),
    { queue: 'files', label: `Split ${name}` });
  return json(jobView(job), 202);
}

export function reveal({ params, app }) {
  const row = videoRow(app, idParam(params.id));
  if (!row || !existsSync(row.path)) return fail(404, 'notFound', 'That video isn’t in its folder any more');
  if (process.platform === 'win32') spawn('explorer.exe', [selectArg(row.path)], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  return json({ ok: true, path: row.path });
}
