// A tournament's Videos page: its own video folder, scanning it, and linking its videos to matches.
// GET /api/tournaments/:id/videos: the folder (and whether it's there now), the videos and what each shows.
// PUT /api/tournaments/:id/videos { folder?, player? }: its folder ('' for none) and whose matches were filmed
//   (a favourite's key, 'all', or null to work it out).
// POST /api/tournaments/:id/videos/scan: scans the folder and links the sure ones (a job).
// POST /api/tournaments/:id/videos/find: folders on any drive that look like this tournament's.
// POST /api/videos/unlink { ids }: unlinks several (undoing what a scan linked); scans leave them unlinked.
// POST /api/pick-folder { start? }: Windows' folder dialog; { path } (null when cancelled).

import { execFile } from 'node:child_process';
import { isAbsolute, normalize } from 'node:path';
import { fail, idParam, json, readJson } from '../lib/http.js';
import { parseJson, videoFromRow } from '../lib/db.js';
import { readSettings } from '../lib/settings.js';
import { findTools } from '../lib/ffmpeg.js';
import { jobView, startJob } from '../lib/jobs.js';
import { favouriteMatcher, favourites } from '../lib/favourites.js';
import { findFolder, inFolder, isFolder, isRoot, listDrives, samePath, tournamentFolders } from '../lib/locate.js';
import { checkLibrary, scanFolders } from '../lib/videos.js';
import { allFolders, autoLink, currentFolder, folderOwner, folderParents, freeVideos, getTournament, markScanned, SHORTEST_S, suggestLinks } from '../lib/tournament-videos.js';
import { unlinkByHand } from '../lib/tagging.js';

const drivesOf = (app) => (app.drives ?? listDrives)();
const tournamentOf = (app, params) => getTournament(app.db, idParam(params.id));
const none = () => fail(404, 'notFound', 'No such tournament');

/** What the page says about a match (or one game of it). */
const about = (m) => ({
  id: m.id, parentId: m.parent_id ?? m.id, game: m.game, date: m.match_date, time: m.match_time, draw: m.draw, round: m.round_label ?? m.round,
  teamA: parseJson(m.team_a, []), teamB: parseJson(m.team_b, []), games: parseJson(m.games, []),
});

export async function onRequestGet({ params, app }) {
  await checkLibrary(app);
  let tournament = tournamentOf(app, params);
  if (!tournament) return none();
  const { db } = app;
  const found = await currentFolder(db, tournament, await drivesOf(app), { quick: true });
  tournament = getTournament(db, tournament.id);
  const free = freeVideos(db, tournament);
  const { suggestions, whose, askWhose } = suggestLinks(db, tournament, free);
  const matches = new Map(db.prepare('SELECT * FROM matches WHERE tournament_id = ?').all(tournament.id).map((m) => [m.id, m]));
  const folders = allFolders(db);
  const rows = db.prepare('SELECT v.* FROM videos v LEFT JOIN matches m ON m.id = v.match_id WHERE m.tournament_id = ? OR v.match_id IS NULL').all(tournament.id).map(videoFromRow);
  const freeIds = new Set(free.map((v) => v.id));
  const shown = rows.filter((v) => v.matchId || freeIds.has(v.id) || (v.missing && folderOwner(folders, v.path, tournament.id) === tournament.id))
    .sort((x, y) => String(x.recordedAt ?? '9').localeCompare(String(y.recordedAt ?? '9')) || x.name.localeCompare(y.name));
  const favs = favourites(db);
  const sides = favouriteMatcher(db, tournament.id, favs);
  const here = new Set([...matches.values()].flatMap((m) => [...sides(parseJson(m.team_a, [])), ...sides(parseJson(m.team_b, []))]));
  const settings = readSettings(db);
  return json({
    tournament,
    folder: { path: tournament.videoFolder, connected: Boolean(found) },
    videos: shown.map((v) => {
      const s = suggestions.find((x) => x.ids[0] === v.id);
      return {
        ...v,
        inFolder: inFolder(v.path, tournament.videoFolder),
        short: (v.duration ?? 0) < SHORTEST_S,
        match: v.matchId ? about(matches.get(v.matchId)) : null,
        suggestion: s ? { ...about(matches.get(s.matchId)), game: s.game, lateMin: s.lateMin, sure: s.sure } : null,
      };
    }),
    players: favs.filter((f) => here.has(f.key)).map((f) => ({ key: f.key, name: f.name })),
    whose,
    askWhose,
    ffmpeg: Boolean(findTools(settings.ffmpegFolder)),
  });
}

export async function onRequestPut({ request, params, app }) {
  const tournament = tournamentOf(app, params);
  if (!tournament) return none();
  const body = (await readJson(request)) ?? {};
  const { db } = app;
  if (body.folder !== undefined) {
    if (typeof body.folder !== 'string' || body.folder.length > 400) return fail(400, 'badInput', 'Give the folder’s path');
    const text = body.folder.trim().replace(/^"(.*)"$/, '$1');
    let path = null;
    if (text) {
      if (!isAbsolute(text)) return fail(400, 'badFolder', 'Give the whole path, starting with the drive, such as I:\\Badminton Video\\20261101 Silver');
      path = normalize(text);
      if (isRoot(path)) return fail(400, 'badFolder', 'That’s a whole drive. Choose the folder with this tournament’s videos.');
      path = path.replace(/[\\/]+$/, '');
      const out = readSettings(db).outputFolder;
      if (samePath(path) === samePath(out) || inFolder(path, out)) return fail(400, 'badFolder', 'That’s where finished videos go. Choose the folder with the videos you filmed.');
      // A path typed with an old drive letter is found on the drive it's on now.
      const now = await findFolder(path, await drivesOf(app));
      if (!now) return fail(400, 'noFolder', `${path} wasn’t found on any drive. If it’s on an external drive, connect it first.`);
      path = now;
    }
    db.prepare('UPDATE tournaments SET video_folder = ?, videos_scanned_at = NULL WHERE id = ?').run(path, tournament.id);
  }
  if (body.player !== undefined) {
    const ok = body.player === null || body.player === 'all' || favourites(db).some((f) => String(f.key) === String(body.player));
    if (!ok) return fail(400, 'badInput', 'No such player on your list');
    db.prepare('UPDATE tournaments SET video_player = ? WHERE id = ?').run(body.player === null ? null : String(body.player), tournament.id);
  }
  return json({ ok: true, tournament: getTournament(db, tournament.id) });
}

export function scan({ params, app }) {
  const tournament = tournamentOf(app, params);
  if (!tournament) return none();
  if (!tournament.videoFolder) return fail(400, 'noFolders', 'Choose this tournament’s video folder first');
  const { db } = app;
  const settings = readSettings(db);
  const tools = findTools(settings.ffmpegFolder);
  if (!tools) return fail(503, 'noFfmpeg', 'FFmpeg wasn’t found. Install it (winget install Gyan.FFmpeg) or set its folder in Settings.');
  const job = startJob('scan', `scan:t${tournament.id}`, async (j, signal) => {
    const drives = await drivesOf(app);
    j.message = 'Looking for the folder';
    const folder = await currentFolder(db, tournament, drives);
    if (!folder) throw Object.assign(new Error(`The folder ${tournament.videoFolder} wasn’t found on any drive. Connect the drive it’s on, then scan again.`), { detail: `Drives looked at: ${drives.join(' ')}` });
    const r = await scanFolders(db, tools, {
      folders: [], owned: [folder], outputFolder: settings.outputFolder, signal, drives,
      onProgress: (p, path) => { j.progress = p; j.message = path.split(/[\\/]/).pop(); },
    });
    markScanned(db, tournament.id);
    return { ...r, folder, movedFrom: samePath(folder) === samePath(tournament.videoFolder) ? null : tournament.videoFolder, ...autoLink(db, getTournament(db, tournament.id)) };
  }, { queue: 'scan', label: `Scan ${tournament.name}’s videos` });
  return json(jobView(job), 202);
}

export async function find({ params, app }) {
  const tournament = tournamentOf(app, params);
  if (!tournament) return none();
  const settings = readSettings(app.db);
  const taken = allFolders(app.db).filter((f) => f.id !== tournament.id).map((f) => f.folder);
  const list = await tournamentFolders(tournament, await drivesOf(app), { parents: folderParents(app.db, settings), except: [settings.outputFolder, ...taken] });
  return json({ folders: list });
}

export async function unlinkMany({ request, app }) {
  const ids = (await readJson(request))?.ids;
  if (!Array.isArray(ids) || !ids.length || !ids.every((x) => Number.isInteger(x) && x > 0)) return fail(400, 'badInput', 'Expected a list of video ids');
  const { db } = app;
  let unlinked = 0;
  db.exec('BEGIN');
  try {
    for (const id of ids) if (unlinkByHand(db, id)) unlinked += 1;
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return json({ ok: true, unlinked });
}

// `npm start` has no Electron to show the dialog: Windows' own, through PowerShell. The start folder goes in an
// environment variable, so nothing in it is read as a command.
const PICK = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.ShowNewFolderButton = $false; $d.SelectedPath = $env:BV_START; $o = New-Object System.Windows.Forms.Form; $o.TopMost = $true; if ($d.ShowDialog($o) -eq 'OK') { $d.SelectedPath }";
const pickWithWindows = (start) => new Promise((resolve, reject) => {
  execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', PICK], { windowsHide: true, encoding: 'utf8', env: { ...process.env, BV_START: start ?? '' } },
    (err, out) => (err ? reject(err) : resolve(String(out).trim() || null)));
});

let picking = false;
export async function pickFolder({ request, app }) {
  const start = (await readJson(request))?.start;
  if (picking) return fail(409, 'picking', 'The folder window is already open: look behind this window');
  picking = true;
  try {
    const from = typeof start === 'string' && start && await isFolder(start) ? start : undefined;
    return json({ path: await (app.pickFolder ?? pickWithWindows)(from) ?? null });
  } finally {
    picking = false;
  }
}
