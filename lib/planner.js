// Sending YouTube links to the enrolment planner (a website of the user's): each match's links are
// kept there by a key both sides can work out, since BE gives matches no id: the tournament's
// badminfo id, the draw's number and the players' badminfo ids. The key comes from badminfo's
// tournament JSON, where the match is found by its players (and its score when they met twice);
// a match that isn't exactly one of badminfo's is never guessed.
//
// The connection is a code made in the planner (its address and a token), kept in planner.json in
// the data folder. Links go by themselves after anything changes (`changed()`), and each match is
// sent only when its links differ from what was last sent (planner_links).

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { apiUrl, getJson } from './badminfo.js';
import { nowIso, parseJson } from './db.js';

const TIMEOUT_MS = 15_000;
const BATCH = 100; // matches in one call (the planner takes 200)
const RETRY_MS = 3600_000; // a match badminfo doesn't have yet is looked for again after this
const DEBOUNCE_MS = 3000;

// ---------- The connection ----------

const fileOf = (dir) => join(dir, 'planner.json');

/** The planner's address and token from a pasted code (https://…/#video-app=bv_…), or null. Plain http only for this PC. */
export function parseCode(code) {
  let url;
  try {
    url = new URL(String(code ?? '').trim());
  } catch {
    return null;
  }
  const here = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(here && url.protocol === 'http:')) return null;
  if (url.username || url.password) return null;
  const token = /^#video-app=(bv_[A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
  return token ? { origin: url.origin, token } : null;
}

/** { origin, token, account }, or null when not connected. */
export function connection(dir) {
  if (!dir || !existsSync(fileOf(dir))) return null;
  const c = parseJson(readFileSync(fileOf(dir), 'utf8'), null);
  return c?.origin && c?.token ? c : null;
}

/** A refusal in words for people, with a code the page can tell apart. */
function refusal(status, host) {
  const [code, message] = status === 401 ? ['badCode', `${host} doesn’t accept the code any more: make a new one there and paste it here`]
    : status === 404 ? ['noStrategy', `That account on ${host} doesn’t have the Strategy tab, which shows the videos`]
      : status === 429 ? ['tooMany', `${host} says too many tries: wait a minute`]
        : ['planner', `${host} answered with an error (${status})`];
  return Object.assign(new Error(message), { code });
}

async function call({ origin, token }, { method = 'GET', body } = {}) {
  const { host } = new URL(origin);
  let res;
  try {
    res = await fetch(`${origin}/api/video-links`, {
      method, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error(`Couldn’t reach ${host}`), { code: 'offline' });
  }
  if (!res.ok) throw refusal(res.status, host);
  return res.json();
}

/** Connects with a pasted code, once the planner has accepted it. Everything is sent again. */
export async function connect(app, code) {
  const parsed = parseCode(code);
  if (!parsed) throw Object.assign(new Error('That isn’t a code from the planner: it starts with https:// and has #video-app= in it'), { code: 'badCode' });
  const { account } = await call(parsed);
  const before = connection(app.dataDir);
  await mkdir(app.dataDir, { recursive: true });
  await writeFile(fileOf(app.dataDir), JSON.stringify({ ...parsed, account: String(account ?? '').slice(0, 80) }, null, 2));
  // Another account starts from nothing; the same one still has to hear what was taken off meanwhile.
  if (before && before.origin === parsed.origin && before.account === account) app.db.exec("UPDATE planner_links SET payload = ''");
  else app.db.exec('DELETE FROM planner_links');
  looked.delete(app.db);
  return connection(app.dataDir);
}

export async function disconnect(app) {
  await rm(fileOf(app.dataDir), { force: true });
  state.error = null;
  state.problems = [];
}

// ---------- Which match is which ----------

const nameKey = (v) => String(v ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim();
const teamKey = (names) => names.map(nameKey).sort().join('|');
const isGroup = (match) => /\bgroup\b/i.test(match.draw) || /^round \d+$/i.test(match.round);

/**
 * The planner's key of a match in badminfo's tournament JSON: { key }, or { reason }:
 * 'notFound' (badminfo doesn't have it), 'several' (more than one fits) or 'noIds' (a player has no
 * badminfo id). `match` has draw, round, teams (two lists of names) and games.
 */
export function matchKey(json, badminfoId, match) {
  const t = json?.beTournament;
  if (!t || !Array.isArray(t.events)) return { reason: 'notFound' };
  const people = new Map((t.players ?? []).map((p) => [p?.index, { id: p?.id, name: p?.playerEntryName }]));
  const [a, b] = match.teams.map(teamKey);
  let found = [];
  for (const draw of t.events.flatMap((e) => e?.draws ?? [])) {
    for (const r of draw?.rubbers ?? []) {
      const sides = [r?.team1PlayerIndexes, r?.team2PlayerIndexes].map((x) => (Array.isArray(x) ? x : []).map((n) => people.get(n)));
      if (!Number.isInteger(draw.index) || sides.some((s) => !s.length || s.some((p) => !p))) continue;
      const [x, y] = sides.map((s) => teamKey(s.map((p) => p.name)));
      if (!((x === a && y === b) || (x === b && y === a))) continue;
      const games = (r.games ?? []).map((g) => (x === a ? [g?.team1Score, g?.team2Score] : [g?.team2Score, g?.team1Score]));
      found.push({ draw: draw.index, group: draw.type === 'Round Robin', sides, games });
    }
  }
  // Met twice (a group, then the knockout): the score says which, else the kind of draw.
  const narrow = (test) => { const left = found.filter(test); if (found.length > 1 && left.length) found = left; };
  if (match.games.length) narrow((f) => JSON.stringify(f.games) === JSON.stringify(match.games));
  narrow((f) => f.group === isGroup(match));
  if (!found.length) return { reason: 'notFound' };
  if (new Set(found.map((f) => f.draw)).size > 1) return { reason: 'several' };
  const ids = found[0].sides.flat().map((p) => String(p.id ?? '').toLowerCase());
  if (ids.some((id) => !/^[0-9a-f-]{36}$/.test(id)) || new Set(ids).size !== ids.length || ![2, 4].includes(ids.length)) return { reason: 'noIds' };
  return { key: [badminfoId.toLowerCase(), found[0].draw, ...ids.sort()].join('|') };
}

/** Every match with a YouTube link, its games' links gathered: [{ id, badminfoId, label, draw, round, teams, games, payload }]. */
export function linkedMatches(db) {
  const links = new Map();
  for (const r of db.prepare('SELECT COALESCE(parent_id, id) AS id, game, youtube_url AS url FROM matches WHERE youtube_url IS NOT NULL ORDER BY game').all()) {
    const l = links.get(r.id) ?? { video: '', games: {} };
    if (r.game) l.games[r.game] = r.url;
    else l.video = r.url;
    links.set(r.id, l);
  }
  const one = db.prepare('SELECT m.*, t.badminfo_id, t.name AS tournament FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE m.id = ?');
  return [...links].map(([id, l]) => {
    const r = one.get(id);
    const teams = [parseJson(r.team_a, []), parseJson(r.team_b, [])];
    return { id, badminfoId: r.badminfo_id, draw: r.draw, round: r.round, teams, games: parseJson(r.games, []), payload: JSON.stringify(l),
      label: `${teams.map((x) => x.join(' / ')).join(' v ')}, ${r.draw}, ${r.tournament}` };
  });
}

// ---------- Sending ----------

const state = { at: null, error: null, problems: [] }; // of the last send, for Settings
const looked = new WeakMap(); // database -> match id -> { at, reason } of a match that couldn't be told
const lookedIn = (db) => looked.get(db) ?? looked.set(db, new Map()).get(db);
let running = null;
let timer = null;

export const REASONS = {
  notFound: 'badminfo doesn’t have this match yet (looked for again every hour)',
  several: 'the same players met more than once, and it isn’t clear which match this is',
  noIds: 'a player in it has no badminfo profile',
  custom: 'a tournament made by hand isn’t on badminfo',
  unavailable: 'badminfo didn’t answer (tried again every hour)',
  refused: 'the planner didn’t take its links',
};

async function send(app, { all }) {
  const { db } = app;
  const conn = connection(app.dataDir);
  if (!conn) return;
  const sent = new Map(db.prepare('SELECT * FROM planner_links').all().map((r) => [r.match_id, r]));
  const matches = linkedMatches(db);
  const lookedFor = lookedIn(db);
  const tournaments = new Map(); // badminfo id -> its JSON, or null when badminfo didn't answer
  const problems = [];
  const keys = new Map(); // match id -> key
  for (const m of matches) {
    const had = sent.get(m.id)?.be_key;
    if (had && !all) { keys.set(m.id, had); continue; }
    const problem = (reason) => { if (had && reason === 'unavailable') keys.set(m.id, had); else problems.push({ matchId: m.id, label: m.label, reason }); };
    if (!m.badminfoId) { problem('custom'); continue; }
    if (!all && Date.now() - (lookedFor.get(m.id)?.at ?? 0) < RETRY_MS) { problem(lookedFor.get(m.id).reason); continue; }
    if (!tournaments.has(m.badminfoId)) tournaments.set(m.badminfoId, (await getJson(apiUrl(m.badminfoId))).json ?? null);
    const json = tournaments.get(m.badminfoId);
    const got = json ? matchKey(json, m.badminfoId, m) : { reason: 'unavailable' };
    if (got.key) { keys.set(m.id, got.key); lookedFor.delete(m.id); continue; }
    lookedFor.set(m.id, { at: Date.now(), reason: got.reason });
    problem(got.reason);
  }
  // What changed: links to send, and keys whose match has none any more (or turned out to be another).
  const todo = matches.filter((m) => keys.has(m.id) && (all || sent.get(m.id)?.payload !== m.payload || sent.get(m.id)?.be_key !== keys.get(m.id)));
  const inUse = new Set(keys.values());
  const kept = new Set(matches.map((m) => m.id));
  const gone = [...sent.values()].filter((r) => (kept.has(r.match_id) ? keys.has(r.match_id) && keys.get(r.match_id) !== r.be_key : true) && !inUse.has(r.be_key));
  const items = [...todo.map((m) => ({ key: keys.get(m.id), ...JSON.parse(m.payload) })), ...gone.map((r) => ({ key: r.be_key, video: '', games: {} }))];
  const refused = new Set();
  for (let i = 0; i < items.length; i += BATCH) {
    const answer = await call(conn, { method: 'POST', body: { links: items.slice(i, i + BATCH) } });
    for (const key of answer.refused ?? []) refused.add(key);
  }
  const put = db.prepare(`INSERT INTO planner_links (match_id, be_key, payload, sent_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (match_id) DO UPDATE SET be_key = excluded.be_key, payload = excluded.payload, sent_at = excluded.sent_at`);
  for (const r of sent.values()) if (!kept.has(r.match_id)) db.prepare('DELETE FROM planner_links WHERE match_id = ?').run(r.match_id);
  for (const m of todo) {
    if (refused.has(keys.get(m.id))) problems.push({ matchId: m.id, label: m.label, reason: 'refused' });
    else put.run(m.id, keys.get(m.id), m.payload, nowIso());
  }
  if (items.length) {
    state.at = nowIso();
    console.log(`Planner: links of ${todo.length - refused.size} match(es) sent${gone.length ? `, ${gone.length} taken off` : ''}`);
  }
  state.problems = problems;
}

/** Sends what changed (`all`: everything, looked up afresh). One at a time; throws when the planner can't be told. */
export async function sendLinks(app, { all = false } = {}) {
  while (running) await running.catch(() => {});
  running = send(app, { all });
  try {
    await running;
    state.error = null;
  } catch (err) {
    state.error = err.message;
    console.error('Planner:', err.message);
    throw err;
  } finally {
    running = null;
  }
}

/** Something may have changed a link: sends what did, a few seconds later. Nothing happens unless connected. */
export function changed(app) {
  if (!connection(app.dataDir)) return;
  clearTimeout(timer);
  timer = setTimeout(() => sendLinks(app).catch(() => {}), DEBOUNCE_MS);
  timer.unref?.();
}

/** At start and every hour: links that couldn't be sent, and matches badminfo didn't have, are tried again. */
export function keepSending(app) {
  changed(app);
  setInterval(() => changed(app), RETRY_MS + 60_000).unref();
}

/** The connection and how it stands, for Settings. Never the token. */
export function status(app) {
  const conn = connection(app.dataDir);
  if (!conn) return { connected: false };
  const rows = app.db.prepare("SELECT payload FROM planner_links WHERE payload <> ''").all().map((r) => parseJson(r.payload, {}));
  const links = rows.reduce((n, l) => n + (l.video ? 1 : 0) + Object.keys(l.games ?? {}).length, 0);
  return { connected: true, host: new URL(conn.origin).host, account: conn.account, matches: rows.length, links, at: state.at, error: state.error,
    problems: state.problems.map((p) => ({ matchId: p.matchId, label: p.label, why: REASONS[p.reason] ?? p.reason })) };
}
