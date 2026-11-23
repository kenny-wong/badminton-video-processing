import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { RELEASES, releaseKind, kindLabel, findReleases, byMonth } from '../public/shared/releases.js';
import { compareVersions } from '../public/shared/version.js';

test('the newest release note is this version', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(RELEASES[0].version, version);
});

test('release notes are newest first, one per version, each dated with notes', () => {
  for (const [i, r] of RELEASES.entries()) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.notes.length > 0 && r.notes.every((n) => typeof n === 'string' && n.trim()), r.version);
    if (i) {
      assert.equal(compareVersions(RELEASES[i - 1].version, r.version), 1, `${RELEASES[i - 1].version} before ${r.version}`);
      assert.ok(RELEASES[i - 1].date >= r.date, `${r.version} dated after a newer version`);
    }
  }
});

test('release kinds: major, new feature or fix', () => {
  assert.equal(releaseKind('2.0.0'), 'major');
  assert.equal(releaseKind('1.92.0'), 'minor');
  assert.equal(releaseKind('1.86.1'), 'patch');
  assert.equal(kindLabel('1.92.0'), 'New');
  assert.equal(kindLabel('1.86.1'), 'Fix');
});

test('finding release notes matches every word, in notes or the version', () => {
  const list = [
    { version: '1.2.0', date: '2026-11-02', notes: ['Corner view in renders'] },
    { version: '1.1.0', date: '2026-10-31', notes: ['YouTube upload'] },
  ];
  assert.deepEqual(findReleases(list, 'corner RENDERS').map((r) => r.version), ['1.2.0']);
  assert.deepEqual(findReleases(list, '1.1').map((r) => r.version), ['1.1.0']);
  assert.equal(findReleases(list, '  ').length, 2);
  assert.equal(findReleases(list, 'corner upload').length, 0);
  assert.deepEqual(byMonth(list).map((g) => [g.month, g.releases.length]), [['November 2026', 1], ['October 2026', 1]]);
});
