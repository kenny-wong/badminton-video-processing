// Restarting the server from the page: the running server starts a fresh copy
// of itself (same Node, same options, same port and database), answers, and
// stops; the new one waits for the port to come free. Jobs end with the old
// server, so the page asks first while any run.

import { spawn } from 'node:child_process';

/** Set in the new copy's environment: wait for the port instead of failing. */
export const RESTART_ENV = 'BADMINTON_VIDEO_RESTART';

/**
 * The command line for the new copy: Node's own options and the script, but
 * not --open (the window is already open). Null when the server runs under
 * `node --watch` (npm run dev), which restarts it by itself.
 */
export function restartCommand(execArgv, argv) {
  if (execArgv.some((a) => a === '--watch' || a.startsWith('--watch='))) return null;
  return [...execArgv, ...argv.slice(1).filter((a) => a !== '--open')];
}

/** Starts the new copy, detached, and stops this one shortly after (so the page gets its answer). */
export function restartSoon({ delayMs = 300 } = {}) {
  const args = restartCommand(process.execArgv, process.argv);
  if (!args) return false;
  spawn(process.execPath, args, {
    cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, [RESTART_ENV]: '1' },
  }).unref();
  setTimeout(() => process.exit(0), delayMs);
  return true;
}

/** Listens, and in a restarted copy keeps trying for a while if the old one still holds the port. */
export function listenWhenFree(server, port, host, onListening, { tries = 60, waitMs = 250 } = {}) {
  let left = process.env[RESTART_ENV] ? tries : 0;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && left-- > 0) setTimeout(() => server.listen(port, host), waitMs);
    else throw err;
  });
  server.listen(port, host, onListening);
}
