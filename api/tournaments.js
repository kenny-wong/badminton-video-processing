// GET /api/tournaments: every imported tournament with counts.
// POST /api/tournaments { link }: imports (or re-imports) one.
// GET /api/tournaments/:id: its matches (each with its games' own rows, `units`, when
//   filmed game by game), their videos and suggested links.
// POST /api/tournaments/:id/refresh: re-reads its matches and results.
// DELETE /api/tournaments/:id: forgets it (video files are untouched).

import { fail, idParam, json, readJson, serverError } from '../lib/http.js';
import { fetchTournament, saveTournament } from '../lib/tournaments.js';
import { matchFromRow, tournamentFromRow, videoFromRow } from '../lib/db.js';
import { readSettings } from '../lib/settings.js';
import { groupParts, suggest } from '../lib/matching.js';
import { isMine } from '../public/shared/names.js';
import { checkResult, replayMatch } from '../public/shared/score.js';
import { matchFormat } from '../lib/pipeline.js';
import { beTournamentUrl } from '../lib/links.js';
import { myPlayers, refreshProfiles, tournamentPeople } from '../lib/players.js';

const STATUS = { badLink: 400, notFound: 404, unavailable: 502 };

export function onRequestGet({ app }) {
  const rows = app.db.prepare(`SELECT t.*,
      (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id AND m.game = 0) AS match_count,
      (SELECT COUNT(DISTINCT COALESCE(m.parent_id, m.id)) FROM videos v JOIN matches m ON m.id = v.match_id WHERE m.tournament_id = t.id) AS filmed,
      (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id AND m.output_path IS NOT NULL) AS rendered,
      (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id AND m.youtube_url IS NOT NULL) AS uploaded
    FROM tournaments t ORDER BY t.start_date DESC, t.id DESC`).all();
  return json({ tournaments: rows.map((r) => ({ ...tournamentFromRow(r), matches: r.match_count, filmed: r.filmed, rendered: r.rendered, uploaded: r.uploaded })) });
}

async function importLink(app, link) {
  try {
    const t = await fetchTournament(link);
    const id = saveTournament(app.db, t);
    // My players' profiles (for win chances) are read in the background; the page doesn't wait.
    const settings = readSettings(app.db);
    const entered = new Set((t.players ?? []).map((p) => p.id));
    const mine = myPlayers(app.db, settings.players, settings.playerLinks).map((p) => p.id).filter((pid) => entered.has(pid));
    refreshProfiles(app.db, mine).catch((err) => console.error('reading player profiles', err));
    return json({ id, matches: t.matches.length, players: t.players?.length ?? 0 }, 201);
  } catch (err) {
    if (err.code in STATUS) return fail(STATUS[err.code], err.code, err.message);
    return serverError(err, 'import tournament');
  }
}

export async function onRequestPost({ request, app }) {
  const body = await readJson(request);
  if (typeof body?.link !== 'string') return fail(400, 'badLink', 'Paste a badminfo or Badminton England tournament link');
  return importLink(app, body.link);
}

export function refresh({ params, app }) {
  const id = idParam(params.id);
  const t = id && app.db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  if (!t) return fail(404, 'notFound', 'No such tournament');
  return importLink(app, t.badminfo_id ? `https://badminfo.com/Tournament/${t.badminfo_id}` : beTournamentUrl(t.be_id));
}

export function onRequestDelete({ params, app }) {
  const id = idParam(params.id);
  if (!id) return fail(404, 'notFound', 'No such tournament');
  app.db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
  return json({ ok: true });
}

const DAY_MS = 86400000;

/** One tournament with its matches, linked videos and suggestions for unlinked ones. */
export function getOne({ params, app }) {
  const id = idParam(params.id);
  const tournament = tournamentFromRow(id && app.db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id));
  if (!tournament) return fail(404, 'notFound', 'No such tournament');
  const { players } = readSettings(app.db);
  const rows = app.db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY match_date, match_time, draw, id, game').all(id).map(matchFromRow);
  const matches = rows.filter((m) => !m.game);
  const linked = app.db.prepare(`SELECT v.* FROM videos v JOIN matches m ON m.id = v.match_id WHERE m.tournament_id = ? ORDER BY v.part`).all(id).map(videoFromRow);
  const from = tournament.start ? Date.parse(`${tournament.start}T00:00:00Z`) - DAY_MS : 0;
  const to = tournament.end ? Date.parse(`${tournament.end}T00:00:00Z`) + 2 * DAY_MS : 0;
  const free = from ? app.db.prepare('SELECT * FROM videos WHERE match_id IS NULL AND missing = 0 AND recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at')
    .all(new Date(from).toISOString(), new Date(to).toISOString()).map(videoFromRow) : [];
  // What the page shows of a match or a game's row: videos, tagging progress, outputs.
  const status = (m) => {
    const { games } = replayMatch(m, matchFormat(m));
    const official = m.game ? m.games.slice(0, m.game) : m.games;
    return {
      ...m,
      rallies: undefined,
      videoIds: linked.filter((v) => v.matchId === m.id).map((v) => v.id),
      thumb: linked.some((v) => v.matchId === m.id) ? `/media/thumb/${m.id}` : null,
      favourites: m.rallies.filter((r) => r.fav).length,
      rallyCount: m.rallies.length,
      tagged: m.rallies.filter((r) => r.winner).length,
      tagGames: games,
      check: m.rallies.length ? checkResult(games, official) : null,
    };
  };
  const peopleOf = tournamentPeople(app.db, tournament);
  const shown = matches.map((m) => ({
    ...status(m),
    people: peopleOf(m),
    mine: isMine(m.teamA, players) || isMine(m.teamB, players),
    // One slot per game played (or with a row already); a slot without a row has no id yet.
    units: Array.from({ length: Math.max(m.games.length, ...rows.filter((g) => g.parentId === m.id).map((g) => g.game)) }, (_, k) => {
      const row = rows.find((g) => g.parentId === m.id && g.game === k + 1);
      return row ? status(row) : { id: null, game: k + 1, videoIds: [], rallyCount: 0 };
    }),
  }));
  const filmed = new Set(linked.map((v) => rows.find((m) => m.id === v.matchId)?.parentId ?? v.matchId));
  const anyMine = shown.some((m) => m.mine);
  const candidates = shown.filter((m) => !filmed.has(m.id) && (!anyMine || m.mine))
    .map((m) => ({ id: m.id, startsAt: Date.parse(m.startsAt), duration: m.duration }));
  const groups = groupParts(free.map((v) => ({ id: v.id, recordedAt: Date.parse(v.recordedAt), duration: v.duration })));
  return json({ tournament, matches: shown, videos: [...linked, ...free], suggestions: suggest(groups, candidates), players });
}
