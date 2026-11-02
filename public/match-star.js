// The ★ that marks a favourite match, the same on the player page, the
// tournament page and in the editor. A game's row stars its whole match
// (PUT /api/matches/:id/favourite).

import { h } from './dom.js';
import { api } from './api.js';

/** A ☆ / ★ button for the match `id`; `onChange(starred)` after it is saved. */
export function matchStar(id, starred, { onChange } = {}) {
  const btn = h('button', { type: 'button', class: 'match-star' });
  const show = (on) => {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'A favourite match: click to unstar' : 'Mark as a favourite match';
    btn.setAttribute('aria-label', btn.title);
    btn.textContent = on ? '★' : '☆';
  };
  show(Boolean(starred));
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); // it may sit inside a link or a <summary>
    e.stopPropagation();
    const next = btn.getAttribute('aria-pressed') !== 'true';
    show(next);
    try {
      await api(`/api/matches/${id}/favourite`, { method: 'PUT', body: { favourite: next } });
      onChange?.(next);
    } catch {
      show(!next); // not saved: put it back
    }
  });
  return btn;
}
