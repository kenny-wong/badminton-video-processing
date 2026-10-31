// The editor's Stats tab: the numbers from shared/stats.js, a momentum chart
// (who led, after every rally, game by game) that can be saved as a picture,
// and a map of where rallies ended on court from the tracked shuttle.

import { h } from './dom.js';
import { courtLines, COURT } from './shared/court.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
  e.append(...children);
  return e;
};

const pct = (won, of) => (of ? `${won}/${of} (${Math.round((won / of) * 100)}%)` : '—');

/** The summary and per-game tables. */
export function statsTables(s, [nameA, nameB]) {
  const row = (label, a, b) => h('tr', {}, h('th', {}, label), h('td', { class: 'side-a' }, a), h('td', { class: 'side-b' }, b));
  const runOf = (side) => (s.longestRun?.side === side ? `${s.longestRun.points} (game ${s.longestRun.game})` : '');
  return [
    h('table', { class: 'stats-table' },
      h('thead', {}, h('tr', {}, h('th', {}), h('th', { class: 'side-a' }, nameA), h('th', { class: 'side-b' }, nameB))),
      h('tbody', {},
        row('Points won', s.points[0], s.points[1]),
        row('On own serve', pct(s.serve.a.won, s.serve.a.of), pct(s.serve.b.won, s.serve.b.of)),
        row('On receive', pct(s.receive.a.won, s.receive.a.of), pct(s.receive.b.won, s.receive.b.of)),
        row('Longest run', runOf('a'), runOf('b')))),
    h('div', { class: 'stats summary small-stats' },
      h('div', { class: 'stat' }, h('b', {}, s.averageRally === null ? '—' : `${s.averageRally} s`), h('span', {}, 'average rally')),
      h('div', { class: 'stat' }, h('b', {}, s.longestRally ? `${Math.round(s.longestRally.seconds)} s` : '—'), h('span', {}, s.longestRally ? `longest (rally ${s.longestRally.index + 1})` : 'longest rally')),
      h('div', { class: 'stat' }, h('b', {}, s.averageShots ?? '—'), h('span', {}, 'shots a rally')),
      h('div', { class: 'stat' }, h('b', {}, s.mostShots?.shots ?? '—'), h('span', {}, s.mostShots ? `most shots (rally ${s.mostShots.index + 1})` : 'most shots'))),
    s.games.length ? h('table', { class: 'stats-table' },
      h('thead', {}, h('tr', {}, ['Game', 'Score', 'Time', 'Biggest lead', 'Best run', 'Comeback'].map((x) => h('th', {}, x)))),
      h('tbody', {}, s.games.map((g) => h('tr', {},
        h('td', {}, g.number),
        h('td', { class: g.winner ? `side-${g.winner}` : '' }, g.score ? g.score.join('-') : 'unfinished'),
        h('td', {}, g.seconds ? `${Math.round(g.seconds / 60)} min` : '—'),
        h('td', {}, h('span', { class: 'side-a' }, g.biggestLead[0]), ' / ', h('span', { class: 'side-b' }, g.biggestLead[1])),
        h('td', {}, h('span', { class: 'side-a' }, g.runs[0]), ' / ', h('span', { class: 'side-b' }, g.runs[1])),
        h('td', {}, g.comeback ? `from ${g.comeback} down` : '—'))))) : null,
  ];
}

/**
 * The momentum chart: the lead after each rally, A above the line and B below,
 * game after game. `colours` are explicit so the picture can be saved.
 */
export function momentumChart(stats, [nameA, nameB], { colours, width = 400, height = 190, background = null, fontSize = 10 } = {}) {
  const games = stats.games.filter((g) => g.lead.length > 1);
  if (!games.length) return null;
  const pad = { left: 34, right: 12, top: 26, bottom: 22 };
  const steps = games.reduce((n, g) => n + g.lead.length - 1, 0) + (games.length - 1); // a gap between games
  const most = Math.max(3, ...games.flatMap((g) => g.lead.map((x) => Math.abs(x.lead))));
  const x = (k) => pad.left + (k / Math.max(1, steps)) * (width - pad.left - pad.right);
  const mid = pad.top + (height - pad.top - pad.bottom) / 2;
  const y = (lead) => mid - (lead / most) * ((height - pad.top - pad.bottom) / 2);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'momentum', role: 'img', 'aria-label': 'Who led after each rally', xmlns: NS, 'font-family': 'Segoe UI, Arial, sans-serif', 'font-size': fontSize });
  if (background) svg.append(el('rect', { x: 0, y: 0, width, height, fill: background }));
  svg.append(
    el('text', { x: pad.left, y: 15, fill: colours.a, 'font-weight': 700 }, `▲ ${nameA} ahead`),
    el('text', { x: width - pad.right, y: 15, fill: colours.b, 'font-weight': 700, 'text-anchor': 'end' }, `${nameB} ahead ▼`),
    el('line', { x1: pad.left, x2: width - pad.right, y1: mid, y2: mid, stroke: colours.grid, 'stroke-width': 1 }));
  for (const v of [most, -most]) svg.append(el('text', { x: pad.left - 6, y: y(v), fill: colours.text, 'text-anchor': 'end', 'dominant-baseline': 'central' }, String(Math.abs(v))));
  let k = 0;
  games.forEach((g, gi) => {
    const start = k;
    const pts = g.lead.map((p, j) => [x(start + j), y(p.lead)]);
    k += g.lead.length - 1;
    // Area above (A) and below (B) the line, as steps: the lead holds until the next rally ends.
    const stepPath = pts.map(([px, py], j) => (j ? `H${px.toFixed(1)}V${py.toFixed(1)}` : `M${px.toFixed(1)},${py.toFixed(1)}`)).join('');
    const clipA = `ma${gi}`;
    const clipB = `mb${gi}`;
    svg.append(
      el('clipPath', { id: clipA }, el('rect', { x: 0, y: 0, width, height: mid })),
      el('clipPath', { id: clipB }, el('rect', { x: 0, y: mid, width, height: height - mid })),
      el('path', { d: `${stepPath}V${mid}H${pts[0][0].toFixed(1)}Z`, fill: colours.a, 'fill-opacity': 0.35, 'clip-path': `url(#${clipA})` }),
      el('path', { d: `${stepPath}V${mid}H${pts[0][0].toFixed(1)}Z`, fill: colours.b, 'fill-opacity': 0.35, 'clip-path': `url(#${clipB})` }),
      el('path', { d: stepPath, fill: 'none', stroke: colours.text, 'stroke-width': 1.5 }),
      el('text', { x: (pts[0][0] + pts.at(-1)[0]) / 2, y: height - 6, fill: colours.text, 'text-anchor': 'middle' }, `Game ${g.number}${g.score ? ` · ${g.score.join('-')}` : ''}`));
    if (gi < games.length - 1) {
      k += 1;
      svg.append(el('line', { x1: x(k - 0.5), x2: x(k - 0.5), y1: pad.top, y2: height - pad.bottom, stroke: colours.grid, 'stroke-dasharray': '4 4' }));
    }
  });
  return svg;
}

/** Saves an SVG element as a PNG file (twice its size, for sharp text). */
export async function saveSvgAsPng(svg, fileName) {
  const [, , w, hgt] = svg.getAttribute('viewBox').split(' ').map(Number);
  const text = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = hgt * 2;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const a = h('a', { href: URL.createObjectURL(blob), download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** The court from above, far end at the top, with a dot where each rally ended (coloured by who won it). */
export function landingMap(list, { colours }) {
  const m = 20; // pixels per metre
  const pad = 30;
  const w = COURT.width * m + pad * 2;
  const hgt = COURT.length * m + pad * 2;
  const X = (cx) => pad + cx * m;
  const Y = (cy) => pad + (COURT.length - cy) * m;
  const svg = el('svg', { viewBox: `0 0 ${w} ${hgt}`, class: 'landing-map', role: 'img', 'aria-label': 'Where rallies ended on court' },
    el('rect', { x: pad, y: pad, width: COURT.width * m, height: COURT.length * m, fill: colours.court }));
  for (const [[x1, y1], [x2, y2]] of courtLines()) svg.append(el('line', { x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2), stroke: '#ffffff', 'stroke-width': 1.5 }));
  svg.append(el('text', { x: w / 2, y: 18, 'text-anchor': 'middle', fill: colours.text, 'font-size': 11 }, 'far end'),
    el('text', { x: w / 2, y: hgt - 8, 'text-anchor': 'middle', fill: colours.text, 'font-size': 11 }, 'near end (camera)'));
  for (const p of list) {
    svg.append(el('circle', { cx: X(p.x), cy: Y(p.y), r: 5, fill: p.winner === 'a' ? colours.a : colours.b, stroke: '#000', 'stroke-opacity': 0.5 },
      el('title', {}, `Rally ${p.index + 1}: won by ${p.winner.toUpperCase()}`)));
  }
  return svg;
}
