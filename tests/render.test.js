import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chapterLines, chapterMetadata, chapters, concatLine, DEFAULT_CUT, joinArgs, outputFps, outputLength, partArgs, plan, toOutput } from '../lib/render.js';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { replay } from '../public/shared/score.js';
import { clock } from '../public/shared/time.js';

test('plan keeps each rally with some lead-in and run-out, joining close ones', () => {
  const rallies = [{ start: 10, end: 20 }, { start: 24, end: 30 }, { start: 60, end: 70 }, { start: 118, end: 119 }];
  const parts = plan(rallies, 120, { pre: 2, post: 2, mergeGap: 4 });
  assert.deepEqual(parts, [
    { start: 8, end: 32, outStart: 0 },
    { start: 58, end: 72, outStart: 24 },
    { start: 116, end: 120, outStart: 38 },
  ]);
  assert.equal(outputLength(parts), 42);
  assert.equal(toOutput(60, parts), 26);
  assert.equal(toOutput(40, parts), null);
  assert.deepEqual(plan(rallies, 120, { cut: false }), [{ start: 0, end: 120, outStart: 0 }]);
  assert.deepEqual(plan([], 50), [{ start: 0, end: 50, outStart: 0 }]);
});

test('chapters mark each game and its interval, at their times in the result', () => {
  // Game 1 to A 21-0, then B wins the first rally of game 2.
  const rallies = Array.from({ length: 22 }, (_, i) => ({ start: i * 20 + 5, end: i * 20 + 15, winner: i < 21 ? 'a' : 'b' }));
  const { steps } = replay(rallies);
  const parts = plan(rallies, 500, { pre: 2, post: 2, mergeGap: 1 });
  const list = chapters(rallies, steps, parts);
  assert.deepEqual(list.map((c) => c.title), ['Game 1', 'Game 1 – from 11', 'Game 2']);
  assert.equal(list[0].at, 0);
  assert.equal(list[1].at, Math.floor(toOutput(rallies[11].start - 1, parts)));
  assert.equal(chapterLines(list, clock).split('\n')[0], '0:00 Game 1');
  const meta = chapterMetadata(list, 300);
  assert.match(meta, /^;FFMETADATA1\n\[CHAPTER\]\nTIMEBASE=1\/1000\nSTART=0\n/);
  assert.match(meta, /END=300000\ntitle=Game 2\n$/);
});

test('partArgs seeks, shifts time for the scoreboard and encodes every part alike', () => {
  const args = partArgs({ src: 'C:/v/match.mp4', start: 12.5, end: 30, out: 'p1.mp4', encoder: 'h264_nvenc', fps: 60 });
  const vf = args[args.indexOf('-vf') + 1];
  assert.equal(vf, 'setpts=PTS+12.5/TB,ass=overlay.ass:fontsdir=fonts,setpts=PTS-STARTPTS,format=yuv420p'); // the app's own fonts (lib/fonts.js)
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 6), ['-ss', '12.5', '-to', '30', '-i', 'C:/v/match.mp4']);
  assert.ok(args.includes('h264_nvenc'));
  assert.equal(args[args.indexOf('-r') + 1], '60');
  const plain = partArgs({ src: 'a.mp4', start: 0, end: 5, out: 'p.mp4', overlay: false, hasAudio: false, hdr: true });
  const plainVf = plain[plain.indexOf('-vf') + 1];
  assert.match(plainVf, /^zscale=.*tonemap=tonemap=hable.*format=yuv420p$/);
  assert.doesNotMatch(plainVf, /ass=/);
  assert.ok(plain.includes('anullsrc=r=48000:cl=stereo')); // silent audio so every part has a sound track
  assert.ok(plain.includes('libx264'));
});

test('join and concat helpers', () => {
  assert.equal(concatLine("C:\\Videos\\it's.mp4"), "file 'C:/Videos/it'\\''s.mp4'");
  const j = joinArgs({ list: 'parts.txt', chapters: 'ch.txt', out: 'o.mp4' });
  assert.deepEqual(j.slice(j.indexOf('-f')), ['-f', 'concat', '-safe', '0', '-i', 'parts.txt', '-i', 'ch.txt', '-map_metadata', '1', '-map_chapters', '1', '-map', '0', '-c', 'copy', '-movflags', '+faststart', 'o.mp4']);
  assert.deepEqual([outputFps(59.94), outputFps(29.97), outputFps(24), outputFps(120), outputFps(null)], [60, 30, 24, 30, 30]);
});

test('cutting keeps 1.5 s before and after each rally by default, and saved settings moved to it once', () => {
  assert.deepEqual([DEFAULT_CUT.pre, DEFAULT_CUT.post], [1.5, 1.5]);
  assert.deepEqual(plan([{ start: 10, end: 20 }], 100), [{ start: 8.5, end: 21.5, outStart: 0 }]);
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('pre', '2.5'), ('post', '2.5'), ('rallyGap', '5')");
  db.exec(readFileSync(new URL('../migrations/0024_cut_1_5.sql', import.meta.url), 'utf8'));
  assert.deepEqual(db.prepare('SELECT key, value FROM settings ORDER BY key').all().map((r) => [r.key, r.value]), [['post', '1.5'], ['pre', '1.5'], ['rallyGap', '5']]);
});
