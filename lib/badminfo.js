// Reading tournaments and players from badminfo.com (copied from the badminton
// project). badminfo's pages are a web app that loads each tournament or
// player as JSON from its own, undocumented API, read here on the server. No
// DOM code here, so it is unit tested in tests/badminfo.test.js.
//
// Every player has a badminfo id (the code in their badminfo link). Tournament
// draws list it for each player too (not the BE number), so it is the surest
// way to find a saved player in a draw.

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINK = 300;
const MAX_NAME = 60;
const MAX_GROUPS = 200;
const MAX_TOURNAMENTS = 200;

/**
 * The id in a badminfo tournament link such as
 * https://badminfo.com/Tournament/c7fa0c7e-1adb-412f-a229-190bd893db4f?t=OD&s=g,
 * or in a player link (https://badminfo.com/Player/<id>) when `kind` is
 * 'player'; null when the text isn't one. Only the id is ever used, so the
 * server can't be pointed at any other address.
 */
export function badminfoId(link, kind = 'tournament') {
  if (typeof link !== 'string' || link.length > MAX_LINK) return null;
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!/^(www\.)?badminfo\.com$/i.test(url.hostname)) return null;
  const m = /^\/([a-z]+)\/([^/]+)\/?$/i.exec(url.pathname);
  return m && m[1].toLowerCase() === kind && GUID.test(m[2]) ? m[2].toLowerCase() : null;
}

export const apiUrl = (id) => `https://badstats.azurewebsites.net/api/tournaments/${id}`;
export const pageUrl = (id) => `https://badminfo.com/Tournament/${id}`;
export const playerApiUrl = (id) => `https://badstats.azurewebsites.net/api/players/${id}`;
export const playerPageUrl = (id) => `https://badminfo.com/Player/${id}`;

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;

/**
 * Fetches badminfo's JSON for one tournament or player.
 * @returns {Promise<{ json: any } | { status: number, error: string }>} the error
 *   is a code for the page: 'notFound' (badminfo answers an unknown id with
 *   204 No Content) or 'unavailable'.
 */
export async function getJson(url, cacheSeconds) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cf: { cacheTtl: cacheSeconds, cacheEverything: true },
    });
  } catch (err) {
    console.error('badminfo fetch failed', url, err);
    return { status: 502, error: 'unavailable' };
  }
  if (res.status === 204 || res.status === 404) return { status: 404, error: 'notFound' };
  if (!res.ok) {
    console.error('badminfo answered', res.status, url);
    return { status: 502, error: 'unavailable' };
  }
  try {
    const body = await res.text();
    if (body.length > MAX_BYTES) return { status: 502, error: 'unavailable' };
    return { json: JSON.parse(body) };
  } catch (err) {
    console.error('badminfo answer unreadable', url, err);
    return { status: 502, error: 'unavailable' };
  }
}

const text = (v, max = MAX_NAME) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const score = (v) => (Number.isInteger(v) && v >= 0 && v <= 99 ? v : null);
const guid = (v) => (typeof v === 'string' && GUID.test(v) ? v.toLowerCase() : '');

/**
 * The parts of badminfo's tournament JSON the calculator needs: the name, dates
 * and every round-robin group with its teams (one name for singles, two for
 * doubles), the players' badminfo ids in the same shape (`ids`, '' when
 * unknown) and matches. Each match's `a` and `b` are indexes into `teams`, and
 * each game is [a's points, b's points]. Teams are listed in the order they
 * first appear, so a team that hasn't played yet isn't known.
 * @returns {object|null} null when the JSON isn't a tournament.
 */
export function summarize(json, id) {
  const t = json?.beTournament;
  if (!t || typeof t !== 'object' || !Array.isArray(t.events)) return null;
  const players = Array.isArray(t.players) ? t.players : [];
  const names = new Map(players.map((p) => [p?.index, text(p?.playerEntryName)]));
  const playerIds = new Map(players.map((p) => [p?.index, guid(p?.id)]));
  const groups = [];
  for (const event of t.events) {
    for (const draw of Array.isArray(event?.draws) ? event.draws : []) {
      if (draw?.type !== 'Round Robin' || !Array.isArray(draw.rubbers)) continue;
      const teams = [];
      const ids = [];
      const keys = [];
      const teamIndex = (indexes) => {
        if (!Array.isArray(indexes) || !indexes.length) return -1;
        const key = [...indexes].sort((x, y) => x - y).join(',');
        let i = keys.indexOf(key);
        if (i < 0) {
          i = keys.push(key) - 1;
          teams.push(indexes.map((ix) => names.get(ix) || '?'));
          ids.push(indexes.map((ix) => playerIds.get(ix) || ''));
        }
        return i;
      };
      const matches = [];
      for (const r of draw.rubbers) {
        const a = teamIndex(r?.team1PlayerIndexes);
        const b = teamIndex(r?.team2PlayerIndexes);
        if (a < 0 || b < 0 || a === b) continue;
        const games = (Array.isArray(r.games) ? r.games : [])
          .slice(0, 3)
          .map((g) => [score(g?.team1Score), score(g?.team2Score)])
          .filter((g) => g.every((n) => n !== null));
        // A walkover or retirement has a winner but no (or too few) games to show it.
        const winner = r.winningTeam === 1 ? 'a' : r.winningTeam === 2 ? 'b' : null;
        matches.push({ a, b, games, winner, note: text(r.scoreText) || null });
      }
      if (teams.length >= 2) groups.push({ event: text(event.name), name: text(draw.name) || text(event.name), teams, ids, matches });
      if (groups.length >= MAX_GROUPS) break;
    }
  }
  return {
    source: 'badminfo',
    id,
    url: pageUrl(id),
    name: text(t.name, 120),
    start: date(t.startDate),
    end: date(t.endDate),
    // badminfo's level (1 Bronze, 2 Silver, 4 other; 3 is taken to be Gold) and age group (1 junior, 3 senior).
    category: Number.isInteger(t.category) ? t.category : null,
    ageGroup: Number.isInteger(t.ageGroup) ? t.ageGroup : null,
    beId: guid(t.beId), // the same event on Badminton England's site, for match times (/api/schedule)
    groups,
  };
}

const GRADE_KEYS = { Single: 'singles', Double: 'doubles', Mixed: 'mixed' };
const rating = (v) => (Number.isInteger(v) && v >= 0 && v < 10000 ? v : null);

/**
 * A player for the My players page: name, BE number, latest grade in each
 * discipline (badminfo keeps the history, newest first seen wins) with the date
 * badminfo first saw it (`gradeDates`, the day it took effect), badminfo
 * ratings, and the tournaments they have entered, upcoming and past, oldest
 * first (`{ id, name, start, end }`; the id works with /api/tournament).
 * badminfo doesn't publish gender or date of birth.
 * @returns {object|null} null when the JSON isn't a player.
 */
export function summarizePlayer(json, id) {
  if (!json || typeof json !== 'object' || typeof json.name !== 'string') return null;
  const grades = { singles: '', doubles: '', mixed: '' };
  const seen = {};
  for (const g of Array.isArray(json.gradings) ? json.gradings : []) {
    const d = GRADE_KEYS[g?.key];
    if (!d || !/^[A-K]$/.test(g.value)) continue;
    const when = typeof g.firstSeenUtc === 'string' ? g.firstSeenUtc : '';
    if (seen[d] === undefined || when > seen[d]) {
      grades[d] = g.value;
      seen[d] = when;
    }
  }
  const r = json.ratings ?? {};
  const tournaments = [];
  const add = (t) => {
    const tid = guid(t?.id);
    if (!tid || tournaments.some((x) => x.id === tid)) return;
    tournaments.push({ id: tid, name: text(t.name, 120), start: date(t.startDate), end: date(t.endDate) });
  };
  for (const t of Array.isArray(json.upcomingTournaments) ? json.upcomingTournaments : []) add(t);
  // Past competitions also include leagues, which have no tournament.
  for (const c of Array.isArray(json.competitionsWithRubbers) ? json.competitionsWithRubbers : []) add(c?.tournament);
  tournaments.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  return {
    source: 'badminfo',
    id,
    url: playerPageUrl(id),
    name: text(json.name).replace(/\s+/g, ' '),
    beNumber: Number.isInteger(json.beNumber) && json.beNumber > 0 ? String(json.beNumber) : '',
    grades,
    gradeDates: Object.fromEntries(Object.keys(grades).map((d) => [d, date(seen[d])])),
    ratings: { singles: rating(r.singlesRating), doubles: rating(r.doublesRating), mixed: rating(r.mixedRating) },
    ratingsDate: date(r.ratingsDate),
    tournaments: tournaments.slice(-MAX_TOURNAMENTS),
  };
}
