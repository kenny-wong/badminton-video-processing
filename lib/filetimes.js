// A file's created / modified / accessed times. Node can set the last two;
// the created time on Windows is set through PowerShell (.NET's
// File.SetCreationTimeUtc), with the path and time passed in environment
// variables so nothing in them is read as a command.

import { spawn } from 'node:child_process';
import { stat, utimes } from 'node:fs/promises';

/** { created, modified, accessed } in ms since 1970 (created may be null where the system has none). */
export async function fileTimes(path) {
  const s = await stat(path);
  return { created: s.birthtimeMs > 0 ? s.birthtimeMs : null, modified: s.mtimeMs, accessed: s.atimeMs };
}

const SET_CREATED = '[System.IO.File]::SetCreationTimeUtc($env:BV_FILE, [DateTimeOffset]::FromUnixTimeMilliseconds([long]$env:BV_MS).UtcDateTime)';

function setCreated(path, ms) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SET_CREATED], {
      windowsHide: true,
      env: { ...process.env, BV_FILE: path, BV_MS: String(Math.round(ms)) },
    });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `powershell exited ${code}`))));
  });
}

/** Sets the times that are given (numbers); returns which ones were set. */
export async function setFileTimes(path, { created, modified, accessed }) {
  const set = [];
  if (Number.isFinite(created) && process.platform === 'win32') {
    await setCreated(path, created);
    set.push('created');
  }
  // After the created time, so opening the file for that can't move these.
  if (Number.isFinite(modified) || Number.isFinite(accessed)) {
    const now = await fileTimes(path);
    await utimes(path, new Date(Number.isFinite(accessed) ? accessed : now.accessed), new Date(Number.isFinite(modified) ? modified : now.modified));
    if (Number.isFinite(modified)) set.push('modified');
    if (Number.isFinite(accessed)) set.push('accessed');
  }
  return set;
}
