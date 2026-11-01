// Brings in every tournament a badminfo player has entered, upcoming and past:
// badminfo's player data lists them, and each one is imported like a pasted
// badminfo link (draws and match times from Badminton England). Tournaments
// already imported are skipped, or with `update` only those are read again for
// new times and results. Imports also merge on the Badminton England id, so a
// tournament first imported from a BE link isn't doubled. Tested in
// tests/player-import.test.js.

import { getJson, pageUrl, playerApiUrl, summarizePlayer } from './badminfo.js';
import { fetchTournament, saveTournament } from './tournaments.js';

const stopped = () => Object.assign(new Error('Stopped'), { code: 'stopped' });

/**
 * Imports the player's tournaments not in the app yet (or, with `update`, re-reads
 * the ones that are). Returns { player, imported: [{ id, name, matches }],
 * skipped: [{ name, reason }], already } where `already` counts the tournaments
 * left alone.
 */
export async function importPlayerTournaments(db, playerId, { update = false, job = null, signal = null, fetchJson = getJson, fetchOne = fetchTournament } = {}) {
  const got = await fetchJson(playerApiUrl(playerId), 60);
  const player = got.json ? summarizePlayer(got.json, playerId) : null;
  if (!player) throw Object.assign(new Error(got.error === 'notFound' ? 'badminfo has no player with that id' : 'badminfo couldn’t be reached: try again later'), { code: got.error ?? 'unavailable' });
  const have = new Set(db.prepare('SELECT badminfo_id FROM tournaments WHERE badminfo_id IS NOT NULL').all().map((r) => r.badminfo_id));
  const todo = player.tournaments.filter((t) => have.has(t.id) === update);
  const out = { player: player.name, imported: [], skipped: [], already: player.tournaments.length - todo.length };
  job?.log(`${player.name}: ${player.tournaments.length} tournaments on badminfo, ${todo.length} to ${update ? 'update' : 'import'}`);
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
