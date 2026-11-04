// The SQLite database (Node's built-in node:sqlite) and its migrations: each
// migrations/NNNN_*.sql file runs once, in order, tracked by PRAGMA user_version.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

/**
 * Runs new migrations, each in a transaction. Foreign keys are off meanwhile
 * (SQLite's way to rebuild a table others refer to) and checked afterwards.
 */
export function migrate(db) {
  const dir = MIGRATIONS;
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  let version = db.prepare('PRAGMA user_version').get().user_version;
  const pending = files.filter((f) => Number(f.slice(0, 4)) > version);
  if (!pending.length) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const f of pending) {
      const n = Number(f.slice(0, 4));
      db.exec('BEGIN');
      try {
        db.exec(readFileSync(join(dir, f), 'utf8'));
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`${f} broke ${broken.length} foreign key(s), first in ${broken[0].table}`);
        db.exec(`PRAGMA user_version = ${n}`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      version = n;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export function parseJson(text, fallback) {
  try {
    return text == null ? fallback : JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** A matches row as the API shows it. */
export function matchFromRow(r) {
  return r && {
    id: r.id,
    tournamentId: r.tournament_id,
    parentId: r.parent_id ?? null,
    game: r.game ?? 0,
    date: r.match_date,
    time: r.match_time,
    startsAt: r.starts_at,
    draw: r.draw,
    round: r.round,
    court: r.court,
    duration: r.duration,
    teamA: parseJson(r.team_a, []),
    teamB: parseJson(r.team_b, []),
    games: parseJson(r.games, []),
    winner: r.winner,
    format: parseJson(r.format, null),
    firstServer: r.first_server,
    serverSet: r.server_set === 1, // chosen in the editor or known from the result; until then the video isn't tagged
    rallies: parseJson(r.rallies, []),
    sourcePath: r.source_path,
    outputPath: r.output_path,
    renderedAt: r.rendered_at,
    youtubeUrl: r.youtube_url,
    comment: r.comment ?? '',
    favourite: r.favourite === 1,
    uploadedAt: r.uploaded_at,
    matchStart: r.match_start,
    matchEnd: r.match_end,
    startScore: parseJson(r.start_score, null),
    highlightsPath: r.highlights_path,
    corners: parseJson(r.court_corners, null),
    nearAtStart: r.near_at_start ?? null,
    trackPath: r.track_path ?? null,
    trackedAt: r.tracked_at ?? null,
    highlightsAt: r.highlights_at,
    boardStyle: parseJson(r.board_style, null),
    inset: parseJson(r.inset, null),
  };
}

/** A videos row as the API shows it. */
export function videoFromRow(r) {
  return r && {
    id: r.id,
    path: r.path,
    name: r.path.split(/[\\/]/).pop(),
    size: r.size,
    recordedAt: r.recorded_at,
    recordedSource: r.recorded_source,
    duration: r.duration,
    width: r.width,
    height: r.height,
    fps: r.fps,
    codec: r.codec,
    hdr: r.hdr === 1,
    hasAudio: r.has_audio === 1,
    matchId: r.match_id,
    part: r.part,
    missing: r.missing === 1,
    madeFrom: parseJson(r.made_from, null),
  };
}

export function tournamentFromRow(r) {
  return r && {
    id: r.id, kind: r.kind ?? 'imported', beId: r.be_id, badminfoId: r.badminfo_id, name: r.name, start: r.start_date, end: r.end_date,
    venue: r.venue ?? null, format: parseJson(r.format, null), importedAt: r.imported_at, completedAt: r.completed_at ?? null,
  };
}
