// Brings in every tournament a badminfo player has entered, upcoming and past:
// badminfo's player data lists them, and each one is imported like a pasted
// badminfo link (draws and match times from Badminton England). Tournaments
// already imported are skipped, or with `update` only those are read again for
// new times and results (except finished ones that already have every result). Imports also merge on the Badminton England id, so a
// tournament first imported from a BE link isn't doubled. Tested in
// tests/player-import.test.js.

import { getJson, pageUrl, playerApiUrl, summarizePlayer } from './badminfo.js';
import { fetchTournament, saveTournament } from './tournaments.js';
import { londonDate } from './uk-time.js';

export const SETTLED_DAYS = 3;

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const stopped = () => Object.assign(new Error('Stopped'), { code: 'stopped' });

/**
 * Whether the app already has everything about a tournament: it has ended
 * (before `today`), and either every match has its result, or it has no
 * matches at all and the app last read it after it ended (a camp or training
 * day: there's nothing to come), or the app last read it at least
 * SETTLED_DAYS after it ended (a match still without a result by then was
 * never played, a walkover say, and never gets one). Until then one with any
 * result missing is read again, as results can come late.
 */
export function resultsComplete(db, badminfoId, today = londonDate(Date.now())) {
  const r = db.prepare(`SELECT t.end_date AS end, t.start_date AS start, t.imported_at AS read, COUNT(m.id) AS matches,
      SUM(CASE WHEN m.games <> '[]' OR m.winner IS NOT NULL THEN 1 ELSE 0 END) AS done
    FROM tournaments t LEFT JOIN matches m ON m.tournament_id = t.id AND m.game = 0
    WHERE t.badminfo_id = ? GROUP BY t.id`).get(badminfoId);
  const last = r?.end ?? r?.start;
  if (!r || !last || last >= today) return false;
  const read = String(r.read ?? '').slice(0, 10);
  if (read && read >= addDays(last, SETTLED_DAYS)) return true;
  return r.matches > 0 ? r.done === r.matches : read > last;
}

/**
 * Imports the player's tournaments not in the app yet (or, with `update`, re-reads
 * the ones that are). Returns { player, imported: [{ id, name, matches }],
 * skipped: [{ name, reason }], complete, already } where `complete` counts the finished
 * ones not fetched again on an update (resultsComplete) and `already` the tournaments
 * left alone.
 */
export async function importPlayerTournaments(db, playerId, { update = false, job = null, signal = null, fetchJson = getJson, fetchOne = fetchTournament, today = londonDate(Date.now()) } = {}) {
  const got = await fetchJson(playerApiUrl(playerId), 60);
  const player = got.json ? summarizePlayer(got.json, playerId) : null;
  if (!player) throw Object.assign(new Error(got.error === 'notFound' ? 'badminfo has no player with that id' : 'badminfo couldn’t be reached: try again later'), { code: got.error ?? 'unavailable' });
  const have = new Set(db.prepare('SELECT badminfo_id FROM tournaments WHERE badminfo_id IS NOT NULL').all().map((r) => r.badminfo_id));
  const mine = player.tournaments.filter((t) => have.has(t.id) === update);
  // Updating: a finished tournament with every result in already has nothing new to fetch.
  const complete = update ? mine.filter((t) => resultsComplete(db, t.id, today)) : [];
  const todo = mine.filter((t) => !complete.includes(t));
  const out = { player: player.name, imported: [], skipped: [], complete: complete.length, already: player.tournaments.length - mine.length };
  job?.log(`${player.name}: ${player.tournaments.length} tournaments on badminfo, ${todo.length} to ${update ? 'update' : 'import'}${complete.length ? `, ${complete.length} finished with every result in (not fetched again)` : ''}`);
  for (const [i, t] of todo.entries()) {
    if (signal?.aborted) throw stopped();
    if (job) {
      job.progress = i / todo.length;
      job.message = `${i + 1} of ${todo.length}: ${t.name}`;
    }
    try {
      const full = await fetchOne(pageUrl(t.id));
      out.imported.push({ id: saveTournament(db, full), name: full.name || t.name, matches: full.matches.length, start: t.start });
      job?.log(`${update ? 'Updated' : 'Imported'} ${t.name} (${full.matches.length} matches)`);
    } catch (err) {
      // e.g. a league with no Badminton England page, or BE not answering
      out.skipped.push({ name: t.name, start: t.start, reason: err.message });
      job?.log(`Skipped ${t.name}: ${err.message}`);
    }
  }
  return out;
}
