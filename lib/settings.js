// App settings, kept in the settings table as JSON values.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CUT } from './render.js';
import { cleanNameStyle, DEFAULT_NAME_STYLE } from '../public/shared/names.js';
import { cleanBoard, CORNERS, DEFAULT_BOARD } from '../public/shared/board.js';
import { cleanCards, DEFAULT_CARDS } from './cards.js';

export const DEFAULT_LOGO = { file: '', corner: 'tr', size: 12, opacity: 90 };

/** The logo's placement; its file is only ever set by the upload (api/settings.js). */
export function cleanLogo(v, current = DEFAULT_LOGO) {
  const out = { ...DEFAULT_LOGO, ...current };
  if (Object.hasOwn(CORNERS, v?.corner)) out.corner = v.corner;
  if (Number.isFinite(v?.size)) out.size = Math.min(40, Math.max(4, Math.round(v.size)));
  if (Number.isFinite(v?.opacity)) out.opacity = Math.min(100, Math.max(20, Math.round(v.opacity)));
  return out;
}

export const DEFAULT_OUTPUT = { size: 'source', maxRate: 0, replays: false, removeVoices: false, hdrLook: 'normal' };
export const OUTPUT_SIZES = { source: 'As filmed', 1080: '1080p', 720: '720p' };
// How bright HDR phone videos come out in the (ordinary, SDR) render: `npl` is the brightness, in nits,
// the HDR picture is taken to have at its peak before tone mapping; a higher one makes the video darker.
// Before 1.49.0 every render used 100 (bright: a green court floor glared).
// `playback`: the CSS filter that makes Chrome's own showing of an HLG phone video in the editor look like
// the render (Chrome shows it brighter and harsher: average 136 against Normal's 122). Fitted in Chrome on
// the user's footage against FFmpeg's frames: average error per colour 16.2 -> 3.7 (Normal), 15.1 -> 5.5
// (Bright), 30.0 -> 3.2 (Darker), out of 255.
export const HDR_LOOKS = {
  bright: { label: 'Bright', npl: 100, playback: 'brightness(1.22) contrast(0.655) saturate(1.54)' },
  normal: { label: 'Normal', npl: 200, playback: 'brightness(0.895) contrast(0.805) saturate(1.37)' },
  darker: { label: 'Darker', npl: 300, playback: 'brightness(0.76) contrast(0.865) saturate(1.305)' },
};
const hdrLook = (output) => HDR_LOOKS[output?.hdrLook] ?? HDR_LOOKS[DEFAULT_OUTPUT.hdrLook];
export const hdrNpl = (output) => hdrLook(output).npl;
/** The filter that shows an HDR original in the editor as the render at this brightness will look. */
export const hdrPlayback = (output) => hdrLook(output).playback;

/**
 * Size ('source', '1080', '720'), a bitrate cap in Mbit/s (0 for none), slow-motion replays of ★ rallies,
 * taking voices out of the sound and how bright HDR videos come out (HDR_LOOKS).
 */
export function cleanOutput(v) {
  const out = { ...DEFAULT_OUTPUT };
  if (Object.hasOwn(OUTPUT_SIZES, String(v?.size))) out.size = String(v.size);
  if (Object.hasOwn(HDR_LOOKS, String(v?.hdrLook))) out.hdrLook = String(v.hdrLook);
  if (Number.isFinite(v?.maxRate)) out.maxRate = Math.min(100, Math.max(0, Math.round(v.maxRate)));
  for (const k of ['replays', 'removeVoices']) if (typeof v?.[k] === 'boolean') out[k] = v[k];
  return out;
}

export const DEFAULT_MUSIC = { file: '', volume: 35, court: 60, use: 'highlights' };
export const MUSIC_USES = { off: 'Never', highlights: 'Highlights and reels', all: 'Every video' };

/** Music volumes and when to use it; the file is only ever set by the upload (api/settings.js). */
export function cleanMusic(v, current = DEFAULT_MUSIC) {
  const out = { ...DEFAULT_MUSIC, ...current };
  for (const k of ['volume', 'court']) if (Number.isFinite(v?.[k])) out[k] = Math.min(100, Math.max(0, Math.round(v[k])));
  if (Object.hasOwn(MUSIC_USES, v?.use)) out.use = v.use;
  return out;
}

export const DEFAULT_DESCRIPTION = { playerLinks: true, winChance: false, upsetInTitle: false };

export function cleanDescription(v) {
  const out = { ...DEFAULT_DESCRIPTION };
  for (const k of Object.keys(out)) if (typeof v?.[k] === 'boolean') out[k] = v[k];
  return out;
}

export const DEFAULTS = {
  videoFolders: [],                                   // folders scanned for phone videos
  outputFolder: join(homedir(), 'Videos', 'Badminton'), // finished videos, by year and tournament
  ffmpegFolder: '',                                   // where ffmpeg.exe is, when not found by itself
  pre: DEFAULT_CUT.pre,
  post: DEFAULT_CUT.post,
  sensitivity: 5,
  nameStyle: DEFAULT_NAME_STYLE,                      // scoreboard names for singles and doubles
  board: DEFAULT_BOARD,                               // scoreboard look (public/shared/board.js)
  logo: DEFAULT_LOGO,                                 // a picture in a corner of every rendered video
  cards: DEFAULT_CARDS,                               // title card before the first rally, end card after the last
  description: DEFAULT_DESCRIPTION,                   // what the YouTube description and title add about the players
  output: DEFAULT_OUTPUT,                             // size, bitrate cap, slow-motion replays, voices taken out
  music: DEFAULT_MUSIC,                               // music under highlights (file uploaded like the logo)
};

const MAX_LIST = 50;
const MAX_TEXT = 400;

/** Settings from the page, kept only when valid; anything else keeps its current value. */
export function cleanSettings(input, current = DEFAULTS) {
  const out = { ...current };
  const list = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean).map((x) => x.slice(0, MAX_TEXT)))].slice(0, MAX_LIST) : null);
  const text = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : null);
  const number = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  out.videoFolders = list(input?.videoFolders) ?? out.videoFolders;
  out.outputFolder = text(input?.outputFolder) || out.outputFolder;
  out.ffmpegFolder = text(input?.ffmpegFolder) ?? out.ffmpegFolder;
  out.pre = number(input?.pre, 0, 10) ?? out.pre;
  out.post = number(input?.post, 0, 10) ?? out.post;
  out.sensitivity = number(input?.sensitivity, 1, 10) ?? out.sensitivity;
  if (input?.nameStyle !== undefined) out.nameStyle = cleanNameStyle(input.nameStyle);
  if (input?.board !== undefined) out.board = cleanBoard(input.board);
  if (input?.logo !== undefined) out.logo = cleanLogo(input.logo, out.logo);
  if (input?.cards !== undefined) out.cards = cleanCards(input.cards);
  if (input?.description !== undefined) out.description = cleanDescription(input.description);
  if (input?.output !== undefined) out.output = cleanOutput(input.output);
  if (input?.music !== undefined) out.music = cleanMusic(input.music, out.music);
  return out;
}

export function readSettings(db) {
  const out = { ...DEFAULTS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (key in DEFAULTS) {
      try {
        out[key] = JSON.parse(value);
      } catch { /* keep the default */ }
    }
  }
  out.board = cleanBoard(out.board); // saved by an older version, or partly
  out.logo = { ...cleanLogo(out.logo, out.logo), file: typeof out.logo?.file === 'string' ? out.logo.file : '' };
  out.cards = cleanCards(out.cards);
  out.description = cleanDescription(out.description);
  out.output = cleanOutput(out.output);
  out.music = { ...cleanMusic(out.music, out.music), file: typeof out.music?.file === 'string' ? out.music.file : '' };
  return out;
}

export function writeSettings(db, settings) {
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  for (const key of Object.keys(DEFAULTS)) put.run(key, JSON.stringify(settings[key]));
}
