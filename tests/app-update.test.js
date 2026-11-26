import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, createUpdater, installerArgs, installerEnv, readOffer, tidyUpdates, updatesFolder } from '../lib/app-update.js';
import { updatedSince } from '../public/shared/version.js';

const scratch = () => mkdtempSync(join(tmpdir(), 'bv-update-'));
const quiet = { log() {}, error() {} };

/** An updates folder offering `version`, its "installer" holding `bytes`. */
function offerIn(dir, version, { bytes = `installer ${version}`, ...over } = {}) {
  const file = `Badminton-Video-Setup-${version}.exe`;
  writeFileSync(join(dir, file), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(dir, 'latest.json'), JSON.stringify({ version, file, size: Buffer.byteLength(bytes), sha256, notes: ['A new thing.'], ...over }));
  return join(dir, file);
}

test('the updates folder is in the app’s own folder, unless set', () => {
  assert.equal(updatesFolder({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }), join('C:\\Users\\x\\AppData\\Local', 'Badminton Video', 'updates'));
  assert.equal(updatesFolder({ BADMINTON_VIDEO_UPDATES: 'D:\\u', LOCALAPPDATA: 'C:\\x' }), 'D:\\u');
  assert.equal(updatesFolder({}), null);
});

test('a newer, whole installer is offered with its notes', async () => {
  const dir = scratch();
  const path = offerIn(dir, '1.101.0');
  assert.deepEqual(await readOffer(dir, '1.100.0'), { version: '1.101.0', path, size: 17, notes: ['A new thing.'] });
  assert.equal(await readOffer(dir, '1.101.0'), null, 'the same version');
  assert.equal(await readOffer(dir, '1.102.0'), null, 'an older one');
  assert.equal(await readOffer(scratch(), '1.0.0'), null, 'nothing there');
});

test('a half-copied or different installer isn’t offered', async () => {
  const dir = scratch();
  offerIn(dir, '1.101.0', { size: 999 });
  assert.equal(await readOffer(dir, '1.100.0'), null, 'wrong size');
  offerIn(dir, '1.101.0', { sha256: 'a'.repeat(64) });
  assert.equal(await readOffer(dir, '1.100.0'), null, 'wrong hash');
  offerIn(dir, '1.101.0', { file: '..\\Badminton-Video-Setup-1.101.0.exe' });
  assert.equal(await readOffer(dir, '1.100.0'), null, 'a path, not a name');
  offerIn(dir, '1.101.0', { file: 'other.exe' });
  assert.equal(await readOffer(dir, '1.100.0'), null, 'not an installer’s name');
  offerIn(dir, '1.101.0', { version: '1.102.0' });
  assert.equal(await readOffer(dir, '1.100.0'), null, 'name and version differ');
  writeFileSync(join(dir, 'latest.json'), '{ not json');
  assert.equal(await readOffer(dir, '1.100.0'), null);
});

test('installers of this version or older are tidied away, with their latest.json', async () => {
  const dir = scratch();
  writeFileSync(join(dir, 'Badminton-Video-Setup-1.99.0.exe'), 'x');
  offerIn(dir, '1.100.0');
  writeFileSync(join(dir, 'notes.txt'), 'kept');
  assert.deepEqual((await tidyUpdates(dir, '1.100.0')).sort(), ['Badminton-Video-Setup-1.100.0.exe', 'Badminton-Video-Setup-1.99.0.exe']);
  assert.deepEqual(readdirSync(dir), ['notes.txt']);
  offerIn(dir, '1.101.0');
  assert.deepEqual(await tidyUpdates(dir, '1.100.0'), []);
  assert.ok(existsSync(join(dir, 'latest.json')), 'a newer offer stays');
});

test('the installer runs silently for this user, keeping shortcuts, and reopens the app only when asked', () => {
  assert.deepEqual(installerArgs({ reopen: true }), ['/S', '/currentuser', '--updated', '--force-run']);
  assert.deepEqual(installerArgs({ reopen: false }), ['/S', '/currentuser', '--updated']);
  const env = installerEnv({ PATH: 'p', BADMINTON_VIDEO_FFMPEG: 'f', BADMINTON_VIDEO_DATA: 'd', ELECTRON_RUN_AS_NODE: '1' });
  assert.deepEqual(env, { PATH: 'p', BADMINTON_VIDEO_DATA: 'd' });
});

test('the database is backed up before installing, keeping the newest five', async () => {
  const dataDir = scratch();
  const db = new DatabaseSync(join(dataDir, 'a.db'));
  db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (42)');
  for (let v = 1; v <= 7; v++) {
    const file = await backupDatabase(db, dataDir, `1.${v}.0`);
    await new Promise((r) => setTimeout(r, 15)); // distinct times
    const copy = new DatabaseSync(file, { readOnly: true });
    assert.equal(copy.prepare('SELECT x FROM t').get().x, 42);
    copy.close(); // Windows won't delete an open file
  }
  assert.deepEqual(readdirSync(join(dataDir, 'backups')).sort(), ['3', '4', '5', '6', '7'].map((v) => `backup-before-1.${v}.0.db`));
});

test('the updater offers a ready version, backs up and starts the installer once', async () => {
  const dir = scratch();
  const dataDir = scratch();
  const db = new DatabaseSync(join(dataDir, 'a.db'));
  const started = [];
  const spawn = (file, args, options) => {
    started.push({ file, args, detached: options.detached });
    return { unref() {} };
  };
  const updater = createUpdater({ dir, current: '1.100.0', db, dataDir, spawn, log: quiet });
  assert.equal(await updater.check(), null);
  await assert.rejects(updater.install({ reopen: true }), { code: 'noUpdate' });
  const path = offerIn(dir, '1.101.0');
  assert.equal((await updater.check()).version, '1.101.0');
  assert.equal(updater.ready().version, '1.101.0');
  await updater.install({ reopen: true });
  await updater.install({ reopen: false }); // a second press, or closing straight after: nothing more
  assert.deepEqual(started, [{ file: path, args: installerArgs({ reopen: true }), detached: true }]);
  assert.equal(updater.ready(), null, 'not offered again while installing');
  assert.ok(existsSync(join(dataDir, 'backups', 'backup-before-1.101.0.db')));
});

test('the page says an update was installed once the version it last showed is older', () => {
  assert.equal(updatedSince('1.100.0', '1.101.0'), true);
  assert.equal(updatedSince('1.101.0', '1.101.0'), false);
  assert.equal(updatedSince(null, '1.101.0'), false, 'first time: nothing to say');
  assert.equal(updatedSince('1.102.0', '1.101.0'), false);
});

test('the page hears of a ready version from /api/version and installs it with POST /api/update/install', async () => {
  const { installUpdate, versionRoute } = await import('../api/settings.js');
  const calls = [];
  const app = { update: {
    ready: () => ({ version: '1.101.0', path: 'C:\secret\path.exe', notes: ['A new thing.'] }),
    install: async (o) => calls.push(['install', o]),
    quit: () => calls.push(['quit']),
  } };
  assert.deepEqual((await versionRoute({ app }).json()).update, { version: '1.101.0', notes: ['A new thing.'] });
  assert.equal((await versionRoute({ app: {} }).json()).update, null);
  const post = (body) => new Request('http://127.0.0.1/api/update/install', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await installUpdate({ request: post({}), app: {} })).status, 404);
  const r = await installUpdate({ request: post({}), app });
  assert.equal(r.status, 202);
  await new Promise((done) => setTimeout(done, 400));
  assert.deepEqual(calls, [['install', { reopen: true }], ['quit']]);
});
