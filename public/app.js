// The page: a hash router and the views. The match editor is in editor.js.
//   #/            tournaments, import, scan
//   #/t/<id>      a tournament's matches and their videos
//   #/m/<id>      the match editor
//   #/players     my players' badminfo ratings (players-page.js)
//   #/p/<id>      one player, by badminfo id
//   #/videos      every video found
//   #/settings    folders, players, cutting

import { h, fill, when, day, megabytes, ukDate, gamesView } from './dom.js';
import { api, waitJob } from './api.js';
import { boardNames, isMine, NAME_STYLES, teamName } from './shared/names.js';
import { gamesText } from './shared/score.js';
import { clock } from './shared/time.js';
import { renderEditor } from './editor.js';
import { icon } from './icons.js';
import { errorNotice } from './notice.js';
import { boardFlags, boardHeading, CORNERS, FONTS, HEADINGS, PRESETS } from './shared/board.js';
import { boardPreview } from './board-preview.js';
import { renderPlayer, renderPlayers } from './players-page.js';
import { percents } from './shared/players.js';

const main = document.getElementById('app');
let leaving = null; // cleanup for the current view (the editor's key handler, timers)

function setTab(name) {
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// Icons in the header's section links.
for (const [tab, name] of [['home', 'trophy'], ['players', 'user'], ['videos', 'film'], ['settings', 'settings']]) {
  document.querySelector(`.tabs a[data-tab="${tab}"]`)?.prepend(icon(name, 17));
}

/** A page heading: title, a line under it, and buttons on the right. */
const pageHead = (title, sub, ...actions) => h('div', { class: 'page-head' },
  h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null),
  actions.length ? h('div', { class: 'row' }, actions) : null);

const emptyState = (name, ...text) => h('div', { class: 'empty' }, icon(name, 34), h('div', {}, text));

function progressBar(job) {
  return h('div', { class: 'stack' },
    h('div', { class: 'progress' }, h('span', { style: { width: `${Math.round((job?.progress ?? 0) * 100)}%` } })),
    h('div', { class: 'small muted' }, job?.message || 'Working…'));
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
  const [{ settings }, { tournaments }] = await Promise.all([api('/api/settings'), api('/api/tournaments')]);
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

  const setup = !settings.videoFolders.length || !settings.players.length;
  const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, label));
  fill(main,
    pageHead('Tournaments', 'Link phone videos to Badminton England matches, tag rallies, and make edited videos.'),
    setup ? h('div', { class: 'card' },
      h('h3', { class: 'card-title' }, icon('check'), 'Getting started'),
      h('ol', { class: 'steps' },
        h('li', {}, h('span', {}, h('a', { href: '#/settings' }, 'Settings'), ': add the folders where your phone videos are, and your players’ names.')),
        h('li', {}, h('span', {}, 'Import a tournament with its badminfo or Badminton England link.')),
        h('li', {}, h('span', {}, 'Scan the video folders: each video is matched to a match by when it was recorded.')),
        h('li', {}, h('span', {}, 'Open a match to tag rallies, then render it with the score and without the gaps.')))) : null,
    h('div', { class: 'home-grid' },
      h('div', { class: 'card stack' },
        h('h3', { class: 'card-title' }, icon('import'), 'Import a tournament'),
        form,
        h('p', { class: 'hint' }, 'Re-importing the same tournament updates times, courts and results, and keeps your tagging.'),
        importMsg),
      h('div', { class: 'card stack' },
        h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, icon('film'), 'Phone videos'), scanBtn),
        h('p', { class: 'hint' }, settings.videoFolders.length ? settings.videoFolders.join(' · ') : ['No video folders yet. ', h('a', { href: '#/settings' }, 'Add them in Settings.')]),
        scanBox)),
    h('div', { class: 'section-title' }, icon('trophy', 15), `Imported tournaments (${tournaments.length})`),
    tournaments.length
      ? h('div', { class: 'tournament-list' }, tournaments.map((t) => h('a', { class: 'card', href: `#/t/${t.id}` },
        h('h3', {}, t.name),
        h('div', { class: 'muted small' }, t.start === t.end || !t.end ? day(t.start) : `${day(t.start)} – ${day(t.end)}`),
        h('div', { class: 'stats' }, stat(t.matches, 'matches'), stat(t.filmed, 'filmed'), stat(t.rendered, 'rendered'), stat(t.uploaded, 'YouTube')))))
      : emptyState('trophy', 'No tournaments yet. Paste a badminfo or Badminton England link above.'));
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

async function renderTournament(id, notice = null) {
  setTab('home');
  const data = await api(`/api/tournaments/${id}`);
  const { tournament, matches, videos, suggestions } = data;
  document.title = `${tournament.name} · Badminton Video`;
  const byId = new Map(videos.map((v) => [v.id, v]));
  const suggestionFor = new Map(suggestions.map((s) => [s.matchId, s]));
  const suggested = new Set(suggestions.flatMap((s) => s.ids));
  const free = videos.filter((v) => !v.matchId);
  const anyMine = matches.some((m) => m.mine);
  const prefs = { view: 'list', onlyMine: true, hideNoVideo: false, ...readPrefs() };
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
    h('div', { class: isMine(m.teamA, data.players) ? 'team-mine' : '' }, named(m, 0)),
    h('div', { class: 'muted small' }, 'v'),
    h('div', { class: isMine(m.teamB, data.players) ? 'team-mine' : '' }, named(m, 1)),
  ];

  const listView = (list) => h('div', { class: 'table-scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Time', 'Court', 'Event', 'Match', 'Result', 'Video', 'Status'].map((x) => h('th', {}, x)))),
    list.map((m) => h('tbody', { class: `match-group${m.mine ? ' mine' : ''}` },
      h('tr', { class: m.mine ? 'mine' : '' },
        h('td', { class: 'nowrap' }, m.time, m.duration ? h('div', { class: 'small muted' }, `${m.duration} min`) : null),
        h('td', { class: 'small' }, m.court),
        h('td', { class: 'small' }, m.draw, h('div', { class: 'muted' }, m.round)),
        h('td', {}, teams(m)),
        h('td', { class: 'nowrap' }, m.games?.length ? gamesView(m.games) : h('span', { class: 'muted' }, '—')),
        h('td', {}, videoCell(m)),
        h('td', {}, statusCell(m))),
      // Game by game, unless one video covers the whole match.
      perGame(m) && !m.videoIds.length ? unitsOf(m).map((u) => h('tr', { class: `game-row${m.mine ? ' mine' : ''}` },
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
    return h('div', { class: `match-card${m.mine ? ' mine' : ''}` },
      filmed
        ? thumbOf(m, lengthOf(m))
        : games && gamesLinked(m) ? null
          : h('div', { class: 'thumb empty' }, suggestionFor.has(m.id) ? 'Video suggested' : 'No video'),
      h('div', { class: 'match-body stack' },
        h('div', { class: 'small muted' }, [m.time, m.court, `${m.draw}${m.round ? ` · ${m.round}` : ''}`].filter(Boolean).join(' · ')),
        h('div', { class: 'teams' }, teams(m)),
        h('div', { class: 'small' }, 'Result ', m.games?.length ? h('span', {}, gamesView(m.games)) : '—', m.duration ? h('span', { class: 'muted' }, ` · ${m.duration} min`) : null),
        statusCell(m),
        filmed ? h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/m/${m.id}` }, 'Open'), youtubeLink(m),
          h('button', { class: 'small', onclick: () => link(m, []) }, 'Unlink'))
          : gamesLinked(m) ? null : videoCell(m),
        games ? h('div', { class: 'game-tiles' }, unitsOf(m).map((u) => h('div', { class: 'game-tile' },
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
    const shown = matches.filter((m) => (!anyMine || !prefs.onlyMine || m.mine || hasVideo(m)) && (!prefs.hideNoVideo || hasVideo(m)));
    const days = [...new Set(shown.map((m) => m.date))];
    const view = prefs.view === 'grid' ? gridView : listView;
    fill(table, days.map((d) => [h('div', { class: 'day-title' }, day(d)), view(shown.filter((m) => m.date === d))]));
    if (!shown.length) fill(table, emptyState('film', prefs.hideNoVideo ? 'No matches with a video yet.' : 'No matches to show.'));
  };

  const setPref = (k, v) => {
    prefs[k] = v;
    writePrefs(prefs);
    drawViewButtons();
    drawTable();
  };
  const viewButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' });
  const drawViewButtons = () => fill(viewButtons, [['list', 'List'], ['grid', 'Grid']].map(([v, label]) =>
    h('button', { class: 'small', 'aria-pressed': String(prefs.view === v), onclick: () => setPref('view', v) }, icon(v, 15), label)));
  drawViewButtons();
  const toolbar = h('div', { class: 'row spread toolbar' },
    h('div', { class: 'row' },
      anyMine ? h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: prefs.onlyMine, onchange: (e) => setPref('onlyMine', e.target.checked) }), 'Only my players’ matches') : null,
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: prefs.hideNoVideo, onchange: (e) => setPref('hideNoVideo', e.target.checked) }), 'Hide matches without a video')),
    viewButtons);

  const linkAll = suggestions.length ? h('button', {
    class: 'primary',
    onclick: async () => {
      for (const s of suggestions) await api(`/api/matches/${s.matchId}/videos`, { method: 'PUT', body: { videoIds: s.ids } });
      renderTournament(id);
    },
  }, `Link all ${suggestions.length} suggested`) : null;

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
        h('a', { href: `https://be.tournamentsoftware.com/tournament/${tournament.beId}`, target: '_blank', rel: 'noopener' }, 'Badminton England ↗'),
        tournament.badminfoId ? [' · ', h('a', { href: `https://badminfo.com/Tournament/${tournament.badminfoId}`, target: '_blank', rel: 'noopener' }, 'badminfo ↗')] : null],
      refreshBtn,
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
    suggestions.length ? h('div', { class: 'notice info row spread' },
      h('span', {}, `${suggestions.length === 1 ? 'One match below has a suggested video' : `${suggestions.length} matches below have suggested videos`}, going by when the videos were recorded. Check, then link.`), linkAll) : null,
    !videos.length ? h('div', { class: 'notice warn' }, 'No videos from these dates yet. ', h('a', { href: '#/' }, 'Scan your video folders'), ' after copying them from your phone.') : null,
    unmatched.length ? h('p', { class: 'small muted' }, `${unmatched.length} video${unmatched.length === 1 ? '' : 's'} from these dates aren’t linked or suggested; choose them in the Video column.`) : null,
    anyMine ? null : h('p', { class: 'hint' }, 'Add your players’ names in Settings to pick out their matches.'),
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
        }, 'Unlink') : null)))))) : emptyState('film', 'No videos yet. Add folders in ', h('a', { href: '#/settings' }, 'Settings'), ' and scan them from the Tournaments page.'));
}

// ---------- Settings ----------

async function renderSettings() {
  setTab('settings');
  document.title = 'Settings · Badminton Video';
  const data = await api('/api/settings');
  const s = data.settings;
  const lines = (v) => v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const folders = h('textarea', { id: 'folders', placeholder: 'C:\\Users\\you\\Pictures\\Phone\\Badminton' }, s.videoFolders.join('\n'));
  const players = h('textarea', { id: 'players', placeholder: 'Amy Lee\nBen Ng' }, s.players.join('\n'));
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
  const opacity = h('input', { type: 'range', id: 'board-opacity', min: 30, max: 100, step: 5, value: b.opacity });
  const scale = h('input', { type: 'range', id: 'board-scale', min: 60, max: 160, step: 5, value: b.scale });
  const cornerSel = select('board-corner', CORNERS, b.corner);
  const headingSel = select('board-heading', HEADINGS, b.heading);
  const ticks = Object.fromEntries([['showGames', 'Scores of finished games'], ['flags', 'GAME POINT / MATCH POINT'], ['banners', 'Interval and game banners']].map(([k, label]) =>
    [k, { label, input: h('input', { type: 'checkbox', id: `board-${k}`, checked: b[k] }) }]));
  const readBoard = () => ({
    preset: presetSel.value,
    ...Object.fromEntries(Object.entries(colours).map(([k, c]) => [k, c.input.value])),
    font: fontSel.value, opacity: Number(opacity.value), scale: Number(scale.value), corner: cornerSel.value, heading: headingSel.value,
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
      opacity.value = p.opacity;
    }
    showBoard();
  });
  // Changing a colour, the font or the opacity makes the look your own.
  for (const el of [...Object.values(colours).map((c) => c.input), fontSel, opacity]) {
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
  const cardTitle = h('input', { type: 'checkbox', id: 'card-title', checked: s.cards.title });
  const cardEnd = h('input', { type: 'checkbox', id: 'card-end', checked: s.cards.end });
  const cardSeconds = h('input', { type: 'number', id: 'card-seconds', min: 2, max: 8, step: 1, value: s.cards.seconds });

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
            body: { videoFolders: lines(folders.value), players: lines(players.value), outputFolder: output.value, ffmpegFolder: ffmpeg.value, pre: Number(pre.value), post: Number(post.value),
              nameStyle: { singles: singlesSel.value, doubles: doublesSel.value }, board: readBoard(),
              logo: readLogo(), cards: { title: cardTitle.checked, end: cardEnd.checked, seconds: Number(cardSeconds.value) },
              description: Object.fromEntries(Object.entries(describe).map(([k, c]) => [k, c.input.checked])) },
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
      section('My players', 'Their matches are picked out on tournament pages.',
        players, h('p', { class: 'hint' }, 'One name per line, as in the draws. A first name alone works when it’s unambiguous (“Man” matches “Man Chan”).')),
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
            h('div', { class: 'row colour-row' }, Object.entries(colours).map(([k, c]) => h('label', { for: `board-${k}`, class: 'colour' }, c.input, c.label))),
            h('div', { class: 'row' }, h('label', { for: 'board-opacity' }, 'Opacity'), opacity, h('label', { for: 'board-scale' }, 'Size'), scale),
            h('div', { class: 'row' }, h('label', { for: 'board-corner' }, 'Corner'), cornerSel),
            h('div', { class: 'row' }, h('label', { for: 'board-heading' }, 'Heading'), headingSel),
            h('div', { class: 'stack small' }, Object.entries(ticks).map(([k, c]) => h('label', { class: 'row', for: `board-${k}` }, c.input, c.label)))),
          h('div', { class: 'stack' }, preview, h('div', { class: 'row small' }, 'Preview:', sample)))),
      section('Logo', 'A club or channel logo in a corner of every rendered video. A PNG with a see-through background looks best.',
        h('div', { class: 'row' }, h('label', { class: 'btn small', for: 'logo-file' }, 'Choose picture…'), logoInput, logoState, removeLogo),
        h('div', { class: 'row' }, h('label', { for: 'logo-corner' }, 'Corner'), logoCorner, h('label', { for: 'logo-size' }, 'Size'), logoSize, h('label', { for: 'logo-opacity' }, 'Opacity'), logoOpacity),
        h('p', { class: 'hint' }, 'Shown in the scoreboard preview above. Pick a corner the scoreboard isn’t in.'),
        logoMsg),
      section('Title and end cards', 'A few seconds before the first rally with the players and the event, and after the last with the result. Each render can switch them on or off.',
        h('div', { class: 'row' }, h('label', { class: 'row', for: 'card-title' }, cardTitle, 'Title card'), h('label', { class: 'row', for: 'card-end' }, cardEnd, 'End card'),
          h('label', { for: 'card-seconds' }, 'for'), cardSeconds, h('span', {}, 'seconds each'))),
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
  const [, section, id] = (location.hash || '#/').split('/');
  try {
    if (section === 't' && id) await renderTournament(id);
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
    } else if (section === 'videos') await renderVideos();
    else if (section === 'settings') await renderSettings();
    else await renderHome();
  } catch (err) {
    fill(main, h('h1', {}, 'Something went wrong'), errorNotice(err), h('p', {}, h('a', { href: '#/' }, 'Back to tournaments')));
  }
}

window.addEventListener('hashchange', router);
router();
