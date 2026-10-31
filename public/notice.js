// The red box for an error: one line saying what went wrong, and a Details
// section (closed at first) with the longer story, the job's log, buttons to
// open the log file in Explorer and to copy everything for a bug report.

import { h, fill } from './dom.js';
import { api } from './api.js';

const time = (ms) => (ms ? new Date(ms).toLocaleString('en-GB') : null);

/** The plain-text details of an error from api() / waitJob(). */
export function errorDetails(err, now = Date.now()) {
  const job = err.job;
  return [
    err.detail,
    err.request ? `Request: ${err.request}${err.status ? ` → HTTP ${err.status}` : ''}${err.code && err.code !== 'failed' ? ` (${err.code})` : ''}` : null,
    job ? `Job ${job.id}: ${job.key}, started ${time(job.startedAt)}${job.endedAt ? `, ended ${time(job.endedAt)} (${Math.round((job.endedAt - job.startedAt) / 1000)} s)` : ''}` : null,
    job?.logFile ? `Log file: ${job.logFile}` : null,
    `Shown at ${time(now)}`,
  ].filter(Boolean).join('\n');
}

export function errorNotice(err) {
  const message = err?.message || String(err);
  const details = errorDetails(err ?? {});
  const job = err?.job;
  const logBox = h('pre', { class: 'notice-log', hidden: true });
  const say = h('span', { class: 'small' });
  const showLog = job ? h('button', {
    class: 'small',
    onclick: async () => {
      if (!logBox.hidden) {
        logBox.hidden = true;
        showLog.textContent = 'Show log';
        return;
      }
      try {
        const { text } = await api(`/api/jobs/${job.id}/log`);
        logBox.textContent = text || '(The log is empty.)';
      } catch (e) {
        logBox.textContent = `Couldn’t load the log: ${e.message}`;
      }
      logBox.hidden = false;
      logBox.scrollTop = logBox.scrollHeight;
      showLog.textContent = 'Hide log';
    },
  }, 'Show log') : null;
  // The job's own log file when it has one, else the app's log. Not when the server can't be reached.
  const openLog = err?.code === 'offline' ? null : h('button', {
    class: 'small',
    onclick: () => api(job?.logFile ? `/api/jobs/${job.id}/log/open` : '/api/log/open', { method: 'POST' })
      .then((r) => fill(say, `Opened ${r.path}`))
      .catch((e) => fill(say, e.message)),
  }, job?.logFile ? 'Open log file' : 'Open app log');
  const copy = h('button', {
    class: 'small',
    onclick: () => navigator.clipboard.writeText(`${message}\n\n${details}${logBox.hidden ? '' : `\n\n${logBox.textContent}`}`)
      .then(() => fill(say, 'Copied'))
      .catch(() => fill(say, 'Couldn’t copy')),
  }, 'Copy details');
  return h('div', { class: 'notice bad stack' },
    h('div', { class: 'notice-msg', title: err?.detail ? err.detail.split('\n')[0] : null }, message),
    h('details', { class: 'notice-more' },
      h('summary', {}, 'Details'),
      h('pre', { class: 'notice-detail' }, details),
      h('div', { class: 'row' }, showLog, openLog, copy, say),
      logBox));
}
