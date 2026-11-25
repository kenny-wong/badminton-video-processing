// Correcting a match's result when Badminton England has it wrong: the points of each game, with
// what Badminton England says and what the tagging made beside them.

import { h, fill } from './dom.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { teamName } from './shared/names.js';
import { gamesText } from './shared/score.js';

const same = (x, y) => Boolean(x && y && x[0] === y[0] && x[1] === y[1]);

/** "Badminton England says 8-15 16-14 15-9", for a corrected match. */
export const correctedTitle = (m) => `Corrected by you; Badminton England says ${m.beGames?.length ? gamesText(m.beGames) : 'nothing'}`;

/**
 * Opens the box for `match` (id, teams, games, beGames: null when not corrected).
 * `tagged`: the games as tagged, by game number from 0 (gaps for those not tagged).
 * `onSaved` runs after a change is saved.
 */
export function openScoreDialog(match, { tagged = [], onSaved, errorNotice }) {
  const theirs = match.beGames ?? match.games;
  const msg = h('div');
  const rows = Array.from({ length: Math.max(3, match.games.length, theirs.length) }, (_, i) => {
    const input = (k) => h('input', {
      type: 'number', min: 0, max: 99, inputmode: 'numeric', class: 'score-points', value: match.games[i]?.[k] ?? '',
      'aria-label': `Game ${i + 1}, ${teamName(k ? match.teamB : match.teamA)}`,
    });
    const pair = [input(0), input(1)];
    const tag = tagged[i];
    return { pair, el: h('tr', {},
      h('th', { scope: 'row' }, `Game ${i + 1}`),
      h('td', {}, pair[0]), h('td', {}, pair[1]),
      h('td', { class: 'muted nowrap' }, theirs[i] ? theirs[i].join('-') : '—'),
      h('td', { class: 'nowrap' }, !tag ? null : same(tag, theirs[i]) ? h('span', { class: 'muted' }, tag.join('-'))
        : h('button', { class: 'small', type: 'button', title: 'Use the score your tagging made', onclick: () => { pair[0].value = tag[0]; pair[1].value = tag[1]; } }, `Use ${tag.join('-')}`))) };
  });
  const read = () => {
    const games = rows.map((r) => r.pair.map((x) => x.value.trim()));
    while (games.length && games.at(-1).every((x) => !x)) games.pop();
    return games.map((g) => g.map((x) => (/^\d{1,2}$/.test(x) ? Number(x) : null)));
  };
  const send = async (games) => {
    try {
      await api(`/api/matches/${match.id}/score`, { method: 'PUT', body: { games } });
      dialog.close();
      onSaved?.();
    } catch (err) {
      fill(msg, errorNotice(err));
    }
  };
  const close = () => dialog.close();
  const dialog = h('dialog', { class: 'keys-dialog score-dialog', 'aria-label': 'Correct the score' },
    h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); send(read()); } },
      h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, icon('edit'), 'Correct the score'), h('button', { class: 'small', type: 'button', onclick: close }, 'Cancel')),
      h('p', { class: 'hint' }, 'For a result that’s wrong on Badminton England. The app uses your score from then on (titles, cards, the score check, earlier games on the scoreboard), also after Update results. Videos already rendered or uploaded keep the old one until you render them again.'),
      h('div', { class: 'table-scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, teamName(match.teamA)), h('th', {}, teamName(match.teamB)), h('th', {}, 'Badminton England'), h('th', {}, 'Your tagging'))),
        h('tbody', {}, rows.map((r) => r.el)))),
      msg,
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Save score'),
        match.beGames ? h('button', { type: 'button', onclick: () => send(null) }, `Use Badminton England’s (${gamesText(match.beGames)})`) : null)));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
}
