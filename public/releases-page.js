// #/releases: what changed in each version, newest first, grouped by month.
// Opened from the version number beside the app name in the header.

import { h, fill } from './dom.js';
import { icon } from './icons.js';
import { goBack } from './nav.js';
import { RELEASES, releaseKind, kindLabel, findReleases, byMonth } from './shared/releases.js';

const FIXES_KEY = 'badminton-video:release-fixes:v1';
const readFixes = () => {
  try {
    return localStorage.getItem(FIXES_KEY) !== 'hide';
  } catch {
    return true;
  }
};
const writeFixes = (show) => {
  try {
    localStorage.setItem(FIXES_KEY, show ? 'show' : 'hide');
  } catch { /* storage blocked */ }
};

const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function renderReleases(main, current) {
  document.title = 'Release notes · Badminton Video';
  const list = h('div', { class: 'release-list' });
  const count = h('span', { class: 'muted release-count' });
  const search = h('input', { type: 'search', placeholder: 'Find in the release notes', 'aria-label': 'Find in the release notes', oninput: () => draw() });
  const fixes = h('input', { type: 'checkbox', checked: readFixes(), onchange: () => { writeFixes(fixes.checked); draw(); } });

  const release = (r) => {
    const kind = releaseKind(r.version);
    return h('article', { class: `release ${kind}${r.version === current ? ' current' : ''}`, id: `v${r.version}` },
      h('div', { class: 'release-head' },
        h('span', { class: 'release-version' }, r.version),
        h('span', { class: `pill release-kind ${kind}` }, kindLabel(r.version)),
        r.version === current ? h('span', { class: 'pill ok' }, 'This version') : null,
        h('span', { class: 'muted release-date' }, longDate(r.date))),
      h('ul', { class: 'release-notes' }, r.notes.map((n) => h('li', {}, n))));
  };

  function draw() {
    const shown = findReleases(RELEASES, search.value).filter((r) => fixes.checked || releaseKind(r.version) !== 'patch');
    count.textContent = shown.length === RELEASES.length ? `${RELEASES.length} versions` : `Showing ${shown.length} of ${RELEASES.length} versions`;
    fill(list, shown.length
      ? byMonth(shown).map((g) => [h('h2', { class: 'day-title' }, g.month), g.releases.map(release)])
      : h('p', { class: 'muted' }, 'No release notes match.'));
  }

  fill(main,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Release notes'),
        h('div', { class: 'sub' }, current ? `What changed in each version. This is version ${current}.` : 'What changed in each version.')),
      h('div', { class: 'actions' },
        h('button', { title: 'Close the release notes and go back to the page before', onclick: () => goBack('#/') }, icon('close', 16), 'Close'))),
    h('div', { class: 'toolbar release-toolbar' },
      search,
      h('label', { class: 'check' }, fixes, 'Show small fixes'),
      count),
    list);
  draw();
}
