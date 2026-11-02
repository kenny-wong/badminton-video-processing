// A picture of the scoreboard as it will be burned into the video: the layout
// from shared/board.js drawn as SVG over a frame of one of the user's videos
// (or a plain dark picture when there is none yet).

import { boardLayout, changedNumbers } from './shared/board.js';
import { SCORE_MOTION } from './shared/international-board.js';

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    // The page's CSP (style-src 'self') drops style="" attributes; properties set through the DOM are kept.
    if (k === 'style') for (const [name, value] of Object.entries(v)) el.style.setProperty(name, value);
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

/**
 * The SVG for one moment: `names` [A, B], `state` (games, points, won, server),
 * `style` (a board look), `flags`, `heading`, `banner`, `background` (an image URL).
 * `transparent` omits the backdrop so the board can sit over the playing video.
 * `before` (the moment drawn just before, same fields) makes the numbers that changed flip in (or slide,
 * on the international board, with its serve marker hopping rows: SCORE_MOTION, as the video does).
 */
export function boardPreview({ names, state, style, flags, heading = '', banner = '', background = null, logo = null, width = 1280, height = 720, transparent = false, before = null }) {
  const { items } = boardLayout({ width, height, names, state, style, flags, heading, banner });
  const previous = before ? boardLayout({ width, height, ...before, banner: '' }).items : [];
  const flipping = changedNumbers(previous, items);
  const oldNumbers = new Map(previous.filter((it) => it.type === 'text' && it.flip).map((it) => [it.key, it.text]));
  const serveRow = (list) => list.find((it) => it.serve)?.centre[1];
  const serveMoved = before && serveRow(previous) !== undefined && serveRow(items) !== undefined && serveRow(previous) !== serveRow(items);
  let serveGroup = null;
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'board-preview', role: 'img', 'aria-label': 'Scoreboard preview' });
  const defs = svg('defs', {}, svg('linearGradient', { id: 'court-bg', x1: 0, y1: 0, x2: 1, y2: 1 },
    svg('stop', { offset: '0', 'stop-color': '#2d4a3e' }), svg('stop', { offset: '1', 'stop-color': '#16251f' })));
  if (!transparent) root.append(defs, svg('rect', { x: 0, y: 0, width, height, fill: 'url(#court-bg)' }));
  if (background) root.append(svg('image', { href: background, x: 0, y: 0, width, height, preserveAspectRatio: 'xMidYMid slice' }));
  if (logo?.url) {
    // A square box as wide as the logo, the picture kept in its corner of it.
    const w = (width * logo.size) / 100;
    const right = logo.corner[1] === 'r';
    const bottom = logo.corner[0] === 'b';
    root.append(svg('image', {
      href: logo.url, width: w, height: w, opacity: logo.opacity / 100,
      x: right ? width - width * 0.025 - w : width * 0.025, y: bottom ? height - height * 0.04 - w : height * 0.04,
      preserveAspectRatio: `${right ? 'xMax' : 'xMin'}${bottom ? 'YMax' : 'YMin'} meet`,
    }));
  }
  for (const it of [...items].sort((a, b) => a.layer - b.layer)) {
    if (it.type === 'rect') {
      root.append(svg('rect', { x: it.x, y: it.y, width: it.w, height: it.h, fill: it.colour, 'fill-opacity': it.opacity }));
    } else if (it.type === 'poly') {
      const into = it.serve && serveMoved
        ? (serveGroup ??= root.appendChild(svg('g', { class: 'board-serve-in', style: { 'transform-origin': `${it.centre[0]}px ${it.centre[1]}px`, '--serve-in': `${SCORE_MOTION.serveIn}s`, '--serve-grow': `${SCORE_MOTION.serveGrow}s` } })))
        : root;
      into.append(svg('polygon', { points: it.points.map((p) => p.join(',')).join(' '), fill: it.colour, 'fill-opacity': it.opacity }));
    } else {
      // Narrow lettering is drawn squeezed sideways, as the video's subtitles do.
      const k = (it.stretch ?? 100) / 100;
      const text = (dx, attrs, value = it.text) => svg('text', {
        x: 0, y: 0, transform: `translate(${it.x + dx},${it.y + dx}) scale(${k},1)`, 'font-family': style.font, 'font-size': it.size,
        'font-weight': it.bold ? 700 : 400, 'text-anchor': it.anchor, 'dominant-baseline': 'central', ...attrs,
      }, value);
      if (it.cell && flipping.has(it.key)) {
        const { x, y, w, h } = it.cell;
        const clip = svg('svg', { x, y, width: w, height: h, viewBox: `${x} ${y} ${w} ${h}`, overflow: 'hidden', 'aria-hidden': 'true' });
        const m = SCORE_MOTION;
        const motion = { '--slide-out': `${w * m.outBy}px`, '--slide-in': `${-w * m.inFrom}px`, '--out': `${m.out}s`, '--in': `${m.in}s`, '--in-start': `${m.inStart}s` };
        clip.append(
          svg('g', { class: 'board-slide-in', style: motion }, text(0, { fill: it.colour, 'fill-opacity': it.opacity })),
          svg('g', { class: 'board-slide-out', style: motion }, text(0, { fill: it.colour, 'fill-opacity': it.opacity }, oldNumbers.get(it.key))),
        );
        root.append(clip);
        continue;
      }
      // A changed number unfolds from its middle line (styles.css .board-flip), as the video's does.
      const into = flipping.has(it.key) ? root.appendChild(svg('g', { class: 'board-flip' })) : root;
      if (it.shadow) into.append(text(1, { fill: '#000', 'fill-opacity': 0.4 * it.opacity }));
      into.append(text(0, { fill: it.colour, 'fill-opacity': it.opacity }));
    }
  }
  return root;
}
