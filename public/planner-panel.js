// Settings → Enrolment planner: connects the app to the planner with a code made there, so the
// YouTube links of matches go there by themselves (lib/planner.js).

import { h, fill } from './dom.js';
import { api } from './api.js';

const n = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Rallies filled in from the planner's recorded games, and the videos still waiting for one. */
function recordsBox(s) {
  const r = s.records ?? { filled: [], waiting: [] };
  const line = (x, extra) => h('li', {}, h('a', { href: `#/m/${x.matchId}` }, x.label), extra);
  return h('div', { class: 'stack' },
    h('p', { class: 'hint' }, 'A video with no rallies tagged takes them from a game recorded on the planner (by you or any VIP account), placed by the time of each tap. Rallies you tag are never replaced; filled ones are marked tagged automatically, to review.'),
    s.recordsError ? h('div', { class: 'notice bad' }, `Recorded games couldn’t be read: ${s.recordsError}. Tried again after the next change, and every hour.`) : null,
    r.filled.length ? h('div', { class: 'notice ok' }, h('p', {}, 'Filled from recorded games lately:'),
      h('ul', { class: 'planner-problems' }, r.filled.map((x) => line(x, `: ${n(x.rallies, 'rally', 'rallies')}${x.rallies < x.of ? ` of ${x.of} (the rest is outside the video)` : ''}`)))) : null,
    r.waiting.length ? h('div', { class: 'notice warn' }, h('p', {}, `Recorded on the planner but not filled in (${r.waiting.length}):`),
      h('ul', { class: 'planner-problems' }, r.waiting.map((x) => line(x, `: ${x.why}`)))) : null);
}

export function plannerPanel({ errorNotice }) {
  const box = h('div', { class: 'stack' });
  const msg = h('div', {});
  let busy = false;
  /** Runs a call and shows the connection as it is afterwards. */
  const run = async (button, words, work, done) => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    fill(msg, h('p', { class: 'hint' }, words));
    try {
      draw(await work());
      fill(msg, done ? h('div', { class: 'notice ok' }, done) : null);
    } catch (err) {
      fill(msg, errorNotice(err));
      button.disabled = false;
    }
    busy = false;
  };
  function draw(s) {
    if (!s.connected) {
      const code = h('input', { type: 'text', class: 'grow', id: 'planner-code', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://…/#video-app=…' });
      const go = h('button', { type: 'button', class: 'primary small', onclick: () => run(go, 'Connecting and sending every link…', () => api('/api/planner', { method: 'POST', body: { code: code.value } })) }, 'Connect');
      code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
      fill(box,
        h('p', { class: 'hint' }, 'In the planner, open your profile, press Make a code under Badminton Video app, and paste the code here.'),
        h('div', { class: 'row' }, h('label', { for: 'planner-code' }, 'Code'), code, go));
      return;
    }
    const send = h('button', { type: 'button', class: 'small', onclick: () => run(send, 'Looking up every match, sending its links and reading recorded games…', () => api('/api/planner/send', { method: 'POST' })) }, 'Send all links and read recorded games');
    const end = h('button', { type: 'button', class: 'small danger', onclick: () => {
      if (confirm('Disconnect from the planner? Links already sent stay there. To end the code itself, press Disconnect in the planner too.')) run(end, '', () => api('/api/planner', { method: 'DELETE' }));
    } }, 'Disconnect');
    fill(box,
      h('div', { class: 'notice ok' }, `Connected to ${s.host}${s.account ? ` as ${s.account}` : ''}. ${s.links ? `${n(s.links, 'link')} of ${n(s.matches, 'match', 'matches')} sent.` : 'No links sent yet.'}`),
      s.error ? h('div', { class: 'notice bad' }, `Not sent: ${s.error}. It’s tried again after the next change, and every hour.`) : null,
      s.problems.length ? h('div', { class: 'notice warn' }, h('p', {}, `The links of ${n(s.problems.length, 'match', 'matches')} can’t be sent:`),
        h('ul', { class: 'planner-problems' }, s.problems.map((p) => h('li', {}, h('a', { href: `#/m/${p.matchId}` }, p.label), `: ${p.why}`)))) : null,
      recordsBox(s),
      h('div', { class: 'row' }, send, end));
  }
  api('/api/planner').then(draw).catch((err) => fill(box, errorNotice(err)));
  return { element: h('div', {}, box, msg) };
}
