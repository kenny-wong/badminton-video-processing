// GET /api/analysis: whether the Python tools are ready, where they go, and
//   what this PC has for them (NVIDIA card, free space).
// POST /api/analysis/setup { folder? }: downloads and installs them (a job).
//   `folder` also becomes the Settings folder; empty means the app's own.
// DELETE /api/analysis: removes a set-up made by POST, nothing else.

import { isAbsolute } from 'node:path';
import { fail, json, readJson } from '../lib/http.js';
import { defaultTools, toolsFolder } from '../lib/analysis.js';
import { findGpu, freeBytes, NEED_BYTES, removeAnalysis, setupAnalysis, setupState } from '../lib/analysis-setup.js';
import { findJob, jobView, listJobs, startJob } from '../lib/jobs.js';
import { peopleFinder } from '../lib/people.js';
import { readSettings, writeSettings } from '../lib/settings.js';
import { tracker } from '../lib/track.js';
import { voiceRemover } from '../lib/voices.js';

const KEY = 'analysis-setup';
const USES_TOOLS = ['track', 'people', 'render', 'clip', 'reel', 'analysis-setup'];

export async function onRequestGet({ app }) {
  const settings = readSettings(app.db);
  const folder = toolsFolder(settings);
  const ready = { tracking: tracker(folder).ready, players: peopleFinder(folder).ready, voices: voiceRemover(folder).ready };
  const [gpu, free, state] = await Promise.all([findGpu(), freeBytes(folder), setupState(folder)]);
  return json({
    supported: process.platform === 'win32', folder, defaultFolder: defaultTools(), ready, gpu, freeBytes: free, needBytes: NEED_BYTES, ...state, job: jobView(findJob(KEY)),
  });
}

export async function setup({ request, app }) {
  if (process.platform !== 'win32') return fail(400, 'notWindows', 'The set-up is for Windows PCs only');
  const body = (await readJson(request)) ?? {};
  const settings = readSettings(app.db);
  const chosen = typeof body.folder === 'string' ? body.folder.trim() : settings.analysisFolder;
  if (chosen && !isAbsolute(chosen)) return fail(400, 'badFolder', 'Give the whole path of the folder, such as D:\\Badminton tools');
  const folder = chosen || defaultTools();
  const { unfinished } = await setupState(folder);
  const free = await freeBytes(folder);
  if (!unfinished && free !== null && free < NEED_BYTES) {
    return fail(409, 'noSpace', `The set-up needs about ${Math.round(NEED_BYTES / 1e9)} GB free, and that drive has ${(free / 1e9).toFixed(1)} GB. Choose a folder on another drive.`);
  }
  if (chosen !== settings.analysisFolder) writeSettings(app.db, { ...settings, analysisFolder: chosen });
  const job = startJob('analysis-setup', KEY, (j, signal) => setupAnalysis({ folder, signal, job: j }), { queue: 'setup', label: 'Set up tracking tools' });
  return json(jobView(job), 202);
}

export async function remove({ app }) {
  const busy = listJobs().filter((j) => (j.status === 'running' || j.status === 'queued') && USES_TOOLS.includes(j.kind));
  if (busy.length) return fail(409, 'jobsRunning', 'Wait for the running jobs to finish first: they may be using these tools.');
  const folder = toolsFolder(readSettings(app.db));
  if (!(await removeAnalysis(folder))) return fail(409, 'notMadeHere', 'This folder wasn’t set up from here, so it stays as it is.');
  return json({ ok: true });
}
