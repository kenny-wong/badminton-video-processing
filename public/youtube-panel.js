// The editor's YouTube box. Signed in to YouTube, the app uploads the rendered
// video itself (a server job: privacy, the tournament's playlist, the link
// saved on the match). By hand: one click copies the title, opens YouTube's
// upload page and shows the file in Explorer.

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
  privacy: 'Who can watch the upload. Unlisted: only people you send the link to; it doesn’t show on your channel or in search. Private: only you. Public: everyone, in search too. You can change it later in YouTube Studio.',
  playlist: 'Puts the video in a YouTube playlist named after the tournament, so one link shares all its matches. The playlist is made with the first upload (Unlisted, or Public for public videos); later uploads from the tournament join it.',
  upload: 'Uploads the rendered video with its title and description (chapters too when there are at least 3), then saves the link on this match. You can keep working; it shows on the Jobs page.',
  uploadHighlights: 'Uploads the ★ highlights video. Its link isn’t saved on the match.',
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

/**
 * The box's element and `rendered(which, { title, description })` for the
 * editor to call after a render. `onUploaded(url)` gets the link of a whole
 * video uploaded by the app.
 */
export function youtubePanel({ id, output, highlights, runJob, errorNotice, say, onUploaded }) {
  const el = h('div', { class: 'youtube-panel' });
  const uploads = { video: { ...output }, highlights: { ...highlights } };
  const prefs = readPrefs();
  let yt = { ready: false, signedIn: false, channel: null, jobs: null };
  let busy = false;
  let byHand = null; // 'video' | 'highlights' once the by-hand helper was used
  const jobBox = h('div');
  const resultBox = h('div');

  const copyText = (label, text) => navigator.clipboard.writeText(text).then(() => say(`${label} copied`), () => say(`Couldn’t copy the ${label.toLowerCase()}`));

  const startByHand = async (which) => {
    // Clipboard first: once YouTube's tab has focus, the page can't write to the clipboard any more.
    await copyText('Title', uploads[which].title);
    window.open(YOUTUBE_UPLOAD, '_blank', 'noopener');
    api(`/api/matches/${id}/reveal`, { method: 'POST', body: { highlights: which === 'highlights' } }).catch((e) => say(e.message));
    byHand = which;
    draw();
  };

  const handSteps = () => {
    const o = uploads[byHand];
    return h('ol', { class: 'upload-steps small' },
      h('li', {}, 'Drag the selected file from Explorer onto YouTube’s upload page.'),
      h('li', {}, 'Paste the title (Ctrl+V): it’s on the clipboard. ', h('button', { class: 'small', title: TIPS.copyTitle, onclick: () => copyText('Title', o.title) }, 'Copy again')),
      h('li', {}, h('button', { class: 'small', title: TIPS.copyDescription, onclick: () => copyText('Description', o.description) }, 'Copy description'), ' and paste it under the title.'),
      h('li', {}, 'Choose Unlisted under Visibility, then Save.'),
      byHand === 'video' ? h('li', {}, 'Copy the video link YouTube shows and paste it below.') : null);
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
          h('div', { class: 'notice-msg' }, `Uploaded${r.highlights ? ' (highlights)' : ''}: ${r.privacyNow ?? r.privacy}`),
          h('div', {}, link),
          r.uploadStatus && r.uploadStatus !== 'processed' ? h('div', { class: 'small' }, 'YouTube is still processing it; HD takes a while longer.') : null),
      r.playlist ? h('p', { class: 'small' }, 'Added to the tournament’s playlist: ', h('a', { href: r.playlist.url, target: '_blank', rel: 'noopener' }, 'open playlist ↗')) : null,
      r.playlistError ? h('p', { class: 'small muted' }, `Not added to a playlist: ${r.playlistError}`) : null);
  };

  const upload = async (which) => {
    busy = true;
    fill(resultBox);
    draw();
    try {
      const r = await runJob(jobBox, () => api(`/api/matches/${id}/youtube`, { method: 'POST', body: { highlights: which === 'highlights', privacy: prefs.privacy, playlist: prefs.playlist } }));
      fill(jobBox);
      showResult(r);
      if (!r.highlights) onUploaded(r.url);
    } catch (err) {
      fill(jobBox, errorNotice(err));
    }
    busy = false;
    refresh(); // the playlist may be new now
  };

  const signIn = async () => {
    try {
      const { url } = await api('/api/youtube/signin', { method: 'POST' });
      window.open(url, '_blank', 'noopener');
      say('Finish signing in in the browser tab that opened');
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

  const handButtons = (primary) => h('div', { class: 'row small' },
    uploads.video.exists ? h('button', { class: primary ? 'primary' : 'small', title: TIPS.byHand, onclick: () => startByHand('video') }, primary ? icon('youtube', 16) : null, primary ? 'Upload to YouTube' : 'Upload by hand') : null,
    uploads.highlights.exists ? h('button', { class: primary ? '' : 'small', title: TIPS.byHand, onclick: () => startByHand('highlights') }, primary ? '★ Upload highlights' : '★ Highlights by hand') : null);

  const draw = () => {
    const { video, highlights: hl } = uploads;
    const any = video.exists || hl.exists;
    const account = yt.signedIn
      ? h('div', { class: 'row small' }, h('span', { class: 'pill ok' }, 'Signed in'), h('span', { title: TIPS.channel }, yt.channel?.title ?? 'YouTube'), h('button', { class: 'small', title: TIPS.signOut, onclick: signOut }, 'Sign out'))
      : yt.ready
        ? h('div', { class: 'row small' }, h('button', { class: 'small', title: TIPS.signIn, onclick: signIn }, icon('youtube', 16), 'Sign in to YouTube'), h('span', { class: 'hint' }, 'to upload straight from the app'))
        : null;
    if (!yt.signedIn) {
      return fill(el, account,
        any ? handButtons(true) : h('p', { class: 'hint' }, 'Render the video first, then upload it from here.'),
        byHand ? handSteps() : any ? h('p', { class: 'hint' }, 'Copies the title, opens YouTube’s upload page and shows the file in Explorer.') : null,
        jobBox, resultBox);
    }
    const privacySel = h('select', { 'aria-label': 'Visibility', title: TIPS.privacy, disabled: busy, onchange: () => { prefs.privacy = privacySel.value; savePrefs(prefs); } },
      PRIVACY.map(([v, label]) => h('option', { value: v, selected: v === prefs.privacy }, label)));
    const playlistBox = h('input', { type: 'checkbox', checked: prefs.playlist, disabled: busy, onchange: () => { prefs.playlist = playlistBox.checked; savePrefs(prefs); } });
    fill(el, account,
      any ? h('div', { class: 'row small' }, privacySel) : null,
      any ? h('div', { class: 'small playlist-choice' }, h('label', { class: 'check', title: TIPS.playlist }, playlistBox, h('span', {}, playlistLabel(yt.playlist))),
        yt.playlist?.url ? h('a', { href: yt.playlist.url, target: '_blank', rel: 'noopener', title: 'Open the playlist on YouTube' }, 'open ↗') : null) : null,
      h('div', { class: 'row small' },
        video.exists ? h('button', { class: 'primary', title: TIPS.upload, disabled: busy, onclick: () => upload('video') }, icon('youtube', 16), 'Upload to YouTube') : null,
        hl.exists ? h('button', { title: TIPS.uploadHighlights, disabled: busy, onclick: () => upload('highlights') }, '★ Upload highlights') : null,
        any ? null : h('span', { class: 'hint' }, 'Render the video first, then upload it from here.')),
      jobBox, resultBox,
      any ? h('details', { class: 'by-hand', open: byHand !== null }, h('summary', { class: 'small', title: TIPS.byHand }, 'Upload by hand instead'), handButtons(false), byHand ? handSteps() : null) : null);
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
    const running = ['video', 'highlights'].map((k) => yt.jobs?.[k]).find((j) => j && (j.status === 'running' || j.status === 'queued'));
    if (!running) return;
    busy = true;
    draw();
    try {
      const r = await runJob(jobBox, async () => running);
      fill(jobBox);
      showResult(r);
      if (!r.highlights) onUploaded(r.url);
    } catch (err) {
      fill(jobBox, errorNotice(err));
    }
    busy = false;
    draw();
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
    rendered(which, o) {
      uploads[which] = { title: o.title, description: o.description, exists: true };
      draw();
    },
  };
}
