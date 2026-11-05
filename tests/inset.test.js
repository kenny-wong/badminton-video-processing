import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanInset, INSET_SIZE, insetBox, movedInset, resizedInset, zoomedInset, zoomOf } from '../public/shared/inset.js';
import { insetFilter, partArgs } from '../lib/render.js';
import { clipArgs } from '../lib/clip.js';

const W = 1920;
const H = 1080;
const area = { x: 0.5, y: 0.25, w: 0.2, h: 0.2, size: 30 };
const vf = (args) => args[args.indexOf('-vf') + 1];
const near = (a, b, by = 0.002) => assert.ok(Math.abs(a - b) <= by, `${a} is not near ${b}`);

test('cleanInset keeps an area of the picture and refuses anything else', () => {
  assert.deepEqual(cleanInset({ ...area, x: 0.123456 }), { ...area, x: 0.1235 });
  assert.equal(cleanInset(null), null);
  assert.equal(cleanInset('area'), null);
  assert.equal(cleanInset({ ...area, x: 0.9 }), null, 'runs off the picture');
  assert.equal(cleanInset({ ...area, w: 0.005 }), null, 'too small to be meant');
  assert.equal(cleanInset({ ...area, h: Number.NaN }), null);
});

test('cleanInset keeps the size in range and a window position only when it is on the picture', () => {
  assert.equal(cleanInset({ ...area, size: 500 }).size, INSET_SIZE.max);
  assert.equal(cleanInset({ ...area, size: 1 }).size, INSET_SIZE.min);
  assert.equal(cleanInset({ ...area, size: undefined }).size, INSET_SIZE.normal);
  assert.deepEqual(cleanInset({ ...area, left: 0.1, top: 0.2 }), { ...area, left: 0.1, top: 0.2 });
  assert.deepEqual(cleanInset({ ...area, left: 3, top: 0.2 }), area);
  assert.deepEqual(cleanInset({ ...area, left: null, top: null }), area);
});

test('a corner view saved with a corner (1.82.0) comes up at the bottom right', () => {
  const saved = cleanInset({ ...area, corner: 'br' });
  assert.equal('corner' in saved, false);
  assert.deepEqual(insetBox(saved, W, H), insetBox(area, W, H));
});

test('insetBox gives even pixels, keeping the area’s shape, at the bottom right by default', () => {
  const { crop, place } = insetBox(area, W, H);
  assert.deepEqual(crop, { w: 384, h: 216, x: 960, y: 270 });
  assert.equal(place.border, 4);
  assert.equal(place.w, 576 + 8);
  assert.equal(place.h, 324 + 8);
  assert.ok(place.x > W / 2 && place.x + place.w <= W - 46);
  assert.ok(place.y > H / 2 && place.y + place.h <= H - 42);
  for (const n of [crop.w, crop.h, place.x, place.y, place.w, place.h]) assert.equal(n % 2, 0);
});

test('insetBox goes where it was put, and stays on the picture', () => {
  const at = (left, top) => insetBox({ ...area, left, top }, W, H).place;
  assert.deepEqual([at(0.25, 0.5).x, at(0.25, 0.5).y], [480, 540]);
  assert.deepEqual([at(0, 0).x, at(0, 0).y], [0, 0]);
  const far = at(1, 1);
  assert.ok(far.x + far.w <= W);
  assert.ok(far.y + far.h <= H);
});

test('insetBox narrows a tall area to stay on the picture', () => {
  const { place } = insetBox({ ...area, y: 0, w: 0.1, h: 1, size: 50 }, W, H);
  assert.ok(place.h <= H * 0.9 + 2 * place.border);
  assert.ok(place.w < 300, 'narrower than the size asked for');
});

test('insetBox keeps an area touching the far edges inside an odd-sized picture', () => {
  const { crop } = insetBox({ ...area, x: 0.8, y: 0.8 }, 1921, 1081);
  assert.ok(crop.x + crop.w <= 1921);
  assert.ok(crop.y + crop.h <= 1081);
});

test('insetBox is nothing without a corner view or a known size', () => {
  assert.equal(insetBox(null, W, H), null);
  assert.equal(insetBox(area, null, null), null);
});

test('movedInset moves the window from where it is, and no further than the picture’s edge', () => {
  const before = insetBox(area, W, H).place;
  const moved = insetBox(movedInset(area, -0.25, -0.1, W, H), W, H).place;
  near(moved.x, before.x - 480, 2);
  near(moved.y, before.y - 108, 2);
  const corner = insetBox(movedInset(area, -5, -5, W, H), W, H).place;
  assert.deepEqual([corner.x, corner.y], [0, 0]);
  const other = insetBox(movedInset(area, 5, 5, W, H), W, H).place;
  assert.ok(other.x + other.w <= W && other.y + other.h <= H);
  assert.deepEqual([movedInset(area, 0.1, 0.1, W, H).w, movedInset(area, 0.1, 0.1, W, H).size], [area.w, area.size], 'the area and size stay');
});

test('resizedInset grows from the dragged corner, the opposite one staying put', () => {
  const start = { ...area, left: 0.3, top: 0.3 };
  const before = insetBox(start, W, H).place;
  const se = resizedInset(start, 'se', 0.1, 0, W, H);
  assert.ok(se.size > start.size);
  const after = insetBox(se, W, H).place;
  assert.deepEqual([after.x, after.y], [before.x, before.y]);
  const nw = insetBox(resizedInset(start, 'nw', -0.1, 0, W, H), W, H).place;
  near(nw.x + nw.w, before.x + before.w, 4);
  near(nw.y + nw.h, before.y + before.h, 4);
  assert.ok(nw.w > before.w);
  assert.deepEqual([se.x, se.y, se.w, se.h], [start.x, start.y, start.w, start.h], 'the area stays');
});

test('resizedInset keeps to the size limits and the picture', () => {
  assert.equal(resizedInset(area, 'nw', 2, 2, W, H).size, INSET_SIZE.min);
  const big = resizedInset(area, 'nw', -2, -2, W, H);
  assert.equal(big.size, INSET_SIZE.max);
  const { place } = insetBox(big, W, H);
  assert.ok(place.x >= 0 && place.y >= 0 && place.x + place.w <= W && place.y + place.h <= H);
});

test('zoomedInset changes the area around its middle and leaves the window alone', () => {
  near(zoomOf(area), 1.5, 0.0001);
  const closer = zoomedInset(area, 3);
  near(zoomOf(closer), 3, 0.01);
  near(closer.x + closer.w / 2, area.x + area.w / 2, 0.0002);
  near(closer.y + closer.h / 2, area.y + area.h / 2, 0.0002);
  assert.equal(closer.size, area.size);
  const a = insetBox(area, W, H).place;
  const b = insetBox(closer, W, H).place;
  assert.deepEqual([b.x, b.y, b.w, b.h], [a.x, a.y, a.w, a.h]);
});

test('zoomedInset stops at the picture and at the smallest area', () => {
  const edge = zoomedInset({ ...area, x: 0.8, y: 0.8 }, 0.5);
  assert.ok(edge.x + edge.w <= 1.0001 && edge.y + edge.h <= 1.0001 && edge.x >= 0 && edge.y >= 0);
  const out = zoomedInset({ ...area, w: 0.5, h: 0.5, x: 0.2, y: 0.2, size: 10 }, 0.01);
  assert.ok(out.w <= 1 && out.h <= 1);
  assert.ok(zoomedInset(area, 1000).w >= 0.01);
});

test('insetFilter cuts the area out and lays it over its place', () => {
  const box = { crop: { w: 384, h: 216, x: 960, y: 270 }, place: { x: 1296, y: 706, w: 584, h: 332, border: 4 } };
  assert.equal(insetFilter(box), 'split[main][area];[area]crop=384:216:960:270,scale=576:324:flags=lanczos,setsar=1,pad=584:332:4:4:color=white[view];[main][view]overlay=1296:706');
});

test('partArgs puts the corner view under the scoreboard, after the HDR conversion', () => {
  const inset = insetBox(area, W, H);
  const chain = vf(partArgs({ src: 'm.mp4', start: 5, end: 9, out: 'p.mp4', hdr: true, inset }));
  assert.ok(chain.indexOf('tonemap') < chain.indexOf('split[main]'));
  assert.ok(chain.indexOf('overlay=') < chain.indexOf('overlay.ass'));
  assert.ok(!vf(partArgs({ src: 'm.mp4', start: 5, end: 9, out: 'p.mp4' })).includes('split'));
});

test('partArgs keeps the corner view under a logo too', () => {
  const args = partArgs({ src: 'm.mp4', start: 5, end: 9, out: 'p.mp4', hasAudio: false, logo: { path: 'l.png', width: 100 }, inset: insetBox(area, W, H) });
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.ok(graph.indexOf('[main][view]overlay') < graph.indexOf('[base][logo]overlay'));
});

test('clipArgs takes the corner view, before the scoreboard', () => {
  const chain = vf(clipArgs({ src: 'm.mp4', start: 5, end: 9, out: 'c.mp4', inset: insetBox(area, W, H) }));
  assert.ok(chain.indexOf('[view]overlay') < chain.indexOf('clip.ass'));
});
