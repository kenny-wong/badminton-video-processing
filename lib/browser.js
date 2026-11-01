// Opens web pages in the default browser, outside the app's window (window.open
// from the Chrome app window would open them inside the app). Only YouTube and
// Google sign-in/help pages, so the route can't be used to open anything else.

import { spawn } from 'node:child_process';

const HOSTS = new Set(['www.youtube.com', 'youtube.com', 'studio.youtube.com', 'youtu.be', 'accounts.google.com', 'support.google.com']);

/** The URL as a string when it's an https page on one of those hosts, else null. */
export function browserUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS.has(u.hostname) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/** Opens the page in the default browser (Windows); false when it isn't allowed or can't be opened here. */
export function openInBrowser(url) {
  const href = browserUrl(url);
  if (!href || process.platform !== 'win32') return false;
  // url.dll hands the URL to the default browser without going through cmd, so & in it is safe.
  spawn('rundll32.exe', ['url.dll,FileProtocolHandler', href], { detached: true, stdio: 'ignore' }).unref();
  return true;
}
