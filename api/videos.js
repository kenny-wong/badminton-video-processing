// GET /api/videos: every video found, newest first, with the match it shows.
// POST /api/videos/scan: scans the video folders (a job).
// PUT /api/videos/:id { matchId: null }: unlinks a video.

import { fail, idParam, json, readJson } from '../lib/http.js';
import { videoFromRow } from '../lib/db.js';
import { readSettings } from '../lib/settings.js';
import { findTools } from '../lib/ffmpeg.js';
import { jobView, startJob } from '../lib/jobs.js';
import { scanFolders } from '../lib/videos.js';
import { detachVideo } from '../lib/tagging.js';

export function onRequestGet({ app }) {
  const rows = app.db.prepare(`SELECT v.*, m.team_a, m.team_b, m.draw, COALESCE(m.round_label, m.round) AS round, m.tournament_id, t.name AS tournament
    FROM videos v LEFT JOIN matches m ON m.id = v.match_id LEFT JOIN tournaments t ON t.id = m.tournament_id
    ORDER BY v.recorded_at DESC, v.path`).all();
  return json({
    videos: rows.map((r) => ({
      ...videoFromRow(r),
      match: r.match_id ? { id: r.match_id, tournamentId: r.tournament_id, tournament: r.tournament, draw: r.draw, round: r.round, teamA: JSON.parse(r.team_a), teamB: JSON.parse(r.team_b) } : null,
    })),
  });
}

export function scan({ app }) {
  const settings = readSettings(app.db);
  if (!settings.videoFolders.length) return fail(400, 'noFolders', 'Add a video folder in Settings first');
  const tools = findTools(settings.ffmpegFolder);
  if (!tools) return fail(503, 'noFfmpeg', 'FFmpeg wasn’t found. Install it (winget install Gyan.FFmpeg) or set its folder in Settings.');
  const job = startJob('scan', 'scan', (j, signal) => scanFolders(app.db, tools, {
    folders: settings.videoFolders,
    outputFolder: settings.outputFolder,
    signal,
    onProgress: (p, path) => { j.progress = p; j.message = path.split(/[\\/]/).pop(); },
  }));
  return json(jobView(job), 202);
}

export async function onRequestPut({ request, params, app }) {
  const id = idParam(params.id);
  const body = await readJson(request);
  if (!id || body?.matchId !== null) return fail(400, 'badInput', 'Only unlinking is supported here');
  const v = app.db.prepare('SELECT match_id FROM videos WHERE id = ?').get(id);
  if (!v) return fail(404, 'notFound', 'No such video');
  detachVideo(app.db, id);
  return json({ ok: true });
}
