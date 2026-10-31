// The scoreboard's look (Settings, or one match's own choice) and its layout:
// boxes and texts in the video's pixels. lib/overlay.js turns the layout into
// the burned-in ASS subtitles and the Settings page draws the same layout as a
// preview, so what is chosen there is what the video gets. No DOM code here;
// tested in tests/board.test.js.

import { gameOver } from './score.js';

/** Fonts every Windows PC has, with how wide their capitals run (per point of size). */
export const FONTS = { Arial: 0.64, 'Segoe UI': 0.62, Bahnschrift: 0.56, Verdana: 0.72, Tahoma: 0.62, 'Trebuchet MS': 0.6, Calibri: 0.56 };

export const CORNERS = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' };

export const HEADINGS = { off: 'None', round: 'Event and round', full: 'Tournament, event and round' };

/**
 * How the board is drawn: 'broadcast' as on BWF's streams (narrow lettering, a
 * shuttle after the server's name, lines between rows and games), or
 * 'classic' (a dot before the server's name, the loser's game scores dimmed).
 */
export const LAYOUTS = { broadcast: 'Broadcast (shuttle by the server)', classic: 'Classic (dot by the server)' };

/** Named looks: colours, font and layout. */
export const PRESETS = {
  broadcast: { label: 'Broadcast white', box: '#f5f5f3', text: '#16181d', accent: '#b9622e', pointsText: '#ffffff', font: 'Bahnschrift', opacity: 97, layout: 'broadcast' },
  tv: { label: 'TV green', box: '#0f3b2d', text: '#ffffff', accent: '#f0b429', pointsText: '#0f3b2d', font: 'Arial', opacity: 85, layout: 'classic' },
  minimal: { label: 'Minimal white', box: '#ffffff', text: '#111111', accent: '#111111', pointsText: '#ffffff', font: 'Segoe UI', opacity: 90, layout: 'classic' },
  contrast: { label: 'High contrast', box: '#000000', text: '#ffffff', accent: '#ffd400', pointsText: '#000000', font: 'Arial', opacity: 100, layout: 'classic' },
  navy: { label: 'Navy and orange', box: '#10264a', text: '#ffffff', accent: '#e8642c', pointsText: '#ffffff', font: 'Bahnschrift', opacity: 88, layout: 'broadcast' },
};
const LOOK = ['box', 'text', 'accent', 'pointsText', 'font', 'opacity', 'layout'];

export const DEFAULT_BOARD = {
  preset: 'broadcast',
  ...Object.fromEntries(LOOK.map((k) => [k, PRESETS.broadcast[k]])),
  corner: 'tl',
  scale: 80,         // per cent of the standard size (a 24th of the picture's height per line)
  showGames: true,   // finished games' scores as columns, else the number of games won
  flags: true,       // GAME POINT / MATCH POINT beside the board
  banners: true,     // INTERVAL, GAME TO …, MATCH TO … for a few seconds after
  heading: 'off',
  longRally: 0,      // a banner after rallies of at least this many shots (from the hit sounds); 0 for none
};

const colour = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
const int = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);

/** A full, valid look from whatever was saved or sent; anything not valid keeps the default. */
export function cleanBoard(v) {
  const out = { ...DEFAULT_BOARD };
  if (!v || typeof v !== 'object') return out;
  if (Object.hasOwn(PRESETS, v.preset) || v.preset === 'custom') out.preset = v.preset;
  if (Object.hasOwn(PRESETS, out.preset)) Object.assign(out, pick(PRESETS[out.preset]));
  for (const k of ['box', 'text', 'accent', 'pointsText']) out[k] = colour(v[k]) ?? out[k];
  if (Object.hasOwn(FONTS, v.font)) out.font = v.font;
  if (Object.hasOwn(LAYOUTS, v.layout)) out.layout = v.layout;
  out.opacity = int(v.opacity, 30, 100) ?? out.opacity;
  out.scale = int(v.scale, 60, 160) ?? out.scale;
  if (Object.hasOwn(CORNERS, v.corner)) out.corner = v.corner;
  if (Object.hasOwn(HEADINGS, v.heading)) out.heading = v.heading;
  for (const k of ['showGames', 'flags', 'banners']) out[k] = bool(v[k]) ?? out[k];
  if (v.longRally === 0 || Number.isFinite(v.longRally)) out.longRally = v.longRally ? int(v.longRally, 8, 60) : 0;
  return out;
}

const pick = (preset) => Object.fromEntries(LOOK.map((k) => [k, preset[k]]));

/** One match's own choice ({ preset?, corner? }), or null when it uses Settings. */
export function cleanBoardOverride(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  if (Object.hasOwn(PRESETS, v.preset)) out.preset = v.preset;
  if (Object.hasOwn(CORNERS, v.corner)) out.corner = v.corner;
  return Object.keys(out).length ? out : null;
}

/** The look for a match: Settings, with the match's own preset and corner on top. */
export function resolveBoard(settings, override = null) {
  const out = cleanBoard(settings);
  const o = cleanBoardOverride(override);
  if (o?.preset) Object.assign(out, pick(PRESETS[o.preset]), { preset: o.preset });
  if (o?.corner) out.corner = o.corner;
  return out;
}

/**
 * GAME POINT / MATCH POINT for each side at this score (both at 20-20 of a
 * game to 21 without setting, or 29-29 with), else null.
 * @returns {[string|null, string|null]}
 */
export function boardFlags(state, format) {
  const need = format?.bestOf === 1 ? 1 : 2;
  return [0, 1].map((k) => {
    const points = [...state.points];
    points[k] += 1;
    if (gameOver(points, format) !== (k ? 'b' : 'a')) return null;
    return state.won[k] + 1 >= need ? 'MATCH POINT' : 'GAME POINT';
  });
}

/**
 * The banner after a rally that ended a game or the match, or reached the
 * interval (ends change there in the deciding game). `event` is
 * { kind, winner, before, after } from overlay.js's scoreSpans.
 */
export function bannerText(event, names, format) {
  if (!event) return '';
  if (event.kind === 'rally') return `${event.shots}-SHOT RALLY`;
  const need = format?.bestOf === 1 ? 1 : 2;
  const { kind, before, after } = event;
  if (kind === 'interval') return before.games.length === need * 2 - 2 ? 'INTERVAL · CHANGE ENDS' : 'INTERVAL';
  const k = event.winner === 'b' ? 1 : 0;
  const last = after.games.at(-1);
  if (!last) return '';
  const score = `${last[k]}-${last[1 - k]}`;
  // A game's own video ends its replay as a "match": it is only the match when that game decided it.
  if (kind === 'match' && after.won[k] >= need) {
    const all = after.games.map((g) => `${g[k]}-${g[1 - k]}`).join(' ');
    return `MATCH TO ${names[k]} · ${all}`;
  }
  return `GAME ${after.games.length} TO ${names[k]} · ${score}`;
}

/**
 * The scoreboard as boxes and texts, in the picture's pixels:
 *   { type: 'rect', x, y, w, h, colour, opacity, layer }
 *   { type: 'poly', points: [[x, y], …], colour, opacity, layer } (the shuttle)
 *   { type: 'text', x, y (middle), text, size, colour, opacity, bold, anchor: 'start'|'middle', shadow, stretch (% width), layer }
 * Rows are A then B. Flags sit beside the rows on the side away from the
 * picture's edge; the banner sits below the board (above it in a bottom corner).
 */
export function boardLayout({ width, height, names, state, style, flags = [null, null], heading = '', banner = '' }) {
  const s = cleanBoard(style);
  const items = [];
  const broadcast = s.layout === 'broadcast';
  const stretch = broadcast ? 84 : 100; // narrow lettering, as on TV
  const rect = (x, y, w, h, c, opacity = 1, layer = 1) => items.push({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), colour: c, opacity, layer });
  const text = (x, y, t, size, c, { opacity = 1, bold = true, anchor = 'start', shadow = false } = {}) =>
    items.push({ type: 'text', x: Math.round(x), y: Math.round(y), text: String(t), size: Math.round(size), colour: c, opacity, bold, anchor, shadow: shadow && !broadcast, stretch, layer: 2 });
  const k = ((FONTS[s.font] ?? 0.62) * stretch) / 100;
  const fs = Math.max(14, Math.round((height / 24) * (s.scale / 100)));
  const pad = Math.round(fs * 0.45);
  const rowH = Math.round(fs * 1.45);
  const dotW = Math.round(fs * 0.9);
  const cellW = Math.round(fs * 1.5);
  const gameW = Math.round(fs * 1.25);
  const nameW = Math.round(Math.max(...names.map((n) => n.length), 6) * fs * k);
  const finished = s.showGames ? state.games : null;
  const colsW = finished ? finished.length * gameW : cellW;
  const headSize = Math.round(fs * 0.58);
  const headH = heading ? Math.round(headSize * 1.8) : 0;
  const shuttleW = Math.round(fs * 0.9);
  // Broadcast: the name from the left edge, then room for the shuttle; classic: the serve dot first.
  const nameX = broadcast ? pad : dotW;
  const nameCol = broadcast ? pad + nameW + shuttleW + pad : dotW + nameW + pad;
  const boxW = Math.max(nameCol + colsW + cellW, heading ? Math.round(heading.length * headSize * k + pad * 2 + cellW) : 0);
  const boxH = headH + rowH * 2;
  const right = s.corner[1] === 'r';
  const bottom = s.corner[0] === 'b';
  const mx = Math.round(width * 0.025);
  const my = Math.round(height * 0.04);
  const x0 = right ? width - mx - boxW : mx;
  const y0 = bottom ? height - my - boxH : my;
  const xPoints = x0 + boxW - cellW / 2;
  const opacity = s.opacity / 100;

  const line = Math.max(1, Math.round(fs * 0.06));
  if (broadcast) rect(x0 + line * 2, y0 + line * 2, boxW, boxH, '#000000', 0.25 * opacity, 0); // a soft drop shadow
  rect(x0, y0, boxW, boxH, s.box, opacity, 0);
  if (heading) text(x0 + pad, y0 + headH / 2, heading, headSize, s.text, { opacity: 0.75, bold: false, shadow: true });
  rect(x0 + boxW - cellW, y0 + headH, cellW, rowH * 2, s.accent);
  if (broadcast) {
    // Lines between the rows and before each game's column.
    rect(x0, y0 + headH + rowH - line / 2, boxW - cellW, line, s.text, 0.14);
    if (finished) finished.forEach((_, i) => rect(x0 + boxW - cellW - colsW + gameW * i, y0 + headH, line, rowH * 2, s.text, 0.14));
  }
  [0, 1].forEach((row) => {
    const yMid = y0 + headH + rowH * row + rowH / 2;
    const side = row ? 'b' : 'a';
    if (state.server === side) {
      if (broadcast) {
        for (const p of shuttleShape(x0 + nameCol - pad - shuttleW / 2, yMid, shuttleW)) items.push({ type: 'poly', ...p, colour: s.accent, layer: 1 });
      } else rect(x0 + dotW * 0.35, yMid - dotW * 0.15, dotW * 0.3, dotW * 0.3, s.accent);
    }
    text(x0 + nameX, yMid, names[row], fs, s.text, { shadow: true });
    if (finished) {
      finished.forEach((g, i) => {
        const won = g[row] > g[1 - row];
        text(x0 + boxW - cellW - colsW + gameW * (i + 0.5), yMid, g[row], fs * 0.9, s.text,
          broadcast ? { anchor: 'middle' } : { opacity: won ? 1 : 0.55, bold: won, anchor: 'middle', shadow: true });
      });
    } else {
      text(x0 + boxW - cellW * 1.5, yMid, state.won[row], fs, s.text, { anchor: 'middle', shadow: true });
    }
    text(xPoints, yMid, state.points[row], fs, s.pointsText, { anchor: 'middle' });
    if (s.flags && flags[row]) {
      const size = fs * 0.55;
      const w = flags[row].length * size * k + pad * 1.5;
      const h = rowH * 0.66;
      const x = right ? x0 - w - pad / 2 : x0 + boxW + pad / 2;
      rect(x, yMid - h / 2, w, h, s.accent);
      text(x + w / 2, yMid, flags[row], size, s.pointsText, { anchor: 'middle' });
    }
  });
  if (s.banners && banner) {
    const size = fs * 0.62;
    const h = Math.round(size * 1.9);
    const w = Math.max(boxW, banner.length * size * k + pad * 2);
    const y = bottom ? y0 - h - pad / 2 : y0 + boxH + pad / 2;
    const x = right ? x0 + boxW - w : x0;
    rect(x, y, w, h, s.accent);
    text(x + w / 2, y + h / 2, banner, size, s.pointsText, { anchor: 'middle' });
  }
  return { items, box: { x: x0, y: y0, w: boxW, h: boxH }, fontSize: fs };
}

/**
 * A shuttle icon, cork down-left, `size` pixels across, centred on (cx, cy):
 * the skirt and the cork as polygons ({ points, opacity }).
 */
export function shuttleShape(cx, cy, size) {
  const d = [-Math.SQRT1_2, Math.SQRT1_2]; // towards the cork
  const p = [Math.SQRT1_2, Math.SQRT1_2]; // across the shuttle
  const at = (along, across) => [Math.round(cx + d[0] * along * size + p[0] * across * size), Math.round(cy + d[1] * along * size + p[1] * across * size)];
  const skirt = [at(0.1, 0.12), at(-0.42, 0.3), at(-0.42, -0.3), at(0.1, -0.12)];
  const cork = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return [Math.round(cx + d[0] * 0.26 * size + Math.cos(a) * 0.15 * size), Math.round(cy + d[1] * 0.26 * size + Math.sin(a) * 0.15 * size)];
  });
  return [{ points: skirt, opacity: 0.7 }, { points: cork, opacity: 1 }];
}

/** The heading line for a match in the chosen style ('' for none). */
export function boardHeading(style, { tournament, match }) {
  const s = cleanBoard(style);
  if (s.heading === 'off') return '';
  const event = [match.draw, match.round, match.game ? `Game ${match.game}` : ''].filter(Boolean).join(' · ');
  return (s.heading === 'full' ? [tournament?.name, event] : [event]).filter(Boolean).join(' · ').toUpperCase().slice(0, 90);
}
