// Updating the installed app from inside it. `npm run dist` puts the new
// installer and latest.json in the updates folder (scripts/offer-update.mjs);
// the installed app looks there every minute, checks the file is whole (size
// and SHA-256), and the page offers "Restart now". Restarting backs up the
// database, starts the installer silently and closes the app; the installer
// waits for it to close, replaces its files and opens it again. Windows won't
// let a running program's files be replaced, so the swap itself has to wait
// for the app to close; everything else is done before it asks.
// Closing the app with an update waiting installs it too, without reopening.
// No Electron code here; tested in tests/app-update.test.js.

import { spawn as spawnProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { backup } from 'node:sqlite';
import { compareVersions } from '../public/shared/version.js';

export const OFFER_FILE = 'latest.json';
export const INSTALLER = /^Badminton-Video-Setup-(\d+\.\d+\.\d+)\.exe$/;
const KEEP_BACKUPS = 5;

/** Where `npm run dist` leaves new versions for the installed app (BADMINTON_VIDEO_UPDATES overrides it). */
export function updatesFolder(env = process.env) {
  if (env.BADMINTON_VIDEO_UPDATES) return env.BADMINTON_VIDEO_UPDATES;
  return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Badminton Video', 'updates') : null;
}

/** The installer's switches: silent, for this user, keeping shortcuts and the taskbar pin; reopen = start the app when done. */
export const installerArgs = ({ reopen }) => ['/S', '/currentuser', '--updated', ...(reopen ? ['--force-run'] : [])];

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('error', reject).on('data', (b) => hash.update(b)).on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * The offer in `dir` when it's newer than `current` and its installer is whole:
 * { version, path, size, notes }. Null otherwise (nothing there, older, half copied,
 * or not what latest.json says). `hashes` remembers checked files by path, size and time.
 */
export async function readOffer(dir, current, { hashes = new Map() } = {}) {
  let offer;
  try {
    offer = JSON.parse(await readFile(join(dir, OFFER_FILE), 'utf8'));
  } catch {
    return null;
  }
  const name = typeof offer?.file === 'string' ? offer.file : '';
  const m = INSTALLER.exec(name);
  if (!m || basename(name) !== name || m[1] !== offer.version) return null;
  if (compareVersions(offer.version, current) <= 0) return null;
  if (!/^[0-9a-f]{64}$/.test(offer.sha256 ?? '') || !Number.isSafeInteger(offer.size)) return null;
  const path = join(dir, name);
  let st;
  try {
    st = await stat(path);
  } catch {
    return null;
  }
  if (st.size !== offer.size) return null;
  const key = `${path}|${st.size}|${st.mtimeMs}`;
  if (!hashes.has(key)) hashes.set(key, await sha256File(path));
  if (hashes.get(key) !== offer.sha256) return null;
  const notes = Array.isArray(offer.notes) ? offer.notes.filter((n) => typeof n === 'string').slice(0, 20) : [];
  return { version: offer.version, path, size: st.size, notes };
}

/** Deletes installers in `dir` for `current` or older (left behind once installed). */
export async function tidyUpdates(dir, current) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const gone = [];
  for (const name of names) {
    const m = INSTALLER.exec(name);
    if (m && compareVersions(m[1], current) <= 0) {
      await rm(join(dir, name), { force: true }).then(() => gone.push(name), () => {});
    }
  }
  if (gone.length) {
    const offer = await readFile(join(dir, OFFER_FILE), 'utf8').then(JSON.parse, () => null);
    if (offer && gone.includes(offer.file)) await rm(join(dir, OFFER_FILE), { force: true }).catch(() => {});
  }
  return gone;
}

/** Copies the database to <dataDir>/backups/backup-before-<version>.db and keeps the newest few. */
export async function backupDatabase(db, dataDir, version) {
  const dir = join(dataDir, 'backups');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `backup-before-${version}.db`);
  await rm(file, { force: true });
  await backup(db, file);
  const old = [];
  for (const name of await readdir(dir)) {
    if (/^backup-before-\d+\.\d+\.\d+\.db$/.test(name)) old.push({ name, at: (await stat(join(dir, name))).mtimeMs });
  }
  old.sort((a, b) => b.at - a.at);
  for (const { name } of old.slice(KEEP_BACKUPS)) await rm(join(dir, name), { force: true }).catch(() => {});
  return file;
}

/** The environment for the installer (and the app it reopens): without what this app set for itself. */
export function installerEnv(env = process.env) {
  const out = { ...env };
  for (const k of ['ELECTRON_RUN_AS_NODE', 'BADMINTON_VIDEO_FFMPEG', 'BADMINTON_VIDEO_SCRIPTS', 'BADMINTON_VIDEO_TOOLS', 'BADMINTON_VIDEO_DEV']) delete out[k];
  return out;
}

/**
 * Looks in `dir` now and every `everyMs`. ready() = the offer the page shows.
 * install({ reopen }) backs up the database and starts the installer; the caller
 * closes the app straight after.
 */
export function createUpdater({ dir, current, db, dataDir, everyMs = 60_000, spawn = spawnProcess, log = console }) {
  const hashes = new Map();
  let ready = null;
  let installing = null;
  let timer = null;
  let checking = null;

  async function check() {
    if (!dir || installing) return ready;
    checking ??= (async () => {
      try {
        const found = await readOffer(dir, current, { hashes });
        if (found && found.version !== ready?.version) log.log(`Version ${found.version} is ready to install (${found.path})`);
        ready = found;
        if (!found) await tidyUpdates(dir, current);
      } catch (err) {
        log.error('Looking for a new version', err);
      } finally {
        checking = null;
      }
      return ready;
    })();
    return checking;
  }

  async function install({ reopen }) {
    if (installing) return installing;
    const offer = await readOffer(dir, current, { hashes }); // still there and whole
    if (!offer) throw Object.assign(new Error('The new version’s installer is no longer there'), { code: 'noUpdate' });
    installing = offer;
    try {
      const file = await backupDatabase(db, dataDir, offer.version);
      log.log(`Database backed up to ${file}`);
      log.log(`Installing version ${offer.version}${reopen ? ' and reopening' : ' (app closing)'}`);
      spawn(offer.path, installerArgs({ reopen }), { detached: true, stdio: 'ignore', env: installerEnv() }).unref();
      return offer;
    } catch (err) {
      installing = null;
      throw err;
    }
  }

  return {
    check,
    install,
    ready: () => (installing ? null : ready),
    installing: () => installing,
    start() {
      check();
      timer = setInterval(check, everyMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
