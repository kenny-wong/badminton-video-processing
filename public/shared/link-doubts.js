// Which doubted links a warning is about, as text: the same for the same
// links, so "Keep these links" stays until something changes. Tested in
// tests/tournament-videos.test.js.

/** @param {{ videos: { id: number }[], now: { id: number }|null, fits: { id: number }|null }[]} doubts */
export const doubtKey = (doubts) => doubts.map((d) => `${d.videos.map((v) => v.id).sort((x, y) => x - y).join('+')}:${d.now?.id ?? '-'}>${d.fits?.id ?? '-'}`).sort().join(' ');
