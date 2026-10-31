// Finding phone videos in the chosen folders and reading when each was recorded.
// Files are never moved or changed; only their details are saved.

import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
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

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);

/**
 * Scans the folders: new or changed files are read with ffprobe and saved;
 * files that have gone are marked missing (and come back if they reappear).
 * Rendered videos in the output folder are skipped.
 */
export async function scanFolders(db, tools, { folders, outputFolder, onProgress, signal }) {
  const out = String(outputFolder ?? '').toLowerCase();
  const files = [];
  for (const f of folders) for (const p of await listVideos(f)) if (!out || !p.toLowerCase().startsWith(out)) files.push(p);
  const known = new Map(db.prepare('SELECT id, path, size, modified_at FROM videos').all().map((r) => [r.path, r]));
  let added = 0;
  let failed = 0;
  const insert = db.prepare(`INSERT INTO videos (path, size, modified_at, recorded_at, recorded_source, duration, width, height, fps, codec, hdr, has_audio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (path) DO UPDATE SET size = excluded.size, modified_at = excluded.modified_at, recorded_at = excluded.recorded_at,
      recorded_source = excluded.recorded_source, duration = excluded.duration, width = excluded.width, height = excluded.height,
      fps = excluded.fps, codec = excluded.codec, hdr = excluded.hdr, has_audio = excluded.has_audio, missing = 0`);
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped'), { code: 'stopped' });
    const path = files[i];
    onProgress?.(i / files.length, path);
    const s = await stat(path);
    const k = known.get(path);
    if (k && k.size === s.size && k.modified_at === iso(s.mtimeMs)) continue;
    try {
      const d = describe(await probe(tools, path), path, s.mtimeMs);
      insert.run(path, s.size, iso(s.mtimeMs), iso(d.recordedAt), d.recordedSource, d.duration, d.width, d.height, d.fps, d.codec, d.hdr ? 1 : 0, d.hasAudio ? 1 : 0);
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
  return { found: files.length, added, failed, scannedAt: nowIso() };
}
