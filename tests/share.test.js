import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resultLine, shareDay, youtubeShareText } from '../public/shared/share.js';

const match = (over) => ({ date: '2026-11-01', time: '14:50', draw: 'WD U15', round: 'Round 3', teamA: ['Amy Lee', 'Bea Ng'], teamB: ['Cat Ho', 'Dee Ma'], games: [[13, 15], [14, 16]], winner: 2, ...over });

test('result line: the winner first with the scores their way round, else A v B', () => {
  assert.equal(resultLine(match()), 'Cat Ho / Dee Ma beat Amy Lee / Bea Ng 15-13, 16-14');
  assert.equal(resultLine(match({ winner: 'a', games: [[21, 18], [19, 21], [21, 9]], teamA: ['Amy Lee'], teamB: ['Cat Ho'] })), 'Amy Lee beat Cat Ho 21-18, 19-21, 21-9');
  assert.equal(resultLine(match({ winner: null, games: [] })), 'Amy Lee / Bea Ng v Cat Ho / Dee Ma');
  assert.equal(shareDay('2026-11-01'), 'Sun 1 Nov');
  assert.equal(shareDay(null), '');
});

test('share text: a title, then each match with links (a whole match, or one per game); matches without links left out', () => {
  const { text, matches, videos } = youtubeShareText([
    match({ links: [{ game: 0, url: 'https://youtu.be/AAAAAAAAAAA' }] }),
    match({ time: '15:15', round: 'Round 2', links: [] }),
    match({ time: '16:05', links: [{ game: 1, url: 'https://youtu.be/BBBBBBBBBBB' }, { game: 2, url: 'https://youtu.be/CCCCCCCCCCC' }] }),
  ], { title: 'Example Open · YouTube videos' });
  assert.equal(matches, 2);
  assert.equal(videos, 3);
  assert.equal(text, [
    'Example Open · YouTube videos',
    '',
    'Sun 1 Nov, 14:50 · WD U15 Round 3',
    'Cat Ho / Dee Ma beat Amy Lee / Bea Ng 15-13, 16-14',
    'https://youtu.be/AAAAAAAAAAA',
    '',
    'Sun 1 Nov, 16:05 · WD U15 Round 3',
    'Cat Ho / Dee Ma beat Amy Lee / Bea Ng 15-13, 16-14',
    'Game 1: https://youtu.be/BBBBBBBBBBB',
    'Game 2: https://youtu.be/CCCCCCCCCCC',
  ].join('\n'));
});

test('share text by tournament: a heading before each tournament’s matches; nothing to share says so by its counts', () => {
  const { text } = youtubeShareText([
    match({ tournament: 'Autumn Open', links: [{ game: 0, url: 'https://youtu.be/AAAAAAAAAAA' }] }),
    match({ tournament: 'Summer Cup', date: '2026-07-04', time: '', links: [{ game: 0, url: 'https://youtu.be/BBBBBBBBBBB' }] }),
  ], { title: 'Amy Lee · YouTube videos', byTournament: true });
  assert.equal(text.split('\n').filter((l) => l.startsWith('==')).join('|'), '== Autumn Open ==|== Summer Cup ==');
  assert.match(text, /== Summer Cup ==\n\nSat 4 Jul · WD U15 Round 3\n/);
  assert.deepEqual(youtubeShareText([match({ links: [] })], { title: 'x' }), { text: 'x', matches: 0, videos: 0 });
});
