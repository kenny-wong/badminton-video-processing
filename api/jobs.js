// GET /api/jobs: every job kept (newest first). GET /api/jobs/:id: a background job's progress. POST /api/jobs/:id/stop: stops it.
// GET /api/jobs/:id/log: the job's log as text. POST /api/jobs/:id/log/open: shows its log file in Explorer.
// POST /api/log/open: shows the app's log file (data/logs/app.log) in Explorer.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fail, idParam, json } from '../lib/http.js';
import { getJob, jobLog, jobView, listJobs, stopJob } from '../lib/jobs.js';
import { appLog } from '../lib/log.js';
import { selectArg } from './matches.js';

export const list = () => json({ jobs: listJobs().map(jobView) });

export function onRequestGet({ params }) {
  const job = getJob(idParam(params.id));
  return job ? json(jobView(job)) : fail(404, 'notFound', 'No such job');
}

export function stop({ params }) {
  const job = stopJob(idParam(params.id));
  return job ? json(jobView(job)) : fail(404, 'notFound', 'No such job');
}

export async function log({ params }) {
  const job = getJob(idParam(params.id));
  if (!job) return fail(404, 'notFound', 'No such job (the app may have restarted since)');
  return json({ text: await jobLog(job), file: job.logFile });
}

function reveal(path) {
  if (!path || !existsSync(path)) return fail(404, 'notFound', 'The log file isn’t there');
  if (process.platform === 'win32') spawn('explorer.exe', [selectArg(path)], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  return json({ ok: true, path });
}

export function openLog({ params }) {
  const job = getJob(idParam(params.id));
  return reveal(job?.logFile ?? appLog());
}

export const openAppLog = () => reveal(appLog());
