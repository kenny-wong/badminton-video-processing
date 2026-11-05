// The corner view: an area of the picture, chosen in the editor, shown enlarged in a
// window over the same video and playing with it. { x, y, w, h } is the area and
// { left, top } the window's top left, as fractions of the picture; `size` is the window's
// width, per cent of the picture's. Without left and top it sits at the bottom right.
// insetBox() turns it into pixels for the render and the editor's preview.

export const INSET_SIZE = { min: 10, max: 90, normal: 20 };
export const INSET_ZOOM = { min: 0.5, max: 10 }; // how much the area is enlarged
const MIN_AREA = 0.01; // a smaller area is a slip of the mouse
const MAX_HEIGHT = 0.9; // of the picture: a tall area is narrowed to stay below this
const MARGIN = { x: 0.025, y: 0.04 }; // as the logo's

const round4 = (n) => Math.round(n * 10000) / 10000;
const between = (n, low, high) => Math.min(high, Math.max(low, n));
const even = (n) => Math.max(2, Math.floor(n / 2) * 2); // FFmpeg's 4:2:0 video wants even sizes
const inPicture = (n) => Number.isFinite(n) && n >= 0 && n <= 1;

/** A saved or sent corner view, tidied; null when it isn't one. */
export function cleanInset(v) {
  if (!v || typeof v !== 'object') return null;
  const [x, y, w, h] = [v.x, v.y, v.w, v.h].map(Number);
  if (![x, y, w, h].every(inPicture) || w < MIN_AREA || h < MIN_AREA || x + w > 1.0001 || y + h > 1.0001) return null;
  const size = Number(v.size);
  const [left, top] = [v.left, v.top].map((n) => (n === null || n === undefined ? NaN : Number(n)));
  return {
    x: round4(x), y: round4(y), w: round4(w), h: round4(h),
    size: Number.isFinite(size) ? Math.round(between(size, INSET_SIZE.min, INSET_SIZE.max) * 10) / 10 : INSET_SIZE.normal,
    ...(inPicture(left) && inPicture(top) ? { left: round4(left), top: round4(top) } : {}),
  };
}

/**
 * In pixels of a width × height picture: `crop`, the area, and `place`, where the
 * window goes (x, y, w, h with its white edge of `border` pixels). Null without a corner view.
 */
export function insetBox(inset, width, height) {
  if (!inset || !width || !height) return null;
  const cw = Math.min(even(inset.w * width), even(width));
  const ch = Math.min(even(inset.h * height), even(height));
  const crop = { w: cw, h: ch, x: Math.min(Math.round(inset.x * width), width - cw), y: Math.min(Math.round(inset.y * height), height - ch) };
  const wide = (width * inset.size) / 100;
  const tall = (wide * inset.h * height) / (inset.w * width); // not from the crop: its even pixels would make the window jump as it zooms
  const k = Math.min(1, (height * MAX_HEIGHT) / tall);
  const border = even(height / 270);
  const w = even(wide * k) + 2 * border;
  const h = even(tall * k) + 2 * border;
  const placed = Number.isFinite(inset.left) && Number.isFinite(inset.top);
  const x = placed ? inset.left * width : width - w - width * MARGIN.x;
  const y = placed ? inset.top * height : height - h - height * MARGIN.y;
  const onPicture = (n, room) => Math.floor(between(n, 0, room) / 2) * 2;
  return { crop, place: { x: onPicture(x, width - w), y: onPicture(y, height - h), w, h, border } };
}

/** The window moved by dx, dy (fractions of the picture), kept on the picture. */
export function movedInset(inset, dx, dy, width, height) {
  const { x, y } = insetBox(inset, width, height).place;
  return cleanInset({ ...inset, ...clampedTo(inset, x / width + dx, y / height + dy, width, height) });
}

function clampedTo(inset, left, top, width, height) {
  const { w, h } = insetBox(inset, width, height).place;
  return { left: between(left, 0, 1 - w / width), top: between(top, 0, 1 - h / height) };
}

/**
 * The window resized by dragging its corner `grip` ('nw', 'ne', 'sw', 'se') by dx, dy: the
 * opposite corner stays put, the area and so the window's shape stay, and the enlargement changes.
 */
export function resizedInset(inset, grip, dx, dy, width, height) {
  const { x, y, w, h } = insetBox(inset, width, height).place;
  const across = (w + (grip[1] === 'w' ? -dx : dx) * width) / w;
  const down = (h + (grip[0] === 'n' ? -dy : dy) * height) / h;
  const size = between(inset.size * Math.max(across, down), INSET_SIZE.min, INSET_SIZE.max);
  const next = insetBox({ ...inset, size, left: 0, top: 0 }, width, height).place;
  const left = (grip[1] === 'w' ? x + w - next.w : x) / width;
  const top = (grip[0] === 'n' ? y + h - next.h : y) / height;
  return cleanInset({ ...inset, size, ...clampedTo({ ...inset, size }, left, top, width, height) });
}

/** The magnifier: a circle round the mouse, on screen only, never rendered. */
export const MAGNIFIER = { min: 1.5, max: 8, normal: 3, step: 0.5 };

/** Its width in pixels over a picture shown at width × height: a new corner view's size, by the longer side so it isn't tiny on an upright video. */
export const magnifierSize = (width, height) => (INSET_SIZE.normal / 100) * Math.max(width, height);

/** A saved or stepped ratio, on the slider's scale. */
export const magnifierZoom = (n) => (Number.isFinite(n) ? between(Math.round(n / MAGNIFIER.step) * MAGNIFIER.step, MAGNIFIER.min, MAGNIFIER.max) : MAGNIFIER.normal);

/** The area it shows, in fractions of the picture: centred on `at`, `zoom` times closer than the picture on screen. It may run off the picture's edge. */
export function magnifierArea([x, y], size, width, height, zoom) {
  const w = size / width / zoom;
  const h = size / height / zoom;
  return { x: x - w / 2, y: y - h / 2, w, h };
}

/** How much the area is enlarged in its window. */
export const zoomOf = (inset) => inset.size / 100 / inset.w;

/** The area around the same middle, cut so the window (which stays) shows it enlarged `zoom` times, as near as the picture allows. */
export function zoomedInset(inset, zoom) {
  const k = between(inset.size / 100 / zoom / inset.w, Math.max(MIN_AREA / inset.w, MIN_AREA / inset.h), Math.min(1 / inset.w, 1 / inset.h));
  const w = inset.w * k;
  const h = inset.h * k;
  return cleanInset({ ...inset, w, h, x: between(inset.x + inset.w / 2 - w / 2, 0, 1 - w), y: between(inset.y + inset.h / 2 - h / 2, 0, 1 - h) });
}
