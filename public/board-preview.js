// A picture of the scoreboard as it will be burned into the video: the layout
// from shared/board.js drawn as SVG over a frame of one of the user's videos
// (or a plain dark picture when there is none yet).

import { boardLayout } from './shared/board.js';

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/**
 * The SVG for one moment: `names` [A, B], `state` (games, points, won, server),
 * `style` (a board look), `flags`, `heading`, `banner`, `background` (an image URL).
 */
export function boardPreview({ names, state, style, flags, heading = '', banner = '', background = null, width = 1280, height = 720 }) {
  const { items } = boardLayout({ width, height, names, state, style, flags, heading, banner });
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'board-preview', role: 'img', 'aria-label': 'Scoreboard preview' });
  const defs = svg('defs', {}, svg('linearGradient', { id: 'court-bg', x1: 0, y1: 0, x2: 1, y2: 1 },
    svg('stop', { offset: '0', 'stop-color': '#2d4a3e' }), svg('stop', { offset: '1', 'stop-color': '#16251f' })));
  root.append(defs, svg('rect', { x: 0, y: 0, width, height, fill: 'url(#court-bg)' }));
  if (background) root.append(svg('image', { href: background, x: 0, y: 0, width, height, preserveAspectRatio: 'xMidYMid slice' }));
  for (const it of [...items].sort((a, b) => a.layer - b.layer)) {
    if (it.type === 'rect') {
      root.append(svg('rect', { x: it.x, y: it.y, width: it.w, height: it.h, fill: it.colour, 'fill-opacity': it.opacity }));
    } else {
      const t = svg('text', {
        x: it.x, y: it.y, fill: it.colour, 'fill-opacity': it.opacity, 'font-family': style.font, 'font-size': it.size,
        'font-weight': it.bold ? 700 : 400, 'text-anchor': it.anchor, 'dominant-baseline': 'central',
      }, it.text);
      if (it.shadow) root.append(svg('text', { x: it.x + 1, y: it.y + 1, fill: '#000', 'fill-opacity': 0.4 * it.opacity, 'font-family': style.font, 'font-size': it.size, 'font-weight': it.bold ? 700 : 400, 'text-anchor': it.anchor, 'dominant-baseline': 'central' }, it.text));
      root.append(t);
    }
  }
  return root;
}
