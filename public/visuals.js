// Artwork-led components for the library. The editor keeps its compact layout.
import { h } from './dom.js';
import { icon } from './icons.js';

/** Decorative art: if a picture is missing, the page just leaves it out rather than showing a broken image. */
export const dropMissing = (e) => e.currentTarget.remove();

export function tournamentHero(tournaments) {
  const filmed = tournaments.reduce((total, t) => total + (t.filmed || 0), 0);
  return h('section', { class: 'home-hero', 'aria-labelledby': 'home-title' },
    h('img', { class: 'home-hero-art', src: 'visual-kit/court-banner-short-angled.png', alt: '', width: 2172, height: 724, fetchpriority: 'high', onerror: dropMissing }),
    h('div', { class: 'home-hero-copy' },
      h('div', { class: 'home-eyebrow' }, icon('court', 17), 'Tournaments · Your match library'),
      h('h1', { id: 'home-title' }, 'Every rally. Worth keeping.'),
      h('p', {}, 'Link your footage, tag the rallies, and turn your matches into videos worth watching again.'),
      h('div', { class: 'home-hero-summary' }, tournaments.length
        ? `${tournaments.length} tournament${tournaments.length === 1 ? '' : 's'} · ${filmed} filmed match${filmed === 1 ? '' : 'es'}`
        : 'Your next match starts here.')));
}

/** Decorative illustration; the copy and action links describe the empty state. */
export function illustratedEmpty(title, ...copy) {
  return h('div', { class: 'empty empty-illustrated' },
    h('img', { src: 'visual-kit/shuttle-video.png', alt: '', width: 180, height: 165, loading: 'lazy', onerror: dropMissing }),
    h('div', { class: 'empty-copy' }, h('h3', {}, title), h('p', {}, copy)));
}
