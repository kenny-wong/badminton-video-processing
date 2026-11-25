// Finding phone videos in the chosen folders and reading when each was recorded.
// Files are never moved or changed; only their details are saved.

import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { describe, VIDEO_EXTENSIONS } from './media.js';
import { probe } from './ffmpeg.js';
import { nowIso } from './db.js';
import { findFile, findFolder, inFolder, isFolder, onDrive, samePath, statOrNull } from './locate.js';

const MAX_DEPTH = 4;
const MAX_FILES = 5000;

export async function listVideos(folder, depth = 0, out = []) {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const p = join(folder, e.name);
    // (A Mac leaves hidden "._name.mp4" files on drives like an exFAT SSD.)
    if (e.isDirectory() && depth < MAX_DEPTH && !e.name.startsWith('.')) await listVideos(p, depth + 1, out);
    else if (e.isFile() && !e.name.startsWith('.') && VIDEO_EXTENSIONS.includes(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const INSERT = `INSERT INTO videos (path, size, modified_at, recorded_at, recorded_source, duration, width, height, fps, codec, hdr, has_audio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (path) DO UPDATE SET size = excluded.size, modified_at = excluded.modified_at, recorded_at = excluded.recorded_at,
      recorded_source = excluded.recorded_source, duration = excluded.duration, width = excluded.width, height = excluded.height,
      fps = excluded.fps, codec = excluded.codec, hdr = excluded.hdr, has_audio = excluded.has_audio, missing = 0
    RETURNING id`;

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);

/** Reads one file with ffprobe and saves it (or its new details); returns its id. */
export async function saveVideo(db, tools, path, s = null) {
  const st = s ?? await stat(path);
  const d = describe(await probe(tools, path), path, st.mtimeMs);
  return db.prepare(INSERT).get(path, st.size, iso(st.mtimeMs), iso(d.recordedAt), d.recordedSource, d.duration, d.width, d.height, d.fps, d.codec, d.hdr ? 1 : 0, d.hasAudio ? 1 : 0).id;
}

const isFile = async (path) => Boolean((await statOrNull(path))?.isFile());

/** Whether a video's file is there, without asking a drive that isn't connected. */
const present = async (path, drives) => (drives ? onDrive(path, drives) : true) && isFile(path);

/** Nothing hangs on this row: it can be dropped. */
const spare = (row) => row.match_id === null && row.carried_tagging === null;

/**
 * Gives a video its file's new place. A row already there goes when nothing
 * hangs on it (the folder was scanned before the video was known to have moved).
 */
function repoint(db, id, path, modified = null) {
  const there = db.prepare('SELECT * FROM videos WHERE path = ? COLLATE NOCASE AND id <> ?').get(path, id);
  if (there && !spare(there)) return false;
  if (there) db.prepare('DELETE FROM videos WHERE id = ?').run(there.id);
  db.prepare('UPDATE videos SET path = ?, modified_at = COALESCE(?, modified_at), missing = 0 WHERE id = ?').run(path, modified, id);
  return true;
}

/**
 * Looks for the library again when the drives have changed since the last time
 * (an external drive connected, removed, or given another letter), and when the
 * server starts: videos no longer where they were are looked for at the same
 * place on the other drives, the rest marked missing, and tournaments' folders
 * follow. `app.drives` lists the drives; without it (tests) nothing happens.
 */
export async function checkLibrary(app, { force = false } = {}) {
  if (!app.drives) return null;
  const drives = await app.drives();
  const key = drives.join();
  if (!force && app.drivesSeen === key) return app.libraryCheck ?? null;
  app.drivesSeen = key;
  app.libraryCheck = relocate(app.db, drives).catch((err) => {
    console.error('Looking for the videos', err);
    return null;
  });
  const r = await app.libraryCheck;
  app.libraryCheck = null;
  if (r?.moved || r?.folders) console.log(`Drives ${key}: ${r.moved} video${r.moved === 1 ? '' : 's'} and ${r.folders} tournament folder${r.folders === 1 ? '' : 's'} found at a new place, ${r.missing} missing`);
  return r;
}

/** The work of checkLibrary: { moved, missing, folders }. */
export async function relocate(db, drives) {
  const mark = db.prepare('UPDATE videos SET missing = ? WHERE id = ?');
  const out = { moved: 0, missing: 0, folders: 0 };
  for (const v of db.prepare('SELECT id, path, size, missing FROM videos').all()) {
    if (await present(v.path, drives)) {
      if (v.missing) mark.run(0, v.id);
      continue;
    }
    const now = await findFile(v.path, v.size, drives);
    if (now && repoint(db, v.id, now)) out.moved += 1;
    else {
      if (!v.missing) mark.run(1, v.id);
      out.missing += 1;
    }
  }
  for (const t of db.prepare('SELECT id, video_folder FROM tournaments WHERE video_folder IS NOT NULL').all()) {
    const now = await findFolder(t.video_folder, drives, { quick: true });
    if (now && now !== t.video_folder) {
      db.prepare('UPDATE tournaments SET video_folder = ? WHERE id = ?').run(now, t.id);
      out.folders += 1;
    }
  }
  return out;
}

/**
 * Scans the folders: new or changed files are read with ffprobe and saved;
 * files that have gone are marked missing (and come back if they reappear).
 * A new file with a known video's name and size is that video: moved here when
 * its old file has gone (its match and tagging stay with it), or a copy, which
 * isn't added again. `owned` are tournaments' own folders (scanned as well):
 * a video copied into one is taken from there.
 * A gone file's row is dropped when its folder is still there and nothing
 * hangs on it (not linked to a match, no tagging carried); rows on a folder or
 * drive that can't be reached stay, marked missing. Rendered videos in the
 * output folder are skipped. Returns { found, added, moved, copies, failed, removed, missing }.
 */
export async function scanFolders(db, tools, { folders, owned = [], outputFolder, onProgress, signal, drives = null }) {
  const out = String(outputFolder ?? '').toLowerCase();
  const files = new Map(); // a file in two of the folders is scanned once
  for (const f of [...owned, ...folders]) for (const p of await listVideos(f)) if (!out || !p.toLowerCase().startsWith(out)) files.set(samePath(p), p);
  const list = [...files.values()];
  const isOwned = (path) => owned.some((f) => inFolder(path, f));
  const all = () => db.prepare('SELECT id, path, size, modified_at, match_id, carried_tagging FROM videos').all();
  const before = all();
  const byPath = new Map(before.map((r) => [samePath(r.path), r]));
  const twins = new Map(); // name and size -> rows
  const twinKey = (path, size) => `${basename(path).toLowerCase()}|${size}`;
  for (const r of before) twins.set(twinKey(r.path, r.size), [...(twins.get(twinKey(r.path, r.size)) ?? []), r]);
  let added = 0;
  let moved = 0;
  let copies = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped'), { code: 'stopped' });
    const path = list[i];
    onProgress?.(i / list.length, path);
    const s = await statOrNull(path);
    if (!s) continue; // gone meanwhile
    const k = byPath.get(samePath(path));
    if (!k || spare(k)) {
      // The same video, known at another place: the one with a match or tagging first.
      const others = (twins.get(twinKey(path, s.size)) ?? []).filter((r) => r !== k).sort((x, y) => spare(x) - spare(y));
      let here = false;
      for (const r of others) {
        const there = await present(r.path, drives);
        if (!there || (isOwned(path) && !isOwned(r.path))) {
          if (!there && k && spare(r)) continue; // this row stays; the gone one is dropped below
          if (repoint(db, r.id, path, iso(s.mtimeMs))) {
            here = true;
            moved += 1;
            byPath.delete(samePath(r.path)); // its old file, if it's scanned too, is a copy now
            byPath.set(samePath(path), r);
            r.path = path;
            break;
          }
        } else if (!k) {
          copies += 1;
          here = true;
          break;
        }
      }
      if (here) continue;
    }
    if (k && k.size === s.size && k.modified_at === iso(s.mtimeMs)) continue;
    try {
      await saveVideo(db, tools, k?.path ?? path, s);
      added += 1;
    } catch (err) {
      console.error('probe', path, err.message);
      failed += 1;
    }
  }
  const mark = db.prepare('UPDATE videos SET missing = ? WHERE id = ?');
  for (const r of all()) mark.run(files.has(samePath(r.path)) || await present(r.path, drives) ? 0 : 1, r.id);
  let removed = 0;
  if (list.length < MAX_FILES) { // a cut-short list would make videos look gone
    const gone = db.prepare('SELECT id, path FROM videos WHERE missing = 1 AND match_id IS NULL AND carried_tagging IS NULL').all();
    const drop = db.prepare('DELETE FROM videos WHERE id = ?');
    for (const r of gone) if ((!drives || onDrive(r.path, drives)) && await isFolder(dirname(r.path))) removed += drop.run(r.id).changes;
  }
  const missing = db.prepare('SELECT COUNT(*) AS n FROM videos WHERE missing = 1').get().n;
  return { found: list.length, added, moved, copies, failed, removed, missing, scannedAt: nowIso() };
}
