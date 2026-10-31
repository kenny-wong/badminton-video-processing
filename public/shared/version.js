// The page and the server each have a version: the page's is in index.html
// (the files on disk), the server's is the one it started with. After an
// update they differ until the server is restarted and the window reloaded.
// No DOM code here; tested in tests/version.test.js.

/** -1, 0 or 1 as version a ("1.10.2") is older than, the same as, or newer than b. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * What to tell the user: null when page and server agree; 'reload' when the
 * server is newer (this window still shows the old page); 'restart' when the
 * server is older (it was started before the update).
 */
export function versionAdvice(page, server) {
  if (!page || !server) return null;
  const c = compareVersions(server, page);
  return c > 0 ? 'reload' : c < 0 ? 'restart' : null;
}
