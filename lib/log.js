// The app's log file (data/logs/app.log): everything the server prints, with
// the time, so a failure can be looked into after the window that showed it
// has gone. When it passes 5 MB it is renamed app.old.log and started afresh.

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { format } from 'node:util';

const MAX_BYTES = 5 * 1024 * 1024;
let file = null;

/** Where the app log is, or null before startLog(). */
export const appLog = () => file;

/** "2026-10-31 10:07:23" in this PC's time. */
export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** Appends `text` to a log file, each line with the time in front. Never throws. */
export function append(path, text, date = new Date()) {
  if (!path) return;
  const lines = String(text).replace(/\s+$/, '').split(/\r?\n/).map((line) => `${stamp(date)}  ${line}`);
  try {
    appendFileSync(path, `${lines.join('\n')}\n`);
  } catch { /* a log that can't be written mustn't break the app */ }
}

/** The last `bytes` of a text file (from a line start), or null when it can't be read. */
export async function tail(path, bytes = 64 * 1024) {
  try {
    const fh = await open(path, 'r');
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      const text = buf.toString('utf8');
      return start ? text.slice(text.indexOf('\n') + 1) : text;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/** Starts the app log at `path` and copies console.log / warn / error into it. */
export function startLog(path) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path) && statSync(path).size > MAX_BYTES) renameSync(path, path.replace(/\.log$/, '.old.log'));
  } catch { /* keep going without rotating */ }
  file = path;
  for (const [name, level] of [['log', 'INFO '], ['warn', 'WARN '], ['error', 'ERROR']]) {
    const original = console[name].bind(console);
    console[name] = (...args) => {
      original(...args);
      append(file, `${level} ${format(...args)}`);
    };
  }
}
