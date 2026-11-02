import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chapterLines, chapterMetadata, chapters, concatLine, DEFAULT_CUT, INTERVAL_PAD, joinArgs, outputFps, outputLength, partArgs, plan, toOutput, withBreaks } from '../lib/render.js';
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

test('chapters mark every rally with the score as it starts, at their times in the result', () => {
  // Game 1 to A 21-0, then B wins the first rally of game 2.
  const rallies = Array.from({ length: 22 }, (_, i) => ({ start: i * 20 + 5, end: i * 20 + 15, winner: i < 21 ? 'a' : 'b' }));
  rallies[4].fav = true;
  const { steps } = replay(rallies);
  const parts = plan(rallies, 500, { pre: 2, post: 2, mergeGap: 1 });
  const list = chapters(rallies, steps, parts);
  assert.equal(list.length, 22);
  assert.deepEqual(list.slice(0, 2).map((c) => c.title), ['Game 1 – Rally 1 (0-0)', 'Rally 2 (1-0)']);
  assert.equal(list[4].title, 'Rally 5 (4-0) ★ Highlight');
  assert.equal(list[20].title, 'Rally 21 (20-0)');
  assert.equal(list[21].title, 'Game 2 – Rally 1 (0-0)');
  assert.equal(list[0].at, 0);
  assert.equal(list[11].at, Math.floor(toOutput(rallies[11].start - 1, parts)));
  assert.equal(chapterLines(list, clock).split('\n')[0], '0:00 Game 1 – Rally 1 (0-0)');
  const meta = chapterMetadata(list, 300);
  assert.match(meta, /^;FFMETADATA1\n\[CHAPTER\]\nTIMEBASE=1\/1000\nSTART=0\n/);
  assert.match(meta, /END=300000\ntitle=Game 2 – Rally 1 \(0-0\)\n$/);
});

test('rally chapters stay 10 s long: close rallies share one, a favourite or a new game keeps its own', () => {
  // Rallies 6 s apart in the result: 1 and 2 share, 3 too short after them, and so on.
  const rallies = Array.from({ length: 6 }, (_, i) => ({ start: i * 6 + 2, end: i * 6 + 6, winner: 'a' }));
  const parts = [{ start: 0, end: 40, outStart: 0 }];
  const { steps } = replay(rallies);
  assert.deepEqual(chapters(rallies, steps, parts, { total: 40 }).map((c) => [c.at, c.title]), [
    [0, 'Game 1 – Rallies 1–2 (0-0)'], [13, 'Rallies 3–4 (2-0)'], [25, 'Rallies 5–6 (4-0)'],
  ]);
  // A favourite takes its own chapter: rally 2 folds into rally 1's, and rally 4 (too close to 3) into 3's.
  rallies[2].fav = true;
  assert.deepEqual(chapters(rallies, steps, parts, { total: 40 }).map((c) => [c.at, c.title]), [
    [0, 'Game 1 – Rallies 1–2 (0-0)'], [13, 'Rallies 3–4 (2-0) ★ Highlight: rally 3'], [25, 'Rallies 5–6 (4-0)'],
  ]);
  rallies[3].fav = true;
  assert.deepEqual(chapters(rallies, steps, parts, { total: 40 }).map((c) => c.title),
    ['Game 1 – Rallies 1–2 (0-0)', 'Rallies 3–4 (2-0) ★ Highlight: rallies 3, 4', 'Rallies 5–6 (4-0)']);
  // The last chapter folds into the one before when the video ends within 10 s of it.
  assert.deepEqual(chapters(rallies, steps, parts, { total: 30 }).map((c) => c.title),
    ['Game 1 – Rallies 1–2 (0-0)', 'Rallies 3–6 (2-0) ★ Highlight: rallies 3, 4']);
  // A favourite right after a plain chapter takes over: the plain one folds into the chapter before it.
  const plain = Array.from({ length: 4 }, (_, i) => ({ start: [2, 14, 20, 32][i], end: [8, 18, 24, 36][i], winner: 'a', fav: i === 2 }));
  assert.deepEqual(chapters(plain, replay(plain).steps, parts, { total: 50 }).map((c) => [c.at, c.title]), [
    [0, 'Game 1 – Rallies 1–2 (0-0)'], [19, 'Rally 3 (2-0) ★ Highlight'], [31, 'Rally 4 (3-0)'],
  ]);
});

test('the highlights video has a chapter per favourite rally, without the star', () => {
  const rallies = Array.from({ length: 6 }, (_, i) => ({ start: i * 30 + 5, end: i * 30 + 15, winner: 'b', fav: i % 2 === 0 }));
  const favs = rallies.filter((r) => r.fav);
  const parts = plan(favs, 200, { pre: 2, post: 2, mergeGap: 0 });
  const list = chapters(rallies, replay(rallies).steps, parts, { highlights: true });
  assert.deepEqual(list.map((c) => [c.at, c.title]), [[0, 'Game 1 – Rally 1 (0-0)'], [15, 'Rally 3 (0-2)'], [29, 'Rally 5 (0-4)']]);
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

test('the interval’s break: 4 s kept after the rally reaching it and before the next, the others as set', () => {
  assert.equal(INTERVAL_PAD, 4);
  // A to 11 in a game to 21: rally 11 (index 10) reaches the interval.
  const rallies = Array.from({ length: 13 }, (_, i) => ({ start: i * 20 + (i > 10 ? 60 : 0), end: i * 20 + 10 + (i > 10 ? 60 : 0), winner: 'a' }));
  const { steps } = replay(rallies, { points: 21, cap: 30, bestOf: 3 }, 'a');
  assert.equal(steps[10].event, 'interval');
  const padded = withBreaks(rallies, steps, 4);
  assert.deepEqual([padded[10].post, padded[11].pre, padded[9].post, padded[12].pre], [4, 4, undefined, undefined]);
  assert.equal(rallies[10].post, undefined); // the rallies themselves untouched
  const parts = plan(padded, 1000, { pre: 1.5, post: 1.5, mergeGap: 4 });
  const reaching = parts.find((p) => p.start <= 200 && p.end >= 210);
  const next = parts.find((p) => p.start <= 280 && p.end >= 290);
  assert.equal(reaching.end, 214); // rally 11 ends at 210
  assert.equal(next.start, 276); // rally 12 starts at 280
  assert.equal(parts.at(-1).start, 298.5); // rally 13: the usual 1.5 s
  // Never less than the usual seconds, and 0 turns it off.
  assert.equal(plan(withBreaks(rallies, steps, 1), 1000, { pre: 2, post: 2 }).find((p) => p.start <= 200 && p.end >= 210).end, 212);
  assert.equal(withBreaks(rallies, steps, 0), rallies);
});
