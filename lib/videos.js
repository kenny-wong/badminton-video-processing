// Finding phone videos in the chosen folders and reading when each was recorded.
// Files are never moved or changed; only their details are saved.

import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { describe, VIDEO_EXTENSIONS } from './media.js';
import { probe } from './ffmpeg.js';
import { nowIso } from './db.js';

const MAX_DEPTH = 4;
const MAX_FILES = 5000;

async function listVideos(folder, depth = 0, out = []) {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const p = join(folder, e.name);
    if (e.isDirectory() && depth < MAX_DEPTH && !e.name.startsWith('.')) await listVideos(p, depth + 1, out);
    else if (e.isFile() && VIDEO_EXTENSIONS.includes(extname(e.name).toLowerCase())) out.push(p);
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

/**
 * Scans the folders: new or changed files are read with ffprobe and saved;
 * files that have gone are marked missing (and come back if they reappear).
 * A gone file's row is dropped when its folder is still there and nothing
 * hangs on it (not linked to a match, no tagging carried); rows on a folder or
 * drive that can't be reached stay, marked missing. Rendered videos in the
 * output folder are skipped. Returns { found, added, failed, removed, missing }.
 */
export async function scanFolders(db, tools, { folders, outputFolder, onProgress, signal }) {
  const out = String(outputFolder ?? '').toLowerCase();
  const files = [];
  for (const f of folders) for (const p of await listVideos(f)) if (!out || !p.toLowerCase().startsWith(out)) files.push(p);
  const known = new Map(db.prepare('SELECT id, path, size, modified_at FROM videos').all().map((r) => [r.path, r]));
  let added = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped'), { code: 'stopped' });
    const path = files[i];
    onProgress?.(i / files.length, path);
    const s = await stat(path);
    const k = known.get(path);
    if (k && k.size === s.size && k.modified_at === iso(s.mtimeMs)) continue;
    try {
      await saveVideo(db, tools, path, s);
      added += 1;
    } catch (err) {
      console.error('probe', path, err.message);
      failed += 1;
    }
  }
  const present = new Set(files);
  const mark = db.prepare('UPDATE videos SET missing = ? WHERE id = ?');
  for (const [p, r] of known) mark.run(present.has(p) ? 0 : 1, r.id);
  db.prepare('UPDATE videos SET missing = 0 WHERE path IN (SELECT value FROM json_each(?))').run(JSON.stringify(files));
  let removed = 0;
  if (files.length < MAX_FILES) { // a cut-short list would make videos look gone
    const gone = db.prepare('SELECT id, path FROM videos WHERE missing = 1 AND match_id IS NULL AND carried_tagging IS NULL').all();
    const drop = db.prepare('DELETE FROM videos WHERE id = ?');
    for (const r of gone) if (existsSync(dirname(r.path))) removed += drop.run(r.id).changes;
  }
  const missing = db.prepare('SELECT COUNT(*) AS n FROM videos WHERE missing = 1').get().n;
  return { found: files.length, added, failed, removed, missing, scannedAt: nowIso() };
}
