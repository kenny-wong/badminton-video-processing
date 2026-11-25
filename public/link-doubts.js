// The warning that links go against when the videos were recorded
// (lib/tournament-videos.js works them out), on the tournament's page and its
// Videos page. "Keep these links" hides it on this computer until they change.

import { h, when } from './dom.js';
import { icon } from './icons.js';
import { teamName } from './shared/names.js';
import { doubtKey } from './shared/link-doubts.js';

const KEPT = 'badminton-video:links-kept:v1';

function readKept() {
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT) ?? '{}');
    return kept && typeof kept === 'object' ? kept : {};
  } catch {
    return {};
  }
}

function keep(id, key) {
  try {
    localStorage.setItem(KEPT, JSON.stringify({ ...readKept(), [id]: key }));
  } catch { /* storage is blocked: shown again next time */ }
}

const title = (m) => [h('strong', {}, [m.time, m.draw, m.round].filter(Boolean).join(' · ')), ` (${teamName(m.teamA)} v ${teamName(m.teamB)})`];
const list = (videos) => `${videos.length === 1 ? 'The video' : `${videos.length} videos`} recorded at ${videos.map((v) => when(v.recordedAt, { date: false })).join(', ')}`;

/** The warning, or null when nothing is doubted or the user kept these links. */
export function doubtNotice(id, doubts) {
  if (!doubts?.length) return null;
  const key = doubtKey(doubts);
  if (readKept()[id] === key) return null;
  const box = h('div', { class: 'notice warn stack link-doubts' },
    h('div', { class: 'row' }, icon('alert', 16), h('strong', {}, 'Some links don’t fit when the videos were recorded')),
    h('ul', { class: 'small' }, doubts.map((d) => h('li', {}, ...(!d.fits
      ? [`The games of `, ...title(d.now), ` were filmed in another order than they’re linked: ${d.videos.map((v) => when(v.recordedAt, { date: false })).join(', ')}.`]
      : d.now
        ? [`${list(d.videos)} ${d.videos.length === 1 ? 'is' : 'are'} linked to `, ...title(d.now), ', but their times and lengths fit ', ...title(d.fits), ' better.']
        : [`${list(d.videos)}, not linked, ${d.videos.length === 1 ? 'fits' : 'fit'} `, ...title(d.fits), ', which has other videos.'])))),
    h('div', { class: 'small' }, 'To change them, link each video to its right match or game: its tagging moves with it, but render and YouTube status are cleared. If they’re right, for example because matches were played in another order, keep them.'),
    h('div', {}, h('button', { class: 'small', type: 'button', onclick: () => { keep(id, key); box.remove(); } }, 'Keep these links')));
  return box;
}
