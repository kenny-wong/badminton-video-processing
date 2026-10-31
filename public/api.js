// Calls to the app's own API.
//
// Errors carry what the page needs to explain them: `message` (one line),
// `detail` (more, for the Details section), `status`, `code`, `request`, and
// `job` when a background job failed (its log can then be shown).

const LOG_HINT = 'The server’s own log is data\\logs\\app.log in the Badminton Video folder.';

export async function api(path, { method = 'GET', body } = {}) {
  const request = `${method} ${path}`;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // fetch only throws when no answer came at all ("Failed to fetch").
    throw Object.assign(new Error('Couldn’t reach the app’s server: it has stopped, or is restarting.'), {
      code: 'offline', request,
      detail: `${request} got no answer (the browser said: ${err.message}).\nIf the app doesn’t come back in a few seconds, start it again (npm start) and reload this window.\n${LOG_HINT}`,
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${res.status}`), { code: data.error, status: res.status, request });
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OFFLINE_WAIT = 30000;

/** The job's error for the page: its message, plus the detail and the job (for its log). */
const jobError = (j, message = j.error || 'Failed') => Object.assign(new Error(message), { code: j.status, detail: j.detail, job: j });

/**
 * Polls a background job until it finishes, calling onUpdate(job) each time.
 * Rides out the server being unreachable for up to 30 s; if it comes back as
 * a different run (it restarted), the job is gone and that is what the error says.
 */
export async function waitJob(job, onUpdate = () => {}) {
  let j = job;
  let lostSince = null;
  onUpdate(j);
  while (j.status === 'running') {
    await sleep(lostSince ? 1500 : 600);
    let next;
    try {
      next = await api(`/api/jobs/${job.id}`);
    } catch (err) {
      if (err.code === 'offline') {
        lostSince ??= Date.now();
        if (Date.now() - lostSince > OFFLINE_WAIT) {
          throw Object.assign(err, { detail: `${err.detail}\nLost contact while “${j.message || job.kind}” was running (${Math.round(j.progress * 100)}% done).` });
        }
        onUpdate({ ...j, message: `Lost contact with the app’s server; trying again… (${Math.round((Date.now() - lostSince) / 1000)} s)` });
        continue;
      }
      if (err.status !== 404) throw err;
      next = null;
    }
    if (!next || next.boot !== job.boot || next.key !== job.key) {
      throw Object.assign(new Error('The app’s server restarted while this was running, so it stopped. Start it again.'), {
        code: 'restarted',
        detail: `Job ${job.id} (${job.key}) belonged to the previous run of the server and ended with it, at “${j.message || 'working'}” (${Math.round(j.progress * 100)}% done).\n`
          + 'This happens when the app window’s server is closed or restarted (for example after an update) during a long job.\n'
          + `${LOG_HINT} Look for “job ${job.id} ${job.key} started” with no “finished” after it.`,
      });
    }
    lostSince = null;
    j = next;
    onUpdate(j);
  }
  if (j.status === 'failed') throw jobError(j);
  if (j.status === 'stopped') throw Object.assign(jobError(j, 'Stopped'), { code: 'stopped' });
  return j.result;
}
