// Long tasks (scanning folders, finding rallies, joining and rendering videos)
// run in the background; the page polls GET /api/jobs/<id> for progress.
//
// Jobs live in memory only, so they end when the server stops. Each server run
// has its own `boot` id, which the page compares to tell a restart from a job
// that went wrong. Each job keeps a log (job.log(text)): the last lines in
// memory, and everything in job.logFile when a task sets one.
//
// Jobs given a `queue` (the GPU work: rendering and shuttle tracking) run one
// at a time in the order they were started; the others wait as 'queued'.

import { randomUUID } from 'node:crypto';
import { append, stamp, tail } from './log.js';

let next = 1;
const jobs = new Map();
const queues = new Map(); // queue name -> promise that settles when its last job has
const KEEP = 50;
const KEEP_LINES = 400;

/** This server run. */
export const BOOT = randomUUID().slice(0, 8);

const active = (j) => j.status === 'running' || j.status === 'queued';

/**
 * Starts `work(job)` and returns the job at once (or the same key's job that
 * is still running or waiting). `work` may set job.progress (0-1) and
 * job.message, call job.log(text), set job.logFile, and returns the result.
 * An error's `detail` (or else its stack) is kept for the page. With `queue`,
 * the work waits for that queue's earlier jobs; `label` names the job on the
 * jobs page.
 */
export function startJob(kind, key, work, { queue = null, label = '' } = {}) {
  const running = [...jobs.values()].find((j) => j.key === key && active(j));
  if (running) return running;
  const controller = new AbortController();
  const job = {
    id: next++, kind, key, label, queue, status: queue ? 'queued' : 'running', progress: 0, message: queue ? 'Waiting for the jobs before it' : '',
    result: null, error: null, detail: null, queuedAt: Date.now(), startedAt: Date.now(), endedAt: null, controller, lines: [], logFile: null,
  };
  job.log = (text) => {
    for (const line of String(text).split(/\r?\n/)) job.lines.push(`${stamp()}  ${line}`);
    if (job.lines.length > KEEP_LINES) job.lines.splice(0, job.lines.length - KEEP_LINES);
    append(job.logFile, text);
  };
  jobs.set(job.id, job);
  console.log(`job ${job.id} ${key} ${queue ? 'queued' : 'started'}`);
  const before = queue ? queues.get(queue) ?? Promise.resolve() : Promise.resolve();
  const settled = before
    .then(() => {
      if (controller.signal.aborted) throw Object.assign(new Error('Stopped'), { code: 'stopped' });
      if (queue) {
        Object.assign(job, { status: 'running', message: '', startedAt: Date.now() });
        console.log(`job ${job.id} ${key} started`);
      }
      return work(job, controller.signal);
    })
    .then((result) => {
      // The last step's words ("Joining") would read as still going next to "Done".
      Object.assign(job, { status: 'done', progress: 1, result, endedAt: Date.now(), message: 'Finished' });
      job.log(`Finished in ${seconds(job)}`);
      console.log(`job ${job.id} ${key} finished in ${seconds(job)}`);
    })
    .catch((err) => {
      const stopped = err?.code === 'stopped';
      Object.assign(job, {
        status: stopped ? 'stopped' : 'failed', error: err?.message ?? String(err), detail: err?.detail ?? err?.stack ?? null, endedAt: Date.now(),
        ...(stopped ? { message: 'Stopped' } : {}),
      });
      job.log(stopped ? `Stopped after ${seconds(job)}` : `FAILED after ${seconds(job)}\n${job.detail ?? job.error}`);
      if (stopped) console.log(`job ${job.id} ${key} stopped`);
      else console.error(`job ${job.id} ${key} failed after ${seconds(job)}:`, err?.detail ? `${err.message}\n${err.detail}` : err);
    });
  if (queue) queues.set(queue, settled);
  while (jobs.size > KEEP) {
    const oldest = [...jobs.values()].find((j) => !active(j));
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
  if (job && active(job)) {
    job.controller.abort();
    // A job still waiting is stopped at once (it is skipped when its turn comes).
    if (job.status === 'queued') Object.assign(job, { status: 'stopped', error: 'Stopped', endedAt: Date.now() });
  }
  return job ?? null;
}

/** Every job kept, newest first. */
export const listJobs = () => [...jobs.values()].reverse();

/** How many jobs in the same queue are before this one and not finished. */
const ahead = (j) => (j.queue && j.status === 'queued' ? [...jobs.values()].filter((o) => o.queue === j.queue && o.id < j.id && active(o)).length : 0);

/** What the page sees of a job. */
export const jobView = (j) => j && {
  id: j.id, kind: j.kind, key: j.key, label: j.label, queue: j.queue, ahead: ahead(j), boot: BOOT, status: j.status, progress: Math.round(j.progress * 1000) / 1000, message: j.message,
  result: j.result, error: j.error, detail: j.detail, queuedAt: j.queuedAt, startedAt: j.startedAt, endedAt: j.endedAt, logFile: j.logFile,
};

/** The job's log: its file's last 64 kB when it has one, else the lines kept in memory. */
export async function jobLog(j) {
  const text = j.logFile ? await tail(j.logFile, 64 * 1024) : null;
  return text ?? j.lines.join('\n');
}
