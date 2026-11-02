import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assumedStart, cleanStart, parseGames, RALLY_GAP, replay, scoreAt } from '../public/shared/score.js';
import { cleanSettings } from '../lib/settings.js';
import { chapters, plan } from '../lib/render.js';
import { youtubeId, youtubeUrl } from '../lib/links.js';
import { scoreSpans } from '../lib/overlay.js';

test('cleanStart accepts possible mid-match scores and rejects impossible ones', () => {
  assert.deepEqual(cleanStart({ games: [[21, 18]], points: [5, 3] }), { games: [[21, 18]], points: [5, 3] });
  assert.deepEqual(cleanStart({ points: [11, 9] }), { games: [], points: [11, 9] });
  assert.equal(cleanStart({ games: [], points: [0, 0] }), null); // plain 0-0
  assert.equal(cleanStart({ games: [[20, 18]], points: [0, 0] }), null); // game 1 unfinished
  assert.equal(cleanStart({ points: [21, 15] }), null); // a finished game isn't "under way"
  assert.equal(cleanStart({ games: [[21, 10], [21, 12]], points: [1, 0] }), null); // match already over
  assert.equal(cleanStart({ points: [16, 2] }, { points: 15, setting: true }), null);
  assert.equal(cleanStart('0-0'), null);
});

test('replay starts from the starting score, counting games won and game numbers', () => {
  const rallies = [{ start: 1, end: 5, winner: 'b' }, { start: 9, end: 12, winner: 'b' }];
  const out = replay(rallies, undefined, 'a', { games: [[21, 18]], points: [19, 20] });
  assert.deepEqual(out.initial.won, [1, 0]);
  assert.deepEqual(out.games, [[21, 18], [19, 21], [0, 1]]); // B takes game 2 from 19-20, then leads game 3
  assert.equal(out.steps[0].event, 'game');
  assert.deepEqual(scoreAt(rallies, out.steps, 0, out.initial).points, [19, 20]);
  assert.deepEqual(scoreSpans(rallies, out.steps, 20, out.initial)[0].state.points, [19, 20]);
  // An impossible start is ignored: 0-0.
  assert.deepEqual(replay(rallies, undefined, 'a', { points: [40, 0] }).games, [[0, 2]]);
});

test('parseGames reads "21-18 15-21" and "21-18, 15-21"', () => {
  assert.deepEqual(parseGames('21-18 15-21'), [[21, 18], [15, 21]]);
  assert.deepEqual(parseGames(' 21-18, 15-21 '), [[21, 18], [15, 21]]);
  assert.deepEqual(parseGames(''), []);
  assert.equal(parseGames('21 to 18'), null);
});

test('a rally tagged without S starts 5 s after the last one ended', () => {
  const rallies = [{ start: 10, end: 20 }, { start: 40, end: 52 }];
  assert.equal(assumedStart(rallies, 70), 57);
  assert.equal(assumedStart(rallies, 30), 25);
  assert.equal(assumedStart(rallies, 54), 53); // never less than 1 s long
  assert.equal(assumedStart([], 30), 20); // nothing before: 10 s back
  assert.equal(assumedStart([], 30, { matchStart: 12 }), 12); // or from the match start
  assert.equal(assumedStart([], 4), 0);
});

test('the gap before a rally tagged without S is a setting: 5 s unless changed, 0 to 30 s', () => {
  const rallies = [{ start: 10, end: 20 }, { start: 40, end: 52 }];
  assert.equal(RALLY_GAP, 5);
  assert.equal(assumedStart(rallies, 70, { gap: 6 }), 58);
  assert.equal(assumedStart(rallies, 70, { gap: 0 }), 52);
  assert.equal(cleanSettings({}).rallyGap, 5);
  assert.equal(cleanSettings({ rallyGap: 4.5 }).rallyGap, 4.5);
  assert.equal(cleanSettings({ rallyGap: 31 }).rallyGap, 5); // out of range: kept as it was
  assert.equal(cleanSettings({ rallyGap: 'soon' }, { ...cleanSettings({}), rallyGap: 5 }).rallyGap, 5);
});

test('plan keeps only the marked match', () => {
  const rallies = [{ start: 5, end: 15 }, { start: 60, end: 70 }, { start: 200, end: 210 }];
  assert.deepEqual(plan(rallies, 300, { pre: 2, post: 2, from: 50, to: 205 }), [
    { start: 58, end: 72, outStart: 0 },
    { start: 198, end: 205, outStart: 14 },
  ]);
  assert.deepEqual(plan(rallies, 300, { cut: false, from: 50, to: 205 }), [{ start: 50, end: 205, outStart: 0 }]);
});

test('chapters count games from where the video starts', () => {
  const rallies = [{ start: 20, end: 30, winner: 'a' }, { start: 40, end: 50, winner: 'a' }];
  const { steps } = replay(rallies, undefined, 'a', { games: [[18, 21]], points: [20, 5] });
  const list = chapters(rallies, steps, plan(rallies, 100, { pre: 2, post: 2 }));
  assert.deepEqual(list.map((c) => c.title), ['Game 2 – Rally 26 (20-5)', 'Game 3 – Rally 1 (0-0)']);
});

test('YouTube links in every common shape give the video id', () => {
  const id = 'dQw4w9WgXcQ';
  for (const link of [`https://www.youtube.com/watch?v=${id}&t=10s`, `https://youtu.be/${id}?si=abc`, `https://youtube.com/shorts/${id}`,
    `https://m.youtube.com/watch?v=${id}`, `https://studio.youtube.com/video/${id}/edit`, `https://www.youtube.com/live/${id}`]) {
    assert.equal(youtubeId(link), id, link);
  }
  assert.equal(youtubeId('https://evil.test/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeId('https://youtu.be/short'), null);
  assert.equal(youtubeId('javascript:alert(1)'), null);
  assert.equal(youtubeUrl(id), `https://youtu.be/${id}`);
});
