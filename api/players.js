// GET /api/players: my players (Settings) with their badminfo data and filmed matches.
// POST /api/players/refresh: re-reads every badminfo tournament's entrants and my players' profiles.
// PUT /api/players/link { name, link }: ties one of my players to a badminfo profile link ('' unties).
// GET /api/players/:id[?refresh=1]: one player, their matches in imported tournaments and rating history.
// GET /api/matches/:id/people[?refresh=1]: a match's players, win chance, earlier meetings and the opponents' other filmed matches.

import { fail, json, readJson } from '../lib/http.js';
import { apiUrl, badminfoId, entrants, getJson, playerPageUrl } from '../lib/badminfo.js';
import { matchFromRow } from '../lib/db.js';
import { matchPeople, myPlayers, playerFromRow, refreshProfile, refreshProfiles, saveEntrants, teamIds } from '../lib/players.js';
import { readSettings, writeSettings } from '../lib/settings.js';
import { loadMatch } from '../lib/pipeline.js';
import { disciplineOf, ratingSeries, record, resultWinner } from '../public/shared/players.js';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every main match (not game rows) a player is in, newest first, with their side and whether it was filmed. */
function matchesOf(db, id) {
  const rows = db.prepare(`SELECT m.*, tp.name AS entry_name, t.name AS tournament_name, t.badminfo_id,
      EXISTS (SELECT 1 FROM videos v JOIN matches g ON g.id = v.match_id WHERE g.id = m.id OR g.parent_id = m.id) AS filmed
    FROM tournament_players tp JOIN matches m ON m.tournament_id = tp.tournament_id AND m.game = 0
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE tp.player_id = ? ORDER BY m.match_date DESC, m.match_time DESC`).all(id);
  const out = [];
  for (const r of rows) {
    const m = matchFromRow(r);
    const lower = r.entry_name.toLowerCase();
    const side = m.teamA.some((n) => n.toLowerCase() === lower) ? 'a' : m.teamB.some((n) => n.toLowerCase() === lower) ? 'b' : null;
    if (!side) continue;
    out.push(view(m, r, side));
  }
  return out;
}

/** A match as the player pages list it. */
const view = (m, r, side = null) => ({
  id: m.id, tournamentId: m.tournamentId, tournament: r.tournament_name, date: m.date, time: m.time, draw: m.draw, round: m.round,
  teamA: m.teamA, teamB: m.teamB, games: m.games, side, winner: resultWinner(m),
  won: side && resultWinner(m) ? resultWinner(m) === side : null,
  filmed: Boolean(r.filmed), youtubeUrl: m.youtubeUrl, rendered: Boolean(m.outputPath),
  partners: side ? (side === 'a' ? m.teamA : m.teamB).filter((n) => n.toLowerCase() !== String(r.entry_name ?? '').toLowerCase()) : [],
});

export function onRequestGet({ app }) {
  const settings = readSettings(app.db);
  const mine = myPlayers(app.db, settings.players, settings.playerLinks).map((p) => {
    const row = p.id && app.db.prepare('SELECT * FROM players WHERE id = ?').get(p.id);
    const matches = p.id ? matchesOf(app.db, p.id) : [];
    return { ...p, linked: Boolean(settings.playerLinks[p.name]), player: playerFromRow(row) ?? null, matches: matches.length, filmed: matches.filter((m) => m.filmed).length, record: record(matches) };
  });
  const known = app.db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  const badminfoTournaments = app.db.prepare('SELECT COUNT(*) AS n FROM tournaments WHERE badminfo_id IS NOT NULL').get().n;
  return json({ mine, known, badminfoTournaments });
}

export async function refresh({ app }) {
  const { db } = app;
  let tournaments = 0;
  for (const t of db.prepare('SELECT id, badminfo_id FROM tournaments WHERE badminfo_id IS NOT NULL').all()) {
    const got = await getJson(apiUrl(t.badminfo_id), 60);
    if (!got.json) continue;
    saveEntrants(db, t.id, entrants(got.json));
    tournaments += 1;
  }
  const settings = readSettings(db);
  const ids = myPlayers(db, settings.players, settings.playerLinks).map((p) => p.id);
  const profiles = await refreshProfiles(db, ids, { maxAge: 0 });
  return json({ ok: true, tournaments, profiles });
}

export async function link({ request, app }) {
  const body = await readJson(request);
  const settings = readSettings(app.db);
  if (!settings.players.includes(body?.name)) return fail(400, 'badInput', 'That isn’t one of your players (Settings)');
  const links = { ...settings.playerLinks };
  if (!body.link) delete links[body.name];
  else {
    const id = badminfoId(String(body.link), 'player') ?? (GUID.test(String(body.link).trim().toLowerCase()) ? String(body.link).trim().toLowerCase() : null);
    if (!id) return fail(400, 'badLink', 'Paste the player’s badminfo link, like https://badminfo.com/Player/…');
    if (!(await refreshProfile(app.db, id, { maxAge: 0 })) && !app.db.prepare('SELECT 1 FROM players WHERE id = ?').get(id)) {
      return fail(404, 'notFound', 'badminfo has no player with that link (or couldn’t be reached)');
    }
    links[body.name] = id;
  }
  writeSettings(app.db, { ...settings, playerLinks: links });
  return json({ ok: true, playerLinks: links });
}

export async function getOne({ request, params, app }) {
  const id = String(params.id).toLowerCase();
  if (!GUID.test(id)) return fail(404, 'notFound', 'No such player');
  if (new URL(request.url).searchParams.get('refresh')) await refreshProfile(app.db, id).catch(() => false);
  const row = app.db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!row) return fail(404, 'notFound', 'That player isn’t in any imported tournament');
  const player = playerFromRow(row, { rubbers: true });
  const matches = matchesOf(app.db, id);
  const { rubbers, ...rest } = player;
  return json({
    player: { ...rest, url: playerPageUrl(id) },
    matches,
    record: record(matches),
    filmedRecord: record(matches.filter((m) => m.filmed)),
    series: ratingSeries(rubbers ?? [], id, player.ratings, player.ratingsDate),
  });
}

const MAX_LIST = 20;

export async function matchPeopleRoute({ request, params, app }) {
  const loaded = loadMatch(app.db, Number(params.id));
  if (!loaded) return fail(404, 'notFound', 'No such match');
  const { db } = app;
  const parent = loaded.match.parentId ? loadMatch(db, loaded.match.parentId) : loaded;
  const ids = [teamIds(db, loaded.tournament.id, loaded.match.teamA), teamIds(db, loaded.tournament.id, loaded.match.teamB)];
  if (new URL(request.url).searchParams.get('refresh')) await refreshProfiles(db, ids.flat());
  const people = matchPeople(db, loaded);
  // Earlier meetings: someone from each side on opposite sides of another match.
  const others = new Map();
  for (const pid of ids.flat().filter(Boolean)) for (const m of matchesOf(db, pid)) if (m.id !== parent.match.id) others.set(m.id, m);
  const has = (team, side) => team.some((n) => side.includes(n.toLowerCase()));
  const names = (k) => [loaded.match.teamA, loaded.match.teamB][k].map((n) => n.toLowerCase());
  const meetings = [...others.values()].filter((m) => (has(m.teamA, names(0)) && has(m.teamB, names(1))) || (has(m.teamA, names(1)) && has(m.teamB, names(0))));
  // The opponents: the side without my players, when exactly one side has them.
  const settings = readSettings(db);
  const mineIds = new Set(myPlayers(db, settings.players, settings.playerLinks).map((p) => p.id).filter(Boolean));
  const mineSide = [0, 1].filter((k) => ids[k].some((x) => mineIds.has(x)));
  const opp = mineSide.length === 1 ? 1 - mineSide[0] : null;
  const scouting = opp === null ? [] : [...others.values()]
    .filter((m) => m.filmed && !meetings.includes(m) && (has(m.teamA, names(opp)) || has(m.teamB, names(opp))));
  return json({ ...people, discipline: people.discipline ?? disciplineOf(loaded.match.draw), meetings: meetings.slice(0, MAX_LIST), scouting: scouting.slice(0, MAX_LIST), opponents: opp === null ? null : opp ? 'b' : 'a' });
}
