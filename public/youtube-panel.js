// The editor's YouTube box. Pick one of the match's finished files (the whole
// video, the ★ highlights or a rally clip). Signed in to YouTube, the app uploads
// it itself (a server job: privacy, the tournament's playlist, the link saved on
// the match). By hand: one click copies the title, opens YouTube's upload page
// and shows the file in Explorer.

import { h, fill } from './dom.js';
import { api } from './api.js';
import { icon } from './icons.js';

const YOUTUBE_UPLOAD = 'https://www.youtube.com/upload'; // opens YouTube Studio's upload dialog
const PREFS_KEY = 'badminton-video:youtube-upload:v1';
const PRIVACY = [['unlisted', 'Unlisted: anyone with the link'], ['private', 'Private: only you'], ['public', 'Public']];
const SIGNIN_WAIT_MS = 5 * 60_000;

/** Add to playlist “Sankey U15”, or to a new playlist before the tournament's first upload. */
const playlistLabel = (p) => (p ? `Add to ${p.exists ? 'playlist' : 'a new playlist'} “${p.title}”` : 'Add to the tournament’s playlist');
const TIPS = {
  signIn: 'Opens Google’s sign-in in Chrome. Once signed in, the app uploads rendered videos to your channel itself.',
  signOut: 'Forgets the YouTube sign-in on this PC. Videos already uploaded stay on YouTube.',
  channel: 'The YouTube channel uploads go to',
  file: 'Which finished video to upload: the whole match, the ★ highlights or a rally clip. Newest first.',
  privacy: 'Who can watch the upload. Unlisted: only people you send the link to; it doesn’t show on your channel or in search. Private: only you. Public: everyone, in search too. You can change it later in YouTube Studio.',
  playlist: 'Puts the video in a YouTube playlist named after the tournament, so one link shares all its matches. The playlist is made with the first upload (Unlisted, or Public for public videos); later uploads from the tournament join it.',
  upload: 'Uploads the chosen video with its title and description (chapters too when there are at least 3), then saves its link on this match, replacing any earlier one. You can keep working; it shows on the Jobs page.',
  byHand: 'Copies the title, opens YouTube’s upload page in Chrome and shows the file in Explorer, for you to drag across.',
  copyTitle: 'Puts the title on the clipboard again',
  copyDescription: 'Puts the description on the clipboard',
};

function readPrefs() {
  const prefs = { privacy: 'unlisted', playlist: true };
  try {
    return { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return prefs;
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage blocked: the choice lasts for this page only */ }
}

/** "31 Oct 22:29" for when a file was made. */
const madeAt = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * The box's element and `setFiles(files)` for the editor to call with the
 * match's finished files (GET /api/matches/:id/rendered) whenever they change.
 * `preview` ({ title, description }) is shown before anything is rendered.
 * `onUploaded(url)` gets the link of each upload, which the match now keeps.
 */
export function youtubePanel({ id, preview, runJob, errorNotice, say, onUploaded }) {
  const el = h('div', { class: 'youtube-panel' });
  let files = [];
  let chosen = null; // key of the file picked to upload
  const prefs = readPrefs();
  let yt = { ready: false, signedIn: false, channel: null, uploading: null };
  let busy = false;
  let byHand = null; // key of the file the by-hand helper was used for
  const jobBox = h('div');
  const resultBox = h('div');

  const fileOf = (key) => files.find((f) => f.key === key) ?? null;
  const current = () => fileOf(chosen) ?? files[0] ?? null;
  const copyText = (label, text) => navigator.clipboard.writeText(text).then(() => say(`${label} copied`), () => say(`Couldn’t copy the ${label.toLowerCase()}`));

  /** Opens a YouTube or Google page in the normal browser, not inside the app's window. */
  const openOutside = (url) => api('/api/youtube/open', { method: 'POST', body: { url } }).catch(() => window.open(url, '_blank', 'noopener'));
  // Links in the box (the uploaded video, the playlist, the audit form) go to the normal browser too.
  el.addEventListener('click', (e) => {
    const a = e.target.closest('a[target="_blank"]');
    if (!a || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    openOutside(a.href);
  });

  const startByHand = async () => {
    const f = current();
    if (!f) return;
    // Clipboard first: once YouTube's page has focus, the app can't write to the clipboard any more.
    await copyText('Title', f.title);
    openOutside(YOUTUBE_UPLOAD);
    api('/api/reveal', { method: 'POST', body: { path: f.path } }).catch((e) => say(e.message));
    byHand = f.key;
    draw();
  };

  const handSteps = () => {
    const f = fileOf(byHand);
    if (!f) return null;
    return h('ol', { class: 'upload-steps small' },
      h('li', {}, `Drag the selected file (${f.label.toLowerCase()}) from Explorer onto YouTube’s upload page.`),
      h('li', {}, 'Paste the title (Ctrl+V): it’s on the clipboard. ', h('button', { class: 'small', title: TIPS.copyTitle, onclick: () => copyText('Title', f.title) }, 'Copy again')),
      h('li', {}, h('button', { class: 'small', title: TIPS.copyDescription, onclick: () => copyText('Description', f.description) }, 'Copy description'), ' and paste it under the title.'),
      h('li', {}, 'Choose Unlisted under Visibility, then Save.'),
      h('li', {}, 'Copy the video link YouTube shows and paste it below.'));
  };

  const showResult = (r) => {
    const link = h('a', { href: r.url, target: '_blank', rel: 'noopener' }, `${r.url} ↗`);
    fill(resultBox,
      r.locked
        ? h('div', { class: 'notice warn stack' },
          h('div', { class: 'notice-msg' }, 'Uploaded, but YouTube locked it as Private'),
          h('p', {}, 'Google still restricts this Google project’s uploads until it passes Google’s API audit. Delete this upload in YouTube Studio, upload by hand for now, and send the audit form: ',
            h('a', { href: 'https://support.google.com/youtube/contact/yt_api_form', target: '_blank', rel: 'noopener' }, 'YouTube API audit form ↗')),
          h('div', {}, link))
        : h('div', { class: 'notice ok stack' },
          h('div', { class: 'notice-msg' }, `Uploaded${r.label ? ` (${r.label.toLowerCase()})` : ''}: ${r.privacyNow ?? r.privacy}`),
          h('div', {}, link),
          r.uploadStatus && r.uploadStatus !== 'processed' ? h('div', { class: 'small' }, 'YouTube is still processing it; HD takes a while longer.') : null),
      r.playlist ? h('p', { class: 'small' }, 'Added to the tournament’s playlist: ', h('a', { href: r.playlist.url, target: '_blank', rel: 'noopener' }, 'open playlist ↗')) : null,
      r.playlistError ? h('div', { class: 'notice warn small' }, `Uploaded, but not added to the tournament’s playlist: ${r.playlistError}. Add it in YouTube Studio (Playlists).`) : null);
  };

  const follow = async (start) => {
    busy = true;
    fill(resultBox);
    draw();
    try {
      const r = await runJob(jobBox, start);
      fill(jobBox);
      showResult(r);
      onUploaded(r.url);
    } catch (err) {
      fill(jobBox, errorNotice(err));
    }
    busy = false;
    refresh(); // the playlist may be new now
  };
  const upload = () => {
    const f = current();
    if (f) follow(() => api(`/api/matches/${id}/youtube`, { method: 'POST', body: { file: f.key, privacy: prefs.privacy, playlist: prefs.playlist } }));
  };

  const signIn = async () => {
    try {
      const { url } = await api('/api/youtube/signin', { method: 'POST' });
      openOutside(url);
      say('Finish signing in in the browser window that opened');
      const until = Date.now() + SIGNIN_WAIT_MS;
      const poll = async () => {
        await refresh();
        if (!yt.signedIn && Date.now() < until && el.isConnected) setTimeout(poll, 2000);
      };
      setTimeout(poll, 2000);
    } catch (err) {
      fill(resultBox, errorNotice(err));
    }
  };

  const signOut = async () => {
    if (!confirm('Sign out of YouTube? Uploads from the app stop until you sign in again.')) return;
    await api('/api/youtube/signout', { method: 'POST' }).catch((e) => say(e.message));
    refresh();
  };

  const fileSel = () => {
    const sel = h('select', { 'aria-label': 'Video to upload', title: TIPS.file, disabled: busy, onchange: () => { chosen = sel.value; draw(); } },
      files.map((f) => h('option', { value: f.key, selected: f.key === current()?.key }, `${f.label} · ${madeAt(f.mtime)}`)));
    return h('div', { class: 'row small' }, h('span', { class: 'muted' }, 'Video'), sel);
  };

  const copyArea = (label, text) => {
    const ta = h('textarea', { readonly: true, rows: label === 'Title' ? 2 : 6 }, text);
    return h('div', { class: 'copy-box' },
      h('div', { class: 'row spread small' }, h('strong', {}, label), h('button', { class: 'small', title: `Puts the ${label.toLowerCase()} on the clipboard`, onclick: () => copyText(label, ta.value) }, 'Copy')),
      ta);
  };
  /** The title and description to paste into YouTube: the chosen file's, or before any render the whole video's. */
  const texts = () => {
    const o = current() ?? preview;
    return o?.title ? [copyArea('Title', o.title), copyArea('Description', o.description)] : null;
  };
  let foldOpen = false; // kept across redraws
  const fold = (summary, ...content) => h('details', { class: 'by-hand', open: foldOpen || byHand !== null, ontoggle: (e) => { foldOpen = e.target.open; } },
    h('summary', { class: 'small', title: TIPS.byHand }, summary), ...content);
  const handButton = (primary) => h('button', { class: primary ? 'primary' : 'small', title: TIPS.byHand, onclick: startByHand },
    primary ? icon('youtube', 16) : null, primary ? 'Upload to YouTube' : 'Upload by hand');

  const draw = () => {
    const any = files.length > 0;
    const account = yt.signedIn
      ? h('div', { class: 'row small' }, h('span', { class: 'pill ok' }, 'Signed in'), h('span', { title: TIPS.channel }, yt.channel?.title ?? 'YouTube'), h('button', { class: 'small', title: TIPS.signOut, onclick: signOut }, 'Sign out'))
      : yt.ready
        ? h('div', { class: 'row small' }, h('button', { class: 'small', title: TIPS.signIn, onclick: signIn }, icon('youtube', 16), 'Sign in to YouTube'), h('span', { class: 'hint' }, 'to upload straight from the app'))
        : null;
    if (!any) return fill(el, account, h('p', { class: 'hint' }, 'Render the video first, then upload it from here.'), jobBox, resultBox, texts() ? fold('Title and description', texts()) : null);
    if (!yt.signedIn) {
      return fill(el, account, fileSel(),
        h('div', { class: 'row small' }, handButton(true)),
        byHand ? handSteps() : h('p', { class: 'hint' }, 'Copies the title, opens YouTube’s upload page and shows the file in Explorer.'),
        jobBox, resultBox,
        fold('Title and description', texts()));
    }
    const privacySel = h('select', { 'aria-label': 'Visibility', title: TIPS.privacy, disabled: busy, onchange: () => { prefs.privacy = privacySel.value; savePrefs(prefs); } },
      PRIVACY.map(([v, label]) => h('option', { value: v, selected: v === prefs.privacy }, label)));
    const playlistBox = h('input', { type: 'checkbox', checked: prefs.playlist, disabled: busy, onchange: () => { prefs.playlist = playlistBox.checked; savePrefs(prefs); } });
    fill(el, account,
      fileSel(),
      h('div', { class: 'row small' }, privacySel),
      h('div', { class: 'small playlist-choice' }, h('label', { class: 'check', title: TIPS.playlist }, playlistBox, h('span', {}, playlistLabel(yt.playlist))),
        yt.playlist?.url ? h('a', { href: yt.playlist.url, target: '_blank', rel: 'noopener', title: 'Open the playlist on YouTube' }, 'open ↗') : null),
      h('div', { class: 'row small' }, h('button', { class: 'primary', title: TIPS.upload, disabled: busy, onclick: upload }, icon('youtube', 16), 'Upload to YouTube')),
      jobBox, resultBox,
      fold('Upload by hand instead', h('div', { class: 'row small' }, handButton(false)), byHand ? handSteps() : null, texts()));
  };

  const refresh = async () => {
    try {
      yt = await api(`/api/youtube?match=${id}`);
    } catch { /* keep what was shown */ }
    draw();
  };

  // An upload still running from before the editor was opened: follow it.
  const resume = async () => {
    await refresh();
    const running = yt.uploading;
    if (running && !busy) follow(async () => running);
  };

  draw();
  resume();
  const onFocus = () => {
    if (!el.isConnected) window.removeEventListener('focus', onFocus);
    else if (!busy) refresh();
  };
  window.addEventListener('focus', onFocus);
  return {
    el,
    setFiles(list) {
      // A newly made file becomes the one to upload; otherwise the choice stays.
      if (list[0]?.mtime !== files[0]?.mtime) chosen = null;
      files = list;
      if (chosen && !fileOf(chosen)) chosen = null;
      draw();
    },
  };
}
