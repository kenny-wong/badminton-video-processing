import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The app's pictures ship in the repo and the installer as image data only:
// no text, Exif, XMP or content-credential blocks carried along from the
// program that made them. Clean a new picture before adding it.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMAGE_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD']);

function images(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = join(dir, e.name);
    if (e.isDirectory()) return images(rel);
    return ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extname(e.name).toLowerCase()) ? [rel] : [];
  });
}

function pngChunks(buf) {
  const types = [];
  for (let o = 8; o < buf.length; o += 12 + buf.readUInt32BE(o)) types.push(buf.toString('latin1', o + 4, o + 8));
  return types;
}

const files = [...images('public'), join('build', 'icon.png')];

test('the app has pictures to check', () => {
  assert.ok(files.some((f) => f.endsWith('court-banner-short-angled.png')));
  assert.ok(files.some((f) => f.endsWith('app-mark.svg')));
});

test('pictures carry image data only, no metadata blocks', () => {
  for (const rel of files) {
    const buf = readFileSync(join(ROOT, rel));
    const ext = extname(rel).toLowerCase();
    if (ext === '.png') {
      const extra = pngChunks(buf).filter((t) => !IMAGE_CHUNKS.has(t));
      assert.deepEqual(extra, [], `${rel} has ${extra.join(', ')}`);
    } else if (ext === '.svg') {
      assert.doesNotMatch(buf.toString('utf8'), /<metadata|<rdf:|xmlns:(dc|cc|rdf|sodipodi|inkscape)=/i, rel);
    } else {
      assert.fail(`${rel}: JPEG/WebP pictures aren't checked yet; use PNG or SVG`);
    }
  }
});
