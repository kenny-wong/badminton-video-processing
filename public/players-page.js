// The Players pages: #/players lists my players (Settings) with their badminfo
// ratings and grades; #/p/<badminfo id> is one player's page, with their
// rating over time and every match of theirs in imported tournaments.

import { h, fill, day, gamesView } from './dom.js';
import { api, waitJob } from './api.js';
import { icon } from './icons.js';
import { errorNotice } from './notice.js';
import { teamName } from './shared/names.js';
import { lineChart } from './chart.js';

const DISCIPLINES = [['singles', 'Singles'], ['doubles', 'Doubles'], ['mixed', 'Mixed']];

const pageHead = (title, sub, ...actions) => h('div', { class: 'page-head' },
  h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null),
  actions.length ? h('div', { class: 'row' }, actions) : null);

/** Rating and grade for each discipline the player has. */
export function standings(player) {
  const tiles = DISCIPLINES.filter(([k]) => player?.ratings?.[k] || player?.grades?.[k]).map(([k, label]) => h('div', { class: `stat s-${k}` },
    h('b', {}, player.ratings[k] ?? '—', player.grades[k] ? h('span', { class: 'grade' }, player.grades[k]) : null), h('span', {}, label)));
  return tiles.length ? h('div', { class: 'stats standings' }, tiles) : h('p', { class: 'hint' }, 'No ratings on badminfo yet.');
}

const recordText = (r) => (r.played ? `${r.won} won, ${r.lost} lost` : 'no results yet');

export async function renderPlayers(main) {
  document.title = 'Players · Badminton Video';
  const data = await api('/api/players');
  const msg = h('div');
  const refreshBtn = h('button', {
    onclick: async () => {
      refreshBtn.disabled = true;
      fill(msg, h('p', { class: 'muted small' }, 'Reading badminfo…'));
      try {
        const r = await api('/api/players/refresh', { method: 'POST' });
        await renderPlayers(main);
        main.querySelector('.players-msg')?.replaceChildren(h('div', { class: 'notice ok' }, `Read ${r.tournaments} tournament${r.tournaments === 1 ? '' : 's'} and ${r.profiles} profile${r.profiles === 1 ? '' : 's'} from badminfo.`));
      } catch (err) {
        fill(msg, errorNotice(err));
        refreshBtn.disabled = false;
      }
    },
  }, icon('refresh', 16), 'Update from badminfo');

  const linkBox = (p) => {
    const input = h('input', { type: 'url', placeholder: 'https://badminfo.com/Player/…', 'aria-label': `badminfo link for ${p.name}` });
    const out = h('div');
    const save = async (link) => {
      try {
        await api('/api/players/link', { method: 'PUT', body: { name: p.name, link } });
        renderPlayers(main);
      } catch (err) {
        fill(out, errorNotice(err));
      }
    };
    return h('div', { class: 'stack small' },
      h('div', { class: 'row' }, input, h('button', { class: 'small', onclick: () => save(input.value.trim()) }, 'Link')),
      p.linked ? h('button', { class: 'small', onclick: () => save('') }, 'Use the name instead') : null,
      out);
  };

  const card = (p) => h('div', { class: 'card stack player-card' },
    h('div', { class: 'row spread' },
      h('h3', { class: 'card-title' }, icon('user'), p.id ? h('a', { href: `#/p/${p.id}` }, p.player?.name ?? p.name) : p.name),
      p.player?.county ? h('span', { class: 'pill' }, p.player.county) : null),
    p.id
      ? [standings(p.player),
        h('div', { class: 'small muted' }, `${p.matches} match${p.matches === 1 ? '' : 'es'} in imported tournaments (${recordText(p.record)}), ${p.filmed} filmed`),
        h('div', { class: 'row small' }, h('a', { class: 'btn small primary', href: `#/p/${p.id}` }, 'Open'),
          h('a', { href: `https://badminfo.com/Player/${p.id}`, target: '_blank', rel: 'noopener' }, 'badminfo ↗'),
          p.linked ? h('span', { class: 'muted' }, 'linked by hand') : null),
        p.linked ? linkBox(p) : null]
      : [h('p', { class: 'hint' }, p.candidates
        ? `${p.candidates} players in imported tournaments match “${p.name}”. Paste the right one’s badminfo link:`
        : `Not found in any imported badminfo tournament. Paste their badminfo link:`), linkBox(p)]);

  fill(main,
    pageHead('Players', 'Your players’ badminfo ratings and grades, and their matches.', refreshBtn),
    h('div', { class: 'players-msg' }, msg),
    data.badminfoTournaments ? null : h('div', { class: 'notice info' }, 'Player data comes from badminfo: import tournaments with their badminfo link (or re-import one) to see ratings here.'),
    data.mine.length
      ? h('div', { class: 'player-grid' }, data.mine.map(card))
      : h('div', { class: 'empty' }, icon('user', 34), h('div', {}, 'No players yet. Add your players’ names in ', h('a', { href: '#/settings' }, 'Settings'), '.')));
}

/** One match in a player's list: date, event, the other side, result from the player's side. */
function matchRow(m) {
  const theirs = m.side === 'b' ? m.teamA : m.teamB;
  const games = m.side === 'b' ? m.games.map(([x, y]) => [y, x]) : m.games;
  return h('tr', {},
    h('td', { class: 'nowrap' }, day(m.date), h('div', { class: 'small muted' }, m.time)),
    h('td', { class: 'small' }, h('a', { href: `#/t/${m.tournamentId}` }, m.tournament), h('div', { class: 'muted' }, [m.draw, m.round].filter(Boolean).join(' · '))),
    h('td', {}, m.partners.length ? h('div', { class: 'small muted' }, `with ${m.partners.join(' / ')}`) : null, h('div', {}, 'v ', teamName(theirs))),
    h('td', { class: 'nowrap' }, m.won === true ? h('span', { class: 'pill ok' }, 'Won') : m.won === false ? h('span', { class: 'pill bad' }, 'Lost') : null, ' ', gamesView(games)),
    h('td', {}, m.filmed ? h('a', { class: 'btn small primary', href: `#/m/${m.id}` }, 'Open') : h('span', { class: 'small muted' }, 'not filmed'),
      m.youtubeUrl ? [' ', h('a', { class: 'pill ok', href: m.youtubeUrl, target: '_blank', rel: 'noopener' }, 'YouTube ↗')] : null));
}

export async function renderPlayer(main, id) {
  const data = await api(`/api/players/${id}`);
  const p = data.player;
  document.title = `${p.name} · Badminton Video`;
  const chartBox = h('div', { class: 'card stack' });
  const drawChart = (d) => {
    const chart = lineChart(DISCIPLINES.filter(([k]) => d.series[k]?.length).map(([key, label]) => ({ key, label, points: d.series[key].map((x) => ({ date: x.date, value: x.rating })) })));
    fill(chartBox, h('h3', { class: 'card-title' }, icon('wave'), 'badminfo rating'),
      chart ? [h('div', { class: 'legend' }, DISCIPLINES.filter(([k]) => d.series[k]?.length).map(([k, label]) => h('span', {}, h('i', { class: `s-${k}` }), label))), chart]
        : h('p', { class: 'hint' }, d.player.fetchedAt ? 'No rated matches on badminfo yet.' : 'Reading their matches from badminfo…'));
  };
  drawChart(data);
  const filmed = data.matches.filter((m) => m.filmed);
  const reelBox = h('div');
  const reelBtn = h('button', {
    title: 'All their filmed matches’ ★ rallies in one video',
    onclick: async () => {
      reelBtn.disabled = true;
      try {
        const job = await api('/api/reels', { method: 'POST', body: { playerId: id } });
        const r = await waitJob(job, (j) => fill(reelBox, h('div', { class: 'notice info' }, j.status === 'queued' ? 'Waiting for the graphics card…' : `${j.message || 'Working…'} ${Math.round(j.progress * 100)}%`)));
        fill(reelBox, h('div', { class: 'notice ok row' }, `Highlight reel done: ${r.matches} matches.`,
          h('button', { class: 'small', onclick: () => api('/api/reveal', { method: 'POST', body: { path: r.path } }) }, 'Show in folder')));
      } catch (err) {
        fill(reelBox, errorNotice(err));
      }
      reelBtn.disabled = false;
    },
  }, icon('star', 16), 'Highlight reel');
  fill(main,
    h('a', { class: 'crumb', href: '#/players' }, icon('back', 15), 'Players'),
    pageHead(p.name, [p.county, p.beNumber ? `BE ${p.beNumber}` : null].filter(Boolean).join(' · ') || null,
      reelBtn,
      h('a', { class: 'btn', href: p.url, target: '_blank', rel: 'noopener' }, 'badminfo ↗')),
    reelBox,
    standings(p),
    h('div', { class: 'stats summary' },
      h('div', { class: 'stat' }, h('b', {}, data.matches.length), h('span', {}, 'imported matches')),
      h('div', { class: 'stat' }, h('b', {}, `${data.record.won}–${data.record.lost}`), h('span', {}, 'won–lost')),
      h('div', { class: 'stat' }, h('b', {}, filmed.length), h('span', {}, 'filmed')),
      h('div', { class: 'stat' }, h('b', {}, `${data.filmedRecord.won}–${data.filmedRecord.lost}`), h('span', {}, 'filmed won–lost'))),
    chartBox,
    h('div', { class: 'section-title' }, icon('film', 15), 'Matches in imported tournaments'),
    data.matches.length
      ? h('div', { class: 'table-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Event', 'Opponents', 'Result', 'Video'].map((x) => h('th', {}, x)))), h('tbody', {}, data.matches.map(matchRow))))
      : h('div', { class: 'empty' }, 'No matches in imported tournaments.'));
  // Their profile (rating history, win chances) is read from badminfo now and then; the page shows what's there meanwhile.
  try {
    const fresh = await api(`/api/players/${id}?refresh=1`);
    if (location.hash === `#/p/${id}`) drawChart(fresh);
  } catch { /* badminfo unreachable: keep what was shown */ }
}
