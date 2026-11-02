import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assAlpha, assColour, assScript, assText, assTime, scoreSpans } from '../lib/overlay.js';
import { replay } from '../public/shared/score.js';
import { DEFAULT_BOARD, PRESETS } from '../public/shared/board.js';

const CLASSIC = { ...DEFAULT_BOARD, ...PRESETS.tv, preset: 'tv' };

test('assTime writes h:mm:ss.cc', () => {
  assert.equal(assTime(0), '0:00:00.00');
  assert.equal(assTime(3725.456), '1:02:05.46');
  assert.equal(assTime(-3), '0:00:00.00');
});

test('assText drops override braces and line breaks', () => {
  assert.equal(assText('LEE {\\b1} / NG\nX'), 'LEE b1 / NG X');
});

test('ASS colours are blue-green-red and alpha counts transparency', () => {
  assert.equal(assColour('#0f3b2d'), '&H2D3B0F&');
  assert.equal(assAlpha(1), '&H00&');
  assert.equal(assAlpha(0), '&HFF&');
});

test('scoreSpans changes the score as each counted rally ends', () => {
  const rallies = [{ start: 10, end: 15, winner: 'a' }, { start: 20, end: 25, winner: null }, { start: 30, end: 36, winner: 'b' }];
  const { steps } = replay(rallies);
  const spans = scoreSpans(rallies, steps, 60);
  assert.deepEqual(spans.map((s) => [s.from, s.to, s.state.points.join('-')]), [[0, 15, '0-0'], [15, 36, '1-0'], [36, 60, '1-1']]);
  assert.ok(spans.every((s) => s.event === null));
});

test('scoreSpans carries the interval and game events for banners', () => {
  const rallies = Array.from({ length: 11 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, winner: 'a' }));
  const { steps } = replay(rallies);
  const spans = scoreSpans(rallies, steps, 200);
  assert.equal(spans.at(-1).event.kind, 'interval');
  assert.equal(spans.at(-1).event.winner, 'a');
});

test('once the match is over the board keeps its last game’s score up, not the next game’s 0-0', () => {
  // A game's own video: A wins it 21-3.
  const rallies = [...Array(3).fill('b'), ...Array(21).fill('a')].map((winner, i) => ({ start: i * 10, end: i * 10 + 5, winner }));
  const { steps } = replay(rallies, undefined, 'a', null, { oneGame: true });
  const last = scoreSpans(rallies, steps, 300).at(-1);
  assert.deepEqual([last.state.points, last.state.games, last.state.server, last.event.kind], [[21, 3], [], null, 'match']);
  const ass = assScript({ width: 1920, height: 1080, teams: [['Amy Lee'], ['Cat Ho']], spans: [last], style: CLASSIC });
  assert.doesNotMatch(ass, /POINT/); // no GAME POINT flag on the final score
  // A whole match: the 0-0 between games stays (the match goes on).
  const two = replay([...Array(21).fill('a'), 'b'].map((winner, i) => ({ start: i * 10, end: i * 10 + 5, winner })));
  assert.deepEqual(scoreSpans([...Array(21).fill('a'), 'b'].map((winner, i) => ({ start: i * 10, end: i * 10 + 5, winner })), two.steps, 400).at(-2).state.points, [0, 0]);
});

test('a number that changes flips: the old one folds away, then the new one unfolds', () => {
  const rallies = [{ start: 10, end: 15, winner: 'b' }, { start: 20, end: 25.05, winner: 'b' }];
  const { steps } = replay(rallies);
  const lines = assScript({ width: 1920, height: 1080, teams: [['Amy Lee'], ['Cat Ho']], spans: scoreSpans(rallies, steps, 30), style: CLASSIC })
    .split('\n').filter((l) => l.startsWith('Dialogue:'));
  // Only B's points change: 0 folds away in the last 0.12 s before 15 s, 1 unfolds then and folds before 25.05 s, 2 unfolds.
  const flips = lines.filter((l) => l.includes('fscy')).map((l) => [l.split(',').slice(1, 3).join(' '), l.slice(l.indexOf('\\1a') + 8)]);
  assert.deepEqual(flips, [
    ['0:00:00.00 0:00:15.00', '\\t(14880,15000,\\fscy0)}0'],
    ['0:00:15.00 0:00:25.05', '\\fscy0\\t(0,120,\\fscy100)\\t(9930,10050,\\fscy0)}1'],
    ['0:00:25.05 0:00:30.00', '\\fscy0\\t(0,120,\\fscy100)}2'],
  ]);
});

test('assScript draws a two-row scoreboard for each span, sized to the video', () => {
  const rallies = [{ start: 10, end: 15, winner: 'b' }];
  const { steps } = replay(rallies);
  const ass = assScript({ width: 1920, height: 1080, teams: [['Amy Lee', 'Ben Ng'], ['Cat Ho']], spans: scoreSpans(rallies, steps, 30), style: CLASSIC });
  assert.match(ass, /PlayResX: 1920\nPlayResY: 1080/);
  assert.match(ass, /\}A\. LEE \/ B\. NG\n/); // doubles: initial and surname by default
  assert.match(ass, /\}CAT HO\n/); // singles: full name by default
  assert.match(ass, /Style: Text,Arial,/);
  const surnames = assScript({ width: 1920, height: 1080, teams: [['Amy Lee', 'Ben Ng'], ['Cat Ho']], spans: scoreSpans(rallies, steps, 30), nameStyle: { singles: 'surname', doubles: 'surname' } });
  assert.match(surnames, /\}LEE \/ NG\n/);
  const dialogue = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  // Per span: box, points column, a serve dot, and name and points for each side (no game finished yet).
  assert.equal(dialogue.length, 2 * 7);
  const counts = assScript({ width: 1920, height: 1080, teams: [['Amy Lee'], ['Cat Ho']], spans: scoreSpans(rallies, steps, 30), style: { ...CLASSIC, showGames: false } });
  assert.equal(counts.split('\n').filter((l) => l.startsWith('Dialogue:')).length, 2 * 9); // plus games won for each side
  assert.ok(dialogue.some((l) => l.includes('0:00:15.00,0:00:30.00') && l.endsWith('}1')));
});

test('assScript adds game point flags, banners, a heading and the look chosen', () => {
  const rallies = Array.from({ length: 21 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, winner: 'a' }));
  const { steps } = replay(rallies);
  const ass = assScript({
    width: 1280, height: 720, teams: [['Amy Lee'], ['Cat Ho']], spans: scoreSpans(rallies, steps, 300), format: { points: 21, setting: true, bestOf: 3 },
    style: { ...DEFAULT_BOARD, preset: 'contrast', font: 'Verdana' }, heading: 'WS U15 · FINAL',
  });
  assert.match(ass, /Style: Text,Verdana,/);
  assert.match(ass, /\}GAME POINT\n/);
  assert.match(ass, /\}INTERVAL\n/);
  assert.match(ass, /\}GAME 1 TO AMY LEE · 21-0\n/);
  assert.match(ass, /\}WS U15 · FINAL\n/);
  // The interval banner (after the 11th rally ends at 105 s) shows for 6 s.
  assert.ok(ass.split('\n').some((l) => l.includes('0:01:45.00,0:01:51.00') && l.endsWith('}INTERVAL')));
});

test('the default broadcast board draws the shuttle as a shape and narrows the lettering', () => {
  const rallies = [{ start: 10, end: 15, winner: 'b' }];
  const { steps } = replay(rallies);
  const ass = assScript({ width: 1920, height: 1080, teams: [['Amy Lee'], ['Cat Ho']], spans: scoreSpans(rallies, steps, 30) });
  assert.match(ass, /Style: Text,Bahnschrift,/);
  assert.match(ass, /\\fscx84\\b1\\shad0\\1c&H1D1816&\\1a&H00&\}AMY LEE\n/);
  const lines = ass.split('\n');
  assert.equal(lines.filter((l) => /\\1a&H4D&\}m( \d+ \d+){1} l( \d+ \d+){3}\{/.test(l)).length, 2); // the see-through skirt, in each of the two spans
  assert.equal(lines.filter((l) => /\}m \d+ \d+ l( \d+ \d+){7}\{/.test(l)).length, 2); // the eight-sided cork
});
