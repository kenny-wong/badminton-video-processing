// Tagging (rallies, starting score, match start and end, serve, format) is
// saved on the match, but belongs to the video it was tagged on. When a
// match's last video is unlinked, the match is cleared back to untouched (no
// tagging, render or YouTube status) and its tagging is kept with the video,
// to be applied to whichever match that video is linked to next. Tagging
// stranded on a match with no video (from before this) can be brought over by hand.

import { nowIso } from './db.js';

const TAG_COLUMNS = ['rallies', 'start_score', 'match_start', 'match_end', 'first_server', 'format', 'court_corners', 'near_at_start', 'track_path', 'tracked_at'];

/** True when the matches row has any tagging worth keeping. */
export const hasTagging = (row) => Boolean(row && ((row.rallies && row.rallies !== '[]') || row.start_score || row.match_start !== null || row.match_end !== null));

/** How many rallies a matches row (or carried tagging) holds. */
export const rallyCount = (row) => {
  try {
    return JSON.parse(row?.rallies ?? '[]').length;
  } catch {
    return 0;
  }
};

const pick = (row) => Object.fromEntries(TAG_COLUMNS.map((c) => [c, row[c] ?? null]));

/** Writes tagging (an object of TAG_COLUMNS) onto a match. */
function writeTagging(db, matchId, tags) {
  db.prepare(`UPDATE matches SET ${TAG_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...TAG_COLUMNS.map((c) => (c === 'first_server' ? tags[c] ?? 'a' : tags[c] ?? null)), nowIso(), matchId);
}

/** Clears a match back to untouched: no tagging, joined file, render or YouTube link. */
function clearMatch(db, matchId) {
  db.prepare(`UPDATE matches SET rallies = '[]', start_score = NULL, match_start = NULL, match_end = NULL, format = NULL, first_server = CASE WHEN game = 2 THEN 'b' ELSE 'a' END,
      court_corners = NULL, near_at_start = NULL, track_path = NULL, tracked_at = NULL,
      source_path = NULL, output_path = NULL, rendered_at = NULL, highlights_path = NULL, highlights_at = NULL,
      youtube_url = NULL, uploaded_at = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), matchId);
}

/**
 * Unlinks a video. If that leaves its match with no video, the match's tagging
 * goes with the video (`carried_tagging`) and the match is cleared.
 * @returns {number|null} the match it was linked to.
 */
export function detachVideo(db, videoId) {
  const v = db.prepare('SELECT match_id FROM videos WHERE id = ?').get(videoId);
  if (!v?.match_id) return null;
  db.prepare('UPDATE videos SET match_id = NULL, part = 1 WHERE id = ?').run(videoId);
  const left = db.prepare('SELECT COUNT(*) AS n FROM videos WHERE match_id = ?').get(v.match_id).n;
  if (left === 0) {
    const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(v.match_id);
    if (hasTagging(row)) db.prepare('UPDATE videos SET carried_tagging = ? WHERE id = ?').run(JSON.stringify(pick(row)), videoId);
    clearMatch(db, v.match_id);
  } else {
    db.prepare('UPDATE matches SET source_path = NULL WHERE id = ?').run(v.match_id);
  }
  return v.match_id;
}

/**
 * After videos are linked to a match: applies the tagging one of them carries,
 * when the match has none of its own.
 * @returns {{ moved: boolean, rallies: number }|null} null when none carried any.
 */
export function applyCarried(db, matchId, videoIds) {
  for (const id of videoIds) {
    const v = db.prepare('SELECT carried_tagging FROM videos WHERE id = ?').get(id);
    if (!v?.carried_tagging) continue;
    const tags = JSON.parse(v.carried_tagging);
    if (hasTagging(db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId))) return { moved: false, rallies: rallyCount(tags) };
    writeTagging(db, matchId, tags);
    db.prepare('UPDATE videos SET carried_tagging = NULL WHERE id = ?').run(id);
    return { moved: true, rallies: rallyCount(tags) };
  }
  return null;
}

/** Moves tagging stranded on one match onto another (replacing its own only with `replace`). */
export function moveTagging(db, fromId, toId, { replace = false } = {}) {
  if (fromId === toId) return false;
  const from = db.prepare('SELECT * FROM matches WHERE id = ?').get(fromId);
  const to = db.prepare('SELECT * FROM matches WHERE id = ?').get(toId);
  if (!hasTagging(from) || !to || (hasTagging(to) && !replace)) return false;
  writeTagging(db, toId, pick(from));
  clearMatch(db, fromId);
  return true;
}

/** Matches in a tournament holding tagging but no video: where tagging can be brought from. */
export function strandedTagging(db, tournamentId, exceptId) {
  return db.prepare(`SELECT * FROM matches m WHERE tournament_id = ? AND id <> ?
      AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.match_id = m.id)
      AND (rallies <> '[]' OR start_score IS NOT NULL OR match_start IS NOT NULL OR match_end IS NOT NULL)
    ORDER BY match_date, match_time`).all(tournamentId, exceptId).filter(hasTagging);
}
