// What the desktop app's window does with a link or window.open: the app's
// own pages stay in the app; web pages (YouTube, badminfo, Badminton England,
// Google sign-in) open in the default browser; anything else is refused.
// No Electron here, so it can be tested.

/** 'app' (one of the app's own pages), 'browser' (http/https elsewhere) or 'deny'. */
export function linkAction(url, origin) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'deny';
  }
  if (u.origin === origin) return 'app';
  if (u.protocol === 'https:' || u.protocol === 'http:') return 'browser';
  return 'deny';
}

/** The window's keyboard extras, given Electron's `before-input-event` input: 'reload', 'devtools' or null. */
export function windowKey(input) {
  if (input.type !== 'keyDown') return null;
  if (input.key === 'F5' || (input.control && !input.shift && input.key.toLowerCase() === 'r')) return 'reload';
  if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) return 'devtools';
  return null;
}
