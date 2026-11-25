// Finding folders and videos on another drive. Ordinary folders stand in for the drives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFile, findFolder, inFolder, nameFit, onDrive, tailOf, tournamentFolders } from '../lib/locate.js';
import { openDb } from '../lib/db.js';
import { checkLibrary, relocate } from '../lib/videos.js';

async function withDrives(work) {
  const root = mkdtempSync(join(tmpdir(), 'bv-drives-'));
  const a = join(root, 'a');
  const b = join(root, 'b');
  mkdirSync(a);
  mkdirSync(b);
  const put = (drive, path, bytes = 5) => {
    mkdirSync(join(drive, path, '..'), { recursive: true });
    writeFileSync(join(drive, path), Buffer.alloc(bytes));
  };
  try {
    await work({ a, b, drives: [a, b], put });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('paths: the part after the drive, being inside a folder, being on a drive that is there', () => {
  assert.equal(tailOf('I:\\Badminton Video\\Silver'), 'Badminton Video\\Silver');
  assert.equal(tailOf('\\\\nas\\videos'), null);
  assert.ok(inFolder('I:/Badminton Video/Silver/a.mp4', 'i:\\badminton video\\silver\\'));
  assert.ok(!inFolder('I:\\Silver 2\\a.mp4', 'I:\\Silver'));
  assert.ok(!inFolder('I:\\Silver\\a.mp4', null));
  assert.ok(onDrive('i:\\x', ['C:\\', 'I:\\']));
  assert.ok(!onDrive('J:\\x', ['C:\\', 'I:\\']));
  assert.ok(onDrive('\\\\nas\\videos', ['C:\\']));
});

test('a folder whose drive letter changed is found at the same path on another drive', () => withDrives(async ({ a, b, drives, put }) => {
  put(b, 'Badminton Video/Silver/x.mp4');
  assert.equal(await findFolder('Q:\\Badminton Video\\Silver', drives), join(b, 'Badminton Video', 'Silver'));
  // Two drives have it: the one with the known videos.
  put(a, 'Badminton Video/Silver/other.mp4');
  assert.equal(await findFolder('Q:\\Badminton Video\\Silver', drives, { files: [{ tail: 'x.mp4', size: 5 }] }), join(b, 'Badminton Video', 'Silver'));
  assert.equal(await findFolder('Q:\\Badminton Video\\Gold', drives), null);
  assert.equal(await findFolder(join(a, 'Badminton Video', 'Silver'), drives), join(a, 'Badminton Video', 'Silver')); // still there
}));

test('else by its name, when it holds a known video or is the only one', () => withDrives(async ({ a, b, drives, put }) => {
  put(b, 'Videos/Silver/x.mp4');
  assert.equal(await findFolder('Q:\\Old place\\Silver', drives, { quick: true }), null);
  assert.equal(await findFolder('Q:\\Old place\\Silver', drives), join(b, 'Videos', 'Silver'));
  assert.equal(await findFolder('Q:\\Old place\\Silver', drives, { files: [{ tail: 'y.mp4', size: 5 }] }), null); // none of its videos
  put(a, 'Silver/z.mp4');
  assert.equal(await findFolder('Q:\\Old place\\Silver', drives), null); // two alike, nothing to tell them apart
  assert.equal(await findFolder('Q:\\Old place\\Silver', drives, { files: [{ tail: 'x.mp4', size: 5 }] }), join(b, 'Videos', 'Silver'));
}));

test('a missing file is found by its path and size', () => withDrives(async ({ b, drives, put }) => {
  put(b, 'V/x.mp4', 7);
  assert.equal(await findFile('Q:\\V\\x.mp4', 7, drives), join(b, 'V', 'x.mp4'));
  assert.equal(await findFile('Q:\\V\\x.mp4', 8, drives), null);
}));

test('a folder’s name fits a tournament by its date and words', () => {
  const t = { name: 'Copy of Valley U15 Silver Sept', start: '2026-09-27' };
  assert.ok(nameFit('20260927 Valley U15 Silver Sept', t) > 0.9);
  assert.ok(nameFit('2026-09-27', t) > 0);
  assert.equal(nameFit('20260927 County training', t), 0); // the same day, something else
  assert.equal(nameFit('20260101 Valley U15 Silver Sept', t), 0); // another day
  assert.ok(nameFit('Valley U15 Silver Sept', t) > 0);
  assert.equal(nameFit('Holiday', t), 0);
});

test('a tournament’s folder is looked for at the top of every drive and one folder down', () => withDrives(async ({ a, b, drives, put }) => {
  put(b, 'Badminton Video/20261024 Valley U15 Bronze/x.mp4');
  put(b, 'Badminton Video/20261024 Town Senior Tier 4/x.mp4');
  put(a, '20261024/x.mp4');
  const list = await tournamentFolders({ name: 'Valley U15 Bronze', start: '2026-10-24' }, drives);
  assert.deepEqual(list.map((f) => f.path), [join(b, 'Badminton Video', '20261024 Valley U15 Bronze'), join(a, '20261024')]);
  assert.deepEqual((await tournamentFolders({ name: 'Valley U15 Bronze', start: '2026-10-24' }, drives, { except: [join(b, 'Badminton Video')] })).map((f) => f.path), [join(a, '20261024')]);
}));

test('when the drives change, videos and tournaments’ folders follow, or are missing until they’re back', () => withDrives(async ({ a, b, put }) => {
  const db = openDb();
  db.prepare("INSERT INTO tournaments (be_id, name, video_folder) VALUES ('t', 'T', 'Q:\\V\\Silver')").run();
  db.prepare("INSERT INTO videos (path, size, modified_at) VALUES ('Q:\\V\\Silver\\x.mp4', 5, 'x'), ('Q:\\V\\Silver\\gone.mp4', 5, 'x')").run();
  // A row made when the folder was scanned under its new letter, before the old one was known to have moved.
  db.prepare('INSERT INTO videos (path, size, modified_at) VALUES (?, 5, ?)').run(join(b, 'V', 'Silver', 'x.mp4'), 'x');
  let drives = [a];
  const app = { db, drives: async () => drives };
  assert.deepEqual(await checkLibrary(app), { moved: 0, missing: 3, folders: 0 }); // not connected
  assert.equal(await checkLibrary(app), null); // nothing changed: nothing is looked for
  put(b, 'V/Silver/x.mp4');
  drives = [a, b];
  const r = await checkLibrary(app);
  assert.deepEqual([r.folders, db.prepare('SELECT video_folder AS f FROM tournaments').get().f], [1, join(b, 'V', 'Silver')]);
  assert.deepEqual(db.prepare('SELECT path, missing FROM videos ORDER BY missing').all().map((v) => ({ ...v })), [
    { path: join(b, 'V', 'Silver', 'x.mp4'), missing: 0 }, { path: 'Q:\\V\\Silver\\gone.mp4', missing: 1 },
  ]);
  rmSync(join(b, 'V'), { recursive: true });
  assert.equal((await relocate(db, drives)).missing, 2);
  db.close();
}));
