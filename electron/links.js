// What the desktop app's window does with a link or window.open: the app's
// own pages stay in the app; web pages (YouTube, badminfo, Badminton England,
// Google sign-in) open in the default browser; anything else is refused.
// No Electron here, so it can be tested.

/** 'app' (the app's own address), 'browser' (http/https elsewhere) or 'deny'. */
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

/**
 * What a Ctrl+click, middle click or window.open does: 'here' (one of the app's pages opens in the app's one
 * window: it has no tabs or second windows), else as linkAction ('app': a file of the app, such as a picture).
 */
export function openAction(url, origin) {
  const action = linkAction(url, origin);
  return action === 'app' && new URL(url).pathname === '/' ? 'here' : action;
}

/**
 * The window's keyboard extras, given Electron's `before-input-event` input: 'reload', 'devtools' or null. Only in
 * a development copy: in the installed app F5 and the rest do nothing, as it isn't a browser.
 */
export function windowKey(input, { dev = false } = {}) {
  if (!dev || input.type !== 'keyDown') return null;
  if (input.key === 'F5' || (input.control && !input.shift && input.key.toLowerCase() === 'r')) return 'reload';
  if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) return 'devtools';
  return null;
}
