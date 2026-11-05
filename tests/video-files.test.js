import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanParts, markerOf, mergedName, mergeProblems, mergeTime, overlaps, parseTime, shiftNameTime, snapStart, splitName, splitTime, timeText,
  reRendered,
} from '../public/shared/video-files.js';

const START = Date.UTC(2026, 10, 1, 12, 12, 8); // recording started 12:12:08
const D = 300; // and lasted 5 minutes

test('a timestamp marks the start or the end of recording, whichever it is nearer', () => {
  assert.equal(markerOf(START + 2000, START, D), 'start');
  assert.equal(markerOf(START + 299_000, START, D), 'end');
  assert.equal(markerOf(START + 9 * 3600_000, START, D), 'end'); // copied to the PC hours later
  assert.equal(markerOf(START, null, D), 'start');
});

test('a part moves start times on by its offset and end times back by what follows it', () => {
  const part = { start: START, duration: D, offset: 60, length: 100 };
  assert.equal(splitTime(START, part), START + 60_000);
  const end = START + D * 1000;
  assert.equal(splitTime(end, part), START + 160_000); // the part ends 160 s in
  assert.equal(splitTime(end + 5000, part), START + 165_000); // Samsung's creation_time, 5 s after the end, stays 5 s after
  assert.equal(splitTime(NaN, part), null);
});

test('a merged file keeps the first video’s start times and the last one’s end times', () => {
  const when = { start: START, duration: D, total: 900 };
  assert.equal(mergeTime(START, START + 600_000, when), START);
  const lastEnd = START + 1_000_000;
  assert.equal(mergeTime(START + D * 1000, lastEnd, when), lastEnd);
  assert.equal(mergeTime(START + D * 1000, null, when), START + 900_000);
  assert.equal(mergeTime(null, lastEnd, when), lastEnd);
});

test('a lossless cut starts at the last key frame at or before the chosen time', () => {
  const keys = [0, 1.1, 2.2, 3.3];
  assert.equal(snapStart(keys, 2.9), 2.2);
  assert.equal(snapStart(keys, 2.2), 2.2);
  assert.equal(snapStart(keys, 2.1999), 2.2); // a hair before it counts as on it
  assert.equal(snapStart(keys, 0.5), 0);
  assert.equal(snapStart([], 7), 0);
});

test('parts: up to three, each with a start and an end at least a second apart', () => {
  const ok = cleanParts([{ start: 0, end: 10 }, { start: null, end: null }, { start: 20, end: 30 }], 60);
  assert.deepEqual(ok, { parts: [{ n: 1, start: 0, end: 10 }, { n: 3, start: 20, end: 30 }], problems: [] });
  assert.match(cleanParts([{ start: 5, end: null }], 60).problems[0], /Part 1 needs a start and an end/);
  assert.match(cleanParts([{ start: 5, end: 5.5 }], 60).problems[0], /at least 1 s/);
  assert.match(cleanParts([{ start: 5, end: 99 }], 60).problems[0], /past the end/);
  assert.equal(cleanParts([{ start: 5, end: 60.3 }], 60).parts[0].end, 60); // a little past the end is the end
  assert.match(cleanParts([], 60).problems[0], /at least one part/);
  assert.equal(cleanParts(new Array(5).fill({ start: 0, end: 5 }), 60).parts.length, 3);
});

test('overlapping parts are named', () => {
  assert.deepEqual(overlaps([{ n: 1, start: 0, end: 10 }, { n: 2, start: 9, end: 20 }, { n: 3, start: 20, end: 30 }]), ['1 and 2']);
});

test('the time in a phone’s file name moves with the part', () => {
  assert.equal(shiftNameTime('20261101_121214.mp4', 95_200), '20261101_121349.mp4');
  assert.equal(shiftNameTime('VID_20261024_235930.mp4', 45_000), 'VID_20261025_000015.mp4'); // over midnight
  assert.equal(shiftNameTime('vid-20260927-100248-90.mp4', 60_000), 'vid-20260927-100348-90.mp4');
  assert.equal(shiftNameTime('PXL_20261024_081233123.mp4', 1_500), 'PXL_20261024_081234623.mp4');
  assert.equal(shiftNameTime('IMG_1234.MOV', 60_000), 'IMG_1234.MOV');
  assert.equal(splitName('20261101_121214.mp4', 95.2, 2), '20261101_121349 part 2.mp4');
  assert.equal(splitName('IMG_1234.MOV', 95.2, 1), 'IMG_1234 part 1.MOV');
  assert.equal(mergedName('20261101_121214.mp4'), '20261101_121214 merged.mp4');
});

test('videos can be merged only when their picture and sound are alike', () => {
  const v = (id, extra = {}) => ({ id, name: `v${id}.mp4`, codec: 'hevc', width: 1920, height: 1080, fps: 30, hasAudio: true, hdr: true, missing: false, ...extra });
  assert.deepEqual(mergeProblems([v(1), v(2, { fps: 29.97 })]), []);
  assert.match(mergeProblems([v(1)])[0], /at least two/);
  assert.match(mergeProblems([v(1), v(2, { codec: 'h264' })])[0], /v2.mp4 is h264/);
  assert.match(mergeProblems([v(1), v(2, { width: 1080, height: 1920 })])[0], /1080×1920/);
  assert.match(mergeProblems([v(1), v(2, { fps: 60 })])[0], /60 fps/);
  assert.match(mergeProblems([v(1), v(2, { hasAudio: false })])[0], /v1.mp4 has sound/);
  assert.match(mergeProblems([v(1), v(1)]).at(-1), /twice/);
});

test('times are shown to the hundredth and typed in several ways', () => {
  assert.equal(timeText(62.4), '1:02.40');
  assert.equal(timeText(3723.456), '1:02:03.45');
  assert.equal(parseTime('1:02.4'), 62.4);
  assert.equal(parseTime('62.4'), 62.4);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime(timeText(95.27)), 95.27);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(''), null);
});

test('reRendered: on YouTube and rendered since', () => {
  const u = { outputPath: 'x.mp4', youtubeUrl: 'https://youtu.be/x', uploadedAt: '2026-11-04T23:27:05Z', renderedAt: '2026-11-05T00:24:49Z' };
  assert.equal(reRendered(u), true);
  assert.equal(reRendered({ ...u, uploadedAt: '2026-11-05T01:00:00Z' }), false); // replaced since
  assert.equal(reRendered({ ...u, renderedAt: u.uploadedAt }), false);
  assert.equal(reRendered({ ...u, youtubeUrl: null }), false); // nothing on YouTube to replace
  assert.equal(reRendered({ ...u, outputPath: null }), false); // the render was deleted
  assert.equal(reRendered({ ...u, uploadedAt: null }), false);
});
