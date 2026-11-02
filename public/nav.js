// Going back inside the app. The router counts the pages shown in this window, so Back returns to the
// previous page when there is one (a tournament comes back to the match opened from it), else it opens
// the page above (the tournament, the Tournaments or Players list).

import { h } from './dom.js';
import { icon } from './icons.js';

let shown = 0;
let replacing = false;
let current = null; // this page's address, and the one shown before it
let previous = null;

/** Called by the router for every page it shows, with its address. */
export const pageShown = (hash = location.hash || '#/') => {
  if (replacing) replacing = false; // took the place of the page before: no new step back
  else {
    shown += 1;
    previous = current;
  }
  current = hash;
};

/**
 * Shows `hash` in place of the current page, so Back skips it: moving between a match's games in the
 * editor, where Back should still go to the tournament (or wherever the match was opened from).
 */
export function replacePage(hash) {
  replacing = true;
  location.replace(hash);
}

/**
 * Back to the previous page in this window, or to `fallback` (a #/ address) when this is the first.
 * With `up`, always to `fallback` (the page above): a step back when that was the page before (it keeps
 * its place), else opening it.
 */
export function goBack(fallback, { up = false } = {}) {
  if (shown > 1 && (!up || previous === fallback)) history.back();
  else location.hash = fallback;
}

/** The Back button and the link to the page above, as every page under the top tabs starts (`up`: see goBack). */
export const backLinks = (href, label, title = '', { up = false } = {}) => h('div', { class: 'crumbs' },
  h('button', { type: 'button', class: 'small', title: up ? `Back to ${label}` : 'Back to the previous page', onclick: () => goBack(href, { up }) }, icon('back', 15), 'Back'),
  h('a', { class: 'crumb', href, title: title || null }, label));
