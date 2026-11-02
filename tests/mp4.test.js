import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appleDate, box, boxes, carryMetadata, carryMetadataFile, fitHeader, metaKeys, shiftMetaDate, writeAppleDate } from '../lib/mp4.js';

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const raw = (typeBytes, ...payload) => { const body = Buffer.concat(payload); return Buffer.concat([u32(body.length + 8), typeBytes, body]); };
const entry = (name) => Buffer.concat([u32(8 + Buffer.byteLength(name)), Buffer.from('mdta'), Buffer.from(name)]);
const data = (text) => box('data', u32(1), u32(0), Buffer.from(text));

// moov/meta as an iPhone writes it: hdlr, keys, ilst (items typed by key number).
const appleMeta = (date) => box('meta',
  box('hdlr', Buffer.alloc(25)),
  box('keys', u32(0), u32(2), entry('com.apple.quicktime.creationdate'), entry('com.apple.quicktime.make')),
  box('ilst', raw(u32(1), data(date)), raw(u32(2), data('Apple'))));

// The phone's own boxes, which FFmpeg doesn't copy.
const phoneUdta = box('udta', box('auth', Buffer.from('Galaxy Z Fold7')), box('smta', Buffer.from('mdlnSM-F9660')), box('©xyz', Buffer.from('+52.0316-001.1478/')));
const sourceMoov = box('moov', box('mvhd', Buffer.alloc(100, 1)), box('trak', Buffer.alloc(40, 2)), phoneUdta, appleMeta('2026-10-24T09:12:33+0100'));
// What FFmpeg writes instead: its own udta (encoder name) and no moov/meta.
const ffmpegMoov = box('moov', box('mvhd', Buffer.alloc(100, 3)), box('trak', Buffer.alloc(40, 4)), box('udta', box('meta', Buffer.alloc(12)), box('loci', Buffer.alloc(10))));

const types = (buf) => boxes(buf, 8).map((b) => b.type);

test('Apple creation dates are read and rewritten in their own zone and length', () => {
  assert.equal(appleDate('2026-10-24T09:12:33+0100'), Date.UTC(2026, 9, 24, 8, 12, 33));
  assert.equal(appleDate('2026-10-24T09:12:33+01:00'), Date.UTC(2026, 9, 24, 8, 12, 33));
  assert.equal(appleDate('2026-10-24T08:12:33Z'), Date.UTC(2026, 9, 24, 8, 12, 33));
  assert.equal(appleDate('yesterday'), null);
  assert.equal(writeAppleDate('2026-10-24T09:12:33+0100', Date.UTC(2026, 9, 24, 8, 14, 3)), '2026-10-24T09:14:03+0100');
  assert.equal(writeAppleDate('2026-10-24T09:12:33-05:00', Date.UTC(2026, 9, 24, 15, 0, 0)), '2026-10-24T10:00:00-05:00');
  assert.equal(writeAppleDate('2026-10-24T09:12:33.250Z', Date.UTC(2026, 9, 24, 9, 12, 34, 500)), '2026-10-24T09:12:34.500Z');
});

test('the mdta keys of a meta box are listed with their values', () => {
  const keys = metaKeys(appleMeta('2026-10-24T09:12:33+0100'));
  assert.deepEqual(keys.map((k) => [k.key, k.text]), [['com.apple.quicktime.creationdate', '2026-10-24T09:12:33+0100'], ['com.apple.quicktime.make', 'Apple']]);
});

test('an iPhone creation date moves with the part; the other keys stay', () => {
  const meta = appleMeta('2026-10-24T09:12:33+0100');
  const moved = shiftMetaDate(meta, (t) => t + 95_000);
  assert.equal(moved.length, meta.length);
  assert.deepEqual(metaKeys(moved).map((k) => k.text), ['2026-10-24T09:14:08+0100', 'Apple']);
  assert.equal(metaKeys(meta)[0].text, '2026-10-24T09:12:33+0100'); // the original buffer is untouched
});

test('the phone’s udta and meta replace FFmpeg’s, byte for byte', () => {
  const { moov, carried } = carryMetadata(sourceMoov, ffmpegMoov);
  assert.deepEqual(carried, ['udta', 'meta']);
  assert.deepEqual(types(moov), ['mvhd', 'trak', 'udta', 'meta']);
  const list = boxes(moov, 8);
  assert.deepEqual(moov.subarray(list[0].start, list[0].start + list[0].size), ffmpegMoov.subarray(8, 116)); // FFmpeg's mvhd kept
  const udta = list.find((b) => b.type === 'udta');
  assert.deepEqual(moov.subarray(udta.start, udta.start + udta.size), phoneUdta);
  assert.equal(moov.readUInt32BE(0), moov.length);
});

test('without phone boxes in the source, FFmpeg’s are kept', () => {
  const plain = box('moov', box('mvhd', Buffer.alloc(100)));
  const { moov, carried } = carryMetadata(plain, ffmpegMoov);
  assert.deepEqual(carried, []);
  assert.deepEqual(moov, ffmpegMoov);
});

test('the phone’s ftyp fits in FFmpeg’s room, padded with a free box, or not at all', () => {
  const ftyp = box('ftyp', Buffer.from('mp42'), u32(0), Buffer.from('isommp42'));
  assert.deepEqual(fitHeader(ftyp, 24), ftyp);
  const padded = fitHeader(ftyp, 36);
  assert.equal(padded.length, 36);
  assert.deepEqual(boxes(padded).map((b) => [b.type, b.size]), [['ftyp', 24], ['free', 12]]);
  assert.equal(fitHeader(ftyp, 30), null); // 6 bytes left: too small for a box
  assert.equal(fitHeader(ftyp, 20), null);
});

test('the boxes are put back into a file whose moov comes last, and only then', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bv-mp4-'));
  try {
    const src = join(dir, 'src.mp4');
    const out = join(dir, 'out.mp4');
    const ftyp = box('ftyp', Buffer.from('mp42'), u32(0), Buffer.from('isommp42')); // the phone's: 24 bytes
    const ffmpegHead = Buffer.concat([box('ftyp', Buffer.from('mp42'), u32(512), Buffer.from('mp42iso2mp41')), box('free')]); // FFmpeg's: 28 + 8
    const mdat = box('mdat', Buffer.alloc(5000, 7));
    writeFileSync(src, Buffer.concat([ftyp, mdat, sourceMoov]));
    writeFileSync(out, Buffer.concat([ffmpegHead, mdat, ffmpegMoov]));
    const r = await carryMetadataFile(src, out, { shiftDate: (t) => t + 60_000 });
    assert.deepEqual(r, { carried: ['ftyp', 'udta', 'meta'], skipped: null });
    const file = readFileSync(out);
    const top = boxes(file);
    assert.deepEqual(top.map((b) => b.type), ['ftyp', 'free', 'mdat', 'moov']);
    assert.deepEqual(file.subarray(0, 24), ftyp); // the phone's brands and version
    assert.equal(top[2].start, ffmpegHead.length); // the media hasn't moved
    assert.deepEqual(file.subarray(top[2].start, top[2].start + top[2].size), mdat); // picture and sound untouched
    const moov = file.subarray(top[3].start);
    const meta = boxes(moov, 8).find((b) => b.type === 'meta');
    assert.equal(metaKeys(moov.subarray(meta.start, meta.start + meta.size))[0].text, '2026-10-24T09:13:33+0100');

    writeFileSync(out, Buffer.concat([ftyp, ffmpegMoov, mdat])); // "faststart": moov before the media
    const r2 = await carryMetadataFile(src, out);
    assert.match(r2.skipped, /isn’t at its end/);
    assert.deepEqual(readFileSync(out), Buffer.concat([ftyp, ffmpegMoov, mdat]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
