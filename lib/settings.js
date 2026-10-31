// App settings, kept in the settings table as JSON values.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CUT } from './render.js';
import { cleanNameStyle, DEFAULT_NAME_STYLE } from '../public/shared/names.js';
import { cleanBoard, DEFAULT_BOARD } from '../public/shared/board.js';

export const DEFAULTS = {
  videoFolders: [],                                   // folders scanned for phone videos
  outputFolder: join(homedir(), 'Videos', 'Badminton'), // finished videos, by year and tournament
  players: [],                                        // names of "my players", to pick out their matches
  ffmpegFolder: '',                                   // where ffmpeg.exe is, when not found by itself
  pre: DEFAULT_CUT.pre,
  post: DEFAULT_CUT.post,
  sensitivity: 5,
  nameStyle: DEFAULT_NAME_STYLE,                      // scoreboard names for singles and doubles
  board: DEFAULT_BOARD,                               // scoreboard look (public/shared/board.js)
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
  out.players = list(input?.players) ?? out.players;
  out.outputFolder = text(input?.outputFolder) || out.outputFolder;
  out.ffmpegFolder = text(input?.ffmpegFolder) ?? out.ffmpegFolder;
  out.pre = number(input?.pre, 0, 10) ?? out.pre;
  out.post = number(input?.post, 0, 10) ?? out.post;
  out.sensitivity = number(input?.sensitivity, 1, 10) ?? out.sensitivity;
  if (input?.nameStyle !== undefined) out.nameStyle = cleanNameStyle(input.nameStyle);
  if (input?.board !== undefined) out.board = cleanBoard(input.board);
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
  return out;
}

export function writeSettings(db, settings) {
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  for (const key of Object.keys(DEFAULTS)) put.run(key, JSON.stringify(settings[key]));
}
