// Moving a file to the Windows Recycle Bin (so it can be restored), through
// PowerShell and .NET's Microsoft.VisualBasic FileSystem.DeleteFile, with
// the path passed in an environment variable so nothing in it is read as a
// command. Retried for a few seconds: a player that was streaming the file
// may still hold it open.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const RECYCLE = "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:BV_FILE, 'OnlyErrorDialogs', 'SendToRecycleBin')";

function once(path) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', RECYCLE], {
      windowsHide: true,
      env: { ...process.env, BV_FILE: path },
    });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 && !existsSync(path) ? resolve() : reject(new Error(err.trim().split('\n')[0] || `powershell exited ${code}`))));
  });
}

/** Moves the file to the Recycle Bin (Windows only). */
export async function toRecycleBin(path, { tries = 4 } = {}) {
  if (process.platform !== 'win32') throw new Error('The Recycle Bin is only on Windows');
  for (let i = 1; ; i++) {
    try {
      return await once(path);
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}
