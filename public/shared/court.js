// The court seen by the camera: four corners clicked on the video give a
// homography (a perspective mapping) between picture and court, in metres.
// No DOM code here; the page draws the court lines with it, the server maps the
// shuttle with it. Tested in tests/court.test.js.

export const COURT = { width: 6.1, length: 13.4, net: 6.7 }; // doubles court, metres

/** The court corners in the order they are clicked: near-left, near-right, far-right, far-left. */
export const CORNERS = [[0, 0], [COURT.width, 0], [COURT.width, COURT.length], [0, COURT.length]];
export const CORNER_NAMES = ['near left', 'near right', 'far right', 'far left'];

/** Solves the 8×8 system for the homography taking `from` points to `to` points (4 each). */
export function homography(from, to) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = from[i];
    const [x, y] = to[i];
    rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    rows.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[p][c])) p = r;
    if (Math.abs(rows[p][c]) < 1e-12) return null; // three corners in a line
    [rows[c], rows[p]] = [rows[p], rows[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = rows[r][c] / rows[c][c];
      for (let k = c; k < 9; k++) rows[r][k] -= f * rows[c][k];
    }
  }
  const h = rows.map((r, i) => r[8] / r[i]);
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

/** Applies a homography to a point. */
export function apply(H, [u, v]) {
  const w = H[2][0] * u + H[2][1] * v + H[2][2];
  return [(H[0][0] * u + H[0][1] * v + H[0][2]) / w, (H[1][0] * u + H[1][1] * v + H[1][2]) / w];
}

/**
 * Picture → court and court → picture mappings from four clicked corners
 * (picture coordinates as fractions of width and height, 0-1); null when the
 * corners can't be a court.
 */
export function courtMapping(corners) {
  if (!Array.isArray(corners) || corners.length !== 4 || !corners.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return null;
  const toCourt = homography(corners, CORNERS);
  const toPicture = homography(CORNERS, corners);
  return toCourt && toPicture ? { toCourt, toPicture } : null;
}

/** Corners kept only when valid: four [x, y] fractions of the picture, rounded. */
export function cleanCorners(corners) {
  if (!courtMapping(corners) || !corners.every((p) => p.every((n) => n >= -0.5 && n <= 1.5))) return null;
  return corners.map((p) => p.map((n) => Math.round(n * 10000) / 10000));
}

/** The court's lines (each [[x, y], [x, y]] in metres): outer lines, singles sidelines, net, service lines, centre lines. */
export function courtLines() {
  const { width: w, length: l, net: n } = COURT;
  const short = 1.98; // short service line from the net
  const long = 0.76; // doubles long service line from the baseline
  const side = 0.46; // singles sideline in from the doubles one
  return [
    [[0, 0], [w, 0]], [[w, 0], [w, l]], [[w, l], [0, l]], [[0, l], [0, 0]],
    [[side, 0], [side, l]], [[w - side, 0], [w - side, l]],
    [[0, n], [w, n]],
    [[0, n - short], [w, n - short]], [[0, n + short], [w, n + short]],
    [[0, long], [w, long]], [[0, l - long], [w, l - long]],
    [[w / 2, 0], [w / 2, n - short]], [[w / 2, n + short], [w / 2, l]],
  ];
}
