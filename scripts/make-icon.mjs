// Draws build/icon.png (512 × 512, the installer's and the window's icon)
// from the app's mark, public/visual-kit/app-mark.svg, the same picture the
// page uses as its logo and favicon. Run by `npm run dist` (and `npm run icon`),
// so the two can't drift apart. Uses headless Chrome to draw the SVG.

import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mark = fileURLToPath(new URL('../public/visual-kit/app-mark.svg', import.meta.url));
const out = fileURLToPath(new URL('../build/icon.png', import.meta.url));
const SIZE = 512;

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}: set CHROME to chrome.exe.`);
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), 'badminton-video-icon-'));
try {
  const page = join(dir, 'icon.html');
  writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent"><img src="${pathToFileURL(mark)}" width="${SIZE}" height="${SIZE}" style="display:block"></body></html>`);
  const before = existsSync(out) ? statSync(out).mtimeMs : 0;
  spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${SIZE},${SIZE}`, `--screenshot=${out}`, `--user-data-dir=${join(dir, 'profile')}`, pathToFileURL(page).href], { stdio: 'ignore' });
  if (!existsSync(out) || statSync(out).mtimeMs === before) {
    console.error('Chrome didn’t draw the icon.');
    process.exit(1);
  }
  console.log(`Icon drawn from ${mark} into ${out}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
