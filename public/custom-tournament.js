// The top of a custom tournament's page: its details (name, dates, venue,
// scoring), which listed players are in it, and the form to add or change a
// match. Each match row also gets Edit and Delete (`actions`). Everything else
// on the page (video links, tagging, rendering) works as for imported ones.

import { h, fill } from './dom.js';
import { api } from './api.js';
import { icon } from './icons.js';

/** Scoring choices: key -> format. */
const FORMATS = [
  ['21x3', 'Best of 3 games to 21 (up to 30)', { points: 21, setting: true, bestOf: 3 }],
  ['15x3', 'Best of 3 games to 15 (up to 21)', { points: 15, setting: true, bestOf: 3 }],
  ['11x3', 'Best of 3 games to 11 (up to 15)', { points: 11, setting: true, bestOf: 3 }],
  ['21x1', 'One game to 21 (up to 30)', { points: 21, setting: true, bestOf: 1 }],
  ['15x1', 'One game to 15 (up to 21)', { points: 15, setting: true, bestOf: 1 }],
  ['11x1', 'One game to 11 (up to 15)', { points: 11, setting: true, bestOf: 1 }],
];
const formatKey = (f) => (f ? `${f.points}x${f.bestOf === 1 ? 1 : 3}` : '');
const formatOf = (key) => FORMATS.find(([k]) => k === key)?.[2] ?? null;
const formatSelect = (current, guessLabel) => h('select', { 'aria-label': 'Scoring' },
  h('option', { value: '' }, guessLabel), FORMATS.map(([k, label]) => h('option', { value: k, selected: k === formatKey(current) }, label)));

const folds = new Map(); // tournament id -> { details, players }: open or closed, for this session

const field = (label, control, hint = null) => h('label', { class: 'cf-field' }, h('span', { class: 'cf-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);

/**
 * The custom tournament's panel. `rerender(notice)` draws the page again after a change.
 * Returns { el, actions(match) }.
 */
export function customTournamentPanel({ id, data, rerender, errorNotice }) {
  const { tournament, roster, matches } = data;
  const msg = h('div');
  const fail = (err) => fill(msg, errorNotice(err));

  // ---- details ----
  const name = h('input', { type: 'text', value: tournament.name, maxlength: 120, required: true });
  const start = h('input', { type: 'date', value: tournament.start ?? '' });
  const end = h('input', { type: 'date', value: tournament.end ?? '' });
  const venue = h('input', { type: 'text', value: tournament.venue ?? '', maxlength: 120, placeholder: 'Sports hall, club…' });
  const scoring = formatSelect(tournament.format, 'Guess from each result');
  // The folds stay as the user left them when the page is drawn again after a change.
  const fold = (key, first) => ({ open: folds.get(id)?.[key] ?? first, ontoggle: (e) => folds.set(id, { ...folds.get(id), [key]: e.target.open }) });
  const details = h('details', { class: 'card stack fold-card', ...fold('details', !matches.length) },
    h('summary', { title: 'Click to show or hide' }, h('h4', {}, icon('trophy', 17), 'Tournament details')),
    h('form', {
      class: 'form-grid',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api(`/api/tournaments/${id}`, { method: 'PUT', body: { name: name.value, start: start.value, end: end.value, venue: venue.value, format: formatOf(scoring.value) } });
          rerender(h('div', { class: 'notice ok' }, 'Tournament details saved.'));
        } catch (err) {
          fail(err);
        }
      },
    },
    field('Name', name), field('First day', start), field('Last day', end, 'The same as the first for one day'), field('Venue', venue),
    field('Scoring', scoring, 'New matches get it; changing it also changes matches that had the old one'),
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Save details'))));

  // ---- players from the Players list ----
  const playersBox = h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Loading the Players list…'));
  let picked = new Set(roster.map((r) => r.key));
  const playersTitle = h('span', {}, `Players (${roster.length})`);
  // Saved in place: the count and the names the match form suggests change, the page isn't drawn again.
  const saveRoster = async () => {
    try {
      const r = await api(`/api/tournaments/${id}/players`, { method: 'PUT', body: { keys: [...picked] } });
      picked = new Set(r.roster.map((p) => p.key));
      fill(playersTitle, `Players (${r.roster.length})`);
      fill(names, r.roster.map((p) => h('option', { value: p.name })));
      fill(msg);
    } catch (err) {
      fail(err);
    }
  };
  const loadPlayers = () => api('/api/favourites?all=1').then((r) => drawPlayers([...r.favourites].sort((a, b) => Number(b.starred) - Number(a.starred) || a.name.localeCompare(b.name))), fail);
  const newName = h('input', { type: 'text', placeholder: 'New player’s name', maxlength: 80, 'aria-label': 'New player’s name' });
  const addNew = async (e) => {
    e.preventDefault();
    if (!newName.value.trim()) return;
    try {
      const { key } = await api('/api/favourites', { method: 'POST', body: { name: newName.value, starred: false } });
      picked.add(key);
      await saveRoster();
      newName.value = '';
      await loadPlayers();
    } catch (err) {
      fail(err);
    }
  };
  const drawPlayers = (all) => fill(playersBox,
    all.length
      ? h('div', { class: 'roster-list' }, all.map((p) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: picked.has(p.key), onchange: (e) => { if (e.target.checked) picked.add(p.key); else picked.delete(p.key); saveRoster(); } }),
        h('span', {}, p.starred ? '★ ' : '', p.name))))
      : h('p', { class: 'hint' }, 'No one on the Players list yet.'),
    h('form', { class: 'row', onsubmit: addNew }, newName, h('button', { class: 'small', type: 'submit' }, '+ Add to the list and here')),
    h('p', { class: 'hint' }, 'Players ticked here are suggested when you add a match. Manage everyone on the ', h('a', { href: '#/players' }, 'Players'), ' page.'));
  loadPlayers();
  const players = h('details', { class: 'card stack fold-card', ...fold('players', !roster.length) },
    h('summary', { title: 'Click to show or hide' }, h('h4', {}, icon('user', 17), playersTitle)),
    playersBox);

  // ---- add or change a match ----
  const names = h('datalist', { id: `roster-names-${id}` }, roster.map((r) => h('option', { value: r.name })));
  const draws = h('datalist', { id: `draws-${id}` }, [...new Set(matches.map((m) => m.draw).filter(Boolean))].map((d) => h('option', { value: d })));
  const person = (label) => h('input', { type: 'text', list: names.id, placeholder: label, maxlength: 80, 'aria-label': label });
  const f = {
    date: h('input', { type: 'date', value: tournament.start ?? '' }),
    time: h('input', { type: 'time', value: '' }),
    draw: h('input', { type: 'text', list: draws.id, placeholder: 'e.g. Men’s doubles', maxlength: 80 }),
    round: h('input', { type: 'text', placeholder: 'e.g. Final (or left empty: Match n)', maxlength: 80 }),
    court: h('input', { type: 'text', placeholder: 'e.g. Court 3', maxlength: 80 }),
    a1: person('Side A player'), a2: person('Partner (doubles)'),
    b1: person('Side B player'), b2: person('Partner (doubles)'),
    games: h('input', { type: 'text', placeholder: '21-15 18-21 21-19', maxlength: 60 }),
    format: formatSelect(tournament.format, 'Tournament’s scoring'),
  };
  let editing = null; // the match being changed, or null to add one
  const formTitle = h('h4', {});
  const submitBtn = h('button', { class: 'primary', type: 'submit' });
  const cancelBtn = h('button', { type: 'button', onclick: () => edit(null) }, 'Cancel');
  const matchForm = h('form', {
    class: 'form-grid',
    onsubmit: async (e) => {
      e.preventDefault();
      const body = {
        date: f.date.value, time: f.time.value, draw: f.draw.value, round: f.round.value, court: f.court.value,
        teamA: [f.a1.value, f.a2.value], teamB: [f.b1.value, f.b2.value], games: f.games.value,
        ...(f.format.value || editing ? { format: formatOf(f.format.value) } : {}),
      };
      try {
        if (editing) await api(`/api/tournaments/${id}/matches/${editing.id}`, { method: 'PUT', body });
        else await api(`/api/tournaments/${id}/matches`, { method: 'POST', body });
        rerender(h('div', { class: 'notice ok' }, editing ? 'Match saved.' : 'Match added. Link its video below like any other match.'));
      } catch (err) {
        fail(err);
      }
    },
  },
  field('Date', f.date), field('Time on court', f.time, 'Used to suggest the video recorded then'), field('Event', f.draw), field('Round', f.round), field('Court', f.court),
  h('div', { class: 'cf-field side' }, h('span', { class: 'cf-label' }, 'Side A'), f.a1, f.a2),
  h('div', { class: 'cf-field side' }, h('span', { class: 'cf-label' }, 'Side B'), f.b1, f.b2),
  field('Result', f.games, 'Side A’s points first; leave empty if not played yet'), field('Scoring', f.format),
  h('div', { class: 'row' }, submitBtn, cancelBtn));
  const formCard = h('div', { class: 'card stack custom-match-form' }, formTitle, matchForm, names, draws);

  /** Fills the form to change `m`, or empties it to add a match. */
  function edit(m) {
    editing = m;
    fill(formTitle, icon(m ? 'edit' : 'plus', 17), m ? `Change the match: ${m.teamA.join(' / ')} v ${m.teamB.join(' / ')}` : 'Add a match');
    fill(submitBtn, m ? 'Save the match' : '+ Add the match');
    cancelBtn.hidden = !m;
    f.date.value = m?.date ?? f.date.value ?? tournament.start ?? '';
    f.time.value = m ? (m.time === '00:00' ? '' : m.time) : '';
    for (const k of ['draw', 'round', 'court']) f[k].value = m?.[k] ?? (k === 'draw' ? f.draw.value : '');
    [f.a1.value, f.a2.value] = [m?.teamA[0] ?? '', m?.teamA[1] ?? ''];
    [f.b1.value, f.b2.value] = [m?.teamB[0] ?? '', m?.teamB[1] ?? ''];
    f.games.value = m?.games?.length ? m.games.map((g) => g.join('-')).join(' ') : '';
    f.format.value = m ? formatKey(m.format) : '';
    if (m) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  edit(null);

  const actions = (m) => h('span', { class: 'row match-actions' },
    h('button', { class: 'small ghost', title: 'Change this match', onclick: () => edit(m) }, icon('edit', 14), 'Edit'),
    h('button', {
      class: 'small ghost', title: 'Delete this match',
      onclick: async () => {
        const lost = [m.rallyCount ? `${m.rallyCount} tagged rallies` : '', m.videoIds?.length ? 'its video link (the file stays)' : '', m.outputPath ? 'the record of its render' : ''].filter(Boolean);
        if (!confirm(`Delete ${m.teamA.join(' / ')} v ${m.teamB.join(' / ')}?${lost.length ? `\n\nThis also loses ${lost.join(', ')}.` : ''}`)) return;
        try {
          await api(`/api/tournaments/${id}/matches/${m.id}`, { method: 'DELETE' });
          rerender(h('div', { class: 'notice ok' }, 'Match deleted.'));
        } catch (err) {
          fail(err);
        }
      },
    }, icon('trash', 14), 'Delete'));

  return { el: h('div', { class: 'custom-panel' }, msg, details, players, formCard), actions };
}
