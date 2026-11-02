import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bannerText, boardFlags, boardHeading, boardLayout, cleanBoard, cleanBoardOverride, DEFAULT_BOARD, PRESETS, resolveBoard, shuttleShape } from '../public/shared/board.js';

const CLASSIC = { ...DEFAULT_BOARD, preset: 'tv', ...Object.fromEntries(['box', 'text', 'accent', 'pointsText', 'font', 'opacity', 'layout'].map((k) => [k, PRESETS.tv[k]])) };

const state = (points, won = [0, 0], games = [], server = 'a') => ({ points, won, games, server });
const F21 = { points: 21, setting: true, bestOf: 3 };

test('cleanBoard keeps valid choices and falls back to the default for the rest', () => {
  assert.deepEqual(cleanBoard(null), DEFAULT_BOARD);
  const b = cleanBoard({ preset: 'custom', box: '#ABCDEF', text: 'red', font: 'Comic Sans', scale: 500, opacity: 10, corner: 'br', heading: 'full', flags: false });
  assert.equal(b.box, '#abcdef');
  assert.equal(b.text, DEFAULT_BOARD.text);
  assert.equal(b.font, DEFAULT_BOARD.font);
  assert.equal(b.layout, DEFAULT_BOARD.layout);
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
  const tl = boardLayout({ width: 1920, height: 1080, names, state: s, style: CLASSIC });
  assert.ok(tl.box.x < 100 && tl.box.y < 100);
  const br = boardLayout({ width: 1920, height: 1080, names, state: s, style: { ...CLASSIC, corner: 'br' } });
  assert.ok(br.box.x + br.box.w > 1800 && br.box.y + br.box.h > 1000);
  const texts = tl.items.filter((i) => i.type === 'text').map((i) => i.text);
  assert.deepEqual(texts, ['AMY LEE', '21', '5', 'CAT HO', '18', '3']);
  const counts = boardLayout({ width: 1920, height: 1080, names, state: s, style: { ...CLASSIC, showGames: false } }).items.filter((i) => i.type === 'text').map((i) => i.text);
  assert.deepEqual(counts, ['AMY LEE', '1', '5', 'CAT HO', '0', '3']);
  const big = boardLayout({ width: 1920, height: 1080, names, state: s, style: { ...CLASSIC, scale: 150 } });
  assert.ok(big.box.w > tl.box.w * 1.4);
});

test('boardLayout adds flags beside the row and the banner under the board', () => {
  const names = ['LEE', 'HO'];
  const l = boardLayout({ width: 1280, height: 720, names, state: state([20, 2]), style: CLASSIC, flags: ['GAME POINT', null], banner: 'INTERVAL', heading: 'WS U15 · FINAL' });
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

test('the broadcast look is the default: narrow lettering, a shuttle by the server, lines, games at full strength', () => {
  assert.equal(DEFAULT_BOARD.preset, 'broadcast');
  assert.equal(DEFAULT_BOARD.layout, 'broadcast');
  const s = state([5, 3], [1, 0], [[21, 18]], 'b');
  const l = boardLayout({ width: 1920, height: 1080, names: ['AMY LEE', 'CAT HO'], state: s, style: DEFAULT_BOARD });
  const texts = l.items.filter((i) => i.type === 'text');
  assert.ok(texts.every((t) => t.stretch === 100 && !t.shadow)); // D-DIN Condensed is narrow already
  const wider = boardLayout({ width: 1920, height: 1080, names: ['AMY LEE', 'CAT HO'], state: s, style: { ...DEFAULT_BOARD, preset: 'custom', font: 'Bahnschrift' } });
  assert.ok(wider.items.filter((i) => i.type === 'text').every((t) => t.stretch === 84)); // a wider font is squeezed, as on TV
  assert.ok(texts.filter((t) => t.text === '21' || t.text === '18').every((t) => t.opacity === 1 && t.bold)); // the loser's score isn't dimmed
  const polys = l.items.filter((i) => i.type === 'poly');
  assert.equal(polys.length, 2); // skirt and cork
  const nameB = texts.find((t) => t.text === 'CAT HO');
  assert.ok(polys.every((p) => p.points.every(([x, y]) => x > nameB.x && Math.abs(y - nameB.y) < 30))); // after B's name, on B's row
  const lines = l.items.filter((i) => i.type === 'rect' && i.opacity === 0.14);
  assert.equal(lines.length, 2); // between the rows, and before game 1's column
  assert.equal(l.items[0].colour, '#000000'); // the shadow under the box
  // The classic layout keeps the dot before the name and dims the loser's game scores.
  const c = boardLayout({ width: 1920, height: 1080, names: ['AMY LEE', 'CAT HO'], state: s, style: CLASSIC });
  assert.ok(!c.items.some((i) => i.type === 'poly'));
  assert.equal(c.items.find((i) => i.text === '18').opacity, 0.55);
});

test('the shuttle icon is a skirt and an eight-sided cork, cork down-left', () => {
  const [skirt, cork] = shuttleShape(100, 100, 40);
  assert.equal(skirt.points.length, 4);
  assert.equal(cork.points.length, 8);
  const mid = (pts) => pts.reduce(([sx, sy], [x, y]) => [sx + x / pts.length, sy + y / pts.length], [0, 0]);
  const [cx, cy] = mid(cork.points);
  const [sx, sy] = mid(skirt.points);
  assert.ok(cx < sx && cy > sy);
});

test('a board left on the old default moves to the broadcast look; a chosen one stays', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../migrations/0010_broadcast_default.sql', import.meta.url), 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  const old = { preset: 'tv', ...Object.fromEntries(['box', 'text', 'accent', 'pointsText', 'font', 'opacity'].map((k) => [k, PRESETS.tv[k]])), corner: 'tr', scale: 100 };
  db.prepare("INSERT INTO settings VALUES ('board', ?)").run(JSON.stringify(old));
  db.exec(sql);
  const moved = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'board'").get().value);
  assert.deepEqual([moved.preset, moved.layout, moved.font, moved.scale, moved.corner], ['broadcast', 'broadcast', 'Bahnschrift', 80, 'tr']);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'board'").run(JSON.stringify({ ...old, accent: '#ff0000' }));
  db.exec(sql);
  assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'board'").get().value).preset, 'tv');
});
