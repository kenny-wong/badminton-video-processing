import assert from 'node:assert/strict';
import { test } from 'node:test';

import { consentCookie, parseMatches, scheduleDays } from '../lib/schedule.js';

import { PAGE } from './fixtures/be-pages.js';

test('parseMatches reads the time, draw, court, duration, players and games of each match', () => {
  const m = parseMatches(PAGE, '20261024');
  assert.equal(m.length, 3);
  assert.deepEqual(m[0], {
    date: '2026-10-24', time: '09:00', draw: 'XD U15 - Group A', round: 'Round 1', court: 'Example School - 3',
    duration: 12, teams: [['Amy Lee', 'Ben Ng'], ['Cat Ho', 'Dan Wu']], games: [[21, 13]], winner: 1,
  });
  assert.deepEqual([m[1].time, m[1].teams, m[1].games, m[1].winner, m[1].duration], ['09:00', [['Eli Ma'], ["Fin O'Neil"]], [[19, 21], [21, 15], [12, 21]], 2, 25]);
  // Not played yet: a time and court, no games, no duration.
  assert.deepEqual([m[2].time, m[2].draw, m[2].games, m[2].winner, m[2].duration, m[2].court], ['14:45', 'XD U15', [], null, null, 'Example School - 1']);
  assert.deepEqual(parseMatches('<html>nothing</html>', '20261024'), []);
});

test('scheduleDays lists each day of a short event, and skips long ones', () => {
  assert.deepEqual(scheduleDays('2026-10-24'), ['20261024']);
  assert.deepEqual(scheduleDays('2026-10-31', '2026-11-02'), ['20261031', '20261101', '20261102']);
  assert.equal(scheduleDays('2026-10-25', '2027-04-18'), null); // a season-long series
  assert.equal(scheduleDays('2026-10-25', '2026-10-24'), null);
  assert.equal(scheduleDays('soon'), null);
  assert.equal(scheduleDays(null), null);
});

function stubFetch(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init); });
  return calls;
}

test('consentCookie accepts only the necessary cookies and keeps the consent cookie', async (t) => {
  const calls = stubFetch(t, () => new Response(null, { status: 302, headers: [['Set-Cookie', 'ASP.NET_SessionId=abc; path=/'], ['Set-Cookie', 'st=l=2057&c=1; expires=Sat, 30-Oct-2027 16:15:57 GMT; path=/; secure']] }));
  assert.equal(await consentCookie(), 'st=l=2057&c=1');
  assert.match(calls[0].url, /\/cookiewall\/Save$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.doesNotMatch(calls[0].init.body, /CookiePurposes/); // no optional purposes
});
