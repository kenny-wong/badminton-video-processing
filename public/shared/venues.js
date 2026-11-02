// Court names as tournaments give them ("Winchester House School Sports Centre - 3",
// "Sports Hall - Ct3", "NBC - Court 3", or just the venue), shortened for showing on
// the tournament page. The stored names never change: this is display only, and
// the full name stays in a tooltip. Formats it doesn't know are shown as given,
// never guessed at. No DOM code here; tested in tests/venues.test.js.

const SEPARATOR = ' - ';
const NUMBERED = /^(?:court|crt|ct|c)?\s*0*(\d+)$/i; // "3", "03", "Ct3", "C3", "Court 3"
const LETTERED = /^(?:court|crt|ct)\s*([a-z])$/i; // "CtA", "Court A"
const ALONE = /^(?:(?:court|crt|ct)\s*\S+|c\d+)$/i; // a court with no venue: "Court 3", "Ct3", "C3"

/** "Ct3", "03", "C3", "Court 3" -> "Court 3"; "CtA" -> "Court A"; anything else as given ("JA-1", "UoW-01"). */
export function courtLabel(text) {
  const t = String(text ?? '').trim();
  const n = NUMBERED.exec(t);
  if (n) return `Court ${Number(n[1])}`;
  const l = LETTERED.exec(t);
  if (l) return `Court ${l[1].toUpperCase()}`;
  return t;
}

/**
 * A court name as { venue, court }, either null when it isn't there ("Middlesex Dome" is a
 * venue alone, "Court 3" a court alone); null when there is no name at all.
 */
export function parseCourt(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const at = t.lastIndexOf(SEPARATOR);
  if (at > 0) {
    const venue = t.slice(0, at).trim();
    const court = t.slice(at + SEPARATOR.length).trim();
    if (venue && court) return { venue, court: courtLabel(court) };
  }
  if (ALONE.test(t)) return { venue: null, court: courtLabel(t) };
  if (/^\d+$/.test(t)) return { venue: null, court: t }; // a bare number: shown as it is
  return { venue: t, court: null };
}

const same = (s) => s.toLowerCase();
const firstWords = (s, k) => s.split(' ').slice(0, k).join(' ');

/** The venues once each; names differing only in capitals are one venue, spelt with capitals when one has them. */
function distinct(venues) {
  const seen = new Map();
  for (const v of venues) if (!seen.has(same(v)) || seen.get(same(v)) === same(seen.get(same(v)))) seen.set(same(v), v);
  return [...seen.values()];
}

/**
 * Each venue's shortest start (whole words) that no other venue's name starts with, keyed by
 * the venue in lower case: "Medway Park Sports Centre" next to "Medway" is "Medway Park",
 * and "Medway" stays "Medway". Names differing only in capitals are one venue.
 */
export function shortVenues(venues) {
  const list = distinct(venues);
  return new Map(list.map((v) => {
    const words = v.split(' ').length;
    for (let k = 1; k <= words; k++) {
      const start = same(firstWords(v, k));
      if (!list.some((o) => o !== v && same(firstWords(o, k)) === start)) return [same(v), firstWords(v, k)];
    }
    return [same(v), v];
  }));
}

/**
 * How to show one tournament's court names. `venues` are its venues, once each (to name at the top
 * of the page). `label(text)` is a court's short name: "Court 3", or "Crosfields · Court 3" when
 * courts are numbered at more than one venue; a venue named without a court shows its short
 * name when the tournament has more than one venue, and '' when it adds nothing to the top.
 */
export function courtDisplay(texts) {
  const parsed = texts.map(parseCourt).filter(Boolean);
  const venues = distinct(parsed.filter((p) => p.venue).map((p) => p.venue));
  const withCourts = distinct(parsed.filter((p) => p.venue && p.court).map((p) => p.venue));
  const short = shortVenues(venues);
  const courtShort = shortVenues(withCourts);
  return {
    venues,
    label(text) {
      const p = parseCourt(text);
      if (!p) return '';
      if (p.court) return [p.venue && withCourts.length > 1 ? courtShort.get(same(p.venue)) : null, p.court].filter(Boolean).join(' · ');
      return venues.length > 1 ? short.get(same(p.venue)) : '';
    },
  };
}
