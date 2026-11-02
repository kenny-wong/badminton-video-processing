import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { cardScript, cleanCards, DEFAULT_CARDS, endLines, titleLines } from '../lib/cards.js';
import { cardArgs, logoFilter, logoPosition, partArgs } from '../lib/render.js';
import { cleanLogo, cleanSettings, DEFAULTS, readSettings } from '../lib/settings.js';
import { migrate, openDb } from '../lib/db.js';
import { imageKind } from '../api/settings.js';
import { DEFAULT_BOARD } from '../public/shared/board.js';

const tournament = { name: 'Example Open' };
const match = { date: '2026-10-24', draw: 'WS U15', round: 'Final', game: 0, teamA: ['Amy Lee'], teamB: ['Cat Ho'] };

test('cleanCards keeps on/off and a sensible length', () => {
  assert.deepEqual(cleanCards(null), DEFAULT_CARDS);
  assert.deepEqual(cleanCards({ title: false, end: 'yes', seconds: 30, stats: true }), { title: false, end: true, seconds: 8, stats: true });
});

test('title and end cards are on by default, and saved settings that had them off are turned on once', () => {
  assert.deepEqual([DEFAULT_CARDS.title, DEFAULT_CARDS.end], [true, true]);
  assert.deepEqual([readSettings(openDb()).cards.title, readSettings(openDb()).cards.end], [true, true]);
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x < '0019').sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  db.exec('PRAGMA user_version = 18');
  db.prepare("INSERT INTO settings (key, value) VALUES ('cards', ?)").run(JSON.stringify({ title: false, end: false, seconds: 5, stats: true }));
  migrate(db);
  assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'cards'").get().value), { title: true, end: true, seconds: 5, stats: true });
});

test('the title card names the event and both sides', () => {
  const lines = titleLines({ tournament, match }).map((l) => l.text);
  assert.deepEqual(lines, ['EXAMPLE OPEN · SAT 24 OCT 2026', 'WS U15 · FINAL', 'AMY LEE', 'v', 'CAT HO']);
  assert.equal(titleLines({ tournament, match, highlights: true }).at(-1).text, '★ HIGHLIGHTS');
});

test('the end card says who won and the score from their side', () => {
  const lines = endLines({ tournament, match, games: [[18, 21], [21, 15], [19, 21]] }).map((l) => l.text);
  assert.deepEqual(lines, ['RESULT', 'CAT HO WINS', '21-18 15-21 21-19', 'v AMY LEE', 'WS U15 · FINAL · EXAMPLE OPEN']);
  const game2 = endLines({ tournament, match: { ...match, game: 2, teamA: ['Amy Lee', 'Ben Ng'], teamB: ['Cat Ho', 'Dee Wu'] }, games: [[18, 21], [21, 15]] }).map((l) => l.text);
  assert.deepEqual(game2.slice(0, 3), ['GAME 2', 'AMY LEE / BEN NG WIN', '21-15']);
  assert.equal(endLines({ tournament, match, games: [] })[1].text, 'AMY LEE v CAT HO');
  // Tagging that stops mid-game names no winner; an official winner (a retirement) is believed.
  assert.equal(endLines({ tournament, match, games: [[8, 4]] })[1].text, 'AMY LEE v CAT HO');
  assert.equal(endLines({ tournament, match: { ...match, winner: 2 }, games: [[8, 4]] })[1].text, 'CAT HO WINS');
});

test('cardScript centres each line in the board colours', () => {
  const ass = cardScript({ width: 1920, height: 1080, style: DEFAULT_BOARD, lines: titleLines({ tournament, match }) });
  assert.match(ass, /PlayResX: 1920/);
  const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(events.length, 5);
  assert.ok(events.every((l) => l.includes('\\an5\\pos(960,')));
  const ys = events.map((l) => Number(/\\pos\(960,(\d+)\)/.exec(l)[1]));
  assert.deepEqual([...ys].sort((a, b) => a - b), ys); // top to bottom
  assert.ok(ys[0] > 200 && ys.at(-1) < 880);
});

test('cardArgs makes a silent clip of the board colour, encoded like the parts', () => {
  const a = cardArgs({ out: 't.mp4', width: 1280, height: 720, fps: 60, seconds: 3, colour: '#0f3b2d', encoder: 'h264_nvenc', ass: 'title.ass' });
  assert.ok(a.includes('color=c=0x0f3b2d:s=1280x720:r=60:d=3'));
  assert.ok(a.includes('anullsrc=r=48000:cl=stereo'));
  assert.match(a[a.indexOf('-vf') + 1], /^ass=title\.ass,fade=t=in:st=0:d=0\.4,fade=t=out:st=2\.6:d=0\.4,format=yuv420p$/);
  assert.equal(a[a.indexOf('-video_track_timescale') + 1], '90000');
  assert.ok(a.includes('h264_nvenc'));
});

test('a logo goes into a corner, scaled and faded, after the scoreboard', () => {
  assert.equal(logoFilter({ width: 230.4, opacity: 0.9 }), '[1:v]scale=230:-1,format=rgba,colorchannelmixer=aa=0.9[logo]');
  assert.equal(logoPosition('tr'), 'x=main_w-overlay_w-main_w*0.025:y=main_h*0.04');
  assert.equal(logoPosition('bl'), 'x=main_w*0.025:y=main_h-overlay_h-main_h*0.04');
  const args = partArgs({ src: 'm.mp4', start: 5, end: 9, out: 'p.mp4', hasAudio: false, logo: { path: 'C:/data/logo.png', width: 200, corner: 'tr', opacity: 1 } });
  assert.ok(!args.includes('-vf'));
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /^\[0:v\]setpts=PTS\+5\/TB,ass=overlay\.ass,setpts=PTS-STARTPTS\[base\];\[1:v\]scale=200:-1.*\[base\]\[logo\]overlay=x=.*:eof_action=repeat,format=yuv420p\[v\]$/);
  assert.equal(args[args.indexOf('[v]') - 1], '-map');
  assert.ok(args.includes('2:a:0')); // the silent sound is the third input
  const plain = partArgs({ src: 'm.mp4', start: 0, end: 4, out: 'p.mp4', overlay: false, logo: { path: 'l.png', width: 100 } });
  assert.match(plain[plain.indexOf('-filter_complex') + 1], /^\[0:v\]null\[base\]/);
});

test('logo and card settings are cleaned; the logo file is only set by the upload', () => {
  assert.deepEqual(cleanLogo({ corner: 'bl', size: 99, opacity: 5, file: 'C:/x.png' }), { file: '', corner: 'bl', size: 40, opacity: 20 });
  const s = cleanSettings({ logo: { corner: 'br', file: 'C:/evil.png' }, cards: { title: true } }, { ...DEFAULTS, logo: { ...DEFAULTS.logo, file: 'C:/data/logo.png' } });
  assert.equal(s.logo.file, 'C:/data/logo.png');
  assert.equal(s.logo.corner, 'br');
  assert.equal(s.cards.title, true);
});

test('only PNG and JPEG files are taken as logos', () => {
  assert.equal(imageKind(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'png');
  assert.equal(imageKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageKind(Uint8Array.from([0x3c, 0x73, 0x76, 0x67])), null); // <svg
});

test('the logo upload keeps the picture in the data folder and serves it', async () => {
  const { createApp } = await import('../server.js');
  const { openDb } = await import('../lib/db.js');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dataDir = await mkdtemp(join(tmpdir(), 'bv-logo-'));
  const app = { db: openDb(), port: 0, dataDir };
  const server = createApp(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  app.port = server.address().port;
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const bad = await fetch(`${base}/api/settings/logo`, { method: 'PUT', headers: { Origin: base }, body: 'not a picture' });
    assert.equal(bad.status, 400);
    const put = await (await fetch(`${base}/api/settings/logo`, { method: 'PUT', headers: { Origin: base, 'Content-Type': 'image/png' }, body: png })).json();
    assert.equal(put.settings.logo.file, join(dataDir, 'logo.png'));
    const got = await fetch(`${base}/media/logo`);
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.equal((await got.arrayBuffer()).byteLength, png.length);
    const del = await (await fetch(`${base}/api/settings/logo`, { method: 'DELETE', headers: { Origin: base } })).json();
    assert.equal(del.settings.logo.file, '');
    assert.equal((await fetch(`${base}/media/logo`)).status, 404);
  } finally {
    server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
