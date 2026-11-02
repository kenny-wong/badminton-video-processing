// The Players pages: #/players adds players (by name or badminfo link) and lists them, favourites (★) and others, with their
// badminfo ratings and grades, and finds anyone in imported badminfo
// tournaments to star; #/p/<badminfo id> is one player's page, with their
// rating over time and every match of theirs in imported tournaments.

import { h, fill, day, gamesView, openButtons } from './dom.js';
import { api, waitJob } from './api.js';
import { icon } from './icons.js';
import { errorNotice } from './notice.js';
import { teamName } from './shared/names.js';
import { lineChart } from './chart.js';
import { matchStar } from './match-star.js';
import { matchPasses } from './shared/players.js';

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

/**
 * ★ button: stars or unstars a player, then calls `done`. `key` is set for a
 * favourite, `listed` for anyone on the Players list (unstarring keeps them
 * there); otherwise the badminfo `id` is added to the list, starred.
 */
export function starButton({ id, key, listed = key }, done, onError = () => {}) {
  const on = Boolean(key);
  return h('button', {
    class: `fav-star${on ? ' on' : ''}`, 'aria-pressed': String(on), title: on ? 'Favourite: click to unstar (they stay on the list)' : 'Star as a favourite player',
    onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        if (on || listed) await api(`/api/favourites/${listed}`, { method: 'PUT', body: { starred: !on } });
        else await api('/api/favourites', { method: 'POST', body: { id } });
        await done();
      } catch (err) {
        onError(err);
      }
    },
  }, on ? '★' : '☆');
}

const BADMINFO_PLAYER = /badminfo\.com\/player\/|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What an import of a player's tournaments did, for the page. */
function importOutcome(r, update) {
  const plural = (n, word) => `${n} ${n === 1 ? word : word.endsWith('ch') ? `${word}es` : `${word}s`}`;
  return h('div', { class: 'notice ok stack' },
    h('div', { class: 'notice-msg' }, update
      ? `${r.player}: updated ${plural(r.imported.length, 'tournament')}`
      : r.imported.length ? `${r.player}: imported ${plural(r.imported.length, 'new tournament')}` : `${r.player}: no new tournaments`),
    r.imported.length ? h('ul', { class: 'small import-list' }, r.imported.map((t) => h('li', {}, h('a', { href: `#/t/${t.id}` }, t.name), h('span', { class: 'muted' }, ` · ${t.start ?? ''} · ${plural(t.matches, 'match')}${t.matches ? '' : ' (draws not out yet: use Update results later)'}`)))) : null,
    r.complete ? h('div', { class: 'small muted' }, `${plural(r.complete, 'tournament')} finished and already up to date (every result in, or read again since they ended): not fetched again.`) : null,
    r.already ? h('div', { class: 'small muted' }, update ? `${plural(r.already, 'tournament')} not imported yet, left alone.` : `${plural(r.already, 'tournament')} already in the app, skipped.`) : null,
    r.skipped.length ? h('details', { class: 'small' }, h('summary', {}, `${plural(r.skipped.length, 'tournament')} couldn’t be read`),
      h('ul', {}, r.skipped.map((s) => h('li', {}, `${s.name}: ${s.reason}`)))) : null);
}

/**
 * Button that imports a badminfo player's tournaments not in the app yet, or with
 * `update` reads the imported ones again for new times and results. Progress and
 * the outcome go in `box`; `done()` runs after.
 */
function importButton(id, update, box, done, small) {
  const btn = h('button', {
    class: small ? 'small' : '',
    title: update
      ? 'Read their tournaments in the app again from badminfo and Badminton England for new draws, times and results; finished ones with every result in are left alone'
      : 'Import every tournament they have entered on badminfo (upcoming too) that isn’t in the app yet. Ones already imported are skipped.',
    onclick: async () => {
      btn.disabled = true;
      try {
        const job = await api(`/api/players/${id}/tournaments`, { method: 'POST', body: { update } });
        const r = await waitJob(job, (j) => fill(box, h('div', { class: 'notice info' },
          j.status === 'queued' ? 'Waiting for the import before it…' : `${j.message || 'Reading badminfo…'} (${Math.round(j.progress * 100)}%)`)));
        await done();
        fill(box, importOutcome(r, update));
      } catch (err) {
        fill(box, errorNotice(err));
      }
      btn.disabled = false;
    },
  }, icon(update ? 'refresh' : 'import', small ? 14 : 16), update ? 'Update their results' : small ? 'Import tournaments' : 'Import their tournaments');
  return btn;
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

  const removeBtn = (f) => h('button', {
    class: 'small ghost', title: 'Take them off the Players list (and out of custom tournaments’ players). Their matches stay.',
    onclick: async () => {
      if (!confirm(`Take ${f.name} off the Players list?`)) return;
      try {
        await api(`/api/favourites/${f.key}`, { method: 'DELETE' });
        await refreshCards();
      } catch (err) {
        fill(msg, errorNotice(err));
      }
    },
  }, icon('trash', 14), 'Remove');

  const card = (f, grip = null) => h('div', { class: `card stack player-card${f.starred ? '' : ' unstarred'}`, 'data-key': f.key },
    h('div', { class: 'row spread' },
      h('h3', { class: 'card-title' }, grip, starButton({ id: f.id, key: f.starred ? f.key : null, listed: f.key }, refreshCards, (err) => fill(msg, errorNotice(err))),
        f.id ? h('a', { href: `#/p/${f.id}` }, f.player?.name ?? f.name) : f.name),
      h('span', { class: 'row' }, f.player?.county ? h('span', { class: 'pill' }, f.player.county) : null, removeBtn(f))),
    f.id
      ? [standings(f.player),
        h('div', { class: 'small muted' }, `${f.tournaments} tournament${f.tournaments === 1 ? '' : 's'}, ${f.matches} match${f.matches === 1 ? '' : 'es'} (${recordText(f.record)}), ${f.filmed} filmed`),
        h('div', { class: 'row small' }, h('a', { class: 'btn small primary', href: `#/p/${f.id}` }, 'Open'),
          // The outcome goes above the cards, which are drawn again after the import.
          importButton(f.id, false, msg, refreshCards, true),
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
    const changed = async () => { await runSearch(); await refreshCards(); };
    // Onto the Players list without a star (under Other players).
    const addButton = (p) => (p.listed
      ? h('span', { class: 'small muted nowrap' }, p.favourite ? 'Favourite' : 'On your list')
      : h('button', {
        class: 'small', title: 'Add them to your Players list, under Other players, without a star',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api('/api/favourites', { method: 'POST', body: { id: p.id, starred: false } });
            await changed();
          } catch (err) {
            fill(results, errorNotice(err));
          }
        },
      }, icon('plus', 14), 'Add'));
    try {
      const r = await api(`/api/players/search?q=${encodeURIComponent(q)}`);
      fill(results,
        r.players.length
          ? h('div', { class: 'table-scroll' }, h('table', {}, h('tbody', {}, r.players.map((p) => h('tr', {},
            h('td', {}, starButton({ id: p.id, key: p.favourite, listed: p.listed }, changed, (err) => fill(results, errorNotice(err)))),
            h('td', {}, h('a', { href: `#/p/${p.id}` }, p.name), p.county ? h('div', { class: 'small muted' }, p.county) : null),
            h('td', { class: 'small' }, DISCIPLINES.filter(([k]) => p.ratings[k] || p.grades[k]).map(([k, label]) => h('span', { class: 'rating-chip', title: label }, `${label[0]} ${p.ratings[k] ?? '—'}${p.grades[k] ? ` ${p.grades[k]}` : ''}`))),
            h('td', { class: 'small muted nowrap' }, `${p.tournaments} tournament${p.tournaments === 1 ? '' : 's'}`),
            h('td', {}, addButton(p)))))))
          : h('p', { class: 'hint' }, 'No one by that name in the imported badminfo tournaments. You can still add them by name under Add a player.'));
    } catch (err) {
      fill(results, errorNotice(err));
    }
  };
  query.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 250); });

  const cards = h('div');
  // The list's order (also the Tournaments page's): drag a card by its grip within
  // its section, or focus the grip and press the arrow keys. Saved straight away.
  let dragKey = null;
  const move = async (d, list, from, to) => {
    const [f] = list.splice(from, 1);
    list.splice(to, 0, f);
    drawCards(d);
    cards.querySelector(`[data-key="${f.key}"] .drag-grip`)?.focus();
    try {
      await api('/api/favourites/order', { method: 'PUT', body: { keys: [...d.favourites, ...d.others].map((x) => x.key) } });
    } catch (err) {
      fill(msg, errorNotice(err));
      await refreshCards();
    }
  };
  const orderedCards = (d, list) => list.map((f, i) => {
    const grip = h('button', {
      type: 'button', class: 'small ghost icon-only drag-grip', title: 'Drag to change the order (or press ← → ↑ ↓)', 'aria-label': `Move ${f.name}: drag, or use the arrow keys`,
      onpointerdown: () => { el.draggable = true; },
      onpointerup: () => { el.draggable = false; },
      onkeydown: (e) => {
        const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
        if (!step) return;
        e.preventDefault();
        if (i + step >= 0 && i + step < list.length) move(d, list, i, i + step);
      },
    }, '⠿');
    const el = card(f, grip);
    const ours = () => dragKey !== null && list.some((x) => x.key === dragKey); // only within its own section
    el.addEventListener('dragstart', (e) => { dragKey = f.key; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.name); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { el.draggable = false; el.classList.remove('dragging'); dragKey = null; });
    el.addEventListener('dragover', (e) => { if (ours() && dragKey !== f.key) { e.preventDefault(); el.classList.add('drop-here'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-here'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-here');
      const from = list.findIndex((x) => x.key === dragKey);
      if (from >= 0 && from !== i) move(d, list, from, i);
    });
    return el;
  });
  const drawCards = (d) => fill(cards,
    h('div', { class: 'section-title' }, icon('star', 15), `Favourites (${d.favourites.length})`),
    d.favourites.length
      ? h('div', { class: 'player-grid' }, orderedCards(d, d.favourites))
      : h('div', { class: 'empty' }, icon('user', 34), h('div', {}, 'No favourites yet. Add your players above, or find them below, and star them (☆).')),
    h('div', { class: 'section-title' }, icon('user', 15), `Other players (${d.others.length})`),
    d.others.length
      ? h('div', { class: 'player-grid' }, orderedCards(d, d.others))
      : h('p', { class: 'hint' }, 'Players you add without a star, or unstar, stay here: for custom tournaments, and to star again later.'));
  // After a change, only the cards are drawn again (the boxes keep their text).
  const refreshCards = async () => drawCards(await api('/api/players'));
  drawCards(data);

  // ---- add a player: by name only, or by their badminfo link ----
  const who = h('input', { type: 'text', class: 'grow', placeholder: 'Name, or badminfo player link (https://badminfo.com/Player/…)', maxlength: 200, 'aria-label': 'Player’s name or badminfo link' });
  const starIt = h('input', { type: 'checkbox', checked: true });
  const addMsg = h('div');
  const addBtn = h('button', { class: 'primary', type: 'submit' }, icon('plus', 16), 'Add player');
  const addForm = h('form', {
    class: 'row',
    onsubmit: async (e) => {
      e.preventDefault();
      const value = who.value.trim();
      if (!value) return;
      const byLink = BADMINFO_PLAYER.test(value);
      addBtn.disabled = true;
      fill(addMsg, byLink ? h('p', { class: 'muted small' }, 'Reading the player from badminfo…') : null);
      try {
        await api('/api/favourites', { method: 'POST', body: { ...(byLink ? { link: value } : { name: value }), starred: starIt.checked } });
        who.value = '';
        fill(addMsg);
        await refreshCards();
      } catch (err) {
        fill(addMsg, errorNotice(err));
      }
      addBtn.disabled = false;
    },
  }, who, h('label', { class: 'row small', title: 'Favourites’ matches are picked out on tournament pages and get the video suggestions' }, starIt, '★ Favourite'), addBtn);

  fill(main,
    pageHead('Players', 'Your players: star (★) the ones you film, so their matches are picked out on tournament pages and get the video suggestions.', refreshBtn),
    h('div', { class: 'players-msg' }, msg),
    h('div', { class: 'card stack' },
      h('h3', { class: 'card-title' }, icon('plus'), 'Add a player'),
      addForm,
      h('p', { class: 'hint' }, 'A name is enough (use it as it appears in the draws, or in your custom tournaments). With a badminfo link the app also reads their ratings and matches.'),
      addMsg),
    data.badminfoTournaments ? null : h('div', { class: 'notice info' }, 'Ratings and grades come from badminfo: import tournaments with their badminfo link, or add players by their badminfo link.'),
    cards,
    h('div', { class: 'section-title' }, icon('user', 15), 'Find a player'),
    h('div', { class: 'card stack' }, h('div', { class: 'row' }, query),
      h('p', { class: 'hint' }, `${data.known} player${data.known === 1 ? '' : 's'} from imported badminfo tournaments.`), results));
}

/** One match in a player's list: ★, time, draw and round, the other side, result from the player's side, video. */
function matchRow(m, onStar) {
  const theirs = m.side === 'b' ? m.teamA : m.teamB;
  const games = m.side === 'b' ? m.games.map(([x, y]) => [y, x]) : m.games;
  return h('tr', {},
    h('td', { class: 'star-cell' }, matchStar(m.id, m.favourite, { onChange: (on) => { m.favourite = on; onStar(); } })),
    h('td', { class: 'nowrap' }, day(m.date), h('div', { class: 'small muted' }, m.time)),
    h('td', { class: 'small' }, m.draw, h('div', { class: 'muted' }, m.round)),
    h('td', {}, m.partners.length ? h('div', { class: 'small muted' }, `with ${m.partners.join(' / ')}`) : null, h('div', {}, 'v ', teamName(theirs))),
    h('td', { class: 'nowrap' }, m.won === true ? h('span', { class: 'pill ok' }, 'Won') : m.won === false ? h('span', { class: 'pill bad' }, 'Lost') : null, ' ', gamesView(games)),
    h('td', {}, m.filmed ? openButtons(m.units) : h('span', { class: 'small muted' }, 'not filmed'),
      m.youtubeUrl ? [' ', h('a', { class: 'pill ok', href: m.youtubeUrl, target: '_blank', rel: 'noopener' }, 'YouTube ↗')]
        : m.playlistUrl ? [' ', h('a', { class: 'pill ok', href: m.playlistUrl, target: '_blank', rel: 'noopener', title: 'Games on YouTube: opens the tournament’s playlist' }, 'Playlist ↗')]
          : m.gamesOnYoutube ? [' ', h('span', { class: 'pill ok', title: 'Games on YouTube, added by hand' }, 'Games on YouTube')] : null));
}

// The matches list's filters, per device; which groups are open, for this window.
const FILTERS_KEY = 'badminton-video:player-matches:v1';
const NO_FILTERS = { year: '', event: '', result: '', video: '', fav: false, text: '' };
const readFilters = () => {
  try {
    return { ...NO_FILTERS, ...JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}') };
  } catch {
    return { ...NO_FILTERS };
  }
};
const writeFilters = (f) => {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch { /* storage blocked: the filters last until the page is left */ }
};
const openGroups = new Map(); // group key -> open, as the user left it

/**
 * A player's matches grouped by year, tournament and event (WS, WD, XD…), the
 * latest tournament open and the rest folded, with filters above.
 */
function matchesSection(matches) {
  const f = readFilters();
  const box = h('div', { class: 'stack' });
  const count = h('span', { class: 'small muted' });
  const years = [...new Set(matches.map((m) => String(m.date ?? '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const events = [...new Set(matches.map((m) => m.event))].sort();
  const select = (key, label, options) => {
    const el = h('select', { class: 'small', 'aria-label': label, onchange: () => { f[key] = el.value; changed(); } },
      options.map(([value, text]) => h('option', { value, selected: f[key] === value }, text)));
    return el;
  };
  const favBox = h('input', { type: 'checkbox', checked: f.fav, onchange: () => { f.fav = favBox.checked; changed(); } });
  const search = h('input', { type: 'search', value: f.text, placeholder: 'Opponent, partner or tournament', 'aria-label': 'Find a match' });
  let typing = null;
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => { f.text = search.value; changed(); }, 250);
  });
  const controls = [
    select('year', 'Year', [['', 'Every year'], ...years.map((y) => [y, y])]),
    select('event', 'Event', [['', 'Every event'], ...events.map((e) => [e, e])]),
    select('result', 'Result', [['', 'Won or lost'], ['won', 'Won'], ['lost', 'Lost'], ['none', 'No result yet']]),
    select('video', 'Video', [['', 'Filmed or not'], ['filmed', 'Filmed'], ['not', 'Not filmed'], ['rendered', 'Rendered'], ['youtube', 'On YouTube']]),
    h('label', { class: 'row small' }, favBox, '★ favourites only'),
  ];
  const clear = h('button', { class: 'small ghost', type: 'button', onclick: () => {
    Object.assign(f, NO_FILTERS);
    for (const el of controls.filter((c) => c.tagName === 'SELECT')) el.value = '';
    favBox.checked = false;
    search.value = '';
    changed();
  } }, 'Clear filters');
  const filtering = () => Object.entries(NO_FILTERS).some(([k, v]) => f[k] !== v);
  function changed() {
    writeFilters(f);
    draw();
  }

  const record = (list) => {
    const won = list.filter((m) => m.won === true).length;
    const lost = list.filter((m) => m.won === false).length;
    const filmed = list.filter((m) => m.filmed).length;
    const stars = list.filter((m) => m.favourite).length;
    return `${list.length} match${list.length === 1 ? '' : 'es'} · ${won}–${lost}${filmed ? ` · ${filmed} filmed` : ''}${stars ? ` · ★ ${stars}` : ''}`;
  };
  // A folding group that remembers being opened or closed in this window.
  const group = (key, openByDefault, summary, ...body) => {
    const el = h('details', { class: `match-group-fold level-${key.split(':')[0]}`, open: openGroups.get(key) ?? openByDefault }, h('summary', {}, summary), body);
    el.addEventListener('toggle', () => openGroups.set(key, el.open));
    return el;
  };

  function draw() {
    const list = matches.filter((m) => matchPasses(m, f));
    count.textContent = `${list.length} of ${matches.length} matches`;
    clear.hidden = !filtering();
    if (!list.length) {
      fill(box, h('p', { class: 'hint' }, 'No match fits the filters.'));
      return;
    }
    // Newest tournament first; inside a tournament, events and their matches in time order.
    // The latest tournament already started (matches come newest first; upcoming draws don't count).
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
    const latest = (matches.find((m) => m.date && m.date <= today) ?? matches[0])?.tournamentId;
    const all = filtering(); // filtering opens every group, so what's found shows
    const byYear = new Map();
    for (const m of list) {
      const y = String(m.date ?? '').slice(0, 4) || 'Undated';
      if (!byYear.has(y)) byYear.set(y, new Map());
      const ts = byYear.get(y);
      if (!ts.has(m.tournamentId)) ts.set(m.tournamentId, []);
      ts.get(m.tournamentId).push(m);
    }
    const redraw = () => draw();
    fill(box, [...byYear].map(([year, ts]) => {
      const inYear = [...ts.values()].flat();
      return group(`year:${year}`, all || inYear.some((m) => m.tournamentId === latest), h('span', {}, h('b', {}, year), h('span', { class: 'muted small' }, ` · ${record(inYear)}`)),
        [...ts].map(([tid, ms]) => {
          const first = ms[0];
          const byEvent = new Map();
          for (const m of [...ms].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))) {
            if (!byEvent.has(m.event)) byEvent.set(m.event, []);
            byEvent.get(m.event).push(m);
          }
          return group(`tournament:${tid}`, all || tid === latest,
            h('span', {}, h('b', {}, first.tournament), h('span', { class: 'muted small' }, ` · ${day(first.tournamentStart)} · ${record(ms)} `),
              h('a', { class: 'small', href: `#/t/${tid}`, onclick: (e) => e.stopPropagation() }, 'Open tournament')),
            [...byEvent].map(([event, em]) => group(`event:${tid}:${event}`, true,
              h('span', {}, h('span', { class: 'event-code' }, event), h('span', { class: 'muted small' }, ` ${record(em)}`)),
              h('div', { class: 'table-scroll' }, h('table', { class: 'player-matches' },
                h('thead', {}, h('tr', {}, ['', 'Date', 'Draw', 'Opponents', 'Result', 'Video'].map((x) => h('th', {}, x)))),
                h('tbody', {}, em.map((m) => matchRow(m, redraw))))))));
        }));
    }));
  }

  draw();
  return h('div', { class: 'stack' },
    h('div', { class: 'row filters' }, controls, search, count, clear),
    box);
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
    pageHead(h('span', { class: 'row' }, starButton({ id, key: data.favourite, listed: data.listed }, () => renderPlayer(main, id), (err) => fill(reelBox, errorNotice(err))), p.name),
      [p.county, p.beNumber ? `BE ${p.beNumber}` : null].filter(Boolean).join(' · ') || null,
      importButton(id, false, reelBox, () => {}, false),
      importButton(id, true, reelBox, () => {}, false),
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
      ? matchesSection(data.matches)
      : h('div', { class: 'empty' }, 'No matches in imported tournaments.'));
  // Their profile (rating history, win chances) is read from badminfo now and then; the page shows what's there meanwhile.
  try {
    const fresh = await api(`/api/players/${id}?refresh=1`);
    if (location.hash === `#/p/${id}`) drawChart(fresh);
  } catch { /* badminfo unreachable: keep what was shown */ }
}
