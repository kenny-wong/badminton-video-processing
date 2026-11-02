// The match editor (#/m/<id>): play the match video, tag each rally's start,
// end and winner from the keyboard, watch the score build up, and render the
// edited video.

import { h, fill, day, gamesView, openButtons } from './dom.js';
import { api, waitJob } from './api.js';
import { boardNames, teamName } from './shared/names.js';
import { assumedStart, boardAt, CAPS, checkResult, cleanFormat, cleanStart, defaultServer, gamesText, parseGames, RALLY_GAP, replay, startFor } from './shared/score.js';
import { clock, clockTenths } from './shared/time.js';
import { apply, CORNER_NAMES, courtLines, courtMapping } from './shared/court.js';
import { frameAt, namePlayers, nearTeams, placePeople } from './shared/people.js';
import { shuttleInPlay } from './shared/shuttle.js';
import { icon } from './icons.js';
import { bannerText, boardFlags, boardHeading, CORNERS, PRESETS } from './shared/board.js';
import { boardPreview } from './board-preview.js';
import { COUNTRIES } from './shared/flags.js';
import { percent, percents } from './shared/players.js';
import { landingNote, landings, matchStats } from './shared/stats.js';
import { landingMap, momentumChart, saveSvgAsPng, statsTables } from './stats-view.js';
import { youtubePanel } from './youtube-panel.js';
import { matchStar } from './match-star.js';
import { backLinks, replacePage } from './nav.js';

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

// A small court as the camera sees it (near end at the bottom), for the marking tip: corners in
// CORNER_NAMES order, those before `active` done, `active` the one to click now.
// Whether to draw the players found in the video (boxes and names), and the
// tracked shuttle, on every tab; per device, on unless turned off.
const PLAYERS_KEY = 'badminton-video:show-players:v1';
const SHUTTLE_KEY = 'badminton-video:show-shuttle:v1';
const readShow = (key, fallback = true) => {
  try {
    const saved = localStorage.getItem(key);
    return saved === '0' ? false : saved === '1' ? true : fallback;
  } catch {
    return fallback;
  }
};
const writeShow = (key, on) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch { /* storage blocked */ }
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const DIAGRAM = [[8, 56], [92, 56], [74, 8], [26, 8]];
function cornerDiagram(active) {
  const s = svgEl('svg', { viewBox: '0 0 100 72', class: 'corner-diagram', 'aria-hidden': 'true' });
  s.append(svgEl('polygon', { points: DIAGRAM.map((p) => p.join(',')).join(' '), class: 'court' }));
  s.append(svgEl('line', { x1: 17, y1: 32, x2: 83, y2: 32, class: 'net' }));
  const camera = svgEl('text', { x: 50, y: 70, 'text-anchor': 'middle' });
  camera.textContent = '▲ camera';
  s.append(camera);
  DIAGRAM.forEach(([x, y], k) => s.append(svgEl('circle', { cx: x, cy: y, r: k === active ? 6.5 : 4, class: k < active ? 'done' : k === active ? 'now' : 'todo' })));
  return s;
}

// Chrome plays from 1/16× to 16×, but mutes the sound below 0.25× and above 4×.
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 16];
const SAVE_DELAY_MS = 800;
const UNDO_DEPTH = 100;
const VIEW_KEYS = new Set([' ', 'ArrowLeft', 'ArrowRight', ',', '.', '[', ']', '?', 'Escape']); // the keys that work on a cut render
const FOLDS_KEY = 'badminton-video:export-folds:v1'; // which folding cards on the Export tab are open
function readFolds() {
  try {
    return JSON.parse(localStorage.getItem(FOLDS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function writeFold(key, open) {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify({ ...readFolds(), [key]: open }));
  } catch { /* storage blocked: the cards start closed next time */ }
}

const KEYS = [
  ['Space', 'play / pause'],
  ['S', 'rally starts now'],
  ['A / B', 'rally ends now, won by A / B (no S: it began the Settings gap after the last one)'],
  ['Shift+A / Shift+B', 'mark the winner and ★ favourite together'],
  ['L', 'let (replayed, no point)'],
  ['↑ / ↓', 'previous / next rally (from the playhead when it has moved away from the selected rally)'],
  ['← / →', 'back / on 2 s (Shift: 10 s)'],
  [', / .', 'one frame back / on'],
  ['[ / ]', 'slower / faster'],
  ['Q / E', 'move selected start / end to now'],
  ['M / F', 'match starts / finishes here'],
  ['H', 'toggle ★ favourite while a rally is running, or for the selected / just-played rally'],
  ['Delete', 'remove selected rally'],
  ['Ctrl+Z', 'undo'],
  ['+ / − / 0', 'zoom the timeline in / out / to the whole video (or the mouse wheel; Shift+wheel moves along)'],
  ['?', 'this list of keys'],
];
/** The keys as shown, with the gap from Settings filled in. */
const keyList = (gap = RALLY_GAP) => KEYS.map(([k, t]) => h('div', {}, h('kbd', {}, k), ' ', t.replace('the Settings gap', `${gap} s`)));

export async function renderEditor(main, id, { runJob, errorNotice, progressBar }) {
  let data = await api(`/api/matches/${id}`);
  const { match, tournament } = data;
  const [nameA, nameB] = boardNames([match.teamA, match.teamB], data.nameStyle);
  const unitGame = match.game || 0; // 1-3 when this video is of one game of the match
  const official = unitGame ? match.games.slice(0, unitGame) : match.games;
  document.title = `${nameA} v ${nameB} · Badminton Video`;

  const headRight = h('div', { class: 'row' });
  // The head stays on screen while scrolling (styles.css .editor-head); its height places the video column under it.
  // Back returns to wherever the editor was opened from (a tournament comes back to this match's place).
  const header = h('div', { class: 'editor-head' },
    h('div', {},
      backLinks(`#/t/${tournament.id}`, tournament.name, 'Open the tournament'),
      h('h1', {}, matchStar(match.id, data.starredMatch), ' ', h('span', { class: 'side-a' }, teamName(match.teamA)), h('span', { class: 'vs' }, 'v'), h('span', { class: 'side-b' }, teamName(match.teamB))),
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
        // Moving between games replaces this page, so Back still goes to where the match was opened from.
        return u.linked
          ? h('a', { href: `#/m/${u.id}`, onclick: (e) => { if (e.button || e.ctrlKey || e.metaKey || e.shiftKey) return; e.preventDefault(); replacePage(`#/m/${u.id}`); } }, label)
          : h('span', { class: 'off', title: 'No video linked' }, label);
      })));
  }

  if (!data.source.ready) {
    const box = h('div', { class: 'card' });
    fill(main, header, box);
    if (data.source.reason === 'missing') {
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
  // Chosen in this editor or known from the result (games 2 and 3); until then the video isn't tagged.
  let serverChosen = match.serverSet !== false;
  let startScore = match.startScore;
  let matchStart = match.matchStart;
  let matchEnd = match.matchEnd;
  let initial = null;
  // With no manual choice, the preview shows once a rally has a winner (the first one tagged).
  const scoreboardKey = `badminton-video:show-scoreboard:v1:${id}`;
  let scoreboardChoice = readShow(scoreboardKey, null);
  let showScoreboard = false;
  let lastVideoBoard = '';
  let shownMoment = null; // the moment the board over the video shows, to flip the numbers that change
  let corners = match.corners;
  let nearAtStart = match.nearAtStart;
  let shuttle = []; // tracked sightings [t, x, y], once loaded
  let showShuttle = readShow(SHUTTLE_KEY);
  let showCourt = true;
  let people = null; // GET /api/matches/:id/detections: everyone YOLO found, once looked for
  let showPlayers = readShow(PLAYERS_KEY);
  let named = null; // the players named in each frame, worked out again when what they depend on changes
  let namedKey = '';
  let marking = null; // corners clicked so far while marking the court
  let onTracking = false; // court lines, marking and black space show only on the Tracking tab
  const pad = readPad();
  let sel = -1;
  let openStart = null;
  let openFavourite = false;
  let steps = [];
  const undo = [];
  let saveTimer = null;
  let saveState = h('span', { class: 'save-state' }, 'Saved');

  // ---- player ----
  const video = h('video', { src: data.source.url, preload: 'auto', playsinline: true });
  // An HDR (phone) original is shown as the render will look at the brightness chosen in Settings
  // (lib/settings.js HDR_LOOKS playback); a finished file is already standard video, shown as it is.
  const showAsRendered = (original) => { video.style.filter = original && data.hdrPlayback ? data.hdrPlayback : ''; };
  showAsRendered(true);
  if (data.source.width && data.source.height) video.style.aspectRatio = `${data.source.width} / ${data.source.height}`;
  const flash = h('div', { class: 'flash', hidden: true });
  const openBadge = h('div', { class: 'open-rally', hidden: true }, '● Rally running');
  const overlay = h('canvas', { class: 'overlay' });
  const videoBoard = h('div', { class: 'video-scoreboard', hidden: true });
  const markTip = h('div', { class: 'mark-tip', hidden: true, role: 'status' });
  // The marked corners, to drag (or nudge with the arrow keys) on the Tracking tab.
  const cornerHandles = CORNER_NAMES.map((name) => h('button', {
    class: 'corner-handle', type: 'button', hidden: true,
    'aria-label': `Move the ${name} corner`, title: `${name} corner: drag to move it (arrow keys nudge it, Shift for 10 px)`,
  }, h('span', {}, name)));
  const player = h('div', { class: 'player' }, video, overlay, videoBoard, ...cornerHandles, markTip, flash, openBadge);
  // Which video the player shows: the original (for tagging) or one of the finished files.
  let files = []; // GET /api/matches/:id/rendered
  let showing = ''; // '' = the original, else a finished file's key
  let onTimeline = true; // false while a cut, slowed or card-framed render plays: its times aren't the original's
  let originalAt = 0; // where the original was when a render took over
  const showSel = h('select', {
    'aria-label': 'Video shown', hidden: true, onchange: () => showVideo(showSel.value, null, { play: true }),
    title: 'Switch between the original video (for tagging) and the rendered ones. A render as long as the original keeps the rally timeline and scores; a cut one, highlights or a clip plays on its own.',
  });
  const showNote = h('div', { class: 'notice info small', hidden: true });
  const deleteBtn = h('button', {
    class: 'ghost icon-only', hidden: true, 'aria-label': 'Delete this rendered video', onclick: () => deleteShown(),
    title: 'Delete this rendered video from the disk. The original video and the tagging stay, and it can be rendered again.',
  }, icon('trash'));
  // While the rally timeline is hidden (a cut render, highlights or a clip), a plain seek bar and jumps move through the video.
  const scrub = h('input', {
    type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Position in the video', title: 'Drag to move through the video',
    oninput: () => { video.currentTime = (scrub.value / 1000) * duration(); },
  });
  const jump = (by, label, tip) => h('button', { class: 'small', title: tip, onclick: () => { video.currentTime = Math.max(0, Math.min(duration(), video.currentTime + by)); } }, label);
  const scrubRow = h('div', { class: 'scrub-row' },
    jump(-10, '« 10 s', 'Back 10 seconds (Shift+←)'), jump(-2, '‹ 2 s', 'Back 2 seconds (←)'),
    scrub,
    jump(2, '2 s ›', 'Forward 2 seconds (→)'), jump(10, '10 s »', 'Forward 10 seconds (Shift+→)'));
  const moveScrub = () => { if (!onTimeline && document.activeElement !== scrub) scrub.value = String(Math.round((video.currentTime / duration()) * 1000)); };
  video.addEventListener('timeupdate', moveScrub);
  video.addEventListener('seeked', moveScrub);
  const playBtn = h('button', { class: 'play-btn', onclick: () => toggle(), 'aria-label': 'Play or pause (Space)', title: 'Play / pause (Space)' }, icon('play', 18));
  const timeText = h('span', { class: 'time' }, '0:00 / 0:00');
  const speedSel = h('select', { 'aria-label': 'Speed', onchange: (e) => { video.playbackRate = Number(e.target.value); } },
    SPEEDS.map((s) => h('option', { value: s, selected: s === 1 }, `${s}×`)));
  const muteBtn = h('button', { class: 'ghost icon-only', onclick: () => { video.muted = !video.muted; fill(muteBtn, icon(video.muted ? 'mute' : 'volume')); }, 'aria-label': 'Mute', title: 'Mute' }, icon('volume'));
  const favouriteBtn = h('button', { class: 'small favourite-rally', onclick: () => toggleFavouriteHere() });
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

  // Where a pointer is, as a fraction of the picture (corners may lie in the black space around it).
  const pictureAt = (e) => {
    const box = pictureBox();
    const r = overlay.getBoundingClientRect();
    return [(e.clientX - r.left - box.x) / box.w, (e.clientY - r.top - box.y) / box.h];
  };
  const roundCorner = (n) => Math.round(Math.min(1.5, Math.max(-0.5, n)) * 10000) / 10000;

  // A click on the picture plays or pauses, except on the Tracking tab, where clicks mark and move the court.
  player.addEventListener('click', (e) => {
    if (onTracking || marking || e.target.closest('button, a, input, select, .corner-handle')) return;
    toggle();
  });

  let hover = null; // the pointer while marking, in canvas px, for the name of the corner being marked
  overlay.addEventListener('pointerdown', (e) => {
    if (!marking) return;
    const [x, y] = pictureAt(e);
    if (x < -0.5 || x > 1.5 || y < -0.5 || y > 1.5) return;
    marking.push([roundCorner(x), roundCorner(y)]);
    if (marking.length === 4) {
      const done = marking;
      stopMarking();
      if (!courtMapping(done)) {
        say('Those corners don’t make a court; try again');
      } else {
        corners = done;
        say('Court marked: drag a corner to adjust it');
        saveTrackingSettings();
      }
      drawTrackingPanel();
    } else {
      say(`Now the ${CORNER_NAMES[marking.length]} corner`);
      drawMarkTip();
    }
    drawOverlay();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!marking) return;
    const r = overlay.getBoundingClientRect();
    hover = [e.clientX - r.left, e.clientY - r.top];
    // The tip keeps out of the way: to the other side when the pointer comes over its half.
    markTip.classList.toggle('right', hover[0] < r.width / 2);
    drawOverlay();
  });
  overlay.addEventListener('pointerleave', () => {
    hover = null;
    drawOverlay();
  });

  // Dragging a marked corner moves the court with it; it is saved when let go, if it still makes a court.
  let dragging = null; // { k, before }
  let nudgeTimer = null;
  function moveCorner(k, [x, y]) {
    corners = corners.map((c, i) => (i === k ? [roundCorner(x), roundCorner(y)] : c));
    drawOverlay();
  }
  function cornerMoved(before, k) {
    if (!courtMapping(corners)) {
      corners = before;
      drawOverlay();
      say('That doesn’t make a court: the corner went back');
      return false;
    }
    say(`${CORNER_NAMES[k][0].toUpperCase()}${CORNER_NAMES[k].slice(1)} corner moved`);
    return true;
  }
  cornerHandles.forEach((el, k) => {
    el.addEventListener('pointerdown', (e) => {
      if (!corners) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      dragging = { k, before: corners.map((c) => [...c]) };
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (dragging?.k === k) moveCorner(k, pictureAt(e));
    });
    const drop = () => {
      if (dragging?.k !== k) return;
      const { before } = dragging;
      dragging = null;
      el.classList.remove('dragging');
      if (cornerMoved(before, k)) saveTrackingSettings();
    };
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
    el.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!step || !corners) return;
      e.preventDefault();
      e.stopPropagation(); // not the editor's keys (seeking, rallies)
      const box = pictureBox();
      const n = e.shiftKey ? 10 : 1;
      const before = corners.map((c) => [...c]);
      moveCorner(k, [corners[k][0] + (step[0] * n) / box.w, corners[k][1] + (step[1] * n) / box.h]);
      if (!cornerMoved(before, k)) return;
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(saveTrackingSettings, 600);
    });
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
  // The button shows what the player is doing. Loading another file cancels the "pause" event of the one
  // before (when switching videos while playing), so it also follows a new file being loaded.
  const showPlaying = () => fill(playBtn, icon(video.paused ? 'play' : 'pause', 18));
  video.addEventListener('play', () => { showPlaying(); tick(); });
  video.addEventListener('pause', () => { showPlaying(); showTime(); });
  for (const name of ['emptied', 'loadstart', 'ended']) video.addEventListener(name, showPlaying);
  video.addEventListener('loadedmetadata', () => { drawTimeline(); showTime(); });

  /**
   * Shows the original ('') or a finished file, playing it with `play`; the timeline stays only when the
   * file is as long as the original.
   */
  function showVideo(key, seekTo = null, { play = false } = {}) {
    const file = files.find((f) => f.key === key) ?? null;
    if (!showing) originalAt = video.currentTime;
    const at = seekTo ?? (onTimeline ? video.currentTime : originalAt);
    showing = file ? file.key : '';
    showSel.value = showing;
    deleteBtn.hidden = !file; // the original can't be deleted
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
      if (play) video.play().catch(() => {});
    }, { once: true });
    showAsRendered(!file);
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
  const previewBox = h('input', {
    type: 'checkbox',
    onchange: (e) => {
      scoreboardChoice = showScoreboard = e.target.checked;
      writeShow(scoreboardKey, scoreboardChoice);
      drawOverlay();
    },
  });
  const checkBox = h('div', { class: 'small' });
  const listBox = h('div', { class: 'rallies' });
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
    drawMarkTip();
    drawTrackingPanel();
  }

  function stopMarking() {
    marking = null;
    hover = null;
    overlay.classList.remove('marking');
    drawMarkTip();
  }

  // Which corner to click now, in words and on a small court, while marking.
  function drawMarkTip() {
    markTip.hidden = !marking;
    if (!marking) return;
    const k = marking.length;
    fill(markTip, cornerDiagram(k),
      h('div', { class: 'stack' },
        h('div', {}, `Corner ${k + 1} of 4`),
        h('div', { class: 'mark-tip-name' }, CORNER_NAMES[k]),
        h('div', { class: 'mark-tip-hint' }, 'Near = nearest the camera · Esc stops')));
  }

  // The shuttle sightings to draw: over the marked court and in play (not lying on the floor), worked out
  // again when the sightings or the court change. Stats and clips keep using every sighting.
  let shownShuttle = null;
  let shownKey = '';
  function shuttleShown() {
    const key = `${shuttle.length}|${JSON.stringify(corners)}`;
    if (!shownShuttle || key !== shownKey) {
      shownShuttle = shuttleInPlay(shuttle, corners);
      shownKey = key;
    }
    return shownShuttle;
  }

  // ---- the players found in the video, with their names ----
  // Named again only when something they depend on changes: the court, the ends, the score, the name order.
  function namedPlayers() {
    const key = [JSON.stringify(corners), nearAtStart, people.swap?.a, people.swap?.b, JSON.stringify(format),
      rallies.map((r) => `${Math.round(r.end)}${r.winner?.[0] ?? '-'}`).join('')].join('|');
    if (named && key === namedKey) return named;
    const map = corners && courtMapping(corners);
    const frames = placePeople(people, map?.toCourt ?? null);
    const timeline = nearTeams({ rallies, steps, initial, rules: cleanFormat(format), nearAtStart: nearAtStart ?? 'a' });
    named = map ? namePlayers(frames, { timeline, names: { a: match.teamA, b: match.teamB }, swap: people.swap }) : frames.map((f) => ({ t: f.t, players: [], everyone: f.people }));
    if (map) frames.forEach((f, k) => { named[k].everyone = f.people; });
    namedKey = key;
    return named;
  }

  // Boxes on the players and their names above them (everyone found, unnamed, until the court is marked).
  function drawPlayers(g, box) {
    const list = namedPlayers();
    const k = frameAt(list, video.currentTime);
    if (k < 0 || video.currentTime - list[k].t > 0.3) return;
    const at = ([x, y]) => [box.x + x * box.w, box.y + y * box.h];
    g.font = '650 12px "Segoe UI", system-ui, sans-serif';
    if (!corners) {
      g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      g.lineWidth = 1.5;
      for (const p of list[k].everyone) {
        const [x1, y1] = at(p.box);
        const [x2, y2] = at([p.box[2], p.box[3]]);
        g.strokeRect(x1, y1, x2 - x1, y2 - y1);
      }
      return;
    }
    for (const p of list[k].players) {
      const [x1, y1] = at(p.box);
      const [x2, y2] = at([p.box[2], p.box[3]]);
      const colour = p.team === 'a' ? '#2a78d6' : '#e8642c';
      g.strokeStyle = colour;
      g.lineWidth = 2;
      g.strokeRect(x1, y1, x2 - x1, y2 - y1);
      // The name on a tag in the team's colour, above the head.
      const w = g.measureText(p.name).width + 10;
      const ty = Math.max(0, y1 - 19);
      g.fillStyle = colour;
      g.fillRect(x1, ty, w, 17);
      g.fillStyle = '#fff';
      g.fillText(p.name, x1 + 5, ty + 13);
    }
  }

  async function loadPeople() {
    try {
      people = await api(`/api/matches/${id}/detections`);
      named = null;
      drawOverlay();
      drawTrackingPanel();
    } catch { /* not looked for yet */ }
  }

  // The corner handles sit on the marked corners while the court shows on the Tracking tab.
  function placeHandles(box) {
    const show = Boolean(onTracking && corners && showCourt && !marking && !showing);
    cornerHandles.forEach((el, k) => {
      el.hidden = !show;
      if (!show) return;
      el.style.left = `${box.x + corners[k][0] * box.w}px`;
      el.style.top = `${box.y + corners[k][1] * box.h}px`;
    });
  }

  function drawOverlay() {
    const box = pictureBox();
    drawVideoBoard(box);
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
    placeHandles(box);
    // The shuttle, players and court belong to the original's picture and timeline: a rendered file
    // is cut (and has its own scoreboard), so they'd land in the wrong places on it.
    if (showing) return;
    const px = ([x, y]) => [box.x + x * box.w, box.y + y * box.h];
    if (showPlayers && people) drawPlayers(g, box);
    if (showShuttle && shuttle.length) {
      const t = video.currentTime;
      const shown = shuttleShown(); // over the court and in play only
      let i = lowerBound(shown, t - 0.5);
      const trail = [];
      for (; i < shown.length && shown[i][0] <= t + 0.02; i++) trail.push(shown[i]);
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
    if (!onTracking) return;
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
      // The corners so far, joined in order (and on to the pointer), each with its name.
      const points = marking.map(px);
      g.strokeStyle = 'rgba(255, 216, 77, 0.9)';
      g.lineWidth = 1.5;
      g.setLineDash([6, 4]);
      g.beginPath();
      [...points, ...(hover ? [hover] : [])].forEach((p, k) => (k ? g.lineTo(...p) : g.moveTo(...p)));
      if (hover && points.length === 3) g.lineTo(...points[0]);
      g.stroke();
      g.setLineDash([]);
      g.font = '650 12px "Segoe UI", system-ui, sans-serif';
      const label = (text, x, y) => {
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        g.strokeText(text, x, y);
        g.fillStyle = '#ffd84d';
        g.fillText(text, x, y);
      };
      points.forEach(([x, y], k) => {
        g.fillStyle = '#ffd84d';
        g.strokeStyle = '#000';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        label(CORNER_NAMES[k], x + 9, y - 8);
      });
      if (hover) label(`${marking.length + 1}. ${CORNER_NAMES[marking.length]}`, hover[0] + 14, hover[1] - 12);
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
  function scoreboardMoment() {
    const s = boardAt(rallies, steps, video.currentTime, initial);
    const i = rallies.findLastIndex((r, j) => r.end <= video.currentTime && steps[j]?.counted);
    const st = steps[i];
    const banner = st?.event && video.currentTime - rallies[i].end < 6 ? bannerText({ kind: st.event, winner: rallies[i].winner, before: st.before, after: st.after }, [nameA, nameB], format) : '';
    return {
      names: [nameA, nameB], state: s, style: data.board, flags: boardFlags(s, format),
      heading: boardHeading(data.board, { tournament, match }), banner,
      width: data.source.width || 1920, height: data.source.height || 1080,
    };
  }

  function drawVideoBoard(box) {
    videoBoard.hidden = !showScoreboard || Boolean(showing);
    if (videoBoard.hidden) return;
    Object.assign(videoBoard.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    const moment = scoreboardMoment();
    const key = JSON.stringify(moment);
    if (key === lastVideoBoard) return;
    // Numbers flip when the score moves on while playing, not when jumping about the video.
    const flip = !video.paused && !video.seeking && shownMoment;
    lastVideoBoard = key;
    fill(videoBoard, boardPreview({ ...moment, transparent: true, before: flip ? shownMoment : null }));
    shownMoment = moment;
  }

  function showTime() {
    drawOverlay();
    drawFavouriteControl();
    const t = video.currentTime;
    timeText.textContent = `${clockTenths(t)} / ${clock(duration())}`;
    // While playing, the zoomed timeline turns the page when the playhead runs off its end.
    if (view.to !== null && !video.paused && (t > viewTo() || t < view.from)) setView(t - span() * 0.05, t + span() * 0.95);
    playhead.style.left = `${pct(t)}%`;
    playhead.hidden = t < view.from || t > viewTo();
    const s = boardAt(rallies, steps, t, initial);
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
    const result = replay(rallies, format, firstServer, startFor({ ...match, startScore }), { oneGame: unitGame > 0 });
    ({ steps, initial } = result);
    showScoreboard = scoreboardChoice ?? rallies.some((r) => r.winner);
    previewBox.checked = showScoreboard;
    lastVideoBoard = '';
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
      // The first server goes only once chosen: sending it is what marks it chosen.
      await api(`/api/matches/${id}`, { method: 'PUT', body: { rallies, format: formatChosen ? format : null, firstServer: serverChosen ? firstServer : undefined, startScore, matchStart, matchEnd, corners, nearAtStart } });
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

  function setWinner(i, w, { favourite = false } = {}) {
    remember();
    rallies[i].winner = favourite ? w : rallies[i].winner === w ? null : w;
    if (favourite) rallies[i].fav = true;
    changed();
    const after = steps[i]?.after;
    say(`Rally ${i + 1}: ${w === 'let' ? 'let' : `${w.toUpperCase()} wins`}${after ? ` · ${after.points.join('-')}` : ''}${favourite ? ' · ★ favourite' : ''}`);
  }

  function toggleFav(i) {
    if (!rallies[i]) return;
    remember();
    if (rallies[i].fav) delete rallies[i].fav;
    else rallies[i].fav = true;
    changed();
    say(`Rally ${i + 1}: ${rallies[i].fav ? '★ favourite' : 'not a favourite'}`);
  }

  function favouriteIndex() {
    return sel >= 0 ? sel : rallyAtOrBefore(video.currentTime);
  }

  function drawFavouriteControl() {
    const i = favouriteIndex();
    const running = openStart !== null;
    const fav = running ? openFavourite : Boolean(rallies[i]?.fav);
    const target = running ? 'This rally' : i >= 0 ? `Rally ${i + 1}` : 'Favourite rally';
    const label = `${fav ? '★' : '☆'} ${target} (H)`;
    if (favouriteBtn.textContent !== label) favouriteBtn.textContent = label;
    favouriteBtn.disabled = !onTimeline || (!running && i < 0);
    favouriteBtn.classList.toggle('on', fav);
    favouriteBtn.setAttribute('aria-pressed', String(fav));
    favouriteBtn.title = `${fav ? 'Remove favourite from' : 'Mark as favourite:'} ${target.toLowerCase()} (H). Shift+A / Shift+B marks the winner and favourite together.`;
    openBadge.textContent = openFavourite ? '★ Rally running' : '● Rally running';
  }

  function toggleFavouriteHere() {
    if (!onTimeline) return;
    if (openStart !== null) {
      openFavourite = !openFavourite;
      drawFavouriteControl();
      say(openFavourite ? 'This rally will be a ★ favourite when it ends' : 'This rally is no longer a favourite');
      return;
    }
    const i = favouriteIndex();
    if (i >= 0) toggleFav(i);
    else say('No rally here to mark');
  }

  function select(i, { seek = true, lead = 1 } = {}) {
    sel = i;
    drawTimeline();
    drawList();
    drawFavouriteControl();
    if (tab === 'export') showClipTarget();
    if (seek && rallies[i] && !onTimeline) showVideo('', Math.max(0, rallies[i].start - lead));
    else if (seek && rallies[i]) video.currentTime = Math.max(0, rallies[i].start - lead);
  }

  function drawList() {
    const rows = rallies.map((r, i) => {
      const s = steps[i];
      const score = !s ? '' : !s.counted ? (s.reason === 'afterMatch' ? 'after match end' : s.reason === 'let' ? 'let' : '') : s.event === 'game' || s.event === 'match' ? `G${s.after.games.length} ${s.after.games.at(-1).join('-')}` : s.after.points.join('-');
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
      }, w === 'let' ? 'Let' : w.toUpperCase()))),
      h('td', { class: 'nowrap' }, score),
      h('td', {}, h('button', { class: `star${r.fav ? ' on' : ''}`, title: r.fav ? 'Favourite (H)' : 'Mark as favourite (H)', 'aria-pressed': String(Boolean(r.fav)), onclick: () => toggleFav(i) }, r.fav ? '★' : '☆')),
      h('td', {}, h('button', { class: 'small remove', title: 'Remove this rally', onclick: () => { remember(); rallies.splice(i, 1); if (sel >= rallies.length) sel = -1; changed(); } }, '✕')));
    });
    fill(listBox, rallies.length
      ? h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Start', 'Len', 'Winner', 'Score', '★', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))
      : h('p', { class: 'muted small', style: { padding: '8px 12px' } }, 'No rallies yet. Press S when a rally starts and A or B when it ends.'));
  }

  // ---- tagging settings ----
  const pointsSel = h('select', { 'aria-label': 'Points per game' }, [21, 15, 11].map((p) => h('option', { value: p, selected: format.points === p }, `${p} points`)));
  const settingBox = h('input', { type: 'checkbox', checked: format.setting });
  const bestOfSel = h('select', { 'aria-label': 'Games' }, h('option', { value: 3, selected: format.bestOf === 3 }, 'best of 3'), h('option', { value: 1, selected: format.bestOf === 1 }, 'one game'));
  const capText = h('span', { class: 'small muted' });
  const formatChanged = () => {
    format = cleanFormat({ points: Number(pointsSel.value), setting: settingBox.checked, bestOf: Number(bestOfSel.value) });
    formatChosen = true;
    capText.textContent = format.setting ? `to ${CAPS[format.points]}` : '';
    changed();
  };
  for (const el of [pointsSel, settingBox, bestOfSel]) el.addEventListener('change', formatChanged);
  capText.textContent = format.setting ? `to ${CAPS[format.points]}` : '';
  // In game 2 or 3 the winner of the game before serves first (from the official result).
  const lawServer = unitGame >= 2 && match.games[unitGame - 2] ? defaultServer(unitGame, match.games) : null;
  const serverHint = h('p', { class: 'hint' });
  const showServerHint = () => {
    if (!lawServer) return;
    const who = lawServer === 'a' ? 'A' : 'B';
    serverHint.textContent = firstServer === lawServer
      ? `${who} won game ${unitGame - 1}, so ${who} serves first in game ${unitGame}.`
      : `${who} won game ${unitGame - 1}, so ${who} should serve first in game ${unitGame} (the winner of a game serves first in the next).`;
    serverHint.classList.toggle('warn-text', firstServer !== lawServer);
  };
  const serverSel = h('select', {
    'aria-label': 'First server',
    onchange: (e) => {
      if (!e.target.value) return;
      firstServer = e.target.value;
      serverChosen = true;
      serveRow?.classList.remove('needs-choice');
      serveRow?.querySelector('.serve-needed')?.remove();
      e.target.querySelector('option[value=""]')?.remove();
      showServerHint();
      changed();
    },
  },
  serverChosen ? null : h('option', { value: '', selected: true }, 'Choose who serves first…'),
  h('option', { value: 'a', selected: serverChosen && firstServer === 'a' }, 'A serves first'), h('option', { value: 'b', selected: serverChosen && firstServer === 'b' }, 'B serves first'));
  let serveRow = null;
  showServerHint();

  // ---- the score when the video starts ----
  const startGame = h('select', { 'aria-label': 'Game the video starts in' }, [1, 2, 3].map((g) => h('option', { value: g }, `game ${g}`)));
  const startA = h('input', { type: 'number', min: 0, max: 30, value: startScore?.points[0] ?? 0, 'aria-label': 'A points', style: { width: '3.6em' } });
  const startB = h('input', { type: 'number', min: 0, max: 30, value: startScore?.points[1] ?? 0, 'aria-label': 'B points', style: { width: '3.6em' } });
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
  const boundsBox = h('div', { class: 'row tight small' });
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
    const part = (label, which, t) => h('span', { class: 'row tight' },
      `${label} `, h('strong', {}, t === null ? (which === 'start' ? 'video start' : 'video end') : clock(t)),
      t !== null ? h('button', { class: 'small', onclick: () => { video.currentTime = t; } }, 'Go') : null,
      t !== null ? h('button', { class: 'small', onclick: () => setBound(which, null) }, 'Clear') : null);
    fill(boundsBox, part('from', 'start', matchStart), h('span', { class: 'muted' }, '·'), part('to', 'end', matchEnd));
  }

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

  // ---- shuttle tracking: court, ends, TrackNetV3 ----
  const trackingBox = h('div', { class: 'stack' });
  const trackJobBox = h('div');
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

  // Finding the players (YOLO), showing them, and putting a doubles pair's names the right way round.
  const peopleJobBox = h('div');
  function playersControls() {
    if (!data.findPlayers?.ready) return h('p', { class: 'hint' }, 'Finding players isn’t set up on this PC yet: run ', h('kbd', {}, 'analysis\\setup.ps1'), ' again.');
    const swap = (team) => {
      people.swap = { ...people.swap, [team]: !people.swap?.[team] };
      named = null;
      drawOverlay();
      api(`/api/matches/${id}/detections`, { method: 'PUT', body: { swap: people.swap } }).catch((err) => fill(peopleJobBox, errorNotice(err)));
    };
    const pair = (team) => (people && (team === 'a' ? match.teamA : match.teamB).length > 1
      ? h('button', { class: 'small', title: 'The partners are told apart by shirt colour: swap if the names are the wrong way round', onclick: () => swap(team) }, `Swap ${team.toUpperCase()}’s names`)
      : null);
    return h('div', { class: 'stack' },
      h('div', { class: 'row small' },
        h('button', {
          class: people ? 'small' : 'small primary',
          title: 'Find and follow everyone in the video with YOLO on the graphics card (a few minutes), then name the players on the court',
          disabled: peopleBusy,
          onclick: () => followPeople(() => api(`/api/matches/${id}/detections`, { method: 'POST' })),
        }, people ? 'Find players again' : 'Find players'),
        people ? h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: showPlayers, onchange: (e) => { showPlayers = e.target.checked; writeShow(PLAYERS_KEY, showPlayers); drawOverlay(); } }), 'Show players and their names') : null,
        pair('a'), pair('b')),
      people && !corners ? h('div', { class: 'hint' }, 'Mark the court so the players on it can be named; until then everyone found is boxed.') : null,
      people && corners && !nearAtStart ? h('div', { class: 'hint' }, 'Choose who is at the near end when the video starts, or the names may be on the wrong players.') : null,
      peopleJobBox);
  }

  function drawTrackingPanel() {
    if (!data.tracking.ready) {
      fill(trackingBox, h('p', { class: 'hint' }, 'Not set up on this PC yet. Run ', h('kbd', {}, 'analysis\\setup.ps1'), ' once (it installs TrackNetV3 and PyTorch; see the README).'));
      return;
    }
    const nearSel = h('select', { 'aria-label': 'Team at the near end', onchange: (e) => { nearAtStart = e.target.value || null; saveTrackingSettings(); drawOverlay(); drawTrackingPanel(); } },
      h('option', { value: '', selected: !nearAtStart }, 'Choose…'),
      h('option', { value: 'a', selected: nearAtStart === 'a' }, `A (${nameA})`),
      h('option', { value: 'b', selected: nearAtStart === 'b' }, `B (${nameB})`));
    fill(trackingBox,
      h('div', { class: 'row small' },
        h('button', { class: 'small', onclick: startMarking }, corners ? 'Mark the court again' : 'Mark the court'),
        marking ? h('span', { class: 'muted' }, `Click the 4 outer corners: ${CORNER_NAMES.join(', ')} (near = nearest the camera). Esc stops.`) : null,
        corners && !marking ? h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: showCourt, onchange: (e) => { showCourt = e.target.checked; drawOverlay(); drawTrackingPanel(); } }), 'Show court lines') : null),
      corners && !marking && showCourt ? h('div', { class: 'hint' }, 'Drag a yellow corner on the video to move it; the court lines follow. A focused corner moves with the arrow keys (Shift: 10 px).') : null,
      h('div', { class: 'row small' }, 'At the near end when the video starts:', nearSel),
      unitGame && match.games.length > 1 ? h('div', { class: 'hint' }, 'The match’s other game videos follow: players change ends after each game.') : null,
      h('div', { class: 'row small' },
        h('button', {
          class: tracked ? 'small' : 'small primary',
          disabled: trackBusy,
          onclick: () => followTrack(() => api(`/api/matches/${id}/track`, { method: 'POST' })),
        }, tracked ? 'Track again' : 'Track the shuttle'),
        tracked ? h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: showShuttle, onchange: (e) => { showShuttle = e.target.checked; writeShow(SHUTTLE_KEY, showShuttle); drawOverlay(); } }), 'Show the shuttle on the video') : null),
      trackJobBox,
      playersControls());
  }
  // Tracking and finding players run as jobs: followed here when started, or when the editor opens while one
  // is still queued or running, with the button off until it ends (the panel is redrawn often, so a flag keeps it).
  let trackBusy = false;
  let peopleBusy = false;
  async function followTrack(start) {
    trackBusy = true;
    drawTrackingPanel();
    try {
      const r = await runJob(trackJobBox, start);
      tracked = true;
      fill(trackJobBox, h('div', { class: 'notice ok small' }, `Shuttle seen in ${Math.round((r.seen / Math.max(1, r.frames)) * 100)}% of ${r.frames} frames.`));
      await loadShuttle();
    } catch (err) {
      fill(trackJobBox, errorNotice(err));
    }
    trackBusy = false;
    drawTrackingPanel();
  }
  async function followPeople(start) {
    peopleBusy = true;
    drawTrackingPanel();
    try {
      const r = await runJob(peopleJobBox, start);
      fill(peopleJobBox, h('div', { class: 'notice ok small' }, `Found people in ${r.frames.toLocaleString('en-GB')} frames.`));
      showPlayers = true;
      writeShow(PLAYERS_KEY, true);
      await loadPeople();
    } catch (err) {
      fill(peopleJobBox, errorNotice(err));
    }
    peopleBusy = false;
    drawTrackingPanel();
  }
  const stillRunning = (job) => job && (job.status === 'queued' || job.status === 'running');
  drawTrackingPanel();
  if (tracked) loadShuttle();
  loadPeople();
  if (stillRunning(data.jobs?.track)) followTrack(async () => data.jobs.track);
  if (stillRunning(data.jobs?.people)) followPeople(async () => data.jobs.people);

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
  // Flags come from the players' nations (Players page) unless chosen for this match.
  const playerCountries = data.playerCountries ?? ['', ''];
  const countrySelects = ['A', 'B'].map((side, k) => h('select', { 'aria-label': `Team ${side} country` },
    h('option', { value: 'auto', selected: !boardStyle?.countries }, `From the Players list: ${COUNTRIES[playerCountries[k]] ?? 'no flag'}`),
    h('option', { value: '', selected: boardStyle?.countries?.[k] === '' }, 'No flag'), Object.entries(COUNTRIES).sort((a,b) => a[1].localeCompare(b[1])).map(([code, label]) =>
      h('option', { value: code, selected: boardStyle?.countries?.[k] === code }, label))));
  const countryControls = h('div', { class: 'board-countries' }, countrySelects.map((el,k) => h('label', { class: 'cf-field' }, h('span', { class: 'small muted' }, `Team ${k ? 'B' : 'A'} country`), el)));
  const showCountryControls = () => { countryControls.hidden = data.board.layout !== 'international'; };
  showCountryControls();
  const boardBox = h('div', { class: 'preview-frame small-preview' });
  const drawBoardPreview = () => {
    fill(boardBox, boardPreview({
      ...scoreboardMoment(), background: `/media/thumb/${id}`,
    }));
  };
  let lookSave = Promise.resolve();
  let lookRevision = 0;
  const lookChanged = async () => {
    const revision = ++lookRevision;
    // Both on "From the Players list": no countries of its own, so the players' nations keep applying.
    const picked = countrySelects.map(el => el.value);
    const countries = picked.map((v, k) => (v === 'auto' ? playerCountries[k] : v));
    boardStyle = { ...(lookSel.value ? { preset: lookSel.value } : {}), ...(cornerSel.value ? { corner: cornerSel.value } : {}),
      ...(picked.some((v) => v !== 'auto') ? { countries } : {}) };
    const next = boardStyle;
    try {
      // Keep rapid changes to the two countries in order, and display the latest choice.
      const r = await (lookSave = lookSave.catch(() => {}).then(() => api(`/api/matches/${id}`, { method: 'PUT', body: { boardStyle: next } })));
      if (revision !== lookRevision) return;
      boardStyle = r.boardStyle;
      data.board = r.board; // Settings' look with this match's choice on top, as the render will use
      showCountryControls();
      drawBoardPreview();
      drawOverlay();
      say('Scoreboard look saved');
    } catch (err) {
      say(err.message);
    }
  };
  lookSel.addEventListener('change', lookChanged);
  cornerSel.addEventListener('change', lookChanged);
  countrySelects.forEach(el => el.addEventListener('change', lookChanged));

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
  // ---- a comment on this match or game: at the end of its videos' YouTube descriptions ----
  const commentState = h('span', { class: 'small muted' }, match.comment ? 'Saved' : '');
  let commentTimer = null;
  const commentBox = h('textarea', {
    class: 'comment-box', rows: 4, maxlength: 2000, value: match.comment ?? '',
    placeholder: 'Anything to say about this game: who played well, what happened, a thank-you…',
    'aria-label': 'Comment for the YouTube description',
  });
  async function saveComment() {
    clearTimeout(commentTimer);
    commentTimer = null;
    try {
      await api(`/api/matches/${id}`, { method: 'PUT', body: { comment: commentBox.value } });
      commentState.textContent = 'Saved';
      loadFiles(); // the YouTube box shows the descriptions with it
    } catch (err) {
      commentState.textContent = `Not saved: ${err.message}`;
    }
  }
  commentBox.addEventListener('input', () => {
    clearTimeout(commentTimer);
    commentState.textContent = 'Saving…';
    commentTimer = setTimeout(saveComment, 800);
  });

  /** The finished files, for the player's switch and the YouTube box (which can also upload the original). */
  let original = null;
  async function loadFiles() {
    try {
      ({ files, original } = await api(`/api/matches/${id}/rendered`));
    } catch {
      return;
    }
    fill(showSel, h('option', { value: '' }, 'Original'), files.map((f) => h('option', { value: f.key }, `Rendered: ${f.label}`)));
    showSel.hidden = !files.length;
    if (showing && !files.some((f) => f.key === showing)) showVideo('');
    else showSel.value = showing;
    youtube.setFiles(original ? [...files, original] : files);
  }
  /** Deletes the rendered file the player shows, switching back to the original first so Windows lets go of it. */
  async function deleteShown() {
    const file = files.find((f) => f.key === showing);
    if (!file || !confirm(`Delete the ${file.label.toLowerCase()} from the disk?\n\nThe original video and the tagging stay, and you can render it again.`)) return;
    showVideo('');
    try {
      const r = await api(`/api/matches/${id}/rendered?key=${encodeURIComponent(file.key)}`, { method: 'DELETE' });
      if (r.kind === 'video') showOutput(data.output, false);
      if (r.kind === 'highlights') showHighlights(false);
      say(`Deleted the ${file.label.toLowerCase()}`);
    } catch (err) {
      say(err.message);
    }
    loadFiles();
  }
  let renderJob = null; // the render being followed, while it waits or runs: the button stops it
  const renderBtn = h('button', {
    class: 'primary',
    onclick: async () => {
      if (renderJob) {
        if (!confirm('Stop this render? What it has made so far is thrown away; render again to start over.')) return;
        renderBtn.disabled = true;
        await api(`/api/jobs/${renderJob.id}/stop`, { method: 'POST' }).catch((err) => say(err.message));
        return; // the job ends as stopped, and followRender puts the button back
      }
      clearTimeout(saveTimer);
      await save();
      const untagged = rallies.filter((r) => !r.winner).length;
      if (highlightsBox.checked && !rallies.some((r) => r.fav)) return say('Mark some favourite rallies first (☆ or H)');
      if (overlayBox.checked && untagged && !confirm(`${untagged} rallies have no winner, so the scoreboard will skip them. Render anyway?`)) return;
      followRender(() => api(`/api/matches/${id}/render`, { method: 'POST', body: { cut: cutBox.checked, overlay: overlayBox.checked, highlights: highlightsBox.checked, titleCard: titleCardBox.checked, endCard: endCardBox.checked, replays: replaysBox.checked, removeVoices: voicesBox.checked } }));
    },
  });
  const drawRenderBtn = () => {
    renderBtn.className = renderJob ? 'danger' : 'primary';
    renderBtn.title = renderJob ? 'Stops this render (it can wait in the queue or be part-way through)' : '';
    fill(renderBtn, icon(renderJob ? 'stop' : 'export', 16), renderJob ? 'Stop rendering' : 'Render video');
  };
  drawRenderBtn();
  // Shows a render's progress (one just asked for, or one still queued or running from before
  // the editor was opened); meanwhile the button stops it.
  async function followRender(start) {
    renderBtn.disabled = true;
    const jobBox = h('div');
    renderBox.replaceChildren(jobBox);
    try {
      const r = await runJob(jobBox, async () => {
        renderJob = await start();
        renderBtn.disabled = false;
        drawRenderBtn();
        return renderJob;
      });
      fill(jobBox, h('div', { class: 'notice ok' }, `Done: ${clock(r.seconds)} of ${r.highlights ? 'highlights' : 'video'} in ${r.parts} part${r.parts === 1 ? '' : 's'}.`), h('div', { class: 'small muted' }, r.path));
      if (r.highlights) showHighlights(true);
      else showOutput(r, true);
      loadFiles();
    } catch (err) {
      fill(jobBox, err.code === 'stopped' ? h('div', { class: 'notice small' }, 'Render stopped.') : errorNotice(err));
    }
    renderJob = null;
    renderBtn.disabled = false;
    drawRenderBtn();
  }
  if (stillRunning(data.jobs?.render)) followRender(async () => data.jobs.render);

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
    const spots = corners && shuttle.length ? landings(rallies, shuttle, courtMapping(corners)?.toCourt) : null;
    const map = spots && landingMap(spots, { colours: { ...colours, court: '#2f6d4f' }, onRally: playRally });
    const withWinner = rallies.filter((r) => r.winner === 'a' || r.winner === 'b').length;
    fill(statsBox,
      statsTables(s, [nameA, nameB], { onRally: playRally }),
      levels?.hits ? null : h('p', { class: 'hint' }, 'Shot counts come from the hit sounds, worked out when the sound strip under the timeline is drawn.'),
      chart ? [h('div', { class: 'row spread' }, h('div', { class: 'subhead' }, 'Momentum'),
        h('button', {
          class: 'small',
          onclick: () => saveSvgAsPng(momentumChart(s, [nameA, nameB], { colours: { a: '#2a78d6', b: '#e8642c', text: '#333333', grid: '#bbbbbb' }, background: '#ffffff', width: 900, height: 360, fontSize: 15 }),
            `${nameA} v ${nameB} momentum.png`.replace(/[\\/:*?"<>|]/g, ' ')),
        }, 'Save as picture')), chart] : null,
      h('div', { class: 'subhead' }, 'Where rallies ended'),
      map ? [map, h('p', { class: 'hint' }, landingNote(spots.length, withWinner))]
        : h('p', { class: 'hint' }, 'Mark the court and track the shuttle (Tracking tab) to see where each rally ended. Only as good as the tracking: from a low camera the last sighting is often in the air.'));
  }

  // Plays rally i from a second before it starts (the stats' "rally n" links and the landing map's dots).
  function playRally(i) {
    if (!rallies[i]) return;
    select(i);
    video.play().catch(() => {});
  }

  // ---- players: badminfo ratings, win chance, earlier meetings ----
  const peopleBox = h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Reading the players from badminfo…'));
  const listMatches = (list, empty) => (list.length
    ? h('ul', { class: 'match-list' }, list.map((m) => h('li', {},
      h('div', { class: 'row spread' },
        h('span', {}, `${teamName(m.teamA)} v ${teamName(m.teamB)}`),
        m.filmed ? openButtons(m.units) : null),
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

  // The selected rally counts only while the playhead is at it (from the 1 s lead-in picking it seeks to, to
  // 1.5 s after its end): moved away (scrolled, sought, played on), the keys work from where the playhead is.
  const atSelected = (t = video.currentTime) => sel >= 0 && Boolean(rallies[sel]) && t >= rallies[sel].start - 1.5 && t <= rallies[sel].end + 1.5;

  // ↑ / ↓: the rally before / after the selected one while at it, else the one before / after the playhead
  // (↑ from inside a rally goes to its start).
  function stepRally(dir) {
    if (!rallies.length) return;
    const t = video.currentTime;
    let i;
    if (atSelected(t)) i = sel + dir;
    else if (dir < 0) i = rallyAtOrBefore(t - 0.01);
    else i = rallies.findIndex((r) => r.start > t);
    if (i >= 0 && i < rallies.length) select(i);
  }

  // Every key in a box over the editor (? opens it, Esc or ? closes it).
  const keysDialog = h('dialog', { class: 'keys-dialog', 'aria-label': 'Keyboard shortcuts' },
    h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, icon('keyboard'), 'Keyboard shortcuts'), h('button', { class: 'small', onclick: () => keysDialog.close() }, 'Close')),
    h('div', { class: 'keys' }, keyList(data.rallyGap)));
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
        openFavourite = false;
        openBadge.hidden = false;
        drawFavouriteControl();
        say(`Rally starts ${clock(openStart)}`);
        break;
      case 'Escape':
        if (marking) {
          stopMarking();
          say(corners ? 'Marking stopped: the court is as it was' : 'Marking stopped');
          drawTrackingPanel();
          drawOverlay();
        } else if (openStart !== null) { openStart = null; openFavourite = false; openBadge.hidden = true; drawFavouriteControl(); say('Rally cancelled'); } else select(-1, { seek: false });
        break;
      case 'a': case 'b': case 'l': {
        const w = key === 'l' ? 'let' : key;
        const favourite = e.shiftKey && key !== 'l';
        if (openStart !== null) {
          const end = Math.max(now(), openStart + 0.5);
          remember();
          const kept = rallies[sel] ?? null; // a selected rally stays selected
          const r = { start: openStart, end, winner: w, ...(favourite || openFavourite ? { fav: true } : {}) };
          rallies.push(r);
          const i = sortKeep(r);
          openStart = null;
          openFavourite = false;
          openBadge.hidden = true;
          sel = kept ? rallies.indexOf(kept) : -1;
          changed();
          const after = steps[i]?.after;
          say(`Rally ${i + 1}: ${w === 'let' ? 'let' : `${w.toUpperCase()} wins`}${after ? ` · ${after.points.join('-')}` : ''}${r.fav ? ' · ★ favourite' : ''}`);
        } else if (atSelected()) {
          setWinner(sel, w, { favourite });
        } else {
          // Inside (or just after) a rally without a winner: say who won it. Otherwise a new
          // rally ending now, taken to have started the Settings gap (rallyGap, 5 s by default) after the one before.
          // A selected rally the playhead has moved away from stays selected and keeps its winner.
          const t = now();
          const i = rallies.findIndex((r) => t >= r.start && t <= r.end + 1.5);
          if (i >= 0) setWinner(i, w, { favourite });
          else {
            remember();
            const kept = rallies[sel] ?? null;
            const r = { start: assumedStart(rallies, t, { matchStart, gap: data.rallyGap }), end: Math.max(t, 1), winner: w, ...(favourite ? { fav: true } : {}) };
            rallies.push(r);
            const k = sortKeep(r);
            sel = kept ? rallies.indexOf(kept) : -1;
            changed();
            const after = steps[k]?.after;
            say(`Rally ${k + 1}: ${w === 'let' ? 'let' : `${w.toUpperCase()} wins`}${after ? ` · ${after.points.join('-')}` : ''}${r.fav ? ' · ★ favourite' : ''}`);
          }
        }
        break;
      }
      case 'h': toggleFavouriteHere(); break;
      case 'm': setBound('start', now()); break;
      case 'f': setBound('end', now()); break;
      case '+': case '=': zoomBy(0.5); break;
      case '-': zoomBy(2); break;
      case '0': setView(0, duration()); break;
      case '?': keysDialog.showModal(); break;
      case 'ArrowUp': stepRally(-1); break;
      case 'ArrowDown': stepRally(1); break;
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
  /** A card that folds to its title, closed until opened; the choice is remembered. */
  const foldCard = (key, title, iconName, ...body) => h('details', { class: 'card stack fold-card', open: Boolean(readFolds()[key]), ontoggle: (e) => writeFold(key, e.target.open) },
    h('summary', { title: 'Click to show or hide' }, h('h4', {}, icon(iconName, 17), title)), body);
  // Compact rows: a short label, then its controls on the same line.
  const scoringRow = (label, title, ...body) => h('div', { class: 'scoring-row' }, h('span', { class: 'scoring-label', title: title || null }, label), body);
  serveRow = scoringRow('Serve', `A = ${nameA}, B = ${nameB}`, serverSel, lawServer ? serverHint : null,
    serverChosen ? null : h('span', { class: 'serve-needed' }, 'Needed before the video counts as tagged'));
  if (!serverChosen) serveRow.classList.add('needs-choice');
  const panels = {
    rallies: h('div', {},
      strandedBox,
      card('Scoring', 'sliders',
        h('div', { class: 'scoring-compact' },
          scoringRow('Format', 'Setting: a game at the last point goes on to the cap shown', pointsSel, h('label', { class: 'row tight' }, settingBox, 'setting', capText), bestOfSel),
          serveRow,
          scoringRow('Starts', unitGame ? 'The score when this video starts' : 'For videos that start mid-match. “A serves first” then means A serves the first rally in the video.',
            startGame, h('span', { class: 'side-a' }, 'A'), startA, '–', startB, h('span', { class: 'side-b' }, 'B')),
          earlierRow, startMsg,
          scoringRow('Match', 'Press M where the match starts and F where it finishes. Warm-up before and anything after are left out of rendering.', boundsBox))),
      card('Rallies', 'list',
        h('div', { class: 'row spread small' }, h('span', { class: 'muted' }, 'S starts a rally, A / B ends it.'),
          h('button', {
            class: 'small ghost', title: 'Remove every rally of this video (Ctrl+Z brings them back)',
            onclick: () => {
              if (!rallies.length) return say('No rallies to clear');
              if (!confirm(`Remove all ${rallies.length} rallies? Ctrl+Z brings them back.`)) return;
              remember();
              rallies = [];
              sel = -1;
              changed();
              say('All rallies removed');
            },
          }, icon('trash', 14), 'Clear all rallies')),
        h('p', { class: 'hint' }, 'Shift+A / Shift+B marks the winner and ★ favourite together. H toggles the star during or after a rally.'),
        listBox)),
    players: h('div', {}, card('Players', 'user', peopleBox)),
    stats: h('div', {}, card('Statistics', 'wave', statsBox)),
    tracking: h('div', {},
      card('Shuttle and players', 'target',
        h('p', { class: 'hint' }, 'TrackNetV3 follows the shuttle and YOLO finds the players. Once found, the ticks below show them on the video on every tab.'),
        trackingBox,
        padBox)),
    export: h('div', {},
      card('Render', 'rally-cut',
        h('label', { class: 'row small', title: 'How many seconds to keep each side of a rally is in Settings' }, cutBox, 'Cut the gaps between rallies'),
        h('label', { class: 'row small' }, overlayBox, 'Show the scoreboard'),
        h('label', { class: 'row small' }, highlightsBox, 'Highlights only: the ★ rallies, to a separate file', favCount),
        h('div', { class: 'row small' }, h('label', { class: 'row' }, titleCardBox, 'Title card'), h('label', { class: 'row' }, endCardBox, 'End card with the result')),
        h('label', { class: 'row small' }, replaysBox, 'Slow-motion replay after each ★ rally'),
        h('label', { class: 'row small', title: data.voices?.ready ? 'Demucs takes out players’ shouts, coaching and talk by the court, and keeps the shuttle hits. The first time takes a minute or so for a match; also used for clips.' : 'Run analysis\\setup.ps1 once to set this up (see the README)' },
          voicesBox, icon('voice-clean', 16), data.voices?.ready ? 'Remove voices from the sound' : 'Remove voices (not set up yet: run analysis\\setup.ps1)'),
        h('div', { class: 'row' }, renderBtn),
        renderBox,
        highlightsResult,
        renderResult),
      card('Comment', 'edit',
        commentBox,
        h('div', { class: 'row spread small' },
          h('span', { class: 'hint' }, `Goes at the end of the YouTube description of this ${unitGame ? 'game' : 'match'}’s videos (whole video, highlights and clips), including ones already rendered.`),
          commentState)),
      card('YouTube', 'youtube',
        youtube.el,
        h('div', { class: 'row' }, ytInput, h('button', { onclick: saveYt }, 'Save link')),
        ytBox),
      foldCard('clip', 'Clip of one rally', 'match-video',
        clipTarget,
        h('div', { class: 'row' }, h('button', { class: 'small primary', onclick: () => makeClip(true) }, 'Upright 9:16 clip'), h('button', { class: 'small', onclick: () => makeClip(false) }, 'Clip as filmed')),
        h('p', { class: 'hint' }, 'For Shorts, Reels or a message: the rally with the seconds from Settings either side and the scoreboard. Upright clips follow the shuttle once it has been tracked.'),
        clipBox),
      foldCard('scoreboard', 'Scoreboard', 'scoreboard',
        h('div', { class: 'row small' }, lookSel, cornerSel),
        countryControls,
        boardBox,
        h('div', { class: 'row spread small' }, h('span', { class: 'hint' }, 'As it will look at the current moment of the video.'), h('button', { class: 'small', onclick: () => drawBoardPreview() }, 'Refresh')),
        h('p', { class: 'hint' }, 'Colours, size and the rest are in ', h('a', { href: '#/settings' }, 'Settings'), '.'))),
  };
  // Scoring and the rallies are one tab (key 'rallies'; a saved 'scoring' opens it too).
  const TABS = [['rallies', 'Scoring', 'scoreboard'], ['players', 'Players', 'user'], ['stats', 'Stats', 'wave'], ['tracking', 'Tracking', 'tracking'], ['export', 'Export', 'export']];
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

  fill(main,
    header,
    h('div', { class: 'editor' },
      h('div', { class: 'video-col' },
        player,
        videoError,
        showNote,
        h('div', { class: 'transport' }, playBtn, timeText, speedSel, muteBtn, favouriteBtn, showSel, deleteBtn,
          h('span', { class: 'zoom' }, h('button', { class: 'ghost icon-only', title: 'Zoom out (−)', onclick: () => zoomBy(2) }, '−'), zoomText,
            h('button', { class: 'ghost icon-only', title: 'Zoom in (+)', onclick: () => zoomBy(0.5) }, '+'),
            h('button', { class: 'small', title: 'Whole video (0)', onclick: () => setView(0, duration()) }, 'Fit'))),
        scrubRow,
        frames,
        timeline,
        wave,
        scoreStrip,
        h('div', { class: 'legend' },
          h('span', {}, h('i', { class: 'a' }), 'A won'), h('span', {}, h('i', { class: 'b' }), 'B won'), h('span', {}, h('i', { class: 'let' }), 'let'),
          h('span', {}, h('i', { class: 'none' }), 'no winner yet'), h('span', {}, '★ favourite')),
        data.source.hdr ? h('div', { class: 'notice info small' }, data.hdrPlayback ? 'Filmed in HDR: shown here as the render will look (brightness: Settings → HDR phone videos).' : 'Filmed in HDR: colours are converted to standard video when rendering.') : null,
        h('details', { class: 'keys-box', open: readKeysOpen(), ontoggle: (e) => writeKeysOpen(e.target.open) }, h('summary', {}, icon('keyboard', 16), 'Keyboard shortcuts'), h('div', { class: 'keys' }, keyList(data.rallyGap)))),
      h('div', {},
        h('div', { class: 'card scorecard' },
          h('div', { class: 'row spread small scoreboard-controls' }, h('span', {}, 'Scoreboard'),
            h('label', { class: 'row' }, previewBox, 'Preview on video')),
          board, h('div', { class: 'check' }, checkBox)),
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

  const headHeight = () => document.documentElement.style.setProperty('--editor-head-h', `${header.offsetHeight}px`);
  const resizedHead = new ResizeObserver(headHeight);
  resizedHead.observe(header);
  headHeight();

  return () => {
    resizedHead.disconnect();
    document.documentElement.style.removeProperty('--editor-head-h');
    if (commentTimer) saveComment(); // a comment typed just before leaving is still saved
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
