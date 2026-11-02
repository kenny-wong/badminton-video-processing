// #/jobs: every background job of this server run (rendering, tracking,
// finding rallies, scanning), with progress, Stop and the job's log. Renders
// and tracking take turns on the graphics card; the others wait as queued.
// Also the header's job counter, which shows while any job is running.

import { h, fill } from './dom.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { errorNotice } from './notice.js';
import { goBack } from './nav.js';

const STATUS = { running: ['Running', 'warn'], queued: ['Waiting', ''], done: ['Done', 'ok'], failed: ['Failed', 'bad'], stopped: ['Stopped', ''] };
const KIND = { render: 'Render', track: 'Shuttle tracking', analyse: 'Find rallies', scan: 'Scan folders', reel: 'Highlight reel', clip: 'Clip', people: 'Find players', merge: 'Merge videos', split: 'Split a video' };

const time = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const took = (j) => {
  const s = Math.round(((j.endedAt ?? Date.now()) - j.startedAt) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};
/** The match a job is about ("render:249" -> 249). */
const matchOf = (j) => (/^(render|track|analyse|prepare):(\d+)$/.exec(j.key)?.[2] ?? null);

export async function renderJobs(main) {
  document.title = 'Jobs · Badminton Video';
  const table = h('div');
  const logBox = h('div');
  let timer = null;

  const showLog = async (j) => {
    try {
      const r = await api(`/api/jobs/${j.id}/log`);
      fill(logBox, h('div', { class: 'card stack' }, h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, `Log of job ${j.id}`),
        h('button', { class: 'small', onclick: () => fill(logBox) }, 'Close')), h('pre', { class: 'notice-log' }, r.text || '(empty)')));
    } catch (err) {
      fill(logBox, errorNotice(err));
    }
  };

  const draw = async () => {
    let jobs;
    try {
      ({ jobs } = await api('/api/jobs'));
    } catch (err) {
      fill(table, errorNotice(err));
      return;
    }
    fill(table, jobs.length ? h('div', { class: 'table-scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Job', 'Status', 'Progress', 'Started', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, jobs.map((j) => {
        const [label, tone] = STATUS[j.status] ?? [j.status, ''];
        const match = matchOf(j);
        return h('tr', {},
          h('td', {}, h('div', {}, j.label || KIND[j.kind] || j.kind), h('div', { class: 'small muted' }, `${KIND[j.kind] ?? j.kind} · job ${j.id}`)),
          h('td', {}, h('span', { class: `pill ${tone}` }, label), j.status === 'queued' && j.ahead ? h('div', { class: 'small muted' }, `${j.ahead} before it`) : null),
          h('td', { style: { minWidth: '220px' } },
            j.status === 'running' ? h('div', { class: 'progress' }, h('span', { style: { width: `${Math.round(j.progress * 100)}%` } })) : null,
            h('div', { class: 'small muted' }, j.status === 'failed' ? h('span', { class: 'side-b' }, j.error) : j.message || '')),
          h('td', { class: 'nowrap small' }, time(j.status === 'queued' ? j.queuedAt : j.startedAt), j.status !== 'queued' ? h('div', { class: 'muted' }, took(j)) : null),
          h('td', { class: 'nowrap' },
            j.status === 'running' || j.status === 'queued' ? h('button', { class: 'small danger', onclick: async () => { await api(`/api/jobs/${j.id}/stop`, { method: 'POST' }); draw(); } }, 'Stop') : null, ' ',
            h('button', { class: 'small', onclick: () => showLog(j) }, 'Log'), ' ',
            match ? h('a', { class: 'btn small', href: `#/m/${match}` }, 'Match') : null));
      }))))
      : h('div', { class: 'empty' }, icon('list', 34), h('div', {}, 'No jobs since the app started.')));
    if (jobs.some((j) => j.status === 'running' || j.status === 'queued')) timer = setTimeout(draw, 1500);
  };

  fill(main,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Jobs'), h('div', { class: 'sub' }, 'Background work since the app started. Renders and shuttle tracking take turns on the graphics card.')),
      h('div', { class: 'row' }, h('button', { onclick: () => api('/api/log/open', { method: 'POST' }).catch(() => {}) }, icon('folder', 16), 'App log'),
        // Back to the page the Jobs page was opened from (the Tournaments page when it was opened first).
        h('button', { title: 'Close the Jobs page and go back to the page before', onclick: () => goBack('#/') }, icon('close', 16), 'Close'))),
    table, logBox);
  await draw();
  return () => clearTimeout(timer);
}

/** The header's "2 jobs" link, kept up to date while anything runs. */
export function watchJobs(link) {
  const check = async () => {
    let n = 0;
    try {
      n = (await api('/api/jobs')).jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
    } catch { /* server restarting */ }
    link.hidden = !n;
    fill(link, icon('list', 15), `${n} job${n === 1 ? '' : 's'}`);
    setTimeout(check, n ? 2000 : 6000);
  };
  check();
}
