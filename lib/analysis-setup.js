// Sets up the Python tools with one button in Settings, on a PC with nothing
// installed: its own copy of Python, PyTorch for NVIDIA graphics cards,
// TrackNetV3, Demucs, Ultralytics YOLO and their trained models. Everything
// has a fixed version (analysis/requirements.txt and PARTS below), so the
// set-up that works here is the one people get. It goes in one folder, and
// Ultralytics (AGPL-3.0) comes straight from its publisher, never with the app.
//
// Each finished step is noted in setup.json, and big downloads carry on from
// where they stopped, so starting again after a failure or Stop doesn't redo
// finished work. setup.json also marks a folder as made here: only those can
// be removed from the app.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { pythonEnv, pythonIn, SCRIPTS, TORCH_HOME } from './analysis.js';
import { PEOPLE_MODEL } from './people.js';
import { runPython } from './track.js';
import { VOICE_MODEL } from './voices.js';

const RELEASE = 'https://github.com/kenny-wong/badminton-video-processing/releases/download/tracking-models-1';
const CUDA_INDEX = 'https://download.pytorch.org/whl/cu121';

export const PARTS = {
  python: {
    url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261009/cpython-3.10.22%2B20261009-x86_64-pc-windows-msvc-install_only.tar.gz',
    file: 'python.tar.gz',
    sha256: 'cb023e83e42d8937ba77c7cf83641083c3b81e88e1226e1c694a347ae1924d54',
  },
  torch: {
    url: `${CUDA_INDEX}/torch-2.5.1%2Bcu121-cp310-cp310-win_amd64.whl`,
    file: 'torch-2.5.1+cu121-cp310-cp310-win_amd64.whl',
    sha256: '9b22d6d98aa56f9317902dec0e066814a6edba1aada90110ceea2bb0678df22f',
  },
  // TrackNetV3 (MIT licence) at commit 6eda442 and the authors' trained models, on this app's own release.
  tracknet: { name: 'TrackNetV3-6eda442.tar.gz', sha256: 'a68dcc6af6b262d3b4d030048750d3c1d1e4f2d820061dec1ced0737de53f86e' },
  models: [
    { name: 'TrackNet_best.pt', sha256: 'df867641a02712b021f04548ff4b1208ddfdb47f629ab2094ceb978667e83b1a' },
    { name: 'InpaintNet_best.pt', sha256: '5749b66b8002f3ad9e0af841604004706fc796df30599e6bf01952696009688c' },
  ],
};

const PIP = '26.2.2';
const STATE = 'setup.json';
const DOWNLOADS = 'downloads';
const MADE_HERE = ['.venv', 'python', 'vendor', 'ckpts', TORCH_HOME, DOWNLOADS, 'setup.log', STATE];
export const NEED_BYTES = 10e9; // what it keeps, plus PyTorch's download while it's being installed

/** Which NVIDIA card nvidia-smi's CSV line names, or null. */
export function parseGpu(text) {
  const [name, driver, memory] = String(text).trim().split(/\r?\n/)[0].split(',').map((s) => s.trim());
  return name ? { name, driver: driver ?? '', memory: memory ?? '' } : null;
}

/** This PC's NVIDIA card, or null when there's none (nvidia-smi comes with its driver). */
export async function findGpu() {
  try {
    const { stdout } = await promisify(execFile)('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'], { timeout: 8000, windowsHide: true });
    return parseGpu(stdout);
  } catch {
    return null;
  }
}

/** Bytes free on the drive `folder` is on or would go on. */
export async function freeBytes(folder) {
  let path = folder;
  while (!existsSync(path) && dirname(path) !== path) path = dirname(path);
  try {
    const { bavail, bsize } = await statfs(path);
    return Number(bavail) * Number(bsize);
  } catch {
    return null;
  }
}

async function hashOf(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * Downloads `url` to `file`, carrying on from `<file>.partial` when the server
 * allows it, and retrying a dropped connection. The file only gets its name
 * once its SHA-256 is right.
 */
export async function fetchFile(url, file, { sha256, signal, onProgress = () => {}, tries = 8, wait = 3000 }) {
  if (existsSync(file) && (await hashOf(file)) === sha256) return;
  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  for (let attempt = 1; ; attempt += 1) {
    const have = existsSync(partial) ? (await stat(partial)).size : 0;
    try {
      const res = await fetch(url, { signal, headers: have ? { Range: `bytes=${have}-` } : {} });
      if (res.status !== 416) { // 416: the partial file is already the whole file
        if (!res.ok) throw Object.assign(new Error(`${url} answered ${res.status}`), { final: res.status < 500 && res.status !== 429 });
        const resumed = res.status === 206;
        const start = resumed ? have : 0;
        const total = start + Number(res.headers.get('content-length') ?? 0);
        let got = start;
        const count = new Transform({
          transform(chunk, _, done) {
            got += chunk.length;
            if (total) onProgress(got / total);
            done(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(res.body), count, createWriteStream(partial, { flags: resumed ? 'a' : 'w' }), { signal });
      }
      break;
    } catch (err) {
      if (signal?.aborted) throw Object.assign(new Error('Stopped'), { code: 'stopped' });
      if (err.final || attempt >= tries) throw err;
      await sleep(wait, signal);
    }
  }
  if ((await hashOf(partial)) !== sha256) {
    await rm(partial, { force: true });
    throw new Error(`The download from ${url} was damaged. Start the set-up again.`);
  }
  await rename(partial, file);
}

async function readState(folder) {
  try {
    return JSON.parse(await readFile(join(folder, STATE), 'utf8'));
  } catch {
    return null;
  }
}

/** Whether this app made the set-up in `folder`, and whether that set-up was left unfinished. */
export async function setupState(folder) {
  const state = await readState(folder);
  return { madeHere: Boolean(state), unfinished: Boolean(state) && !state.finished };
}

/** The steps in order: their name, what the page says, and their share of the progress bar. */
export const STEPS = [
  ['python', 'Getting Python', 0.03],
  ['torch-file', 'Downloading PyTorch', 0.55],
  ['torch', 'Installing PyTorch', 0.1],
  ['packages', 'Installing the other parts', 0.17],
  ['tracknet', 'Getting TrackNetV3', 0.01],
  ['models', 'Getting the trained models', 0.05],
  ['check', 'Getting the last models and checking it all works', 0.09],
];

/** How far along `done` steps and `part` (0-1) of `step` are. */
export function progressOf(done, step, part = 0) {
  const before = STEPS.filter(([name]) => done.includes(name)).reduce((sum, [, , share]) => sum + share, 0);
  return Math.min(1, before + (STEPS.find(([name]) => name === step)?.[2] ?? 0) * part);
}

/** Sets up everything in `folder` and returns { gpu }: the card PyTorch sees, or null. */
export async function setupAnalysis({ folder, scripts = SCRIPTS, release = process.env.BADMINTON_VIDEO_RELEASE || RELEASE, signal, job }) {
  await mkdir(folder, { recursive: true });
  const known = await readState(folder);
  const state = { done: [], ...known, finished: false };
  const save = () => writeFile(join(folder, STATE), JSON.stringify(state, null, 2));
  await save();
  job.logFile = join(folder, 'setup.log');
  const log = (text) => job.log(text);
  log(`Setting up in ${folder}`);

  const downloads = join(folder, DOWNLOADS);
  const temp = join(downloads, 'temp');
  await mkdir(temp, { recursive: true });
  await mkdir(join(folder, TORCH_HOME), { recursive: true });
  const python = pythonIn(folder);
  const env = {
    ...pythonEnv(folder), PIP_CACHE_DIR: join(downloads, 'pip'), PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1',
    TEMP: temp, TMP: temp, // not the system drive, which may be short of room
  };
  const program = (exe, args, options = {}) => runPython({ python: exe, env }, args, { cwd: folder, signal, log, what: 'The set-up', ...options });
  const pip = (...args) => program(python, ['-m', 'pip', 'install', '--progress-bar', 'off', ...args], { program: 'pip' });
  const unpack = (file, into) => program(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xzf', file, '-C', into], { program: 'tar' });

  let gpu = null;
  const work = {
    python: async (progress) => {
      const file = join(downloads, PARTS.python.file);
      await fetchFile(PARTS.python.url, file, { ...PARTS.python, signal, onProgress: progress });
      await rm(join(folder, 'python'), { recursive: true, force: true, maxRetries: 3 });
      await unpack(file, folder);
      // A set-up made by hand keeps its Python; an unfinished one of ours starts again.
      if (known || !existsSync(python)) await program(join(folder, 'python', 'python.exe'), ['-m', 'venv', '--clear', join(folder, '.venv')], { program: 'Python' });
      await pip(`pip==${PIP}`);
    },
    'torch-file': (progress) => fetchFile(PARTS.torch.url, join(downloads, PARTS.torch.file), { ...PARTS.torch, signal, onProgress: progress }),
    torch: async () => {
      const file = join(downloads, PARTS.torch.file);
      await pip('--no-deps', file);
      await rm(file, { force: true });
    },
    packages: () => pip('-r', join(scripts, 'requirements.txt'), '--extra-index-url', CUDA_INDEX),
    tracknet: async (progress) => {
      const file = join(downloads, PARTS.tracknet.name);
      await fetchFile(`${release}/${PARTS.tracknet.name}`, file, { ...PARTS.tracknet, signal, onProgress: progress });
      await rm(join(folder, 'vendor', 'TrackNetV3'), { recursive: true, force: true, maxRetries: 3 });
      await mkdir(join(folder, 'vendor'), { recursive: true });
      await unpack(file, join(folder, 'vendor'));
    },
    models: async (progress) => {
      for (const [i, model] of PARTS.models.entries()) {
        await fetchFile(`${release}/${model.name}`, join(folder, 'ckpts', model.name), { ...model, signal, onProgress: (p) => progress((i + p) / PARTS.models.length) });
      }
    },
    check: async () => {
      // The model files must hold only weights (no code), so they load in PyTorch's safe mode.
      await program(python, ['-I', '-c', "import torch; [torch.load(f, map_location='cpu', weights_only=True) for f in ('ckpts/TrackNet_best.pt', 'ckpts/InpaintNet_best.pt')]; print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')"], {
        program: 'PyTorch',
        onLine: (line) => {
          const name = /^GPU: (.+)$/.exec(line.trim())?.[1];
          if (name) gpu = name === 'none' ? null : name;
        },
      });
      await program(python, ['-I', '-W', 'ignore', '-c', `from demucs.pretrained import get_model; get_model('${VOICE_MODEL}'); print('Demucs models OK')`], { program: 'Demucs' });
      await program(python, ['-c', `from ultralytics import YOLO; YOLO('${PEOPLE_MODEL}'); print('Player model OK')`], { cwd: join(folder, 'ckpts'), program: 'Ultralytics' });
    },
  };

  for (const [name, message] of STEPS) {
    if (state.done.includes(name)) continue;
    job.message = message;
    job.progress = progressOf(state.done, name);
    log(message);
    await work[name]((part) => { job.progress = progressOf(state.done, name, part); });
    state.done.push(name);
    await save();
  }
  state.finished = true;
  await save();
  await rm(downloads, { recursive: true, force: true, maxRetries: 3 });
  job.progress = 1;
  log(gpu ? `Finished. PyTorch sees ${gpu}.` : 'Finished. PyTorch sees no NVIDIA card, so these tools will run on the processor.');
  return { gpu };
}

/** Removes a set-up this app made, and nothing else. False when `folder` wasn't made here. */
export async function removeAnalysis(folder) {
  if (!(await readState(folder))) return false;
  for (const name of MADE_HERE) await rm(join(folder, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  return true;
}
