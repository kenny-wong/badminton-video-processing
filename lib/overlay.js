// The scoreboard burned into the video, written as an ASS subtitle file that
// FFmpeg's `ass` filter draws. Times are in the match video's own timeline;
// the renderer shifts each cut segment back to it (lib/render.js). The board's
// look and layout come from public/shared/board.js (the Settings preview
// draws the same layout). No I/O here; tested in tests/overlay.test.js.

import { boardNames } from '../public/shared/names.js';
import { bannerText, boardFlags, boardLayout, changedNumbers, cleanBoard } from '../public/shared/board.js';
import { shownAfter } from '../public/shared/score.js';

/** How long a banner (INTERVAL, GAME TO …) stays up after the rally that caused it. */
export const BANNER_SECONDS = 6;

/** Seconds each half of a number's flip takes: the old one folds away, then the new one unfolds. */
export const FLIP_SECONDS = 0.12;

/** Seconds as ASS time, h:mm:ss.cc */
export function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Text safe inside an ASS dialogue line (no override blocks or line breaks). */
export const assText = (s) => String(s ?? '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

/** ASS colour from "#rrggbb": &HBBGGRR& */
export function assColour(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => hex.slice(i, i + 2));
  return `&H${b}${g}${r}&`.toUpperCase();
}

/** ASS alpha from opacity 0 (clear) to 1 (solid): &HAA& */
export const assAlpha = (opacity) => `&H${Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255).toString(16).padStart(2, '0').toUpperCase()}&`;

const rect = (x, y, w, h) => `m ${x} ${y} l ${x + w} ${y} ${x + w} ${y + h} ${x} ${y + h}`;

/**
 * The score shown from each moment: the state before the first rally, then
 * each counted rally's result from the moment it ended (once the match is
 * over, its last game's final points: shownAfter). A span that starts
 * with a game, match or interval also carries that `event`
 * ({ kind, winner, before, after }) for the banner; with `shots` (per rally)
 * and `longRally`, a rally of that many shots or more is { kind: 'rally', shots }.
 * @returns {{ from: number, to: number, state: object, event: object|null }[]}
 */
export function scoreSpans(rallies, steps, duration, initial = null, { shots = null, longRally = 0 } = {}) {
  const spans = [];
  let from = 0;
  let state = initial ?? steps[0]?.before ?? { games: [], points: [0, 0], won: [0, 0], server: 'a' };
  let event = null;
  rallies.forEach((r, i) => {
    if (!steps[i]?.counted) return;
    spans.push({ from, to: r.end, state, event });
    from = r.end;
    state = shownAfter(steps[i]);
    event = steps[i].event ? { kind: steps[i].event, winner: r.winner, before: steps[i].before, after: steps[i].after }
      : longRally && shots?.[i] >= longRally ? { kind: 'rally', shots: shots[i] } : null;
  });
  spans.push({ from, to: duration, state, event });
  return spans.filter((s) => s.to > s.from);
}

/** One layout item as an ASS dialogue line shown during `t` ("start,end"), `anim` = extra override tags. */
function dialogue(item, t, anim = '') {
  if (item.type === 'rect') {
    return `Dialogue: ${item.layer},${t},Box,,0,0,0,,{\\pos(0,0)\\p1\\1c${assColour(item.colour)}\\1a${assAlpha(item.opacity)}}${rect(item.x, item.y, item.w, item.h)}{\\p0}`;
  }
  if (item.type === 'poly') {
    const [first, ...rest] = item.points;
    return `Dialogue: ${item.layer},${t},Box,,0,0,0,,{\\pos(0,0)\\p1\\1c${assColour(item.colour)}\\1a${assAlpha(item.opacity)}}m ${first.join(' ')} l ${rest.map((q) => q.join(' ')).join(' ')}{\\p0}`;
  }
  const an = item.anchor === 'middle' ? 5 : 4;
  return `Dialogue: ${item.layer},${t},Text,,0,0,0,,{\\an${an}\\pos(${item.x},${item.y})\\fs${item.size}\\fscx${item.stretch ?? 100}\\b${item.bold ? 1 : 0}\\shad${item.shadow ? 1 : 0}`
    + `\\1c${assColour(item.colour)}\\1a${assAlpha(item.opacity)}${anim}}${assText(item.text)}`;
}

/**
 * The whole subtitle file.
 * @param {{ width: number, height: number, teams: string[][], spans: object[], title?: string,
 *   nameStyle?: object, style?: object, format?: object, heading?: string }} o
 */
export function assScript({ width, height, teams, spans, title = '', nameStyle, style, format, heading = '' }) {
  const look = cleanBoard(style);
  const names = boardNames(teams, nameStyle).map(assText);
  const font = assText(look.font);
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
Title: ${assText(title)}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Box,${font},20,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Text,${font},20,&H00FFFFFF,&H00000000,&H64000000,&H64000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  // A number that changes flips over, as on TV: in the last moment of the span before, it folds
  // away (squashed to nothing top to bottom), then the new one unfolds at the start of its span.
  const ms = (s) => Math.round(s * 1000);
  let before = null; // the previous span: { items, at (each item's line), anims (its tags), t, to, length }
  for (const { from, to, state, event } of spans) {
    const t = `${assTime(from)},${assTime(to)}`;
    const flags = boardFlags(state, format);
    const { items } = boardLayout({ width, height, names, state, style: look, flags, heading });
    const flipping = before && before.to === from ? changedNumbers(before.items, items) : new Set();
    if (flipping.size && before.length >= FLIP_SECONDS * 2) {
      before.items.forEach((item, k) => {
        if (item.type !== 'text' || !flipping.has(item.key)) return;
        lines[before.at[k]] = dialogue(item, before.t, `${before.anims[k]}\\t(${ms(before.length - FLIP_SECONDS)},${ms(before.length)},\\fscy0)`);
      });
    }
    const at = [];
    const anims = items.map((item) => (item.type === 'text' && flipping.has(item.key) ? `\\fscy0\\t(0,${ms(FLIP_SECONDS)},\\fscy100)` : ''));
    items.forEach((item, k) => {
      at.push(lines.length);
      lines.push(dialogue(item, t, anims[k]));
    });
    before = { items, at, anims, t, to, length: to - from };
    const banner = look.banners ? bannerText(event, names, format) : '';
    if (banner) {
      // Only the banner's own box and text (the layout's last items), for its first few seconds.
      const extra = boardLayout({ width, height, names, state, style: look, flags, heading, banner }).items.slice(items.length);
      const tb = `${assTime(from)},${assTime(Math.min(to, from + BANNER_SECONDS))}`;
      for (const item of extra) lines.push(dialogue(item, tb));
    }
  }
  return head + lines.join('\n') + '\n';
}
