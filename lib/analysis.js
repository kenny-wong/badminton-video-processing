// Where the Python tools (shuttle tracking, finding players, removing voices)
// are. Two places: the app's own small scripts, which come with the app, and
// the big set-up beside them (Python with PyTorch, TrackNetV3, trained models),
// which Settings downloads (lib/analysis-setup.js) and which stays out of the
// repo and the installer. In a checkout both are the analysis folder; the
// desktop app sets the two variables below, and Settings can name another
// folder for the big part (a roomier drive, or a set-up that's already there).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = process.env.BADMINTON_VIDEO_SCRIPTS || fileURLToPath(new URL('../analysis/', import.meta.url));

/** Where this app keeps the set-up when Settings doesn't name a folder. */
export const defaultTools = () => process.env.BADMINTON_VIDEO_TOOLS || SCRIPTS;

export const toolsFolder = (settings) => settings?.analysisFolder || defaultTools();

export const pythonIn = (root) => join(root, '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');

// Set-ups from Settings keep Demucs' models with the rest, so Remove takes them too.
export const TORCH_HOME = 'torch-home';

/** What the Python programs need in their environment, for the set-up in `root`. */
export function pythonEnv(root) {
  const home = join(root, TORCH_HOME);
  return existsSync(home) ? { TORCH_HOME: home } : {};
}

export const notSetUp = (what) => `${what} isn’t set up yet: open Settings and choose Set up in Tracking tools.`;
