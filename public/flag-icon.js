// A small flag (the scoreboard's own vector flags, public/shared/flags.js) for pickers and lists.

import { flagShapes } from './shared/flags.js';

const NS = 'http://www.w3.org/2000/svg';

/** An inline SVG flag `width` × `height` CSS pixels, or an empty dashed box for no country. */
export function flagIcon(code, { width = 27, height = 18, title = '' } = {}) {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  root.setAttribute('width', width);
  root.setAttribute('height', height);
  root.setAttribute('class', `flag-icon${code ? '' : ' none'}`);
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', title || 'No flag');
  for (const shape of flagShapes(code, 0, 0, width, height, false)) {
    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', shape.points.map((p) => p.join(',')).join(' '));
    poly.setAttribute('fill', shape.colour);
    root.append(poly);
  }
  return root;
}
