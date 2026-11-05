import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { linkAction, windowKey } from '../electron/links.js';

const origin = 'http://127.0.0.1:8792';

test('the app’s own pages stay in the window; web pages go to the default browser', () => {
  assert.equal(linkAction(`${origin}/#/t/3`, origin), 'app');
  assert.equal(linkAction(`${origin}/media/rendered/5?key=video`, origin), 'app');
  assert.equal(linkAction('https://youtu.be/abc', origin), 'browser');
  assert.equal(linkAction('https://accounts.google.com/o/oauth2/v2/auth?x=1', origin), 'browser');
  assert.equal(linkAction('http://127.0.0.1:8791/', origin), 'browser'); // another port is another app
});

test('other kinds of link are refused', () => {
  assert.equal(linkAction('file:///C:/Windows/system32/calc.exe', origin), 'deny');
  assert.equal(linkAction('javascript:alert(1)', origin), 'deny');
  assert.equal(linkAction('ms-settings:', origin), 'deny');
  assert.equal(linkAction('not a url', origin), 'deny');
});

test('window keys: F5 / Ctrl+R reload, F12 / Ctrl+Shift+I developer tools; the editor’s keys pass', () => {
  const key = (k, extra = {}) => windowKey({ type: 'keyDown', key: k, control: false, shift: false, ...extra });
  assert.equal(key('F5'), 'reload');
  assert.equal(key('r', { control: true }), 'reload');
  assert.equal(key('F12'), 'devtools');
  assert.equal(key('I', { control: true, shift: true }), 'devtools');
  assert.equal(key('r'), null);
  assert.equal(key('z', { control: true }), null); // undo in the editor
  assert.equal(key('R', { control: true, shift: true }), null);
  assert.equal(windowKey({ type: 'keyUp', key: 'F5' }), null);
});

test('the installer ships the app’s files with the artwork (not the notes beside it), and FFmpeg as a resource', () => {
  const { main, build } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(main, 'electron/main.js');
  for (const f of ['server.js', 'electron/**', 'api/**', 'lib/**', 'migrations/**', 'public/**', '!public/visual-kit/*.txt']) assert.ok(build.files.includes(f), f);
  assert.ok(!build.files.some((f) => f.startsWith('!') && f.endsWith('.png')), 'the banner and illustration PNGs go in');
  assert.deepEqual(build.extraResources, [{ from: 'build/ffmpeg', to: 'ffmpeg' },
    { from: 'analysis', to: 'analysis', filter: ['run_tracknet.py', 'find_people.py', 'remove_voices.py', 'requirements.txt'] }]);
});

test('one icon: the installer’s is drawn from the mark the page uses, on every build', () => {
  const { scripts, build } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.equal(/<link rel="icon" href="([^"]+)"/.exec(html)?.[1], 'visual-kit/app-mark.svg');
  assert.match(readFileSync(new URL('../scripts/make-icon.mjs', import.meta.url), 'utf8'), /public\/visual-kit\/app-mark\.svg/);
  assert.match(scripts.dist, /^node scripts\/make-icon\.mjs && /);
  assert.equal(build.win.icon, 'build/icon.png');
  assert.ok(!existsSync(new URL('../public/favicon.svg', import.meta.url)), 'the old icon is gone');
});
