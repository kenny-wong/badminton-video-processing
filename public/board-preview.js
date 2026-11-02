// A picture of the scoreboard as it will be burned into the video: the layout
// from shared/board.js drawn as SVG over a frame of one of the user's videos
// (or a plain dark picture when there is none yet).

import { boardLayout, changedNumbers, fontOf } from './shared/board.js';
import { SCORE_MOTION } from './shared/international-board.js';

const NS = 'http://www.w3.org/2000/svg';

// The international board's motion runs on the Web Animations API from SCORE_MOTION itself (the same
// numbers as the video), steady speed throughout; nothing moves for people who ask for less motion.
const stillWanted = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const play = (el, frames, { delay = 0, duration = 0 } = {}) => el.animate?.(frames, { delay: delay * 1000, duration: duration * 1000, easing: 'linear', fill: 'both' });
const hiddenUntil = (el, at) => play(el, [{ visibility: 'hidden' }, { visibility: 'visible' }], { delay: at });
const goneAt = (el, at) => play(el, [{ visibility: 'visible' }, { visibility: 'hidden' }], { delay: at });

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
 * `crop` cuts the picture down to the board (with its flags and banner) and sizes it one CSS pixel
 * per video pixel, so a `width` × `height` video's board shows at its real size.
 */
export function boardPreview({ names, state, style, flags, heading = '', banner = '', background = null, logo = null, width = 1280, height = 720, transparent = false, before = null, crop = false }) {
  const { items } = boardLayout({ width, height, names, state, style, flags, heading, banner });
  const previous = before ? boardLayout({ width, height, ...before, banner: '' }).items : [];
  const flipping = changedNumbers(previous, items);
  const oldNumbers = new Map(previous.filter((it) => it.type === 'text' && it.flip).map((it) => [it.key, it.text]));
  const serveRow = (list) => list.find((it) => it.serve)?.centre[1];
  const serveMoved = before && serveRow(previous) !== undefined && serveRow(items) !== undefined && serveRow(previous) !== serveRow(items);
  let serveGroup = null;
  const still = stillWanted();
  const m = SCORE_MOTION;
  const font = fontOf(style.font);
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
      if (it.serve && serveMoved && !serveGroup && !still) {
        // The serve marker grows in about its middle through the broadcast's sizes, one every serveStep.
        serveGroup = root.appendChild(svg('g', { style: { 'transform-origin': `${it.centre[0]}px ${it.centre[1]}px` } }));
        play(serveGroup, [{ transform: 'scale(0)' }, ...m.serveSteps.map((v) => ({ transform: `scale(${v})` }))], { delay: m.serveIn, duration: m.serveSteps.length * m.serveStep });
      }
      const into = it.serve && serveGroup ? serveGroup : root;
      into.append(svg('polygon', { points: it.points.map((p) => p.join(',')).join(' '), fill: it.colour, 'fill-opacity': it.opacity }));
    } else {
      // Narrow lettering is drawn squeezed sideways, as the video's subtitles do. FFmpeg sizes text by the
      // font's ascent + descent, the browser by its em: size × em draws it as big as the video does; a
      // regular weight brought up to the broadcast's (embolden) gets the same outline in its own colour.
      const k = (it.stretch ?? 100) / 100;
      const thick = it.embolden ? { stroke: it.colour, 'stroke-opacity': it.opacity, 'stroke-width': it.embolden * 2, 'stroke-linejoin': 'round', 'paint-order': 'stroke' } : {};
      const text = (dx, attrs, value = it.text) => svg('text', {
        x: 0, y: 0, transform: `translate(${it.x + dx},${it.y + dx}) scale(${k},1)`, 'font-family': style.font, 'font-size': it.size * font.em,
        'font-weight': it.bold ? 700 : 400, 'text-anchor': it.anchor, 'dominant-baseline': 'central', ...thick, ...attrs,
      }, value);
      if (it.cell && flipping.has(it.key)) {
        // Inside the tile: the old number slides out to the right, held there a moment, then goes; the
        // new one appears to the left at inStart and slides in, both at a steady speed.
        const { x, y, w, h } = it.cell;
        const cw = Math.round(w * m.clipRight);
        const clip = svg('svg', { x, y, width: cw, height: h, viewBox: `${x} ${y} ${cw} ${h}`, overflow: 'hidden', 'aria-hidden': 'true' });
        const into = svg('g', {}, text(0, { fill: it.colour, 'fill-opacity': it.opacity }));
        clip.append(into);
        if (!still) {
          const out = svg('g', {}, text(0, { fill: it.colour, 'fill-opacity': it.opacity }, oldNumbers.get(it.key)));
          clip.append(out);
          play(out, [{ transform: 'translateX(0)' }, { transform: `translateX(${w * m.outBy}px)` }], { duration: m.out });
          goneAt(out, m.out + m.outHold);
          play(into, [{ transform: `translateX(${-w * m.inFrom}px)` }, { transform: 'translateX(0)' }], { delay: m.inStart, duration: m.in });
          hiddenUntil(into, m.inStart);
        }
        root.append(clip);
        continue;
      }
      // A changed number unfolds from its middle line (styles.css .board-flip), as the video's does.
      const into = flipping.has(it.key) ? root.appendChild(svg('g', { class: 'board-flip' })) : root;
      if (it.shadow) into.append(text(1, { fill: '#000', 'fill-opacity': 0.4 * it.opacity }));
      into.append(text(0, { fill: it.colour, 'fill-opacity': it.opacity }));
    }
  }
  if (crop) {
    // Every box and shape (the texts sit inside them), with a little of the picture around.
    const xs = [];
    const ys = [];
    for (const it of items) {
      if (it.type === 'rect') xs.push(it.x, it.x + it.w), ys.push(it.y, it.y + it.h);
      else if (it.type === 'poly') for (const [x, y] of it.points) xs.push(x), ys.push(y);
    }
    const m = Math.round(height * 0.02);
    const x0 = Math.max(0, Math.min(...xs) - m);
    const y0 = Math.max(0, Math.min(...ys) - m);
    const w = Math.min(width, Math.max(...xs) + m) - x0;
    const h = Math.min(height, Math.max(...ys) + m) - y0;
    root.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
    root.setAttribute('width', w);
    root.setAttribute('height', h);
    root.classList.add('actual-size');
  }
  return root;
}
