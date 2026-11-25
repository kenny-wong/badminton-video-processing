// A tournament's own video folder: which videos are its, which match each shows, and linking the sure ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../lib/db.js';
import { addFavourite } from '../lib/favourites.js';
import { autoLink, folderOwner, freeVideos, getTournament, suggestLinks } from '../lib/tournament-videos.js';
import { onRequestGet, onRequestPut, unlinkMany } from '../api/tournament-videos.js';
import { scanFolders } from '../lib/videos.js';
import { unlinkByHand } from '../lib/tagging.js';

const FOLDER = 'I:\\Video\\Silver';

function setUp() {
  const db = openDb();
  db.prepare("INSERT INTO tournaments (be_id, name, start_date, end_date, video_folder) VALUES ('t', 'Silver', '2026-10-24', '2026-10-24', ?)").run(FOLDER);
  db.prepare("INSERT INTO tournaments (be_id, name, start_date, end_date, video_folder) VALUES ('u', 'Senior', '2026-10-24', '2026-10-24', 'I:\\Video\\Senior')").run();
  const match = (time, a, b, games, tid = 1) => db.prepare(`INSERT INTO matches (tournament_id, match_date, match_time, starts_at, draw, round, team_a, team_b, games)
    VALUES (?, '2026-10-24', ?, ?, 'WS', ?, ?, ?, ?) RETURNING id`).get(tid, time, `2026-10-24T${time}:00Z`, time + a, JSON.stringify([a]), JSON.stringify([b]), JSON.stringify(games)).id;
  const video = (name, time, duration, folder = FOLDER) => db.prepare('INSERT INTO videos (path, size, modified_at, recorded_at, duration) VALUES (?, 1, ?, ?, ?) RETURNING id')
    .get(`${folder}\\${name}`, 'x', `2026-10-24T${time}:00Z`, duration).id;
  return { db, match, video, t: () => getTournament(db, 1) };
}
const sure = (r) => r.suggestions.filter((s) => s.sure).map((s) => [s.ids[0], s.matchId, s.game]);

test('a tournament’s videos: in its folder, or of its dates and in no other’s folder', () => {
  const { db, video, t } = setUp();
  const own = video('a.mp4', '09:00', 400);
  video('b.mp4', '09:00', 400, 'I:\\Video\\Senior');
  const loose = video('c.mp4', '09:00', 400, 'D:\\Phone');
  db.prepare("INSERT INTO videos (path, size, modified_at, recorded_at, duration) VALUES (?, 1, 'x', '2025-01-01T09:00:00Z', 400)").run(`${FOLDER}\\sub\\clock wrong.mp4`);
  assert.deepEqual(freeVideos(db, t()).map((v) => v.name).sort(), ['a.mp4', 'c.mp4', 'clock wrong.mp4']);
  assert.ok(own && loose);
  const folders = [{ id: 1, folder: 'I:\\Video' }, { id: 2, folder: 'I:\\Video\\Senior' }];
  assert.equal(folderOwner(folders, 'I:\\Video\\Senior\\x.mp4'), 2); // the innermost
  assert.equal(folderOwner(folders, 'I:\\Video\\x.mp4'), 1);
  assert.equal(folderOwner(folders, 'D:\\x.mp4'), null);
  db.close();
});

test('a scan links the sure ones game by game, leaves short clips, and links nothing more the next time', () => {
  const { db, match, video, t } = setUp();
  addFavourite(db, { name: 'Amy Lee' });
  const m1 = match('09:00', 'Amy Lee', 'Bea Ng', [[10, 15], [16, 18]]);
  const m2 = match('11:00', 'Cat Ho', 'Amy Lee', [[15, 5], [15, 6]]);
  const v = [video('1.mp4', '09:05', 350), video('2.mp4', '09:12', 480), video('warm up.mp4', '10:50', 20), video('3.mp4', '11:10', 280), video('4.mp4', '11:16', 300)];
  const r = autoLink(db, t(), { today: '2026-11-01' });
  assert.deepEqual(r.linked.map((l) => [l.videoId, l.parentId, l.game]), [[v[0], m1, 1], [v[1], m1, 2], [v[3], m2, 1], [v[4], m2, 2]]);
  assert.deepEqual([r.unsure, r.short, r.left, r.askWhose], [0, 1, 1, false]);
  assert.deepEqual(autoLink(db, t(), { today: '2026-11-01' }).linked, []);
  // One unlinked by hand stays unlinked, though its game is still suggested.
  unlinkByHand(db, v[4]);
  assert.deepEqual(autoLink(db, t(), { today: '2026-11-01' }).linked, []);
  assert.deepEqual(sure(suggestLinks(db, t(), freeVideos(db, t()))), [[v[4], m2, 2]]); // beside game 1
  // A new video of a match filmed in part goes to its game by itself.
  const late = video('4 copy from the other phone.mp4', '11:16', 300);
  db.prepare('DELETE FROM videos WHERE id = ?').run(v[4]);
  assert.deepEqual(autoLink(db, t()).linked.map((l) => [l.videoId, l.parentId, l.game]), [[late, m2, 2]]);
  db.close();
});

test('only videos in its own folder are linked by themselves, and only to matches without a video', () => {
  const { db, match, video, t } = setUp();
  addFavourite(db, { name: 'Amy Lee' });
  match('09:00', 'Amy Lee', 'Bea Ng', [[21, 10]]);
  const loose = video('a.mp4', '09:05', 430, 'D:\\Phone');
  assert.deepEqual(autoLink(db, t(), { today: '2026-11-01' }).linked, []);
  assert.deepEqual(suggestLinks(db, t(), freeVideos(db, t())).suggestions.map((s) => s.ids[0]), [loose]); // only suggested
  db.close();
});

test('with several starred players, the one whose matches fit is taken; when none stands out, the user is asked', () => {
  const { db, match, video, t } = setUp();
  const amy = addFavourite(db, { name: 'Amy Lee' });
  const bob = addFavourite(db, { name: 'Bob Ray' });
  assert.ok(amy && bob);
  const keys = Object.fromEntries(db.prepare('SELECT name, id FROM favourites').all().map((f) => [f.name, f.id]));
  // Amy's and Bob's matches at the same times; the lengths are Amy's.
  const a = [match('09:00', 'Amy Lee', 'X1', [[15, 5], [15, 14]]), match('10:00', 'Amy Lee', 'X2', [[8, 15], [15, 13]])];
  const b = [match('09:00', 'Bob Ray', 'Y1', [[15, 14], [15, 4]]), match('10:00', 'Bob Ray', 'Y2', [[15, 13], [15, 6]])];
  const v = [video('1.mp4', '09:05', 280), video('2.mp4', '09:11', 400), video('3.mp4', '10:05', 320), video('4.mp4', '10:12', 390)];
  const r = suggestLinks(db, t(), freeVideos(db, t()), { today: '2026-11-01' });
  assert.equal(r.whose, keys['Amy Lee']);
  assert.deepEqual(sure(r), [[v[0], a[0], 1], [v[1], a[0], 2], [v[2], a[1], 1], [v[3], a[1], 2]]);
  // Told it's Bob.
  db.prepare('UPDATE tournaments SET video_player = ? WHERE id = 1').run(String(keys['Bob Ray']));
  const told = suggestLinks(db, t(), freeVideos(db, t()), { today: '2026-11-01' });
  assert.equal(told.whose, keys['Bob Ray']);
  assert.ok(told.suggestions.every((s) => b.includes(s.matchId)));
  // Some of each, filmed in turn: no one stands out.
  db.prepare('UPDATE tournaments SET video_player = NULL WHERE id = 1').run();
  db.exec('DELETE FROM videos');
  const late = match('15:00', 'Bob Ray', 'Y3', [[21, 19]]);
  video('5.mp4', '09:05', 280); video('6.mp4', '09:11', 400);
  video('7.mp4', '15:05', 560);
  const mixed = suggestLinks(db, t(), freeVideos(db, t()), { today: '2026-11-01' });
  assert.deepEqual([mixed.whose, mixed.askWhose, sure(mixed)], [null, true, []]);
  assert.ok(mixed.suggestions.some((s) => s.matchId === late)); // suggested all the same
  db.close();
});

test('a match not played (no score where the day’s others have one) takes no video', () => {
  const { db, match, video, t } = setUp();
  addFavourite(db, { name: 'Amy Lee' });
  match('09:00', 'Amy Lee', 'Bea Ng', []);
  const played = match('09:20', 'Amy Lee', 'Cat Ho', [[21, 10]]);
  const v = video('a.mp4', '09:05', 430);
  assert.deepEqual(suggestLinks(db, t(), freeVideos(db, t()), { today: '2026-11-01' }).suggestions.map((s) => [s.ids[0], s.matchId]), [[v, played]]);
  db.close();
});

test('the API: choosing a folder, whose matches, and undoing links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bv-folder-'));
  const { db, match, video } = setUp();
  try {
    const app = { db, drives: async () => [dir] };
    const put = async (body) => onRequestPut({ params: { id: '1' }, app, request: new Request('http://x/', { method: 'PUT', body: JSON.stringify(body) }) });
    assert.equal((await put({ folder: 'Silver' })).status, 400); // not a whole path
    assert.equal((await put({ folder: 'I:\\' })).status, 400); // a whole drive
    const nowhere = await put({ folder: 'Q:\\nowhere\\at all' });
    assert.match((await nowhere.json()).message, /wasn’t found on any drive/);
    mkdirSync(join(dir, 'Video', 'Silver'), { recursive: true });
    const r = await (await put({ folder: '"Q:\\Video\\Silver\\"' })).json(); // an old letter, pasted with quotes
    assert.equal(r.tournament.videoFolder, join(dir, 'Video', 'Silver'));
    assert.equal((await put({ player: 99 })).status, 400);
    assert.equal((await put({ player: 'all' })).status, 200);
    const m = match('09:00', 'Amy Lee', 'Bea Ng', [[21, 10]]);
    const v = video('a.mp4', '09:05', 430, join(dir, 'Video', 'Silver'));
    db.prepare('UPDATE videos SET match_id = ? WHERE id = ?').run(m, v);
    const page = await (await onRequestGet({ params: { id: '1' }, app })).json();
    assert.deepEqual([page.folder.connected, page.videos[0].inFolder, page.videos[0].match.id, page.tournament.videoPlayer], [true, true, m, 'all']);
    const undo = await unlinkMany({ app, request: new Request('http://x/', { method: 'POST', body: JSON.stringify({ ids: [v] }) }) });
    assert.deepEqual([(await undo.json()).unlinked, db.prepare('SELECT match_id AS m, no_auto AS n FROM videos').get().n], [1, 1]);
    assert.equal((await (await put({ folder: '' })).json()).tournament.videoFolder, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scan takes a known video from its new place with its link, and doesn’t add copies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bv-moved-'));
  const { db, match } = setUp();
  try {
    const put = (...path) => {
      const p = join(dir, ...path);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, Buffer.alloc(9));
      return p;
    };
    const add = (path, matchId = null) => db.prepare('INSERT INTO videos (path, size, modified_at, match_id) VALUES (?, 9, ?, ?) RETURNING id').get(path, 'x', matchId).id;
    const pathOf = (id) => db.prepare('SELECT path, missing FROM videos WHERE id = ?').get(id);
    const m = match('09:00', 'Amy Lee', 'Bea Ng', [[21, 10]]);
    const ssd = join(dir, 'ssd', 'Silver');
    // Linked, its file gone, found in the tournament's folder under the same name and size.
    const gone = add(join(dir, 'old', 'a.mp4'), m);
    const a = put('ssd', 'Silver', 'a.mp4');
    // Still at its old place as well: the tournament's folder is where it's taken from.
    const both = add(put('phone', 'b.mp4'));
    const b = put('ssd', 'Silver', 'b.mp4');
    // A copy in an ordinary folder isn't added again.
    put('phone', 'a.mp4');
    const r = await scanFolders(db, null, { folders: [join(dir, 'phone')], owned: [ssd] });
    assert.deepEqual([r.found, r.moved, r.copies, r.added, r.failed], [4, 2, 2, 0, 0]);
    assert.deepEqual([pathOf(gone).path, pathOf(gone).missing, pathOf(both).path], [a, 0, b]);
    assert.equal(db.prepare('SELECT match_id AS m FROM videos WHERE id = ?').get(gone).m, m);
    // The folder was scanned earlier as its own row: the linked one takes its place.
    const linked = add(join(dir, 'old', 'c.mp4'), m);
    const c = put('ssd', 'Silver', 'c.mp4');
    add(c);
    db.prepare('UPDATE videos SET modified_at = ? WHERE path = ?').run(new Date(statSync(c).mtimeMs).toISOString().replace(/\.\d{3}Z$/, 'Z'), c);
    await scanFolders(db, null, { folders: [], owned: [ssd] });
    assert.equal(pathOf(linked).path, c);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM videos').get().n, 3);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
