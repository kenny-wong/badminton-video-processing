// GET /api/videos: every video found, newest first, with the match it shows and the tournament it belongs to
//   (its match's, or the one whose folder it's in), and every tournament with its folder.
// POST /api/videos/scan: scans the video folders and the tournaments' own, linking the sure ones in those (a job).
// PUT /api/videos/:id { matchId: null }: unlinks a video.

import { fail, idParam, json, readJson } from '../lib/http.js';
import { videoFromRow } from '../lib/db.js';
import { readSettings } from '../lib/settings.js';
import { findTools } from '../lib/ffmpeg.js';
import { jobView, startJob } from '../lib/jobs.js';
import { checkLibrary, scanFolders } from '../lib/videos.js';
import { allFolders, autoLink, currentFolder, folderOwner, getTournament, markScanned } from '../lib/tournament-videos.js';
import { listDrives } from '../lib/locate.js';
import { unlinkByHand } from '../lib/tagging.js';

export async function onRequestGet({ app }) {
  await checkLibrary(app);
  const rows = app.db.prepare(`SELECT v.*, m.team_a, m.team_b, m.draw, COALESCE(m.round_label, m.round) AS round, m.tournament_id, t.name AS tournament
    FROM videos v LEFT JOIN matches m ON m.id = v.match_id LEFT JOIN tournaments t ON t.id = m.tournament_id
    ORDER BY v.recorded_at DESC, v.path`).all();
  const folders = allFolders(app.db);
  return json({
    tournaments: app.db.prepare('SELECT id, name, start_date, end_date, video_folder, videos_scanned_at FROM tournaments ORDER BY start_date DESC, id DESC').all()
      .map((t) => ({ id: t.id, name: t.name, start: t.start_date, end: t.end_date, folder: t.video_folder, scannedAt: t.videos_scanned_at })),
    videos: rows.map((r) => ({
      ...videoFromRow(r),
      tournamentId: r.tournament_id ?? folderOwner(folders, r.path),
      match: r.match_id ? { id: r.match_id, tournamentId: r.tournament_id, tournament: r.tournament, draw: r.draw, round: r.round, teamA: JSON.parse(r.team_a), teamB: JSON.parse(r.team_b) } : null,
    })),
  });
}

export function scan({ app }) {
  const settings = readSettings(app.db);
  const { db } = app;
  const owners = allFolders(db);
  if (!settings.videoFolders.length && !owners.length) return fail(400, 'noFolders', 'Choose a tournament’s video folder on the Videos tab, or add a video folder in Settings, first');
  const tools = findTools(settings.ffmpegFolder);
  if (!tools) return fail(503, 'noFfmpeg', 'FFmpeg wasn’t found. Install it (winget install Gyan.FFmpeg) or set its folder in Settings.');
  const job = startJob('scan', 'scan', async (j, signal) => {
    const drives = await (app.drives ?? listDrives)();
    await checkLibrary(app, { force: true });
    j.message = 'Looking for the tournaments’ folders';
    const found = [];
    for (const o of owners) {
      const t = getTournament(db, o.id);
      const folder = t && await currentFolder(db, t, drives);
      if (folder) found.push({ id: o.id, folder });
    }
    const r = await scanFolders(db, tools, {
      folders: settings.videoFolders,
      owned: found.map((f) => f.folder),
      outputFolder: settings.outputFolder,
      signal,
      drives,
      onProgress: (p, path) => { j.progress = p; j.message = path.split(/[\\/]/).pop(); },
    });
    const linked = [];
    for (const f of found) {
      markScanned(db, f.id);
      linked.push(...autoLink(db, getTournament(db, f.id)).linked);
    }
    return { ...r, linked: linked.length, notConnected: owners.length - found.length };
  }, { queue: 'scan', label: 'Scan the video folders' });
  return json(jobView(job), 202);
}

export async function onRequestPut({ request, params, app }) {
  const id = idParam(params.id);
  const body = await readJson(request);
  if (!id || body?.matchId !== null) return fail(400, 'badInput', 'Only unlinking is supported here');
  const v = app.db.prepare('SELECT match_id FROM videos WHERE id = ?').get(id);
  if (!v) return fail(404, 'notFound', 'No such video');
  unlinkByHand(app.db, id);
  return json({ ok: true });
}
