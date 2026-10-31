// GET /api/overview: the home page's to-do lists (filmed matches by stage) and active jobs.
// GET /api/search?q=&only=video|tagged|uploaded: matches by player, tournament or event.

import { json } from '../lib/http.js';
import { overview, search } from '../lib/overview.js';
import { listJobs } from '../lib/jobs.js';

export function onRequestGet({ app }) {
  const active = listJobs().filter((j) => j.status === 'running' || j.status === 'queued').length;
  return json({ ...overview(app.db), activeJobs: active });
}

export function searchRoute({ request, app }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').slice(0, 100);
  const only = url.searchParams.get('only') ?? '';
  return json({ q, matches: q.trim() ? search(app.db, q, only) : [] });
}
