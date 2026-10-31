import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('the version on the page equals package.json', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(/<span class="version">([^<]*)<\/span>/.exec(html)?.[1], version);
});
