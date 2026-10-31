// GET /api/reels?tournamentId=&playerId=&player=: how many filmed matches and ★ rallies a reel would have.
// POST /api/reels { tournamentId?, playerId?, player? }: queues a highlight reel of the ★ rallies of a
//   tournament's filmed matches, or a player's (in a tournament, or all their filmed matches).

import { fail, json, readJson } from '../lib/http.js';
import { reelUnits, renderReel } from '../lib/reel.js';
import { readSettings } from '../lib/settings.js';
import { findTools } from '../lib/ffmpeg.js';
import { jobView, startJob } from '../lib/jobs.js';
import { safeName } from '../lib/naming.js';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The reel asked for: which matches, its title, file and job key; or an error message. */
function choose(db, q) {
  const tournamentId = Number.isInteger(Number(q.tournamentId)) && Number(q.tournamentId) > 0 ? Number(q.tournamentId) : null;
  const playerId = GUID.test(String(q.playerId ?? '')) ? String(q.playerId) : null;
  const playerName = typeof q.player === 'string' && q.player.trim() ? q.player.trim().slice(0, 80) : null;
  const t = tournamentId && db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (tournamentId && !t) return { error: 'No such tournament' };
  if (!t && !playerId && !playerName) return { error: 'Choose a tournament or a player' };
  const player = playerId ? db.prepare('SELECT name FROM players WHERE id = ?').get(playerId)?.name ?? playerName : playerName;
  const units = reelUnits(db, { tournamentId, playerId, playerName: playerId ? null : playerName });
  const favourites = units.reduce((n, m) => n + m.rallies.filter((r) => r.fav).length, 0);
  const dates = units.map((m) => m.date).filter(Boolean);
  const title = t ? `${t.name} highlights${player ? ` · ${player}` : ''}` : `${player} highlights${dates.length ? ` ${dates[0]} to ${dates.at(-1)}` : ''}`;
  const file = t
    ? [(t.start_date ?? '').slice(0, 4) || 'undated', safeName(`${t.start_date ?? ''} ${t.name}`), `${safeName(`Highlights${player ? ` - ${player}` : ''}`)}.mp4`]
    : ['Highlights', `${safeName(title, 120)}.mp4`];
  return { units, favourites, title, file, key: `${t ? `t${t.id}` : 'all'}-${playerId ?? playerName ?? 'everyone'}` };
}

export function onRequestGet({ request, app }) {
  const r = choose(app.db, Object.fromEntries(new URL(request.url).searchParams));
  if (r.error) return fail(400, 'badInput', r.error);
  return json({ matches: r.units.length, favourites: r.favourites, title: r.title });
}

export async function onRequestPost({ request, app }) {
  const body = (await readJson(request)) ?? {};
  const r = choose(app.db, body);
  if (r.error) return fail(400, 'badInput', r.error);
  if (!r.units.length) return fail(400, 'noFavourites', 'No filmed match here has ★ rallies yet. Mark favourites (H) in the editor first.');
  const settings = readSettings(app.db);
  const tools = findTools(settings.ffmpegFolder);
  if (!tools) return fail(503, 'noFfmpeg', 'FFmpeg wasn’t found. Install it (winget install Gyan.FFmpeg) or set its folder in Settings.');
  const job = startJob('reel', `reel:${r.key}`, (j, signal) => renderReel(app.db, tools, settings, r, { signal, job: j }), { queue: 'gpu', label: `Highlight reel: ${r.title}` });
  return json(jobView(job), 202);
}
