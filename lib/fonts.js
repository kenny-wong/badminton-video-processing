// The fonts that come with the app (public/fonts, with their licences), for FFmpeg's subtitle renderer.
// libass only knows the fonts installed in Windows, so each render's working folder gets a copy in
// `fonts/` and the ass filter is told about it (fontsdir=fonts): a path with a drive letter can't easily
// be written inside a filter, and the installed app keeps public/ inside its archive, where FFmpeg can't read.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONTS } from '../public/shared/board.js';
import { FONTS_SUBDIR } from './render.js';

export const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');

/** Copies the app's font files into `<workDir>/fonts` (those already there are kept). */
export async function fontsFor(workDir) {
  const dir = join(workDir, FONTS_SUBDIR);
  await mkdir(dir, { recursive: true });
  for (const file of Object.values(FONTS).flatMap((f) => f.files ?? [])) {
    const to = join(dir, file);
    if (!existsSync(to)) await writeFile(to, await readFile(join(FONTS_DIR, file)));
  }
  return dir;
}
