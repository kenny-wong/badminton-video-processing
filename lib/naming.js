// Names for the finished video: its YouTube title and description, and where
// the file goes on disk. No I/O here; tested in tests/naming.test.js.

import { gamesText } from '../public/shared/score.js';
import { teamName } from '../public/shared/names.js';

export const TITLE_MAX = 100; // YouTube's limit
export const DESCRIPTION_MAX = 5000;

const trimTo = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** "2026 Kent U15 Gold · XD U15 - Group A R1 · Lee/Ng v Ho/Wu · 21-18 15-21 21-19" */
export function videoTitle({ tournament, match, games, highlights = false }) {
  const short = (team) => team.map((n) => n.trim().split(/\s+/).at(-1)).join('/');
  const parts = [
    tournament.name,
    [match.draw, match.round, match.game ? `Game ${match.game}` : ''].filter(Boolean).join(' '),
    `${short(match.teamA)} v ${short(match.teamB)}`,
    match.game ? gamesText((games ?? []).slice(match.game - 1, match.game)) : gamesText(games),
  ].filter(Boolean);
  return trimTo(`${highlights ? 'Highlights: ' : ''}${parts.join(' · ')}`, TITLE_MAX);
}

/** The description: the match, the result, chapters and links back to the draw. */
export function videoDescription({ tournament, match, games, chapterText = '', links = [] }) {
  const lines = [
    `${teamName(match.teamA)} v ${teamName(match.teamB)}`,
    [match.draw, match.round, match.game ? `Game ${match.game}` : ''].filter(Boolean).join(' · '),
    `${tournament.name} · ${match.date}${match.court ? ` · ${match.court}` : ''}`,
  ];
  if (games?.length) lines.push(`Result: ${gamesText(games)}`);
  if (chapterText) lines.push('', chapterText);
  if (links.length) lines.push('', ...links);
  return trimTo(lines.join('\n'), DESCRIPTION_MAX);
}

/** A name Windows accepts for a file or folder. */
export function safeName(s, max = 80) {
  const clean = String(s ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `_${clean}` : clean || 'untitled';
}

/**
 * Where the finished video goes, relative to the output folder:
 * 2026/2026-10-24 Kent U15 Gold/0900 XD U15 - Group A R1 - Lee Ng v Ho Wu.mp4,
 * with " (highlights)" before .mp4 for the favourite rallies only.
 */
export function outputPath({ tournament, match, highlights = false }) {
  const year = (match.date || tournament.start || '').slice(0, 4) || 'undated';
  const folder = safeName(`${tournament.start || match.date || ''} ${tournament.name}`);
  const short = (team) => team.map((n) => n.trim().split(/\s+/).at(-1)).join(' ');
  const file = safeName(`${(match.time || '').replace(':', '')} ${[match.draw, match.round].filter(Boolean).join(' ')} - ${short(match.teamA)} v ${short(match.teamB)}${match.game ? ` - Game ${match.game}` : ''}`, 120);
  return [year, folder, `${file}${highlights ? ' (highlights)' : ''}.mp4`];
}
