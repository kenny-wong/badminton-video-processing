import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('the version on the page equals package.json', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(/<span class="version">([^<]*)<\/span>/.exec(html)?.[1], version);
});

test('page and server versions: reload when the server is newer, restart it when older', async () => {
  const { compareVersions, versionAdvice } = await import('../public/shared/version.js');
  assert.equal(compareVersions('1.10.0', '1.9.1'), 1); // by number, not as text
  assert.equal(compareVersions('1.16.0', '1.16.0'), 0);
  assert.equal(versionAdvice('1.16.0', '1.16.0'), null);
  assert.equal(versionAdvice('1.16.0', '1.17.0'), 'reload');
  assert.equal(versionAdvice('1.17.0', '1.16.0'), 'restart');
  assert.equal(versionAdvice('1.16.0', undefined), null);
});

test('the server says which version it runs', async () => {
  const { createApp } = await import('../server.js');
  const { openDb } = await import('../lib/db.js');
  const { BOOT } = await import('../lib/jobs.js');
  const app = { db: openDb(), port: 0 };
  const server = createApp(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  app.port = server.address().port;
  try {
    const v = await (await fetch(`http://127.0.0.1:${app.port}/api/version`)).json();
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(v.version, version);
    assert.equal(v.boot, BOOT);
    assert.match(v.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    server.close();
  }
});
