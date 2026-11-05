// Settings → Tracking tools: shows whether shuttle tracking, Find players and
// voice removal are ready, says up front what they need (an NVIDIA card, room
// on the drive), and sets them up or removes them (lib/analysis-setup.js).

import { h, fill } from './dom.js';
import { api, waitJob } from './api.js';
import { icon } from './icons.js';

const gb = (bytes) => `${(bytes / 1e9).toFixed(bytes < 10e9 ? 1 : 0)} GB`;

/** The panel for the page's folder box `folder`: { element, refresh } (refresh after saving settings). */
export function analysisPanel({ folder, progressBar, errorNotice }) {
  const box = h('div', { class: 'stack' });
  const msg = h('div', {});
  const follow = async (job) => {
    const bar = h('div', {});
    const stop = h('button', { type: 'button', class: 'small danger', onclick: () => api(`/api/jobs/${job.id}/stop`, { method: 'POST' }).catch(() => {}) }, icon('stop', 14), 'Stop');
    fill(box, h('p', { class: 'hint' }, 'You can keep using the app, or close this page. If it stops, Set up carries on from where it got to.'), bar, h('div', { class: 'row' }, stop));
    fill(msg);
    try {
      const done = await waitJob(job, (j) => fill(bar, progressBar(j)));
      fill(msg, h('div', { class: 'notice ok' }, done?.gpu ? `Set up. These tools will use the ${done.gpu}.` : 'Set up, but no NVIDIA card was found, so these tools will run on the processor, very slowly.'));
    } catch (err) {
      if (err.code === 'stopped') fill(msg, h('p', { class: 'hint' }, 'Stopped. Set up carries on from where it got to.'));
      else fill(msg, errorNotice(err));
    }
    draw();
  };
  const start = async (a) => {
    if (!a.gpu && !confirm('No NVIDIA graphics card was found. Without one, tracking a single match can take hours. Set up anyway?')) return;
    try {
      follow(await api('/api/analysis/setup', { method: 'POST', body: { folder: folder.value } }));
    } catch (err) {
      fill(msg, errorNotice(err));
    }
  };
  const remove = async (a) => {
    if (!confirm(`Remove the tracking tools from ${a.folder}? Tracks and players already found stay, and you can set the tools up again.`)) return;
    try {
      await api('/api/analysis', { method: 'DELETE' });
      fill(msg, h('p', { class: 'hint' }, 'Removed.'));
    } catch (err) {
      fill(msg, errorNotice(err));
    }
    draw();
  };
  async function draw() {
    let a;
    try {
      a = await api('/api/analysis');
    } catch (err) {
      fill(box, errorNotice(err));
      return;
    }
    folder.placeholder = a.defaultFolder;
    if (a.job?.status === 'running' || a.job?.status === 'queued') {
      follow(a.job);
      return;
    }
    if (!a.supported) {
      fill(box, h('p', { class: 'hint' }, 'These tools can only be set up on Windows.'));
      return;
    }
    const ready = a.ready.tracking && a.ready.players && a.ready.voices;
    if (ready && !a.unfinished) {
      fill(box,
        h('div', { class: 'notice ok' }, `Ready${a.gpu ? `, using the ${a.gpu.name}` : ''}. Shuttle tracking, Find players and voice removal all work.`),
        a.gpu ? null : h('div', { class: 'notice warn' }, 'No NVIDIA graphics card found, so these tools run on the processor, which can take hours for one match.'),
        a.madeHere ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'small', onclick: () => remove(a) }, 'Remove them')) : null);
      return;
    }
    const short = !a.unfinished && a.freeBytes !== null && a.freeBytes < a.needBytes;
    fill(box,
      a.gpu
        ? h('p', { class: 'hint' }, `This PC has an ${a.gpu.name}, which these tools can use.`)
        : h('div', { class: 'notice warn' }, 'No NVIDIA graphics card found. These tools are made for one: without it, tracking a single match can take hours. Everything else in the app works without them.'),
      short ? h('div', { class: 'notice bad' }, `That drive has ${gb(a.freeBytes)} free and the set-up needs about ${gb(a.needBytes)}. Choose a folder on another drive below.`) : null,
      h('p', { class: 'hint' }, 'Downloads about 3.5 GB and keeps about 6 GB on the drive. Usually 10 to 30 minutes, depending on your connection. Nothing else needs installing.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary small', disabled: short, onclick: () => start(a) }, icon('download', 14), a.unfinished ? 'Carry on setting up' : 'Set up')));
  }
  draw();
  return { element: h('div', {}, box, msg), refresh: draw };
}
