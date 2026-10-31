import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { append, stamp, tail } from '../lib/log.js';
import { BOOT, getJob, jobLog, jobView, startJob } from '../lib/jobs.js';
import { trackFailure } from '../lib/track.js';
import { errorDetails } from '../public/notice.js';

const settle = (job) => new Promise((resolve) => {
  const check = () => (job.status === 'running' ? setTimeout(check, 5) : resolve(job));
  check();
});

test('log lines get the local time in front, and tail() returns whole lines from the end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bv-log-'));
  try {
    const file = join(dir, 'a.log');
    const when = new Date(2026, 9, 31, 9, 5, 7);
    assert.equal(stamp(when), '2026-10-31 09:05:07');
    append(file, 'first\nsecond\n', when);
    append(file, 'third', when);
    assert.equal(readFileSync(file, 'utf8'), '2026-10-31 09:05:07  first\n2026-10-31 09:05:07  second\n2026-10-31 09:05:07  third\n');
    assert.equal(await tail(file, 40), '2026-10-31 09:05:07  third\n');
    assert.equal(await tail(join(dir, 'missing.log')), null);
    append(null, 'ignored'); // no file: nothing happens
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed job keeps the error’s detail and its log, and says which server run it belongs to', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bv-job-'));
  try {
    const job = startJob('track', 'track:test-1', async (j) => {
      j.logFile = join(dir, 'tracking.log');
      j.log('Preparing');
      throw Object.assign(new Error('Shuttle tracking failed: OSError: boom'), { detail: 'Last lines:\nOSError: boom' });
    });
    await settle(job);
    const view = jobView(getJob(job.id));
    assert.equal(view.status, 'failed');
    assert.equal(view.boot, BOOT);
    assert.equal(view.key, 'track:test-1');
    assert.equal(view.error, 'Shuttle tracking failed: OSError: boom');
    assert.equal(view.detail, 'Last lines:\nOSError: boom');
    assert.ok(view.endedAt >= view.startedAt);
    const log = await jobLog(getJob(job.id));
    assert.match(log, /Preparing\n/);
    assert.match(log, /FAILED after \d+ s\n.*Last lines:\n.*OSError: boom/s);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a job without a log file shows the lines kept in memory; a plain error’s detail is its stack', async () => {
  const job = startJob('scan', 'scan:test-2', async () => { throw new Error('nope'); });
  await settle(job);
  assert.match(job.detail, /^Error: nope\n\s+at /);
  assert.match(await jobLog(job), /FAILED after/);
});

test('tracker failures name the Python error and keep the end of the output, without progress bars', () => {
  const out = [
    'Using PyTorch device: cuda',
    'Video length: 11155',
    ' 40%|####      | 280/700 [01:02<01:45,  4.19it/s]',
    'Traceback (most recent call last):',
    '  File "predict.py", line 9, in <module>',
    "ModuleNotFoundError: No module named 'pycocotools'",
  ].join('\r\n');
  const f = trackFailure(out, 1, 'D:/out/tracking.log');
  assert.equal(f.message, "Shuttle tracking failed: ModuleNotFoundError: No module named 'pycocotools'");
  assert.match(f.detail, /^TrackNetV3 exited with code 1\.\nFull log: D:\/out\/tracking\.log\n/);
  assert.match(f.detail, /Traceback/);
  assert.doesNotMatch(f.detail, /it\/s/);
});

test('a tracker that dies without an error line is described by how it ended', () => {
  assert.equal(trackFailure('Video length: 100\n', null).message, 'Shuttle tracking failed: TrackNetV3 was ended by Windows or another program');
  assert.equal(trackFailure('', 3221225477).message, 'Shuttle tracking failed: TrackNetV3 exited with code 3221225477 (an access violation: the program crashed)');
});

test('the error box details list the request, the job and its log file', () => {
  const at = new Date(2026, 9, 31, 10, 7, 16).getTime();
  const text = errorDetails({
    detail: 'Last lines of its output:\nOSError: boom',
    request: 'GET /api/jobs/4',
    status: 500,
    code: 'server',
    job: { id: 4, key: 'track:249', startedAt: at - 60000, endedAt: at, logFile: 'D:\\x\\tracking.log' },
  }, at);
  assert.match(text, /^Last lines of its output:\nOSError: boom\n/);
  assert.match(text, /Request: GET \/api\/jobs\/4 → HTTP 500 \(server\)/);
  assert.match(text, /Job 4: track:249, started .*, ended .* \(60 s\)/);
  assert.match(text, /Log file: D:\\x\\tracking\.log/);
  assert.match(text, /Shown at /);
});
