// #/tools: merging videos end to end in an order you choose, and splitting one
// video into up to three. The picture and sound are copied as they are and
// the originals are never edited; unless unticked, they go to the Recycle Bin
// once the new files are made (lib/video-tools.js does the work).
// #/tools?split=<video id> opens the splitter on that video.
//
// Splitter keys: Space play / pause, ← / → 2 s (Shift 10 s), , / . one frame,
// 1 / 2 / 3 choose the part, I / O the part starts / ends here. The mouse
// wheel over the picture or the bar moves 1 s a notch (Shift: one frame).

import { h, fill, when, megabytes } from './dom.js';
import { api, waitJob } from './api.js';
import { icon } from './icons.js';
import { errorNotice } from './notice.js';
import { clock } from './shared/time.js';
import { MAX_PARTS, cleanParts, mergeProblems, mergedName, overlaps, parseTime, snapStart, splitName, timeText } from './shared/video-files.js';

const TAB_KEY = 'badminton-video:tools-tab:v1';
const MODES = { merge: 'Merge videos', split: 'Split a video' };
const PART_KEYS = [
  ['Space', 'play / pause'],
  ['I / O', 'this part starts / ends here'],
  ['1 / 2 / 3', 'choose the part'],
  ['← / →', 'back / on 2 s (Shift: 10 s)'],
  [', / .', 'one frame back / on'],
  ['Mouse wheel', 'on the picture or bar: 1 s a notch (Shift: one frame)'],
];

// What you were doing, kept while the window is open: the merge order and each video's parts.
const memory = { order: [], parts: new Map(), splitId: null, removeOriginal: true };

function readTab() {
  try {
    return Object.hasOwn(MODES, localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'merge';
  } catch {
    return 'merge';
  }
}
function writeTab(tab) {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch { /* storage blocked: Merge opens first next time */ }
}

/** "12:13:49" on the UK clock. */
const clockAt = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

const folderOf = (path) => path.split(/[\\/]/).slice(0, -1).join('\\');

const reveal = (v) => api(`/api/videos/${v.id}/reveal`, { method: 'POST' }).catch(() => {});

/** The "Remove the original" tick box (ticked unless you untick it this session). */
const removeBox = (text) => {
  const box = h('input', { type: 'checkbox', checked: memory.removeOriginal, onchange: () => { memory.removeOriginal = box.checked; } });
  return { box, label: h('label', { class: 'tool-check' }, box, text) };
};

function notesView(notes) {
  return notes?.length ? h('div', { class: 'notice warn small' }, h('div', { class: 'stack' }, notes.map((n) => h('div', {}, n)))) : null;
}

const removedView = (removed) => (removed?.length ? h('div', { class: 'small' }, icon('trash', 14), ` Moved to the Recycle Bin: ${removed.map((v) => v.name).join(', ')}`) : null);

/** Takes removed originals ([{ id }]) off the page's lists. */
function forget(library, byId, removed) {
  for (const { id } of removed ?? []) {
    const i = library.findIndex((v) => v.id === id);
    if (i >= 0) library.splice(i, 1);
    byId.delete(id);
    memory.parts.delete(id);
    memory.order = memory.order.filter((x) => x !== id);
  }
}

export async function renderTools(main, { runJob, refresh, query }) {
  document.title = 'Tools · Badminton Video';
  const { videos: all } = await api('/api/videos');
  const library = all.filter((v) => !v.missing);
  const byId = new Map(library.map((v) => [v.id, v]));
  memory.order = memory.order.filter((id) => byId.has(id));
  const asked = Number(query.get('split'));
  if (byId.has(asked)) memory.splitId = asked;
  let mode = byId.has(asked) ? 'split' : readTab();
  let leaveView = null;
  const body = h('div');

  const buttons = Object.entries(MODES).map(([key, label]) => h('button', {
    type: 'button',
    'aria-pressed': String(key === mode),
    onclick: () => {
      mode = key;
      writeTab(key);
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === key));
      show();
    },
    'data-mode': key,
  }, icon(key === 'merge' ? 'link' : 'scissors', 16), label));

  function show() {
    leaveView?.();
    leaveView = mode === 'merge' ? mergeView(body, library, byId, runJob) : splitView(body, library, byId, runJob);
  }

  fill(main,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Tools'), h('div', { class: 'sub' }, 'Join videos end to end, or cut one into parts. The picture and sound are copied exactly and the phone’s details and times are kept. The originals are never edited; unless you untick the box, they go to the Recycle Bin once the new files are made.')),
      h('div', { class: 'row' }, h('div', { class: 'segmented', role: 'group', 'aria-label': 'Tool' }, buttons), refresh.button)),
    refresh.notice, refresh.box,
    library.length ? body : h('div', { class: 'empty' }, icon('match-video', 34), h('div', {}, 'No videos yet. Add your video folders in ', h('a', { href: '#/settings' }, 'Settings'), ', then click Refresh from folders.')));
  if (library.length) show();
  return () => leaveView?.();
}

// ---------- Merge ----------

function mergeView(box, library, byId, runJob) {
  const search = h('input', { type: 'search', placeholder: 'Find a video by name or date', 'aria-label': 'Find a video' });
  const pickList = h('div', { class: 'pick-list' });
  const orderList = h('ol', { class: 'order-list' });
  const summary = h('div');
  const jobBox = h('div');
  const result = h('div');
  const { box: removeTick, label: removeLabel } = removeBox('Remove the original videos once the merged video is made and checked (they go to the Recycle Bin)');
  const mergeBtn = h('button', { class: 'primary', type: 'button' }, icon('link', 16), 'Merge');
  let dragFrom = null;

  const chosen = () => memory.order.map((id) => byId.get(id));

  function drawPicks() {
    const q = search.value.trim().toLowerCase();
    const shown = library.filter((v) => !q || `${v.name} ${when(v.recordedAt)}`.toLowerCase().includes(q));
    fill(pickList, shown.length ? shown.map((v) => {
      const added = memory.order.includes(v.id);
      return h('div', { class: `pick${added ? ' added' : ''}` },
        h('button', {
          class: 'small', type: 'button', disabled: added, title: added ? 'Already in the merge order' : 'Add to the end of the merge order',
          onclick: () => { memory.order.push(v.id); draw(); },
        }, added ? icon('check', 14) : icon('plus', 14), added ? 'Added' : 'Add'),
        h('div', { class: 'grow' },
          h('div', { class: 'ellipsis', title: v.path }, v.name),
          h('div', { class: 'small muted' }, `${when(v.recordedAt)} · ${clock(v.duration ?? 0)} · ${megabytes(v.size)} · ${v.width}×${v.height} ${v.codec ?? ''}`)));
    }) : h('p', { class: 'muted small pad' }, 'No video matches that.'));
  }

  const move = (from, to) => {
    const [id] = memory.order.splice(from, 1);
    memory.order.splice(to, 0, id);
    draw();
  };

  function drawOrder() {
    const list = chosen();
    fill(orderList, list.map((v, i) => h('li', {
      draggable: 'true',
      ondragstart: (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
      ondragend: (e) => { e.currentTarget.classList.remove('dragging'); dragFrom = null; },
      ondragover: (e) => { if (dragFrom !== null) { e.preventDefault(); e.currentTarget.classList.add('drop-here'); } },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-here'),
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-here'); if (dragFrom !== null && dragFrom !== i) move(dragFrom, i); },
    },
    h('span', { class: 'n', title: 'Drag to change the order' }, String(i + 1)),
    h('div', { class: 'grow' },
      h('div', { class: 'ellipsis', title: v.path }, v.name),
      h('div', { class: 'small muted ellipsis', title: v.path }, `${when(v.recordedAt)} · ${clock(v.duration ?? 0)} · ${megabytes(v.size)} · ${folderOf(v.path)}`)),
    h('button', { class: 'small ghost icon-only', type: 'button', title: 'Earlier', 'aria-label': `Move ${v.name} earlier`, disabled: i === 0, onclick: () => move(i, i - 1) }, '↑'),
    h('button', { class: 'small ghost icon-only', type: 'button', title: 'Later', 'aria-label': `Move ${v.name} later`, disabled: i === list.length - 1, onclick: () => move(i, i + 1) }, '↓'),
    h('button', { class: 'small ghost icon-only', type: 'button', title: 'Take out', 'aria-label': `Take ${v.name} out`, onclick: () => { memory.order.splice(i, 1); draw(); } }, '✕'))));
    if (!list.length) orderList.append(h('li', { class: 'empty-row muted small' }, 'Add videos from the list. They are joined in this order; drag them or use ↑ ↓ to change it.'));
  }

  function drawSummary() {
    const list = chosen();
    const problems = list.length ? mergeProblems(list) : [];
    const total = list.reduce((sum, v) => sum + (v.duration ?? 0), 0);
    const size = list.reduce((sum, v) => sum + v.size, 0);
    const inOrder = list.every((v, i) => i === 0 || (v.recordedAt ?? '') >= (list[i - 1].recordedAt ?? ''));
    mergeBtn.disabled = list.length < 2 || problems.length > 0;
    fill(summary, list.length ? h('div', { class: 'stack' },
      h('div', { class: 'row small' },
        h('span', {}, h('b', {}, `${list.length} video${list.length === 1 ? '' : 's'}`), ` · ${clock(total)} · ${megabytes(size)}`),
        list.length > 1 && !inOrder ? h('span', { class: 'pill warn' }, 'not in recording order') : null,
        list.length > 1 ? h('button', { class: 'small', type: 'button', onclick: () => { memory.order.sort((a, b) => String(byId.get(a).recordedAt).localeCompare(String(byId.get(b).recordedAt))); draw(); } }, 'Sort by recording time') : null,
        h('button', { class: 'small ghost', type: 'button', onclick: () => { memory.order = []; draw(); } }, 'Clear')),
      problems.length ? h('div', { class: 'notice warn small' }, h('div', { class: 'stack' }, problems.map((p) => h('div', {}, p)))) : null,
      list.length > 1 && !problems.length ? h('p', { class: 'hint' }, 'Saved as ', h('b', {}, mergedName(list[0].name)), ` next to ${list[0].name}. It starts with ${list[0].name}’s details and start time and ends with ${list.at(-1).name}’s end time; nothing is re-encoded.`) : null) : null);
  }

  function draw() {
    drawPicks();
    drawOrder();
    drawSummary();
  }

  mergeBtn.addEventListener('click', async () => {
    mergeBtn.disabled = true;
    fill(result);
    try {
      const r = await runJob(jobBox, () => api('/api/tools/merge', { method: 'POST', body: { ids: memory.order, removeOriginal: removeTick.checked } }));
      fill(jobBox);
      fill(result, h('div', { class: 'notice ok' }, h('div', { class: 'stack' },
        h('div', { class: 'row' },
          icon('check', 18), h('span', {}, 'Saved ', h('b', {}, r.video.name), ` (${clock(r.video.duration ?? 0)}, ${megabytes(r.video.size)})`),
          h('button', { class: 'small', type: 'button', onclick: () => reveal(r.video) }, icon('folder', 14), 'Show in Explorer'),
          h('a', { href: '#/videos', class: 'btn small' }, 'See videos')),
        removedView(r.removed))),
      notesView(r.notes));
      forget(library, byId, r.removed);
      library.unshift(r.video);
      byId.set(r.video.id, r.video);
      memory.order = [];
      draw();
    } catch (err) {
      fill(jobBox);
      fill(result, errorNotice(err));
      drawSummary();
    }
  });

  search.addEventListener('input', drawPicks);
  fill(box, h('div', { class: 'tools-grid' },
    h('div', { class: 'card stack' }, h('h3', { class: 'card-title' }, icon('match-video', 18), 'Videos'), search, pickList),
    h('div', { class: 'card stack' }, h('h3', { class: 'card-title' }, icon('list', 18), 'Merge order'), orderList, summary, removeLabel,
      h('div', { class: 'row' }, mergeBtn), jobBox, result)));
  draw();
  return null;
}

// ---------- Split ----------

function splitView(box, library, byId, runJob) {
  const picker = h('select', { class: 'video-pick', 'aria-label': 'Video to split' },
    h('option', { value: '' }, 'Choose a video…'),
    library.map((v) => h('option', { value: String(v.id) }, `${when(v.recordedAt)} · ${v.name} · ${clock(v.duration ?? 0)}`)));
  const area = h('div');
  let leave = null;
  picker.addEventListener('change', () => {
    memory.splitId = Number(picker.value) || null;
    open();
  });
  function open() {
    leave?.();
    leave = null;
    const v = byId.get(memory.splitId);
    picker.value = v ? String(v.id) : '';
    if (!v) {
      fill(area, h('p', { class: 'hint' }, 'Choose the video to cut. You can make up to three parts; each is saved as its own video next to the original, named and timed from where it starts.'));
      return;
    }
    leave = splitter(area, v, byId, runJob, library, (removed) => {
      forget(library, byId, removed);
      for (const { id } of removed) picker.querySelector(`option[value="${id}"]`)?.remove();
      memory.splitId = null;
      picker.value = '';
    });
  }
  fill(box, h('div', { class: 'card stack' }, h('div', { class: 'row' }, h('label', { class: 'cf-label' }, 'Video'), picker), area));
  open();
  return () => leave?.();
}

function splitter(area, video, byId, runJob, library, onRemoved) {
  const parts = memory.parts.get(video.id) ?? Array.from({ length: MAX_PARTS }, () => ({ start: null, end: null }));
  memory.parts.set(video.id, parts);
  let active = Math.max(0, parts.findIndex((p) => p.start === null || p.end === null));
  let keys = null;
  const fps = video.fps || 30;
  const player = h('video', { src: `/media/video/${video.id}`, preload: 'auto', playsinline: true });
  const flash = h('div', { class: 'flash', hidden: true });
  const playBtn = h('button', { class: 'play-btn', type: 'button', 'aria-label': 'Play or pause', onclick: () => toggle() }, icon('play', 18));
  const timeShow = h('span', { class: 'time' });
  const bar = h('div', { class: 'timeline split-bar', title: 'Click or drag to move; the mouse wheel moves 1 s a notch' });
  const head = h('div', { class: 'head' });
  const rows = h('tbody');
  const keyNote = h('span', { class: 'small muted' }, 'Finding key frames…');
  const summary = h('div');
  const jobBox = h('div');
  const result = h('div');
  const { box: removeTick, label: removeLabel } = removeBox('Remove the original video once the parts are made (it goes to the Recycle Bin, with anything outside the parts)');
  const splitBtn = h('button', { class: 'primary', type: 'button' }, icon('scissors', 16), 'Split');
  const duration = () => (Number.isFinite(player.duration) ? player.duration : video.duration ?? 0);
  const recorded = video.recordedAt ? Date.parse(video.recordedAt) : null;
  let flashTimer = null;

  const say = (text) => {
    flash.textContent = text;
    flash.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash.hidden = true; }, 1200);
  };
  const seek = (t) => { player.currentTime = Math.max(0, Math.min(duration(), t)); };
  function toggle() {
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  }

  const fromOf = (p) => (keys && p.start !== null ? snapStart(keys, p.start) : p.start);

  function setPoint(which, t = player.currentTime) {
    const p = parts[active];
    p[which] = Math.round(t * 1000) / 1000;
    say(`Part ${active + 1} ${which === 'start' ? 'starts' : 'ends'} at ${timeText(t)}`);
    draw();
  }

  function choose(i) {
    active = i;
    say(`Part ${i + 1}`);
    draw();
  }

  function drawBar() {
    const d = duration() || 1;
    const pct = (t) => `${(Math.max(0, Math.min(d, t)) / d) * 100}%`;
    const segs = [];
    parts.forEach((p, i) => {
      const cls = `seg p${i + 1}${i === active ? ' active' : ''}`;
      if (p.start !== null && p.end !== null && p.end > p.start) {
        const from = fromOf(p);
        if (from < p.start - 0.02) segs.push(h('div', { class: `${cls} lead`, style: { left: pct(from), width: `calc(${pct(p.start)} - ${pct(from)})` }, title: 'From the key frame before the start' }));
        segs.push(h('div', { class: cls, style: { left: pct(p.start), width: `calc(${pct(p.end)} - ${pct(p.start)})` } }, h('span', {}, String(i + 1))));
      } else if (p.start !== null || p.end !== null) {
        segs.push(h('div', { class: `${cls} mark`, style: { left: pct(p.start ?? p.end) } }));
      }
    });
    fill(bar, segs, head);
    drawHead();
  }

  function drawHead() {
    const d = duration() || 1;
    head.style.left = `${(player.currentTime / d) * 100}%`;
    timeShow.textContent = `${timeText(player.currentTime)} / ${timeText(duration())}`;
  }

  const timeInput = (i, which) => {
    const p = parts[i];
    const input = h('input', { class: 'time-input', type: 'text', inputmode: 'decimal', value: p[which] === null ? '' : timeText(p[which]), placeholder: '–:––.––', 'aria-label': `Part ${i + 1} ${which}` });
    input.addEventListener('change', () => {
      const t = input.value.trim() === '' ? null : parseTime(input.value);
      if (t === null && input.value.trim() !== '') { input.value = p[which] === null ? '' : timeText(p[which]); return; }
      p[which] = t === null ? null : Math.min(t, duration());
      active = i;
      draw();
    });
    input.addEventListener('focus', () => { if (active !== i) { active = i; drawBar(); markActive(); } });
    return input;
  };

  function markActive() {
    [...rows.children].forEach((tr, i) => tr.classList.toggle('active', i === active));
  }

  function drawRows() {
    fill(rows, parts.map((p, i) => {
      const set = p.start !== null && p.end !== null;
      const from = fromOf(p);
      const early = set && keys && p.start - from > 0.02;
      const len = set ? p.end - (from ?? p.start) : null;
      return h('tr', { class: i === active ? 'active' : '', onclick: (e) => { if (!e.target.closest('input, button') && active !== i) { active = i; drawBar(); markActive(); } } },
        h('td', {}, h('button', { class: 'small part-pick', type: 'button', title: `Choose part ${i + 1} (key ${i + 1})`, onclick: () => choose(i) }, h('i', { class: `swatch p${i + 1}` }), `Part ${i + 1}`)),
        h('td', {}, h('div', { class: 'row tight' }, timeInput(i, 'start'),
          h('button', { class: 'small', type: 'button', title: 'Starts at the current time (I)', onclick: () => { active = i; setPoint('start'); } }, 'Set (I)'),
          p.start !== null ? h('button', { class: 'small ghost', type: 'button', title: 'Go to the start', onclick: () => seek(from ?? p.start) }, 'Go') : null),
          early ? h('div', { class: 'small muted' }, `From the key frame at ${timeText(from)} (${(p.start - from).toFixed(2)} s earlier)`) : null),
        h('td', {}, h('div', { class: 'row tight' }, timeInput(i, 'end'),
          h('button', { class: 'small', type: 'button', title: 'Ends at the current time (O)', onclick: () => { active = i; setPoint('end'); } }, 'Set (O)'),
          p.end !== null ? h('button', { class: 'small ghost', type: 'button', title: 'Go to the end', onclick: () => seek(p.end) }, 'Go') : null)),
        h('td', { class: 'nowrap' }, len !== null && len > 0 ? clock(len) : '—'),
        h('td', { class: 'small' }, set && p.end > p.start ? [h('div', { class: 'ellipsis' }, splitName(video.name, from, i + 1)), recorded ? h('div', { class: 'muted' }, `Starts ${clockAt(recorded + from * 1000)}`) : null] : h('span', { class: 'muted' }, '—')),
        h('td', {}, p.start !== null || p.end !== null ? h('button', { class: 'small ghost icon-only', type: 'button', title: 'Clear this part', 'aria-label': `Clear part ${i + 1}`, onclick: () => { p.start = null; p.end = null; draw(); } }, '✕') : null));
    }));
  }

  function drawSummary() {
    const { parts: clean, problems } = cleanParts(parts, duration());
    const shown = parts.some((p) => p.start !== null || p.end !== null) ? problems : [];
    const over = overlaps(clean);
    splitBtn.disabled = problems.length > 0 || !keys;
    fill(summary,
      shown.length ? h('div', { class: 'notice warn small' }, h('div', { class: 'stack' }, shown.map((p) => h('div', {}, p)))) : null,
      over.length ? h('p', { class: 'hint' }, `Parts ${over.join(', ')} overlap: that’s allowed, each file gets its own copy.`) : null,
      clean.length && !problems.length ? h('p', { class: 'hint' }, `${clean.length} file${clean.length === 1 ? '' : 's'} will be saved next to ${video.name}. Each starts on a key frame (a lossless cut can only start on one) and gets its own times from where it starts in the original.`) : null);
  }

  function draw() {
    drawBar();
    drawRows();
    drawSummary();
  }

  // Seeking on the bar: click or drag.
  const seekAt = (e) => {
    const r = bar.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * duration());
  };
  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId);
    seekAt(e);
    const moveTo = (ev) => seekAt(ev);
    const up = () => { bar.removeEventListener('pointermove', moveTo); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', moveTo);
    bar.addEventListener('pointerup', up);
  });
  const wheel = (e) => {
    e.preventDefault();
    const d = e.deltaY || e.deltaX;
    if (!d) return;
    player.pause();
    seek(player.currentTime + Math.sign(d) * (e.shiftKey ? 1 / fps : 1));
  };
  bar.addEventListener('wheel', wheel, { passive: false });
  player.addEventListener('wheel', wheel, { passive: false });
  player.addEventListener('click', toggle);
  player.addEventListener('timeupdate', drawHead);
  player.addEventListener('seeked', drawHead);
  player.addEventListener('loadedmetadata', draw);
  player.addEventListener('play', () => fill(playBtn, icon('pause', 18)));
  player.addEventListener('pause', () => fill(playBtn, icon('play', 18)));
  let raf = 0;
  const tick = () => { if (!player.paused) drawHead(); raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);

  function onKey(e) {
    if (e.target.closest?.('input, textarea, select')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    switch (key) {
      case ' ': toggle(); break;
      case 'ArrowLeft': seek(player.currentTime - (e.shiftKey ? 10 : 2)); break;
      case 'ArrowRight': seek(player.currentTime + (e.shiftKey ? 10 : 2)); break;
      case ',': player.pause(); seek(player.currentTime - 1 / fps); break;
      case '.': player.pause(); seek(player.currentTime + 1 / fps); break;
      case '1': case '2': case '3': choose(Number(key) - 1); break;
      case 'i': setPoint('start'); break;
      case 'o': setPoint('end'); break;
      default: return;
    }
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);

  splitBtn.addEventListener('click', async () => {
    splitBtn.disabled = true;
    fill(result);
    const removing = removeTick.checked;
    const at = player.currentTime;
    if (removing) {
      // Let go of the file, so Windows can move it to the Recycle Bin.
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    try {
      const body = { id: video.id, parts: parts.map((p) => ({ start: p.start, end: p.end })), removeOriginal: removing };
      const r = await runJob(jobBox, () => api('/api/tools/split', { method: 'POST', body }));
      fill(jobBox);
      fill(result, h('div', { class: 'notice ok' }, h('div', { class: 'stack' },
        h('div', {}, icon('check', 18), ` Saved ${r.parts.length} file${r.parts.length === 1 ? '' : 's'}`),
        r.parts.map((p) => h('div', { class: 'row' },
          h('span', {}, h('b', {}, p.video.name), ` · ${clock(p.length)} · ${megabytes(p.video.size)}`),
          h('button', { class: 'small', type: 'button', onclick: () => reveal(p.video) }, icon('folder', 14), 'Show in Explorer'))),
        removedView(r.removed),
        h('div', {}, h('a', { href: '#/videos', class: 'btn small' }, 'See videos')))),
      notesView(r.notes));
      for (const p of r.parts) {
        library.unshift(p.video);
        byId.set(p.video.id, p.video);
      }
      if (r.removed?.length) {
        // The original is gone: only the outcome stays on the page.
        leave();
        onRemoved(r.removed);
        fill(area, result);
        return;
      }
      if (removing) restore();
      drawSummary();
    } catch (err) {
      fill(jobBox);
      fill(result, errorNotice(err));
      if (removing) restore();
      drawSummary();
    }
    function restore() {
      player.src = `/media/video/${video.id}`;
      player.addEventListener('loadedmetadata', () => { player.currentTime = at; }, { once: true });
    }
  });

  fill(area,
    h('div', { class: 'player' }, player, flash),
    h('div', { class: 'transport' }, playBtn, timeShow, keyNote),
    bar,
    h('div', { class: 'keys' }, PART_KEYS.map(([k, what]) => h('span', {}, h('kbd', {}, k), ' ', what))),
    h('div', { class: 'table-scroll' }, h('table', { class: 'parts' },
      h('thead', {}, h('tr', {}, ['', 'Start', 'End', 'Length', 'Saved as', ''].map((x) => h('th', {}, x)))),
      rows)),
    summary, removeLabel, h('div', { class: 'row' }, splitBtn), jobBox, result);
  draw();

  api(`/api/videos/${video.id}/keyframes`).then((r) => {
    keys = r.keys;
    const gap = keys.length > 1 ? (keys.at(-1) - keys[0]) / (keys.length - 1) : 0;
    keyNote.textContent = keys.length ? `Key frames about every ${gap.toFixed(1)} s` : 'No key frames found';
    draw();
  }).catch((err) => {
    fill(keyNote, h('span', { class: 'pill bad' }, 'Key frames unknown'), ' ', err.message);
  });

  function leave() {
    window.removeEventListener('keydown', onKey);
    cancelAnimationFrame(raf);
    clearTimeout(flashTimer);
    player.pause();
    player.removeAttribute('src');
    player.load();
  }
  return leave;
}
