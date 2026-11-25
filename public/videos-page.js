// The Videos tab: every tournament with its videos (#/videos), and one
// tournament's videos (#/videos/<id>): its folder, scanning it, and the match
// each video shows.

import { h, fill, when, day, megabytes } from './dom.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { backLinks } from './nav.js';
import { clock } from './shared/time.js';
import { teamName } from './shared/names.js';
import { illustratedEmpty } from './visuals.js';
import { doubtNotice } from './link-doubts.js';

const SOURCE = { apple: 'iPhone clock', filename: 'file name', creation_time: 'video clock', modified: 'file date (guess)' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dates = (t) => (!t.start ? '' : !t.end || t.start === t.end ? day(t.start) : `${day(t.start)} – ${day(t.end)}`);

/** " · merged from 3 videos", " · part 2 of 20261101_121214.mp4" for a video made on the Tools page. */
function madeFromText(made) {
  if (made?.kind === 'merge') return ` · merged from ${made.from.length} videos`;
  if (made?.kind === 'split') return ` · part ${made.part} of ${made.from[0]?.name ?? 'a video'}`;
  return '';
}

const missingPill = () => h('span', { class: 'pill bad', title: 'The file isn’t there: it was moved or deleted, or its drive isn’t connected' }, 'missing');

/** The video table; `matchCell(v)` and `actions(v)` fill the last columns. */
function videoTable(videos, { matchCell, actions }) {
  return h('div', { class: 'table-scroll' }, h('table', { class: 'video-table' },
    h('thead', {}, h('tr', {}, ['Recorded', 'File', 'Length', 'Match', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, videos.map((v) => h('tr', {},
      h('td', { class: 'nowrap' }, when(v.recordedAt), h('div', { class: 'small muted' }, SOURCE[v.recordedSource] ?? '')),
      h('td', { class: 'file-cell', title: v.path }, v.name, v.missing ? [' ', missingPill()] : null,
        v.madeFrom?.kind === 'merge' ? [' ', h('span', { class: 'pill ok', title: `Merged from ${v.madeFrom.from.map((x) => x.name).join(' + ')}` }, 'merged')] : null,
        h('div', { class: 'small muted' }, `${megabytes(v.size)} · ${v.width}×${v.height} · ${Math.round(v.fps ?? 0)} fps${v.hdr ? ' · HDR' : ''}`, madeFromText(v.madeFrom))),
      h('td', { class: 'nowrap' }, clock(v.duration ?? 0)),
      h('td', { class: 'small' }, matchCell(v)),
      h('td', {}, h('div', { class: 'row tight' }, actions(v),
        v.missing ? null : h('a', { class: 'btn small', href: `#/tools?split=${v.id}`, title: 'Cut this video into parts on the Tools page' }, icon('scissors', 14), 'Split'))))))));
}

const namesOf = (m) => `${teamName(m.teamA)} v ${teamName(m.teamB)}`;
const eventOf = (m) => [m.time, m.draw, m.round, m.game ? `Game ${m.game}` : ''].filter(Boolean).join(' · ');

// ---------- every tournament ----------

export async function renderVideos(main, { pageHead, refresh, errorNotice }) {
  document.title = 'Videos · Badminton Video';
  const { videos, tournaments } = await api('/api/videos');
  const of = new Map();
  for (const v of videos) if (v.tournamentId) of.set(v.tournamentId, [...(of.get(v.tournamentId) ?? []), v]);
  const loose = videos.filter((v) => !v.tournamentId);
  const rowOf = (t) => {
    const list = of.get(t.id) ?? [];
    const missing = list.filter((v) => v.missing).length;
    const free = list.filter((v) => !v.matchId && !v.missing).length;
    return h('li', {}, h('a', { class: 'video-tournament', href: `#/videos/${t.id}`, title: t.folder ?? 'Choose its video folder' },
      h('span', { class: 'vt-day' }, dates(t)),
      h('span', { class: 'vt-name' }, t.name),
      h('span', { class: `vt-folder${t.folder ? '' : ' muted'}` }, icon('folder', 15), h('span', {}, t.folder ?? 'No folder chosen')),
      h('span', { class: 'vt-count' }, list.length ? plural(list.length, 'video') : '—'),
      h('span', { class: 'vt-state' },
        missing ? h('span', { class: 'pill bad', title: 'Moved, deleted, or on a drive that isn’t connected' }, missing === list.length && t.folder ? 'not connected' : `${missing} missing`) : null,
        free ? h('span', { class: 'pill warn' }, `${free} not linked`) : list.length && !missing ? h('span', { class: 'pill ok' }, 'all linked') : null)));
  };
  const used = tournaments.filter((t) => t.folder || of.has(t.id));
  const rest = tournaments.filter((t) => !t.folder && !of.has(t.id));
  const usedBox = h('div');
  const restBox = h('div');
  const find = h('input', { type: 'search', class: 'video-find', placeholder: 'Find a tournament by name', 'aria-label': 'Find a tournament by name', oninput: () => draw() });
  function draw() {
    const words = find.value.toLowerCase().split(/\s+/).filter(Boolean);
    const named = (t) => words.every((w) => t.name.toLowerCase().includes(w));
    const a = used.filter(named);
    const b = rest.filter(named);
    fill(usedBox, a.length ? h('ul', { class: 'video-tournaments' }, a.map(rowOf)) : h('p', { class: 'hint' }, words.length ? 'None with videos by that name.' : 'No tournament has videos yet. Open one below and choose its folder.'));
    fill(restBox, b.length ? h('details', { class: 'video-rest', open: Boolean(words.length) || !used.length },
      h('summary', {}, `Tournaments without videos (${b.length})`),
      h('ul', { class: 'video-tournaments' }, b.map(rowOf))) : null);
  }
  draw();
  fill(main,
    pageHead('Videos', 'By tournament. Open one to choose the folder its videos are in, scan it and link them. Files are never moved or changed here.', refresh.button),
    refresh.notice, refresh.box,
    tournaments.length ? [h('div', { class: 'row spread video-head' }, h('div', { class: 'section-title' }, icon('trophy', 15), `Tournaments with videos (${used.length})`), find), usedBox, restBox]
      : illustratedEmpty('Your video library starts here.', 'Import a tournament on the ', h('a', { href: '#/' }, 'Tournaments page'), ', then choose its video folder here.'),
    loose.length ? [
      h('div', { class: 'section-title' }, icon('film', 15), `Not in a tournament (${loose.length})`),
      videoTable(loose, {
        matchCell: () => h('span', { class: 'muted' }, 'not linked'),
        actions: () => null,
      }),
    ] : null);
}

// ---------- one tournament ----------

let lastScan = null; // { id, result }: shown once by the page drawn after it

export async function renderTournamentVideos(main, id, ctx) {
  const { pageHead, runJob, errorNotice } = ctx;
  const data = await api(`/api/tournaments/${id}/videos`);
  const { tournament, folder, videos, players } = data;
  document.title = `Videos · ${tournament.name} · Badminton Video`;
  const redraw = () => renderTournamentVideos(main, id, ctx);
  const msg = h('div');
  const jobBox = h('div');
  const attempt = async (work) => {
    try {
      await work();
    } catch (err) {
      fill(msg, errorNotice(err));
    }
  };

  // ---- scanning ----
  const scanBtn = h('button', {
    class: 'primary', type: 'button', disabled: !folder.path,
    title: 'Look in the folder (on any drive) for new videos, and link each one that surely shows a match or game without a video',
    onclick: () => scan(),
  }, icon('scan', 16), 'Scan and link');
  async function scan() {
    scanBtn.disabled = true;
    fill(msg);
    try {
      lastScan = { id, result: await runJob(jobBox, () => api(`/api/tournaments/${id}/videos/scan`, { method: 'POST' })) };
      if (location.hash === `#/videos/${id}`) redraw();
    } catch (err) {
      fill(jobBox, errorNotice(err));
      scanBtn.disabled = false;
    }
  }

  // ---- the folder ----
  const choose = (path) => attempt(async () => {
    await api(`/api/tournaments/${id}/videos`, { method: 'PUT', body: { folder: path } });
    if (path) await scan();
    else redraw();
  });
  const pick = async (start) => {
    const { path } = await api('/api/pick-folder', { method: 'POST', body: { start } });
    if (path) await choose(path);
  };
  const typed = h('input', { type: 'text', class: 'grow', value: folder.path ?? '', placeholder: 'I:\\Badminton Video\\20261101 Silver', 'aria-label': 'The folder’s path', spellcheck: 'false' });
  const found = h('div');
  const state = !folder.path ? h('span', { class: 'pill warn' }, 'No folder chosen')
    : folder.connected ? h('span', { class: 'pill ok' }, 'Connected')
      : h('span', { class: 'pill bad' }, 'Not connected');
  const folderCard = h('div', { class: 'card stack' },
    h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, icon('folder'), 'Video folder'), state),
    folder.path ? h('div', { class: 'folder-path' }, folder.path) : h('p', { class: 'hint' }, 'Choose the folder this tournament’s videos are in (subfolders count). It’s remembered, and scanned straight away.'),
    folder.path && !folder.connected ? h('div', { class: 'notice warn' }, 'The folder isn’t on any connected drive. Connect the drive it’s on (any letter will do): links and tagging are kept meanwhile.') : null,
    h('div', { class: 'row' },
      h('button', { class: folder.path ? null : 'primary', type: 'button', onclick: () => attempt(() => pick(folder.path)) }, icon('folder', 16), folder.path ? 'Change folder…' : 'Choose folder…'),
      folder.path ? scanBtn : null,
      folder.path ? h('button', {
        type: 'button', title: 'Forget the folder; its videos and links stay',
        onclick: () => choose(''),
      }, 'Remove folder') : null,
      tournament.videosScannedAt ? h('span', { class: 'small muted' }, `Last scanned ${when(tournament.videosScannedAt)}`) : null),
    h('details', { class: 'small type-path' }, h('summary', {}, 'Type or paste the path'),
      h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); choose(typed.value); } }, typed, h('button', { type: 'submit' }, 'Use it'))),
    found,
    jobBox);

  // No folder yet: look for one by the tournament's date and name on every drive.
  const look = async () => {
    fill(found, h('p', { class: 'hint' }, 'Looking on your drives for a folder with this tournament’s date and name…'));
    try {
      const r = await api(`/api/tournaments/${id}/videos/find`, { method: 'POST' });
      fill(found, r.folders.length ? h('div', { class: 'stack' },
        h('div', { class: 'small muted' }, r.folders.length === 1 ? 'This folder looks right:' : 'These folders look right:'),
        r.folders.map((f) => h('div', { class: 'row notice info' }, h('span', { class: 'folder-path grow' }, f.path), h('button', { class: 'primary small', type: 'button', onclick: () => choose(f.path) }, 'Use this folder'))))
        : h('p', { class: 'hint' }, 'No folder on the connected drives has this tournament’s date and name.'));
    } catch (err) {
      fill(found, errorNotice(err));
    }
  };
  if (!folder.path) look();

  // ---- whose matches ----
  const auto = players.find((p) => p.key === data.whose);
  const whose = players.length > 1 ? h('select', {
    'aria-label': 'Whose matches were filmed',
    onchange: () => attempt(async () => {
      await api(`/api/tournaments/${id}/videos`, { method: 'PUT', body: { player: whose.value || null } });
      redraw();
    }),
  },
  h('option', { value: '' }, `Work it out${!tournament.videoPlayer ? ` (${auto ? auto.name : data.askWhose ? 'not clear' : 'any starred player'})` : ''}`),
  h('option', { value: 'all' }, 'Any starred player’s matches'),
  players.map((p) => h('option', { value: String(p.key) }, `${p.name}’s matches`))) : null;
  if (whose) whose.value = tournament.videoPlayer === 'all' || players.some((p) => String(p.key) === tournament.videoPlayer) ? tournament.videoPlayer : '';

  // ---- what the last scan did ----
  const scanned = lastScan?.id === id ? lastScan.result : null;
  lastScan = null;
  const outcome = scanned ? scanNotice(scanned, {
    undo: () => attempt(async () => {
      await api('/api/videos/unlink', { method: 'POST', body: { ids: scanned.linked.map((l) => l.videoId) } });
      redraw();
    }),
    matchOf: (videoId) => videos.find((v) => v.id === videoId)?.match,
  }) : null;

  // ---- the videos ----
  const linkOne = (v) => attempt(async () => {
    const s = v.suggestion;
    await api(s.game ? `/api/matches/${s.parentId}/games/${s.game}/videos` : `/api/matches/${s.parentId}/videos`, { method: 'PUT', body: { videoIds: [v.id] } });
    redraw();
  });
  const unlink = (v) => {
    if (!confirm(`Unlink ${v.name}? Its tagging goes with it to the match or game you link it to next; render and YouTube status there are cleared.`)) return;
    attempt(async () => {
      await api(`/api/videos/${v.id}`, { method: 'PUT', body: { matchId: null } });
      redraw();
    });
  };
  const linked = videos.filter((v) => v.match).length;
  const missing = videos.filter((v) => v.missing).length;
  fill(main,
    backLinks('#/videos', 'Videos', '', { up: true }),
    pageHead(tournament.name, dates(tournament), h('a', { class: 'btn', href: `#/t/${id}` }, icon('court', 16), 'Matches')),
    msg, outcome, folderCard,
    doubtNotice(id, data.doubts),
    data.askWhose && whose ? h('div', { class: 'notice warn' }, `${players.map((p) => p.name).join(', ')} all played here, and the videos don’t show clearly whose matches were filmed. Choose under “Filmed”, then Scan and link.`) : null,
    h('div', { class: 'row spread video-head' },
      h('div', { class: 'section-title' }, icon('film', 15), `${plural(videos.length, 'video')} · ${linked} linked${videos.length - linked ? ` · ${videos.length - linked} not linked` : ''}${missing ? ` · ${missing} missing` : ''}`),
      whose ? h('label', { class: 'row small' }, 'Filmed:', whose) : null),
    videos.length ? videoTable(videos, {
      matchCell: (v) => {
        if (v.match) return [h('a', { href: `#/m/${v.match.id}` }, namesOf(v.match)), h('div', { class: 'muted' }, eventOf(v.match))];
        if (v.suggestion) {
          const late = v.suggestion.lateMin;
          return [h('span', { class: 'pill warn', title: late === null ? 'Filmed right beside another game of this match' : `Filmed ${Math.abs(late)} min ${late < 0 ? 'before' : 'after'} its time${v.suggestion.sure ? '' : '; not sure enough to link by itself'}` }, 'Suggested'), ' ', namesOf(v.suggestion), h('div', { class: 'muted' }, eventOf(v.suggestion))];
        }
        return [h('span', { class: 'muted' }, v.short ? 'not linked (too short to be a game)' : 'not linked'),
          v.noAuto ? h('div', { class: 'muted' }, 'unlinked by hand: scans leave it') : null];
      },
      actions: (v) => [
        v.match ? h('button', { class: 'small', type: 'button', onclick: () => unlink(v) }, 'Unlink') : null,
        v.suggestion ? h('button', { class: 'small primary', type: 'button', onclick: () => linkOne(v) }, 'Link') : null,
        !v.match && !v.suggestion && !v.missing ? h('a', { class: 'btn small', href: `#/t/${id}`, title: 'Choose its match or game on the tournament’s page' }, 'Choose match') : null,
      ],
    }) : h('p', { class: 'hint' }, folder.path ? 'No videos found yet. Scan the folder.' : 'No videos yet. Choose the folder they’re in.'));
}

/** What a scan found and linked, with the links listed so they can be checked, and undone. */
function scanNotice(r, { undo, matchOf }) {
  const parts = [`Found ${plural(r.found, 'video')} in ${r.folder}.`];
  if (r.movedFrom) parts.push(`The folder was ${r.movedFrom} before.`);
  if (r.moved) parts.push(`${r.moved} already known ${r.moved === 1 ? 'one was' : 'ones were'} taken from their old place, with their links and tagging.`);
  if (r.added) parts.push(`${r.added} new or changed.`);
  if (r.copies) parts.push(`${r.copies} ${r.copies === 1 ? 'is a copy' : 'are copies'} of videos in another folder.`);
  if (r.failed) parts.push(`${r.failed} couldn’t be read.`);
  if (r.unsure) parts.push(`${r.unsure} ${r.unsure === 1 ? 'has' : 'have'} a suggestion to check below.`);
  return h('div', { class: 'stack' },
    h('div', { class: 'notice ok' }, icon('check', 16), parts.join(' ')),
    r.linked.length ? h('div', { class: 'card stack' },
      h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, icon('link'), `Linked ${plural(r.linked.length, 'video')}`),
        h('button', { type: 'button', class: 'small', title: 'Unlink these again; later scans leave them unlinked', onclick: undo }, 'Undo these links')),
      h('ul', { class: 'scan-linked small' }, r.linked.map((l) => {
        const m = matchOf(l.videoId);
        return h('li', {}, h('span', { class: 'muted' }, l.name), ' → ', m ? h('a', { href: `#/m/${m.id}` }, `${namesOf(m)} · ${eventOf(m)}`) : null,
          l.tagging?.moved ? h('span', { class: 'muted' }, ` (with its ${l.tagging.rallies} tagged rallies)`) : null);
      }))) : h('p', { class: 'hint' }, 'No new links were made.'));
}
