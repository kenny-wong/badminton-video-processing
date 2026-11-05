import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chunkProgress, sameKey, soundKey, VOICE_MODEL, voiceRemover } from '../lib/voices.js';
import { partArgs } from '../lib/render.js';
import { clipArgs } from '../lib/clip.js';
import { cleanOutput, DEFAULT_OUTPUT } from '../lib/settings.js';
import { trackFailure } from '../lib/track.js';

test('a part takes its sound from the voice-free file, cut at the same times', () => {
  const args = partArgs({ src: 'm.mp4', start: 12.5, end: 30, out: 'p.mp4', audio: 'D:/out/.work/match-3/voices/court.flac' });
  const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
  assert.deepEqual(inputs, ['m.mp4', 'D:/out/.work/match-3/voices/court.flac']);
  const at = args.indexOf('D:/out/.work/match-3/voices/court.flac');
  assert.deepEqual(args.slice(at - 5, at), ['-ss', '12.5', '-to', '30', '-i']);
  assert.equal(args[args.lastIndexOf('-map') + 1], '1:a:0');
});

test('with a logo the voice-free sound is the third input; replays stay silent', () => {
  const logo = { path: 'l.png', width: 100 };
  const args = partArgs({ src: 'm.mp4', start: 0, end: 4, out: 'p.mp4', logo, audio: 'court.flac' });
  assert.equal(args[args.lastIndexOf('-map') + 1], '2:a:0');
  const replay = partArgs({ src: 'm.mp4', start: 0, end: 4, out: 'r.mp4', slow: 2, audio: 'court.flac' });
  assert.ok(!replay.includes('court.flac'));
  assert.ok(replay.includes('anullsrc=r=48000:cl=stereo'));
  const plain = partArgs({ src: 'm.mp4', start: 0, end: 4, out: 'p.mp4' });
  assert.equal(plain[plain.lastIndexOf('-map') + 1], '0:a:0');
});

test('a clip takes the voice-free sound too, unless the video has none', () => {
  const a = clipArgs({ src: 'm.mp4', start: 30, end: 42, out: 'c.mp4', audio: 'court.flac' });
  assert.deepEqual(a.slice(a.indexOf('court.flac') - 5, a.indexOf('court.flac') + 1), ['-ss', '30', '-to', '42', '-i', 'court.flac']);
  assert.equal(a[a.lastIndexOf('-map') + 1], '1:a:0');
  const silent = clipArgs({ src: 'm.mp4', start: 0, end: 5, out: 'c.mp4', hasAudio: false, audio: 'court.flac' });
  assert.ok(!silent.includes('court.flac'));
});

test('removing voices is off unless switched on, and only a true/false is kept', () => {
  assert.equal(DEFAULT_OUTPUT.removeVoices, false);
  assert.equal(cleanOutput({ removeVoices: true }).removeVoices, true);
  assert.equal(cleanOutput({ removeVoices: 'yes' }).removeVoices, false);
});

test('the saved sound is reused only for the same file, size, time and model', () => {
  const key = soundKey('D:/v/a.mp4', { size: 1000, mtimeMs: 1761900000123.4 });
  assert.deepEqual(key, { source: 'D:/v/a.mp4', size: 1000, modified: 1761900000123, model: VOICE_MODEL });
  assert.ok(sameKey(JSON.parse(JSON.stringify(key)), key));
  assert.ok(!sameKey({ ...key, size: 1001 }, key));
  assert.ok(!sameKey({ ...key, model: 'htdemucs' }, key));
  assert.ok(!sameKey(null, key));
});

test('Demucs progress comes from its chunk lines', () => {
  assert.equal(chunkProgress('chunk 1/4'), 0.25);
  assert.equal(chunkProgress('chunk 4/4'), 1);
  assert.equal(chunkProgress('Model htdemucs_ft on cuda'), null);
});

test('the voice remover is ready only with Python, the script and Demucs all there', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voices-'));
  try {
    assert.equal(voiceRemover(root, root).ready, false);
    const win = process.platform === 'win32';
    await mkdir(join(root, '.venv', win ? 'Scripts' : 'bin'), { recursive: true });
    await writeFile(join(root, '.venv', win ? 'Scripts\\python.exe' : 'bin/python'), '');
    await writeFile(join(root, 'remove_voices.py'), '');
    if (win) {
      assert.equal(voiceRemover(root, root).ready, false);
      await mkdir(join(root, '.venv', 'Lib', 'site-packages', 'demucs'), { recursive: true });
    }
    assert.equal(voiceRemover(root, root).ready, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed voice removal is named as such in the error', () => {
  const f = trackFailure('Traceback (most recent call last):\nRuntimeError: CUDA out of memory\n', 1, null, { what: 'Removing voices', program: 'Demucs' });
  assert.equal(f.message, 'Removing voices failed: RuntimeError: CUDA out of memory');
  assert.match(f.detail, /^Demucs exited with code 1\./);
});
