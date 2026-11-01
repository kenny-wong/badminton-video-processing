// The page: a hash router and the views. The match editor is in editor.js.
//   #/            tournaments, import, scan
//   #/t/<id>      a tournament's matches and their videos
//   #/m/<id>      the match editor
//   #/players     favourite players (★) and a search of everyone (players-page.js)
//   #/p/<id>      one player, by badminfo id
//   #/videos      every video found
//   #/jobs        background jobs (jobs-page.js)
//   #/settings    folders, cutting, scoreboard, output

import { h, fill, when, day, megabytes, ukDate, gamesView } from './dom.js';
import { api, waitJob } from './api.js';
import { boardNames, NAME_STYLES, teamName } from './shared/names.js';
import { gamesText } from './shared/score.js';
import { clock } from './shared/time.js';
import { renderEditor } from './editor.js';
import { icon } from './icons.js';
import { tournamentHero, illustratedEmpty } from './visuals.js';
import { errorNotice } from './notice.js';
import { customTournamentPanel } from './custom-tournament.js';
import { boardFlags, boardHeading, CORNERS, FONTS, HEADINGS, LAYOUTS, PRESETS } from './shared/board.js';
import { boardPreview } from './board-preview.js';
import { renderPlayer, renderPlayers } from './players-page.js';
import { percents } from './shared/players.js';
import { renderJobs, watchJobs } from './jobs-page.js';
import { versionAdvice } from './shared/version.js';

const main = document.getElementById('app');
let leaving = null; // cleanup for the current view (the editor's key handler, timers)

// Light, dark, or as Windows is set (the default), per device.
const THEME_KEY = 'badminton-video:theme:v1';
const THEMES = { auto: 'Auto', light: 'Light', dark: 'Dark' };
function setTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('theme');
  if (btn) {
    btn.textContent = THEMES[theme];
    btn.title = `Theme: ${THEMES[theme]} (click to change)`;
  }
}
let theme = 'auto';
try {
  theme = Object.hasOwn(THEMES, localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'auto';
} catch { /* storage blocked */ }
setTheme(theme);
document.getElementById('theme')?.addEventListener('click', () => {
  const order = Object.keys(THEMES);
  theme = order[(order.indexOf(theme) + 1) % order.length];
  setTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* storage blocked: lasts until the window closes */ }
});
const jobsLink = document.querySelector('.jobs-link');
if (jobsLink) watchJobs(jobsLink);

// The header's version is this window's (from the files on disk); the server says which version it runs.
// They differ after an update until the server is restarted and this window reloaded.
const PAGE_VERSION = document.querySelector('.version')?.textContent.trim() ?? '';
async function checkServerVersion() {
  const chip = document.querySelector('.version');
  const shown = document.querySelector('.server-version');
  const banner = document.querySelector('.version-banner');
  if (!chip || !shown || !banner) return;
  let server;
  try {
    // A server from before 1.16.1 has no /api/version, but its settings carry the version.
    server = await api('/api/version').catch((err) => (err.status === 404 ? api('/api/settings') : Promise.reject(err)));
  } catch {
    chip.title = `This window: ${PAGE_VERSION}. The server can’t be reached.`;
    return;
  }
  const since = server.startedAt ? new Date(server.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;
  chip.title = `This window: ${PAGE_VERSION}. Server: ${server.version}${since ? `, running since ${since}` : ''}.`;
  const advice = versionAdvice(PAGE_VERSION, server.version);
  shown.hidden = !advice;
  shown.textContent = advice ? `server ${server.version}` : '';
  banner.hidden = !advice;
  fill(banner, advice === 'reload'
    ? [h('span', {}, `Server version ${server.version} doesn’t match this window (${PAGE_VERSION}). Reload this window.`),
      h('button', { class: 'small primary', onclick: () => location.reload() }, 'Reload')]
    : advice === 'restart'
      ? [h('span', {}, `Server version ${server.version} doesn’t match this app (${PAGE_VERSION}). The server needs to be restarted.`),
        h('button', { class: 'small primary', onclick: (e) => restartServer(e.currentTarget, server.boot) }, 'Restart server')]
      : null);
}
// Restarts the server, then reloads this window once the new one answers.
async function restartServer(button, oldBoot) {
  const banner = document.querySelector('.version-banner');
  button.disabled = true;
  try {
    await api('/api/restart', { method: 'POST', body: {} }).catch((err) => {
      if (err.code !== 'jobsRunning') throw err;
      if (!confirm(`${err.message}.\n\nRestart anyway?`)) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
      return api('/api/restart', { method: 'POST', body: { force: true } });
    });
  } catch (err) {
    button.disabled = false;
    if (err.code === 'cancelled') return;
    // A server from before 1.16.4 can't restart itself.
    fill(banner, h('span', {}, err.status === 404 ? 'This server can’t restart itself. Close the app and start it again.' : `The server couldn’t be restarted: ${err.message}`));
    return;
  }
  fill(banner, h('span', {}, 'Restarting the server…'));
  for (let waited = 0; waited < 30000; waited += 500) {
    await new Promise((r) => setTimeout(r, 500));
    const now = await api('/api/version').catch(() => null);
    if (now && now.boot !== oldBoot) {
      location.reload();
      return;
    }
  }
  fill(banner, h('span', {}, 'The server didn’t come back. Close the app and start it again.'));
}

checkServerVersion();
setInterval(checkServerVersion, 30000);
window.addEventListener('focus', checkServerVersion);

function setTab(name) {
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// Icons in the header's section links.
for (const [tab, name] of [['home', 'court'], ['players', 'user'], ['videos', 'match-video'], ['settings', 'settings']]) {
  document.querySelector(`.tabs a[data-tab="${tab}"]`)?.prepend(icon(name, 17));
}

/** A page heading: title, a line under it, and buttons on the right. */
const pageHead = (title, sub, ...actions) => h('div', { class: 'page-head' },
  h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null),
  actions.length ? h('div', { class: 'row' }, actions) : null);

const emptyState = (name, ...text) => h('div', { class: 'empty' }, icon(name, 34), h('div', {}, text));

function progressBar(job) {
  const waiting = job?.status === 'queued';
  return h('div', { class: 'stack' },
    h('div', { class: `progress${waiting ? ' waiting' : ''}` }, h('span', { style: { width: `${Math.round((job?.progress ?? 0) * 100)}%` } })),
    h('div', { class: 'small muted' }, waiting
      ? [`Waiting: ${job.ahead || 'a'} job${job.ahead === 1 || !job.ahead ? '' : 's'} on the graphics card first. `, h('a', { href: '#/jobs' }, 'See jobs')]
      : job?.message || 'Working…'));
}

/** Runs a job with a progress bar in `box`; resolves with its result. */
async function runJob(box, start) {
  fill(box, progressBar(null));
  const job = await start();
  return waitJob(job, (j) => fill(box, progressBar(j)));
}

// ---------- Tournaments (home) ----------

async function renderHome() {
  setTab('home');
  document.title = 'Badminton Video';
  const [{ settings }, { tournaments }, todo, { favourites: favs }] = await Promise.all([api('/api/settings'), api('/api/tournaments'), api('/api/overview'), api('/api/favourites')]);
  const importMsg = h('div');
  const scanBox = h('div');
  const link = h('input', { type: 'url', placeholder: 'https://badminfo.com/Tournament/… or https://be.tournamentsoftware.com/tournament/…', 'aria-label': 'Tournament link' });
  const importBtn = h('button', { class: 'primary', type: 'submit' }, icon('import', 16), 'Import');
  const form = h('form', {
    class: 'row',
    onsubmit: async (e) => {
      e.preventDefault();
      importBtn.disabled = true;
      fill(importMsg, h('p', { class: 'muted small' }, 'Reading the draws and match times from Badminton England…'));
      try {
        const r = await api('/api/tournaments', { method: 'POST', body: { link: link.value } });
        location.hash = `#/t/${r.id}`;
      } catch (err) {
        fill(importMsg, errorNotice(err));
        importBtn.disabled = false;
      }
    },
  }, link, importBtn);

  // ---- or a custom tournament, made by hand ----
  const customName = h('input', { type: 'text', class: 'grow', placeholder: 'Name, e.g. Club night or Friendly v Kent', maxlength: 120, 'aria-label': 'Custom tournament name' });
  const customForm = h('form', {
    class: 'row',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/tournaments', { method: 'POST', body: { name: customName.value } });
        location.hash = `#/t/${r.id}`;
      } catch (err) {
        fill(importMsg, errorNotice(err));
      }
    },
  }, customName, h('button', { type: 'submit', title: 'Make a tournament by hand: you add its matches and players yourself' }, icon('plus', 16), 'Make tournament'));

  const scanBtn = h('button', {
    onclick: async () => {
      scanBtn.disabled = true;
      try {
        const r = await runJob(scanBox, () => api('/api/videos/scan', { method: 'POST' }));
        fill(scanBox, h('div', { class: 'notice ok' }, `Found ${r.found} video${r.found === 1 ? '' : 's'}; ${r.added} new or changed.${r.failed ? ` ${r.failed} couldn't be read.` : ''}`));
      } catch (err) {
        fill(scanBox, errorNotice(err));
      }
      scanBtn.disabled = false;
    },
  }, icon('scan', 16), 'Scan folders');

  // ---- search ----
  const query = h('input', { type: 'search', placeholder: 'Find a match: player, tournament or event', 'aria-label': 'Search matches', class: 'grow' });
  const only = h('select', { 'aria-label': 'Only matches that' },
    h('option', { value: '' }, 'All matches'), h('option', { value: 'video' }, 'With a video'), h('option', { value: 'tagged' }, 'Tagged'), h('option', { value: 'uploaded' }, 'On YouTube'));
  const results = h('div');
  let searchTimer = null;
  const runSearch = async () => {
    if (!query.value.trim()) return fill(results);
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(query.value)}&only=${only.value}`);
      fill(results, r.matches.length
        ? h('div', { class: 'table-scroll' }, h('table', {}, h('tbody', {}, r.matches.map((m) => h('tr', {},
          h('td', { class: 'nowrap small' }, day(m.date), h('div', { class: 'muted' }, m.time)),
          h('td', { class: 'small' }, h('a', { href: `#/t/${m.tournamentId}` }, m.tournament), h('div', { class: 'muted' }, [m.draw, m.round].filter(Boolean).join(' · '))),
          h('td', {}, teamName(m.teamA), h('span', { class: 'muted' }, ' v '), teamName(m.teamB)),
          h('td', { class: 'nowrap' }, gamesView(m.games)),
          h('td', { class: 'nowrap' }, m.videos ? h('a', { class: 'btn small primary', href: `#/m/${m.id}` }, 'Open') : h('span', { class: 'small muted' }, 'no video'),
            m.youtubeUrl ? [' ', h('a', { class: 'pill ok', href: m.youtubeUrl, target: '_blank', rel: 'noopener' }, 'YouTube ↗')] : null))))))
        : h('p', { class: 'hint' }, 'No matches found.'));
    } catch (err) {
      fill(results, errorNotice(err));
    }
  };
  query.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
  only.addEventListener('change', runSearch);

  // ---- to do: filmed matches by stage ----
  const STAGES = [['tag', 'To tag', 'Rallies to find, or winners to give'], ['render', 'To render', 'Every rally has a winner'], ['upload', 'To upload', 'Rendered, no YouTube link yet']];
  const todoItem = (m) => h('li', {},
    h('a', { href: `#/m/${m.id}` }, `${teamName(m.teamA)} v ${teamName(m.teamB)}`, m.game ? ` · game ${m.game}` : ''),
    h('div', { class: 'small muted' }, [day(m.date), m.tournament, [m.draw, m.round].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
      m.rallies ? ` · ${m.tagged}/${m.rallies} rallies` : ''));
  const todoBox = todo.counts.tag + todo.counts.render + todo.counts.upload + todo.unlinked
    ? h('div', { class: 'card stack' },
      h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, icon('check'), 'To do'),
        h('span', { class: 'small muted' }, `${todo.counts.done} filmed match${todo.counts.done === 1 ? '' : 'es'} on YouTube`)),
      todo.unlinked ? h('div', { class: 'notice warn small' }, `${todo.unlinked} video${todo.unlinked === 1 ? ' isn’t' : 's aren’t'} linked to a match. `, h('a', { href: '#/videos' }, 'See videos')) : null,
      h('div', { class: 'todo-grid' }, STAGES.map(([k, title, hint]) => h('div', { class: 'todo-col' },
        h('div', { class: 'row spread' }, h('strong', {}, title), h('span', { class: `pill${todo.counts[k] ? ' warn' : ''}` }, todo.counts[k])),
        h('div', { class: 'small muted' }, hint),
        todo[k].length ? h('ul', { class: 'match-list' }, todo[k].map(todoItem)) : h('p', { class: 'hint' }, 'Nothing here.')))))
    : null;

  const setup = !settings.videoFolders.length || !favs.length;
  const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, label));

  // ---- tournaments: grouped under each favourite player (default), all of them, or one player's ----
  const listTitle = h('div', { class: 'section-title' });
  const list = h('div');
  const firstName = (f) => f.name.split(' ')[0];
  const playerSel = favs.length ? h('select', { 'aria-label': 'Whose tournaments', onchange: () => { writeHomePlayer(playerSel.value); drawList(); } },
    h('option', { value: 'group' }, 'Grouped by player'),
    h('option', { value: 'all' }, 'Every tournament'),
    favs.map((f) => h('option', { value: String(f.key) }, `★ ${f.name} (${Object.keys(f.tournaments).length})`))) : null;
  if (playerSel) playerSel.value = ['group', 'all', ...favs.map((f) => String(f.key))].includes(readHomePlayer()) ? readHomePlayer() : 'group';
  const tournamentCard = (t, f = null) => h('a', { class: 'card', href: f ? `#/t/${t.id}?who=${f.key}` : `#/t/${t.id}` },
    h('h3', {}, t.name, t.kind === 'custom' ? h('span', { class: 'pill', title: 'Made by hand' }, 'Custom') : null),
    h('div', { class: 'muted small' }, t.start === t.end || !t.end ? day(t.start) : `${day(t.start)} – ${day(t.end)}`),
    f ? h('div', { class: 'small' }, h('span', { class: 'pill ok' }, '★ ', f.tournaments[t.id]
      ? `${firstName(f)}: ${f.tournaments[t.id]} match${f.tournaments[t.id] === 1 ? '' : 'es'}` : `${firstName(f)} entered, no matches yet`)) : null,
    h('div', { class: 'stats' }, stat(t.matches, 'matches'), stat(t.filmed, 'filmed'), stat(t.rendered, 'rendered'), stat(t.uploaded, 'YouTube')));
  const libraryEmpty = () => illustratedEmpty('Your match library starts here.', 'Paste a badminfo or Badminton England link above to bring in the matches, or make your own tournament, then link your footage.');
  const drawList = () => {
    const choice = playerSel?.value ?? 'all';
    if (choice === 'group') {
      // A tournament with two favourites shows under both; tournaments with none come last.
      const groups = favs.map((f) => ({ f, list: tournaments.filter((t) => Object.hasOwn(f.tournaments, t.id)) })).filter((g) => g.list.length);
      const placed = new Set(groups.flatMap((g) => g.list.map((t) => t.id)));
      const rest = tournaments.filter((t) => !placed.has(t.id));
      fill(listTitle, icon('trophy', 15), `Tournaments by player (${tournaments.length})`);
      fill(list, !tournaments.length ? libraryEmpty() : [
        groups.map(({ f, list: ts }) => h('section', { class: 'player-group' },
          h('h3', { class: 'group-title' }, h('a', { class: 'plain', href: f.id ? `#/p/${f.id}` : '#/players' }, `★ ${f.name}`), h('span', { class: 'muted small' }, ` ${ts.length} tournament${ts.length === 1 ? '' : 's'}`)),
          h('div', { class: 'tournament-list' }, ts.map((t) => tournamentCard(t, f))))),
        rest.length ? h('section', { class: 'player-group' },
          h('h3', { class: 'group-title' }, groups.length ? 'Other tournaments' : 'Tournaments', h('span', { class: 'muted small' }, groups.length ? ' none of your favourites in them' : ' none of your favourites in them yet')),
          h('div', { class: 'tournament-list' }, rest.map((t) => tournamentCard(t)))) : null,
      ]);
      return;
    }
    const f = favs.find((x) => String(x.key) === choice);
    const shown = f ? tournaments.filter((t) => Object.hasOwn(f.tournaments, t.id)) : tournaments;
    fill(listTitle, icon('trophy', 15), f ? `${f.name}’s tournaments (${shown.length} of ${tournaments.length})` : `Tournaments (${tournaments.length})`);
    fill(list, shown.length
      ? h('div', { class: 'tournament-list' }, shown.map((t) => tournamentCard(t, f)))
      : f ? illustratedEmpty(`No tournaments for ${f.name} yet.`, 'Import a tournament they have entered, or add them to a custom tournament, to see it here.') : libraryEmpty());
  };
  drawList();
  fill(main,
    tournamentHero(tournaments),
    setup ? h('div', { class: 'card setup-card' }, h('div', {},
      h('h3', { class: 'card-title' }, icon('check'), 'Getting started'),
      h('ol', { class: 'steps' },
        h('li', {}, h('span', {}, h('a', { href: '#/settings' }, 'Settings'), ': add the folders where your phone videos are.')),
        h('li', {}, h('span', {}, h('a', { href: '#/players' }, 'Players'), ': star your players (★) to pick out their matches.')),
        h('li', {}, h('span', {}, 'Import a tournament with its badminfo or Badminton England link.')),
        h('li', {}, h('span', {}, 'Scan the video folders: each video is matched to a match by when it was recorded.')),
        h('li', {}, h('span', {}, 'Open a match to tag rallies, then render it with the score and without the gaps.')))),
      h('img', { class: 'setup-art', src: 'visual-kit/shuttle-video.png', alt: '', width: 190, height: 175, loading: 'lazy' })) : null,
    h('div', { class: 'home-grid' },
      h('div', { class: 'card stack' },
        h('h3', { class: 'card-title' }, icon('import'), 'Import a tournament'),
        form,
        h('p', { class: 'hint' }, 'Re-importing the same tournament updates times, courts and results, and keeps your tagging.'),
        h('div', { class: 'small muted' }, 'Not on badminfo or Badminton England? Make your own and add its matches by hand:'),
        customForm,
        importMsg),
      h('div', { class: 'card stack' },
        h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, icon('match-video'), 'Phone videos'), scanBtn),
        h('p', { class: 'hint' }, settings.videoFolders.length ? settings.videoFolders.join(' · ') : ['No video folders yet. ', h('a', { href: '#/settings' }, 'Add them in Settings.')]),
        scanBox)),
    h('div', { class: 'card stack' }, h('div', { class: 'row' }, query, only), results),
    todoBox,
    h('div', { class: 'row spread' }, listTitle, playerSel),
    list);
}

// The Tournaments page's favourite player (whose tournaments it lists), per device.
const HOME_PLAYER_KEY = 'badminton-video:home-player:v1';
function readHomePlayer() {
  try {
    return localStorage.getItem(HOME_PLAYER_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeHomePlayer(key) {
  try {
    localStorage.setItem(HOME_PLAYER_KEY, key);
  } catch { /* storage blocked */ }
}

// ---------- One tournament ----------

function videoLabel(v) {
  return `${v.name} · ${when(v.recordedAt, { date: false })} · ${clock(v.duration ?? 0)}`;
}

// The tournament page's list/grid choice and filters, per device.
const PREFS_KEY = 'badminton-video:tournament-view:v1';
function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
  } catch {
    return {};
  }
}
function writePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage blocked: the choice lasts until the page closes */ }
}

/** "▶ YouTube" link for an uploaded match, with the short address. */
const youtubeLink = (m) => m.youtubeUrl && h('a', { class: 'yt-link small', href: m.youtubeUrl, target: '_blank', rel: 'noopener', title: 'Watch on YouTube' },
  '▶ YouTube ', h('span', { class: 'muted' }, m.youtubeUrl.replace(/^https:\/\//, '')));

async function renderTournament(id, notice = null, who = null) {
  setTab('home');
  const data = await api(`/api/tournaments/${id}`);
  const { tournament, matches, videos, suggestions } = data;
  document.title = `${tournament.name} · Badminton Video`;
  // A custom tournament (made by hand): its details, players and matches are edited here.
  const custom = tournament.kind === 'custom' ? customTournamentPanel({ id, data, rerender: (n) => renderTournament(id, n ?? null), errorNotice }) : null;
  const byId = new Map(videos.map((v) => [v.id, v]));
  const suggestionFor = new Map(suggestions.map((s) => [s.matchId, s]));
  const suggested = new Set(suggestions.flatMap((s) => s.ids));
  const free = videos.filter((v) => !v.matchId);
  const anyMine = matches.some((m) => m.mine);
  const saved = readPrefs();
  // whose matches: '' everyone's, 'fav' the favourites', or one favourite's key (onlyMine was the old checkbox)
  const prefs = { view: 'list', hideNoVideo: false, ...saved, who: saved.who ?? (saved.onlyMine === false ? '' : 'fav') };
  if (who !== null) {
    prefs.who = who; // from the Tournaments page's player choice; kept for this page's re-draws
    writePrefs(prefs);
  }
  if (!['', 'fav'].includes(prefs.who) && !data.favourites.some((f) => String(f.key) === prefs.who)) prefs.who = 'fav';
  const hasFav = (m, key) => m.favs.a.includes(key) || m.favs.b.includes(key);
  const msg = h('div');
  const table = h('div');

  // A "unit" is what a video is linked to: a whole match, or one game of it
  // (its own row once used; `parent` + `game` while it has none yet).
  const unitPath = (u) => (u.id ? `/api/matches/${u.id}/videos` : `/api/matches/${u.parent.id}/games/${u.game}/videos`);
  const unitName = (u) => (u.game ? `game ${u.game}` : 'match');

  const link = async (u, ids) => {
    if (!ids.length) {
      const what = [u.rallyCount ? `${u.rallyCount} tagged rallies` : '', u.outputPath ? 'rendered' : '', u.youtubeUrl ? 'YouTube link' : ''].filter(Boolean);
      if (what.length && !confirm(`Unlink the video? This ${unitName(u)} is cleared (${what.join(', ')}). The tagging goes with the video to the next match or game you link it to; render and YouTube status need doing again there.`)) return;
    }
    try {
      const r = await api(unitPath(u), { method: 'PUT', body: { videoIds: ids } });
      const t = r.tagging;
      renderTournament(id, !t ? null : t.moved
        ? h('div', { class: 'notice ok' }, `The video’s tagging (${t.rallies} rallies) came with it.`)
        : h('div', { class: 'notice warn' }, `This ${unitName(u)} already had its own tagging, so it was kept; the video still carries its other tagging (${t.rallies} rallies) for one without any.`));
    } catch (err) {
      fill(msg, errorNotice(err));
    }
  };

  // ---- drag a video onto a match: a chip from this page, or the file itself from Explorer ----
  const VIDEO_TYPE = 'application/x-badminton-video';
  const dropped = async (e, u) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drop-on');
    let ids = [];
    const chip = Number(e.dataTransfer.getData(VIDEO_TYPE));
    if (chip) ids = [chip];
    else if (e.dataTransfer.files.length) {
      // The browser gives a dropped file's name and size, not where it is: find it among the scanned videos.
      const { videos: all } = await api('/api/videos');
      for (const f of e.dataTransfer.files) {
        const v = all.find((x) => x.name.toLowerCase() === f.name.toLowerCase() && x.size === f.size);
        if (!v) {
          fill(msg, h('div', { class: 'notice warn' }, `${f.name} isn’t among the scanned videos. Copy it into a video folder and scan (Tournaments page), then drop it again.`));
          return;
        }
        ids.push(v.id);
      }
    }
    if (!ids.length) return;
    const current = u.videoIds ?? [];
    if (current.some((v) => ids.includes(v))) return;
    if (current.length && !confirm(`This ${unitName(u)} already has ${current.length} video${current.length === 1 ? '' : 's'}. Add the dropped one${ids.length === 1 ? '' : 's'} after ${current.length === 1 ? 'it' : 'them'}, as the next part?`)) return;
    link(u, [...current, ...ids]);
  };
  const dropOn = (u) => ({
    ondragover: (e) => {
      if (![...e.dataTransfer.types].some((t) => t === VIDEO_TYPE || t === 'Files')) return;
      e.preventDefault();
      e.currentTarget.classList.add('drop-on');
    },
    ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop-on'); },
    ondrop: (e) => dropped(e, u),
  });
  const videoChip = (v) => h('span', {
    class: 'video-chip', draggable: 'true', title: 'Drag onto a match to link it',
    ondragstart: (e) => { e.dataTransfer.setData(VIDEO_TYPE, String(v.id)); e.dataTransfer.effectAllowed = 'link'; },
  }, icon('film', 14), videoLabel(v));

  const chooser = (u, date) => {
    const sameDay = free.filter((v) => v.recordedAt && ukDate(v.recordedAt) === date);
    const choices = sameDay.length ? sameDay : free;
    if (!choices.length) return h('span', { class: 'muted small' }, 'No video yet');
    return h('select', {
      'aria-label': `Choose a video for the ${unitName(u)}`,
      onchange: (e) => e.target.value && link(u, [Number(e.target.value)]),
    }, h('option', { value: '' }, 'Choose video…'), choices.map((v) => h('option', { value: v.id }, videoLabel(v))));
  };

  const linkedCell = (u) => {
    const vs = u.videoIds.map((v) => byId.get(v)).filter(Boolean);
    const total = vs.reduce((t, v) => t + (v.duration ?? 0), 0);
    return h('div', { class: 'stack' },
      h('div', {}, h('a', { class: 'btn primary', href: `#/m/${u.id}` }, 'Open'), ' ',
        h('span', { class: 'small' }, `${vs.length === 1 ? vs[0].name : `${vs.length} videos`} · ${clock(total)}`)),
      youtubeLink(u),
      h('button', { class: 'small', onclick: () => link(u, []) }, 'Unlink'));
  };

  const perGame = (m) => m.units.length >= 2;
  const gamesLinked = (m) => m.units.some((u) => u.videoIds.length);
  const unitsOf = (m) => m.units.map((u) => ({ ...u, parent: m }));
  const hasVideo = (m) => m.videoIds.length > 0 || gamesLinked(m);

  const videoCell = (m) => {
    if (m.videoIds.length) return linkedCell(m);
    if (gamesLinked(m)) return h('span', { class: 'small muted' }, 'Filmed game by game ↓');
    const s = suggestionFor.get(m.id);
    if (s) {
      const vs = s.ids.map((v) => byId.get(v)).filter(Boolean);
      return h('div', { class: 'stack' },
        h('div', { class: 'small' }, h('span', { class: 'pill warn' }, 'Suggested'), ' ',
          vs.map((v) => v.name).join(' + '), h('span', { class: 'muted' }, ` · recorded ${when(vs[0]?.recordedAt, { date: false })}${s.lateMin ? `, ${s.lateMin > 0 ? `${s.lateMin} min after` : `${-s.lateMin} min before`} due` : ''}`)),
        h('button', { class: 'small primary', onclick: () => link(m, s.ids) }, 'Link'));
    }
    return h('div', { class: 'stack' }, chooser(m, m.date), perGame(m) ? h('span', { class: 'hint' }, 'whole match, or per game below') : null);
  };

  const unitVideoCell = (u) => (u.videoIds.length ? linkedCell(u) : chooser(u, u.parent.date));

  const statusCell = (m) => {
    const bits = [];
    if (m.rallyCount) {
      bits.push(h('span', { class: `pill ${m.tagged === m.rallyCount ? 'ok' : 'warn'}` }, `${m.tagged}/${m.rallyCount} rallies`));
      if (m.check && m.games?.length) bits.push(h('span', { class: `pill ${m.check.ok ? 'ok' : 'bad'}`, title: `Tagged: ${gamesText(m.tagGames)}` }, m.check.ok ? 'score ✓' : 'score ≠ result'));
    }
    if (m.favourites) bits.push(h('span', { class: 'pill', title: 'Favourite rallies' }, `★ ${m.favourites}`));
    if (typeof m.people?.chance === 'number') {
      const [pa, pb] = percents(m.people.chance);
      bits.push(h('span', { class: 'pill', title: `badminfo’s chance before the match: ${teamName(m.teamA)} ${pa}, ${teamName(m.teamB)} ${pb}` }, `${pa}–${pb}`));
    }
    if (m.people?.upset) bits.push(h('span', { class: 'pill upset', title: 'The side with under a 35% chance won' }, 'Upset'));
    if (m.outputPath) bits.push(h('span', { class: 'pill ok' }, 'rendered'));
    if (m.youtubeUrl) bits.push(h('a', { class: 'pill ok', href: m.youtubeUrl, target: '_blank', rel: 'noopener', title: m.youtubeUrl }, 'on YouTube ↗'));
    return h('div', { class: 'row' }, bits);
  };

  const gameLabel = (u) => [h('strong', {}, `Game ${u.game}`), u.parent.games[u.game - 1] ? h('span', { class: 'muted' }, ` (${u.parent.games[u.game - 1].join('-')})`) : null];

  // Each name links to the player's page and carries their badminfo rating for this event, when known.
  const named = (m, k) => (k ? m.teamB : m.teamA).map((n, i) => {
    const id = m.people?.ids?.[k]?.[i];
    const st = m.people?.teams?.[k]?.[i];
    return [i ? ' / ' : '', id ? h('a', { class: 'plain', href: `#/p/${id}` }, n) : n,
      st?.rating ? h('span', { class: 'rating-chip', title: `badminfo rating${st.grade ? `, grade ${st.grade}` : ''}` }, st.rating) : null];
  });
  const teams = (m) => [
    h('div', { class: m.favs.a.length ? 'team-mine' : '' }, named(m, 0)),
    h('div', { class: 'muted small' }, 'v'),
    h('div', { class: m.favs.b.length ? 'team-mine' : '' }, named(m, 1)),
  ];

  const listView = (list) => h('div', { class: 'table-scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Time', 'Court', 'Event', 'Match', 'Result', 'Video', 'Status'].map((x) => h('th', {}, x)))),
    list.map((m) => h('tbody', { class: `match-group${m.mine ? ' mine' : ''}`, ...dropOn(m) },
      h('tr', { class: m.mine ? 'mine' : '' },
        h('td', { class: 'nowrap' }, m.time, m.duration ? h('div', { class: 'small muted' }, `${m.duration} min`) : null),
        h('td', { class: 'small' }, m.court),
        h('td', { class: 'small' }, m.draw, h('div', { class: 'muted' }, m.round), custom ? custom.actions(m) : null),
        h('td', {}, teams(m)),
        h('td', { class: 'nowrap' }, m.games?.length ? gamesView(m.games) : h('span', { class: 'muted' }, '—')),
        h('td', {}, videoCell(m)),
        h('td', {}, statusCell(m))),
      // Game by game, unless one video covers the whole match.
      perGame(m) && !m.videoIds.length ? unitsOf(m).map((u) => h('tr', { class: `game-row${m.mine ? ' mine' : ''}`, ...dropOn(u) },
        h('td', {}), h('td', {}), h('td', {}),
        h('td', { class: 'small game-name' }, '↳ ', gameLabel(u)),
        h('td', {}),
        h('td', {}, unitVideoCell(u)),
        h('td', {}, statusCell(u)))) : null))));

  const thumbOf = (u, total, big = true) => h('a', { class: big ? 'thumb' : 'thumb small-thumb', href: `#/m/${u.id}`, title: 'Open' },
    h('img', { src: u.thumb, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); } }),
    h('span', { class: 'play' }, '▶'),
    h('span', { class: 'length' }, clock(total)));
  const lengthOf = (u) => u.videoIds.map((v) => byId.get(v)).filter(Boolean).reduce((t, v) => t + (v.duration ?? 0), 0);

  const gridView = (list) => h('div', { class: 'match-grid' }, list.map((m) => {
    const filmed = m.videoIds.length > 0;
    const games = perGame(m) && !filmed;
    return h('div', { class: `match-card${m.mine ? ' mine' : ''}`, ...dropOn(m) },
      filmed
        ? thumbOf(m, lengthOf(m))
        : games && gamesLinked(m) ? null
          : h('div', { class: 'thumb empty' }, suggestionFor.has(m.id) ? 'Video suggested' : 'No video'),
      h('div', { class: 'match-body stack' },
        h('div', { class: 'small muted' }, [m.time, m.court, `${m.draw}${m.round ? ` · ${m.round}` : ''}`].filter(Boolean).join(' · ')),
        h('div', { class: 'teams' }, teams(m)),
        h('div', { class: 'small' }, 'Result ', m.games?.length ? h('span', {}, gamesView(m.games)) : '—', m.duration ? h('span', { class: 'muted' }, ` · ${m.duration} min`) : null),
        statusCell(m),
        custom ? custom.actions(m) : null,
        filmed ? h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/m/${m.id}` }, 'Open'), youtubeLink(m),
          h('button', { class: 'small', onclick: () => link(m, []) }, 'Unlink'))
          : gamesLinked(m) ? null : videoCell(m),
        games ? h('div', { class: 'game-tiles' }, unitsOf(m).map((u) => h('div', { class: 'game-tile', ...dropOn(u) },
          u.videoIds.length ? thumbOf(u, lengthOf(u), false) : null,
          h('div', { class: 'stack small' },
            h('div', {}, gameLabel(u)),
            statusCell(u),
            u.videoIds.length
              ? h('div', { class: 'row' }, h('a', { class: 'btn primary small', href: `#/m/${u.id}` }, 'Open'), youtubeLink(u),
                h('button', { class: 'small', onclick: () => link(u, []) }, 'Unlink'))
              : chooser(u, m.date))))) : null));
  }));

  const drawTable = () => {
    // One favourite: only their matches. All favourites: theirs, and any other match with a video.
    const picked = (m) => (!anyMine || !prefs.who ? true : prefs.who === 'fav' ? m.mine || hasVideo(m) : hasFav(m, Number(prefs.who)));
    const shown = matches.filter((m) => picked(m) && (!prefs.hideNoVideo || hasVideo(m)));
    const days = [...new Set(shown.map((m) => m.date))];
    const view = prefs.view === 'grid' ? gridView : listView;
    fill(table, days.map((d) => [h('div', { class: 'day-title' }, day(d)), view(shown.filter((m) => m.date === d))]));
    if (!shown.length) fill(table, emptyState('film', prefs.hideNoVideo ? 'No matches with a video yet.' : custom && !matches.length ? 'No matches yet: add the first one above.' : 'No matches to show.'));
  };

  const setPref = (k, v) => {
    prefs[k] = v;
    writePrefs(prefs);
    drawViewButtons();
    drawTable();
  };
  const whoSel = h('select', { class: 'small', 'aria-label': 'Whose matches', onchange: (e) => setPref('who', e.target.value) },
    h('option', { value: '' }, 'Every match'), h('option', { value: 'fav' }, '★ Favourite players’ matches'),
    data.favourites.map((f) => h('option', { value: String(f.key) }, `${f.name}’s matches`)));
  whoSel.value = prefs.who;
  const viewButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' });
  const drawViewButtons = () => fill(viewButtons, [['list', 'List'], ['grid', 'Grid']].map(([v, label]) =>
    h('button', { class: 'small', 'aria-pressed': String(prefs.view === v), onclick: () => setPref('view', v) }, icon(v, 15), label)));
  drawViewButtons();
  const toolbar = h('div', { class: 'row spread toolbar' },
    h('div', { class: 'row' },
      anyMine ? whoSel : null,
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: prefs.hideNoVideo, onchange: (e) => setPref('hideNoVideo', e.target.checked) }), 'Hide matches without a video')),
    viewButtons);

  const linkAll = suggestions.length ? h('button', {
    class: 'primary',
    onclick: async () => {
      for (const s of suggestions) await api(`/api/matches/${s.matchId}/videos`, { method: 'PUT', body: { videoIds: s.ids } });
      renderTournament(id);
    },
  }, `Link all ${suggestions.length} suggested`) : null;

  // ---- highlight reel: everyone's ★ rallies here, or one favourite player's ----
  const reelBtn = h('button', {
    title: 'Join the ★ rallies of the filmed matches here into one video',
    onclick: async () => {
      const who = h('select', { 'aria-label': 'Whose rallies' }, h('option', { value: '' }, 'Everyone’s ★ rallies'), data.favourites.map((f) => h('option', { value: String(f.key) }, `${f.name}’s matches`)));
      if (data.favourites.some((f) => String(f.key) === prefs.who)) who.value = prefs.who;
      // A favourite by badminfo id when known, else by name.
      const whose = () => {
        const f = data.favourites.find((x) => String(x.key) === who.value);
        return f ? (f.id ? { playerId: f.id } : { player: f.name }) : {};
      };
      const info = h('span', { class: 'small muted' });
      const jobBox = h('div');
      const count = async () => {
        try {
          const r = await api(`/api/reels?${new URLSearchParams({ tournamentId: id, ...whose() })}`);
          fill(info, `${r.favourites} ★ rall${r.favourites === 1 ? 'y' : 'ies'} from ${r.matches} filmed match${r.matches === 1 ? '' : 'es'}`);
          make.disabled = !r.favourites;
        } catch (err) {
          fill(info, err.message);
        }
      };
      const make = h('button', {
        class: 'primary small',
        onclick: async () => {
          make.disabled = true;
          try {
            const r = await runJob(jobBox, () => api('/api/reels', { method: 'POST', body: { tournamentId: Number(id), ...whose() } }));
            fill(jobBox, h('div', { class: 'notice ok row' }, `Done: ${clock(r.seconds)} from ${r.matches} matches.`,
              h('button', { class: 'small', onclick: () => api('/api/reveal', { method: 'POST', body: { path: r.path } }) }, 'Show in folder')));
          } catch (err) {
            fill(jobBox, errorNotice(err));
          }
          make.disabled = false;
        },
      }, icon('highlights', 15), 'Make the reel');
      who.addEventListener('change', count);
      fill(msg, h('div', { class: 'card stack' }, h('h3', { class: 'card-title' }, icon('highlights'), 'Highlight reel'),
        h('div', { class: 'row' }, who, make, info),
        h('p', { class: 'hint' }, 'Each match gets a short card with its event and players, then its ★ rallies with its own scoreboard. Size, replays, logo and music follow Settings.'),
        jobBox));
      count();
    },
  }, icon('highlights', 16), 'Highlight reel');

  const renderAllBtn = h('button', {
    title: 'Queue a render of every filmed match whose rallies all have a winner and that isn’t rendered yet; they run one after another',
    onclick: async () => {
      renderAllBtn.disabled = true;
      try {
        const r = await api(`/api/tournaments/${id}/render-all`, { method: 'POST' });
        fill(msg, h('div', { class: 'notice ok' }, r.queued ? [`Queued ${r.queued} render${r.queued === 1 ? '' : 's'}. `, h('a', { href: '#/jobs' }, 'Follow them on the Jobs page.')]
          : 'Nothing to render: no filmed match here has every rally tagged and no video yet.'));
      } catch (err) {
        fill(msg, errorNotice(err));
      }
      renderAllBtn.disabled = false;
    },
  }, icon('scissors', 16), 'Render all tagged');

  const refreshBtn = h('button', {
    onclick: async () => {
      refreshBtn.disabled = true;
      fill(msg, h('p', { class: 'muted small' }, 'Updating from Badminton England…'));
      try {
        await api(`/api/tournaments/${id}/refresh`, { method: 'POST' });
        renderTournament(id);
      } catch (err) {
        fill(msg, errorNotice(err));
        refreshBtn.disabled = false;
      }
    },
  }, icon('refresh', 16), 'Update results');

  const unmatched = free.filter((v) => !suggested.has(v.id));
  fill(main,
    h('a', { class: 'crumb', href: '#/' }, icon('back', 15), 'Tournaments'),
    pageHead(tournament.name,
      [tournament.start === tournament.end ? day(tournament.start) : `${day(tournament.start)} – ${day(tournament.end)}`, ' · ',
        custom
          ? [h('span', { class: 'pill' }, 'Custom tournament'), tournament.venue ? ` · ${tournament.venue}` : null]
          : h('a', { href: `https://be.tournamentsoftware.com/tournament/${tournament.beId}`, target: '_blank', rel: 'noopener' }, 'Badminton England ↗'),
        tournament.badminfoId ? [' · ', h('a', { href: `https://badminfo.com/Tournament/${tournament.badminfoId}`, target: '_blank', rel: 'noopener' }, 'badminfo ↗')] : null],
      reelBtn,
      renderAllBtn,
      custom ? null : refreshBtn,
      h('button', {
        class: 'danger',
        onclick: async () => {
          if (!confirm(`Forget ${tournament.name}? Its tagging is lost; your video files are not touched.`)) return;
          await api(`/api/tournaments/${id}`, { method: 'DELETE' });
          location.hash = '#/';
        },
      }, icon('trash', 16), 'Remove')),
    msg,
    notice,
    custom?.el,
    suggestions.length ? h('div', { class: 'notice info row spread' },
      h('span', {}, `${suggestions.length === 1 ? 'One match below has a suggested video' : `${suggestions.length} matches below have suggested videos`}, going by when the videos were recorded. Check, then link.`), linkAll) : null,
    !videos.length ? h('div', { class: 'notice warn' }, 'No videos from these dates yet. ', h('a', { href: '#/' }, 'Scan your video folders'), ' after copying them from your phone.') : null,
    unmatched.length ? h('div', { class: 'stack small' },
      h('div', { class: 'muted' }, `${unmatched.length} video${unmatched.length === 1 ? '' : 's'} from these dates aren’t linked or suggested: drag one onto its match, or choose it in the Video column. A video file can also be dragged straight from Explorer.`),
      h('div', { class: 'video-tray' }, unmatched.map(videoChip))) : null,
    anyMine ? null : h('p', { class: 'hint' }, 'Star your players on the ', h('a', { href: '#/players' }, 'Players'), ' page (★) to pick out their matches.'),
    toolbar,
    table);
  drawTable();
}

// ---------- Videos ----------

async function renderVideos() {
  setTab('videos');
  document.title = 'Videos · Badminton Video';
  const { videos } = await api('/api/videos');
  const SOURCE = { apple: 'iPhone clock', filename: 'file name', creation_time: 'video clock', modified: 'file date (guess)' };
  fill(main,
    pageHead('Videos', 'Every video found in your folders. Files are never moved or changed.'),
    videos.length ? h('div', { class: 'table-scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Recorded', 'File', 'Length', 'Picture', 'Match', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, videos.map((v) => h('tr', {},
        h('td', { class: 'nowrap' }, when(v.recordedAt), h('div', { class: 'small muted' }, SOURCE[v.recordedSource] ?? '')),
        h('td', {}, v.name, v.missing ? [' ', h('span', { class: 'pill bad' }, 'missing')] : null, h('div', { class: 'small muted' }, megabytes(v.size))),
        h('td', { class: 'nowrap' }, clock(v.duration ?? 0)),
        h('td', { class: 'small' }, `${v.width}×${v.height}`, h('div', { class: 'muted' }, `${Math.round(v.fps ?? 0)} fps · ${v.codec ?? '?'}${v.hdr ? ' · HDR' : ''}`)),
        h('td', { class: 'small' }, v.match
          ? [h('a', { href: `#/m/${v.match.id}` }, `${teamName(v.match.teamA)} v ${teamName(v.match.teamB)}`), h('div', { class: 'muted' }, `${v.match.tournament} · ${v.match.draw}${v.part > 1 ? ` · part ${v.part}` : ''}`)]
          : h('span', { class: 'muted' }, 'not linked')),
        h('td', {}, v.match ? h('button', {
          class: 'small',
          onclick: async () => { await api(`/api/videos/${v.id}`, { method: 'PUT', body: { matchId: null } }); renderVideos(); },
        }, 'Unlink') : null)))))) : illustratedEmpty('Your video library starts here.', 'Add folders in ', h('a', { href: '#/settings' }, 'Settings'), ' and scan them from the ', h('a', { href: '#/' }, 'Tournaments page'), ' to find your match footage.'));
}

// ---------- Settings ----------

async function renderSettings() {
  setTab('settings');
  document.title = 'Settings · Badminton Video';
  const data = await api('/api/settings');
  const s = data.settings;
  const lines = (v) => v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const folders = h('textarea', { id: 'folders', placeholder: 'C:\\Users\\you\\Pictures\\Phone\\Badminton' }, s.videoFolders.join('\n'));
  const output = h('input', { type: 'text', id: 'output', class: 'grow', value: s.outputFolder });
  const ffmpeg = h('input', { type: 'text', id: 'ffmpeg', class: 'grow', value: s.ffmpegFolder, placeholder: 'Found by itself' });
  const pre = h('input', { type: 'number', id: 'pre', min: 0, max: 10, step: 0.5, value: s.pre });
  const post = h('input', { type: 'number', id: 'post', min: 0, max: 10, step: 0.5, value: s.post });
  const msg = h('div');
  const styleSel = (kind) => h('select', { id: `names-${kind}`, 'aria-label': `${kind} names` },
    Object.entries(NAME_STYLES).map(([k, label]) => h('option', { value: k, selected: s.nameStyle[kind] === k }, label)));
  const singlesSel = styleSel('singles');
  const doublesSel = styleSel('doubles');
  const example = h('div', { class: 'name-example' });
  const showExample = () => {
    const style = { singles: singlesSel.value, doubles: doublesSel.value };
    const [single] = boardNames([['Thai Chan'], ['Amy Lee']], style);
    const doubles = boardNames([['Thai Chan', 'Man Chan'], ['Amy Lee', 'Ben Ng']], style);
    fill(example, h('span', {}, h('b', {}, 'Singles '), single), h('span', {}, h('b', {}, 'Doubles '), doubles.join(' v ')));
  };
  singlesSel.addEventListener('change', showExample);
  doublesSel.addEventListener('change', showExample);
  showExample();

  // ---- scoreboard look, with a preview drawn from the same layout as the video ----
  const b = s.board;
  const select = (id, options, value) => h('select', { id }, Object.entries(options).map(([k, label]) => h('option', { value: k, selected: k === value }, label)));
  const presetSel = select('board-preset', { ...Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.label])), custom: 'Your own colours' }, b.preset);
  const colours = Object.fromEntries([['box', 'Board'], ['text', 'Names'], ['accent', 'Highlight'], ['pointsText', 'Score']].map(([k, label]) =>
    [k, { label, input: h('input', { type: 'color', id: `board-${k}`, value: b[k] }) }]));
  const fontSel = select('board-font', Object.fromEntries(Object.keys(FONTS).map((f) => [f, f])), b.font);
  const layoutSel = select('board-layout', LAYOUTS, b.layout);
  const opacity = h('input', { type: 'range', id: 'board-opacity', min: 30, max: 100, step: 5, value: b.opacity });
  const scale = h('input', { type: 'range', id: 'board-scale', min: 60, max: 160, step: 5, value: b.scale });
  const cornerSel = select('board-corner', CORNERS, b.corner);
  const headingSel = select('board-heading', HEADINGS, b.heading);
  const longRally = h('input', { type: 'number', id: 'board-long', min: 0, max: 60, step: 1, value: b.longRally, style: { width: '5em' } });
  const ticks = Object.fromEntries([['showGames', 'Scores of finished games'], ['flags', 'GAME POINT / MATCH POINT'], ['banners', 'Interval and game banners']].map(([k, label]) =>
    [k, { label, input: h('input', { type: 'checkbox', id: `board-${k}`, checked: b[k] }) }]));
  const readBoard = () => ({
    preset: presetSel.value,
    ...Object.fromEntries(Object.entries(colours).map(([k, c]) => [k, c.input.value])),
    font: fontSel.value, layout: layoutSel.value, opacity: Number(opacity.value), scale: Number(scale.value), corner: cornerSel.value, heading: headingSel.value, longRally: Number(longRally.value) || 0,
    ...Object.fromEntries(Object.entries(ticks).map(([k, c]) => [k, c.input.checked])),
  });
  const preview = h('div', { class: 'preview-frame' });
  const sample = h('select', { 'aria-label': 'Moment to preview' },
    h('option', { value: 'point' }, 'Game 2, match point'), h('option', { value: 'interval' }, 'Interval'), h('option', { value: 'start' }, 'Start of the match'));
  const showBoard = () => {
    const style = readBoard();
    const names = boardNames([['Thai Chan'], ['Amy Lee']], { singles: singlesSel.value, doubles: doublesSel.value });
    const moment = {
      point: { state: { games: [[21, 18]], points: [20, 17], won: [1, 0], server: 'a' }, banner: '' },
      interval: { state: { games: [[21, 18]], points: [11, 8], won: [1, 0], server: 'a' }, banner: 'INTERVAL' },
      start: { state: { games: [], points: [0, 0], won: [0, 0], server: 'b' }, banner: '' },
    }[sample.value];
    const flags = boardFlags(moment.state, { points: 21, setting: true, bestOf: 3 });
    const heading = boardHeading(style, { tournament: { name: 'Example Open' }, match: { draw: 'MS U15', round: 'Final' } });
    fill(preview, boardPreview({ names, ...moment, style, flags, heading, background: data.previewThumb, logo: readLogo() }));
  };
  presetSel.addEventListener('change', () => {
    const p = PRESETS[presetSel.value];
    if (p) {
      for (const [k, c] of Object.entries(colours)) c.input.value = p[k];
      fontSel.value = p.font;
      layoutSel.value = p.layout;
      opacity.value = p.opacity;
    }
    showBoard();
  });
  // Changing a colour, the font or the opacity makes the look your own.
  for (const el of [...Object.values(colours).map((c) => c.input), fontSel, layoutSel, opacity]) {
    el.addEventListener('input', () => {
      presetSel.value = 'custom';
      showBoard();
    });
  }
  // ---- logo and cards ----
  let logoFile = s.logo.file;
  let logoVersion = Date.now(); // a new upload must not show the old picture from the cache
  const logoCorner = select('logo-corner', CORNERS, s.logo.corner);
  const logoSize = h('input', { type: 'range', id: 'logo-size', min: 4, max: 40, step: 1, value: s.logo.size });
  const logoOpacity = h('input', { type: 'range', id: 'logo-opacity', min: 20, max: 100, step: 5, value: s.logo.opacity });
  const readLogo = () => ({ url: logoFile ? `/media/logo?v=${logoVersion}` : null, corner: logoCorner.value, size: Number(logoSize.value), opacity: Number(logoOpacity.value) });
  const logoMsg = h('div');
  const logoInput = h('input', { type: 'file', accept: 'image/png,image/jpeg', id: 'logo-file', class: 'visually-hidden' });
  const logoState = h('span', { class: 'small muted' });
  const drawLogoState = () => {
    fill(logoState, logoFile ? logoFile.split(/[\\/]/).pop() : 'No logo');
    removeLogo.hidden = !logoFile;
  };
  const removeLogo = h('button', {
    type: 'button', class: 'small',
    onclick: async () => {
      const r = await api('/api/settings/logo', { method: 'DELETE' });
      logoFile = r.settings.logo.file;
      drawLogoState();
      showBoard();
    },
  }, 'Remove');
  logoInput.addEventListener('change', async () => {
    const file = logoInput.files[0];
    if (!file) return;
    try {
      const res = await fetch('/api/settings/logo', { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const r = await res.json();
      if (!res.ok) throw new Error(r.message || `HTTP ${res.status}`);
      logoFile = r.settings.logo.file;
      logoVersion = Date.now();
      fill(logoMsg);
      drawLogoState();
      showBoard();
    } catch (err) {
      fill(logoMsg, errorNotice(err));
    }
    logoInput.value = '';
  });
  drawLogoState();
  const describe = Object.fromEntries([['playerLinks', 'Players’ badminfo pages'], ['winChance', 'badminfo’s win chance before the match'], ['upsetInTitle', '“(upset)” in the title when the underdog won']]
    .map(([k, label]) => [k, { label, input: h('input', { type: 'checkbox', id: `desc-${k}`, checked: s.description[k] }) }]));
  // ---- output size, bitrate, replays; music ----
  const outSize = select('out-size', { source: 'As filmed', 1080: '1080p (shorter side)', 720: '720p (shorter side)' }, String(s.output.size));
  const outRate = h('input', { type: 'number', id: 'out-rate', min: 0, max: 100, step: 1, value: s.output.maxRate });
  const outReplays = h('input', { type: 'checkbox', id: 'out-replays', checked: s.output.replays });
  const outVoices = h('input', { type: 'checkbox', id: 'out-voices', checked: s.output.removeVoices });
  let musicFile = s.music.file;
  const musicInput = h('input', { type: 'file', accept: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp3,.m4a,.wav', id: 'music-file', class: 'visually-hidden' });
  const musicState = h('span', { class: 'small muted' });
  const musicMsg = h('div');
  const removeMusic = h('button', {
    type: 'button', class: 'small',
    onclick: async () => {
      const r = await api('/api/settings/music', { method: 'DELETE' });
      musicFile = r.settings.music.file;
      drawMusicState();
    },
  }, 'Remove');
  const drawMusicState = () => {
    fill(musicState, musicFile ? musicFile.split(/[\\/]/).pop() : 'No music');
    removeMusic.hidden = !musicFile;
  };
  musicInput.addEventListener('change', async () => {
    const file = musicInput.files[0];
    if (!file) return;
    fill(musicMsg, h('p', { class: 'hint' }, 'Copying the music…'));
    try {
      const res = await fetch('/api/settings/music', { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      const r = await res.json();
      if (!res.ok) throw new Error(r.message || `HTTP ${res.status}`);
      musicFile = r.settings.music.file;
      fill(musicMsg);
      drawMusicState();
    } catch (err) {
      fill(musicMsg, errorNotice(err));
    }
    musicInput.value = '';
  });
  drawMusicState();
  const musicUse = select('music-use', { off: 'Never', highlights: 'Highlights and reels', all: 'Every video' }, s.music.use);
  const musicVolume = h('input', { type: 'range', id: 'music-volume', min: 0, max: 100, step: 5, value: s.music.volume });
  const courtVolume = h('input', { type: 'range', id: 'court-volume', min: 0, max: 100, step: 5, value: s.music.court });

  const cardTitle = h('input', { type: 'checkbox', id: 'card-title', checked: s.cards.title });
  const cardEnd = h('input', { type: 'checkbox', id: 'card-end', checked: s.cards.end });
  const cardSeconds = h('input', { type: 'number', id: 'card-seconds', min: 2, max: 8, step: 1, value: s.cards.seconds });
  const cardStats = h('input', { type: 'checkbox', id: 'card-stats', checked: s.cards.stats });

  for (const el of [scale, cornerSel, headingSel, sample, singlesSel, doublesSel, logoCorner, logoSize, logoOpacity, ...Object.values(ticks).map((c) => c.input)]) el.addEventListener('input', showBoard);
  showBoard();
  const tools = (d) => (d.ffmpeg
    ? h('div', { class: 'notice ok' }, `FFmpeg found. Encoder: ${d.encoder === 'h264_nvenc' ? 'NVIDIA (fast)' : 'CPU (x264)'}.`)
    : h('div', { class: 'notice bad' }, 'FFmpeg wasn’t found. Install it with ', h('kbd', {}, 'winget install Gyan.FFmpeg'), ' or give its bin folder below.'));
  const toolsBox = h('div', {}, tools(data));
  const section = (title, text, ...fields) => [
    h('div', { class: 'label' }, h('h3', {}, title), h('p', {}, text)),
    h('div', { class: 'fields' }, fields),
  ];
  const saveBtn = h('button', { class: 'primary', type: 'submit' }, icon('check', 16), 'Save settings');
  fill(main,
    pageHead('Settings', 'Where your videos are, whose matches to pick out, and how to cut.'),
    toolsBox,
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const saved = await api('/api/settings', {
            method: 'PUT',
            body: { videoFolders: lines(folders.value), outputFolder: output.value, ffmpegFolder: ffmpeg.value, pre: Number(pre.value), post: Number(post.value),
              nameStyle: { singles: singlesSel.value, doubles: doublesSel.value }, board: readBoard(),
              logo: readLogo(), cards: { title: cardTitle.checked, end: cardEnd.checked, seconds: Number(cardSeconds.value), stats: cardStats.checked },
              description: Object.fromEntries(Object.entries(describe).map(([k, c]) => [k, c.input.checked])),
              output: { size: outSize.value, maxRate: Number(outRate.value) || 0, replays: outReplays.checked, removeVoices: outVoices.checked },
              music: { use: musicUse.value, volume: Number(musicVolume.value), court: Number(courtVolume.value) } },
          });
          fill(toolsBox, tools(saved));
          fill(msg, h('div', { class: 'notice ok' }, icon('check', 16), 'Saved.'));
        } catch (err) {
          fill(msg, errorNotice(err));
        }
      },
    },
    h('div', { class: 'settings-grid' },
      section('Video folders', 'Copy videos off your phone into one of these, then scan. Subfolders are included.',
        folders, h('p', { class: 'hint' }, 'One folder per line.')),
      section('Finished videos', 'Rendered videos go here, by year and tournament, each with a .txt of its YouTube title and description.',
        h('div', { class: 'row' }, output),
        h('div', { class: 'stack small' }, h('div', { class: 'muted' }, 'The YouTube description also gives (from badminfo, for badminfo imports):'),
          Object.entries(describe).map(([k, c]) => h('label', { class: 'row', for: `desc-${k}` }, c.input, c.label)))),
      section('Scoreboard names', 'How players’ names appear on the scoreboard. Two players who would look the same get an initial added.',
        h('div', { class: 'row' }, h('label', { for: 'names-singles' }, 'Singles'), singlesSel, h('label', { for: 'names-doubles' }, 'Doubles'), doublesSel),
        example),
      section('Scoreboard look', 'Colours, font, size and corner of the score in the video. Each match can also choose its own preset and corner (Export tab).',
        h('div', { class: 'board-settings' },
          h('div', { class: 'stack' },
            h('div', { class: 'row' }, h('label', { for: 'board-preset' }, 'Look'), presetSel, h('label', { for: 'board-font' }, 'Font'), fontSel),
            h('div', { class: 'row' }, h('label', { for: 'board-layout' }, 'Layout'), layoutSel),
            h('div', { class: 'row colour-row' }, Object.entries(colours).map(([k, c]) => h('label', { for: `board-${k}`, class: 'colour' }, c.input, c.label))),
            h('div', { class: 'row' }, h('label', { for: 'board-opacity' }, 'Opacity'), opacity, h('label', { for: 'board-scale' }, 'Size'), scale),
            h('div', { class: 'row' }, h('label', { for: 'board-corner' }, 'Corner'), cornerSel),
            h('div', { class: 'row' }, h('label', { for: 'board-heading' }, 'Heading'), headingSel),
            h('div', { class: 'stack small' }, Object.entries(ticks).map(([k, c]) => h('label', { class: 'row', for: `board-${k}` }, c.input, c.label)),
              h('div', { class: 'row' }, h('label', { for: 'board-long' }, 'Banner after rallies of'), longRally, h('span', {}, 'shots or more (0: none; from the hit sounds)')))),
          h('div', { class: 'stack' }, preview, h('div', { class: 'row small' }, 'Preview:', sample)))),
      section('Logo', 'A club or channel logo in a corner of every rendered video. A PNG with a see-through background looks best.',
        h('div', { class: 'row' }, h('label', { class: 'btn small', for: 'logo-file' }, 'Choose picture…'), logoInput, logoState, removeLogo),
        h('div', { class: 'row' }, h('label', { for: 'logo-corner' }, 'Corner'), logoCorner, h('label', { for: 'logo-size' }, 'Size'), logoSize, h('label', { for: 'logo-opacity' }, 'Opacity'), logoOpacity),
        h('p', { class: 'hint' }, 'Shown in the scoreboard preview above. Pick a corner the scoreboard isn’t in.'),
        logoMsg),
      section('Title and end cards', 'A few seconds before the first rally with the players and the event, and after the last with the result. Each render can switch them on or off.',
        h('div', { class: 'row' }, h('label', { class: 'row', for: 'card-title' }, cardTitle, 'Title card'), h('label', { class: 'row', for: 'card-end' }, cardEnd, 'End card'),
          h('label', { for: 'card-seconds' }, 'for'), cardSeconds, h('span', {}, 'seconds each')),
        h('label', { class: 'row', for: 'card-stats' }, cardStats, 'End card also gives the longest rally and the best run of points')),
      section('Video size', 'Smaller files are quicker to upload and share; the scoreboard, logo and cards are drawn at full size first.',
        h('div', { class: 'row' }, h('label', { for: 'out-size' }, 'Size'), outSize, h('label', { for: 'out-rate' }, 'at most'), outRate, h('span', {}, 'Mbit/s (0: no limit)')),
        h('label', { class: 'row', for: 'out-replays' }, outReplays, 'Slow-motion replay of the last 3 seconds of each ★ rally, straight after it (each render can switch it)'),
        h('label', { class: 'row', for: 'out-voices' }, outVoices, 'Remove voices from the sound: players’ shouts, coaching, talk by the court; the shuttle hits stay (each render can switch it; reels and clips too)'),
        data.voices ? null : h('p', { class: 'hint' }, 'Removing voices needs Demucs: run ', h('kbd', {}, 'analysis\\setup.ps1'), ' once (see the README).')),
      section('Music', 'A track under highlights (and reels, or every video), with the court’s own sound turned down.',
        h('div', { class: 'row' }, h('label', { class: 'btn small', for: 'music-file' }, 'Choose music…'), musicInput, musicState, removeMusic),
        h('div', { class: 'row' }, h('label', { for: 'music-use' }, 'Use it for'), musicUse),
        h('div', { class: 'row' }, h('label', { for: 'music-volume' }, 'Music'), musicVolume, h('label', { for: 'court-volume' }, 'Court sound'), courtVolume),
        h('p', { class: 'hint' }, 'Only use music you’re allowed to: YouTube may block or mute videos with copyrighted tracks.'),
        musicMsg),
      section('Cutting', 'How much of the play around each rally to keep when the gaps are cut.',
        h('div', { class: 'row' }, h('label', { for: 'pre' }, 'Keep'), pre, h('label', { for: 'post' }, 'seconds before each rally, and'), post, h('span', {}, 'after.'))),
      h('div', { class: 'label last' }, h('h3', {}, 'FFmpeg'), h('p', {}, 'Optional: its bin folder, if it isn’t found by itself.')),
      h('div', { class: 'fields last' }, h('div', { class: 'row' }, ffmpeg))),
    h('div', { class: 'row', style: { marginTop: '8px' } }, saveBtn),
    msg));
}

// ---------- Router ----------

async function router() {
  leaving?.();
  leaving = null;
  main.classList.remove('wide');
  const [path, query] = (location.hash || '#/').split('?');
  const [, section, id] = path.split('/');
  try {
    if (section === 't' && id) await renderTournament(id, null, new URLSearchParams(query ?? '').get('who'));
    else if (section === 'm' && id) {
      setTab('home');
      main.classList.add('wide');
      leaving = await renderEditor(main, Number(id), { runJob, errorNotice, progressBar });
    } else if (section === 'players') {
      setTab('players');
      await renderPlayers(main);
    } else if (section === 'p' && id) {
      setTab('players');
      await renderPlayer(main, id);
    } else if (section === 'jobs') {
      setTab('jobs');
      leaving = await renderJobs(main);
    } else if (section === 'videos') await renderVideos();
    else if (section === 'settings') await renderSettings();
    else await renderHome();
  } catch (err) {
    fill(main, h('h1', {}, 'Something went wrong'), errorNotice(err), h('p', {}, h('a', { href: '#/' }, 'Back to tournaments')));
  }
}

window.addEventListener('hashchange', router);
router();
