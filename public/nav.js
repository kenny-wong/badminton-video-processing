// Going back inside the app. The router counts the pages shown in this window, so Back returns to the
// previous page when there is one (a tournament comes back to the match opened from it), else it opens
// the page above (the tournament, the Tournaments or Players list).

import { h } from './dom.js';
import { icon } from './icons.js';

let shown = 0;

/** Called by the router for every page it shows. */
export const pageShown = () => {
  shown += 1;
};

/** Back to the previous page in this window, or to `fallback` (a #/ address) when this is the first. */
export function goBack(fallback) {
  if (shown > 1) history.back();
  else location.hash = fallback;
}

/** The Back button and the link to the page above, as every page under the top tabs starts. */
export const backLinks = (href, label, title = '') => h('div', { class: 'crumbs' },
  h('button', { type: 'button', class: 'small', title: 'Back to the previous page', onclick: () => goBack(href) }, icon('back', 15), 'Back'),
  h('a', { class: 'crumb', href, title: title || null }, label));
