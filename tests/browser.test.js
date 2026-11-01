import assert from 'node:assert/strict';
import { test } from 'node:test';

import { browserUrl } from '../lib/browser.js';

test('only https YouTube and Google pages open in the browser', () => {
  assert.equal(browserUrl('https://www.youtube.com/upload'), 'https://www.youtube.com/upload');
  assert.equal(browserUrl('https://youtu.be/abc123'), 'https://youtu.be/abc123');
  assert.ok(browserUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y'));
  assert.equal(browserUrl('http://www.youtube.com/upload'), null);
  assert.equal(browserUrl('https://www.youtube.com.evil.test/upload'), null);
  assert.equal(browserUrl('https://user:pw@www.youtube.com/'), null);
  assert.equal(browserUrl('file:///C:/Windows/System32/calc.exe'), null);
  assert.equal(browserUrl('not a url'), null);
  assert.equal(browserUrl(undefined), null);
});
