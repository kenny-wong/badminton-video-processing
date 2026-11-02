// Merge and split run end to end through FFmpeg on a made-up 4-second video
// shaped like a Samsung phone's: named at the start of recording, with
// creation_time and the file's modified time at the end, and the phone's own
// udta boxes. Skipped when FFmpeg isn't installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../lib/db.js';
import { findTools, probe, run } from '../lib/ffmpeg.js';
import { saveVideo, scanFolders } from '../lib/videos.js';
import { box, boxes, carryMetadataFile } from '../lib/mp4.js';
import { fileTimes } from '../lib/filetimes.js';
import { mergeVideos, packetCounts, removeOriginals, splitVideo, streamProblems } from '../lib/video-tools.js';
import { splitTime } from '../public/shared/video-files.js';

const tools = findTools('');
const START = Date.UTC(2026, 10, 1, 12, 12, 8);
const END = START + 5000; // the phone stamps the end (4 s of video, saved a second later)

async function makeVideo(dir, name, size = '320x240') {
  const path = join(dir, name);
  await run(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${size}:r=30:d=4`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-c:a', 'aac', '-shortest', '-metadata', `creation_time=${new Date(END).toISOString()}`, path]);
  // The phone's own boxes, which FFmpeg doesn't keep by itself.
  const phone = join(dir, 'phone-boxes.mp4');
  writeFileSync(phone, box('moov', box('udta', box('auth', Buffer.from('Galaxy Z Fold7')), box('smta', Buffer.from('mdlnSM-F9660')))));
  await carryMetadataFile(phone, path);
  rmSync(phone);
  utimesSync(path, new Date(END), new Date(END));
  return path;
}

const udtaOf = (path) => {
  const file = readFileSync(path);
  const moov = boxes(file).find((b) => b.type === 'moov');
  const buf = file.subarray(moov.start, moov.start + moov.size);
  const udta = boxes(buf, 8).find((b) => b.type === 'udta');
  return udta ? boxes(buf, udta.start + 8, udta.start + udta.size).map((b) => b.type) : [];
};

test('a video is split losslessly into parts with their own names and times, and merged back', { skip: !tools && 'FFmpeg not found' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bv-tools-'));
  const db = openDb(':memory:');
  try {
    const src = await makeVideo(dir, '20261101_121208.mp4');
    const id = await saveVideo(db, tools, src);
    const before = await fileTimes(src); // reading it for the library moved its accessed time
    const job = { log: () => {} };
    const binned = []; // stands in for the Recycle Bin, so tests don't fill the real one
    const remove = async (path) => { binned.push(path); rmSync(path); };

    const split = await splitVideo(db, tools, { id, parts: [{ start: 0.5, end: 2 }, { start: 2.5, end: 4 }, { start: null, end: null }], removeOriginal: true, remove, job });
    assert.equal(split.parts.length, 2);
    const [p1, p2] = split.parts;
    assert.equal(p1.from, 0); // key frames every second: the cuts start on them
    assert.ok(Math.abs(p2.from - 2) < 0.01);
    assert.equal(p1.video.name, '20261101_121208 part 1.mp4');
    assert.equal(p2.video.name, '20261101_121210 part 2.mp4');
    assert.equal(p2.video.recordedAt, '2026-11-01T12:12:10Z');
    for (const p of split.parts) {
      const when = { start: START, duration: 4, offset: p.from, length: p.length };
      const t = await fileTimes(p.path);
      assert.ok(Math.abs(t.modified - splitTime(before.modified, when)) < 5, `part ${p.n} modified time`);
      assert.ok(Math.abs(t.accessed - splitTime(before.accessed, when)) < 5, `part ${p.n} accessed time`);
      if (process.platform === 'win32') assert.ok(Math.abs(t.created - splitTime(before.created, when)) < 0.01, `part ${p.n} created time`);
      const ct = Date.parse((await probe(tools, p.path)).format.tags.creation_time);
      assert.ok(Math.abs(ct - splitTime(END, when)) < 1000, `part ${p.n} creation_time`); // whole seconds in the file
      assert.deepEqual(udtaOf(p.path), ['auth', 'smta']);
      assert.deepEqual(p.video.madeFrom, { kind: 'split', from: [{ id, name: '20261101_121208.mp4' }], part: p.n, offset: p.from, length: p.length });
    }
    assert.ok(Math.abs((await fileTimes(p2.path)).modified - END) < 5); // the last part ends where the original did
    assert.deepEqual(split.notes, []);
    assert.deepEqual(split.removed, [{ id, name: '20261101_121208.mp4' }]); // the original went to the bin once both parts were made
    assert.deepEqual(binned, [src]);
    assert.equal(db.prepare('SELECT id FROM videos WHERE id = ?').get(id), undefined);

    const merged = await mergeVideos(db, tools, { ids: [p1.video.id, p2.video.id], job });
    assert.equal(merged.video.name, '20261101_121208 part 1 merged.mp4');
    assert.equal(merged.video.recordedAt, '2026-11-01T12:12:08Z');
    const counts = [await packetCounts(tools, p1.path), await packetCounts(tools, p2.path)];
    assert.deepEqual(merged.packets, counts[0].map((n, i) => n + counts[1][i])); // every frame and piece of sound copied
    assert.deepEqual(merged.notes, []);
    assert.deepEqual(udtaOf(merged.path), ['auth', 'smta']);
    const head = (path) => { const f = readFileSync(path); return f.subarray(0, f.readUInt32BE(0)); };
    assert.deepEqual(head(merged.path), head(p1.path)); // the first video's ftyp
    const mt = await fileTimes(merged.path);
    assert.ok(Math.abs(mt.modified - (await fileTimes(p2.path)).modified) < 5); // ends when the last one ended
    assert.ok(Math.abs(Date.parse((await probe(tools, merged.path)).format.tags.creation_time) - END) < 1000);
    assert.equal(merged.video.madeFrom.kind, 'merge');
    assert.deepEqual(merged.removed, []); // not asked to
    assert.ok(existsSync(p1.path) && existsSync(p2.path));

    const other = await makeVideo(dir, '20261101_130000.mp4', '160x120');
    const otherId = await saveVideo(db, tools, other);
    await assert.rejects(mergeVideos(db, tools, { ids: [merged.video.id, otherId], removeOriginal: true, remove, job }), (err) => err.code === 'notCompatible' && /160×120/.test(err.message));
    await assert.rejects(splitVideo(db, tools, { id: merged.video.id, parts: [{ start: 1, end: 1.2 }], removeOriginal: true, remove, job }), /at least 1 s/);
    assert.ok(existsSync(merged.path) && existsSync(other)); // nothing removed when nothing was made

    const again = await mergeVideos(db, tools, { ids: [p1.video.id, p2.video.id], removeOriginal: true, remove, job });
    assert.deepEqual(again.removed.map((v) => v.name), ['20261101_121208 part 1.mp4', '20261101_121210 part 2.mp4']);
    assert.equal(again.video.name, '20261101_121208 part 1.mp4'); // the first one's name, now it's in the bin
    assert.equal(again.path, p1.path);
    assert.ok(existsSync(p1.path) && !existsSync(p2.path) && !existsSync(join(dir, '20261101_121208 part 1 merged (2).mp4')));
    assert.equal(again.video.madeFrom.kind, 'merge');
    assert.equal(again.video.recordedAt, '2026-11-01T12:12:08Z');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM videos WHERE path = ?').get(p1.path).n, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('originals stay when something went wrong, when linked to a match, or when the bin refuses', async () => {
  const db = openDb(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  const add = (path, matchId = null) => db.prepare('INSERT INTO videos (path, size, modified_at, match_id) VALUES (?, 1, ?, ?) RETURNING id').get(path, '2026-11-01T12:00:00Z', matchId).id;
  const v = (id) => { const { path } = db.prepare('SELECT path FROM videos WHERE id = ?').get(id); return { id, name: path, path }; };
  const binned = [];
  const remove = async (path) => { if (path === 'locked.mp4') throw new Error('in use'); binned.push(path); };
  const a = add('a.mp4');
  assert.deepEqual(await removeOriginals(db, [v(a)], ['Packet counts differ'], { remove }), { removed: [], notes: ['The original videos were kept because of the notes above.'] });
  const linked = add('linked.mp4', 99);
  const locked = add('locked.mp4');
  const r = await removeOriginals(db, [v(a), v(linked), v(locked)], [], { remove });
  assert.deepEqual(r.removed, [{ id: a, name: 'a.mp4' }]);
  assert.match(r.notes[0], /linked\.mp4 was kept: it’s linked to a match/);
  assert.match(r.notes[1], /locked\.mp4 couldn’t be moved to the Recycle Bin: in use/);
  assert.deepEqual(binned, ['a.mp4']);
  assert.deepEqual(db.prepare('SELECT path FROM videos ORDER BY id').all().map((x) => x.path), ['linked.mp4', 'locked.mp4']);
  db.close();
});

test('refreshing from the folders finds new videos and drops the ones that have gone, unless a match uses them', { skip: !tools && 'FFmpeg not found' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bv-scan-'));
  const db = openDb(':memory:');
  try {
    const a = await makeVideo(dir, '20261101_121208.mp4');
    await makeVideo(dir, '20261101_130000.mp4');
    const first = await scanFolders(db, tools, { folders: [dir] });
    assert.deepEqual([first.found, first.added, first.failed, first.missing], [2, 2, 0, 0]);
    // One gone file with nothing on it, one linked to a match, one on a drive that isn't there.
    db.prepare("INSERT INTO tournaments (be_id, name) VALUES ('t', 'T')").run();
    db.prepare("INSERT INTO matches (tournament_id, match_date, match_time, draw, round, team_a, team_b) VALUES (1, '2026-11-01', '09:00', 'WS', 'R1', '[]', '[]')").run();
    const b = await makeVideo(dir, '20261101_140000.mp4');
    await scanFolders(db, tools, { folders: [dir] });
    db.prepare('UPDATE videos SET match_id = 1 WHERE path = ?').run(b);
    db.prepare("INSERT INTO videos (path, size, modified_at) VALUES ('Q:\\nowhere\\x.mp4', 1, '2026-11-01T00:00:00Z')").run();
    rmSync(a);
    rmSync(b);
    const second = await scanFolders(db, tools, { folders: [dir] });
    assert.deepEqual([second.found, second.added, second.removed, second.missing], [1, 0, 1, 2]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM videos WHERE path = ?').get(a).n, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('streams must match, in the same order, to be joined', () => {
  const v = { codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, pix_fmt: 'yuv420p10le' };
  const a = { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 };
  assert.deepEqual(streamProblems([{ streams: [v, a] }, { streams: [v, a] }], ['x', 'y']), []);
  assert.match(streamProblems([{ streams: [v, a] }, { streams: [a, v] }], ['x', 'y'])[0], /y’s stream 1 is aac/);
  assert.match(streamProblems([{ streams: [v, a] }, { streams: [v] }], ['x', 'y'])[0], /y has 1 streams/);
  assert.match(streamProblems([{ streams: [v, a] }, { streams: [v, { ...a, sample_rate: '44100' }] }], ['x', 'y'])[0], /44100 Hz/);
});
