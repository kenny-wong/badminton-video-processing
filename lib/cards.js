// Title and end cards: a few seconds of the scoreboard's colour with the match
// written on it, before the first rally and after the last. Each card is its
// own short clip, encoded like the cut parts so they all join without
// re-encoding (lib/render.js cardArgs). No I/O here; tested in tests/cards.test.js.

import { assAlpha, assColour, assText } from './overlay.js';
import { cleanBoard } from '../public/shared/board.js';
import { gameOver, gamesText } from '../public/shared/score.js';

export const DEFAULT_CARDS = { title: false, end: false, seconds: 3 };

export function cleanCards(v) {
  const out = { ...DEFAULT_CARDS };
  if (typeof v?.title === 'boolean') out.title = v.title;
  if (typeof v?.end === 'boolean') out.end = v.end;
  if (Number.isFinite(v?.seconds)) out.seconds = Math.min(8, Math.max(2, Math.round(v.seconds)));
  return out;
}

const upper = (team) => (team ?? []).map((n) => String(n).trim().toUpperCase()).join(' / ');

/** "Sat 24 Oct 2026" from "2026-10-24". */
function longDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd ?? '')) return '';
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${day} ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/**
 * The title card's lines, top to bottom: { text, size (a share of the picture's
 * height), tone ('text' | 'accent' | 'dim'), bold }.
 */
export function titleLines({ tournament, match, highlights = false }) {
  const event = [match.draw, match.round, match.game ? `Game ${match.game}` : ''].filter(Boolean).join(' · ');
  return [
    { text: [tournament.name, longDate(match.date)].filter(Boolean).join(' · ').toUpperCase(), size: 0.035, tone: 'dim' },
    { text: event.toUpperCase(), size: 0.045, tone: 'accent', bold: true },
    { text: upper(match.teamA), size: 0.075, tone: 'text', bold: true, gap: 0.04 },
    { text: 'v', size: 0.04, tone: 'dim' },
    { text: upper(match.teamB), size: 0.075, tone: 'text', bold: true },
    ...(highlights ? [{ text: '★ HIGHLIGHTS', size: 0.04, tone: 'accent', bold: true, gap: 0.04 }] : []),
  ];
}

/**
 * The end card's lines: who won and the score. `games` are the games shown
 * ([a, b] each, the official result when there is one); for a game's own
 * video only that game counts. A winner is named only from finished games
 * (tagging that stops mid-game names nobody).
 */
export function endLines({ tournament, match, games, format }) {
  const shown = match.game ? (games ?? []).slice(match.game - 1, match.game) : games ?? [];
  const won = [0, 1].map((k) => shown.filter((g) => gameOver(g, format) === (k ? 'b' : 'a')).length);
  const official = match.winner === 1 ? 0 : match.winner === 2 ? 1 : null; // a walkover or retirement has too few games
  const winner = !match.game && official !== null ? official : won[0] === won[1] ? null : won[0] > won[1] ? 0 : 1;
  const teams = [match.teamA, match.teamB];
  const ordered = winner === null ? shown : shown.map((g) => [g[winner], g[1 - winner]]);
  return [
    { text: match.game ? `GAME ${match.game}` : 'RESULT', size: 0.04, tone: 'accent', bold: true },
    winner === null
      ? { text: `${upper(match.teamA)} v ${upper(match.teamB)}`, size: 0.06, tone: 'text', bold: true, gap: 0.03 }
      : { text: `${upper(teams[winner])} ${teams[winner].length > 1 ? 'WIN' : 'WINS'}`, size: 0.07, tone: 'text', bold: true, gap: 0.03 },
    { text: gamesText(ordered), size: 0.06, tone: 'accent', bold: true },
    winner === null ? null : { text: `v ${upper(teams[1 - winner])}`, size: 0.04, tone: 'dim', gap: 0.02 },
    { text: [match.draw, match.round, tournament.name].filter(Boolean).join(' · ').toUpperCase(), size: 0.03, tone: 'dim', gap: 0.05 },
  ].filter((l) => l && l.text);
}

/** The ASS file for a card: its lines centred, fading in and out. */
export function cardScript({ width, height, style, lines }) {
  const look = cleanBoard(style);
  const tones = { text: [look.text, 1], dim: [look.text, 0.7], accent: [look.accent === look.box ? look.text : look.accent, 1] };
  const sizes = lines.map((l) => Math.round(l.size * height));
  const gaps = lines.map((l, i) => (i ? Math.round((l.gap ?? 0.012) * height) : 0));
  const total = sizes.reduce((a, b) => a + b * 1.25, 0) + gaps.reduce((a, b) => a + b, 0);
  let y = (height - total) / 2;
  const events = lines.map((l, i) => {
    y += gaps[i];
    const mid = Math.round(y + (sizes[i] * 1.25) / 2);
    y += sizes[i] * 1.25;
    const [c, a] = tones[l.tone] ?? tones.text;
    // Long names shrink to fit the picture's width.
    const fit = Math.min(sizes[i], Math.floor((width * 0.9) / Math.max(1, l.text.length * 0.62)));
    return `Dialogue: 0,0:00:00.00,9:00:00.00,Text,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${mid})\\fs${fit}\\b${l.bold ? 1 : 0}\\1c${assColour(c)}\\1a${assAlpha(a)}}${assText(l.text)}`;
  });
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Text,${assText(look.font)},20,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
}
