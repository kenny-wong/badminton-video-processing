// The match editor (#/m/<id>): play the match video, tag each rally's start,
// end and winner from the keyboard (or accept rallies found by sound and just
// say who won), watch the score build up, and render the edited video.

import { h, fill, day, gamesView } from './dom.js';
import { api, waitJob } from './api.js';
import { boardNames, teamName } from './shared/names.js';
import { assumedStart, CAPS, checkResult, cleanFormat, cleanStart, gamesText, mergeWinners, parseGames, replay, scoreAt, startFor } from './shared/score.js';
import { clock, clockTenths } from './shared/time.js';
import { apply, CORNER_NAMES, courtLines, courtMapping } from './shared/court.js';
import { icon } from './icons.js';
import { bannerText, boardFlags, boardHeading, CORNERS, PRESETS } from './shared/board.js';
import { boardPreview } from './board-preview.js';
import { percent, percents } from './shared/players.js';
import { landings, matchStats } from './shared/stats.js';
import { landingMap, momentumChart, saveSvgAsPng, statsTables } from './stats-view.js';
import { youtubePanel } from './youtube-panel.js';

const TAB_KEY = 'badminton-video:editor-tab:v1';
const readTab = () => {
  try {
    return localStorage.getItem(TAB_KEY) || 'rallies';
  } catch {
    return 'rallies';
  }
};
const writeTab = (t) => {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch { /* storage blocked */ }
};

// The keyboard shortcuts box is open unless it was closed last time.
const KEYS_KEY = 'badminton-video:keys-open:v1';
const readKeysOpen = () => {
  try {
    return localStorage.getItem(KEYS_KEY) !== '0';
  } catch {
    return true;
  }
};
const writeKeysOpen = (open) => {
  try {
    localStorage.setItem(KEYS_KEY, open ? '1' : '0');
  } catch { /* storage blocked */ }
};

// Black space around the video on the Tracking tab, in px, so corners outside the picture can be clicked.
const PAD_KEY = 'badminton-video:court-pad:v1';
const PAD_SIDES = [['top', 'Top', 300], ['right', 'Right', 400], ['bottom', 'Bottom', 300], ['left', 'Left', 400]];
const PAD_DEFAULT = { top: 50, right: 300, bottom: 50, left: 300 };
const readPad = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PAD_KEY) || '{}');
    return Object.fromEntries(PAD_SIDES.map(([k, , max]) => [k, Number.isFinite(saved[k]) ? Math.min(max, Math.max(0, saved[k])) : PAD_DEFAULT[k]]));
  } catch {
    return { ...PAD_DEFAULT };
  }
};
const writePad = (pad) => {
  try {
    localStorage.setItem(PAD_KEY, JSON.stringify(pad));
  } catch { /* storage blocked */ }
};

// Chrome plays from 1/16× to 16×, but mutes the sound below 0.25× and above 4×.
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 16];
const SAVE_DELAY_MS = 800;
const REVIEW_LEAD_S = 4; // reviewing a rally starts this long before its end
const UNDO_DEPTH = 100;
const VIEW_KEYS = new Set([' ', 'ArrowLeft', 'ArrowRight', ',', '.', '[', ']', '?', 'Escape']); // the keys that work on a cut render

const KEYS = [
  ['Space', 'play / pause'],
  ['S', 'rally starts now'],
  ['A / B', 'rally ends now, won by A / B (no S: it began 3 s after the last one)'],
  ['L', 'let (replayed, no point)'],
  ['N', 'next untagged rally'],
  ['↑ / ↓', 'previous / next rally'],
  ['← / →', 'back / on 2 s (Shift: 10 s)'],
  [', / .', 'one frame back / on'],
  ['[ / ]', 'slower / faster'],
  ['Q / E', 'move selected start / end to now'],
  ['M / F', 'match starts / finishes here'],
  ['H', '★ favourite (selected rally, or the one just played)'],
  ['Delete', 'remove selected rally'],
  ['Ctrl+Z', 'undo'],
  ['+ / − / 0', 'zoom the timeline in / out / to the whole video (or the mouse wheel; Shift+wheel moves along)'],
  ['?', 'this list of keys'],
];

export async function renderEditor(main, id, { runJob, errorNotice, progressBar }) {
  let data = await api(`/api/matches/${id}`);
  const { match, tournament } = data;
  const [nameA, nameB] = boardNames([match.teamA, match.teamB], data.nameStyle);
  const unitGame = match.game || 0; // 1-3 when this video is of one game of the match
  const official = unitGame ? match.games.slice(0, unitGame) : match.games;
  document.title = `${nameA} v ${nameB} · Badminton Video`;

  const headRight = h('div', { class: 'row' });
  const header = h('div', { class: 'editor-head' },
    h('div', {},
      h('a', { class: 'crumb', href: `#/t/${tournament.id}` }, icon('back', 15), tournament.name),
      h('h1', {}, h('span', { class: 'side-a' }, teamName(match.teamA)), h('span', { class: 'vs' }, 'v'), h('span', { class: 'side-b' }, teamName(match.teamB))),
      h('div', { class: 'meta' },
        [match.draw, match.round, match.court, `${day(match.date)} ${match.time}`].filter(Boolean).map((x) => h('span', {}, x)),
        match.games.length ? h('span', { class: 'result' }, ['Result ', gamesView(match.games)]) : null),
      unitSwitch()),
    headRight);

  // Whole match and each game, for moving between a match's game videos from here.
  function unitSwitch() {
    const all = data.units ?? []; // a server older than 1.9.0 doesn't send them
    const games = all.filter((u) => u.game > 0);
    if (!games.length) return unitGame ? h('div', { class: 'unit-switch' }, h('nav', {}, h('span', { class: 'current' }, `Game ${unitGame}`))) : null;
    const played = Math.max(match.games.length, ...games.map((u) => u.game));
    const whole = all.find((u) => u.game === 0);
    const units = [...(whole?.linked ? [whole] : []), ...Array.from({ length: played }, (_, k) => games.find((u) => u.game === k + 1) ?? { id: null, game: k + 1, linked: false })];
    return h('div', { class: 'unit-switch' },
      h('nav', { 'aria-label': 'Games of this match' }, units.map((u) => {
        const score = u.game && match.games[u.game - 1] ? ` · ${match.games[u.game - 1].join('-')}` : '';
        const label = u.game ? `Game ${u.game}${score}` : 'Whole match';
        if (u.id === match.id) return h('span', { class: 'current', 'aria-current': 'page' }, label);
        return u.linked ? h('a', { href: `#/m/${u.id}` }, label) : h('span', { class: 'off', title: 'No video linked' }, label);
      })),
      unitGame ? h('span', { class: 'muted small' }, 'this video is this game only') : null);
  }

  if (!data.source.ready) {
    const box = h('div', { class: 'card' });
    fill(main, header, box);
    if (data.source.reason === 'needsJoin') {
      fill(box, h('p', {}, `This match has ${data.videos.length} videos. They’re joined into one file first (no re-encoding; about a minute).`));
      const jobBox = h('div');
      box.append(jobBox);
      try {
        await runJob(jobBox, () => api(`/api/matches/${id}/prepare`, { method: 'POST' }));
        return renderEditor(main, id, { runJob, errorNotice, progressBar });
      } catch (err) {
        fill(jobBox, errorNotice(err));
      }
    } else if (data.source.reason === 'missing') {
      fill(box, h('p', {}, 'A video file for this match has been moved or deleted. Put it back and scan again, or link other videos from the tournament page.'));
    } else {
      fill(box, h('p', {}, 'No video is linked to this match yet. ', h('a', { href: `#/t/${tournament.id}` }, 'Link one on the tournament page.')));
    }
    return null;
  }

  // ---- state ----
  let rallies = match.rallies.map((r) => ({ ...r }));
  let format = data.format;
  let formatChosen = data.formatChosen;
  let firstServer = match.firstServer;
  let startScore = match.startScore;
  let matchStart = match.matchStart;
  let matchEnd = match.matchEnd;
  let initial = null;
  let corners = match.corners;
  let nearAtStart = match.nearAtStart;
  let shuttle = []; // tracked sightings [t, x, y], once loaded
  let showShuttle = true;
  let showCourt = true;
  let marking = null; // corners clicked so far while marking the court
  let onTracking = false; // court lines, marking, the shuttle and black space show only on the Tracking tab
  const pad = readPad();
  const suggested = new Map(); // rally start -> { winner, sure }
  let sel = -1;
  let openStart = null;
  let steps = [];
  const undo = [];
  let saveTimer = null;
  let saveState = h('span', { class: 'save-state' }, 'Saved');

  // ---- player ----
  const video = h('video', { src: data.source.url, preload: 'auto', playsinline: true });
  if (data.source.width && data.source.height) video.style.aspectRatio = `${data.source.width} / ${data.source.height}`;
  const flash = h('div', { class: 'flash', hidden: true });
  const openBadge = h('div', { class: 'open-rally', hidden: true }, '● Rally running');
  const overlay = h('canvas', { class: 'overlay' });
  const player = h('div', { class: 'player' }, video, overlay, flash, openBadge);
  // Which video the player shows: the original (for tagging) or one of the finished files.
  let files = []; // GET /api/matches/:id/rendered
  let showing = ''; // '' = the original, else a finished file's key
  let onTimeline = true; // false while a cut, slowed or card-framed render plays: its times aren't the original's
  let originalAt = 0; // where the original was when a render took over
  const showSel = h('select', {
    'aria-label': 'Video shown', hidden: true, onchange: () => showVideo(showSel.value),
    title: 'Switch between the original video (for tagging) and the rendered ones. A render as long as the original keeps the rally timeline and scores; a cut one, highlights or a clip plays on its own.',
  });
  const showNote = h('div', { class: 'notice info small', hidden: true });
  const playBtn = h('button', { class: 'play-btn', onclick: () => toggle(), 'aria-label': 'Play or pause (Space)', title: 'Play / pause (Space)' }, icon('play', 18));
  const timeText = h('span', { class: 'time' }, '0:00 / 0:00');
  const speedSel = h('select', { 'aria-label': 'Speed', onchange: (e) => { video.playbackRate = Number(e.target.value); } },
    SPEEDS.map((s) => h('option', { value: s, selected: s === 1 }, `${s}×`)));
  const muteBtn = h('button', { class: 'ghost icon-only', onclick: () => { video.muted = !video.muted; fill(muteBtn, icon(video.muted ? 'mute' : 'volume')); }, 'aria-label': 'Mute', title: 'Mute' }, icon('volume'));
  const timeline = h('div', { class: 'timeline', title: 'Click or drag to move through the video' });
  const playhead = h('div', { class: 'head' });
  const scoreStrip = h('div', { class: 'score-strip' });
  const videoError = h('div');
  const duration = () => (Number.isFinite(video.duration) ? video.duration : data.source.duration || 1);
  const frames = h('div', { class: 'frame-strip', 'aria-hidden': 'true' });
  const wave = h('canvas', { class: 'wave', title: 'Sound level: shuttle hits show as spikes' });
  const zoomText = h('span', { class: 'small muted zoom-text' });

  // The part of the video the timeline shows: all of it, or a window zoomed into with the mouse wheel or + / −.
  const view = { from: 0, to: null }; // to null: the end of the video
  const MIN_SPAN = 10;
  const viewTo = () => view.to ?? duration();
  const span = () => Math.max(1, viewTo() - view.from);
  const pct = (t) => ((t - view.from) / span()) * 100;
  function setView(from, to) {
    const d = duration();
    const len = Math.min(d, Math.max(MIN_SPAN, to - from));
    view.from = Math.max(0, Math.min(from, d - len));
    view.to = len >= d - 0.01 ? null : view.from + len;
    if (view.to === null) view.from = 0;
    drawTimeline();
    drawWave();
    drawFrames();
    drawZoom();
    showTime();
  }
  const zoomBy = (k, at = video.currentTime) => {
    const frac = Math.min(1, Math.max(0, (at - view.from) / span()));
    const len = span() * k;
    setView(at - frac * len, at - frac * len + len);
  };
  timeline.addEventListener('wheel', (e) => {
    e.preventDefault();
    const box = timeline.getBoundingClientRect();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const move = ((e.deltaX || e.deltaY) / box.width) * span();
      setView(view.from + move, viewTo() + move);
      return;
    }
    zoomBy(e.deltaY < 0 ? 0.75 : 1 / 0.75, view.from + ((e.clientX - box.left) / box.width) * span());
  }, { passive: false });
  function drawZoom() {
    fill(zoomText, view.to === null ? 'Whole video' : `${clock(view.from)}–${clock(viewTo())}`);
  }

  // ---- sound level along the video, worked out once per video ----
  let levels = null; // { step, levels, floor, top }
  async function loadLevels() {
    let got = null;
    try {
      got = await api(`/api/matches/${id}/levels`);
    } catch (err) {
      if (err.status !== 404) return;
      try {
        got = await waitJob(await api(`/api/matches/${id}/levels`, { method: 'POST' }));
      } catch {
        return; // no FFmpeg, no sound: the strip stays empty
      }
    }
    const sorted = [...got.levels].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    levels = { ...got, floor: at(0.5), top: Math.max(at(0.998), at(0.5) + 1) };
    drawWave();
    if (tab === 'stats') drawStats();
  }
  function drawWave() {
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(wave.clientWidth * ratio));
    const hgt = Math.max(1, Math.round(wave.clientHeight * ratio));
    if (wave.width !== w || wave.height !== hgt) Object.assign(wave, { width: w, height: hgt });
    const g = wave.getContext('2d');
    g.clearRect(0, 0, w, hgt);
    if (!levels) return;
    g.fillStyle = getComputedStyle(wave).color;
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((view.from + (x / w) * span()) / levels.step);
      const i1 = Math.max(i0 + 1, Math.ceil((view.from + ((x + 1) / w) * span()) / levels.step));
      let v = -Infinity;
      for (let i = i0; i < i1 && i < levels.levels.length; i++) v = Math.max(v, levels.levels[i]);
      const k = Math.min(1, Math.max(0, (v - levels.floor) / (levels.top - levels.floor)));
      if (k > 0) g.fillRect(x, hgt - k * hgt, 1, k * hgt);
    }
  }

  // ---- a strip of frames over the timeline, for the part shown ----
  let framesTimer = null;
  function drawFrames() {
    clearTimeout(framesTimer);
    framesTimer = setTimeout(() => {
      const n = Math.max(1, Math.floor(frames.clientWidth / 120));
      const step = Math.max(1, Math.round(span() / n));
      fill(frames, Array.from({ length: n }, (_, k) => {
        const t = Math.min(duration() - 1, Math.round((view.from + ((k + 0.5) * span()) / n) / step) * step);
        return h('img', { src: `/media/frame/${id}?t=${Math.max(0, t)}`, alt: '', loading: 'lazy', title: clock(t), onclick: () => { video.currentTime = t; }, onerror: (e) => { e.target.style.visibility = 'hidden'; } });
      }));
    }, 250);
  }

  video.addEventListener('error', () => fill(videoError, h('div', { class: 'notice bad' },
    'This video can’t be played here (Chrome may not support its format). Finding rallies and rendering still work.')));

  // Click or drag along the timeline to move through the video, playing or paused.
  const seekTo = (e) => {
    const box = timeline.getBoundingClientRect();
    video.currentTime = view.from + Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * span();
    showTime();
  };
  timeline.addEventListener('pointerdown', (e) => {
    timeline.setPointerCapture(e.pointerId);
    seekTo(e);
  });
  timeline.addEventListener('pointermove', (e) => {
    if (timeline.hasPointerCapture(e.pointerId)) seekTo(e);
  });

  overlay.addEventListener('pointerdown', (e) => {
    if (!marking) return;
    const box = pictureBox();
    const r = overlay.getBoundingClientRect();
    const x = (e.clientX - r.left - box.x) / box.w;
    const y = (e.clientY - r.top - box.y) / box.h;
    if (x < -0.5 || x > 1.5 || y < -0.5 || y > 1.5) return;
    marking.push([Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
    if (marking.length === 4) {
      const done = marking;
      stopMarking();
      if (!courtMapping(done)) {
        say('Those corners don’t make a court; try again');
      } else {
        corners = done;
        say('Court marked');
        saveTrackingSettings();
      }
      drawTrackingPanel();
    } else {
      say(`Now the ${CORNER_NAMES[marking.length]} corner`);
    }
    drawOverlay();
  });

  let flashTimer = null;
  function say(text) {
    flash.textContent = text;
    flash.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash.hidden = true; }, 1600);
  }

  function toggle() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }
  video.addEventListener('play', () => { fill(playBtn, icon('pause', 18)); tick(); });
  video.addEventListener('pause', () => { fill(playBtn, icon('play', 18)); showTime(); });
  video.addEventListener('loadedmetadata', () => { drawTimeline(); showTime(); });

  /** Plays the original ('') or a finished file; the timeline stays only when the file is as long as the original. */
  function showVideo(key, seekTo = null) {
    const file = files.find((f) => f.key === key) ?? null;
    if (!showing) originalAt = video.currentTime;
    const at = seekTo ?? (onTimeline ? video.currentTime : originalAt);
    showing = file ? file.key : '';
    showSel.value = showing;
    video.pause();
    video.addEventListener('loadedmetadata', () => {
      onTimeline = !file || Math.abs(video.duration - (data.source.duration || 0)) < 0.5;
      player.closest('.editor')?.classList.toggle('off-timeline', !onTimeline);
      if (video.videoWidth && video.videoHeight) video.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      if (onTimeline) video.currentTime = Math.min(at, video.duration);
      showNote.hidden = !file;
      fill(showNote, !file ? '' : onTimeline
        ? `Playing the rendered video (${file.label.toLowerCase()}): as long as the original, so the timeline and scores still line up.`
        : `Playing the ${file.label.toLowerCase()}: ${file.kind === 'video' ? 'it’s cut, slowed or has cards, so' : 'it plays on its own, so'} the rally timeline and scores are hidden. Choose Original to tag.`);
      drawTimeline();
      showTime();
    }, { once: true });
    video.src = file ? file.url : data.source.url;
  }
  const resized = new ResizeObserver(() => {
    drawScores();
    drawWave();
    drawFrames();
  });
  resized.observe(timeline);
  // While paused nothing else redraws the time and playhead after a seek (keys, timeline, rally list).
  video.addEventListener('seeked', () => showTime());
  video.addEventListener('timeupdate', () => { if (video.paused) showTime(); });

  // ---- right panel ----
  const board = h('div', { class: 'board' });
  const checkBox = h('div', { class: 'small' });
  const listBox = h('div', { class: 'rallies' });
  const findBox = h('div');
  const renderBox = h('div');

  function tick() {
    showTime();
    if (!video.paused) requestAnimationFrame(tick);
  }

  // Where the picture sits inside the video element (it may be letterboxed).
  // Where the picture sits in the player (letterboxed inside the video element,
  // which has black space above and below while the court is marked or shown).
  function pictureBox() {
    const w = video.clientWidth;
    const hgt = video.clientHeight;
    const vw = video.videoWidth || data.source.width || 16;
    const vh = video.videoHeight || data.source.height || 9;
    const k = Math.min(w / vw, hgt / vh);
    return { x: video.offsetLeft + (w - vw * k) / 2, y: video.offsetTop + (hgt - vh * k) / 2, w: vw * k, h: vh * k, cw: player.clientWidth, ch: player.clientHeight };
  }

  // Black space around the video on the Tracking tab, so corners outside the picture can be clicked and drawn.
  function padPlayer() {
    for (const [k] of PAD_SIDES) player.style.setProperty(`--pad-${k}`, `${pad[k]}px`);
    player.classList.toggle('padded', onTracking);
    drawOverlay();
  }

  function startMarking() {
    video.pause();
    marking = [];
    overlay.classList.add('marking');
    padPlayer();
    say(`Click the ${CORNER_NAMES[0]} corner of the court`);
    drawTrackingPanel();
  }

  function stopMarking() {
    marking = null;
    overlay.classList.remove('marking');
  }

  function drawOverlay() {
    const box = pictureBox();
    const ratio = window.devicePixelRatio || 1;
    if (overlay.width !== Math.round(box.cw * ratio) || overlay.height !== Math.round(box.ch * ratio)) {
      overlay.width = Math.round(box.cw * ratio);
      overlay.height = Math.round(box.ch * ratio);
      overlay.style.width = `${box.cw}px`;
      overlay.style.height = `${box.ch}px`;
    }
    const g = overlay.getContext('2d');
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, box.cw, box.ch);
    if (!onTracking) return;
    const px =([x, y]) => [box.x + x * box.w, box.y + y * box.h];
    const map = corners && courtMapping(corners);
    if (map && showCourt && !marking) {
      g.strokeStyle = 'rgba(255, 216, 77, 0.8)';
      g.lineWidth = 1.5;
      g.beginPath();
      for (const [a, b] of courtLines()) {
        const steps = 12; // lines curve slightly under the mapping only if it's not a true perspective; draw in segments anyway
        for (let k = 0; k <= steps; k++) {
          const p = px(apply(map.toPicture, [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]));
          if (k === 0) g.moveTo(...p);
          else g.lineTo(...p);
        }
      }
      g.stroke();
    }
    if (marking) {
      g.fillStyle = '#ffd84d';
      g.strokeStyle = '#000';
      marking.forEach((c, k) => {
        const [x, y] = px(c);
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillText(CORNER_NAMES[k], x + 9, y - 6);
      });
    }
    if (showShuttle && shuttle.length) {
      const t = video.currentTime;
      let i = lowerBound(shuttle, t - 0.5);
      const trail = [];
      for (; i < shuttle.length && shuttle[i][0] <= t + 0.02; i++) trail.push(shuttle[i]);
      trail.forEach(([pt, x, y], k) => {
        const [cx, cy] = px([x, y]);
        const fresh = k === trail.length - 1 && t - pt < 0.1;
        g.fillStyle = fresh ? '#ff3b30' : `rgba(255, 59, 48, ${0.25 + (0.5 * k) / trail.length})`;
        g.beginPath();
        g.arc(cx, cy, fresh ? 6 : 3, 0, Math.PI * 2);
        g.fill();
        if (fresh) {
          g.strokeStyle = '#fff';
          g.lineWidth = 2;
          g.stroke();
        }
      });
    }
  }

  const lowerBound = (list, t) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let lastBoard = '';
  function showTime() {
    drawOverlay();
    const t = video.currentTime;
    timeText.textContent = `${clockTenths(t)} / ${clock(duration())}`;
    // While playing, the zoomed timeline turns the page when the playhead runs off its end.
    if (view.to !== null && !video.paused && (t > viewTo() || t < view.from)) setView(t - span() * 0.05, t + span() * 0.95);
    playhead.style.left = `${pct(t)}%`;
    playhead.hidden = t < view.from || t > viewTo();
    const s = scoreAt(rallies, steps, t, initial);
    const key = JSON.stringify(s);
    if (key !== lastBoard) {
      lastBoard = key;
      const flags = boardFlags(s, format);
      fill(board, [0, 1].map((k) => {
        const side = k ? 'b' : 'a';
        return [
          h('span', { class: s.server === side ? 'serve' : '' }),
          h('span', { class: `side-${side}` }, h('span', { class: `chip ${side}` }, side.toUpperCase()), ' ', k ? nameB : nameA, flags[k] ? h('span', { class: 'flag' }, flags[k]) : null),
          h('span', { class: 'games', title: 'Games won' }, s.games.map((g) => g[k]).join(' ') || ''),
          h('span', { class: 'pts' }, s.points[k]),
        ];
      }));
    }
  }

  function recompute() {
    ({ steps, initial } = replay(rallies, format, firstServer, startFor({ ...match, startScore }), { oneGame: unitGame > 0 }));
  }

  function changed() {
    recompute();
    if (tab === 'stats') drawStats();
    drawTimeline();
    drawList();
    drawCheck();
    lastBoard = '';
    showTime();
    fill(saveState, 'Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  async function save() {
    try {
      await api(`/api/matches/${id}`, { method: 'PUT', body: { rallies, format: formatChosen ? format : null, firstServer, startScore, matchStart, matchEnd, corners, nearAtStart } });
      fill(saveState, 'Saved');
    } catch (err) {
      fill(saveState, h('span', { class: 'side-b' }, `Not saved: ${err.message}`));
    }
  }

  function remember() {
    undo.push(JSON.stringify({ rallies, sel }));
    if (undo.length > UNDO_DEPTH) undo.shift();
  }

  function sortKeep(r) {
    rallies.sort((x, y) => x.start - y.start);
    return rallies.indexOf(r);
  }

  function drawTimeline() {
    const d = duration();
    const shade = (from, to) => h('div', { class: 'out', style: { left: `${pct(from)}%`, width: `${((to - from) / span()) * 100}%` } });
    fill(timeline,
      matchStart ? shade(0, matchStart) : null,
      matchEnd ? shade(matchEnd, d) : null,
      rallies.map((r, i) => h('div', {
      class: `r ${r.winner ?? 'none'}${i === sel ? ' sel' : ''}${r.fav ? ' fav' : ''}`,
      style: { left: `${pct(r.start)}%`, width: `${((r.end - r.start) / span()) * 100}%` },
      title: `Rally ${i + 1}${r.fav ? ' ★' : ''}`,
    })), playhead);
    drawBounds();
    drawScores();
  }

  // The score after each tagged rally, in small type under the timeline at the
  // rally's end. Close rallies use a second row; labels that still collide are
  // left out, except game scores, which are placed first.
  const LABEL_PX = 6.4; // per character at the strip's font size
  function drawScores() {
    const width = timeline.clientWidth || 1;
    const items = [];
    rallies.forEach((r, i) => {
      const st = steps[i];
      if (!st?.counted || r.end < view.from || r.end > viewTo()) return;
      const gameEnd = st.event === 'game' || st.event === 'match';
      const text = `${r.fav ? '★' : ''}${gameEnd ? st.after.games.at(-1).join('-') : st.after.points.join('-')}`;
      const w = text.length * LABEL_PX + 6;
      const x = Math.min(width - w / 2, Math.max(w / 2, (pct(r.end) / 100) * width));
      items.push({ i, text, gameEnd, from: x - w / 2, to: x + w / 2, x });
    });
    const rows = [[], []];
    const placed = [];
    for (const item of [...items.filter((t) => t.gameEnd), ...items.filter((t) => !t.gameEnd)]) {
      const row = rows.findIndex((taken) => taken.every((t) => item.to <= t.from || item.from >= t.to));
      if (row < 0) continue;
      rows[row].push(item);
      placed.push({ ...item, row });
    }
    fill(scoreStrip, placed.map((t) => h('span', {
      class: `${t.gameEnd ? 'game' : ''} ${rallies[t.i].winner}`,
      style: { left: `${t.x}px`, top: `${t.row * 14}px` },
      title: `Rally ${t.i + 1}`,
      onclick: () => select(t.i),
    }, t.text)));
  }

  function drawCheck() {
    const { games, winner } = replay(rallies, format, firstServer, startFor({ ...match, startScore }), { oneGame: unitGame > 0 });
    const untagged = rallies.filter((r) => !r.winner).length;
    const favs = rallies.filter((r) => r.fav).length;
    const res = checkResult(games, official);
    fill(checkBox,
      h('div', {}, 'Tagged score: ', games.length ? h('span', {}, gamesView(unitGame ? games.slice(unitGame - 1, unitGame) : games)) : '0-0',
        winner ? ` (${winner.toUpperCase()} wins${unitGame ? ' the game' : ''})` : ''),
      official.length ? h('div', {}, unitGame ? `Official game ${unitGame}: ` : 'Official result: ', h('span', {}, gamesView(unitGame ? official.slice(-1) : official)), ' ',
        res.ok ? h('span', { class: 'pill ok' }, 'matches ✓') : untagged ? h('span', { class: 'pill warn' }, `${untagged} untagged`) : h('span', { class: 'pill bad' }, `differs in game ${res.game + 1}`)) : null,
      h('div', { class: 'muted' }, `${rallies.length} rallies`, untagged ? ` · ${untagged} without a winner` : '', favs ? ` · ★ ${favs}` : ''));
    favCount.textContent = favs ? `(${favs})` : '(none marked yet)';
  }

  function setWinner(i, w, { advance = false } = {}) {
    remember();
    rallies[i].winner = rallies[i].winner === w && !advance ? null : w;
    changed();
    const after = steps[i]?.after;
    say(`Rally ${i + 1}: ${w === 'let' ? 'let' : `${w.toUpperCase()} wins`}${after ? ` · ${after.points.join('-')}` : ''}`);
    if (advance) goNextUntagged(i);
  }

  function toggleFav(i) {
    if (!rallies[i]) return;
    remember();
    if (rallies[i].fav) delete rallies[i].fav;
    else rallies[i].fav = true;
    changed();
    say(`Rally ${i + 1}: ${rallies[i].fav ? '★ favourite' : 'not a favourite'}`);
  }

  function select(i, { seek = true, lead = 1 } = {}) {
    sel = i;
    drawTimeline();
    drawList();
    if (tab === 'export') showClipTarget();
    if (seek && rallies[i] && !onTimeline) showVideo('', Math.max(0, rallies[i].start - lead));
    else if (seek && rallies[i]) video.currentTime = Math.max(0, rallies[i].start - lead);
    listBox.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function goNextUntagged(from = sel) {
    const n = rallies.findIndex((r, i) => i > from && !r.winner);
    const i = n >= 0 ? n : rallies.findIndex((r) => !r.winner);
    if (i < 0) {
      sel = -1;
      drawTimeline();
      drawList();
      say('Every rally has a winner');
      return;
    }
    select(i, { seek: false });
    video.currentTime = Math.max(rallies[i].start, rallies[i].end - REVIEW_LEAD_S);
    video.play().catch(() => {});
    const guess = suggested.get(rallies[i].start);
    if (guess?.winner) say(`Rally ${i + 1}: suggested ${guess.winner.toUpperCase()}${guess.sure ? '' : ' (unsure)'}`);
  }

  function drawList() {
    const rows = rallies.map((r, i) => {
      const s = steps[i];
      const score = !s ? '' : !s.counted ? (s.reason === 'afterMatch' ? 'after match end' : s.reason === 'let' ? 'let' : '') : s.event === 'game' || s.event === 'match' ? `Game ${s.after.games.length}: ${s.after.games.at(-1).join('-')}` : s.after.points.join('-');
      return h('tr', {
        class: [i === sel ? 'sel' : '', r.winner ? '' : 'untagged', s && !s.counted && r.winner ? 'void' : '', s?.event === 'game' || s?.event === 'match' ? 'game-end' : ''].join(' '),
        onclick: (e) => { if (!e.target.closest('button')) select(i); },
      },
      h('td', {}, i + 1),
      h('td', { class: 'nowrap' }, clock(r.start)),
      h('td', {}, `${Math.round(r.end - r.start)}s`),
      h('td', { class: 'win nowrap' }, ['a', 'b', 'let'].map((w) => h('button', {
        class: `${w}${r.winner === w ? ' on' : ''}`,
        onclick: () => setWinner(i, w),
        title: w === 'let' ? 'Let' : `${w.toUpperCase()} won`,
      }, w === 'let' ? 'Let' : w.toUpperCase())),
      !r.winner && suggested.get(r.start)?.winner ? h('button', {
        class: `guess ${suggested.get(r.start).winner}${suggested.get(r.start).sure ? ' sure' : ''}`,
        title: `Suggested from the shuttle (${suggested.get(r.start).sure ? 'sure' : 'unsure'}); click to accept`,
        onclick: () => setWinner(i, suggested.get(r.start).winner),
      }, `${suggested.get(r.start).winner.toUpperCase()}?`) : null),
      h('td', { class: 'nowrap' }, score),
      h('td', {}, h('button', { class: `star${r.fav ? ' on' : ''}`, title: r.fav ? 'Favourite (H)' : 'Mark as favourite (H)', 'aria-pressed': String(Boolean(r.fav)), onclick: () => toggleFav(i) }, r.fav ? '★' : '☆')),
      h('td', {}, h('button', { class: 'small', title: 'Remove', onclick: () => { remember(); rallies.splice(i, 1); if (sel >= rallies.length) sel = -1; changed(); } }, '✕')));
    });
    fill(listBox, rallies.length
      ? h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Start', 'Len', 'Winner', 'Score', '★', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))
      : h('p', { class: 'muted small', style: { padding: '8px 12px' } }, 'No rallies yet. Press S when a rally starts and A or B when it ends — or find them by sound below.'));
  }

  // ---- tagging settings ----
  const pointsSel = h('select', { 'aria-label': 'Points per game' }, [21, 15, 11].map((p) => h('option', { value: p, selected: format.points === p }, `${p} points`)));
  const settingBox = h('input', { type: 'checkbox', checked: format.setting });
  const bestOfSel = h('select', { 'aria-label': 'Games' }, h('option', { value: 3, selected: format.bestOf === 3 }, 'best of 3'), h('option', { value: 1, selected: format.bestOf === 1 }, 'one game'));
  const capText = h('span', { class: 'small muted' });
  const formatChanged = () => {
    format = cleanFormat({ points: Number(pointsSel.value), setting: settingBox.checked, bestOf: Number(bestOfSel.value) });
    formatChosen = true;
    capText.textContent = format.setting ? `setting to ${CAPS[format.points]}` : 'no setting';
    changed();
  };
  for (const el of [pointsSel, settingBox, bestOfSel]) el.addEventListener('change', formatChanged);
  capText.textContent = format.setting ? `setting to ${CAPS[format.points]}` : 'no setting';
  const serverSel = h('select', { 'aria-label': 'First server', onchange: (e) => { firstServer = e.target.value; changed(); } },
    h('option', { value: 'a', selected: firstServer === 'a' }, 'A serves first'), h('option', { value: 'b', selected: firstServer === 'b' }, 'B serves first'));

  // ---- the score when the video starts ----
  const startGame = h('select', { 'aria-label': 'Game the video starts in' }, [1, 2, 3].map((g) => h('option', { value: g }, `game ${g}`)));
  const startA = h('input', { type: 'number', min: 0, max: 30, value: startScore?.points[0] ?? 0, 'aria-label': 'A points', style: { width: '4.5em' } });
  const startB = h('input', { type: 'number', min: 0, max: 30, value: startScore?.points[1] ?? 0, 'aria-label': 'B points', style: { width: '4.5em' } });
  const earlier = h('input', { type: 'text', placeholder: 'e.g. 21-18', 'aria-label': 'Earlier games', style: { width: '9em' } });
  const earlierRow = h('div', { class: 'row small' }, 'Earlier games', earlier, h('span', { class: 'muted' }, 'A’s points first'));
  const startMsg = h('div', { class: 'small' });
  startGame.value = String(unitGame || (startScore?.games.length ?? 0) + 1);
  startGame.disabled = unitGame > 0;
  earlier.value = gamesText(startScore?.games ?? []);
  const showEarlier = () => {
    const n = Number(startGame.value) - 1;
    earlierRow.hidden = n === 0 || unitGame > 0;
    // Earlier games come from the official result when there is one.
    if (n > 0 && !earlier.value && match.games.length >= n) earlier.value = gamesText(match.games.slice(0, n));
  };
  const startChanged = () => {
    showEarlier();
    const n = Number(startGame.value) - 1;
    const games = unitGame ? official.slice(0, n) : n ? parseGames(earlier.value) : [];
    const points = [Number(startA.value) || 0, Number(startB.value) || 0];
    if (n && (!games || games.length !== n)) {
      fill(startMsg, h('span', { class: 'side-b' }, `Give the ${n === 1 ? 'first game’s score' : `scores of the first ${n} games`}, like 21-18.`));
      return;
    }
    const cleaned = cleanStart({ games, points }, format);
    if (!cleaned && (n || points[0] || points[1])) {
      fill(startMsg, h('span', { class: 'side-b' }, 'That score isn’t possible in this format.'));
      return;
    }
    startScore = cleaned;
    fill(startMsg, '');
    changed();
  };
  for (const el of [startGame, startA, startB, earlier]) el.addEventListener('change', startChanged);
  showEarlier();

  // ---- where the match starts and finishes in the video ----
  const boundsBox = h('div', { class: 'stack small' });
  function setBound(which, t) {
    if (which === 'start') {
      if (t !== null && matchEnd !== null && t >= matchEnd) return say('The match must start before it finishes');
      matchStart = t;
    } else {
      if (t !== null && matchStart !== null && t <= matchStart) return say('The match must finish after it starts');
      matchEnd = t;
    }
    changed();
    say(t === null ? `Match ${which} cleared` : `Match ${which === 'start' ? 'starts' : 'finishes'} at ${clock(t)}`);
  }
  function drawBounds() {
    const part = (label, which, t) => h('div', { class: 'row' },
      h('span', { style: { minWidth: '9em' } }, `${label}: `, h('strong', {}, t === null ? (which === 'start' ? 'video start' : 'video end') : clock(t))),
      t !== null ? h('button', { class: 'small', onclick: () => { video.currentTime = t; } }, 'Go') : null,
      t !== null ? h('button', { class: 'small', onclick: () => setBound(which, null) }, 'Clear') : null);
    fill(boundsBox, part('Starts', 'start', matchStart), part('Finishes', 'end', matchEnd));
  }

  // ---- find rallies by sound ----
  const sens = h('input', { type: 'range', min: 1, max: 10, step: 1, value: 5, 'aria-label': 'Sensitivity' });
  const findBtn = h('button', {
    onclick: async () => {
      if (rallies.length && !confirm(`Replace the ${rallies.length} rallies with the ones found? Winners you’ve tagged are kept where rallies overlap.`)) return;
      findBtn.disabled = true;
      try {
        const r = await runJob(findBox, () => api(`/api/matches/${id}/analyse`, { method: 'POST', body: { sensitivity: Number(sens.value) } }));
        remember();
        rallies = mergeWinners(r.rallies, rallies);
        sel = -1;
        changed();
        fill(findBox, h('div', { class: 'notice ok' }, `Found ${r.rallies.length} rallies from ${r.hits} hit sounds${r.outside ? ` (${r.outside} more outside the marked match left out)` : ''}. Check them, then press N to go through each and say who won.`));
      } catch (err) {
        fill(findBox, errorNotice(err));
      }
      findBtn.disabled = false;
    },
  }, icon('wave', 16), 'Find rallies by sound');

  // ---- tagging stranded on a match with no video (tagged before tagging followed videos) ----
  const strandedBox = h('div');
  if (data.stranded.length) {
    const pickFrom = h('select', { 'aria-label': 'Match to bring tagging from' }, data.stranded.map((m) => h('option', { value: m.id },
      `${m.time} ${m.draw} ${m.round} · ${boardNames([m.teamA, m.teamB], data.nameStyle).join(' v ')} · ${m.rallies} rallies`)));
    const bring = async (replace = false) => {
      try {
        await api(`/api/matches/${id}/take-tagging`, { method: 'POST', body: { from: Number(pickFrom.value), replace } });
        clearTimeout(saveTimer);
        location.reload();
      } catch (err) {
        if (err.code === 'hasTagging' && confirm('This match already has tagging. Replace it with the tagging from the other match?')) return bring(true);
        fill(strandedBox, errorNotice(err));
      }
    };
    fill(strandedBox, h('div', { class: 'notice info stack small' },
      h('div', {}, h('strong', {}, 'Tagged on another match? '), 'Tagging is waiting on a match with no video. If it was made on this video, bring it here:'),
      h('div', { class: 'row' }, pickFrom, h('button', { class: 'small primary', onclick: () => bring() }, 'Bring tagging here'))));
  }

  // ---- shuttle tracking: court, ends, TrackNetV3, suggested winners ----
  const trackingBox = h('div', { class: 'stack' });
  const trackJobBox = h('div');
  const suggestBox = h('div');
  let tracked = data.tracking.tracked;

  async function saveTrackingSettings() {
    clearTimeout(saveTimer);
    await save();
  }

  async function loadShuttle() {
    try {
      shuttle = (await api(`/api/matches/${id}/track`)).points;
      drawOverlay();
      if (tab === 'stats') drawStats();
    } catch { /* not tracked yet */ }
  }

  async function suggest() {
    try {
      clearTimeout(saveTimer);
      await save();
      const r = await api(`/api/matches/${id}/suggestions`);
      suggested.clear();
      r.suggestions.forEach((x, i) => { if (rallies[i] && !rallies[i].winner && (x.winner === 'a' || x.winner === 'b')) suggested.set(rallies[i].start, x); });
      const all = [...suggested.values()];
      const sure = all.filter((x) => x.sure).length;
      const fillIn = (onlySure) => {
        remember();
        rallies.forEach((rl) => {
          const x = suggested.get(rl.start);
          if (!rl.winner && x && (x.sure || !onlySure)) rl.winner = x.winner;
        });
        changed();
        say(onlySure ? `Filled in ${sure} sure winners` : `Filled in ${all.length} winners`);
      };
      fill(suggestBox, all.length
        ? h('div', { class: 'notice info stack small' },
          h('div', {}, `${all.length} winners suggested, ${sure} sure${r.court ? '' : ' (mark the court to check landings too)'}. They show as A? / B? in the rally list.`),
          h('div', { class: 'row' },
            sure ? h('button', { class: 'small primary', onclick: () => fillIn(true) }, `Fill in the ${sure} sure ones`) : null,
            h('button', { class: 'small', onclick: () => fillIn(false) }, 'Fill in all')))
        : rallies.every((rl) => rl.winner)
          ? h('div', { class: 'notice info small' }, `All ${rallies.length} rallies already have a winner. Suggestions only fill in rallies without one; your own tags are never changed.`)
          : h('div', { class: 'notice warn small' }, 'No winners could be worked out. The shuttle may not be visible at serves; check the court marking and the near end.'));
      drawList();
    } catch (err) {
      fill(suggestBox, errorNotice(err));
    }
  }

  function drawTrackingPanel() {
    if (!data.tracking.ready) {
      fill(trackingBox, h('p', { class: 'hint' }, 'Not set up on this PC yet. Run ', h('kbd', {}, 'analysis\\setup.ps1'), ' once (it installs TrackNetV3 and PyTorch; see the README).'));
      return;
    }
    const nearSel = h('select', { 'aria-label': 'Team at the near end', onchange: (e) => { nearAtStart = e.target.value || null; saveTrackingSettings(); } },
      h('option', { value: '', selected: !nearAtStart }, 'Choose…'),
      h('option', { value: 'a', selected: nearAtStart === 'a' }, `A (${nameA})`),
      h('option', { value: 'b', selected: nearAtStart === 'b' }, `B (${nameB})`));
    fill(trackingBox,
      h('div', { class: 'row small' },
        h('button', { class: 'small', onclick: startMarking }, corners ? 'Mark the court again' : 'Mark the court'),
        marking ? h('span', { class: 'muted' }, `Click the 4 outer corners: ${CORNER_NAMES.join(', ')} (near = nearest the camera).`) : null,
        corners && !marking ? h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: showCourt, onchange: (e) => { showCourt = e.target.checked; drawOverlay(); } }), 'Show court lines') : null),
      h('div', { class: 'row small' }, 'At the near end when the video starts:', nearSel),
      h('div', { class: 'row small' },
        h('button', {
          class: tracked ? 'small' : 'small primary',
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              const r = await runJob(trackJobBox, () => api(`/api/matches/${id}/track`, { method: 'POST' }));
              tracked = true;
              fill(trackJobBox, h('div', { class: 'notice ok small' }, `Shuttle seen in ${Math.round((r.seen / Math.max(1, r.frames)) * 100)}% of ${r.frames} frames.`));
              await loadShuttle();
              drawTrackingPanel();
            } catch (err) {
              fill(trackJobBox, errorNotice(err));
            }
            e.target.disabled = false;
          },
        }, tracked ? 'Track again' : 'Track the shuttle'),
        tracked ? h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: showShuttle, onchange: (e) => { showShuttle = e.target.checked; drawOverlay(); } }), 'Show the shuttle on the video') : null),
      trackJobBox,
      tracked ? h('div', { class: 'row' }, h('button', { class: 'small primary', disabled: !nearAtStart || !rallies.length, onclick: suggest }, 'Suggest winners'),
        !nearAtStart ? h('span', { class: 'hint' }, 'choose the near end first') : !rallies.length ? h('span', { class: 'hint' }, 'find or tag the rallies first') : null) : null,
      suggestBox);
  }
  drawTrackingPanel();
  if (tracked) loadShuttle();

  // Sliders for the black space on each side, applied as they move and remembered.
  const padInputs = PAD_SIDES.map(([k, label, max]) => {
    const input = h('input', { type: 'range', min: 0, max, step: 10, value: pad[k], 'aria-label': `${label} black space` });
    input.addEventListener('input', () => {
      pad[k] = Number(input.value);
      writePad(pad);
      padPlayer();
    });
    return [k, label, input];
  });
  const padBox = h('div', { class: 'stack small' },
    h('div', { class: 'row spread' }, h('span', { class: 'muted' }, 'Black space around the video'),
      h('button', {
        class: 'small',
        onclick: () => {
          Object.assign(pad, PAD_DEFAULT);
          writePad(pad);
          for (const [k, , input] of padInputs) input.value = pad[k];
          padPlayer();
        },
      }, 'Reset')),
    h('div', { class: 'pad-sliders' }, padInputs.map(([, label, input]) => h('label', {}, h('span', {}, label), input))));
  const resizedPlayer = new ResizeObserver(() => drawOverlay());
  resizedPlayer.observe(video);
  resizedPlayer.observe(player);
  padPlayer();

  // ---- render ----
  const cutBox = h('input', { type: 'checkbox', checked: true });
  const overlayBox = h('input', { type: 'checkbox', checked: true });
  const highlightsBox = h('input', { type: 'checkbox', onchange: () => { cutBox.disabled = highlightsBox.checked; } });
  const titleCardBox = h('input', { type: 'checkbox', checked: Boolean(data.cards?.title) });
  const endCardBox = h('input', { type: 'checkbox', checked: Boolean(data.cards?.end) });
  const replaysBox = h('input', { type: 'checkbox', checked: Boolean(data.replays) });
  const voicesBox = h('input', { type: 'checkbox', checked: Boolean(data.voices?.remove && data.voices?.ready), disabled: !data.voices?.ready });
  const favCount = h('span', { class: 'muted' });
  const renderResult = h('div');
  // The title and description to paste into YouTube are in the YouTube box, under Upload by hand.
  const showOutput = (o, exists) => fill(renderResult,
    exists ? h('div', { class: 'row' }, h('span', { class: 'pill ok' }, 'Rendered'),
      h('button', { class: 'small', onclick: () => api(`/api/matches/${id}/reveal`, { method: 'POST' }).catch((e) => say(e.message)) }, 'Show in folder')) : null);
  showOutput(data.output, data.output.exists);
  const highlightsResult = h('div');
  const showHighlights = (exists) => fill(highlightsResult, exists ? h('div', { class: 'row small' }, h('span', { class: 'pill ok' }, '★ Highlights rendered'),
    h('button', { class: 'small', onclick: () => api(`/api/matches/${id}/reveal`, { method: 'POST', body: { highlights: true } }).catch((e) => say(e.message)) }, 'Show in folder')) : null);
  showHighlights(data.highlights.exists);

  // ---- a clip of one rally, upright (following the shuttle) or as filmed ----
  const clipBox = h('div');
  const clipTarget = h('div', { class: 'small muted' });
  const clipIndex = () => (sel >= 0 ? sel : rallyAtOrBefore(video.currentTime));
  const showClipTarget = () => {
    const i = clipIndex();
    fill(clipTarget, i >= 0 ? `Rally ${i + 1} (${clock(rallies[i].start)}, ${Math.round(rallies[i].end - rallies[i].start)} s)${sel >= 0 ? ', selected' : ', at the playhead'}` : 'Select a rally, or play to one.');
  };
  const makeClip = async (upright) => {
    const i = clipIndex();
    if (i < 0) return say('Select a rally first');
    clearTimeout(saveTimer);
    await save();
    try {
      const r = await runJob(clipBox, () => api(`/api/matches/${id}/clip`, { method: 'POST', body: { rally: i, upright, removeVoices: voicesBox.checked } }));
      fill(clipBox, h('div', { class: 'notice ok row small' }, `Clip of rally ${i + 1}: ${r.seconds} s${r.upright ? (r.followed ? ', following the shuttle' : ', centred on the court') : ''}.`,
        h('button', { class: 'small', onclick: () => api('/api/reveal', { method: 'POST', body: { path: r.path } }).catch((e) => say(e.message)) }, 'Show in folder')));
      loadFiles();
    } catch (err) {
      fill(clipBox, errorNotice(err));
    }
  };

  // ---- this match's own scoreboard preset and corner, over Settings ----
  let boardStyle = match.boardStyle;
  const lookSel = h('select', { 'aria-label': 'Scoreboard look for this match' },
    h('option', { value: '' }, 'Look from Settings'), Object.entries(PRESETS).map(([k, p]) => h('option', { value: k, selected: boardStyle?.preset === k }, p.label)));
  const cornerSel = h('select', { 'aria-label': 'Scoreboard corner for this match' },
    h('option', { value: '' }, 'Corner from Settings'), Object.entries(CORNERS).map(([k, label]) => h('option', { value: k, selected: boardStyle?.corner === k }, label)));
  const boardBox = h('div', { class: 'preview-frame small-preview' });
  const drawBoardPreview = () => {
    const style = data.board;
    const s = scoreAt(rallies, steps, video.currentTime, initial);
    const i = rallies.findLastIndex((r, j) => r.end <= video.currentTime && steps[j]?.counted);
    const st = steps[i];
    const banner = st?.event && video.currentTime - rallies[i].end < 6 ? bannerText({ kind: st.event, winner: rallies[i].winner, before: st.before, after: st.after }, [nameA, nameB], format) : '';
    fill(boardBox, boardPreview({
      names: [nameA, nameB], state: s, style, flags: boardFlags(s, format), heading: boardHeading(style, { tournament, match }), banner,
      background: `/media/thumb/${id}`, width: data.source.width || 1920, height: data.source.height || 1080,
    }));
  };
  const lookChanged = async () => {
    boardStyle = { ...(lookSel.value ? { preset: lookSel.value } : {}), ...(cornerSel.value ? { corner: cornerSel.value } : {}) };
    try {
      const r = await api(`/api/matches/${id}`, { method: 'PUT', body: { boardStyle } });
      boardStyle = r.boardStyle;
      data.board = r.board; // Settings' look with this match's choice on top, as the render will use
      drawBoardPreview();
      say('Scoreboard look saved');
    } catch (err) {
      say(err.message);
    }
  };
  lookSel.addEventListener('change', lookChanged);
  cornerSel.addEventListener('change', lookChanged);

  // ---- the YouTube link, once uploaded by hand ----
  const ytInput = h('input', { type: 'url', placeholder: 'https://youtu.be/…', value: match.youtubeUrl ?? '', 'aria-label': 'YouTube link' });
  const ytBox = h('div');
  const drawYt = (link, at) => fill(ytBox, link
    ? h('div', { class: 'row small' }, h('span', { class: 'pill ok' }, 'Uploaded'), h('a', { href: link, target: '_blank', rel: 'noopener' }, `${link} ↗`), at ? h('span', { class: 'muted' }, `marked ${new Date(at).toLocaleDateString('en-GB')}`) : null)
    : h('p', { class: 'hint' }, 'After uploading, paste the video’s link here to mark the match as uploaded.'));
  drawYt(match.youtubeUrl, match.uploadedAt);
  const saveYt = async () => {
    try {
      const r = await api(`/api/matches/${id}`, { method: 'PUT', body: { youtubeUrl: ytInput.value.trim() } });
      ytInput.value = r.youtubeUrl ?? '';
      drawYt(r.youtubeUrl, r.uploadedAt);
      say(r.youtubeUrl ? 'Marked as uploaded' : 'YouTube link removed');
    } catch (err) {
      fill(ytBox, errorNotice(err));
    }
  };
  ytInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveYt(); });

  // ---- uploading: straight from the app once signed in to YouTube, or by hand ----
  const youtube = youtubePanel({
    id, preview: data.output, runJob, errorNotice, say,
    onUploaded: (url) => { ytInput.value = url; drawYt(url, new Date().toISOString()); },
  });
  /** The finished files, for the player's switch and the YouTube box. */
  async function loadFiles() {
    try {
      ({ files } = await api(`/api/matches/${id}/rendered`));
    } catch {
      return;
    }
    fill(showSel, h('option', { value: '' }, 'Original'), files.map((f) => h('option', { value: f.key }, `Rendered: ${f.label}`)));
    showSel.hidden = !files.length;
    if (showing && !files.some((f) => f.key === showing)) showVideo('');
    else showSel.value = showing;
    youtube.setFiles(files);
  }
  const renderBtn = h('button', {
    class: 'primary',
    onclick: async () => {
      clearTimeout(saveTimer);
      await save();
      const untagged = rallies.filter((r) => !r.winner).length;
      if (highlightsBox.checked && !rallies.some((r) => r.fav)) return say('Mark some favourite rallies first (☆ or H)');
      if (overlayBox.checked && untagged && !confirm(`${untagged} rallies have no winner, so the scoreboard will skip them. Render anyway?`)) return;
      renderBtn.disabled = true;
      const jobBox = h('div');
      renderBox.replaceChildren(jobBox);
      try {
        const r = await runJob(jobBox, () => api(`/api/matches/${id}/render`, { method: 'POST', body: { cut: cutBox.checked, overlay: overlayBox.checked, highlights: highlightsBox.checked, titleCard: titleCardBox.checked, endCard: endCardBox.checked, replays: replaysBox.checked, removeVoices: voicesBox.checked } }));
        fill(jobBox, h('div', { class: 'notice ok' }, `Done: ${clock(r.seconds)} of ${r.highlights ? 'highlights' : 'video'} in ${r.parts} part${r.parts === 1 ? '' : 's'}.`), h('div', { class: 'small muted' }, r.path));
        if (r.highlights) showHighlights(true);
        else showOutput(r, true);
        loadFiles();
      } catch (err) {
        fill(jobBox, errorNotice(err));
      }
      renderBtn.disabled = false;
    },
  }, 'Render video');

  // ---- statistics: serve and receive, runs, rally lengths and shots, momentum, where rallies ended ----
  const statsBox = h('div', { class: 'stack' });
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function drawStats() {
    const s = matchStats(rallies, steps, { hits: levels?.hits });
    if (!s.rallies) {
      fill(statsBox, h('p', { class: 'hint' }, 'Statistics appear once rallies have winners.'));
      return;
    }
    const colours = { a: css('--side-a'), b: css('--side-b'), text: css('--muted'), grid: css('--border-strong') };
    const chart = momentumChart(s, [nameA, nameB], { colours });
    const map = corners && shuttle.length ? landingMap(landings(rallies, shuttle, courtMapping(corners)?.toCourt), { colours: { ...colours, court: '#2f6d4f' } }) : null;
    fill(statsBox,
      statsTables(s, [nameA, nameB]),
      levels?.hits ? null : h('p', { class: 'hint' }, 'Shot counts come from the hit sounds, worked out when the sound strip under the timeline is drawn.'),
      chart ? [h('div', { class: 'row spread' }, h('div', { class: 'subhead' }, 'Momentum'),
        h('button', {
          class: 'small',
          onclick: () => saveSvgAsPng(momentumChart(s, [nameA, nameB], { colours: { a: '#2a78d6', b: '#e8642c', text: '#333333', grid: '#bbbbbb' }, background: '#ffffff', width: 900, height: 360, fontSize: 15 }),
            `${nameA} v ${nameB} momentum.png`.replace(/[\\/:*?"<>|]/g, ' ')),
        }, 'Save as picture')), chart] : null,
      h('div', { class: 'subhead' }, 'Where rallies ended'),
      map ?? h('p', { class: 'hint' }, 'Mark the court and track the shuttle (Tracking tab) to see where each rally ended. Only as good as the tracking: from a low camera the last sighting is often in the air.'));
  }

  // ---- players: badminfo ratings, win chance, earlier meetings ----
  const peopleBox = h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Reading the players from badminfo…'));
  const listMatches = (list, empty) => (list.length
    ? h('ul', { class: 'match-list' }, list.map((m) => h('li', {},
      h('div', { class: 'row spread' },
        h('span', {}, `${teamName(m.teamA)} v ${teamName(m.teamB)}`),
        m.filmed ? h('a', { class: 'btn small primary', href: `#/m/${m.id}` }, 'Open') : null),
      h('div', { class: 'muted' }, [day(m.date), m.tournament, [m.draw, m.round].filter(Boolean).join(' ')].filter(Boolean).join(' · '), ' ', m.games.length ? gamesView(m.games) : '',
        m.youtubeUrl ? [' ', h('a', { href: m.youtubeUrl, target: '_blank', rel: 'noopener' }, 'YouTube ↗')] : null))))
    : h('p', { class: 'hint' }, empty));
  const drawPeople = (p) => {
    const person = (x) => h('div', {},
      h('div', {}, x.id ? h('a', { href: `#/p/${x.id}` }, x.name) : x.name, x.rating ? h('span', { class: 'rating-chip' }, x.rating) : null, x.grade ? h('span', { class: 'grade' }, x.grade) : null),
      x.county ? h('div', { class: 'small muted' }, x.county) : null);
    fill(peopleBox,
      p.chance ? h('div', { class: 'stack small' },
        h('div', { class: 'muted' }, 'badminfo’s chance before the match', p.upset ? [' ', h('span', { class: 'pill upset' }, 'Upset')] : null),
        h('div', { class: 'chance' }, h('span', { class: 'side-a' }, percent(p.chance.a)), h('div', { class: 'bar' }, h('span', { style: { width: percent(p.chance.a) } })), h('span', { class: 'side-b' }, percents(p.chance.a)[1])))
        : h('p', { class: 'hint' }, 'No win chance: badminfo works it out once the match is played and rated, and only for imports from a badminfo link.'),
      h('div', { class: 'people' }, [0, 1].map((k) => h('div', { class: `team ${k ? 'b' : 'a'}` }, p.teams[k].map(person)))),
      h('div', { class: 'subhead' }, 'Earlier meetings'),
      listMatches(p.meetings, 'None in imported tournaments.'),
      p.opponents ? [h('div', { class: 'subhead' }, 'Opponents’ other filmed matches'), listMatches(p.scouting, 'None filmed yet.')] : null);
  };
  api(`/api/matches/${id}/people?refresh=1`).then(drawPeople).catch((err) => fill(peopleBox, errorNotice(err)));

  // ---- keyboard ----
  function now() { return Math.round(video.currentTime * 100) / 100; }

  function rallyAtOrBefore(t) {
    let found = -1;
    rallies.forEach((r, i) => { if (r.start <= t) found = i; });
    return found;
  }

  // Every key in a box over the editor (? opens it, Esc or ? closes it).
  const keysDialog = h('dialog', { class: 'keys-dialog', 'aria-label': 'Keyboard shortcuts' },
    h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, icon('keyboard'), 'Keyboard shortcuts'), h('button', { class: 'small', onclick: () => keysDialog.close() }, 'Close')),
    h('div', { class: 'keys' }, KEYS.map(([k, t]) => h('div', {}, h('kbd', {}, k), ' ', t))));
  keysDialog.addEventListener('click', (e) => { if (e.target === keysDialog) keysDialog.close(); });
  document.body.append(keysDialog);

  function onKey(e) {
    if (keysDialog.open) {
      if (e.key === '?') { keysDialog.close(); e.preventDefault(); }
      return;
    }
    if (e.target.closest?.('input, textarea, select') && e.key !== 'Escape') return;
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      const last = undo.pop();
      if (last) {
        ({ rallies, sel } = JSON.parse(last));
        changed();
        say('Undone');
      }
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const fps = data.source.fps || 30;
    if (!onTimeline && !VIEW_KEYS.has(key)) return; // no tagging on a render whose times aren't the original's
    switch (key) {
      case ' ': toggle(); break;
      case 'ArrowLeft': video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 10 : 2)); break;
      case 'ArrowRight': video.currentTime = Math.min(duration(), video.currentTime + (e.shiftKey ? 10 : 2)); break;
      case ',': video.pause(); video.currentTime = Math.max(0, video.currentTime - 1 / fps); break;
      case '.': video.pause(); video.currentTime += 1 / fps; break;
      case '[': case ']': {
        const i = SPEEDS.indexOf(video.playbackRate);
        const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + (key === ']' ? 1 : -1)))];
        video.playbackRate = next;
        speedSel.value = String(next);
        say(`${next}×`);
        break;
      }
      case 's':
        openStart = now();
        openBadge.hidden = false;
        say(`Rally starts ${clock(openStart)}`);
        break;
      case 'Escape':
        if (openStart !== null) { openStart = null; openBadge.hidden = true; say('Rally cancelled'); } else select(-1, { seek: false });
        break;
      case 'a': case 'b': case 'l': {
        const w = key === 'l' ? 'let' : key;
        if (openStart !== null) {
          const end = Math.max(now(), openStart + 0.5);
          remember();
          const r = { start: openStart, end, winner: w };
          rallies.push(r);
          const i = sortKeep(r);
          openStart = null;
          openBadge.hidden = true;
          sel = -1;
          changed();
          const after = steps[i]?.after;
          say(`Rally ${i + 1}: ${w === 'let' ? 'let' : `${w.toUpperCase()} wins`}${after ? ` · ${after.points.join('-')}` : ''}`);
        } else if (sel >= 0) {
          setWinner(sel, w, { advance: true });
        } else {
          // Inside (or just after) a rally found by sound: say who won it. Otherwise a new
          // rally ending now, taken to have started 3 s after the one before.
          const t = now();
          const i = rallies.findIndex((r) => t >= r.start && t <= r.end + 1.5);
          if (i >= 0) setWinner(i, w, { advance: false });
          else {
            remember();
            const r = { start: assumedStart(rallies, t, { matchStart }), end: Math.max(t, 1), winner: w };
            rallies.push(r);
            const k = sortKeep(r);
            changed();
            const after = steps[k]?.after;
            say(`Rally ${k + 1}: ${w === 'let' ? 'let' : `${w.toUpperCase()} wins`}${after ? ` · ${after.points.join('-')}` : ''}`);
          }
        }
        break;
      }
      case 'h': {
        const i = sel >= 0 ? sel : rallyAtOrBefore(video.currentTime);
        if (i >= 0) toggleFav(i);
        else say('No rally here to mark');
        break;
      }
      case 'm': setBound('start', now()); break;
      case 'f': setBound('end', now()); break;
      case 'n': goNextUntagged(); break;
      case '+': case '=': zoomBy(0.5); break;
      case '-': zoomBy(2); break;
      case '0': setView(0, duration()); break;
      case '?': keysDialog.showModal(); break;
      case 'ArrowUp': if (rallies.length) select(Math.max(0, sel < 0 ? rallyAtOrBefore(video.currentTime) : sel - 1)); break;
      case 'ArrowDown': if (rallies.length) select(Math.min(rallies.length - 1, sel + 1)); break;
      case 'q': case 'e':
        if (sel >= 0) {
          remember();
          const r = rallies[sel];
          if (key === 'q') r.start = Math.min(now(), r.end - 0.5);
          else r.end = Math.max(now(), r.start + 0.5);
          sel = sortKeep(r);
          changed();
          say(key === 'q' ? 'Start moved' : 'End moved');
        }
        break;
      case 'Delete': case 'Backspace':
        if (sel >= 0) {
          remember();
          rallies.splice(sel, 1);
          sel = Math.min(sel, rallies.length - 1);
          changed();
          say('Rally removed');
        }
        break;
      default: return;
    }
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);

  // ---- layout ----
  const card = (title, iconName, ...body) => h('div', { class: 'card stack' }, h('h4', {}, icon(iconName, 17), title), body);
  const panels = {
    rallies: h('div', {},
      strandedBox,
      card('Rallies', 'list',
        h('div', { class: 'row spread small' }, h('span', { class: 'muted' }, 'S starts a rally, A / B ends it.'), h('button', { class: 'small', onclick: () => goNextUntagged(-1) }, 'Review untagged (N)')),
        listBox),
      card('Find rallies by sound', 'wave',
        h('p', { class: 'hint' }, 'Listens for shuttle hits. Noisy halls with nearby courts may need a lower sensitivity.'),
        h('div', { class: 'row small' }, 'Sensitivity', sens, findBtn),
        findBox)),
    scoring: h('div', {},
      card('Scoring', 'sliders',
        h('div', { class: 'row small' }, pointsSel, h('label', { class: 'row' }, settingBox, 'setting'), capText, bestOfSel),
        h('div', { class: 'row small' }, serverSel, h('span', { class: 'muted' }, `A = ${nameA}, B = ${nameB}`)),
        h('div', { class: 'subhead' }, 'Video starts at'),
        h('div', { class: 'row small' }, startGame, 'score', h('span', { class: 'side-a' }, 'A'), startA, '–', startB, h('span', { class: 'side-b' }, 'B')),
        earlierRow,
        startMsg,
        unitGame ? null : h('p', { class: 'hint' }, 'For videos that start mid-match. “A serves first” then means A serves the first rally in the video.'),
        h('div', { class: 'subhead' }, 'Match in the video'),
        boundsBox,
        h('p', { class: 'hint' }, 'Press M where the match starts and F where it finishes. Warm-up before and anything after are left out of rendering and of finding rallies.'))),
    players: h('div', {}, card('Players', 'user', peopleBox)),
    stats: h('div', {}, card('Statistics', 'wave', statsBox)),
    tracking: h('div', {},
      card('Who won each rally', 'target',
        h('p', { class: 'hint' }, 'TrackNetV3 follows the shuttle. The winner of a rally serves the next one, so the direction of each serve, checked against where the shuttle landed, suggests who won.'),
        trackingBox,
        padBox)),
    export: h('div', {},
      card('Render', 'scissors',
        h('label', { class: 'row small', title: 'How many seconds to keep each side of a rally is in Settings' }, cutBox, 'Cut the gaps between rallies'),
        h('label', { class: 'row small' }, overlayBox, 'Show the scoreboard'),
        h('label', { class: 'row small' }, highlightsBox, 'Highlights only: the ★ rallies, to a separate file', favCount),
        h('div', { class: 'row small' }, h('label', { class: 'row' }, titleCardBox, 'Title card'), h('label', { class: 'row' }, endCardBox, 'End card with the result')),
        h('label', { class: 'row small' }, replaysBox, 'Slow-motion replay after each ★ rally'),
        h('label', { class: 'row small', title: data.voices?.ready ? 'Demucs takes out players’ shouts, coaching and talk by the court, and keeps the shuttle hits. The first time takes a minute or so for a match; also used for clips.' : 'Run analysis\\setup.ps1 once to set this up (see the README)' },
          voicesBox, data.voices?.ready ? 'Remove voices from the sound' : 'Remove voices (not set up yet: run analysis\\setup.ps1)'),
        h('div', { class: 'row' }, renderBtn),
        renderBox,
        highlightsResult,
        renderResult),
      card('YouTube', 'youtube',
        youtube.el,
        h('div', { class: 'row' }, ytInput, h('button', { onclick: saveYt }, 'Save link')),
        ytBox),
      card('Clip of one rally', 'film',
        clipTarget,
        h('div', { class: 'row' }, h('button', { class: 'small primary', onclick: () => makeClip(true) }, 'Upright 9:16 clip'), h('button', { class: 'small', onclick: () => makeClip(false) }, 'Clip as filmed')),
        h('p', { class: 'hint' }, 'For Shorts, Reels or a message: the rally with the seconds from Settings either side and the scoreboard. Upright clips follow the shuttle once it has been tracked.'),
        clipBox),
      card('Scoreboard', 'sliders',
        h('div', { class: 'row small' }, lookSel, cornerSel),
        boardBox,
        h('div', { class: 'row spread small' }, h('span', { class: 'hint' }, 'As it will look at the current moment of the video.'), h('button', { class: 'small', onclick: () => drawBoardPreview() }, 'Refresh')),
        h('p', { class: 'hint' }, 'Colours, size and the rest are in ', h('a', { href: '#/settings' }, 'Settings'), '.'))),
  };
  const TABS = [['rallies', 'Rallies', 'list'], ['scoring', 'Scoring', 'sliders'], ['players', 'Players', 'user'], ['stats', 'Stats', 'wave'], ['tracking', 'Tracking', 'target'], ['export', 'Export', 'scissors']];
  let tab = TABS.some(([k]) => k === readTab()) ? readTab() : 'rallies';
  const tabBar = h('div', { class: 'panel-tabs', role: 'tablist' });
  const panel = h('div', { class: 'panel' });
  const showTab = (k) => {
    tab = k;
    writeTab(k);
    fill(tabBar, TABS.map(([key, label, ic]) => h('button', { role: 'tab', 'aria-selected': String(key === tab), onclick: () => showTab(key) }, icon(ic, 15), label)));
    fill(panel, panels[tab]);
    onTracking = tab === 'tracking';
    if (!onTracking && marking) {
      stopMarking();
      drawTrackingPanel();
    }
    padPlayer();
    if (tab === 'stats' && steps.length) drawStats();
    if (tab === 'export' && steps.length) {
      drawBoardPreview();
      showClipTarget();
    }
    // Opening Tracking on a court not marked yet goes straight to marking it.
    if (onTracking && !corners && !marking && data.tracking.ready) startMarking();
  };
  showTab(tab);
  fill(headRight, saveState);
  renderBtn.prepend(icon('scissors', 16));

  fill(main,
    header,
    h('div', { class: 'editor' },
      h('div', { class: 'video-col' },
        player,
        videoError,
        showNote,
        h('div', { class: 'transport' }, playBtn, timeText, speedSel, muteBtn, showSel,
          h('span', { class: 'zoom' }, h('button', { class: 'ghost icon-only', title: 'Zoom out (−)', onclick: () => zoomBy(2) }, '−'), zoomText,
            h('button', { class: 'ghost icon-only', title: 'Zoom in (+)', onclick: () => zoomBy(0.5) }, '+'),
            h('button', { class: 'small', title: 'Whole video (0)', onclick: () => setView(0, duration()) }, 'Fit'))),
        frames,
        timeline,
        wave,
        scoreStrip,
        h('div', { class: 'legend' },
          h('span', {}, h('i', { class: 'a' }), 'A won'), h('span', {}, h('i', { class: 'b' }), 'B won'), h('span', {}, h('i', { class: 'let' }), 'let'),
          h('span', {}, h('i', { class: 'none' }), 'no winner yet'), h('span', {}, '★ favourite')),
        data.source.hdr ? h('div', { class: 'notice info small' }, 'Filmed in HDR: colours are converted to standard video when rendering.') : null,
        h('details', { class: 'keys-box', open: readKeysOpen(), ontoggle: (e) => writeKeysOpen(e.target.open) }, h('summary', {}, icon('keyboard', 16), 'Keyboard shortcuts'), h('div', { class: 'keys' }, KEYS.map(([k, t]) => h('div', {}, h('kbd', {}, k), ' ', t))))),
      h('div', {},
        h('div', { class: 'card scorecard' }, board, h('div', { class: 'check' }, checkBox)),
        tabBar,
        panel)));
  recompute();
  drawTimeline();
  drawList();
  drawCheck();
  showTime();
  if (tab === 'export') drawBoardPreview();
  drawZoom();
  drawFrames();
  loadLevels();
  loadFiles();
  // The scoreboard preview follows the video while it is paused.
  video.addEventListener('seeked', () => {
    if (tab === 'export' && video.paused) {
      drawBoardPreview();
      showClipTarget();
    }
  });

  return () => {
    window.removeEventListener('keydown', onKey);
    keysDialog.remove();
    clearTimeout(framesTimer);
    resized.disconnect();
    resizedPlayer.disconnect();
    clearTimeout(saveTimer);
    if (saveState.textContent === 'Saving…') save();
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
}
