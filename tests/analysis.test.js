import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultTools, pythonEnv, SCRIPTS, toolsFolder } from '../lib/analysis.js';
import { fetchFile, parseGpu, PARTS, progressOf, removeAnalysis, setupState, STEPS } from '../lib/analysis-setup.js';
import { peopleFinder } from '../lib/people.js';
import { tracker } from '../lib/track.js';
import { voiceRemover } from '../lib/voices.js';
import { cleanSettings } from '../lib/settings.js';

const sha = (data) => createHash('sha256').update(data).digest('hex');

async function withFolder(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'analysis-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A local file server: `answer(req, res)` per request, with the requests it saw. */
async function withFiles(answer, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.range ?? null);
    answer(req, res, seen.length);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/file`, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const DATA = Buffer.from('shuttle'.repeat(5000));

/** Serves DATA, honouring Range. */
function serve(req, res) {
  const from = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
  if (from >= DATA.length) return res.writeHead(416).end();
  res.writeHead(from ? 206 : 200, { 'Content-Length': DATA.length - from });
  return res.end(DATA.subarray(from));
}

test('the tools are in Settings’ folder, else the app’s own; the scripts always come with the app', () => {
  assert.equal(toolsFolder({ analysisFolder: 'D:\\Tools' }), 'D:\\Tools');
  assert.equal(toolsFolder({ analysisFolder: '' }), defaultTools());
  const root = 'D:\\Tools';
  assert.ok(tracker(root).runner.startsWith(SCRIPTS));
  assert.ok(tracker(root).tracknet.startsWith(root));
  assert.ok(tracker(root).python.startsWith(root));
  assert.ok(peopleFinder(root).script.startsWith(SCRIPTS));
  assert.ok(voiceRemover(root).script.startsWith(SCRIPTS));
  assert.equal(cleanSettings({ analysisFolder: ' D:\\Tools ' }).analysisFolder, 'D:\\Tools');
});

test('Demucs’ models stay with a set-up from Settings, and in the usual cache for one made by hand', async () => {
  await withFolder(async (dir) => {
    assert.deepEqual(pythonEnv(dir), {});
    await mkdir(join(dir, 'torch-home'));
    assert.deepEqual(pythonEnv(dir), { TORCH_HOME: join(dir, 'torch-home') });
    assert.deepEqual(voiceRemover(dir).env, { TORCH_HOME: join(dir, 'torch-home') });
  });
});

test('an NVIDIA card is read from nvidia-smi’s line', () => {
  assert.deepEqual(parseGpu('NVIDIA GeForce RTX 3090, 610.88, 24576 MiB\r\n'), { name: 'NVIDIA GeForce RTX 3090', driver: '610.88', memory: '24576 MiB' });
  assert.equal(parseGpu(''), null);
});

test('a download arrives whole and only then gets its name', async () => {
  await withFolder((dir) => withFiles(serve, async (url) => {
    const file = join(dir, 'sub', 'a.bin');
    let last = 0;
    await fetchFile(url, file, { sha256: sha(DATA), onProgress: (p) => { last = p; } });
    assert.deepEqual(await readFile(file), DATA);
    assert.equal(last, 1);
    assert.ok(!existsSync(`${file}.partial`));
  }));
});

test('a download carries on from where it stopped', async () => {
  await withFolder((dir) => withFiles(serve, async (url, seen) => {
    const file = join(dir, 'a.bin');
    await writeFile(`${file}.partial`, DATA.subarray(0, 1000));
    await fetchFile(url, file, { sha256: sha(DATA) });
    assert.deepEqual(seen, ['bytes=1000-']);
    assert.deepEqual(await readFile(file), DATA);
  }));
});

test('a dropped connection is retried from where it got to', async () => {
  await withFolder((dir) => withFiles((req, res, n) => {
    if (n > 1) return serve(req, res);
    res.writeHead(200, { 'Content-Length': DATA.length });
    res.write(DATA.subarray(0, 2000), () => setTimeout(() => res.destroy(), 100));
    return undefined;
  }, async (url, seen) => {
    const file = join(dir, 'a.bin');
    await fetchFile(url, file, { sha256: sha(DATA), wait: 1 });
    assert.equal(seen.length, 2);
    assert.match(seen[1], /^bytes=\d+-$/);
    assert.deepEqual(await readFile(file), DATA);
  }));
});

test('a server that can’t resume starts the file again', async () => {
  await withFolder((dir) => withFiles((_, res) => res.writeHead(200, { 'Content-Length': DATA.length }).end(DATA), async (url) => {
    const file = join(dir, 'a.bin');
    await writeFile(`${file}.partial`, 'left over');
    await fetchFile(url, file, { sha256: sha(DATA) });
    assert.deepEqual(await readFile(file), DATA);
  }));
});

test('an already finished partial file is checked, not fetched again', async () => {
  await withFolder((dir) => withFiles(serve, async (url) => {
    const file = join(dir, 'a.bin');
    await writeFile(`${file}.partial`, DATA);
    await fetchFile(url, file, { sha256: sha(DATA) });
    assert.deepEqual(await readFile(file), DATA);
  }));
});

test('a damaged download is thrown away, and a finished one isn’t fetched again', async () => {
  await withFolder((dir) => withFiles(serve, async (url, seen) => {
    const file = join(dir, 'a.bin');
    await assert.rejects(fetchFile(url, file, { sha256: sha('something else') }), /damaged/);
    assert.ok(!existsSync(file) && !existsSync(`${file}.partial`));
    await fetchFile(url, file, { sha256: sha(DATA) });
    const asked = seen.length;
    await fetchFile(url, file, { sha256: sha(DATA) });
    assert.equal(seen.length, asked);
  }));
});

test('a missing file fails at once; a server error is retried', async () => {
  await withFolder(async (dir) => {
    await withFiles((_, res) => res.writeHead(404).end(), async (url, seen) => {
      await assert.rejects(fetchFile(url, join(dir, 'a.bin'), { sha256: sha(DATA), wait: 1 }), /answered 404/);
      assert.equal(seen.length, 1);
    });
    await withFiles((req, res, n) => (n < 3 ? res.writeHead(503).end() : serve(req, res)), async (url, seen) => {
      await fetchFile(url, join(dir, 'b.bin'), { sha256: sha(DATA), wait: 1 });
      assert.equal(seen.length, 3);
    });
  });
});

test('stopping ends a download at once and keeps what it got', async () => {
  await withFolder((dir) => withFiles((_, res) => {
    res.writeHead(200, { 'Content-Length': DATA.length });
    res.write(DATA.subarray(0, 1000));
  }, async (url) => {
    const controller = new AbortController();
    const file = join(dir, 'a.bin');
    const going = fetchFile(url, file, { sha256: sha(DATA), signal: controller.signal, onProgress: () => controller.abort() });
    await assert.rejects(going, { code: 'stopped' });
    assert.ok(existsSync(`${file}.partial`));
  }));
});

test('the progress bar fills once over the steps', () => {
  assert.ok(Math.abs(STEPS.reduce((sum, [, , share]) => sum + share, 0) - 1) < 1e-9);
  assert.equal(progressOf([], 'python'), 0);
  assert.ok(Math.abs(progressOf(['python'], 'torch-file', 0.5) - (0.03 + 0.275)) < 1e-9);
  assert.ok(Math.abs(progressOf(STEPS.map(([n]) => n), null) - 1) < 1e-9);
});

test('only a set-up made here can be removed, and only what it made goes', async () => {
  await withFolder(async (dir) => {
    await mkdir(join(dir, '.venv'));
    await writeFile(join(dir, 'run_tracknet.py'), 'mine');
    assert.deepEqual(await setupState(dir), { madeHere: false, unfinished: false });
    assert.equal(await removeAnalysis(dir), false);
    assert.ok(existsSync(join(dir, '.venv')));

    await writeFile(join(dir, 'setup.json'), JSON.stringify({ done: ['python'], finished: false }));
    assert.deepEqual(await setupState(dir), { madeHere: true, unfinished: true });
    assert.equal(await removeAnalysis(dir), true);
    assert.ok(!existsSync(join(dir, '.venv')) && !existsSync(join(dir, 'setup.json')));
    assert.ok(existsSync(join(dir, 'run_tracknet.py')));
  });
});

test('every part of the set-up has a fixed version and a checksum', () => {
  const lines = readFileSync(new URL('../analysis/requirements.txt', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  assert.ok(lines.length > 40);
  for (const line of lines) assert.match(line, /^[\w.-]+==[\w.+-]+$/);
  for (const name of ['torch==2.5.1+cu121', 'torchvision==0.20.1+cu121', 'torchaudio==2.5.1+cu121', 'demucs==4.0.1']) assert.ok(lines.includes(name), name);
  for (const part of [PARTS.python, PARTS.torch, PARTS.tracknet, ...PARTS.models]) assert.match(part.sha256, /^[0-9a-f]{64}$/);
  for (const part of [PARTS.python, PARTS.torch]) assert.match(part.url, /^https:\/\//);
});
