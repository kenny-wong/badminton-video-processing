// Players' nations for the scoreboard's flags. badminfo has no nationality, but it does say which
// national federation a player is registered with; a player added by name only has no nation until
// one is chosen on the Players page, and a choice there wins over badminfo's. A match's flags come
// from its players unless the editor chose countries for that match. Tested in tests/nations.test.js.

import { teamIds } from './players.js';
import { namesMatch } from '../public/shared/names.js';
import { cleanCountry } from '../public/shared/flags.js';
import { resolveBoard } from '../public/shared/board.js';

export { nationOf } from './badminfo.js';

/** The user's choice for a Players list entry: a country code, '' for no flag, or null to follow badminfo. */
export function setNation(db, key, nation) {
  const value = nation === null ? null : cleanCountry(nation);
  return db.prepare('UPDATE favourites SET nation = ? WHERE id = ?').run(value, key).changes > 0;
}

/** Each named player's nation ('' when there's none) in a tournament's match. */
export function playerNations(db, tournamentId, team) {
  const ids = teamIds(db, tournamentId, team);
  const listed = db.prepare('SELECT f.name, f.player_id, f.nation, p.nation AS badminfo FROM favourites f LEFT JOIN players p ON p.id = f.player_id').all();
  const known = db.prepare('SELECT nation FROM players WHERE id = ?');
  return (team ?? []).map((name, i) => {
    const id = ids[i];
    const entry = (id && listed.find((f) => f.player_id === id)) || listed.find((f) => namesMatch(f.name, name));
    if (entry && entry.nation !== null) return cleanCountry(entry.nation);
    if (id) return cleanCountry(known.get(id)?.nation ?? 'ENG');
    if (entry?.player_id) return cleanCountry(entry.badminfo ?? 'ENG');
    return '';
  });
}

/** One flag per team: the players' nation, or the first player's when partners differ ('' for none). */
export const teamNation = (nations) => nations.find(Boolean) ?? '';

/** Both teams' flags for a match, from its players. */
export const matchCountries = (db, match, tournament) =>
  [match.teamA, match.teamB].map((team) => teamNation(playerNations(db, tournament.id, team)));

/** The scoreboard look for a match: Settings with the match's choice on top, flags from its players unless chosen for it. */
export function matchBoard(db, board, match, tournament) {
  const style = resolveBoard(board, match.boardStyle);
  if (!match.boardStyle?.countries) style.countries = matchCountries(db, match, tournament);
  return style;
}
