import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encoderArgs, musicArgs, outputLength, outputSize, partArgs, plan, toOutput, withReplays } from '../lib/render.js';
import { labelScript } from '../lib/cards.js';
import { cleanMusic, cleanOutput, DEFAULT_MUSIC, DEFAULT_OUTPUT } from '../lib/settings.js';
import { audioKind } from '../api/settings.js';
import { musicFor } from '../lib/pipeline.js';
import { DEFAULT_BOARD } from '../public/shared/board.js';

test('outputSize brings the shorter side down, never up, in even numbers', () => {
  assert.deepEqual(outputSize(3840, 2160, '1080'), { w: 1920, h: 1080 });
  assert.deepEqual(outputSize(1800, 2400, '720'), { w: 720, h: 960 }); // filmed upright
  assert.deepEqual(outputSize(1280, 720, '1080'), { w: 1280, h: 720 });
  assert.deepEqual(outputSize(1921, 1081, 'source'), { w: 1922, h: 1082 });
});

test('a bitrate cap is passed to either encoder', () => {
  assert.deepEqual(encoderArgs('h264_nvenc', { maxRate: 8 }).slice(-4), ['-maxrate', '8M', '-bufsize', '16M']);
  assert.ok(!encoderArgs('libx264').includes('-maxrate'));
});

test('replays follow each favourite rally, slowed down, and chapters still find the first showing', () => {
  const rallies = [{ start: 10, end: 20, fav: true }, { start: 40, end: 50 }, { start: 52, end: 60, fav: true }];
  const parts = withReplays(plan(rallies, 100, { pre: 1, post: 1, mergeGap: 4 }), rallies.filter((r) => r.fav));
  assert.deepEqual(parts.map((p) => [p.start, p.end, p.replay ?? false, p.outStart]), [
    [9, 21, false, 0], [17, 20, true, 12], [39, 61, false, 18], [57, 60, true, 40],
  ]);
  assert.equal(outputLength(parts), 12 + 6 + 22 + 6);
  assert.equal(toOutput(18, parts), 9); // not the replay's place
});

test('a replay part is slowed, silent and labelled; a smaller size is scaled at the end', () => {
  const args = partArgs({ src: 'm.mp4', start: 17, end: 20, out: 'r.mp4', slow: 2, label: 'replay.ass', size: { w: 1280, h: 720 } });
  const vf = args[args.indexOf('-vf') + 1];
  assert.equal(vf, 'setpts=PTS+17/TB,ass=overlay.ass,setpts=PTS-STARTPTS,setpts=2*PTS,ass=replay.ass,scale=1280:720,setsar=1,format=yuv420p');
  assert.ok(args.includes('anullsrc=r=48000:cl=stereo'));
  assert.equal(args[args.indexOf('anullsrc=r=48000:cl=stereo') - 2], '6'); // twice as long
  const fit = partArgs({ src: 'm.mp4', start: 0, end: 5, out: 'p.mp4', overlay: false, size: { w: 1920, h: 1080, fit: true } });
  assert.match(fit[fit.indexOf('-vf') + 1], /force_original_aspect_ratio=decrease,pad=1920:1080/);
});

test('the replay label is a box and a word at the top', () => {
  const ass = labelScript({ width: 1920, height: 1080, style: DEFAULT_BOARD, text: 'REPLAY' });
  const lines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('\\p1'));
  assert.ok(lines[1].endsWith('}REPLAY'));
});

test('music is looped under the court sound and faded out at the end', () => {
  const a = musicArgs({ video: 'v.mp4', music: 'm.mp3', out: 'o.mp4', length: 60, musicVolume: 0.3, courtVolume: 0.5 });
  assert.deepEqual(a.slice(a.indexOf('-stream_loop'), a.indexOf('-stream_loop') + 4), ['-stream_loop', '-1', '-i', 'm.mp3']);
  assert.equal(a[a.indexOf('-filter_complex') + 1], '[1:a]volume=0.3,afade=t=out:st=57:d=3[m];[0:a]volume=0.5[c];[c][m]amix=inputs=2:duration=first:normalize=0[a]');
  assert.ok(a.includes('copy'));
});

test('output and music settings are cleaned; music is used only where chosen', () => {
  assert.deepEqual(cleanOutput({ size: 1080, maxRate: 500, replays: 'yes' }), { size: '1080', maxRate: 100, replays: DEFAULT_OUTPUT.replays, removeVoices: false });
  assert.deepEqual(cleanMusic({ volume: 150, use: 'loud', file: 'C:/x.mp3' }), { ...DEFAULT_MUSIC, volume: 100 });
  const settings = { music: { ...DEFAULT_MUSIC, file: 'C:/no/such/music.mp3' } };
  assert.equal(musicFor(settings, true), null); // the file isn't there
  assert.equal(musicFor({ music: { ...DEFAULT_MUSIC } }, true), null);
});

test('only MP3, M4A and WAV files are taken as music', () => {
  const bytes = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
  assert.equal(audioKind(bytes('ID3\u0004\u0000\u0000\u0000\u0000')), 'mp3');
  assert.equal(audioKind(Uint8Array.from([0xff, 0xfb, 0x90, 0x64])), 'mp3');
  assert.equal(audioKind(bytes('\u0000\u0000\u0000\u0020ftypM4A \u0000')), 'm4a');
  assert.equal(audioKind(bytes('RIFF\u0000\u0000\u0000\u0000WAVEfmt ')), 'wav');
  assert.equal(audioKind(bytes('<html>')), null);
});
