import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bannerText, boardFlags, boardHeading, boardLayout, cleanBoard, cleanBoardOverride, DEFAULT_BOARD, PRESETS, resolveBoard } from '../public/shared/board.js';

const state = (points, won = [0, 0], games = [], server = 'a') => ({ points, won, games, server });
const F21 = { points: 21, setting: true, bestOf: 3 };

test('cleanBoard keeps valid choices and falls back to the default for the rest', () => {
  assert.deepEqual(cleanBoard(null), DEFAULT_BOARD);
  const b = cleanBoard({ preset: 'custom', box: '#ABCDEF', text: 'red', font: 'Comic Sans', scale: 500, opacity: 10, corner: 'br', heading: 'full', flags: false });
  assert.equal(b.box, '#abcdef');
  assert.equal(b.text, DEFAULT_BOARD.text);
  assert.equal(b.font, 'Arial');
  assert.equal(b.scale, 160);
  assert.equal(b.opacity, 30);
  assert.equal(b.corner, 'br');
  assert.equal(b.heading, 'full');
  assert.equal(b.flags, false);
  assert.equal(b.banners, true);
});

test('a preset brings its font, and colours sent with it win', () => {
  const b = cleanBoard({ preset: 'navy', box: '#123456' });
  assert.equal(b.box, '#123456');
  assert.equal(b.font, PRESETS.navy.font);
  assert.equal(b.accent, PRESETS.navy.accent);
});

test('a match can choose its own preset and corner over Settings', () => {
  assert.equal(cleanBoardOverride({}), null);
  assert.deepEqual(cleanBoardOverride({ preset: 'contrast', corner: 'xx' }), { preset: 'contrast' });
  const r = resolveBoard({ ...DEFAULT_BOARD, scale: 120 }, { preset: 'contrast', corner: 'tr' });
  assert.equal(r.box, PRESETS.contrast.box);
  assert.equal(r.corner, 'tr');
  assert.equal(r.scale, 120);
});

test('boardFlags marks game point and match point', () => {
  assert.deepEqual(boardFlags(state([20, 15]), F21), ['GAME POINT', null]);
  assert.deepEqual(boardFlags(state([20, 20]), F21), [null, null]); // setting: two clear needed
  assert.deepEqual(boardFlags(state([29, 29]), F21), ['GAME POINT', 'GAME POINT']);
  assert.deepEqual(boardFlags(state([14, 20], [1, 0], [[21, 10]]), F21), [null, 'GAME POINT']);
  assert.deepEqual(boardFlags(state([20, 3], [1, 0], [[21, 10]]), F21), ['MATCH POINT', null]);
  assert.deepEqual(boardFlags(state([10, 14]), { points: 15, setting: true, bestOf: 1 }), [null, 'MATCH POINT']);
});

test('bannerText names the interval, the game and the match', () => {
  const names = ['LEE', 'HO'];
  assert.equal(bannerText({ kind: 'interval', before: state([10, 8]), after: state([11, 8]) }, names, F21), 'INTERVAL');
  assert.equal(bannerText({ kind: 'interval', before: state([10, 8], [1, 1], [[21, 1], [1, 21]]), after: state([11, 8]) }, names, F21), 'INTERVAL · CHANGE ENDS');
  assert.equal(bannerText({ kind: 'game', winner: 'b', before: state([18, 20]), after: state([0, 0], [0, 1], [[18, 21]]) }, names, F21), 'GAME 1 TO HO · 21-18');
  assert.equal(bannerText({ kind: 'match', winner: 'a', before: state([20, 5]), after: state([0, 0], [2, 0], [[21, 3], [21, 5]]) }, names, F21), 'MATCH TO LEE · 21-3 21-5');
  // A game's own video ends its replay as a match; game 1 of three is still only a game.
  assert.equal(bannerText({ kind: 'match', winner: 'a', before: state([20, 5]), after: state([0, 0], [1, 0], [[21, 5]]) }, names, F21), 'GAME 1 TO LEE · 21-5');
});

test('boardLayout puts the board in the chosen corner and shows finished games as columns', () => {
  const names = ['AMY LEE', 'CAT HO'];
  const s = state([5, 3], [1, 0], [[21, 18]], 'b');
  const tl = boardLayout({ width: 1920, height: 1080, names, state: s, style: DEFAULT_BOARD });
  assert.ok(tl.box.x < 100 && tl.box.y < 100);
  const br = boardLayout({ width: 1920, height: 1080, names, state: s, style: { ...DEFAULT_BOARD, corner: 'br' } });
  assert.ok(br.box.x + br.box.w > 1800 && br.box.y + br.box.h > 1000);
  const texts = tl.items.filter((i) => i.type === 'text').map((i) => i.text);
  assert.deepEqual(texts, ['AMY LEE', '21', '5', 'CAT HO', '18', '3']);
  const counts = boardLayout({ width: 1920, height: 1080, names, state: s, style: { ...DEFAULT_BOARD, showGames: false } }).items.filter((i) => i.type === 'text').map((i) => i.text);
  assert.deepEqual(counts, ['AMY LEE', '1', '5', 'CAT HO', '0', '3']);
  const big = boardLayout({ width: 1920, height: 1080, names, state: s, style: { ...DEFAULT_BOARD, scale: 150 } });
  assert.ok(big.box.w > tl.box.w * 1.4);
});

test('boardLayout adds flags beside the row and the banner under the board', () => {
  const names = ['LEE', 'HO'];
  const l = boardLayout({ width: 1280, height: 720, names, state: state([20, 2]), style: DEFAULT_BOARD, flags: ['GAME POINT', null], banner: 'INTERVAL', heading: 'WS U15 · FINAL' });
  const texts = l.items.filter((i) => i.type === 'text');
  const flag = texts.find((t) => t.text === 'GAME POINT');
  assert.ok(flag.x > l.box.x + l.box.w);
  const banner = texts.find((t) => t.text === 'INTERVAL');
  assert.ok(banner.y > l.box.y + l.box.h);
  assert.equal(texts[0].text, 'WS U15 · FINAL');
  const off = boardLayout({ width: 1280, height: 720, names, state: state([20, 2]), style: { ...DEFAULT_BOARD, flags: false, banners: false }, flags: ['GAME POINT', null], banner: 'INTERVAL' });
  assert.ok(!off.items.some((i) => i.text === 'GAME POINT' || i.text === 'INTERVAL'));
});

test('boardHeading follows the chosen style', () => {
  const ctx = { tournament: { name: 'Example Open' }, match: { draw: 'WS U15', round: 'Final', game: 0 } };
  assert.equal(boardHeading(DEFAULT_BOARD, ctx), '');
  assert.equal(boardHeading({ heading: 'round' }, ctx), 'WS U15 · FINAL');
  assert.equal(boardHeading({ heading: 'full' }, { ...ctx, match: { ...ctx.match, game: 2 } }), 'EXAMPLE OPEN · WS U15 · FINAL · GAME 2');
});
