import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanInset, freeCorner, INSET_SIZE, insetBox } from '../public/shared/inset.js';
import { insetFilter, partArgs } from '../lib/render.js';
import { clipArgs } from '../lib/clip.js';

const area = { x: 0.5, y: 0.25, w: 0.2, h: 0.2, corner: 'br', size: 30 };
const vf = (args) => args[args.indexOf('-vf') + 1];

test('cleanInset keeps an area of the picture and refuses anything else', () => {
  assert.deepEqual(cleanInset({ ...area, x: 0.123456 }), { ...area, x: 0.1235 });
  assert.equal(cleanInset(null), null);
  assert.equal(cleanInset('area'), null);
  assert.equal(cleanInset({ ...area, x: 0.9 }), null, 'runs off the picture');
  assert.equal(cleanInset({ ...area, w: 0.01 }), null, 'too small to be meant');
  assert.equal(cleanInset({ ...area, h: Number.NaN }), null);
});

test('cleanInset falls back to a corner and keeps the size in range', () => {
  assert.equal(cleanInset({ ...area, corner: 'middle' }).corner, 'br');
  assert.equal(cleanInset({ ...area, size: 500 }).size, INSET_SIZE.max);
  assert.equal(cleanInset({ ...area, size: 1 }).size, INSET_SIZE.min);
  assert.equal(cleanInset({ ...area, size: undefined }).size, INSET_SIZE.normal);
});

test('freeCorner avoids the scoreboard and the logo', () => {
  assert.equal(freeCorner('tl', null), 'br');
  assert.equal(freeCorner('br', 'tr'), 'bl');
  assert.equal(freeCorner('tl', 'tr', 'bl', 'br'), 'br');
});

test('insetBox gives even pixels, keeping the area’s shape, inside the picture', () => {
  const { crop, place } = insetBox(area, 1920, 1080);
  assert.deepEqual(crop, { w: 384, h: 216, x: 960, y: 270 });
  assert.equal(place.border, 4);
  assert.equal(place.w, 576 + 8);
  assert.equal(place.h, 324 + 8);
  assert.ok(place.x + place.w <= 1920 - 48 + 1);
  assert.ok(place.y + place.h <= 1080 - 42 + 1);
  for (const n of [crop.w, crop.h, place.x, place.y, place.w, place.h]) assert.equal(n % 2, 0);
});

test('insetBox goes in the chosen corner', () => {
  const at = (corner) => insetBox({ ...area, corner }, 1920, 1080).place;
  assert.deepEqual([at('tl').x, at('tl').y], [48, 42]);
  assert.equal(at('tr').y, 42);
  assert.equal(at('bl').x, 48);
  assert.ok(at('tr').x > 960);
  assert.ok(at('bl').y > 540);
});

test('insetBox narrows a tall area to stay on the picture', () => {
  const { place } = insetBox({ ...area, y: 0, w: 0.1, h: 1, size: 50 }, 1920, 1080);
  assert.ok(place.h <= 1080 * 0.6 + 2 * place.border);
  assert.ok(place.w < 300, 'narrower than the size asked for');
});

test('insetBox keeps an area touching the far edges inside an odd-sized picture', () => {
  const { crop } = insetBox({ ...area, x: 0.8, y: 0.8 }, 1921, 1081);
  assert.ok(crop.x + crop.w <= 1921);
  assert.ok(crop.y + crop.h <= 1081);
});

test('insetBox is nothing without a corner view or a known size', () => {
  assert.equal(insetBox(null, 1920, 1080), null);
  assert.equal(insetBox(area, null, null), null);
});

test('insetFilter cuts the area out and lays it over its place', () => {
  const box = { crop: { w: 384, h: 216, x: 960, y: 270 }, place: { x: 1296, y: 706, w: 584, h: 332, border: 4 } };
  assert.equal(insetFilter(box), 'split[main][area];[area]crop=384:216:960:270,scale=576:324:flags=lanczos,setsar=1,pad=584:332:4:4:color=white[view];[main][view]overlay=1296:706');
});

test('partArgs puts the corner view under the scoreboard, after the HDR conversion', () => {
  const inset = insetBox(area, 1920, 1080);
  const chain = vf(partArgs({ src: 'm.mp4', start: 5, end: 9, out: 'p.mp4', hdr: true, inset }));
  assert.ok(chain.indexOf('tonemap') < chain.indexOf('split[main]'));
  assert.ok(chain.indexOf('overlay=') < chain.indexOf('overlay.ass'));
  assert.ok(!vf(partArgs({ src: 'm.mp4', start: 5, end: 9, out: 'p.mp4' })).includes('split'));
});

test('partArgs keeps the corner view under a logo too', () => {
  const args = partArgs({ src: 'm.mp4', start: 5, end: 9, out: 'p.mp4', hasAudio: false, logo: { path: 'l.png', width: 100 }, inset: insetBox(area, 1920, 1080) });
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.ok(graph.indexOf('[main][view]overlay') < graph.indexOf('[base][logo]overlay'));
});

test('clipArgs takes the corner view, before the scoreboard', () => {
  const chain = vf(clipArgs({ src: 'm.mp4', start: 5, end: 9, out: 'c.mp4', inset: insetBox(area, 1920, 1080) }));
  assert.ok(chain.indexOf('[view]overlay') < chain.indexOf('clip.ass'));
});
