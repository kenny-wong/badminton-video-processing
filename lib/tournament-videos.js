// A tournament's own video folder: where it is now, which videos are the
// tournament's, which match each one shows, and linking the sure ones by
// itself after a scan. (Matching itself: lib/matching.js; finding a folder
// whose drive letter changed: lib/locate.js.)

import { dirname, relative } from 'node:path';
import { matchFromRow, nowIso, tournamentFromRow, videoFromRow } from './db.js';
import { favouriteMatcher, favourites } from './favourites.js';
import { findFolder, inFolder, samePath } from './locate.js';
import { groupParts, lineUpAll, PART_GAP_S, perVideo } from './matching.js';
import { matchFormat } from './pipeline.js';
import { gameRow, linkVideo } from './tagging.js';

const DAY_MS = 86400000;
export const SHORTEST_S = 90;   // a game takes minutes: shorter clips aren't matched
const SURE_MARGIN = 12;         // how much worse the next best line-up must be to link by itself
const SURE_MARGIN_ANYONE = 25;  // when it isn't known whose matches were filmed
const SURE_FIT = 45;            // the most a video's length may be off
const ONE_PLAYER = 60;          // how much worse one player's matches may explain the videos than everyone's, to be taken for theirs

export const getTournament = (db, id) => tournamentFromRow(id ? db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) : null);

/** Every tournament with a folder: [{ id, folder }]. */
export const allFolders = (db) => db.prepare('SELECT id, video_folder FROM tournaments WHERE video_folder IS NOT NULL').all().map((r) => ({ id: r.id, folder: r.video_folder }));

/** The tournament whose folder a path is in (the innermost folder), or null; `prefer` wins a shared one. */
export function folderOwner(folders, path, prefer = null) {
  const hits = folders.filter((f) => inFolder(path, f.folder)).sort((x, y) => samePath(y.folder).length - samePath(x.folder).length);
  if (!hits.length) return null;
  const inner = hits.filter((f) => samePath(f.folder) === samePath(hits[0].folder));
  return (inner.find((f) => f.id === prefer) ?? inner[0]).id;
}

/**
 * Unlinked videos that may be this tournament's: in its own folder, or
 * recorded around its dates and not in another tournament's folder.
 */
export function freeVideos(db, tournament) {
  const folders = allFolders(db);
  const from = tournament.start ? Date.parse(`${tournament.start}T00:00:00Z`) - DAY_MS : Infinity;
  const to = Date.parse(`${tournament.end ?? tournament.start}T00:00:00Z`) + 2 * DAY_MS;
  return db.prepare('SELECT * FROM videos WHERE match_id IS NULL AND missing = 0 ORDER BY recorded_at, path').all().map(videoFromRow).filter((v) => {
    const owner = folderOwner(folders, v.path, tournament.id);
    if (owner) return owner === tournament.id;
    const at = Date.parse(v.recordedAt);
    return at >= from && at < to;
  });
}

/** Where the tournament's folder is now (its new place is remembered), or null when it can't be found. */
export async function currentFolder(db, tournament, drives, { quick = false } = {}) {
  const { id, videoFolder } = tournament;
  if (!videoFolder) return null;
  const files = db.prepare('SELECT path, size FROM videos').all().filter((v) => inFolder(v.path, videoFolder))
    .map((v) => ({ tail: relative(videoFolder, v.path), size: v.size }));
  const now = await findFolder(videoFolder, drives, { files, quick });
  if (now && now !== videoFolder) db.prepare('UPDATE tournaments SET video_folder = ? WHERE id = ?').run(now, id);
  return now;
}

/** Unfilmed games of matches filmed in part: a video right before or after a linked game's is the game beside it. */
function besideLinked(rows, linked, free, gamesOf) {
  const gameOf = new Map(rows.filter((m) => m.game).map((m) => [m.id, m]));
  const byId = new Map([...linked, ...free].map((v) => [v.id, v]));
  const taken = new Set(linked.map((v) => gameOf.get(v.matchId)).filter(Boolean).map((m) => `${m.parentId}:${m.game}`));
  const groups = groupParts([...byId.values()].map((v) => ({ id: v.id, recordedAt: Date.parse(v.recordedAt), duration: v.duration })), PART_GAP_S);
  const out = [];
  for (const g of groups) {
    const list = g.ids.map((id) => byId.get(id));
    const seen = list.map((v) => (v.matchId ? gameOf.get(v.matchId) ?? null : undefined)); // undefined: free; null: a whole match's
    const parents = new Set(seen.filter((x) => x !== undefined).map((m) => m?.parentId ?? null));
    if (parents.size !== 1 || parents.has(null)) continue;
    const [parentId] = parents;
    const last = gamesOf(parentId);
    const games = seen.map((m) => m?.game ?? null);
    // Forward from each linked game, then back to before the first one.
    for (let i = 1; i < games.length; i++) if (games[i] === null && games[i - 1] !== null) games[i] = games[i - 1] + 1;
    for (let i = games.length - 2; i >= 0; i--) if (games[i] === null && games[i + 1] !== null) games[i] = games[i + 1] - 1;
    list.forEach((v, i) => {
      const key = `${parentId}:${games[i]}`;
      if (v.matchId || games[i] < 1 || games[i] > last || taken.has(key)) return;
      taken.add(key);
      out.push({ ids: [v.id], matchId: parentId, game: games[i], lateMin: null, sure: true });
    });
  }
  return out;
}

/**
 * Which match (or game) each of the unlinked videos shows.
 * @returns {{ suggestions: { ids: [number], matchId: number, game: number, lateMin: number|null, sure: boolean }[], whose: number|null, askWhose: boolean }}
 *   whose: the key of the favourite whose matches were taken, null for every starred player's (or everyone's).
 *   askWhose: nothing is sure until the user says whose matches were filmed.
 */
export function suggestLinks(db, tournament, free, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const favs = favourites(db);
  const sides = favouriteMatcher(db, tournament.id, favs);
  const rows = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY match_date, match_time, draw, id, game').all(tournament.id).map(matchFromRow);
  const linked = db.prepare('SELECT v.* FROM videos v JOIN matches m ON m.id = v.match_id WHERE m.tournament_id = ?').all(tournament.id).map(videoFromRow);
  const whole = new Map(rows.filter((m) => !m.game).map((m) => [m.id, m]));
  const gamesOf = (id) => { const m = whole.get(id); return m.games.length || matchFormat(m).bestOf; };
  const long = free.filter((v) => (v.duration ?? 0) >= SHORTEST_S && v.recordedAt);
  const beside = besideLinked(rows, linked, long, gamesOf);
  const placed = new Set(beside.flatMap((s) => s.ids));
  const filmed = new Set(linked.map((v) => rows.find((m) => m.id === v.matchId)?.parentId ?? v.matchId));
  const matches = [...whole.values()].map((m) => ({
    taken: filmed.has(m.id),
    id: m.id, startsAt: Date.parse(m.startsAt), duration: m.duration, games: m.games, date: m.date, keys: new Set([...sides(m.teamA), ...sides(m.teamB)]),
  }))
    // A match of an earlier day without a score, where others have one, wasn't played.
    .filter((m, _, list) => m.taken || m.games.length || m.date >= today || !list.some((x) => x.games.length && x.date === m.date));
  const groups = groupParts(long.filter((v) => !placed.has(v.id)).map((v) => ({ id: v.id, recordedAt: Date.parse(v.recordedAt), duration: v.duration })));
  const anyMine = [...whole.values()].some((m) => sides(m.teamA).length || sides(m.teamB).length);
  const candidates = anyMine ? matches.filter((m) => m.keys.size || m.taken) : matches;
  const pins = [...filmed].map((id) => {
    const starts = linked.filter((v) => v.recordedAt && (v.matchId === id || rows.find((m) => m.id === v.matchId)?.parentId === id)).map((v) => Date.parse(v.recordedAt));
    return starts.length ? { ids: [], pin: id, start: Math.min(...starts), end: Math.max(...starts) } : null;
  }).filter(Boolean);
  const all = [...groups, ...pins];
  const everyone = lineUpAll(all, candidates);

  // Whose matches: the player chosen on the tournament's Videos page; else the one whose own matches explain
  // the videos about as well as all the starred players' together.
  const here = favs.filter((f) => [...whole.values()].some((m) => sides(m.teamA).includes(f.key) || sides(m.teamB).includes(f.key)));
  const theirs = (key) => lineUpAll(all, candidates.filter((m) => m.keys.has(key)));
  const chosen = here.find((f) => String(f.key) === tournament.videoPlayer)?.key ?? null;
  let result = everyone;
  let whose = chosen;
  if (chosen !== null) result = theirs(chosen);
  else if (tournament.videoPlayer !== 'all' && here.length) {
    const each = here.map((f) => ({ key: f.key, ...theirs(f.key) })).sort((x, y) => x.total - y.total);
    if (here.length === 1 || each[0].total <= everyone.total + ONE_PLAYER) {
      result = each[0];
      whose = each[0].key;
    }
  }
  // Several starred players played and no one's matches stand out: the user says whose were filmed first.
  const askWhose = whose === null && here.length > 1 && tournament.videoPlayer !== 'all';
  const margin = whose !== null ? SURE_MARGIN : askWhose ? Infinity : SURE_MARGIN_ANYONE;
  const timed = perVideo(result.suggestions, gamesOf).map(({ ids, matchId, game, lateMin, fit, margin: by }) => ({
    ids, matchId, game, lateMin, sure: by >= margin && (fit === null || fit <= SURE_FIT),
  }));
  // Matches played in another order than planned can't be lined up past the linked ones: the rest are only suggested.
  const done = new Set(result.suggestions.flatMap((s) => s.ids));
  const used = new Set(result.suggestions.map((s) => s.matchId));
  const rest = pins.length ? lineUpAll(groups.filter((g) => !g.ids.some((id) => done.has(id))),
    candidates.filter((m) => !m.taken && !used.has(m.id) && (whose === null || m.keys.has(whose)))).suggestions : [];
  const maybe = perVideo(rest, gamesOf).map(({ ids, matchId, game, lateMin }) => ({ ids, matchId, game, lateMin, sure: false }));
  return { suggestions: [...beside, ...timed, ...maybe], whose, askWhose: askWhose && timed.length > 0 };
}

/**
 * Links the videos in the tournament's own folder that aren't linked, weren't
 * unlinked by hand, and surely show a match or game without a video.
 * @returns {{ linked: { videoId, name, matchId, parentId, game, lateMin, tagging }[], unsure: number, short: number, left: number, askWhose: boolean }}
 */
export function autoLink(db, tournament, { today } = {}) {
  const folders = allFolders(db);
  const mine = freeVideos(db, tournament).filter((v) => folderOwner(folders, v.path, tournament.id) === tournament.id);
  const open = mine.filter((v) => !v.noAuto);
  // Those unlinked by hand stay in the line-up, so the matches they show aren't given to other videos.
  const { suggestions, askWhose } = suggestLinks(db, tournament, mine, { today });
  const may = new Set(open.map((v) => v.id));
  const names = new Map(mine.map((v) => [v.id, v.name]));
  const sure = suggestions.filter((s) => s.sure && may.has(s.ids[0]));
  const linked = [];
  db.exec('BEGIN');
  try {
    for (const s of sure) {
      const unit = s.game ? gameRow(db, s.matchId, s.game) : s.matchId;
      const tagging = linkVideo(db, unit, s.ids[0]);
      linked.push({ videoId: s.ids[0], name: names.get(s.ids[0]), matchId: unit, parentId: s.matchId, game: s.game, lateMin: s.lateMin, tagging });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const short = open.filter((v) => (v.duration ?? 0) < SHORTEST_S).length;
  return { linked, unsure: suggestions.filter((s) => !s.sure && may.has(s.ids[0])).length, short, left: mine.length - linked.length, askWhose };
}

/** The folders other tournaments' folders are in: where this one's probably is too. */
export const folderParents = (db, settings) => [...new Set([...allFolders(db).map((f) => dirname(f.folder)), ...settings.videoFolders])];

export const markScanned = (db, id) => db.prepare('UPDATE tournaments SET videos_scanned_at = ? WHERE id = ?').run(nowIso(), id);
