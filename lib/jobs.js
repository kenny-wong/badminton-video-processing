// Long tasks (scanning folders, finding rallies, joining and rendering videos)
// run in the background; the page polls GET /api/jobs/<id> for progress.
//
// Jobs live in memory only, so they end when the server stops. Each server run
// has its own `boot` id, which the page compares to tell a restart from a job
// that went wrong. Each job keeps a log (job.log(text)): the last lines in
// memory, and everything in job.logFile when a task sets one.

import { randomUUID } from 'node:crypto';
import { append, stamp, tail } from './log.js';

let next = 1;
const jobs = new Map();
const KEEP = 50;
const KEEP_LINES = 400;

/** This server run. */
export const BOOT = randomUUID().slice(0, 8);

/**
 * Starts `work(job)` and returns the job at once. `work` may set job.progress
 * (0-1) and job.message, call job.log(text), set job.logFile, and returns the
 * result. An error's `detail` (or else its stack) is kept for the page.
 */
export function startJob(kind, key, work) {
  const running = [...jobs.values()].find((j) => j.key === key && j.status === 'running');
  if (running) return running;
  const controller = new AbortController();
  const job = {
    id: next++, kind, key, status: 'running', progress: 0, message: '', result: null, error: null, detail: null,
    startedAt: Date.now(), endedAt: null, controller, lines: [], logFile: null,
  };
  job.log = (text) => {
    for (const line of String(text).split(/\r?\n/)) job.lines.push(`${stamp()}  ${line}`);
    if (job.lines.length > KEEP_LINES) job.lines.splice(0, job.lines.length - KEEP_LINES);
    append(job.logFile, text);
  };
  jobs.set(job.id, job);
  console.log(`job ${job.id} ${key} started`);
  Promise.resolve()
    .then(() => work(job, controller.signal))
    .then((result) => {
      Object.assign(job, { status: 'done', progress: 1, result, endedAt: Date.now() });
      job.log(`Finished in ${seconds(job)}`);
      console.log(`job ${job.id} ${key} finished in ${seconds(job)}`);
    })
    .catch((err) => {
      const stopped = err?.code === 'stopped';
      Object.assign(job, {
        status: stopped ? 'stopped' : 'failed', error: err?.message ?? String(err), detail: err?.detail ?? err?.stack ?? null, endedAt: Date.now(),
      });
      job.log(stopped ? `Stopped after ${seconds(job)}` : `FAILED after ${seconds(job)}\n${job.detail ?? job.error}`);
      if (stopped) console.log(`job ${job.id} ${key} stopped`);
      else console.error(`job ${job.id} ${key} failed after ${seconds(job)}:`, err?.detail ? `${err.message}\n${err.detail}` : err);
    });
  while (jobs.size > KEEP) {
    const oldest = [...jobs.values()].find((j) => j.status !== 'running');
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
  return job;
}

const seconds = (j) => `${Math.round(((j.endedAt ?? Date.now()) - j.startedAt) / 1000)} s`;

export const getJob = (id) => jobs.get(id) ?? null;

export const findJob = (key) => [...jobs.values()].reverse().find((j) => j.key === key) ?? null;

export function stopJob(id) {
  const job = jobs.get(id);
  if (job?.status === 'running') job.controller.abort();
  return job ?? null;
}

/** What the page sees of a job. */
export const jobView = (j) => j && {
  id: j.id, kind: j.kind, key: j.key, boot: BOOT, status: j.status, progress: Math.round(j.progress * 1000) / 1000, message: j.message,
  result: j.result, error: j.error, detail: j.detail, startedAt: j.startedAt, endedAt: j.endedAt, logFile: j.logFile,
};

/** The job's log: its file's last 64 kB when it has one, else the lines kept in memory. */
export async function jobLog(j) {
  const text = j.logFile ? await tail(j.logFile, 64 * 1024) : null;
  return text ?? j.lines.join('\n');
}
