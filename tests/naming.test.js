import assert from 'node:assert/strict';
import { test } from 'node:test';

import { outputPath, safeName, TITLE_MAX, videoDescription, videoTitle } from '../lib/naming.js';
import { parseTournamentLink } from '../lib/links.js';
import { boardNames, cleanNameStyle, isMine, namesMatch, teamName } from '../public/shared/names.js';

const tournament = { name: 'Example Junior Gold', start: '2026-10-24' };
const match = { date: '2026-10-24', time: '09:40', draw: 'XD U15 - Group A', round: 'Round 1', court: 'Example School - 3', teamA: ['Amy Lee', 'Ben Ng'], teamB: ['Cat Ho', 'Dan Wu'] };

test('the title names the tournament, event, players and result, within YouTube’s limit', () => {
  assert.equal(videoTitle({ tournament, match, games: [[21, 18], [15, 21], [21, 19]] }),
    'Example Junior Gold · XD U15 - Group A Round 1 · Lee/Ng v Ho/Wu · 21-18 15-21 21-19');
  const long = videoTitle({ tournament: { name: 'X'.repeat(150) }, match, games: [] });
  assert.equal(long.length, TITLE_MAX);
  assert.ok(long.endsWith('…'));
});

test('the description has the match, result, chapters and links', () => {
  const d = videoDescription({ tournament, match, games: [[21, 18]], chapterText: '0:00 Game 1', links: ['Draw: https://example.test'] });
  assert.equal(d, 'Amy Lee / Ben Ng v Cat Ho / Dan Wu\nXD U15 - Group A · Round 1\nExample Junior Gold · 2026-10-24 · Example School - 3\nResult: 21-18\n\n0:00 Game 1\n\nDraw: https://example.test');
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

test('player names: matching my players and scoreboard names', () => {
  assert.ok(namesMatch('Man', 'Man Chan'));
  assert.ok(namesMatch('chan man', 'Man Chan'));
  assert.ok(!namesMatch('Ann', 'Anna Lee'));
  assert.ok(!namesMatch('', 'Anna Lee'));
  assert.ok(isMine(['Amy Lee', 'Ben Ng'], ['Ben']));
  assert.ok(!isMine(['Amy Lee'], []));
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
