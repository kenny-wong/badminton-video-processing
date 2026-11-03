// "Share YouTube links": the links of the matches a page's filters show, as text to paste into a message.
// Copied at once (the click allows it); the box shows the text, editable, with Copy again.

import { h } from './dom.js';
import { icon } from './icons.js';
import { youtubeShareText } from './shared/share.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A button that shares the YouTube links of `matches()` (each with `links` [{ game, url }]) under `title()`.
 * `byTournament` adds a line per tournament (the player page).
 */
export function shareButton({ matches, title, byTournament = false, label = 'Share YouTube links' }) {
  return h('button', {
    class: 'small', type: 'button', title: 'Copy the YouTube links of the matches shown (as filtered), with each match’s players, result and time, to paste into a message',
    onclick: () => openShare(youtubeShareText(matches(), { title: title(), byTournament })),
  }, icon('youtube', 14), label);
}

function openShare({ text, matches, videos }) {
  const status = h('span', { class: 'small muted', role: 'status' });
  const box = h('textarea', { class: 'share-text', rows: 16, spellcheck: false, 'aria-label': 'Text to share' });
  box.value = text;
  const copied = () => { status.textContent = 'Copied: paste it into a message.'; };
  // The clipboard API needs the window focused; the older copy command (on the selected text) is the fallback.
  const copy = () => navigator.clipboard.writeText(box.value).then(copied, () => {
    box.select();
    if (document.execCommand('copy')) copied();
    else status.textContent = 'Couldn’t copy: the text is selected, press Ctrl+C.';
  });
  const close = () => dialog.close();
  const dialog = h('dialog', { class: 'keys-dialog share-dialog', 'aria-label': 'Share YouTube links' },
    h('div', { class: 'row spread' },
      h('h3', { class: 'card-title' }, icon('youtube'), videos ? `${plural(videos, 'YouTube video')} from ${plural(matches, 'match', 'matches')}` : 'No YouTube links'),
      h('button', { class: 'small', type: 'button', onclick: close }, 'Close')),
    videos
      ? [h('p', { class: 'hint' }, 'The matches shown with the filters you chose. Edit the text here if you like; Copy puts it on the clipboard.'),
        box, h('div', { class: 'row' }, h('button', { class: 'primary small', type: 'button', onclick: copy }, icon('copy', 14), 'Copy'), status)]
      : h('p', {}, 'None of the matches shown has a YouTube link yet. Change the filters, or upload some videos first.'));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  if (videos) copy();
}
