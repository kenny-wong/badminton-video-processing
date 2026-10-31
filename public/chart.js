// A small line chart drawn as SVG (no library): lines over time, with a
// legend, the first and last value of each line, and dated grid lines.
// Colours come from CSS classes (styles.css .chart .s-<key>).

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
  e.append(...children);
  return e;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * series: [{ key, label, points: [{ date: 'YYYY-MM-DD', value }] }] (points in date order).
 * Returns an SVG element, or null when there is nothing to draw.
 */
export function lineChart(series, { width = 720, height = 260 } = {}) {
  const lines = series.filter((s) => s.points.length);
  if (!lines.length) return null;
  const pad = { left: 44, right: 56, top: 14, bottom: 30 };
  const all = lines.flatMap((s) => s.points);
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  let [t0, t1] = [Math.min(...all.map((p) => t(p.date))), Math.max(...all.map((p) => t(p.date)))];
  if (t1 === t0) { t0 -= 15 * 864e5; t1 += 15 * 864e5; }
  let [v0, v1] = [Math.min(...all.map((p) => p.value)), Math.max(...all.map((p) => p.value))];
  const room = Math.max(10, (v1 - v0) * 0.12);
  v0 = Math.floor((v0 - room) / 10) * 10;
  v1 = Math.ceil((v1 + room) / 10) * 10;
  const x = (d) => pad.left + ((t(d) - t0) / (t1 - t0)) * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - (v - v0) / (v1 - v0)) * (height - pad.top - pad.bottom);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': `Rating over time: ${lines.map((s) => s.label).join(', ')}` });
  // Value grid: about four lines at round numbers.
  const step = Math.max(10, Math.ceil((v1 - v0) / 4 / 10) * 10);
  for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) {
    svg.append(el('line', { class: 'grid', x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v) }), el('text', { class: 'axis', x: pad.left - 6, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'central' }, String(v)));
  }
  // Date ticks: the first of each month, thinned to fit.
  const months = [];
  const start = new Date(t0);
  for (let d = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1); d <= t1; d = Date.UTC(new Date(d).getUTCFullYear(), new Date(d).getUTCMonth() + 1, 1)) months.push(d);
  const every = Math.max(1, Math.ceil(months.length / 6));
  months.filter((_, i) => i % every === 0).forEach((d, i) => {
    const date = new Date(d);
    const iso = date.toISOString().slice(0, 10);
    const year = i === 0 || date.getUTCMonth() < every ? ` ${date.getUTCFullYear()}` : '';
    svg.append(el('text', { class: 'axis', x: x(iso), y: height - 10, 'text-anchor': 'middle' }, `${MONTHS[date.getUTCMonth()]}${year}`));
  });
  for (const s of lines) {
    const path = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    svg.append(el('path', { class: `line s-${s.key}`, d: path }));
    for (const p of s.points) svg.append(el('circle', { class: `dot s-${s.key}`, cx: x(p.date), cy: y(p.value), r: 2.5 }, el('title', {}, `${s.label} ${p.value} · ${p.date}`)));
    const last = s.points.at(-1);
    svg.append(el('text', { class: `end s-${s.key}`, x: x(last.date) + 6, y: y(last.value), 'dominant-baseline': 'central' }, String(last.value)));
  }
  return svg;
}
