// Tiny DOM helpers for the views.

/**
 * h('button', { class: 'btn', onclick: fn, disabled: true }, 'Save') — attributes
 * starting with "on" become listeners, false/null ones are left out, and
 * children may be strings, nodes, arrays or null.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

/** Replaces an element's contents. */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** "2026-10-24T09:12:00Z" -> "Sat 24 Oct, 09:12" in UK time. */
export function when(iso, { date = true } = {}) {
  if (!iso) return '—';
  const opts = { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  if (date) Object.assign(opts, { weekday: 'short', day: 'numeric', month: 'short' });
  return new Intl.DateTimeFormat('en-GB', opts).format(new Date(iso));
}

/** The UK date of a moment, "2026-10-24". */
export const ukDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** "2026-10-24" -> "Sat 24 Oct 2026" */
export function day(ymd) {
  if (!ymd) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${ymd}T00:00:00Z`));
}

export const megabytes = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

/** "12-15 15-8 15-13" as nodes, with the higher score of each game in bold. */
export function gamesView(games) {
  const out = [];
  for (const [x, y] of games ?? []) {
    if (out.length) out.push(' ');
    out.push(h('span', { class: 'game-score' }, x > y ? h('b', {}, x) : x, '-', y > x ? h('b', {}, y) : y));
  }
  return out;
}
