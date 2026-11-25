// Finding folders and videos whose drive letter has changed. Videos may be on an external SSD, which Windows can give
// another letter (or which isn't connected at all), so a path that isn't there is looked for at the same place on every
// other drive. Drives are listed without touching their disks; a sleeping hard disk is only asked when something is missing
// and the set of drives has changed.
// The finding takes the drives as a parameter, so it's tested on ordinary folders in tests/locate.test.js.

import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, parse } from 'node:path';

const ANSWER_MS = 8000; // a drive that takes longer than this to answer (a dead network drive) is left out
const KEEP_MS = 3000;

let listed = { at: 0, drives: [] };

/** The drives Windows has now: ['C:\\', 'D:\\', …]. */
export function listDrives() {
  if (process.platform !== 'win32') return Promise.resolve(['/']);
  if (Date.now() - listed.at < KEEP_MS) return Promise.resolve(listed.drives);
  return new Promise((resolve) => {
    execFile('fsutil', ['fsinfo', 'drives'], { windowsHide: true, timeout: ANSWER_MS }, (err, out) => {
      const drives = err ? [] : String(out).match(/[A-Z]:\\/g) ?? [];
      if (drives.length) listed = { at: Date.now(), drives };
      resolve(drives.length ? drives : listed.drives);
    });
  });
}

/** stat() that gives null instead of failing, or when the drive doesn't answer. */
export function statOrNull(path) {
  let timer;
  return Promise.race([
    stat(path).catch(() => null),
    new Promise((r) => { timer = setTimeout(() => r(null), ANSWER_MS); }),
  ]).finally(() => clearTimeout(timer));
}

export const isFolder = async (path) => Boolean((await statOrNull(path))?.isDirectory());

/** The path without its drive, "Badminton Video\\20261101 Silver"; null for one without a drive letter (a network path). */
export function tailOf(path) {
  const m = /^[a-z]:[\\/]+(.*)$/i.exec(String(path ?? ''));
  return m ? m[1] : null;
}

/** Whether `path` can be on one of the drives: its letter is there now (network paths may be). */
export function onDrive(path, drives) {
  const root = /^[a-z]:/i.exec(String(path ?? ''))?.[0].toLowerCase();
  return !root || drives.some((d) => d.toLowerCase().startsWith(root));
}

/** One spelling of a path, for comparing. */
export const samePath = (path) => String(path ?? '').replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase();

/** True when the path is in the folder, at any depth. */
export const inFolder = (path, folder) => Boolean(folder) && samePath(path).startsWith(`${samePath(folder)}\\`);

/** The drives that answer. */
async function awake(drives) {
  const ok = await Promise.all(drives.map(isFolder));
  return drives.filter((_, i) => ok[i]);
}

/** How many of the known files ({ tail, size }: their place under the folder) are there. */
async function known(folder, files) {
  let n = 0;
  for (const f of files.slice(0, 20)) if ((await statOrNull(join(folder, f.tail)))?.size === f.size) n += 1;
  return n;
}

// Folders that hold no videos and can be big or closed.
const SKIP = /^(\$|\.|system volume information$|windows$|program files|programdata$|recovery$|config\.msi$|node_modules$)/i;

/** The folders inside a folder. */
export async function foldersIn(folder) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && !SKIP.test(e.name)).map((e) => join(folder, e.name));
}

/**
 * Where a folder is now: where it was; else the same path on another drive; else
 * (unless `quick`) a folder of the same name at the top of a drive or one
 * folder down. Of several, the one holding most of `files` (the videos
 * known to be in it, as { tail, size }); a folder only alike in name must
 * hold one of them, or be the only one when none is known.
 * @returns {Promise<string|null>}
 */
export async function findFolder(path, drives, { files = [], quick = false } = {}) {
  if (onDrive(path, drives) && await isFolder(path)) return path;
  const tail = tailOf(path);
  if (!tail) return null;
  const up = await awake(drives);
  const best = async (folders) => {
    const found = [];
    for (const f of folders) if (await isFolder(f)) found.push({ f, n: await known(f, files) });
    return found.sort((x, y) => y.n - x.n);
  };
  const [same] = await best(up.map((d) => join(d, tail)));
  if (same) return same.f;
  if (quick) return null;
  const name = basename(path);
  const tops = (await Promise.all(up.map(foldersIn))).flat();
  const alike = await best([...up, ...tops].map((d) => join(d, name)));
  if (files.length) return alike[0]?.n ? alike[0].f : null;
  return alike.length === 1 ? alike[0].f : null;
}

/** Where a missing file of this size is now on another drive, or null. */
export async function findFile(path, size, drives) {
  const tail = tailOf(path);
  if (!tail) return null;
  for (const d of drives) {
    const p = join(d, tail);
    if (samePath(p) === samePath(path)) continue;
    const s = await statOrNull(p);
    if (s?.isFile() && s.size === size) return p;
  }
  return null;
}

// ---------- a tournament's folder, by its name and date ----------

const words = (text) => new Set(String(text ?? '').toLowerCase().replace(/^copy of /, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !/^20\d{2}$/.test(w)));

/**
 * How well a folder's name fits a tournament, 0 (not at all) to 1: its start
 * date (20261101 or 2026-11-01) and the words of its name.
 */
export function nameFit(folderName, tournament) {
  const ymd = tournament.start ?? '';
  const dated = Boolean(ymd) && (folderName.includes(ymd) || folderName.includes(ymd.replaceAll('-', '')));
  const anyDate = /(?<!\d)20\d{2}-?\d{2}-?\d{2}(?!\d)/.test(folderName);
  const own = words(tournament.name);
  const there = words(folderName.replace(/(?<!\d)20\d{2}-?\d{2}-?\d{2}(?!\d)/, ' '));
  const shared = [...own].filter((w) => there.has(w)).length / Math.max(1, own.size);
  if (dated) return there.size ? (shared >= 0.3 ? 0.4 + 0.6 * shared : 0) : 0.4;
  if (anyDate) return 0; // another day's
  return shared >= 0.75 && own.size > 1 ? 0.3 * shared : 0;
}

/**
 * Folders that look like this tournament's, best first: at the top of any drive,
 * one folder down, or inside `parents` (where other tournaments' folders are).
 */
export async function tournamentFolders(tournament, drives, { parents = [], except = [] } = {}) {
  const up = await awake(drives);
  const tops = (await Promise.all(up.map(foldersIn))).flat();
  const near = [...new Set([...parents.filter((p) => onDrive(p, drives)), ...tops])];
  const all = [...tops, ...(await Promise.all(near.map(foldersIn))).flat()];
  const seen = new Map();
  for (const path of all) {
    const fit = nameFit(basename(path), tournament);
    if (fit && !except.some((x) => x && (samePath(path) === samePath(x) || inFolder(path, x)))) seen.set(samePath(path), { path, fit });
  }
  return [...seen.values()].sort((x, y) => y.fit - x.fit).slice(0, 4);
}

/** True for the top of a drive ("I:\\"), which is no folder of one tournament. */
export const isRoot = (path) => parse(path).root === path || dirname(path) === path;
