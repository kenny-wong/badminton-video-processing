import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanComment, COMMENT_MAX, DESCRIPTION_MAX, outputPath, safeName, TITLE_MAX, videoDescription, videoTitle, withComment, withFullNames } from '../lib/naming.js';
import { parseTournamentLink } from '../lib/links.js';
import { boardNames, cleanNameStyle, namesMatch, teamName } from '../public/shared/names.js';

const tournament = { name: 'Example Junior Gold', start: '2026-10-24' };
const match = { date: '2026-10-24', time: '09:40', draw: 'XD U15 - Group A', round: 'Round 1', court: 'Example School - 3', teamA: ['Amy Lee', 'Ben Ng'], teamB: ['Cat Ho', 'Dan Wu'] };

test('the title names the tournament, event, players and result, within YouTube’s limit', () => {
  assert.equal(videoTitle({ tournament, match, games: [[21, 18]] }),
    'Example Junior Gold · XD U15 - Group A Round 1 · Amy Lee / Ben Ng v Cat Ho / Dan Wu · 21-18');
  // Full names would make this one 103 characters: surnames keep the score in.
  assert.equal(videoTitle({ tournament, match, games: [[21, 18], [15, 21], [21, 19]] }),
    'Example Junior Gold · XD U15 - Group A Round 1 · Lee/Ng v Ho/Wu · 21-18 15-21 21-19');
  const long = videoTitle({ tournament: { name: 'X'.repeat(150) }, match, games: [] });
  assert.equal(long.length, TITLE_MAX);
  assert.ok(long.endsWith('…'));
});

test('a title saved with surnames only gets the full names, when they fit', () => {
  const singles = { teamA: ['Amy Lee'], teamB: ['Cat Hoang'] };
  assert.equal(withFullNames('Example U15 Silver · WS U15 - Group A Round 1 Game 1 · Lee v Hoang · 10-15', singles),
    'Example U15 Silver · WS U15 - Group A Round 1 Game 1 · Amy Lee v Cat Hoang · 10-15');
  assert.equal(withFullNames('Highlights: Example · WS U15 · Lee v Hoang', singles), 'Highlights: Example · WS U15 · Amy Lee v Cat Hoang');
  assert.equal(withFullNames('Example · WS U15 · Amy Lee v Cat Hoang · 10-15', singles), 'Example · WS U15 · Amy Lee v Cat Hoang · 10-15');
  assert.equal(withFullNames('Example · WS U15 · Lee v Hoangs · 10-15', singles), 'Example · WS U15 · Lee v Hoangs · 10-15');
  const long = `${'X'.repeat(80)} · Lee/Ng v Ho/Wu · 21-18`;
  assert.equal(withFullNames(long, match), long);
});

test('the description has the match, result, chapters and links', () => {
  const d = videoDescription({ tournament, match, games: [[21, 18]], chapterText: '0:00 Game 1 – Rally 1 (0-0)', links: ['Draw: https://example.test'] });
  assert.equal(d, 'Amy Lee / Ben Ng v Cat Ho / Dan Wu\nXD U15 - Group A · Round 1\nExample Junior Gold · 2026-10-24 · Example School - 3\nResult: 21-18\n\nDraw: https://example.test\n\nJump to a rally:\n0:00 Game 1 – Rally 1 (0-0)');
});

test('a long chapter list gives way by whole lines, the links kept', () => {
  const chapterText = Array.from({ length: 400 }, (_, i) => `${i}:00 Rally ${i + 1} (0-0)`).join('\n');
  const d = videoDescription({ tournament, match, games: [[21, 18]], chapterText, links: ['Draw: https://example.test'] });
  assert.ok(d.length <= DESCRIPTION_MAX);
  assert.ok(d.includes('Draw: https://example.test'));
  assert.match(d, /\(0-0\)\n…$/);
  const commented = withComment(d, 'Well played!');
  assert.ok(commented.length <= DESCRIPTION_MAX);
  assert.match(commented, /\(0-0\)\n…\n\nWell played!$/);
});

test('file names are safe for Windows and filed by year and tournament', () => {
  assert.equal(safeName('a<b>:c"/d\\e|f?g*h. '), 'a b c d e f g h');
  assert.equal(safeName('CON'), '_CON');
  assert.equal(safeName(''), 'untitled');
  assert.deepEqual(outputPath({ tournament, match }), ['2026', '2026-10-24 Example Junior Gold', '0940 XD U15 - Group A Round 1 - Lee Ng v Ho Wu.mp4']);
});

test('tournament links from badminfo and Badminton England', () => {
  const id = 'ca88e186-d31b-4e88-b01a-b7f64d301760';
  assert.deepEqual(parseTournamentLink(`https://badminfo.com/Tournament/${id}?t=OD`), { kind: 'badminfo', id });
  assert.deepEqual(parseTournamentLink(`https://be.tournamentsoftware.com/tournament/${id.toUpperCase()}/matches/20261025`), { kind: 'be', id });
  assert.deepEqual(parseTournamentLink(`https://be.tournamentsoftware.com/sport/tournament?id=${id}`), { kind: 'be', id });
  assert.equal(parseTournamentLink(`https://evil.test/tournament/${id}`), null);
  assert.equal(parseTournamentLink(`https://be.tournamentsoftware.com/tournament/${id}x`), null);
  assert.equal(parseTournamentLink(42), null);
});

test('player names: matching favourites and scoreboard names', () => {
  assert.ok(namesMatch('Man', 'Man Chan'));
  assert.ok(namesMatch('chan man', 'Man Chan'));
  assert.ok(!namesMatch('Ann', 'Anna Lee'));
  assert.ok(!namesMatch('', 'Anna Lee'));
  assert.equal(teamName(['Amy Lee']), 'Amy Lee');
});

test('scoreboard names in each style, with an initial when two players would look the same', () => {
  const doubles = [['Thai Chan', 'Man Chan'], ['Amy Lee', "Fin O'Neil"]];
  const style = (d) => ({ singles: 'full', doubles: d });
  assert.deepEqual(boardNames(doubles), ['T. CHAN / M. CHAN', "A. LEE / F. O'NEIL"]); // default for doubles
  assert.deepEqual(boardNames(doubles, style('surname')), ['T. CHAN / M. CHAN', "LEE / O'NEIL"]); // the two CHANs get initials
  assert.deepEqual(boardNames(doubles, style('first')), ['THAI / MAN', 'AMY / FIN']);
  assert.deepEqual(boardNames([['Amy Lee', 'Amy Ng'], ['Cat Ho', 'Dan Wu']], style('first')), ['AMY L. / AMY N.', 'CAT / DAN']);
  assert.deepEqual(boardNames(doubles, style('full')), ['THAI CHAN / MAN CHAN', "AMY LEE / FIN O'NEIL"]);
  assert.deepEqual(boardNames([['Sai Pranav Karthik'], ['Cher']]), ['SAI PRANAV KARTHIK', 'CHER']); // default for singles; one-word names stay whole
  assert.deepEqual(boardNames([['Sai Pranav Karthik'], ['Amy Lee']], { singles: 'initial' }), ['S. KARTHIK', 'A. LEE']);
  assert.deepEqual(cleanNameStyle({ singles: 'nonsense' }), { singles: 'full', doubles: 'initial' });
  assert.equal(teamName(['Amy Lee', 'Ben Ng']), 'Amy Lee / Ben Ng');
});

test('a comment goes at the end of the description and is never cut; the description gives way', () => {
  assert.equal(withComment('Lee v Ho\nResult: 21-18', ''), 'Lee v Ho\nResult: 21-18');
  assert.equal(withComment('Lee v Ho', '  Well played!\r\nSee you next time.  '), 'Lee v Ho\n\nWell played!\nSee you next time.');
  const long = withComment('x'.repeat(DESCRIPTION_MAX), 'The end.');
  assert.ok(long.length <= DESCRIPTION_MAX);
  assert.ok(long.endsWith('…\n\nThe end.'));
  assert.equal(cleanComment('y'.repeat(COMMENT_MAX + 50)).length, COMMENT_MAX);
  assert.equal(cleanComment(null), '');
});
