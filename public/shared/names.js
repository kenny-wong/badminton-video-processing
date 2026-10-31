// Player names: which draw entries are "my players", and the short names the
// scoreboard shows. No DOM code here; tested in tests/names.test.js.

const words = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);

/**
 * True when the draw name holds every word of the saved name, whole words, in
 * any case or order: "Chloe" matches "Chloe Wong", "Ann" doesn't match "Anna".
 */
export function namesMatch(saved, name) {
  const want = words(saved);
  if (!want.length) return false;
  const have = new Set(words(name));
  return want.every((w) => have.has(w));
}

/** True when any player in the team (an array of names) is one of `players`. */
export const isMine = (team, players) => (team ?? []).some((n) => (players ?? []).some((p) => namesMatch(p, n)));

/** "Amy Lee / Ben Ng" */
export const teamName = (team) => (team ?? []).join(' / ');

/**
 * How names appear on the scoreboard, chosen separately for singles and
 * doubles in Settings. All in capitals, TV-style.
 */
export const NAME_STYLES = {
  surname: 'Surname (WONG)',
  first: 'First name (HAYLEY)',
  initial: 'Initial and surname (H. WONG)',
  full: 'Full name (HAYLEY WONG)',
};
export const DEFAULT_NAME_STYLE = { singles: 'full', doubles: 'initial' };

export function cleanNameStyle(v) {
  const pick = (x, d) => (Object.hasOwn(NAME_STYLES, x) ? x : d);
  return { singles: pick(v?.singles, DEFAULT_NAME_STYLE.singles), doubles: pick(v?.doubles, DEFAULT_NAME_STYLE.doubles) };
}

const nameParts = (n) => {
  const w = String(n ?? '').trim().split(/\s+/).filter(Boolean);
  return { first: w[0] ?? '', last: w.at(-1) ?? '', whole: w.join(' '), one: w.length < 2 };
};

/**
 * Both teams' scoreboard names (teams = [teamA, teamB], each an array of names)
 * in the chosen styles. When two of the players would look the same (two
 * WONGs by surname, two HAYLEYs by first name), those get an initial added:
 * H. WONG, HAYLEY W.
 */
export function boardNames(teams, styles = DEFAULT_NAME_STYLE) {
  const chosen = cleanNameStyle(styles);
  const everyone = teams.flat().map(nameParts);
  const same = (p, key) => everyone.filter((o) => o[key].toLowerCase() === p[key].toLowerCase()).length > 1;
  return teams.map((team) => {
    const style = team.length > 1 ? chosen.doubles : chosen.singles;
    return team.map((n) => {
      const p = nameParts(n);
      if (p.one) return p.whole.toUpperCase();
      let text;
      if (style === 'surname') text = same(p, 'last') ? `${p.first[0]}. ${p.last}` : p.last;
      else if (style === 'first') text = same(p, 'first') ? `${p.first} ${p.last[0]}.` : p.first;
      else if (style === 'initial') text = `${p.first[0]}. ${p.last}`;
      else text = p.whole;
      return text.toUpperCase();
    }).join(' / ');
  });
}
