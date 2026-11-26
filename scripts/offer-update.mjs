// The last step of `npm run dist`: leaves the new installer in the installed
// app's updates folder (%LOCALAPPDATA%\Badminton Video\updates, or
// BADMINTON_VIDEO_UPDATES), with latest.json saying which version it is, its
// size and SHA-256, and its release notes. The installed app notices within a
// minute and offers "Restart now" (lib/app-update.js). latest.json is written
// last, by renaming, so the app never reads a half-copied installer as ready.
// `--no-offer` skips it.

import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLER, OFFER_FILE, sha256File, updatesFolder } from '../lib/app-update.js';
import { RELEASES } from '../public/shared/releases.js';

if (process.argv.includes('--no-offer')) process.exit(0);
const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = `Badminton-Video-Setup-${version}.exe`;
const source = join(root, 'dist', name);
const dir = updatesFolder();
if (!dir) {
  console.log('No updates folder (LOCALAPPDATA isn’t set): the installed app isn’t offered this version.');
  process.exit(0);
}
const size = (await stat(source)).size;
const sha256 = await sha256File(source);
await mkdir(dir, { recursive: true });
const partial = join(dir, `${name}.partial`);
await copyFile(source, partial);
if ((await sha256File(partial)) !== sha256) throw new Error(`The copy of ${name} in ${dir} doesn’t match the original`);
await rename(partial, join(dir, name));
const notes = RELEASES.find((r) => r.version === version)?.notes ?? [];
const offer = join(dir, OFFER_FILE);
await writeFile(`${offer}.tmp`, `${JSON.stringify({ version, file: name, size, sha256, notes }, null, 2)}\n`);
await rename(`${offer}.tmp`, offer);
for (const other of await readdir(dir)) {
  if (other !== name && (INSTALLER.test(other) || other.endsWith('.partial'))) await rm(join(dir, other), { force: true }).catch(() => {});
}
console.log(`Offered ${version} to the installed app: ${join(dir, name)}`);
