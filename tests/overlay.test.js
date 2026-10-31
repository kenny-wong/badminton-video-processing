import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assScript, assText, assTime, scoreSpans } from '../lib/overlay.js';
import { replay } from '../public/shared/score.js';

test('assTime writes h:mm:ss.cc', () => {
  assert.equal(assTime(0), '0:00:00.00');
  assert.equal(assTime(3725.456), '1:02:05.46');
  assert.equal(assTime(-3), '0:00:00.00');
});

test('assText drops override braces and line breaks', () => {
  assert.equal(assText('LEE {\\b1} / NG\nX'), 'LEE b1 / NG X');
});

test('scoreSpans changes the score as each counted rally ends', () => {
  const rallies = [{ start: 10, end: 15, winner: 'a' }, { start: 20, end: 25, winner: null }, { start: 30, end: 36, winner: 'b' }];
  const { steps } = replay(rallies);
  const spans = scoreSpans(rallies, steps, 60);
  assert.deepEqual(spans.map((s) => [s.from, s.to, s.state.points.join('-')]), [[0, 15, '0-0'], [15, 36, '1-0'], [36, 60, '1-1']]);
});

test('assScript draws a two-row scoreboard for each span, sized to the video', () => {
  const rallies = [{ start: 10, end: 15, winner: 'b' }];
  const { steps } = replay(rallies);
  const ass = assScript({ width: 1920, height: 1080, teams: [['Amy Lee', 'Ben Ng'], ['Cat Ho']], spans: scoreSpans(rallies, steps, 30) });
  assert.match(ass, /PlayResX: 1920\nPlayResY: 1080/);
  assert.match(ass, /\}A\. LEE \/ B\. NG\n/); // doubles: initial and surname by default
  assert.match(ass, /\}CAT HO\n/); // singles: full name by default
  const surnames = assScript({ width: 1920, height: 1080, teams: [['Amy Lee', 'Ben Ng'], ['Cat Ho']], spans: scoreSpans(rallies, steps, 30), nameStyle: { singles: 'surname', doubles: 'surname' } });
  assert.match(surnames, /\}LEE \/ NG\n/);
  const dialogue = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  // Per span: box, points column, a serve dot, and name, games, points for each side.
  assert.equal(dialogue.length, 2 * 9);
  assert.ok(dialogue.some((l) => l.includes('0:00:15.00,0:00:30.00') && l.endsWith('}1')));
});
