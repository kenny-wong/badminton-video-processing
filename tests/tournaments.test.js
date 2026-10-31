import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchTournament, parseMatchDays, parseTournamentPage, saveTournament } from '../lib/tournaments.js';
import { matchFromRow, openDb } from '../lib/db.js';
import { cleanSettings, DEFAULTS, readSettings, writeSettings } from '../lib/settings.js';
import { parseMatches } from '../lib/schedule.js';
import { PAGE } from './fixtures/be-pages.js';

test('parseTournamentPage reads the name and dates from BE’s page', () => {
  const html = '<html><head><title>Example Open &amp; Series | BADMINTON England</title></head><body><time datetime="2026-10-25T00:00:00.0000000+02:00">25</time> – <time datetime="2027-04-18T23:59:00">18</time></body></html>';
  assert.deepEqual(parseTournamentPage(html), { name: 'Example Open & Series', start: '2026-10-25', end: '2027-04-18' });
  assert.deepEqual(parseTournamentPage(''), { name: '', start: null, end: null });
});

test('parseMatchDays lists each day with matches once, in order', () => {
  const html = '<a href="/tournament/x/matches/20261213">13</a><a href="/tournament/x/matches/20261025">25</a><a href="/tournament/x/matches/20261025">again</a>';
  assert.deepEqual(parseMatchDays(html), ['20261025', '20261213']);
});

test('a one-day tournament with no list of match days is read from its own date', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    if (String(url).endsWith('/cookiewall/Save')) return new Response(null, { status: 302, headers: { 'Set-Cookie': 'st=ok; path=/' } });
    if (String(url).endsWith('/matches')) return new Response('<html>today’s matches, no day tabs</html>');
    if (/\/matches\/\d{8}$/.test(String(url))) return new Response(PAGE);
    return new Response('<title>Example U15 Silver | BADMINTON England</title><time datetime="2026-09-27T00:00:00"></time><time datetime="2026-09-27T23:59:00"></time>');
  });
  const got = await fetchTournament('https://be.tournamentsoftware.com/tournament/34cb27f0-68c8-4770-b726-bb158a77d8c5');
  assert.equal(got.name, 'Example U15 Silver');
  assert.equal(got.matches.length, 3);
  assert.ok(urls.at(-1).endsWith('/matches/20260927'));
});

const fetched = () => ({
  beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example Junior Gold', start: '2026-10-24', end: '2026-10-24',
  matches: parseMatches(PAGE, '20261024'),
});

test('saveTournament stores matches with UTC start times, and re-importing keeps tagging', () => {
  const db = openDb();
  const id = saveTournament(db, fetched());
  const rows = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY id').all(id).map(matchFromRow);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].startsAt, '2026-10-24T08:00:00Z'); // 9:00 BST
  assert.deepEqual(rows[0].teamA, ['Amy Lee', 'Ben Ng']);
  assert.deepEqual(rows[1].games, [[19, 21], [21, 15], [12, 21]]);

  db.prepare('UPDATE matches SET rallies = ? WHERE id = ?').run('[{"start":1,"end":5,"winner":"a"}]', rows[2].id);
  const again = fetched();
  again.matches[2] = { ...again.matches[2], time: '15:30', games: [[21, 10], [21, 12]], winner: 1, duration: 22 };
  assert.equal(saveTournament(db, again), id);
  const final = matchFromRow(db.prepare('SELECT * FROM matches WHERE id = ?').get(rows[2].id));
  assert.equal(final.time, '15:30');
  assert.deepEqual(final.games, [[21, 10], [21, 12]]);
  assert.equal(final.rallies.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM matches').get().n, 3);
});

test('settings keep only valid values', () => {
  const db = openDb();
  assert.deepEqual(readSettings(db), DEFAULTS);
  const s = cleanSettings({ videoFolders: [' C:\\Videos ', '', 'C:\\Videos'], players: 'Amy', pre: 99, post: 1.5, outputFolder: '  ' });
  assert.deepEqual(s.videoFolders, ['C:\\Videos']);
  assert.deepEqual(s.players, []);
  assert.equal(s.pre, DEFAULTS.pre);
  assert.equal(s.post, 1.5);
  assert.equal(s.outputFolder, DEFAULTS.outputFolder);
  writeSettings(db, s);
  assert.deepEqual(readSettings(db), s);
});
