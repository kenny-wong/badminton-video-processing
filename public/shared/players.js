// Players' badminfo data on matches: which discipline a draw is, the rating
// and grade that go with it, badminfo's win chance for a match, and upsets.
// No DOM code here; tested in tests/players.test.js.

const CODES = /^(WS|WD|XD|MS|MD|BS|BD|GS|GD|OS|OD|MX)$/;
const WHO = { MEN: 'M', MENS: 'M', WOMEN: 'W', WOMENS: 'W', LADIES: 'W', BOYS: 'B', BOY: 'B', GIRLS: 'G', GIRL: 'G', OPEN: 'O', MIX: 'X', MIXED: 'X' };
const KIND = { SINGLES: 'S', SINGLE: 'S', S: 'S', DOUBLES: 'D', DOUBLE: 'D', D: 'D' };

/**
 * The event's code from its draw name, however the tournament wrote it:
 * "WS U15 - Group A", "U15 GS", "BS*" -> the code; "Girl's Singles" -> "GS",
 * "Mixed Doubles", "Mix Doubles" -> "XD", "Open D" -> "OD". "—" when it can't tell.
 */
export function eventCode(draw) {
  const words = String(draw ?? '').toUpperCase().split(/[\s\-/]+/).map((w) => w.replace(/[^A-Z]/g, '')).filter(Boolean);
  const code = words.find((w) => CODES.test(w));
  if (code) return code === 'MX' ? 'XD' : code;
  const who = words.map((w) => WHO[w] ?? WHO[w.replace(/S$/, '')]).find(Boolean);
  const kind = words.map((w) => KIND[w]).find(Boolean);
  if (who === 'X') return 'XD';
  return who && kind ? `${who}${kind}` : '—';
}

/** 'singles', 'doubles' or 'mixed' from a draw name ("WS U15", "U15 GS", "Mixed Doubles - Group A"), else null. */
export function disciplineOf(draw) {
  const code = eventCode(draw);
  if (code === 'XD') return 'mixed';
  if (/^[A-Z]D$/.test(code)) return 'doubles';
  if (/^[A-Z]S$/.test(code)) return 'singles';
  return null;
}

/** A player's rating and grade for a discipline ({ rating, grade }, either null/''). */
export function standing(player, discipline) {
  if (!player || !discipline) return { rating: null, grade: '' };
  return { rating: player.ratings?.[discipline] ?? null, grade: player.grades?.[discipline] ?? '' };
}

const sameIds = (x, y) => x.length === y.length && x.every((id) => id && y.includes(id));

/**
 * badminfo's chance of side A winning a match, from any of the players'
 * profiles that has the match: { a, from (the player's id), ratings: [[A's], [B's]] } or null.
 * `ids` are the two teams' badminfo ids; `profiles` players with `rubbers`.
 */
export function matchChance({ tournamentId, ids, profiles }) {
  if (!tournamentId || !ids?.[0]?.length || !ids?.[1]?.length) return null;
  for (const p of profiles ?? []) {
    const onA = ids[0].includes(p.id);
    if (!onA && !ids[1].includes(p.id)) continue;
    for (const r of p.rubbers ?? []) {
      if (r.tournamentId !== tournamentId || r.chance === null) continue;
      const ra = r.a.map((x) => x.id);
      const rb = r.b.map((x) => x.id);
      const straight = sameIds(ra, ids[0]) && sameIds(rb, ids[1]);
      const swapped = sameIds(ra, ids[1]) && sameIds(rb, ids[0]);
      if (!straight && !swapped) continue;
      const teams = straight ? [r.a, r.b] : [r.b, r.a];
      return { a: onA ? r.chance : Math.round((1 - r.chance) * 1000) / 1000, from: p.id, ratings: teams.map((t) => t.map((x) => x.rating)) };
    }
  }
  return null;
}

export const UPSET_BELOW = 0.35;

/** True when the side that won had less than a 35% chance. `winner` 'a' or 'b'. */
export function isUpset(chanceA, winner) {
  if (typeof chanceA !== 'number' || (winner !== 'a' && winner !== 'b')) return false;
  return (winner === 'a' ? chanceA : 1 - chanceA) < UPSET_BELOW;
}

/** 'a' or 'b' from the official result (BE's 1 or 2), else null. */
export function resultWinner(match) {
  if (match?.winner === 1 || match?.winner === 'a') return 'a';
  if (match?.winner === 2 || match?.winner === 'b') return 'b';
  return null;
}

/** Wins and losses over matches with `won` true or false (unknown results are left out). */
export function record(matches) {
  const won = matches.filter((m) => m.won === true).length;
  const lost = matches.filter((m) => m.won === false).length;
  return { played: won + lost, won, lost };
}

/**
 * A player's badminfo rating over time in each discipline: the rating they
 * had before their first match of each day in their profile, ending with today's.
 * @returns {{ singles?: {date, rating}[], doubles?: …, mixed?: … }}
 */
export function ratingSeries(rubbers, id, ratings = {}, ratingsDate = null) {
  const out = {};
  for (const r of rubbers ?? []) {
    const me = [...r.a, ...r.b].find((p) => p.id === id);
    if (!me?.rating || !r.date) continue;
    const list = (out[r.discipline] ??= []);
    if (list.at(-1)?.date !== r.date) list.push({ date: r.date, rating: me.rating });
  }
  for (const d of ['singles', 'doubles', 'mixed']) {
    if (!ratings?.[d] || !ratingsDate) continue;
    const list = (out[d] ??= []);
    if (list.at(-1)?.date === ratingsDate) list.pop();
    list.push({ date: ratingsDate, rating: ratings[d] });
  }
  return out;
}

/** "62%" */
export const percent = (x) => `${Math.round(x * 100)}%`;

/** Both sides' chances as whole percentages that add up to 100: ["62%", "38%"]. */
export function percents(a) {
  const x = Math.round(a * 100);
  return [`${x}%`, `${100 - x}%`];
}

/**
 * Whether one of a player's matches (as GET /api/players/:id lists them) passes the player
 * page's filters: { year, event, result: won|lost|none, video: filmed|not|rendered|youtube, fav, text }.
 */
export function matchPasses(m, f) {
  if (f.year && !String(m.date ?? '').startsWith(f.year)) return false;
  if (f.event && m.event !== f.event) return false;
  if (f.result === 'won' && m.won !== true) return false;
  if (f.result === 'lost' && m.won !== false) return false;
  if (f.result === 'none' && m.won !== null) return false;
  if (f.video === 'filmed' && !m.filmed) return false;
  if (f.video === 'not' && m.filmed) return false;
  if (f.video === 'rendered' && !m.rendered) return false;
  if (f.video === 'youtube' && !m.youtubeUrl && !m.gamesOnYoutube) return false;
  if (f.fav && !m.favourite) return false;
  const words = String(f.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const text = [m.tournament, m.draw, m.round, ...m.teamA, ...m.teamB].join(' ').toLowerCase();
    if (!words.every((w) => text.includes(w))) return false;
  }
  return true;
}

/** The tournament page's star filter: 'matches' keeps starred matches, 'games' matches with a starred game, '' all. */
export const passesStars = (m, stars) => (stars === 'matches' ? Boolean(m.favourite) : stars === 'games' ? (m.units ?? []).some((u) => u.favourite) : true);

/** The games a match shows under the star filter: only the starred ones while it picks games. */
export const starredUnits = (units, stars) => (stars === 'games' ? units.filter((u) => u.favourite) : units);
