// GET /api/players: the listed players, favourites (★) and others, with their badminfo data and filmed matches.
// GET /api/players/search?q=: players in imported badminfo tournaments whose name has every word of q.
// POST /api/players/refresh: re-reads every badminfo tournament's entrants and the favourites' profiles.
// GET /api/players/:id[?refresh=1]: one player, their matches in imported tournaments and rating history.
// POST /api/players/:id/tournaments { update? }: imports every tournament they entered on badminfo that isn't in the app yet
//   (with update, re-reads the ones that are, for new times and results); a background job.
// GET /api/matches/:id/people[?refresh=1]: a match's players, win chance, earlier meetings and the opponents' other filmed matches.
// GET /api/favourites[?all=1]: the favourites (or everyone listed) with the tournaments each one joined.
// POST /api/favourites { id } | { link } | { name }, starred?: lists a player (by badminfo id or link) or a name, starred unless starred is false.
// PUT /api/favourites/:key { link } ties a name-only entry to a badminfo profile link; { starred } stars or unstars (unstarred players stay listed).
// DELETE /api/favourites/:key: takes a player off the list.

import { fail, idParam, json, readJson } from '../lib/http.js';
import { apiUrl, badminfoId, entrants, getJson, playerPageUrl } from '../lib/badminfo.js';
import { matchFromRow } from '../lib/db.js';
import { matchPeople, playerFromRow, refreshProfile, refreshProfiles, saveEntrants, teamIds } from '../lib/players.js';
import { addFavourite, favouriteMatcher, favourites, favouriteTournaments, linkFavourite, removeFavourite, setStarred } from '../lib/favourites.js';
import { loadMatch } from '../lib/pipeline.js';
import { importPlayerTournaments } from '../lib/player-import.js';
import { jobView, startJob } from '../lib/jobs.js';
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
  const favs = favourites(app.db, { all: true });
  const joined = favouriteTournaments(app.db, favs);
  const cards = favs.map((f) => {
    const row = f.id && app.db.prepare('SELECT * FROM players WHERE id = ?').get(f.id);
    const matches = f.id ? matchesOf(app.db, f.id) : [];
    const there = Object.values(joined[f.key]);
    return {
      ...f, player: playerFromRow(row) ?? null, tournaments: there.length,
      // Matches by badminfo entry, or by name (custom tournaments count that way too), whichever finds more.
      matches: Math.max(matches.length, there.reduce((a, b) => a + b, 0)), filmed: matches.filter((m) => m.filmed).length, record: record(matches),
    };
  });
  const known = app.db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  const badminfoTournaments = app.db.prepare('SELECT COUNT(*) AS n FROM tournaments WHERE badminfo_id IS NOT NULL').get().n;
  return json({ favourites: cards.filter((c) => c.starred), others: cards.filter((c) => !c.starred), known, badminfoTournaments });
}

const MAX_FOUND = 30;

export function search({ request, app }) {
  const words = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return json({ players: [] });
  const rows = app.db.prepare(`SELECT p.*, (SELECT COUNT(DISTINCT tp.tournament_id) FROM tournament_players tp WHERE tp.player_id = p.id) AS tournaments
    FROM players p WHERE ${words.map(() => "p.name LIKE ? ESCAPE '\\'").join(' AND ')} ORDER BY tournaments DESC, p.name LIMIT ${MAX_FOUND}`)
    .all(...words.map((w) => `%${w.replace(/[\\%_]/g, '\\$&')}%`));
  const listed = new Map(favourites(app.db, { all: true }).filter((f) => f.id).map((f) => [f.id, f]));
  return json({ players: rows.map((r) => ({ ...playerFromRow(r), tournaments: r.tournaments, favourite: listed.get(r.id)?.starred ? listed.get(r.id).key : null, listed: listed.get(r.id)?.key ?? null })) });
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
  const profiles = await refreshProfiles(db, favourites(db).map((f) => f.id), { maxAge: 0 });
  return json({ ok: true, tournaments, profiles });
}

export function favouritesList({ request, app }) {
  const favs = favourites(app.db, { all: new URL(request.url).searchParams.get('all') === '1' });
  const joined = favouriteTournaments(app.db, favs);
  return json({ favourites: favs.map((f) => ({ ...f, tournaments: joined[f.key] })) });
}

/** The player a pasted badminfo link (or id) names, read from badminfo; or an error response. */
async function linkedPlayer(db, link) {
  const text = String(link ?? '').trim();
  const id = badminfoId(text, 'player') ?? (GUID.test(text.toLowerCase()) ? text.toLowerCase() : null);
  if (!id) return { error: fail(400, 'badLink', 'Paste the player’s badminfo link, like https://badminfo.com/Player/…') };
  await refreshProfile(db, id, { maxAge: 0 }).catch(() => false);
  const row = db.prepare('SELECT id, name FROM players WHERE id = ?').get(id);
  return row ?? { error: fail(404, 'notFound', 'badminfo has no player with that link (or couldn’t be reached)') };
}

export async function addFavouriteRoute({ request, app }) {
  const body = (await readJson(request)) ?? {};
  let player;
  if (body.id !== undefined) {
    const id = String(body.id).toLowerCase();
    player = GUID.test(id) && app.db.prepare('SELECT id, name FROM players WHERE id = ?').get(id);
    if (!player) return fail(404, 'notFound', 'That player isn’t in any imported tournament');
  } else if (body.link !== undefined) {
    player = await linkedPlayer(app.db, body.link);
    if (player.error) return player.error;
  } else {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
    if (!name) return fail(400, 'badInput', 'Type the player’s name as in the draws');
    player = { id: null, name };
  }
  // A favourite's profile (win chances, rating history) is read in the background.
  if (player.id) refreshProfile(app.db, player.id).catch((err) => console.error('reading a player profile', err));
  return json({ key: addFavourite(app.db, { ...player, starred: body.starred !== false }) }, 201);
}

export async function linkFavouriteRoute({ request, params, app }) {
  const key = idParam(params.key);
  if (!key || !app.db.prepare('SELECT 1 FROM favourites WHERE id = ?').get(key)) return fail(404, 'notFound', 'No such player on the list');
  const body = (await readJson(request)) ?? {};
  if (typeof body.starred === 'boolean' && body.link === undefined) {
    setStarred(app.db, key, body.starred);
    return json({ key, starred: body.starred });
  }
  const player = await linkedPlayer(app.db, body.link);
  if (player.error) return player.error;
  return json({ key: linkFavourite(app.db, key, player.id, player.name) });
}

export function removeFavouriteRoute({ params, app }) {
  const key = idParam(params.key);
  if (!key || !removeFavourite(app.db, key)) return fail(404, 'notFound', 'No such favourite');
  return json({ ok: true });
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
    favourite: favourites(app.db).find((f) => f.id === id)?.key ?? null,
    listed: favourites(app.db, { all: true }).find((f) => f.id === id)?.key ?? null,
    matches,
    record: record(matches),
    filmedRecord: record(matches.filter((m) => m.filmed)),
    series: ratingSeries(rubbers ?? [], id, player.ratings, player.ratingsDate),
  });
}

export async function importTournaments({ request, params, app }) {
  const id = String(params.id).toLowerCase();
  if (!GUID.test(id)) return fail(404, 'notFound', 'No such player');
  const update = (await readJson(request))?.update === true;
  const name = app.db.prepare('SELECT name FROM players WHERE id = ?').get(id)?.name ?? 'player';
  const job = startJob('import', `player-tournaments:${id}:${update ? 'update' : 'new'}`, async (j, signal) => {
    const result = await importPlayerTournaments(app.db, id, { update, job: j, signal });
    await refreshProfile(app.db, id).catch(() => false);
    return result;
  }, { queue: 'import', label: `${update ? 'Update' : 'Import'} ${name}’s tournaments` });
  return json(jobView(job), 202);
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
  // The opponents: the side without favourites, when exactly one side has them.
  const sides = favouriteMatcher(db, loaded.tournament.id, favourites(db));
  const mineSide = [0, 1].filter((k) => sides([loaded.match.teamA, loaded.match.teamB][k]).length);
  const opp = mineSide.length === 1 ? 1 - mineSide[0] : null;
  const scouting = opp === null ? [] : [...others.values()]
    .filter((m) => m.filmed && !meetings.includes(m) && (has(m.teamA, names(opp)) || has(m.teamB, names(opp))));
  return json({ ...people, discipline: people.discipline ?? disciplineOf(loaded.match.draw), meetings: meetings.slice(0, MAX_LIST), scouting: scouting.slice(0, MAX_LIST), opponents: opp === null ? null : opp ? 'b' : 'a' });
}
