// GET /api/matches/:id: the match, its videos, tagging and the playable source.
// PUT /api/matches/:id { rallies?, format?, firstServer?, startScore?, matchStart?, matchEnd?, youtubeUrl?, boardStyle? }:
//   saves tagging, the score the video starts at, where the match starts and
//   ends in the video, the YouTube link once uploaded ('' or null clears), and the match's
//   own scoreboard preset and corner (null uses Settings).
// PUT /api/matches/:id/videos { videoIds }: links this video ([] unlinks; a match or game takes one
//   video, so two games filmed separately go to the game rows below). A match
//   left with no video is cleared and its tagging goes with the video, arriving on the
//   next match it is linked to (if that match has none of its own).
// PUT /api/matches/:id/games/:game/videos { videoIds }: the same for one game of the match,
//   giving that game its own row (own tagging, render and YouTube link) on first use.
// POST /api/matches/:id/track: tracks the shuttle (a job). GET /api/matches/:id/track: the sightings.
// GET /api/matches/:id/suggestions: a suggested winner for each rally without one, from the sequences of
//   winners that reach the official result (else, with no result yet, from the tracked shuttle).
// POST /api/matches/:id/take-tagging { from, replace? }: brings tagging stranded on a match with no video.
// POST /api/matches/:id/analyse { sensitivity } | render { cut, overlay, highlights, titleCard?, endCard?, replays? }: starts a job.
// POST /api/matches/:id/reveal { highlights? }: shows the finished video (or highlights) in Explorer.
// GET /api/matches/:id/levels: the sound level along the video (404 until worked out); POST starts working it out (a job).
// POST /api/matches/:id/clip { rally (0-based), upright }: queues a clip of one rally, upright 9:16 following the shuttle or as filmed.
// POST /api/reveal { path }: shows a finished file (inside the output folder) in Explorer.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { normalize } from 'node:path';
import { fail, idParam, json, readJson } from '../lib/http.js';
import { nowIso } from '../lib/db.js';
import { readSettings } from '../lib/settings.js';
import { findTools } from '../lib/ffmpeg.js';
import { findJob, jobView, startJob } from '../lib/jobs.js';
import { analyseMatch, describeOutput, loadMatch, matchFormat, renderMatch, sourceFor } from '../lib/pipeline.js';
import { cleanFormat, cleanRallies, cleanStart, defaultServer, startFor } from '../public/shared/score.js';
import { cleanCorners, courtMapping } from '../public/shared/court.js';
import { readTrack, tracker, trackMatch, trackPoints } from '../lib/track.js';
import { cachedLevels, matchLevels } from '../lib/levels.js';
import { voiceRemover } from '../lib/voices.js';
import { renderClip } from '../lib/clip.js';
import { inferWinners, suggestWinners } from '../lib/winners.js';
import { youtubeId, youtubeUrl } from '../lib/links.js';
import { applyCarried, detachVideo, hasTagging, moveTagging, rallyCount, strandedTagging } from '../lib/tagging.js';
import { teamName } from '../public/shared/names.js';
import { favouriteMatcher, favourites } from '../lib/favourites.js';
import { cleanBoardOverride, resolveBoard } from '../public/shared/board.js';
import { matchPeople } from '../lib/players.js';

function load(app, params) {
  const id = idParam(params.id);
  return id ? loadMatch(app.db, id) : null;
}

export function onRequestGet({ params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const settings = readSettings(app.db);
  const { match } = loaded;
  const sides = favouriteMatcher(app.db, loaded.tournament.id, favourites(app.db));
  const source = sourceFor(loaded);
  const described = { people: matchPeople(app.db, loaded), options: settings.description };
  const jobs = Object.fromEntries(['analyse', 'render', 'track'].map((k) => [k, jobView(findJob(`${k}:${match.id}`))]));
  return json({
    ...loaded,
    source: { ...source, path: undefined, url: source.ready ? `/media/match/${match.id}` : null },
    format: matchFormat(match),
    tracking: { ready: tracker().ready, tracked: Boolean(match.trackPath && existsSync(match.trackPath)), trackedAt: match.trackedAt },
    formatChosen: Boolean(match.format),
    mine: { a: sides(match.teamA).length > 0, b: sides(match.teamB).length > 0 },
    nameStyle: settings.nameStyle,
    board: resolveBoard(settings.board, match.boardStyle),
    cards: settings.cards,
    replays: settings.output.replays,
    voices: { remove: settings.output.removeVoices, ready: voiceRemover().ready },
    output: { ...describeOutput(loaded, null, described), exists: Boolean(match.outputPath && existsSync(match.outputPath)) },
    highlights: { ...describeOutput(loaded, null, { ...described, highlights: true }), exists: Boolean(match.highlightsPath && existsSync(match.highlightsPath)) },
    units: unitsOf(app.db, match),
    stranded: strandedTagging(app.db, match.tournamentId, match.id).map((r) => ({
      id: r.id, date: r.match_date, time: r.match_time, draw: r.draw, round: r.round, teamA: JSON.parse(r.team_a), teamB: JSON.parse(r.team_b), rallies: rallyCount(r),
    })),
    jobs,
  });
}

/** The whole match and its games' own rows (game 0 first), each saying whether a video is linked. */
function unitsOf(db, match) {
  const parent = match.parentId ?? match.id;
  return db.prepare(`SELECT m.id, m.game, EXISTS (SELECT 1 FROM videos v WHERE v.match_id = m.id) AS linked
      FROM matches m WHERE m.id = ? OR m.parent_id = ? ORDER BY m.game`).all(parent, parent)
    .map((r) => ({ id: r.id, game: r.game, linked: Boolean(r.linked) }));
}

/** A time in seconds into the video, null to clear, or undefined when not valid. */
const seconds = (v) => (v === null ? null : Number.isFinite(v) && v >= 0 && v < 86400 ? Math.round(v * 100) / 100 : undefined);

export async function onRequestPut({ request, params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const body = await readJson(request);
  if (!body) return fail(400, 'badInput', 'Expected JSON');
  const { match } = loaded;
  const rallies = body.rallies !== undefined ? cleanRallies(body.rallies) : match.rallies;
  const format = body.format === null ? null : body.format !== undefined ? cleanFormat(body.format) : match.format;
  const firstServer = body.firstServer === 'b' ? 'b' : body.firstServer === 'a' ? 'a' : match.firstServer;
  let startScore = match.startScore;
  if (body.startScore !== undefined) {
    const wanted = match.game && body.startScore ? { games: match.games.slice(0, match.game - 1), points: body.startScore.points } : body.startScore;
    startScore = wanted === null ? null : cleanStart(wanted, format ?? matchFormat(match));
    if (body.startScore !== null && !startScore && ((!match.game && body.startScore?.games?.length) || body.startScore?.points?.some?.(Boolean))) {
      return fail(400, 'badScore', 'That starting score isn’t possible in this format');
    }
  }
  let matchStart = match.matchStart;
  let matchEnd = match.matchEnd;
  for (const [key, v] of [['matchStart', body.matchStart], ['matchEnd', body.matchEnd]]) {
    if (v === undefined) continue;
    const t = seconds(v);
    if (t === undefined) return fail(400, 'badInput', `${key} must be seconds into the video`);
    if (key === 'matchStart') matchStart = t;
    else matchEnd = t;
  }
  if (matchStart !== null && matchEnd !== null && matchEnd <= matchStart) return fail(400, 'badInput', 'The match must end after it starts');
  let corners = match.corners;
  if (body.corners !== undefined) {
    corners = body.corners === null ? null : cleanCorners(body.corners);
    if (body.corners !== null && !corners) return fail(400, 'badInput', 'Those four corners can’t be a court');
  }
  const nearAtStart = body.nearAtStart === 'a' || body.nearAtStart === 'b' ? body.nearAtStart : body.nearAtStart === null ? null : match.nearAtStart;
  const boardStyle = body.boardStyle !== undefined ? cleanBoardOverride(body.boardStyle) : match.boardStyle;
  let link = match.youtubeUrl;
  let uploadedAt = match.uploadedAt;
  if (body.youtubeUrl !== undefined) {
    if (body.youtubeUrl === null || body.youtubeUrl === '') {
      link = null;
      uploadedAt = null;
    } else {
      const vid = youtubeId(body.youtubeUrl);
      if (!vid) return fail(400, 'badLink', 'That isn’t a YouTube video link');
      if (youtubeUrl(vid) !== link) uploadedAt = nowIso();
      link = youtubeUrl(vid);
    }
  }
  app.db.prepare(`UPDATE matches SET rallies = ?, format = ?, first_server = ?, start_score = ?, match_start = ?, match_end = ?,
      youtube_url = ?, uploaded_at = ?, court_corners = ?, near_at_start = ?, board_style = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(rallies), format ? JSON.stringify(format) : null, firstServer, startScore ? JSON.stringify(startScore) : null,
      matchStart, matchEnd, link, uploadedAt, corners ? JSON.stringify(corners) : null, nearAtStart, boardStyle ? JSON.stringify(boardStyle) : null, nowIso(), match.id);
  return json({ ok: true, rallies: rallies.length, startScore, matchStart, matchEnd, youtubeUrl: link, uploadedAt, corners, nearAtStart, boardStyle,
    board: resolveBoard(readSettings(app.db).board, boardStyle) });
}

export async function linkVideos({ request, params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const body = await readJson(request);
  const ids = Array.isArray(body?.videoIds) ? [...new Set(body.videoIds.filter((x) => Number.isInteger(x) && x > 0))] : null;
  if (!ids) return fail(400, 'badInput', 'Expected a list of video ids');
  if (ids.length > 1) return fail(400, 'oneVideo', 'A match or game takes one video. For games filmed separately, link each video to its game.');
  const { match, videos } = loaded;
  const { db } = app;
  let tagging = null;
  db.exec('BEGIN');
  try {
    // Videos leaving this match, then videos coming from another match, are unlinked first.
    for (const v of videos) if (!ids.includes(v.id)) detachVideo(db, v.id);
    for (const v of ids) {
      const row = db.prepare('SELECT match_id FROM videos WHERE id = ?').get(v);
      if (row?.match_id && row.match_id !== match.id) detachVideo(db, v);
    }
    for (const v of ids) db.prepare('UPDATE videos SET match_id = ?, part = 1 WHERE id = ?').run(match.id, v);
    tagging = applyCarried(db, match.id, ids);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return json({ ok: true, tagging });
}

/** The row for one game of a match, made from the match the first time. */
export function gameRow(db, parentId, game) {
  const existing = db.prepare('SELECT id FROM matches WHERE parent_id = ? AND game = ?').get(parentId, game);
  if (existing) return existing.id;
  db.prepare(`INSERT INTO matches (tournament_id, parent_id, game, match_date, match_time, starts_at, draw, round, court, duration, team_a, team_b, games, winner, format, first_server)
    SELECT tournament_id, id, ?, match_date, match_time, starts_at, draw, round, court, duration, team_a, team_b, games, winner, format, ? FROM matches WHERE id = ? AND game = 0`)
    .run(game, defaultServer(game), parentId);
  return db.prepare('SELECT id FROM matches WHERE parent_id = ? AND game = ?').get(parentId, game)?.id ?? null;
}

export async function linkGameVideos({ request, params, app }) {
  const parent = load(app, params);
  const game = idParam(params.game);
  if (!parent || parent.match.game || !game || game > 5) return fail(404, 'notFound', 'No such match or game');
  const id = gameRow(app.db, parent.match.id, game);
  return linkVideos({ request, params: { id: String(id) }, app });
}

export function track({ params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const { settings, tools: t } = tools(app);
  if (!t) return noFfmpeg();
  if (!tracker().ready) return fail(503, 'noTracker', 'Shuttle tracking isn’t set up yet: run analysis\\setup.ps1 once (see the README).');
  const id = loaded.match.id;
  const job = startJob('track', `track:${id}`, (j, signal) => trackMatch(app.db, t, settings, id, { signal, job: j }), { queue: 'gpu', label: `Track the shuttle: ${matchLabel(loaded.match)}` });
  return json(jobView(job), 202);
}

export async function trackData({ params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const data = await readTrack(loaded.match.trackPath);
  if (!data) return fail(404, 'notTracked', 'The shuttle hasn’t been tracked for this match yet');
  const r = (n) => Math.round(n * 1000) / 1000;
  return json({ points: trackPoints(data).map((p) => [r(p.t), r(p.x), r(p.y)]) });
}

export async function suggestions({ params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const { match } = loaded;
  const data = await readTrack(match.trackPath);
  const points = data ? trackPoints(data) : [];
  const toCourt = courtMapping(match.corners)?.toCourt ?? null;
  const common = { rallies: match.rallies, format: matchFormat(match), start: startFor(match) ?? { games: [], points: [0, 0] }, oneGame: match.game > 0 };
  // The official score of what this video shows: the match, or the games up to this one.
  const official = match.game ? match.games.slice(0, match.game) : match.games;
  const result = match.game ? official.length === match.game : official.length > 0 && Boolean(match.winner);
  if (result) {
    const list = inferWinners({ ...common, firstServer: match.firstServer ?? 'a', finalGames: official });
    return json({ suggestions: list, method: 'result', possible: list.every((x) => x.possible !== false), result: official });
  }
  if (!data) return fail(400, 'noResult', 'Suggestions need the official result (Update results on the tournament page) or the tracked shuttle');
  if (!match.nearAtStart) return fail(400, 'noEnds', 'Say which team is at the near end when the video starts');
  const list = suggestWinners({ ...common, points, toCourt, nearAtStart: match.nearAtStart });
  return json({ suggestions: list, method: 'shuttle', possible: true, shuttle: true, court: Boolean(match.corners) });
}

export async function takeTagging({ request, params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const body = await readJson(request);
  const from = Number.isInteger(body?.from) ? body.from : null;
  const source = from && app.db.prepare('SELECT * FROM matches WHERE id = ? AND tournament_id = ?').get(from, loaded.match.tournamentId);
  if (!source || !hasTagging(source)) return fail(404, 'notFound', 'That match has no tagging to bring');
  const target = app.db.prepare('SELECT * FROM matches WHERE id = ?').get(loaded.match.id);
  if (hasTagging(target) && body.replace !== true) return fail(409, 'hasTagging', 'This match already has tagging');
  moveTagging(app.db, source.id, loaded.match.id, { replace: true });
  return json({ ok: true, rallies: rallyCount(source) });
}

function tools(app) {
  const settings = readSettings(app.db);
  const found = findTools(settings.ffmpegFolder);
  return { settings, tools: found };
}

const noFfmpeg = () => fail(503, 'noFfmpeg', 'FFmpeg wasn’t found. Install it (winget install Gyan.FFmpeg) or set its folder in Settings.');

export async function levels({ params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const found = await cachedLevels(app.db, readSettings(app.db), loaded.match.id);
  return found ? json(found) : fail(404, 'notReady', 'The sound levels haven’t been worked out yet');
}

export function startLevels({ params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const { settings, tools: t } = tools(app);
  if (!t) return noFfmpeg();
  const id = loaded.match.id;
  const job = startJob('levels', `levels:${id}`, (j, signal) => matchLevels(app.db, t, settings, id, { signal, job: j }), { label: `Sound levels: ${matchLabel(loaded.match)}` });
  return json(jobView(job), 202);
}

export async function clip({ request, params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const { settings, tools: t } = tools(app);
  if (!t) return noFfmpeg();
  const body = (await readJson(request)) ?? {};
  const index = Number.isInteger(body.rally) ? body.rally : -1;
  if (!loaded.match.rallies[index]) return fail(400, 'badInput', 'Choose a rally first');
  const upright = body.upright !== false;
  const removeVoices = typeof body.removeVoices === 'boolean' ? body.removeVoices : settings.output.removeVoices;
  const id = loaded.match.id;
  const job = startJob('clip', `clip:${id}:${index}:${upright ? 'u' : 'w'}`, (j, signal) => renderClip(app.db, t, settings, id, { index, upright, removeVoices, signal, job: j }),
    { queue: 'gpu', label: `Clip of rally ${index + 1}${upright ? ' (upright)' : ''}: ${matchLabel(loaded.match)}` });
  return json(jobView(job), 202);
}

export async function revealPath({ request, app }) {
  const body = (await readJson(request)) ?? {};
  const root = normalize(readSettings(app.db).outputFolder).toLowerCase();
  const path = typeof body.path === 'string' ? normalize(body.path) : '';
  if (!path || !path.toLowerCase().startsWith(root) || !existsSync(path)) return fail(404, 'notFound', 'That file isn’t in the output folder any more');
  if (process.platform === 'win32') spawn('explorer.exe', [selectArg(path)], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  return json({ ok: true, path });
}

export async function analyse({ request, params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const { settings, tools: t } = tools(app);
  if (!t) return noFfmpeg();
  const body = (await readJson(request)) ?? {};
  const sensitivity = Number.isFinite(body.sensitivity) && body.sensitivity >= 1 && body.sensitivity <= 10 ? body.sensitivity : settings.sensitivity;
  const id = loaded.match.id;
  const job = startJob('analyse', `analyse:${id}`, (j, signal) => analyseMatch(app.db, t, settings, id, { sensitivity, signal, job: j }));
  return json(jobView(job), 202);
}

export async function render({ request, params, app }) {
  const loaded = load(app, params);
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const { settings, tools: t } = tools(app);
  if (!t) return noFfmpeg();
  const body = (await readJson(request)) ?? {};
  const job = startRender(app, t, settings, loaded.match, body);
  return json(jobView(job), 202);
}

/** "Lee v Ho, game 2" for the jobs page. */
export const matchLabel = (m) => `${teamName(m.teamA)} v ${teamName(m.teamB)}${m.game ? `, game ${m.game}` : ''}`;

/** Queues a render of a match (or game) with the options from the page, or Settings' where not given. */
export function startRender(app, t, settings, match, body = {}) {
  const id = match.id;
  const what = body.highlights === true ? 'Highlights' : 'Render';
  return startJob('render', `render:${id}`, (j, signal) => renderMatch(app.db, t, settings, id, {
    cut: body.cut !== false, overlay: body.overlay !== false, highlights: body.highlights === true,
    titleCard: typeof body.titleCard === 'boolean' ? body.titleCard : settings.cards.title, endCard: typeof body.endCard === 'boolean' ? body.endCard : settings.cards.end,
    replays: typeof body.replays === 'boolean' ? body.replays : settings.output.replays,
    removeVoices: typeof body.removeVoices === 'boolean' ? body.removeVoices : settings.output.removeVoices, signal, job: j,
  }), { queue: 'gpu', label: `${what}: ${matchLabel(match)}` });
}

/**
 * Explorer's argument to open a folder with a file selected: /select,"D:\a b\c.mp4".
 * It must reach Explorer exactly like this (passed verbatim): Node's usual quoting
 * of the whole argument, needed for paths with spaces, makes Explorer open its
 * default folder instead.
 */
export const selectArg = (path) => `/select,"${normalize(path)}"`;

export async function reveal({ request, params, app }) {
  const loaded = load(app, params);
  const body = (await readJson(request)) ?? {};
  const path = body.highlights === true ? loaded?.match.highlightsPath : loaded?.match.outputPath;
  if (!path || !existsSync(path)) return fail(404, 'notFound', 'The finished video isn’t there any more');
  if (process.platform === 'win32') spawn('explorer.exe', [selectArg(path)], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  return json({ ok: true, path });
}
