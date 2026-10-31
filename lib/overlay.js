// The scoreboard burned into the video, written as an ASS subtitle file that
// FFmpeg's `ass` filter draws. Times are in the match video's own timeline;
// the renderer shifts each cut segment back to it (lib/render.js). No I/O here;
// tested in tests/overlay.test.js.

import { boardNames } from '../public/shared/names.js';

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

/** ASS colour from "#rrggbb" plus alpha 0 (solid) to 255 (clear): &HAABBGGRR */
function colour(hex, alpha = 0) {
  const [r, g, b] = [1, 3, 5].map((i) => hex.slice(i, i + 2));
  return `&H${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
}

const rect = (x, y, w, h) => `m ${x} ${y} l ${x + w} ${y} ${x + w} ${y + h} ${x} ${y + h}`;

/**
 * The score shown from each moment: the state before the first rally, then
 * each counted rally's result from the moment it ended.
 * @returns {{ from: number, to: number, state: object }[]}
 */
export function scoreSpans(rallies, steps, duration, initial = null) {
  const spans = [];
  let from = 0;
  let state = initial ?? steps[0]?.before ?? { games: [], points: [0, 0], won: [0, 0], server: 'a' };
  rallies.forEach((r, i) => {
    if (!steps[i]?.counted) return;
    spans.push({ from, to: r.end, state });
    from = r.end;
    state = steps[i].after;
  });
  spans.push({ from, to: duration, state });
  return spans.filter((s) => s.to > s.from);
}

/**
 * The whole subtitle file.
 * @param {{ width: number, height: number, teams: string[][], spans: object[], title?: string, nameStyle?: object }} o
 */
export function assScript({ width, height, teams, spans, title = '', nameStyle }) {
  const fs = Math.max(16, Math.round(height / 24));
  const pad = Math.round(fs * 0.45);
  const rowH = Math.round(fs * 1.45);
  const x0 = Math.round(width * 0.025);
  const y0 = Math.round(height * 0.04);
  const names = boardNames(teams, nameStyle).map(assText);
  const nameW = Math.round(Math.max(...names.map((n) => n.length), 6) * fs * 0.62);
  const dotW = Math.round(fs * 0.9);
  const cellW = Math.round(fs * 1.5);
  const boxW = dotW + nameW + pad + cellW * 2;
  const boxH = rowH * 2;
  const xGames = x0 + dotW + nameW + pad + cellW / 2;
  const xPoints = xGames + cellW;
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
Title: ${assText(title)}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Box,Arial,${fs},${colour('#0f3b2d', 40)},&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Name,Arial,${fs},${colour('#ffffff')},&H00000000,&H64000000,&H00000000,1,0,0,0,100,100,0,0,1,0,1,4,0,0,0,1
Style: Num,Arial,${fs},${colour('#ffffff')},&H00000000,&H64000000,&H00000000,1,0,0,0,100,100,0,0,1,0,1,5,0,0,0,1
Style: Pts,Arial,${fs},${colour('#0f3b2d')},&H00000000,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  for (const { from, to, state } of spans) {
    const t = `${assTime(from)},${assTime(to)}`;
    lines.push(`Dialogue: 0,${t},Box,,0,0,0,,{\\pos(0,0)\\p1}${rect(x0, y0, boxW, boxH)}{\\p0}`);
    lines.push(`Dialogue: 1,${t},Box,,0,0,0,,{\\pos(0,0)\\p1\\1c${colour('#f0b429')}}${rect(xPoints - cellW / 2, y0, cellW, boxH)}{\\p0}`);
    [0, 1].forEach((k) => {
      const yMid = y0 + rowH * k + rowH / 2;
      const side = k === 0 ? 'a' : 'b';
      if (state.server === side) {
        lines.push(`Dialogue: 2,${t},Box,,0,0,0,,{\\pos(0,0)\\p1\\1c${colour('#f0b429')}}${rect(x0 + dotW * 0.35, yMid - dotW * 0.15, dotW * 0.3, dotW * 0.3)}{\\p0}`);
      }
      lines.push(`Dialogue: 2,${t},Name,,0,0,0,,{\\pos(${x0 + dotW},${yMid})}${names[k]}`);
      lines.push(`Dialogue: 2,${t},Num,,0,0,0,,{\\pos(${xGames},${yMid})}${state.won[k]}`);
      lines.push(`Dialogue: 2,${t},Pts,,0,0,0,,{\\pos(${xPoints},${yMid})}${state.points[k]}`);
    });
  }
  return head + lines.join('\n') + '\n';
}
