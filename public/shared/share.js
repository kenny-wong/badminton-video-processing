// The text for sharing YouTube links: each match's day, time, event, players and result, then its link
// (or one per game). DOM-free, used by the tournament and player pages; tested in tests/share.test.js.

import { teamName } from './names.js';

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** 'Sun 1 Nov' from '2026-11-01'; '' when there's no date. */
export const shareDay = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? DAY.format(new Date(`${date}T12:00:00Z`)) : '');

const sideOf = (winner) => (winner === 'a' || winner === 1 ? 0 : winner === 'b' || winner === 2 ? 1 : null);

/** 'A beat B 21-14, 21-18' (scores the winner's way round) once there's a winner, else 'A v B' (and any scores). */
export function resultLine(m) {
  const teams = [teamName(m.teamA ?? []), teamName(m.teamB ?? [])];
  const games = m.games ?? [];
  const w = sideOf(m.winner);
  if (w === null) return `${teams[0]} v ${teams[1]}${games.length ? ` ${games.map((g) => g.join('-')).join(', ')}` : ''}`;
  return `${teams[w]} beat ${teams[1 - w]}${games.length ? ` ${games.map((g) => `${g[w]}-${g[1 - w]}`).join(', ')}` : ''}`;
}

/**
 * The YouTube links of matches, as one text to paste into a message: a `title` line, then each match with
 * links (`links`: [{ game, url }], game 0 = the whole match), a blank line between. With `byTournament`, a
 * line naming the tournament before its first match (the matches come grouped by tournament).
 * @returns {{ text: string, matches: number, videos: number }}
 */
export function youtubeShareText(matches, { title = '', byTournament = false } = {}) {
  const lines = title ? [title] : [];
  let count = 0;
  let videos = 0;
  let tournament = null;
  for (const m of matches) {
    const links = (m.links ?? []).filter((l) => l?.url);
    if (!links.length) continue;
    count += 1;
    videos += links.length;
    if (byTournament && m.tournament !== tournament) {
      tournament = m.tournament;
      if (lines.length) lines.push('');
      lines.push(`== ${String(m.tournament ?? '').trim() || 'Tournament'} ==`);
    }
    if (lines.length) lines.push('');
    const when = [shareDay(m.date), m.time].filter(Boolean).join(', ');
    const what = [m.draw, m.round].filter(Boolean).join(' ');
    if (when || what) lines.push([when, what].filter(Boolean).join(' · '));
    lines.push(resultLine(m));
    for (const l of links) lines.push(l.game ? `Game ${l.game}: ${l.url}` : l.url);
  }
  return { text: lines.join('\n'), matches: count, videos };
}
