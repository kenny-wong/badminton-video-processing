// The corner view: an area of the picture, chosen in the editor, shown enlarged in
// a corner of the same video and playing with it. The area is kept as fractions of
// the picture; insetBox() turns it into pixels for the render and the editor's preview.

import { CORNERS } from './board.js';

export const INSET_SIZE = { min: 15, max: 50, normal: 30 }; // its width, per cent of the picture's
const MIN_AREA = 0.03; // a smaller area is a slip of the mouse
const MAX_HEIGHT = 0.6; // of the picture: a tall area is narrowed to stay below this
const MARGIN = { x: 0.025, y: 0.04 }; // as the logo's

const round4 = (n) => Math.round(n * 10000) / 10000;
const even = (n) => Math.max(2, Math.floor(n / 2) * 2); // FFmpeg's 4:2:0 video wants even sizes
const inPicture = (n) => Number.isFinite(n) && n >= 0 && n <= 1;

/** A saved or sent corner view, tidied; null when it isn't one. */
export function cleanInset(v) {
  if (!v || typeof v !== 'object') return null;
  const [x, y, w, h] = [v.x, v.y, v.w, v.h].map(Number);
  if (![x, y, w, h].every(inPicture) || w < MIN_AREA || h < MIN_AREA || x + w > 1.0001 || y + h > 1.0001) return null;
  const size = Number(v.size);
  return {
    x: round4(x), y: round4(y), w: round4(w), h: round4(h),
    corner: Object.hasOwn(CORNERS, v.corner) ? v.corner : 'br',
    size: Number.isFinite(size) ? Math.min(INSET_SIZE.max, Math.max(INSET_SIZE.min, Math.round(size))) : INSET_SIZE.normal,
  };
}

/** The first corner the scoreboard and logo don't use, starting at the bottom right. */
export const freeCorner = (...taken) => ['br', 'bl', 'tr', 'tl'].find((c) => !taken.includes(c)) ?? 'br';

/**
 * In pixels of a width × height picture: `crop`, the area, and `place`, where it
 * goes (x, y, w, h with its white edge of `border` pixels). Null without a corner view.
 */
export function insetBox(inset, width, height) {
  if (!inset || !width || !height) return null;
  const cw = Math.min(even(inset.w * width), even(width));
  const ch = Math.min(even(inset.h * height), even(height));
  const crop = { w: cw, h: ch, x: Math.min(Math.round(inset.x * width), width - cw), y: Math.min(Math.round(inset.y * height), height - ch) };
  const wide = (width * inset.size) / 100;
  const tall = (wide * ch) / cw;
  const k = Math.min(1, (height * MAX_HEIGHT) / tall);
  const border = even(height / 270);
  const w = even(wide * k) + 2 * border;
  const h = even(tall * k) + 2 * border;
  const left = even(width * MARGIN.x);
  const top = even(height * MARGIN.y);
  return {
    crop,
    place: { x: inset.corner[1] === 'l' ? left : even(width - w - left), y: inset.corner[0] === 't' ? top : even(height - h - top), w, h, border },
  };
}
