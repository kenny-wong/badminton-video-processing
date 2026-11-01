// The Players pages: #/players lists the favourite players (★) with their
// badminfo ratings and grades, and finds anyone in imported badminfo
// tournaments to star; #/p/<badminfo id> is one player's page, with their
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

/** ★ button: stars or unstars a player (by badminfo id), then calls `done`. */
export function starButton({ id, key }, done, onError = () => {}) {
  const on = Boolean(key);
  return h('button', {
    class: `fav-star${on ? ' on' : ''}`, 'aria-pressed': String(on), title: on ? 'Favourite: click to unstar' : 'Star as a favourite player',
    onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        await (on ? api(`/api/favourites/${key}`, { method: 'DELETE' }) : api('/api/favourites', { method: 'POST', body: { id } }));
        await done();
      } catch (err) {
        onError(err);
      }
    },
  }, on ? '★' : '☆');
}

export async function renderPlayers(main) {
  document.title = 'Players · Badminton Video';
  const data = await api('/api/players');
  const msg = h('div');
  const again = () => renderPlayers(main);
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

  // A name-only favourite: paste their badminfo link to tie it to them.
  const linkBox = (f) => {
    const input = h('input', { type: 'url', placeholder: 'https://badminfo.com/Player/…', 'aria-label': `badminfo link for ${f.name}` });
    const out = h('div');
    return h('div', { class: 'stack small' },
      h('div', { class: 'row' }, input, h('button', {
        class: 'small',
        onclick: async () => {
          try {
            await api(`/api/favourites/${f.key}`, { method: 'PUT', body: { link: input.value.trim() } });
            again();
          } catch (err) {
            fill(out, errorNotice(err));
          }
        },
      }, 'Link')),
      out);
  };

  const card = (f) => h('div', { class: 'card stack player-card' },
    h('div', { class: 'row spread' },
      h('h3', { class: 'card-title' }, starButton(f, again, (err) => fill(msg, errorNotice(err))), f.id ? h('a', { href: `#/p/${f.id}` }, f.player?.name ?? f.name) : f.name),
      f.player?.county ? h('span', { class: 'pill' }, f.player.county) : null),
    f.id
      ? [standings(f.player),
        h('div', { class: 'small muted' }, `${f.tournaments} tournament${f.tournaments === 1 ? '' : 's'}, ${f.matches} match${f.matches === 1 ? '' : 'es'} (${recordText(f.record)}), ${f.filmed} filmed`),
        h('div', { class: 'row small' }, h('a', { class: 'btn small primary', href: `#/p/${f.id}` }, 'Open'),
          h('a', { href: `https://badminfo.com/Player/${f.id}`, target: '_blank', rel: 'noopener' }, 'badminfo ↗'))]
      : [h('div', { class: 'small muted' }, `Picked out by name: ${f.tournaments} tournament${f.tournaments === 1 ? '' : 's'}, ${f.matches} match${f.matches === 1 ? '' : 'es'}.`),
        h('p', { class: 'hint' }, f.candidates
          ? `${f.candidates} players in imported tournaments match “${f.name}”. Paste the right one’s badminfo link:`
          : 'Not found in any imported badminfo tournament. Paste their badminfo link:'), linkBox(f)]);

  // ---- find anyone in the imported badminfo tournaments, and star them ----
  const query = h('input', { type: 'search', class: 'grow', placeholder: 'Find a player by name', 'aria-label': 'Find a player' });
  const results = h('div');
  let timer = null;
  const runSearch = async () => {
    const q = query.value.trim();
    if (!q) return fill(results);
    try {
      const r = await api(`/api/players/search?q=${encodeURIComponent(q)}`);
      const byName = h('button', {
        class: 'small',
        onclick: async () => {
          try {
            await api('/api/favourites', { method: 'POST', body: { name: q } });
            again();
          } catch (err) {
            fill(results, errorNotice(err));
          }
        },
      }, '☆ Star the name “', q, '”');
      fill(results,
        r.players.length
          ? h('div', { class: 'table-scroll' }, h('table', {}, h('tbody', {}, r.players.map((p) => h('tr', {},
            h('td', {}, starButton({ id: p.id, key: p.favourite }, async () => { await runSearch(); await refreshCards(); }, (err) => fill(results, errorNotice(err)))),
            h('td', {}, h('a', { href: `#/p/${p.id}` }, p.name), p.county ? h('div', { class: 'small muted' }, p.county) : null),
            h('td', { class: 'small' }, DISCIPLINES.filter(([k]) => p.ratings[k] || p.grades[k]).map(([k, label]) => h('span', { class: 'rating-chip', title: label }, `${label[0]} ${p.ratings[k] ?? '—'}${p.grades[k] ? ` ${p.grades[k]}` : ''}`))),
            h('td', { class: 'small muted nowrap' }, `${p.tournaments} tournament${p.tournaments === 1 ? '' : 's'}`))))))
          : h('p', { class: 'hint' }, 'No one by that name in the imported badminfo tournaments.'),
        h('div', { class: 'row small' }, h('span', { class: 'muted' }, 'Not in a badminfo draw (a Badminton England-only import)?'), byName));
    } catch (err) {
      fill(results, errorNotice(err));
    }
  };
  query.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 250); });

  const cards = h('div');
  const drawCards = (d) => fill(cards,
    h('div', { class: 'section-title' }, icon('star', 15), `Favourites (${d.favourites.length})`),
    d.favourites.length
      ? h('div', { class: 'player-grid' }, d.favourites.map(card))
      : h('div', { class: 'empty' }, icon('user', 34), h('div', {}, 'No favourites yet. Find your players below and star them (☆).')));
  // After a star from the search, only the cards are drawn again (the search box keeps its text).
  const refreshCards = async () => drawCards(await api('/api/players'));
  drawCards(data);

  fill(main,
    pageHead('Players', 'Star (★) the players you film: their matches are picked out on tournament pages and get the video suggestions.', refreshBtn),
    h('div', { class: 'players-msg' }, msg),
    data.badminfoTournaments ? null : h('div', { class: 'notice info' }, 'Player data comes from badminfo: import tournaments with their badminfo link (or re-import one) to find players here.'),
    cards,
    h('div', { class: 'section-title' }, icon('user', 15), 'Find a player'),
    h('div', { class: 'card stack' }, h('div', { class: 'row' }, query),
      h('p', { class: 'hint' }, `${data.known} player${data.known === 1 ? '' : 's'} from imported badminfo tournaments.`), results));
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
  }, icon('highlights', 16), 'Highlight reel');
  fill(main,
    h('a', { class: 'crumb', href: '#/players' }, icon('back', 15), 'Players'),
    pageHead(h('span', { class: 'row' }, starButton({ id, key: data.favourite }, () => renderPlayer(main, id), (err) => fill(reelBox, errorNotice(err))), p.name),
      [p.county, p.beNumber ? `BE ${p.beNumber}` : null].filter(Boolean).join(' · ') || null,
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
