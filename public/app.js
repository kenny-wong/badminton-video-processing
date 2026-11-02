// The page: a hash router and the views. The match editor is in editor.js.
//   #/            tournaments, import, scan
//   #/t/<id>      a tournament's matches and their videos
//   #/m/<id>      the match editor
//   #/players     favourite players (★) and a search of everyone (players-page.js)
//   #/p/<id>      one player, by badminfo id
//   #/videos      every video found
//   #/tools       merge videos, split one (tools-page.js)
//   #/jobs        background jobs (jobs-page.js)
//   #/settings    folders, cutting, scoreboard, output

import { h, fill, when, day, megabytes, ukDate, gamesView, openButtons } from './dom.js';
import { api, waitJob } from './api.js';
import { boardNames, NAME_STYLES, namesMatch, teamName } from './shared/names.js';
import { gamesText } from './shared/score.js';
import { clock } from './shared/time.js';
import { renderEditor } from './editor.js';
import { icon } from './icons.js';
import { dropMissing, tournamentHero, illustratedEmpty } from './visuals.js';
import { errorNotice } from './notice.js';
import { customTournamentPanel } from './custom-tournament.js';
import { boardFlags, boardHeading, CORNERS, FONTS, HEADINGS, LAYOUTS, PRESETS } from './shared/board.js';
import { boardPreview } from './board-preview.js';
import { renderPlayer, renderPlayers } from './players-page.js';
import { percents } from './shared/players.js';
import { renderJobs, watchJobs } from './jobs-page.js';
import { renderTools } from './tools-page.js';
import { matchStar } from './match-star.js';
import { courtDisplay } from './shared/venues.js';
import { versionAdvice } from './shared/version.js';
import { backLinks, pageShown } from './nav.js';
import { readPrefs as readUploadPrefs } from './youtube-panel.js';

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
for (const [tab, name] of [['home', 'court'], ['players', 'user'], ['videos', 'match-video'], ['tools', 'scissors'], ['settings', 'settings']]) {
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
      ? [`Waiting: ${job.ahead || 'a'} job${job.ahead === 1 || !job.ahead ? '' : 's'}${job.queue === 'gpu' ? ' on the graphics card' : ''} first. `, h('a', { href: '#/jobs' }, 'See jobs')]
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
        fill(scanBox, h('div', { class: 'notice ok' }, scanText(r)));
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
          h('td', { class: 'nowrap' }, m.videos ? openButtons(m.units) : h('span', { class: 'small muted' }, 'no video'),
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

  // ---- tournaments: grouped under each favourite player (default), all of them, or one player's ----
  const listTitle = h('div', { class: 'section-title' });
  const list = h('div');
  const firstName = (f) => f.name.split(' ')[0];
  const playerSel = favs.length ? h('select', { 'aria-label': 'Whose tournaments', onchange: () => { writeHomePlayer(playerSel.value); drawList(); } },
    h('option', { value: 'group' }, 'Grouped by player'),
    h('option', { value: 'all' }, 'Every tournament'),
    favs.map((f) => h('option', { value: String(f.key) }, `★ ${f.name} (${Object.keys(f.tournaments).length})`))) : null;
  if (playerSel) playerSel.value = ['group', 'all', ...favs.map((f) => String(f.key))].includes(readHomePlayer()) ? readHomePlayer() : 'group';
  // Progress for the card's player (or all favourites): a section not done yet is yellow, a card with one is outlined red.
  const noProgress = (t) => ({ total: t.matches, matches: 0, filmedMatches: 0, games: 0, filmedGames: 0, taggedGames: 0, videos: 0, rendered: 0, uploaded: 0 });
  const notDone = (n, d) => d > 0 && n < d;
  const unfinished = (s) => notDone(s.filmedMatches, s.matches) || notDone(s.filmedGames, s.games) || notDone(s.taggedGames ?? 0, s.filmedGames)
    || notDone(s.rendered, s.videos) || notDone(s.uploaded, s.rendered);
  // `urgent`: work only the user can do (tagging) stands out in red, not the usual yellow.
  const tile = (n, d, label, tip, check = true, urgent = false) => h('div', { class: `stat${check && notDone(n, d) ? (urgent ? ' todo urgent' : ' todo') : ''}`, title: tip }, h('b', {}, `${n}/${d}`), h('span', {}, label));
  const progressTiles = (s, f, check) => h('div', { class: 'stats card-progress' },
    tile(s.matches, s.total, 'Matches', `${f ? `${f.name}’s` : 'Your favourites’'} matches / all matches here`, false),
    tile(s.filmedMatches, s.matches, 'Filmed matches', 'Their matches where every game has a linked video (one for the whole match, or one per game) / their matches', check),
    tile(s.filmedGames, s.games, 'Filmed games', 'Games with a linked video / games they played (a match not played yet counts as one game)', check),
    tile(s.taggedGames ?? 0, s.filmedGames, 'Tagged games', 'Filmed games whose rallies are all tagged with a winner / filmed games (each needs tagging)', check, true),
    tile(s.rendered, s.videos, 'Rendered', 'Rendered videos / linked videos (a whole match, or one game, each)', check),
    tile(s.uploaded, s.rendered, 'YouTube', 'Rendered videos on YouTube / rendered videos', check));
  // Marking a tournament complete (some matches were never filmed, say) stops its highlighting.
  const completeButton = (t) => h('button', {
    class: `small ${t.completedAt ? 'ghost' : ''}`,
    title: t.completedAt ? 'Marked complete: click to show what’s left to do again' : 'Mark complete when nothing more will be filmed, rendered or uploaded here (some matches had no video): the card is no longer highlighted',
    onclick: async (e) => {
      e.preventDefault(); // the button sits in the card's link
      e.stopPropagation();
      try {
        const r = await api(`/api/tournaments/${t.id}/complete`, { method: 'PUT', body: { complete: !t.completedAt } });
        t.completedAt = r.completedAt;
        drawList();
      } catch (err) {
        fill(importMsg, errorNotice(err));
      }
    },
  }, icon(t.completedAt ? 'refresh' : 'check', 14), t.completedAt ? 'Reopen' : 'Mark complete');
  const tournamentCard = (t, f = null) => {
    const s = f ? t.stats?.players?.[f.key] ?? noProgress(t) : t.stats?.mine ?? noProgress(t);
    const done = Boolean(t.completedAt);
    const open = !done && unfinished(s);
    return h('a', { class: `card${open ? ' unfinished' : ''}${done ? ' complete' : ''}`, href: f ? `#/t/${t.id}?who=${f.key}` : `#/t/${t.id}`, title: open ? 'Not finished: the yellow sections still have something to film, render or upload' : null },
      h('h3', {}, t.name, t.kind === 'custom' ? h('span', { class: 'pill', title: 'Made by hand' }, 'Custom') : null),
      h('div', { class: 'muted small' }, t.start === t.end || !t.end ? day(t.start) : `${day(t.start)} – ${day(t.end)}`),
      f ? h('div', { class: 'small' }, h('span', { class: 'pill ok' }, '★ ', f.tournaments[t.id]
        ? `${firstName(f)}: ${f.tournaments[t.id]} match${f.tournaments[t.id] === 1 ? '' : 'es'}` : `${firstName(f)} entered, no matches yet`)) : null,
      progressTiles(s, f, !done),
      h('div', { class: 'row spread card-foot' },
        done ? h('span', { class: 'pill ok', title: `Marked complete ${day(t.completedAt.slice(0, 10))}` }, '✓ Complete') : h('span'),
        open || done ? completeButton(t) : null));
  };
  /** Tournaments by year, newest first (they come sorted by date): [[year, list], …]. */
  const byYear = (ts) => {
    const years = new Map();
    for (const t of ts) {
      const y = (t.start || t.end || '').slice(0, 4) || 'Undated';
      if (!years.has(y)) years.set(y, []);
      years.get(y).push(t);
    }
    return [...years];
  };
  const yearCards = (ts, f = null) => byYear(ts).map(([y, list]) => h('div', { class: 'year-group' },
    h('div', { class: 'year-title' }, y, h('span', { class: 'muted' }, ` · ${list.length}`)),
    h('div', { class: 'tournament-list' }, list.map((t) => tournamentCard(t, f)))));
  const libraryEmpty = () => illustratedEmpty('Your match library starts here.', 'Paste a badminfo or Badminton England link above to bring in the matches, or make your own tournament, then link your footage.');
  // Finding a tournament by name among many: every word typed must be in its name.
  const nameFilter = h('input', { type: 'search', class: 'tournament-find', placeholder: 'Find a tournament by name', 'aria-label': 'Find a tournament by name', oninput: () => drawList() });
  const noneNamed = () => h('p', { class: 'hint' }, `No tournament’s name has “${nameFilter.value.trim()}”.`);
  const drawList = () => {
    const choice = playerSel?.value ?? 'all';
    const words = nameFilter.value.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = tournaments.filter((t) => words.every((w) => t.name.toLowerCase().includes(w)));
    const of = words.length ? ` of ${tournaments.length}` : '';
    if (choice === 'group') {
      // A tournament with two favourites shows under both; tournaments with none come last.
      const groups = favs.map((f) => ({ f, list: pool.filter((t) => Object.hasOwn(f.tournaments, t.id)) })).filter((g) => g.list.length);
      const placed = new Set(groups.flatMap((g) => g.list.map((t) => t.id)));
      const rest = pool.filter((t) => !placed.has(t.id));
      fill(listTitle, icon('trophy', 15), `Tournaments by player (${pool.length}${of})`);
      fill(list, !tournaments.length ? libraryEmpty() : !pool.length ? noneNamed() : [
        groups.map(({ f, list: ts }) => h('section', { class: 'player-group' },
          h('h3', { class: 'group-title' }, h('a', { class: 'plain', href: f.id ? `#/p/${f.id}` : '#/players' }, `★ ${f.name}`), h('span', { class: 'muted small' }, ` ${ts.length} tournament${ts.length === 1 ? '' : 's'}`)),
          yearCards(ts, f))),
        rest.length ? h('section', { class: 'player-group' },
          h('h3', { class: 'group-title' }, favs.length ? 'Other tournaments' : 'Tournaments', h('span', { class: 'muted small' }, favs.length ? ' none of your favourites in them' : ' none of your favourites in them yet')),
          yearCards(rest)) : null,
      ]);
      return;
    }
    const f = favs.find((x) => String(x.key) === choice);
    const shown = f ? pool.filter((t) => Object.hasOwn(f.tournaments, t.id)) : pool;
    fill(listTitle, icon('trophy', 15), f ? `${f.name}’s tournaments (${shown.length} of ${tournaments.length})` : `Tournaments (${shown.length}${of})`);
    fill(list, shown.length
      ? yearCards(shown, f)
      : words.length ? noneNamed() : f ? illustratedEmpty(`No tournaments for ${f.name} yet.`, 'Import a tournament they have entered, or add them to a custom tournament, to see it here.') : libraryEmpty());
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
      h('img', { class: 'setup-art', src: 'visual-kit/shuttle-video.png', alt: '', width: 190, height: 175, loading: 'lazy', onerror: dropMissing })) : null,
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
    h('div', { class: 'row spread' }, listTitle, h('div', { class: 'row' }, tournaments.length ? nameFilter : null, playerSel)),
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

// A render or upload started from the tournament page that failed: shown beside its button, the reason in
// a tooltip, until tried again. Keyed 'render:<unit id>' / 'upload:<unit id>'; outlives redraws of the page.
const stepFailures = new Map(); // key -> { message, detail, retryAt }

// The tournament page's list/grid choice and filters, per device.
const PREFS_KEY = 'badminton-video:tournament-view:v1';
// Where the tournament page was when a match or game was opened in the editor: that match or game
// and how far down the window it sat (`top`), or the page's scrolled fraction when it's gone. Coming
// back from the editor puts it there again; other redraws (filters, linking) leave the scroll alone.
let tournamentReturn = null; // { id, anchor, top, ratio }
let backFromEditor = false; // set by the router for the next tournament page only
// Keep the current search and expanded games when a link or result update redraws the page.
const tournamentViews = new Map();
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

async function renderTournament(id, notice = null, who = null) {
  setTab('home');
  const data = await api(`/api/tournaments/${id}`);
  const { tournament, matches, videos, suggestions } = data;
  document.title = `${tournament.name} · Badminton Video`;
  // A custom tournament (made by hand): its details, players and matches are edited here.
  const custom = tournament.kind === 'custom' ? customTournamentPanel({ id, data, rerender: (n) => renderTournament(id, n ?? null), errorNotice }) : null;
  const byId = new Map(videos.map((v) => [v.id, v]));
  // Courts shortened for showing ("Court 3"), the venue named once in the head; the full name in a tooltip.
  const courts = courtDisplay(matches.map((m) => m.court));
  const courtOf = (m) => courts.label(m.court);
  // One video per match (game 0) or per game: back-to-back videos of one match are suggested game by game.
  const suggestionFor = new Map(suggestions.map((s) => [`${s.matchId}:${s.game}`, s]));
  const suggestionOf = (m, game = 0) => suggestionFor.get(`${m.id}:${game}`);
  const gameSuggestions = (m) => suggestions.filter((s) => s.matchId === m.id && s.game);
  const suggestionPath = (s) => (s.game ? `/api/matches/${s.matchId}/games/${s.game}/videos` : `/api/matches/${s.matchId}/videos`);
  const suggested = new Set(suggestions.flatMap((s) => s.ids));
  const free = videos.filter((v) => !v.matchId);
  const anyMine = matches.some((m) => m.mine);
  const saved = readPrefs();
  if (!tournamentViews.has(String(id))) tournamentViews.set(String(id), { search: '', progress: '', expandedGames: new Set(), notFilmedOpen: new Set() });
  const viewState = tournamentViews.get(String(id));
  // whose matches: '' everyone's, 'fav' the favourites', or one favourite's key (onlyMine was the old checkbox)
  const prefs = { view: 'list', hideNoVideo: false, ...saved, who: saved.who ?? (saved.onlyMine === false ? '' : 'fav') };
  if (who !== null) {
    prefs.who = who; // from the Tournaments page's player choice; kept for this page's re-draws
    writePrefs(prefs);
  }
  if (!['', 'fav'].includes(prefs.who) && !data.favourites.some((f) => String(f.key) === prefs.who)) prefs.who = 'fav';
  const hasFav = (m, key) => m.favs.a.includes(key) || m.favs.b.includes(key);
  const msg = h('div');
  const table = h('div', { class: 'tournament-matches' });
  const expandedGames = viewState.expandedGames;

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
    e.stopPropagation();
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
    if (ids.length > 1) {
      fill(msg, h('div', { class: 'notice warn' }, 'A match or game takes one video. Drop each game’s video on its own game.'));
      return;
    }
    const current = u.videoIds ?? [];
    if (current.includes(ids[0])) return;
    if (current.length && !confirm(`This ${unitName(u)} already has a video (${byId.get(current[0])?.name ?? 'linked'}). Replace it with the dropped one? Its tagging goes with the old video.`)) return;
    link(u, ids);
  };
  const dropOn = (u) => ({
    ondragover: (e) => {
      if (![...e.dataTransfer.types].some((t) => t === VIDEO_TYPE || t === 'Files')) return;
      e.preventDefault();
      e.stopPropagation();
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
      class: 'video-chooser',
      'aria-label': `Choose a video for the ${unitName(u)}`,
      onchange: (e) => e.target.value && link(u, [Number(e.target.value)]),
    }, h('option', { value: '' }, 'Choose video…'), choices.map((v) => h('option', { value: v.id }, videoLabel(v))));
  };

  const linkedCell = (u) => {
    const v = byId.get(u.videoIds[0]);
    // The video (name, length) with Open editor and Unlink under it, as one block at the right: both act on
    // this video. Its next steps (Render, Upload) sit after its status labels instead (stepsOf).
    return h('div', { class: 'video-link' },
      h('div', { class: 'video-main' },
        v ? h('div', { class: 'video-file small', title: v.name },
          icon('film', 14), h('span', { class: 'video-name' }, v.name),
          h('span', { class: 'video-length', title: 'Length of the video' }, icon('hourglass', 13), clock(v.duration ?? 0))) : null,
        h('div', { class: 'row video-actions' },
          h('span', { class: 'video-buttons' },
            h('a', { class: 'btn primary small', href: `#/m/${u.id}` }, icon('play', 13), 'Open editor'),
            h('button', { class: 'small ghost unlink-video', title: `Unlink this ${unitName(u)}’s video`, onclick: () => link(u, []) }, 'Unlink')))));
  };

  // ---- each video's next steps, one row each with its progress beside it: Render (once every rally has a
  // winner and who served first is chosen, until it's rendered) and Upload (until it has a YouTube link: the
  // rendered video when there is one, else the original as it is), straight from here with the choices last
  // made in a YouTube box. They can run at once (renders and uploads take turns in their own queues); one
  // started here, or still waiting or running when the page opens, shows its progress with Stop.
  const renderJobs = new Map(); // unit id -> its render job while it waits or runs
  const uploadJobs = new Map(); // unit id -> its upload job while it waits or runs
  const percent = (job) => Math.round((job.progress ?? 0) * 100);
  // Kept short (the words in the tooltip), so the row stays one line.
  const progressNote = (job, doing) => (job.status === 'queued'
    ? h('span', { class: 'step-progress muted', title: 'Waiting for the jobs before it' }, 'Waiting…')
    : h('span', { class: 'step-progress', title: `${doing} ${percent(job)}%${job.message ? `: ${job.message}` : ''}` },
      h('span', { class: 'mini-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${percent(job)}%` } })), h('span', { class: 'muted' }, `${percent(job)}%`)));
  // A time to try again, in the viewer's own clock: 'Try again at 16:21 (Tue)'.
  const retryText = (iso) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return null;
    return `Try again at ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (${t.toLocaleDateString('en-GB', { weekday: 'short' })})`;
  };
  // "Failed" beside a button, the reason (and its details) only in the tooltip; when YouTube's limit is
  // the reason, when it can go again, highlighted.
  const failedNote = (key) => {
    const f = stepFailures.get(key);
    if (!f) return null;
    const retry = f.retryAt && Date.parse(f.retryAt) > Date.now() ? retryText(f.retryAt) : null;
    const tip = [f.message, readableDetail(f.detail), retry ? `${retry}.` : 'Click the button to try again; the Jobs page has the log.'].filter(Boolean).join('\n\n');
    return h('span', { class: 'step-failed', title: tip, tabindex: 0, 'aria-label': `Failed: ${f.message}${retry ? `. ${retry}` : ''}` }, icon('alert', 13), 'Failed',
      retry ? h('span', { class: 'retry-at' }, retry) : null);
  };
  const remember = (key, err) => stepFailures.set(key, { message: err?.message ?? String(err), detail: err?.detail ?? null, retryAt: err?.job?.retryAt ?? err?.retryAt ?? null });
  // A reply from Google comes as JSON: its own message reads better than the whole of it.
  const readableDetail = (detail) => {
    if (!detail) return null;
    try {
      const j = JSON.parse(detail);
      const m = j?.error?.message ?? j?.error_description ?? j?.message;
      if (m) return String(m);
    } catch { /* plain text */ }
    return String(detail).slice(0, 400);
  };
  const renderControl = (uid) => {
    const job = renderJobs.get(uid);
    return h('div', { class: 'row tight small step-row', 'data-render': uid },
      job
        ? [h('button', { class: 'small danger', title: 'Stop this render', onclick: () => stopJob(uid, renderJobs, 'Stop this render? What it has made so far is thrown away.') }, icon('stop', 13), 'Stop render'), progressNote(job, 'Rendering')]
        : [h('button', { class: 'small', title: 'Render with the options in Settings (the editor’s Export tab has more)', onclick: () => startRender(uid) }, icon('export', 13), 'Render'), failedNote(`render:${uid}`)]);
  };
  const uploadControl = (u) => {
    const job = uploadJobs.get(u.id);
    const rendered = Boolean(u.outputPath);
    return h('div', { class: 'row tight small step-row', 'data-upload': u.id },
      job
        ? [h('button', { class: 'small danger', title: 'Stop this upload', onclick: () => stopJob(u.id, uploadJobs, 'Stop this upload? YouTube gets nothing; you can upload again later.') }, icon('stop', 13), 'Stop upload'), progressNote(job, 'Uploading')]
        : [h('button', {
          class: 'small', onclick: () => startUpload(u),
          title: rendered ? 'Upload the rendered video to YouTube, with the privacy and playlist last chosen in a YouTube box' : 'Upload the original video, as it is, to YouTube (not rendered yet), with the privacy and playlist last chosen in a YouTube box',
        }, icon('youtube', 13), rendered ? 'Upload (rendered)' : 'Upload (original)'), failedNote(`upload:${u.id}`)]);
  };
  const unitById = (uid) => matches.flatMap((m) => [m, ...m.units]).find((x) => x.id === uid);
  const show = (uid) => {
    document.querySelectorAll(`[data-render="${uid}"]`).forEach((el) => el.replaceWith(renderControl(uid)));
    const u = unitById(uid);
    if (u) document.querySelectorAll(`[data-upload="${uid}"]`).forEach((el) => el.replaceWith(uploadControl(u)));
  };
  const follow = async (uid, job, jobsOf, done, kind) => {
    jobsOf.set(uid, job);
    stepFailures.delete(`${kind}:${uid}`);
    show(uid);
    try {
      const finished = await waitJob(job, (j) => { jobsOf.set(uid, j); if (table.isConnected) show(uid); });
      jobsOf.delete(uid);
      if (table.isConnected) renderTournament(id, done(finished));
    } catch (err) {
      jobsOf.delete(uid);
      if (err.code !== 'stopped') remember(`${kind}:${uid}`, err); // stays beside the button, even after a redraw
      if (table.isConnected) show(uid);
    }
  };
  const followRender = (uid, job) => follow(uid, job, renderJobs, () => h('div', { class: 'notice ok' }, 'Rendered: its file is ready to watch and upload.'), 'render');
  // waitJob gives the job's result: the upload's { url, locked, … }.
  const followUpload = (uid, job) => follow(uid, job, uploadJobs, (r) => h('div', { class: 'notice ok' }, 'Uploaded to YouTube',
    r?.url ? [': ', h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.url)] : '', r?.locked ? ' (YouTube keeps it private for now)' : '', '.'), 'upload');
  const startRender = async (uid) => {
    try {
      followRender(uid, await api(`/api/matches/${uid}/render`, { method: 'POST', body: {} }));
    } catch (err) {
      remember(`render:${uid}`, err);
      show(uid);
    }
  };
  const startUpload = async (u) => {
    // No question: the privacy and playlist last chosen in a YouTube box (Unlisted, into the playlist, at first).
    const prefs = readUploadPrefs();
    const file = u.outputPath ? 'video' : 'original';
    try {
      followUpload(u.id, await api(`/api/matches/${u.id}/youtube`, { method: 'POST', body: { file, privacy: prefs.privacy, playlist: prefs.playlist } }));
    } catch (err) {
      remember(`upload:${u.id}`, err.code === 'signin' ? { message: 'Not signed in to YouTube', detail: 'Sign in first: open any video’s editor, Export tab, YouTube box, Sign in to YouTube.' } : err);
      show(u.id);
    }
  };
  // Jobs queued by Render all / Upload all: each video's row follows its own (progress, Stop), as when started there.
  const followQueued = (jobs, followOne) => {
    for (const j of jobs ?? []) followOne(Number(j.key.split(':')[1]), j);
  };
  const stopJob = async (uid, jobsOf, question) => {
    const job = jobsOf.get(uid);
    if (!job || !confirm(question)) return;
    await api(`/api/jobs/${job.id}/stop`, { method: 'POST' }).catch((err) => fill(msg, errorNotice(err)));
  };
  const nextStep = (u) => {
    const render = renderJobs.has(u.id) || unitStage(u) === 'render';
    const upload = uploadJobs.has(u.id) || !u.youtubeUrl;
    if (!render && !upload) return null;
    return h('div', { class: 'next-step' }, render ? renderControl(u.id) : null, upload ? uploadControl(u) : null);
  };
  // A filmed video's next steps, after its status labels; nothing for one without a video.
  const stepsOf = (u) => (u.videoIds?.length ? nextStep(u) : null);

  const perGame = (m) => m.units.length >= 2 || m.units.some((u) => u.videoIds.length);
  const gamesLinked = (m) => m.units.some((u) => u.videoIds.length);
  const unitsOf = (m) => m.units.map((u) => ({ ...u, parent: m }));
  const hasVideo = (m) => m.videoIds.length > 0 || gamesLinked(m);
  const filmedUnits = (m) => m.videoIds.length ? [m] : m.units.filter((u) => u.videoIds.length);
  // Tagged: every rally has a winner and who served first is chosen (serverSet false: not yet).
  const isTagged = (u) => u.rallyCount > 0 && u.tagged === u.rallyCount && u.serverSet !== false;
  // A tagged score that differs from the result is still to tag: no Render here until it's fixed (as Render all).
  const unitStage = (u) => u.youtubeUrl ? 'done' : u.outputPath ? 'upload' : isTagged(u) && u.check?.ok !== false ? 'render' : 'tag';

  // A suggested video with its Link button.
  const suggestedCell = (u, s) => {
    const v = byId.get(s.ids[0]);
    return h('div', { class: 'video-suggestion stack' },
      h('div', { class: 'row small' }, h('span', { class: 'pill warn' }, 'Suggested video'),
        h('span', { class: 'muted' }, when(v?.recordedAt, { date: false }))),
      h('div', { class: 'video-file small', title: v?.name }, v?.name ?? 'Video'),
      s.lateMin && !s.game ? h('span', { class: 'small muted' }, `${Math.abs(s.lateMin)} min ${s.lateMin > 0 ? 'after' : 'before'} scheduled`) : null,
      h('button', { class: 'small primary', onclick: () => link(u, s.ids) }, icon('link', 13), 'Link video'));
  };

  const videoCell = (m) => {
    if (m.videoIds.length) return linkedCell(m);
    if (gamesLinked(m)) return h('div', { class: 'game-video-summary small' }, icon('film', 15), `${filmedUnits(m).length} of ${m.units.length} games filmed`);
    const s = suggestionOf(m);
    if (s) return suggestedCell(m, s);
    const games = gameSuggestions(m);
    if (games.length) {
      return h('div', { class: 'stack' },
        h('span', { class: 'small' }, h('span', { class: 'pill warn' }, 'Suggested'), ` ${games.length} game videos`),
        h('button', {
          class: 'small primary',
          onclick: async () => {
            try {
              for (const g of games) await api(suggestionPath(g), { method: 'PUT', body: { videoIds: g.ids } });
              renderTournament(id);
            } catch (err) {
              fill(msg, errorNotice(err));
            }
          },
        }, `Link ${games.length === 2 ? 'both' : `all ${games.length}`}`));
    }
    return chooser(m, m.date);
  };

  const unitVideoCell = (u) => {
    if (u.videoIds.length) return linkedCell(u);
    const s = suggestionOf(u.parent, u.game);
    return s ? suggestedCell(u, s) : chooser(u, u.parent.date);
  };

  // A match's own YouTube link; for a match filmed game by game, once a game is uploaded, the tournament's playlist.
  const youtubeTag = (m, tag) => {
    const up = m.youtubeUrl ? [] : (m.units ?? []).filter((u) => u.youtubeUrl).map((u) => u.game);
    if (!up.length) return tag(Boolean(m.youtubeUrl), 'youtube', m.youtubeUrl ? 'YouTube ↗' : 'YouTube', m.youtubeUrl ?? 'Not on YouTube yet', m.youtubeUrl);
    const which = `Game${up.length > 1 ? 's' : ''} ${up.join(' and ')} on YouTube`;
    return data.playlistUrl
      ? tag(true, 'youtube', 'Playlist ↗', `${which}: opens the tournament’s playlist`, data.playlistUrl)
      : tag(true, 'youtube', `${up.length}/${m.units.length} on YouTube`, `${which} (added by hand, so not in a playlist made by the app)`);
  };

  // What's done for a match (or game), as a row of labels: each in its own colour when done, greyed when not.
  const statusCell = (m) => {
    if (!m.videoIds?.length && !(m.units && gamesLinked(m))) return m.units ? h('span', { class: 'small muted' }, 'Not filmed') : null;
    const tag = (done, kind, text, title, href = null) => (done && href
      ? h('a', { class: `tag ${kind}`, href, target: '_blank', rel: 'noopener', title }, text)
      : h('span', { class: `tag ${kind}${done ? '' : ' off'}`, title }, text));
    if (m.units && !m.videoIds.length && gamesLinked(m)) {
      const units = filmedUnits(m);
      const total = m.units.length;
      const tagged = units.filter(isTagged).length;
      const rendered = units.filter((u) => u.outputPath).length;
      const checks = units.filter((u) => u.rallyCount && u.check && u.games?.length);
      const bad = checks.some((u) => !u.check.ok);
      const scoreOk = checks.length === total && !bad;
      return h('div', { class: 'row tags' },
        tag(tagged > 0, tagged < total ? 'rallies part' : 'rallies', `${tagged}/${total} tagged games`, 'Games with every rally tagged and who served first chosen'),
        tag(bad || scoreOk, bad ? 'score-bad' : scoreOk ? 'score-ok' : 'score', bad ? 'Score ≠' : scoreOk ? 'Score ✓' : 'Score', bad ? 'A game’s tagged score differs from the result: fix its tagging in the editor to render it here or with Render all tagged' : 'Tagged game scores checked against the result'),
        tag(rendered > 0, 'render', `${rendered}/${total} rendered`, 'Rendered game videos'),
        youtubeTag(m, tag));
    }
    const allTagged = m.rallyCount > 0 && m.tagged === m.rallyCount;
    const noServer = allTagged && m.serverSet === false; // every winner tagged, but who served first not chosen
    const checked = m.rallyCount > 0 && m.check && m.games?.length;
    return h('div', { class: 'row tags' },
      tag(m.rallyCount > 0, m.rallyCount && (!allTagged || noServer) ? 'rallies part' : 'rallies',
        !m.rallyCount ? 'Rallies' : noServer ? `${m.rallyCount} rallies · serve?` : allTagged ? `${m.rallyCount} rallies` : `${m.tagged}/${m.rallyCount} rallies`,
        !m.rallyCount ? 'No rallies yet' : noServer ? 'Every rally has a winner; choose who served first in the editor (Scoring tab)' : allTagged ? 'Every rally has a winner' : `${m.rallyCount - m.tagged} rallies have no winner yet`),
      checked
        ? tag(true, m.check.ok ? 'score-ok' : 'score-bad', m.check.ok ? 'Score ✓' : 'Score ≠', `Tagged: ${gamesText(m.tagGames)}${m.check.ok ? ', the same as the result' : ', not the result. Fix the tagging in the editor to render it here or with Render all tagged.'}`)
        : tag(false, 'score', 'Score', 'The tagged score, checked against the result once there are rallies'),
      tag(Boolean(m.outputPath), 'render', 'Rendered', m.outputPath ? 'Rendered' : 'Not rendered yet'),
      youtubeTag(m, tag),
      m.favourites ? h('span', { class: 'pill highlight', title: 'Favourite (★) rallies: they make the highlights video and reels' }, `★ ${m.favourites} Highlight${m.favourites === 1 ? '' : 's'}`) : null);
  };

  // badminfo's chance before the match, each side's with its names.
  const shortTeam = (team) => (team.length > 1 ? team.map((n) => n.trim().split(/\s+/).at(-1)).join(' / ') : team[0] ?? '');
  const chanceCell = (m) => {
    if (typeof m.people?.chance !== 'number') return h('span', { class: 'small muted' }, 'Not available');
    const [pa, pb] = percents(m.people.chance);
    return h('div', { class: 'chance-cell small', title: `badminfo’s chance before the match: ${teamName(m.teamA)} ${pa}, ${teamName(m.teamB)} ${pb}` },
      h('div', {}, h('span', { class: 'pct' }, pa), m.teamA.length > 1 ? [' ', shortTeam(m.teamA)] : null),
      h('div', {}, h('span', { class: 'pct' }, pb), m.teamB.length > 1 ? [' ', shortTeam(m.teamB)] : null),
      h('div', { class: 'chance-meter', 'aria-hidden': 'true' }, h('span', { style: { width: pa } })),
      m.people.upset ? h('span', { class: 'pill upset', title: 'The side with under a 35% chance won' }, 'Upset') : null);
  };

  const gameLabel = (u) => [h('strong', {}, `Game ${u.game}`), u.parent.games[u.game - 1] ? h('span', { class: 'muted' }, ` (${u.parent.games[u.game - 1].join('-')})`) : null];

  // Each name links to the player's page and carries their badminfo rating for this event, when known.
  // Your starred players get a gold mark (by badminfo id, else by name).
  const starred = (n, id) => data.favourites.some((f) => (id && f.id === id) || namesMatch(f.name, n));
  const named = (m, k) => (k ? m.teamB : m.teamA).map((n, i) => {
    const id = m.people?.ids?.[k]?.[i];
    const st = m.people?.teams?.[k]?.[i];
    const name = id ? h('a', { class: 'plain', href: `#/p/${id}` }, n) : n;
    return [i ? ' / ' : '', starred(n, id) ? h('span', { class: 'fav-name', title: 'One of your players' }, '★ ', name) : name,
      st?.rating ? h('span', { class: 'rating-chip', title: `badminfo rating${st.grade ? `, grade ${st.grade}` : ''}` }, st.rating) : null];
  });
  // The winners in green with a tick, the losers in red, once the result is in.
  const side = (m, k) => (!m.winner ? '' : m.winner === k + 1 ? 'team-won' : 'team-lost');
  const teams = (m) => h('div', { class: 'matchup' }, [0, 1].map((k) =>
    h('div', { class: `team-line ${side(m, k)}` },
      h('div', { class: 'team-name' }, h('span', { class: 'team-result', title: m.winner === k + 1 ? 'Winner' : '' }, m.winner === k + 1 ? '✓' : ''), h('span', {}, named(m, k))),
      m.games?.length ? h('div', { class: 'team-scores' }, m.games.map((g, j) =>
        h('span', { class: `game-point${g[k] > g[1 - k] ? ' win' : g[k] < g[1 - k] ? ' lose' : ''}`, title: `Game ${j + 1}: ${teamName(k ? m.teamB : m.teamA)} ${g[k]}`, 'aria-label': `Game ${j + 1}: ${g[k]}` }, g[k]))) : null)));

  const eventLine = (m) => h('div', { class: 'match-event small' },
    h('span', { class: 'event-label' }, m.draw || 'Match'), h('span', { class: 'muted' }, m.round),
    !m.games?.length ? h('span', { class: 'muted result-pending', title: 'No result is recorded: not played yet, or played but its result isn’t in yet (Update results)' }, 'No result yet') : null);

  // One game: its thumbnail when filmed, its name and score, progress, its next steps (Render, Upload) and
  // its video (Open, a suggestion or the chooser).
  const gameRow = (u) => h('div', { class: 'game-video-row', 'data-anchor': u.id ? `u${u.id}` : null, ...dropOn(u) },
    u.videoIds.length ? thumbOf(u, lengthOf(u), false) : null,
    h('div', { class: 'game-video-heading' }, h('div', { class: 'small game-name' }, gameLabel(u)), statusCell(u)),
    u.videoIds.length ? h('div', { class: 'game-video-steps' }, stepsOf(u)) : null,
    h('div', { class: 'game-video-controls' }, unitVideoCell(u)));

  // A match filmed game by game: its filmed games always show; the games still without a video
  // (all of them, before any is linked) fold away, open or shut as last left in this session.
  const gameDetails = (m) => {
    const units = unitsOf(m);
    const linked = units.filter((u) => u.videoIds.length);
    const rest = units.filter((u) => !u.videoIds.length);
    const suggested = gameSuggestions(m).length;
    const fold = rest.length ? h('details', { class: 'match-games', open: expandedGames.has(m.id), ontoggle: (e) => {
      if (e.target.open) expandedGames.add(m.id);
      else expandedGames.delete(m.id);
    } },
    h('summary', {},
      h('span', {}, linked.length ? `${rest.length} game${rest.length === 1 ? '' : 's'} without a video` : 'Game videos'),
      h('span', { class: 'small muted' }, suggested ? `${suggested} suggested` : linked.length ? '' : `${units.length} games`)),
    h('div', { class: 'game-video-list' }, rest.map(gameRow))) : null;
    return linked.length ? h('div', { class: 'match-games-filmed' }, h('div', { class: 'game-video-list' }, linked.map(gameRow)), fold) : fold;
  };

  const listView = (list) => h('div', { class: 'table-scroll tournament-table' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Time / court', 'Match & result', 'Win chance', 'Video', 'Progress'].map((x) => h('th', { scope: 'col' }, x)))),
    list.map((m) => h('tbody', { class: `match-group${m.mine ? ' mine' : ''}`, 'data-anchor': `m${m.id}`, ...dropOn(m) },
      h('tr', { class: `match-main${m.mine ? ' mine' : ''}` },
        h('td', { class: 'match-schedule' },
          h('div', { class: 'row tight' }, matchStar(m.id, m.favourite, { onChange: (on) => { m.favourite = on; } }), h('strong', {}, m.time)),
          courtOf(m) ? h('div', { class: 'small match-court', title: m.court }, courtOf(m)) : null,
          m.duration ? h('div', { class: 'small muted' }, `${m.duration} min`) : null),
        h('td', { class: 'match-details' }, eventLine(m), teams(m), custom ? custom.actions(m) : null),
        h('td', { class: 'match-chance', 'data-label': 'Win chance' }, chanceCell(m)),
        h('td', { class: 'match-video', 'data-label': 'Video' }, m.videoIds.length ? thumbOf(m, lengthOf(m), false) : null, videoCell(m)),
        h('td', { class: 'match-progress', 'data-label': 'Progress' }, statusCell(m), stepsOf(m))),
      // Game by game, unless one video covers the whole match.
      perGame(m) && !m.videoIds.length ? h('tr', { class: 'match-games-row' }, h('td', { colspan: 5 }, gameDetails(m))) : null))));

  const thumbOf = (u, total, big = true) => h('a', { class: big ? 'thumb' : 'thumb small-thumb', href: `#/m/${u.id}`, title: 'Open' },
    h('img', { src: u.thumb, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); } }),
    h('span', { class: 'play' }, '▶'),
    h('span', { class: 'length' }, clock(total)));
  const lengthOf = (u) => u.videoIds.map((v) => byId.get(v)).filter(Boolean).reduce((t, v) => t + (v.duration ?? 0), 0);

  const gridView = (list) => h('div', { class: 'match-grid' }, list.map((m) => {
    const filmed = m.videoIds.length > 0;
    const games = perGame(m) && !filmed;
    return h('article', { class: `match-card${m.mine ? ' mine' : ''}`, 'data-anchor': `m${m.id}`, ...dropOn(m) },
      filmed
        ? thumbOf(m, lengthOf(m))
        : null,
      h('div', { class: 'match-body' },
        h('div', { class: 'row tight small match-card-schedule' }, matchStar(m.id, m.favourite, { onChange: (on) => { m.favourite = on; } }), h('strong', {}, m.time),
          courtOf(m) ? h('span', { title: m.court }, `· ${courtOf(m)}`) : null, m.duration ? h('span', { class: 'muted' }, `· ${m.duration} min`) : null),
        eventLine(m),
        teams(m),
        typeof m.people?.chance === 'number' ? h('div', { class: 'match-card-chance' }, h('div', { class: 'small muted' }, 'Win chance'), chanceCell(m)) : null,
        statusCell(m),
        stepsOf(m),
        custom ? custom.actions(m) : null,
        h('div', { class: 'match-card-video' }, videoCell(m)),
        games ? gameDetails(m) : null));
  }));

  const search = h('input', { type: 'search', value: viewState.search, placeholder: 'Find a player, event, round or court…', 'aria-label': 'Find a match in this tournament', oninput: () => { viewState.search = search.value; drawTable(); } });
  // Two kinds of progress filter, never mixed. Done so far (also what the totals' clicks pick) counts a video that
  // went further: Tagged includes tagged videos since rendered or uploaded, Rendered includes those on YouTube.
  // Next step is where each video is now: Ready for YouTube is rendered and not uploaded yet.
  const DONE = { filmed: ['Filmed', 'linked'], tagged: ['Tagged', 'tagged'], rendered: ['Rendered', 'rendered'], youtube: ['On YouTube', 'on YouTube'] };
  const NEXT = { unlinked: ['Needs a video'], tag: ['Needs tagging', 'to tag'], render: ['Ready to render', 'ready to render'], upload: ['Ready for YouTube', 'ready for YouTube'], todo: ['To do: tag, render or upload', 'to do'] };
  const doneSoFar = {
    filmed: () => true,
    tagged: (u) => isTagged(u),
    rendered: (u) => Boolean(u.outputPath),
    youtube: (u) => Boolean(u.youtubeUrl),
  };
  const unitPasses = (u, f) => (Object.hasOwn(doneSoFar, f) ? doneSoFar[f](u) : f === 'todo' ? ['tag', 'render', 'upload'].includes(unitStage(u)) : unitStage(u) === f);
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (viewState.progress === 'done') viewState.progress = 'youtube'; // its name before 1.60.0
  const progressFilter = h('select', { 'aria-label': 'Filter by progress', onchange: () => setProgress(progressFilter.value) },
    h('option', { value: '' }, 'All progress'),
    h('optgroup', { label: 'Done so far' }, Object.entries(DONE).map(([value, [label]]) => h('option', { value }, label))),
    h('optgroup', { label: 'Next step' }, Object.entries(NEXT).map(([value, [label]]) => h('option', { value }, label))));
  progressFilter.value = viewState.progress;
  const setProgress = (value) => {
    progressFilter.value = value;
    viewState.progress = value;
    drawTable();
  };
  const matchCount = h('span', { class: 'small muted match-count', role: 'status', 'aria-live': 'polite' });
  const hideNoVideo = h('input', { type: 'checkbox', checked: prefs.hideNoVideo, onchange: (e) => setPref('hideNoVideo', e.target.checked) });
  const clearFilters = () => {
    search.value = '';
    progressFilter.value = '';
    whoSel.value = '';
    hideNoVideo.checked = false;
    Object.assign(prefs, { who: '', hideNoVideo: false });
    Object.assign(viewState, { search: '', progress: '' });
    writePrefs(prefs);
    drawTable();
  };
  const clearFilterBtn = h('button', { class: 'small ghost', onclick: clearFilters }, 'Clear filters');

  const drawTable = () => {
    // One favourite: only their matches. All favourites: theirs, and any other match with a video.
    const picked = (m) => (!anyMine || !prefs.who ? true : prefs.who === 'fav' ? m.mine || hasVideo(m) : hasFav(m, Number(prefs.who)));
    const words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const shown = matches.filter((m) => {
      if (!picked(m) || (prefs.hideNoVideo && !hasVideo(m))) return false;
      const text = [...m.teamA, ...m.teamB, m.draw, m.round, m.court, courtOf(m), m.time, m.date].join(' ').toLowerCase();
      if (!words.every((word) => text.includes(word))) return false;
      if (!progressFilter.value) return true;
      if (progressFilter.value === 'unlinked') return !m.videoIds.length && (!m.units.length || m.units.some((u) => !u.videoIds.length));
      return filmedUnits(m).some((u) => unitPasses(u, progressFilter.value));
    });
    const days = [...new Set(shown.map((m) => m.date))];
    const view = prefs.view === 'grid' ? gridView : listView;
    // A video filter says how many videos it found as well: several can belong to one match.
    const f = progressFilter.value;
    const what = (DONE[f] ?? NEXT[f])?.[1];
    const videosFound = what ? `${plural(shown.flatMap(filmedUnits).filter((u) => unitPasses(u, f)).length, 'video')} ${what} · ` : '';
    matchCount.textContent = `${videosFound}Showing ${shown.length} of ${matches.length} match${matches.length === 1 ? '' : 'es'}`;
    drawOverview();
    clearFilterBtn.hidden = !search.value && !progressFilter.value && !prefs.hideNoVideo && (!anyMine || !prefs.who);
    // Each day: its filmed matches first, then the rest folded under "Not filmed (n)", both in time order.
    // Nothing folds while the tournament has nothing filmed (there's nothing else to see yet). A search or
    // Needs a video opens the folds with results; the folds the user opened or shut come back after.
    const folding = matches.some(hasVideo);
    const findingVideos = Boolean(words.length || progressFilter.value === 'unlinked');
    const notFilmedOpen = viewState.notFilmedOpen;
    fill(table, days.map((d) => {
      const onDay = shown.filter((m) => m.date === d);
      const filmedOnDay = onDay.filter(hasVideo);
      const rest = onDay.filter((m) => !hasVideo(m));
      return h('section', { class: 'match-day', 'aria-label': day(d) },
        h('h2', { class: 'day-title' }, day(d), h('span', { class: 'small muted' }, `${onDay.length} match${onDay.length === 1 ? '' : 'es'} · ${filmedOnDay.length} filmed`)),
        !folding ? view(onDay) : [
          filmedOnDay.length ? view(filmedOnDay) : null,
          rest.length ? h('details', {
            class: 'not-filmed',
            open: findingVideos || notFilmedOpen.has(d),
            ontoggle: (e) => {
              if (findingVideos) return; // opened for the search: not the user's own choice
              if (e.target.open) notFilmedOpen.add(d);
              else notFilmedOpen.delete(d);
            },
          }, h('summary', {}, `Not filmed (${rest.length})`), view(rest)) : null]);
    }));
    if (!shown.length) fill(table, h('div', { class: 'match-empty' },
      emptyState('film', custom && !matches.length ? 'No matches yet: add the first one above.' : 'No matches fit these filters.'),
      matches.length ? h('button', { class: 'small', onclick: clearFilters }, 'Clear filters') : null));
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
  const toolbar = h('div', { class: 'tournament-toolbar' },
    h('div', { class: 'row spread' }, h('h2', {}, 'Matches'), h('div', { class: 'row' }, matchCount, viewButtons)),
    h('div', { class: 'match-filters' }, search, anyMine ? whoSel : null, progressFilter,
      h('label', { class: 'row small' }, hideNoVideo, 'With video only'), clearFilterBtn),
    matches.some((m) => perGame(m) && !hasVideo(m)) ? h('p', { class: 'hint' }, 'A match takes one video for the whole match, or one per game under Game videos.') : null);

  const filmed = matches.flatMap(filmedUnits);
  // The whole tournament's totals, whatever the filters: matches, then videos (a match filmed game by game has one per
  // game). A video total is a button for its Done so far filter; pressed again, it clears it.
  const videosOf = `of ${plural(filmed.length, 'video')}`;
  const overview = h('div', { class: 'tournament-overview', 'aria-label': 'This tournament’s totals' });
  const drawOverview = () => fill(overview,
    h('div', { class: 'tournament-metric' }, h('span', { class: 'metric-label' }, 'Matches'), h('strong', {}, matches.length), h('span', { class: 'small muted' }, `${matches.filter(hasVideo).length} filmed`)),
    [['filmed', 'Videos', 'linked to a match or game'], ['tagged', 'Tagged', videosOf], ['rendered', 'Rendered', videosOf], ['youtube', 'On YouTube', videosOf]].map(([filter, label, detail]) =>
      h('button', {
        type: 'button', class: 'tournament-metric', 'aria-pressed': String(progressFilter.value === filter),
        title: progressFilter.value === filter ? 'Show every match again' : `Show the matches with a video ${DONE[filter][1]}`,
        onclick: () => setProgress(progressFilter.value === filter ? '' : filter),
      }, h('span', { class: 'metric-label' }, label), h('strong', {}, filmed.filter(doneSoFar[filter]).length), h('span', { class: 'small muted' }, detail))));

  const linkAll = suggestions.length ? h('button', {
    class: 'primary',
    onclick: async () => {
      try {
        for (const s of suggestions) await api(suggestionPath(s), { method: 'PUT', body: { videoIds: s.ids } });
        renderTournament(id);
      } catch (err) {
        fill(msg, errorNotice(err));
      }
    },
  }, `Link all ${suggestions.length} suggested`) : null;

  // Every linked video back to unlinked, e.g. to start the linking again.
  const linkedCount = videos.filter((v) => v.matchId).length;
  const unlinkAllBtn = linkedCount ? h('button', {
    title: 'Unlink every video from this tournament’s matches and games',
    onclick: async () => {
      if (!confirm(`Unlink all ${linkedCount} video${linkedCount === 1 ? '' : 's'} from ${tournament.name}’s matches? Each video takes its tagging with it, ready for the match or game you link it to next; render and YouTube status are cleared. The video files aren’t touched.`)) return;
      try {
        const r = await api(`/api/tournaments/${id}/unlink-all`, { method: 'POST' });
        renderTournament(id, h('div', { class: 'notice ok' }, `Unlinked ${r.unlinked} video${r.unlinked === 1 ? '' : 's'}.`));
      } catch (err) {
        fill(msg, errorNotice(err));
      }
    },
  }, icon('link', 16), 'Unlink all') : null;

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
    title: 'Queue a render of every filmed match whose rallies all have a winner, whose score agrees with the result and that isn’t rendered yet; they run one after another',
    onclick: async () => {
      renderAllBtn.disabled = true;
      try {
        const r = await api(`/api/tournaments/${id}/render-all`, { method: 'POST' });
        followQueued(r.jobs, followRender);
        fill(msg, h('div', { class: 'notice ok' }, r.queued ? [`Queued ${r.queued} render${r.queued === 1 ? '' : 's'}: each shows its progress below. `, h('a', { href: '#/jobs' }, 'Jobs page')]
          : 'Nothing to render: no filmed match here has every rally tagged, its score the same as the result and no video yet.'));
      } catch (err) {
        fill(msg, errorNotice(err));
      }
      renderAllBtn.disabled = false;
    },
  }, icon('scissors', 16), 'Render all tagged');

  // Upload every video here without a YouTube link: the rendered whole videos, or the originals of those not
  // rendered. With the privacy and playlist last chosen in a YouTube box; one after another (Jobs page).
  const uploadAllBtn = (kind, label, tip) => {
    const btn = h('button', {
      title: tip,
      onclick: async () => {
        const prefs = readUploadPrefs();
        const what = kind === 'rendered' ? 'every rendered video here that isn’t on YouTube yet' : 'the original of every filmed video here that isn’t rendered or on YouTube yet';
        if (!confirm(`Upload ${what}, as ${prefs.privacy}${prefs.playlist ? ', into the tournament’s playlist' : ''}?`)) return;
        btn.disabled = true;
        try {
          const r = await api(`/api/tournaments/${id}/upload-all`, { method: 'POST', body: { kind, privacy: prefs.privacy, playlist: prefs.playlist } });
          followQueued(r.jobs, followUpload);
          fill(msg, h('div', { class: 'notice ok' }, r.queued ? [`Queued ${r.queued} upload${r.queued === 1 ? '' : 's'}: each shows its progress below. `, h('a', { href: '#/jobs' }, 'Jobs page')]
            : kind === 'rendered' ? 'Nothing to upload: every rendered video here is on YouTube already.' : 'Nothing to upload: every filmed video here is rendered or on YouTube already.'));
        } catch (err) {
          fill(msg, errorNotice(err));
        }
        btn.disabled = false;
      },
    }, icon('youtube', 16), label);
    return btn;
  };
  const uploadRenderedBtn = uploadAllBtn('rendered', 'Upload all rendered', 'Upload the rendered whole video of every match (or game) here that isn’t on YouTube yet (not highlights or clips); they go one after another');
  const uploadOriginalBtn = uploadAllBtn('original', 'Upload all original', 'Upload the original video, as it is, of every filmed match (or game) here that isn’t rendered or on YouTube yet; they go one after another');

  const refreshBtn = h('button', {
    title: tournament.badminfoId
      ? 'Read the draws, match times and results again from badminfo and Badminton England (new tournaments fill in as they are played). Your tagging stays.'
      : 'Read the draws, match times and results again from Badminton England (new tournaments fill in as they are played). Your tagging stays.',
    onclick: async () => {
      refreshBtn.disabled = true;
      fill(msg, h('p', { class: 'muted small' }, tournament.badminfoId ? 'Updating from badminfo and Badminton England…' : 'Updating from Badminton England…'));
      try {
        const r = await api(`/api/tournaments/${id}/refresh`, { method: 'POST' });
        const before = matches.length;
        renderTournament(id, h('div', { class: 'notice ok' }, `Updated: ${r.matches} match${r.matches === 1 ? '' : 'es'}${r.matches > before ? ` (${r.matches - before} new)` : ''}, with the latest times and results.`));
      } catch (err) {
        fill(msg, errorNotice(err));
        refreshBtn.disabled = false;
      }
    },
  }, icon('refresh', 16), 'Update results');

  const unmatched = free.filter((v) => !suggested.has(v.id));
  // Opening the editor from here remembers the place to come back to.
  table.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/m/"]');
    if (!a) return;
    const at = a.closest('[data-anchor]');
    tournamentReturn = { id: String(id), anchor: at?.dataset.anchor ?? null, top: at ? at.getBoundingClientRect().top : 0, ratio: scrollY / Math.max(1, document.documentElement.scrollHeight) };
  }, true);

  // Renders and uploads of this tournament's videos still waiting or running (from the editor, Render all, Upload all or this page) show here too.
  const unitIds = new Set(matches.flatMap((m) => [m.id, ...m.units.map((u) => u.id)]).filter(Boolean));
  api('/api/jobs').then(({ jobs }) => {
    // The latest job of each unit and kind: failed ones (this server run) show beside their button.
    const latest = new Map();
    for (const j of jobs) if (['render', 'upload'].includes(j.kind)) {
      const k = `${j.kind}:${Number(j.key.split(':')[1])}`;
      if (!latest.has(k) || (j.startedAt ?? 0) >= (latest.get(k).startedAt ?? 0)) latest.set(k, j);
    }
    for (const [k, j] of latest) {
      if (j.status !== 'failed' || !unitIds.has(Number(k.split(':')[1]))) continue;
      remember(k, { message: j.error ?? 'Failed', detail: j.detail, retryAt: j.retryAt });
      show(Number(k.split(':')[1]));
    }
    for (const j of jobs) {
      const uid = Number(j.key.split(':')[1]);
      const live = unitIds.has(uid) && (j.status === 'queued' || j.status === 'running');
      if (live && j.kind === 'render' && !renderJobs.has(uid)) followRender(uid, j);
      if (live && j.kind === 'upload' && !uploadJobs.has(uid)) followUpload(uid, j);
    }
  }).catch(() => { /* the page works without it */ });

  fill(main,
    backLinks('#/', 'Tournaments', '', { up: true }), // always to the Tournaments list, not back into an editor
    pageHead(tournament.name,
      [tournament.start === tournament.end ? day(tournament.start) : `${day(tournament.start)} – ${day(tournament.end)}`, ' · ',
        !custom && courts.venues.length && courts.venues.length <= 3 ? [courts.venues.join(' · '), ' · '] : null,
        custom
          ? [h('span', { class: 'pill' }, 'Custom tournament'), tournament.venue ? ` · ${tournament.venue}` : null]
          : h('a', { href: `https://be.tournamentsoftware.com/tournament/${tournament.beId}`, target: '_blank', rel: 'noopener' }, 'Badminton England ↗'),
        tournament.badminfoId ? [' · ', h('a', { href: `https://badminfo.com/Tournament/${tournament.badminfoId}`, target: '_blank', rel: 'noopener' }, 'badminfo ↗')] : null,
        tournament.completedAt ? [' · ', h('span', { class: 'pill ok' }, '✓ Complete')] : null],
      h('button', {
        title: tournament.completedAt ? 'Show it as unfinished again on the Tournaments page' : 'Nothing more to film, render or upload here (some matches had no video): stop highlighting it on the Tournaments page',
        onclick: async () => {
          try {
            await api(`/api/tournaments/${id}/complete`, { method: 'PUT', body: { complete: !tournament.completedAt } });
            renderTournament(id, h('div', { class: 'notice ok' }, tournament.completedAt ? 'Reopened: its card shows what’s left to do again.' : 'Marked complete: its card is no longer highlighted.'));
          } catch (err) {
            fill(msg, errorNotice(err));
          }
        },
      }, icon(tournament.completedAt ? 'refresh' : 'check', 16), tournament.completedAt ? 'Reopen' : 'Mark complete'),
      renderAllBtn,
      uploadRenderedBtn,
      uploadOriginalBtn,
      custom ? null : refreshBtn,
      h('details', { class: 'tournament-menu', onclick: (e) => { if (e.target.closest('button')) e.currentTarget.open = false; }, onkeydown: (e) => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary').focus(); } } },
        h('summary', { class: 'btn' }, 'More actions', h('span', { 'aria-hidden': 'true' }, '⌄')),
        h('div', { class: 'tournament-menu-items' }, reelBtn, unlinkAllBtn, h('button', {
          class: 'danger',
          onclick: async () => {
            if (!confirm(`Forget ${tournament.name}? Its tagging is lost; your video files are not touched.`)) return;
            await api(`/api/tournaments/${id}`, { method: 'DELETE' });
            location.hash = '#/';
          },
        }, icon('trash', 16), 'Remove tournament')))),
    msg,
    notice,
    custom?.el,
    overview,
    suggestions.length ? h('div', { class: 'notice info row spread' },
      h('span', {}, `${suggestions.length === 1 ? 'One video has a suggested match' : `${suggestions.length} videos have suggested matches`}, going by when they were recorded (one video per match, or per game when a match was filmed game by game). Check, then link.`), linkAll) : null,
    !videos.length ? h('div', { class: 'notice warn' }, 'No videos from these dates yet. ', h('a', { href: '#/' }, 'Scan your video folders'), ' after copying them from your phone.') : null,
    unmatched.length ? h('details', { class: 'unlinked-videos stack small' },
      h('summary', {}, icon('film', 15), `${unmatched.length} unlinked video${unmatched.length === 1 ? '' : 's'}`, h('span', { class: 'muted' }, ' · drag onto a match or game')),
      h('p', { class: 'hint' }, 'Drag a video onto its match or game, or use Choose video. You can also drop a scanned video from Explorer.'),
      h('div', { class: 'video-tray' }, unmatched.map(videoChip))) : null,
    anyMine ? null : h('p', { class: 'hint' }, 'Star your players on the ', h('a', { href: '#/players' }, 'Players'), ' page (★) to pick out their matches.'),
    toolbar,
    table);
  drawTable();
  const back = backFromEditor && tournamentReturn?.id === String(id) ? tournamentReturn : null;
  backFromEditor = false;
  if (back) returnTo(back, table);
}

/**
 * Puts the match or game opened in the editor back where it sat in the window (else the same fraction
 * of the page). Thumbnails above it can load afterwards and push it down, so it's put back after each,
 * until the user scrolls or a few seconds pass.
 */
function returnTo(back, table) {
  const place = () => {
    const el = back.anchor && table.querySelector(`[data-anchor="${back.anchor}"]`);
    if (el) window.scrollTo(0, scrollY + el.getBoundingClientRect().top - back.top);
    else window.scrollTo(0, back.ratio * document.documentElement.scrollHeight);
  };
  place();
  let done = false;
  const stop = () => { done = true; };
  for (const name of ['wheel', 'keydown', 'touchstart', 'pointerdown']) window.addEventListener(name, stop, { once: true, passive: true });
  setTimeout(stop, 4000);
  for (const img of table.querySelectorAll('img')) {
    if (!img.complete) img.addEventListener('load', () => { if (!done) place(); }, { once: true });
  }
}

// ---------- Refreshing the video list ----------

/** What a folder scan found, in a sentence. */
function scanText(r) {
  return `Found ${r.found} video${r.found === 1 ? '' : 's'}; ${r.added} new or changed.${r.failed ? ` ${r.failed} couldn't be read.` : ''}${r.removed ? ` ${r.removed} gone from ${r.removed === 1 ? 'its folder was' : 'their folders were'} taken off the list.` : ''}${r.missing ? ` ${r.missing} missing ${r.missing === 1 ? 'one is' : 'ones are'} kept (linked to a match, or the folder can't be reached).` : ''}`;
}

let scanned = null; // the last refresh's outcome, shown once by the page that is drawn after it

/**
 * "Refresh from folders" for the Videos and Tools pages: scans the video
 * folders (progress in `box`), then draws the page again with the outcome
 * in `notice`.
 */
function refreshControls() {
  const box = h('div');
  const notice = scanned ? h('div', { class: 'notice ok' }, icon('check', 16), scanText(scanned)) : null;
  scanned = null;
  const button = h('button', {
    type: 'button',
    title: 'Look in your video folders (set in Settings) for new, changed and deleted videos',
    onclick: async () => {
      button.disabled = true;
      try {
        scanned = await runJob(box, () => api('/api/videos/scan', { method: 'POST' }));
        router();
      } catch (err) {
        fill(box, errorNotice(err));
        button.disabled = false;
      }
    },
  }, icon('refresh', 16), 'Refresh from folders');
  return { button, box, notice };
}

// ---------- Videos ----------

/** " · merged from 3 videos", " · part 2 of 20261101_121214.mp4" for a video made on the Tools page. */
function madeFromText(made) {
  if (made?.kind === 'merge') return ` · merged from ${made.from.length} videos`;
  if (made?.kind === 'split') return ` · part ${made.part} of ${made.from[0]?.name ?? 'a video'}`;
  return '';
}

async function renderVideos() {
  setTab('videos');
  document.title = 'Videos · Badminton Video';
  const { videos } = await api('/api/videos');
  const SOURCE = { apple: 'iPhone clock', filename: 'file name', creation_time: 'video clock', modified: 'file date (guess)' };
  const refresh = refreshControls();
  fill(main,
    pageHead('Videos', 'Every video found in your folders. Files are never moved or changed here.', refresh.button),
    refresh.notice, refresh.box,
    videos.length ? h('div', { class: 'table-scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Recorded', 'File', 'Length', 'Picture', 'Match', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, videos.map((v) => h('tr', {},
        h('td', { class: 'nowrap' }, when(v.recordedAt), h('div', { class: 'small muted' }, SOURCE[v.recordedSource] ?? '')),
        h('td', {}, v.name, v.missing ? [' ', h('span', { class: 'pill bad' }, 'missing')] : null,
          v.madeFrom?.kind === 'merge' ? [' ', h('span', { class: 'pill ok', title: `Merged from ${v.madeFrom.from.map((x) => x.name).join(' + ')}` }, 'merged')] : null,
          h('div', { class: 'small muted' }, megabytes(v.size), madeFromText(v.madeFrom))),
        h('td', { class: 'nowrap' }, clock(v.duration ?? 0)),
        h('td', { class: 'small' }, `${v.width}×${v.height}`, h('div', { class: 'muted' }, `${Math.round(v.fps ?? 0)} fps · ${v.codec ?? '?'}${v.hdr ? ' · HDR' : ''}`)),
        h('td', { class: 'small' }, v.match
          ? [h('a', { href: `#/m/${v.match.id}` }, `${teamName(v.match.teamA)} v ${teamName(v.match.teamB)}`), h('div', { class: 'muted' }, `${v.match.tournament} · ${v.match.draw}`)]
          : h('span', { class: 'muted' }, 'not linked')),
        h('td', {}, h('div', { class: 'row tight' },
          v.match ? h('button', {
            class: 'small',
            onclick: async () => { await api(`/api/videos/${v.id}`, { method: 'PUT', body: { matchId: null } }); renderVideos(); },
          }, 'Unlink') : null,
          v.missing ? null : h('a', { class: 'btn small', href: `#/tools?split=${v.id}`, title: 'Cut this video into parts on the Tools page' }, icon('scissors', 14), 'Split')))))))) : illustratedEmpty('Your video library starts here.', 'Add folders in ', h('a', { href: '#/settings' }, 'Settings'), ' and scan them from the ', h('a', { href: '#/' }, 'Tournaments page'), ' to find your match footage.'));
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
  const rallyGap = h('input', { type: 'number', id: 'rally-gap', min: 0, max: 30, step: 0.5, value: s.rallyGap });
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
  const ticks = Object.fromEntries([['showGames', 'Scores of finished games'], ['nationalFlags', 'Country flags (International broadcast)'], ['flags', 'GAME POINT / MATCH POINT'], ['banners', 'Interval and game banners']].map(([k, label]) =>
    [k, { label, input: h('input', { type: 'checkbox', id: `board-${k}`, checked: b[k] }) }]));
  const readBoard = () => ({
    preset: presetSel.value,
    ...Object.fromEntries(Object.entries(colours).map(([k, c]) => [k, c.input.value])),
    font: fontSel.value, layout: layoutSel.value, opacity: Number(opacity.value), scale: Number(scale.value), corner: cornerSel.value, heading: headingSel.value, longRally: Number(longRally.value) || 0,
    ...Object.fromEntries(Object.entries(ticks).map(([k, c]) => [k, c.input.checked])),
  });
  const preview = h('div', { class: 'preview-frame' });
  // The same board cut out at its real size: one screen pixel per pixel of a 1080p video.
  const actual = h('div', { class: 'board-actual' });
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
    const look = { names, ...moment, style: { ...style, countries: ['DEN', 'ENG'] }, flags, heading, background: data.previewThumb };
    fill(preview, boardPreview({ ...look, logo: readLogo() }));
    fill(actual, boardPreview({ ...look, width: 1920, height: 1080, crop: true }));
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
  // How bright HDR phone videos come out: one frame of the newest HDR video at each choice, to pick by eye.
  let hdrLook = s.output.hdrLook;
  const HDR_CHOICES = [['bright', 'Bright', 'as renders were before 1.49.0'], ['normal', 'Normal', 'recommended'], ['darker', 'Darker', '']];
  const hdrLooks = h('div', { class: 'hdr-looks', role: 'radiogroup', 'aria-label': 'HDR video brightness' }, HDR_CHOICES.map(([key, label, note]) => h('label', { class: 'hdr-look' },
    h('img', { src: `/media/hdr-preview/${key}`, alt: `${label}: a frame of your newest HDR video`, loading: 'lazy', onerror: (e) => { e.target.closest('.hdr-looks')?.classList.add('no-preview'); e.target.remove(); } }),
    h('span', { class: 'row' }, h('input', { type: 'radio', name: 'hdr-look', value: key, checked: key === hdrLook, onchange: () => { hdrLook = key; } }),
      h('strong', {}, label), note ? h('span', { class: 'small muted' }, note) : null))));
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
            body: { videoFolders: lines(folders.value), outputFolder: output.value, ffmpegFolder: ffmpeg.value, pre: Number(pre.value), post: Number(post.value), rallyGap: Number(rallyGap.value),
              nameStyle: { singles: singlesSel.value, doubles: doublesSel.value }, board: readBoard(),
              logo: readLogo(), cards: { title: cardTitle.checked, end: cardEnd.checked, seconds: Number(cardSeconds.value), stats: cardStats.checked },
              description: Object.fromEntries(Object.entries(describe).map(([k, c]) => [k, c.input.checked])),
              output: { size: outSize.value, maxRate: Number(outRate.value) || 0, replays: outReplays.checked, removeVoices: outVoices.checked, hdrLook },
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
          h('div', { class: 'stack' }, preview, h('div', { class: 'row small' }, 'Preview:', sample),
            h('p', { class: 'hint' }, 'Each player’s flag is chosen on the Players page (a match can choose its own in the editor’s Export tab). The example uses Denmark and England.'))),
        h('div', { class: 'stack' },
          h('div', { class: 'subhead' }, 'Actual size'),
          h('p', { class: 'hint' }, 'The scoreboard as big as it is in a 1080p video watched full screen on a 1080p screen: one pixel of the video per pixel here.'),
          actual)),
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
      section('HDR phone videos', 'Phones film in HDR; renders, clips and reels turn it into ordinary video at this brightness. It’s built into the file, so videos made before need rendering again.',
        hdrLooks,
        h('p', { class: 'hint hdr-none' }, 'No HDR video in the library yet: the preview appears once one is found.')),
      section('Music', 'A track under highlights (and reels, or every video), with the court’s own sound turned down.',
        h('div', { class: 'row' }, h('label', { class: 'btn small', for: 'music-file' }, 'Choose music…'), musicInput, musicState, removeMusic),
        h('div', { class: 'row' }, h('label', { for: 'music-use' }, 'Use it for'), musicUse),
        h('div', { class: 'row' }, h('label', { for: 'music-volume' }, 'Music'), musicVolume, h('label', { for: 'court-volume' }, 'Court sound'), courtVolume),
        h('p', { class: 'hint' }, 'Only use music you’re allowed to: YouTube may block or mute videos with copyrighted tracks.'),
        musicMsg),
      section('Cutting', 'How much of the play around each rally to keep when the gaps are cut.',
        h('div', { class: 'row' }, h('label', { for: 'pre' }, 'Keep'), pre, h('label', { for: 'post' }, 'seconds before each rally, and'), post, h('span', {}, 'after.'))),
      section('Tagging', 'Pressing A or B without S first ends a rally whose start wasn’t marked.',
        h('div', { class: 'row' }, h('label', { for: 'rally-gap' }, 'Such a rally starts'), rallyGap, h('span', {}, 'seconds after the previous rally ended.')),
        h('p', { class: 'hint' }, 'The first rally starts at the match start (M), or 10 seconds before A / B. Press S at a serve to mark a start exactly; Q moves a selected rally’s start to now.')),
      h('div', { class: 'label last' }, h('h3', {}, 'FFmpeg'), h('p', {}, 'Optional: its bin folder, if it isn’t found by itself.')),
      h('div', { class: 'fields last' }, h('div', { class: 'row' }, ffmpeg))),
    h('div', { class: 'row', style: { marginTop: '8px' } }, saveBtn),
    msg));
}

// ---------- Router ----------

let lastSection = null;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; // each page opens at its top (below)
async function router() {
  pageShown();
  leaving?.();
  leaving = null;
  main.classList.remove('wide');
  window.scrollTo(0, 0);
  const [path, query] = (location.hash || '#/').split('?');
  const [, section, id] = path.split('/');
  backFromEditor = lastSection === 'm' && section === 't';
  lastSection = section;
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
    else if (section === 'tools') {
      setTab('tools');
      leaving = await renderTools(main, { runJob, refresh: refreshControls(), query: new URLSearchParams(query ?? '') });
    }
    else if (section === 'settings') await renderSettings();
    else await renderHome();
  } catch (err) {
    fill(main, h('h1', {}, 'Something went wrong'), errorNotice(err), h('p', {}, h('a', { href: '#/' }, 'Back to tournaments')));
  }
}

window.addEventListener('hashchange', router);
router();
