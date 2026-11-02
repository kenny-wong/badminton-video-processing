// MP4 / QuickTime boxes, for keeping a phone video's own details when the
// Tools page merges or splits it. FFmpeg copies the picture and sound exactly
// but writes its own metadata: it drops the phone's boxes (Samsung's camera
// model, lens and recording mode in moov/udta, the com.android.* and
// com.apple.quicktime.* keys in moov/meta). So after FFmpeg has written a
// file, the original's moov/udta and moov/meta are put back byte for byte.
//
// That is safe only while moov is the file's last box: then making it longer
// or shorter moves nothing that the sample tables point at (FFmpeg writes moov
// after mdat unless asked for "faststart").

import { open } from 'node:fs/promises';

/** The boxes in buf[start, end): [{ type, start, size, head }] (head = header length). */
export function boxes(buf, start = 0, end = buf.length) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let head = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      size = Number(buf.readBigUInt64BE(pos + 8));
      head = 16;
    } else if (size === 0) size = end - pos;
    if (size < head || pos + size > end) break;
    out.push({ type, start: pos, size, head });
    pos += size;
  }
  return out;
}

/** A box: 32-bit size, type, payload. */
export function box(type, ...payload) {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

const slice = (buf, b) => buf.subarray(b.start, b.start + b.size);

// moov/meta is a QuickTime box (children straight after the header) in phone
// videos, but an ISO full box (4 bytes of version and flags first) in others.
function metaChildren(meta) {
  const offset = meta.readUInt32BE(8) === 0 ? 12 : 8;
  return { offset, list: boxes(meta, offset) };
}

// "2026-10-24T09:12:33+0100", "…+01:00" or "…Z", as written by iPhones.
const APPLE_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** The ms since 1970 of an Apple creation date, or null. */
export function appleDate(text) {
  const m = APPLE_DATE.exec(text);
  if (!m) return null;
  const zone = m[8] === 'Z' ? 'Z' : m[8].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}${zone}`);
  return Number.isFinite(t) ? t : null;
}

/** An Apple creation date moved to `ms`, written the same way (same zone, same length). */
export function writeAppleDate(text, ms) {
  const m = APPLE_DATE.exec(text);
  const zone = m[8];
  const minutes = zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
  const local = new Date(ms + minutes * 60000);
  const two = (n) => String(n).padStart(2, '0');
  const frac = m[7] ? `.${String(local.getUTCMilliseconds()).padStart(3, '0').padEnd(m[7].length - 1, '0').slice(0, m[7].length - 1)}` : '';
  return `${local.getUTCFullYear()}-${two(local.getUTCMonth() + 1)}-${two(local.getUTCDate())}T${two(local.getUTCHours())}:${two(local.getUTCMinutes())}:${two(local.getUTCSeconds())}${frac}${zone}`;
}

/**
 * The key → value text of a QuickTime meta box's mdta keys
 * (com.apple.quicktime.creationdate, com.android.version, …), with where each
 * value's text sits in `meta`.
 */
export function metaKeys(meta) {
  const { list } = metaChildren(meta);
  const keysBox = list.find((b) => b.type === 'keys');
  const ilst = list.find((b) => b.type === 'ilst');
  if (!keysBox || !ilst) return [];
  const names = [];
  let pos = keysBox.start + 16; // header, version/flags, entry count
  const end = keysBox.start + keysBox.size;
  while (pos + 8 <= end) {
    const size = meta.readUInt32BE(pos);
    if (size < 8 || pos + size > end) break;
    names.push(meta.toString('utf8', pos + 8, pos + size));
    pos += size;
  }
  const out = [];
  for (const item of boxes(meta, ilst.start + 8, ilst.start + ilst.size)) {
    const index = meta.readUInt32BE(item.start + 4); // the item's type is its 1-based key number
    const data = boxes(meta, item.start + 8, item.start + item.size).find((b) => b.type === 'data');
    if (!data || !names[index - 1]) continue;
    const kind = meta.readUInt32BE(data.start + 8) & 0xffffff;
    const from = data.start + 16;
    const to = data.start + data.size;
    out.push({ key: names[index - 1], text: kind === 1 ? meta.toString('utf8', from, to) : null, from, to });
  }
  return out;
}

/** A copy of a meta box with its Apple creation date moved by `shiftDate(ms) → ms`. */
export function shiftMetaDate(meta, shiftDate) {
  const copy = Buffer.from(meta);
  for (const k of metaKeys(copy)) {
    if (k.key !== 'com.apple.quicktime.creationdate' || !k.text) continue;
    const t = appleDate(k.text);
    if (t === null) continue;
    const text = writeAppleDate(k.text, shiftDate(t));
    if (Buffer.byteLength(text) === k.to - k.from) copy.write(text, k.from, 'utf8');
  }
  return copy;
}

/**
 * The output's moov with the source's udta and meta in place of FFmpeg's
 * (where the source has them). `shiftDate` moves an iPhone's creation date.
 * Returns { moov, carried: ['udta', 'meta'] }.
 */
export function carryMetadata(sourceMoov, outMoov, { shiftDate = null } = {}) {
  const src = boxes(sourceMoov, 8);
  const out = boxes(outMoov, 8);
  const taken = {};
  for (const type of ['udta', 'meta']) {
    const b = src.find((x) => x.type === type);
    if (!b) continue;
    let body = Buffer.from(slice(sourceMoov, b));
    if (type === 'meta' && shiftDate) body = shiftMetaDate(body, shiftDate);
    taken[type] = body;
  }
  const kept = out.filter((b) => !taken[b.type]).map((b) => slice(outMoov, b));
  return { moov: box('moov', ...kept, ...Object.values(taken)), carried: Object.keys(taken) };
}

/** The file's top-level boxes. */
export async function topBoxes(fh) {
  const { size } = await fh.stat();
  const out = [];
  let pos = 0;
  const head = Buffer.alloc(16);
  while (pos + 8 <= size) {
    await fh.read(head, 0, 16, pos);
    let len = head.readUInt32BE(0);
    let hl = 8;
    if (len === 1) {
      len = Number(head.readBigUInt64BE(8));
      hl = 16;
    } else if (len === 0) len = size - pos;
    if (len < hl || pos + len > size) break;
    out.push({ type: head.toString('latin1', 4, 8), start: pos, size: len, head: hl });
    pos += len;
  }
  return { list: out, size, end: pos };
}

async function readMoov(fh) {
  const top = await topBoxes(fh);
  const moov = top.list.find((b) => b.type === 'moov');
  if (!moov) return { top, moov: null, buf: null };
  const buf = Buffer.alloc(moov.size);
  await fh.read(buf, 0, moov.size, moov.start);
  if (moov.head !== 8) return { top, moov, buf: null }; // a moov over 4 GB: not from a phone
  return { top, moov, buf };
}

/**
 * Puts the source file's udta/meta into the output file (see carryMetadata).
 * Returns { carried, skipped } where skipped says why nothing was done.
 */
export async function carryMetadataFile(sourcePath, outPath, opts = {}) {
  const sfh = await open(sourcePath, 'r');
  let src;
  try {
    src = await readMoov(sfh);
  } finally {
    await sfh.close();
  }
  if (!src.buf) return { carried: [], skipped: 'The original has no readable moov box' };
  const ofh = await open(outPath, 'r+');
  try {
    const out = await readMoov(ofh);
    if (!out.buf) return { carried: [], skipped: 'The new file has no readable moov box' };
    const last = out.top.list.at(-1);
    if (last !== out.moov || out.top.end !== out.top.size) return { carried: [], skipped: 'The new file’s moov box isn’t at its end' };
    const { moov, carried } = carryMetadata(src.buf, out.buf, opts);
    await ofh.write(moov, 0, moov.length, out.moov.start);
    await ofh.truncate(out.moov.start + moov.length);
    return { carried, skipped: null };
  } finally {
    await ofh.close();
  }
}
