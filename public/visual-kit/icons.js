// Companion icons for Badminton Video. Same 24px grid and currentColor as icons.js.
// Small, deterministic vectors stay sharp on the timeline and high-DPI displays.
export const paths = {
  shuttle: 'M5 16l3 3a3 3 0 0 1-4-4l1 1zM5 16 10 3l11 11-13 5M7 11l6-5M10 14l6-5M13 17l6-5M5 16l3 3',
  court: 'M5 3h14v18H5zM5 12h14M5 6h14M5 18h14M8 3v18M16 3v18M12 6v6M12 12v6',
  rally: 'M3 7h13l-3-3M16 7l-3 3M21 17H8l3-3M8 17l3 3M5 12h.01M19 12h.01',
  scoreboard: 'M3 5h18v14H3zM3 10h18M12 10v9M7 13v3M16 13h2l-2 3h2M8 2v3M16 2v3',
  tracking: 'M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4M6 16l4-5 4 2 4-6M16 7h2v2',
  highlights: 'M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  'rally-cut': 'M3 5h7v14H3zM14 5h7v14h-7zM7 9v6M17 9v6M12 2v3M12 19v3',
  'voice-clean': 'M3 10v4M7 6v12M11 3v18M15 7v7M19 9v3M16 18l2 2 4-5',
  export: 'M12 15V3M8 7l4-4 4 4M4 13v7h16v-7M8 16v1M16 16v1',
  'match-video': 'M3 5h14v14H3zM17 10l4-3v10l-4-3M8 9l4 3-4 3z',
};

/** Decorative SVG; put the accessible label on its parent button/link. */
export function visualIcon(name, size = 24) {
  if (!Object.hasOwn(paths, name)) throw new Error(`Unknown visual icon: ${name}`);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: size,
    height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
    focusable: 'false' })) svg.setAttribute(key, value);
  svg.classList.add('icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}
