// Rallies from the enrolment planner (2.1.0). Parents with a VIP account on the planner record
// games rally by rally on their phones, and the planner shares each recorded game of a BE match
// between all VIP accounts. A match or game whose video has no tagging of its own takes those
// rallies: each rally is put on the video by the clock (the time of its first tap and of the tap
// where it ended, against the time the video began recording), with its winner, who served first
// and the score the video starts at. Tagging that is already there is never touched, a row is
// filled once per video (a tagging cleared by hand stays cleared), and what is filled is marked as
// tagged automatically, to be reviewed. Only a game recorded to its end with every tap timed is used.

import { apiUrl, getJson } from './badminfo.js';
import { nowIso, parseJson } from './db.js';
import { call, connection, matchInfo, matchKey } from './planner.js';
import { cleanStart, matchFormat } from '../public/shared/score.js';
import { matchFromRow } from './db.js';

export const PAD_BEFORE = 2.5; // seconds before a rally's first tap (the serve comes before it)
export const PAD_AFTER = 1; // seconds after the tap where it ended
const MIN_INSIDE = 0.6; // the share of a game's rallies that must fall inside the video
const RETRY_MS = 3600_000;
const BATCH = 100; // keys in one call (the planner takes 100)

const other = (p) => (p === 'a' ? 'b' : 'a');

/**
 * The rallies of the planner's games (`games`: as /api/video-records gives them for one match) as
 * this app tags them on a video: { rallies, firstServer, startScore, placed, total }, or { reason }:
 * noRecord, untimed (some taps have no time), unfinished (still being recorded), otherPeople,
 * outside (the clock doesn't put most of it on this video).
 * `unit`: { game (0 = the whole match), recordedAt (ms), duration (s), teams (badminfo's two sides,
 * this app's team a first: [[{ id }], [{ id }]]) }.
 */
export function placeRecords(games, unit) {
  const list = [...(games ?? [])].sort((x, y) => x.number - y.number);
  if (!list.length) return { reason: 'noRecord' };
  const ourA = unit.teams[0].map((p) => p.id);
  const { a, b } = list[0].sides;
  const swap = !a.every((id) => ourA.includes(id));
  if (swap && !b.every((id) => ourA.includes(id))) return { reason: 'otherPeople' };
  const ours = (p) => (p === 'a' || p === 'b' ? (swap ? other(p) : p) : null);
  const pair = (x, y) => (swap ? [y, x] : [x, y]);
  // A game's video takes that game; the whole match's takes the games recorded from the first on.
  let chosen = [];
  if (unit.game) chosen = list.filter((g) => g.number === unit.game);
  else for (let n = 1; list.some((g) => g.number === n); n += 1) { const g = list.find((x) => x.number === n); chosen.push(g); if (!g.over) break; }
  if (!chosen.length) return { reason: 'noRecord' };
  if (chosen.some((g) => !g.timed)) return { reason: 'untimed' };
  if (!chosen.at(-1).over) return { reason: 'unfinished' };
  const all = chosen.flatMap((g) => g.rallies.map((r, i) => ({ ...r, game: g, before: i ? [g.rallies[i - 1].a, g.rallies[i - 1].b] : [g.startA, g.startB],
    server: i ? g.rallies[i - 1].winner : g.firstServer })));
  const at = (ms) => (ms - unit.recordedAt) / 1000;
  const inside = all.filter((r) => at(r.at) >= 0 && at(r.end) <= unit.duration);
  if (!inside.length || inside.length < all.length * MIN_INSIDE) return { reason: 'outside' };
  const rallies = [];
  for (const r of inside) {
    const start = Math.max(0, at(r.at) - PAD_BEFORE, rallies.at(-1)?.end ?? 0);
    const end = Math.min(unit.duration, Math.max(at(r.end), at(r.at)) + PAD_AFTER);
    if (end > start) rallies.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, winner: ours(r.winner) });
  }
  const first = inside[0];
  const before = chosen.filter((g) => g.number < first.game.number).map((g) => pair(g.score.a, g.score.b));
  const points = pair(...first.before);
  return {
    rallies,
    firstServer: ours(first.server),
    startScore: before.length || points.some(Boolean) ? { games: before, points } : null,
    placed: rallies.length,
    total: all.length,
  };
}

// ---------- Which rows, and the planner's key of their match ----------

/** Match and game rows with a video and no tagging, not filled from the planner for this video before. */
export function waitingUnits(db) {
  return db.prepare(`SELECT m.*, v.id AS video_id, v.recorded_at, v.duration FROM matches m
      JOIN videos v ON v.match_id = m.id AND v.missing = 0 AND v.recorded_at IS NOT NULL AND v.duration > 0
      WHERE m.rallies = '[]' AND m.start_score IS NULL AND m.match_start IS NULL AND m.match_end IS NULL
        AND NOT EXISTS (SELECT 1 FROM planner_records r WHERE r.unit_id = m.id AND r.video_id = v.id)
      ORDER BY m.id`).all();
}

/** The planner's key and badminfo's sides of a whole match: from what was sent with its links, or looked up once. */
async function keyOf(db, id, tournaments) {
  const sent = db.prepare("SELECT be_key, sides FROM planner_links WHERE match_id = ? AND sides IS NOT NULL").get(id);
  if (sent) return { key: sent.be_key, sides: parseJson(sent.sides, null) };
  const kept = db.prepare('SELECT * FROM planner_keys WHERE match_id = ?').get(id);
  if (kept?.be_key) return { key: kept.be_key, sides: parseJson(kept.sides, null) };
  if (kept && Date.now() - Date.parse(kept.looked_at) < RETRY_MS) return { reason: kept.reason };
  const m = matchInfo(db, id);
  let got;
  if (!m.badminfoId) got = { reason: 'custom' };
  else {
    if (!tournaments.has(m.badminfoId)) tournaments.set(m.badminfoId, (await getJson(apiUrl(m.badminfoId))).json ?? null);
    const json = tournaments.get(m.badminfoId);
    got = json ? matchKey(json, m.badminfoId, m) : { reason: 'unavailable' };
  }
  db.prepare(`INSERT INTO planner_keys (match_id, be_key, sides, reason, looked_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (match_id) DO UPDATE SET be_key = excluded.be_key, sides = excluded.sides, reason = excluded.reason, looked_at = excluded.looked_at`)
    .run(id, got.key ?? null, got.sides ? JSON.stringify(got.sides) : null, got.reason ?? null, nowIso());
  return got;
}

// ---------- Filling ----------

const state = { at: null, filled: [], waiting: [], error: null }; // of the last run, for Settings

export const WHY = {
  noRecord: 'nobody has recorded this game on the planner yet',
  untimed: 'it was recorded without tap times, so it can’t be put on the video',
  unfinished: 'it is still being recorded',
  otherPeople: 'the planner’s record has other players',
  outside: 'the recording times don’t put the rallies on this video (check the phone’s clock or the video’s recording time)',
  badStart: 'the score the video starts at doesn’t fit the match’s format',
};

/**
 * Fills every waiting row the planner has a record for. Nothing happens unless connected. Throws
 * when the planner can't be asked (the next run tries again).
 */
export async function fillFromRecords(app) {
  const { db } = app;
  const conn = connection(app.dataDir);
  if (!conn) return { filled: 0 };
  const units = waitingUnits(db);
  const tournaments = new Map();
  const keys = new Map(); // whole match id -> { key, sides }
  for (const u of units) {
    const top = u.parent_id ?? u.id;
    if (!keys.has(top)) keys.set(top, await keyOf(db, top, tournaments));
  }
  const wanted = [...new Set([...keys.values()].map((k) => k.key).filter(Boolean))];
  const records = {};
  for (let i = 0; i < wanted.length; i += BATCH) {
    const answer = await call(conn, { path: `/api/video-records?keys=${encodeURIComponent(wanted.slice(i, i + BATCH).join(','))}` });
    Object.assign(records, answer.records ?? {});
  }
  const filled = []; const waiting = [];
  const write = db.prepare(`UPDATE matches SET rallies = ?, first_server = COALESCE(?, first_server), server_set = CASE WHEN ? IS NULL THEN server_set ELSE 1 END,
      start_score = ?, auto_tagged = ?, updated_at = ?
      WHERE id = ? AND rallies = '[]' AND start_score IS NULL AND match_start IS NULL AND match_end IS NULL`);
  const mark = db.prepare('INSERT OR REPLACE INTO planner_records (unit_id, video_id, be_key, rallies, applied_at) VALUES (?, ?, ?, ?, ?)');
  for (const u of units) {
    const k = keys.get(u.parent_id ?? u.id);
    const games = k?.key ? records[k.key] : null;
    if (!games?.length || !k.sides) continue; // nothing recorded (or the match can't be told): looked at again next time
    const match = matchFromRow(u);
    const placed = placeRecords(games, { game: u.game, recordedAt: Date.parse(u.recorded_at), duration: u.duration, teams: k.sides });
    const label = `${parseJson(u.team_a, []).join(' / ')} v ${parseJson(u.team_b, []).join(' / ')}${u.game ? `, game ${u.game}` : ''}`;
    if (placed.reason) { waiting.push({ matchId: u.id, label, why: WHY[placed.reason] ?? placed.reason }); continue; }
    let start = null;
    if (placed.startScore) {
      const wantedStart = u.game ? { games: (match.games ?? []).slice(0, u.game - 1), points: placed.startScore.points } : placed.startScore;
      start = cleanStart(wantedStart, matchFormat(match));
      if (!start) { waiting.push({ matchId: u.id, label, why: WHY.badStart }); continue; }
    }
    const now = nowIso();
    const done = write.run(JSON.stringify(placed.rallies), placed.firstServer, placed.firstServer, start ? JSON.stringify(start) : null, now, now, u.id);
    if (!done.changes) continue; // tagged meanwhile: left alone
    mark.run(u.id, u.video_id, k.key, placed.placed, now);
    filled.push({ matchId: u.id, label, rallies: placed.placed, of: placed.total });
    console.log(`Planner: ${placed.placed} rallies of ${label} filled from a recorded game`);
  }
  state.at = nowIso();
  state.filled = [...filled, ...state.filled].slice(0, 20);
  state.waiting = waiting;
  return { filled: filled.length };
}

/** For Settings: what was filled lately and what is waiting, with why. */
export const recordsStatus = () => ({ at: state.at, filled: state.filled, waiting: state.waiting });
