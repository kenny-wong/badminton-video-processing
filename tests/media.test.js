import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describe, rate, recordedAt } from '../lib/media.js';
import { londonClock, londonDate, londonTime } from '../lib/uk-time.js';

const probe = (tags = {}, stream = {}) => ({
  format: { duration: '1234.5', tags },
  streams: [
    { codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, avg_frame_rate: '60000/1001', ...stream },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
});

test('an iPhone video uses its own local start time', () => {
  const r = recordedAt(probe({ 'com.apple.quicktime.creationdate': '2026-10-24T09:12:33+0100', creation_time: '2026-10-24T08:30:00.000000Z' }), 'IMG_1234.MOV');
  assert.equal(new Date(r.at).toISOString(), '2026-10-24T08:12:33.000Z');
  assert.equal(r.source, 'apple');
});

test('Android file names are UK wall-clock times, Pixel ones UTC', () => {
  const s = recordedAt(probe(), '20261024_091233.mp4');
  assert.equal(new Date(s.at).toISOString(), '2026-10-24T08:12:33.000Z'); // BST
  const v = recordedAt(probe(), 'C:\\Phone\\VID_20261124_091233.mp4');
  assert.equal(new Date(v.at).toISOString(), '2026-11-24T09:12:33.000Z'); // GMT
  const p = recordedAt(probe(), 'PXL_20261024_081233123.mp4');
  assert.equal(new Date(p.at).toISOString(), '2026-10-24T08:12:33.000Z');
  assert.equal(p.source, 'filename');
});

test('otherwise the video’s creation time, then the file date less the length', () => {
  const c = recordedAt(probe({ creation_time: '2026-10-24T08:30:00.000000Z' }), 'match.mp4');
  assert.deepEqual(c, { at: Date.parse('2026-10-24T08:30:00Z'), source: 'creation_time' });
  const zero = recordedAt(probe({ creation_time: '1970-01-01T00:00:00Z' }), 'match.mp4', Date.parse('2026-10-24T10:00:00Z'), 600);
  assert.deepEqual(zero, { at: Date.parse('2026-10-24T09:50:00Z'), source: 'modified' });
  assert.deepEqual(recordedAt({}, 'x.mp4'), { at: null, source: null });
});

test('describe reports the picture upright, the frame rate and HDR', () => {
  const d = describe(probe({}, { side_data_list: [{ rotation: -90 }], color_transfer: 'arib-std-b67' }), 'IMG_1.MOV');
  assert.deepEqual([d.width, d.height, d.fps, d.codec, d.hdr, d.hasAudio, d.duration], [1080, 1920, 59.94, 'hevc', true, true, 1234.5]);
  const flat = describe(probe(), 'a.mp4');
  assert.deepEqual([flat.width, flat.height, flat.hdr], [1920, 1080, false]);
  assert.equal(rate('0/0'), null);
});

test('UK time helpers handle summer and winter time', () => {
  assert.equal(new Date(londonTime('2026-07-01', '09:00')).toISOString(), '2026-07-01T08:00:00.000Z');
  assert.equal(new Date(londonTime('2026-12-01', '09:00')).toISOString(), '2026-12-01T09:00:00.000Z');
  assert.equal(londonDate(Date.parse('2026-07-01T23:30:00Z')), '2026-07-02');
  assert.equal(londonClock(Date.parse('2026-07-01T08:05:00Z')), '09:05');
});
