import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { FONTS_DIR, fontsFor } from '../lib/fonts.js';
import { assFilter } from '../lib/render.js';
import { BOARD_FONT, DEFAULT_BOARD, FONTS, PRESETS, cleanBoard, fontOf } from '../public/shared/board.js';

/** A font file's sizes: units per em, the Windows ascent + descent (what libass sizes by) and the capital height. */
function metrics(file) {
  const b = readFileSync(file);
  const tables = {};
  for (let i = 0; i < b.readUInt16BE(4); i++) tables[b.toString('latin1', 12 + i * 16, 16 + i * 16)] = b.readUInt32BE(20 + i * 16);
  const os2 = tables['OS/2'];
  return { upm: b.readUInt16BE(tables.head + 18), win: b.readUInt16BE(os2 + 74) + b.readUInt16BE(os2 + 76), cap: b.readInt16BE(os2 + 88) };
}

test('D-DIN Condensed is the broadcast looks’ default lettering, with its licence', async () => {
  assert.equal(BOARD_FONT, 'D-DIN Condensed');
  assert.equal(DEFAULT_BOARD.font, BOARD_FONT);
  for (const k of ['international', 'broadcast', 'navy']) assert.equal(PRESETS[k].font, BOARD_FONT, k);
  assert.equal(cleanBoard({ font: 'D-DIN Condensed' }).font, 'D-DIN Condensed');
  assert.equal(fontOf('Comic Sans'), FONTS.Arial);
  const shipped = await readdir(FONTS_DIR);
  for (const file of FONTS[BOARD_FONT].files) assert.ok(shipped.includes(file), file);
  assert.match(await readFile(join(FONTS_DIR, 'OFL-D-DIN.txt'), 'utf8'), /SIL Open Font License/);
});

test('the font table’s sizes are the font file’s own, so the preview draws text as big as the video', () => {
  for (const file of FONTS[BOARD_FONT].files) {
    const m = metrics(join(FONTS_DIR, file));
    assert.ok(Math.abs(FONTS[BOARD_FONT].em - m.upm / m.win) < 0.002, file);
    assert.ok(Math.abs(FONTS[BOARD_FONT].cap - m.cap / m.win) < 0.002, file);
  }
});

test('each render’s working folder gets the app’s fonts, which the ass filter is pointed at', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bv-fonts-'));
  try {
    await fontsFor(dir);
    await fontsFor(dir); // again: kept
    assert.deepEqual((await readdir(join(dir, 'fonts'))).sort(), [...FONTS[BOARD_FONT].files].sort());
    assert.deepEqual(await readFile(join(dir, 'fonts', 'D-DINCondensed.otf')), await readFile(join(FONTS_DIR, 'D-DINCondensed.otf')));
    assert.equal(assFilter('overlay.ass'), 'ass=overlay.ass:fontsdir=fonts');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a saved broadcast look on the old Bahnschrift moves to D-DIN Condensed once; other fonts stay', () => {
  const sql = readFileSync(new URL('../migrations/0023_board_font.sql', import.meta.url), 'utf8');
  const run = (board) => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare("INSERT INTO settings VALUES ('board', ?)").run(JSON.stringify(board));
    db.exec(sql);
    return JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'board'").get().value);
  };
  const saved = { preset: 'custom', font: 'Bahnschrift', layout: 'international', scale: 60, opacity: 90 };
  assert.deepEqual(run(saved), { ...saved, font: 'D-DIN Condensed' });
  assert.equal(run({ ...saved, layout: 'broadcast' }).font, 'D-DIN Condensed');
  assert.equal(run({ ...saved, layout: 'classic' }).font, 'Bahnschrift');
  assert.equal(run({ ...saved, font: 'Arial' }).font, 'Arial');
});
