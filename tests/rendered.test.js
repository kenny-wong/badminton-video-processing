import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../lib/db.js';
import { saveTournament } from '../lib/tournaments.js';
import { parseMatches } from '../lib/schedule.js';
import { loadMatch } from '../lib/pipeline.js';
import { readSettings } from '../lib/settings.js';
import { outputPath } from '../lib/naming.js';
import { clipOf, deleteRendered, renderedFile, renderedFiles, withSuffix } from '../lib/rendered.js';
import { PAGE } from './fixtures/be-pages.js';

test('a suffix always fits YouTube’s 100 characters, the start of the title giving way', () => {
  assert.equal(withSuffix('Lee v Ho', ' · rally 5'), 'Lee v Ho · rally 5');
  const long = withSuffix('x'.repeat(100), ' · rally 12');
  assert.equal(long.length, 100);
  assert.ok(long.endsWith('… · rally 12'));
});

test('clip file names are recognised for their own match only', () => {
  assert.deepEqual(clipOf('0900 XD U15 - Lee v Ho - rally 5 (upright).mp4', '0900 XD U15 - Lee v Ho'), { rally: 5, upright: true });
  assert.deepEqual(clipOf('0900 XD U15 - Lee v Ho - rally 12.mp4', '0900 XD U15 - Lee v Ho'), { rally: 12, upright: false });
  assert.equal(clipOf('0900 XD U15 - Lee v Ho Wu - rally 5.mp4', '0900 XD U15 - Lee v Ho'), null);
  assert.equal(clipOf('0900 XD U15 - Lee v Ho - rally 5.txt', '0900 XD U15 - Lee v Ho'), null);
});

test('finished files: whole video with its .txt, highlights and rally clips, newest first', () => {
  const db = openDb();
  const out = mkdtempSync(join(tmpdir(), 'rendered-test-'));
  db.prepare("INSERT INTO settings (key, value) VALUES ('outputFolder', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(out));
  const tid = saveTournament(db, { beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });
  const id = db.prepare('SELECT id FROM matches WHERE tournament_id = ? ORDER BY id LIMIT 1').get(tid).id;
  const settings = readSettings(db);
  let loaded = loadMatch(db, id);
  assert.deepEqual(renderedFiles(loaded, settings), []);

  const name = outputPath(loaded);
  const folder = join(out, name[0], name[1]);
  mkdirSync(join(folder, 'Clips'), { recursive: true });
  const video = join(folder, name[2]);
  writeFileSync(video, 'v');
  writeFileSync(video.replace(/\.mp4$/, '.txt'), 'The title\r\n\r\nLine 1\r\nLine 2\r\n');
  const base = name[2].replace(/\.mp4$/, '');
  const clip = join(folder, 'Clips', `${base} - rally 3 (upright).mp4`);
  writeFileSync(clip, 'c');
  writeFileSync(join(folder, 'Clips', 'Someone else - rally 1.mp4'), 'x');
  utimesSync(video, new Date('2026-10-31T10:00:00Z'), new Date('2026-10-31T10:00:00Z'));
  utimesSync(clip, new Date('2026-10-31T11:00:00Z'), new Date('2026-10-31T11:00:00Z'));
  db.prepare('UPDATE matches SET output_path = ? WHERE id = ?').run(video, id);
  loaded = loadMatch(db, id);

  const files = renderedFiles(loaded, settings);
  assert.deepEqual(files.map((f) => [f.key, f.label]), [[`clip:${base} - rally 3 (upright).mp4`, 'Rally 3 clip, upright'], ['video', 'Whole match']]);
  assert.deepEqual([files[1].title, files[1].description], ['The title', 'Line 1\nLine 2']);
  assert.match(files[0].title, / · rally 3$/);
  assert.ok(files[0].title.length <= 100);
  assert.equal(renderedFile(loaded, settings, 'highlights'), null);
  assert.equal(renderedFile(loaded, settings, 'clip:../../secret.mp4'), null);
  assert.equal(renderedFile(loaded, settings, 'video').path, video);

  // A comment typed later goes at the end of every file's description, with no new render.
  db.prepare('UPDATE matches SET comment = ? WHERE id = ?').run('Great comeback in the second game.', id);
  loaded = loadMatch(db, id);
  const commented = renderedFiles(loaded, settings);
  assert.equal(commented.find((f) => f.key === 'video').description, 'Line 1\nLine 2\n\nGreat comeback in the second game.');
  assert.ok(commented.every((f) => f.description.endsWith('Great comeback in the second game.')));
});

test('deleting a finished file: the whole video goes with its .txt and the match forgets it; unknown keys do nothing', async () => {
  const db = openDb();
  const out = mkdtempSync(join(tmpdir(), 'rendered-del-'));
  db.prepare("INSERT INTO settings (key, value) VALUES ('outputFolder', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(out));
  const tid = saveTournament(db, { beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });
  const id = db.prepare('SELECT id FROM matches WHERE tournament_id = ? ORDER BY id LIMIT 1').get(tid).id;
  const settings = readSettings(db);
  const name = outputPath(loadMatch(db, id));
  const folder = join(out, name[0], name[1]);
  mkdirSync(join(folder, 'Clips'), { recursive: true });
  const video = join(folder, name[2]);
  const txt = video.replace(/\.mp4$/, '.txt');
  const clip = join(folder, 'Clips', `${name[2].replace(/\.mp4$/, '')} - rally 2.mp4`);
  for (const f of [video, txt, clip]) writeFileSync(f, 'x');
  db.prepare("UPDATE matches SET output_path = ?, rendered_at = '2026-10-31T10:00:00Z' WHERE id = ?").run(video, id);

  assert.equal(await deleteRendered(db, loadMatch(db, id), settings, 'nothing'), null);
  assert.equal((await deleteRendered(db, loadMatch(db, id), settings, 'video')).kind, 'video');
  assert.ok(!existsSync(video) && !existsSync(txt) && existsSync(clip));
  const row = db.prepare('SELECT output_path, rendered_at FROM matches WHERE id = ?').get(id);
  assert.deepEqual([row.output_path, row.rendered_at], [null, null]);
  await deleteRendered(db, loadMatch(db, id), settings, `clip:${name[2].replace(/\.mp4$/, '')} - rally 2.mp4`);
  assert.ok(!existsSync(clip));
  assert.deepEqual(renderedFiles(loadMatch(db, id), settings), []);
});
