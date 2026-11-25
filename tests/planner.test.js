import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../lib/db.js';
import { connect, connection, disconnect, linkedMatches, matchKey, parseCode, sendLinks, status } from '../lib/planner.js';
import { onRequestPost, send as sendRoute } from '../api/planner.js';

const T = '99999999-9999-4999-8999-999999999999';
const id = (n) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const CODE = `https://planner.test/#video-app=bv_${'a'.repeat(43)}`;
const NAMES = ['Amy Sample', 'Zoé Example', 'Mia Madeup', 'Ivy Invented', 'Nell Noprofile'];
const rubber = (a, b, games = []) => ({ team1PlayerIndexes: a, team2PlayerIndexes: b, games: games.map(([x, y]) => ({ team1Score: x, team2Score: y })) });
const JSON_T = { beTournament: {
  players: NAMES.map((name, i) => ({ index: i + 1, id: i === 4 ? null : id(i + 1), playerEntryName: name })),
  events: [
    { name: 'WS U15', draws: [
      { index: 6, name: 'Group A', type: 'Round Robin', rubbers: [rubber([2], [1], [[15, 10], [15, 8]]), rubber([1], [3], [[15, 1], [15, 2]]), rubber([1], [5])] },
      { index: 7, name: 'WS U15', type: 'Elimination', rubbers: [rubber([1], [2], [[15, 12], [9, 15], [15, 13]])] }] },
    { name: 'WD U15', draws: [{ index: 9, name: 'WD U15', type: 'Round Robin', rubbers: [rubber([1, 3], [4, 2], [[15, 4], [15, 5]])] }] },
  ] } };
const match = (teams, extra = {}) => ({ draw: 'WS U15 - Group A', round: 'Round 1', games: [], teams, ...extra });
const key = (draw, ...n) => [T, draw, ...n.map(id).sort()].join('|');

test('a code holds the planner’s address and token; plain http only on this PC', () => {
  assert.deepEqual(parseCode(`  ${CODE} `), { origin: 'https://planner.test', token: `bv_${'a'.repeat(43)}` });
  assert.equal(parseCode(CODE.replace('https://planner.test', 'http://localhost:8793')).origin, 'http://localhost:8793');
  for (const bad of ['', null, 'bv_abc', CODE.replace('https', 'http'), CODE.replace('#video-app', '#k'), `${CODE}x`, CODE.replace('https://', 'https://a:b@'), CODE.replace('https', 'ftp')]) assert.equal(parseCode(bad), null, String(bad));
});

test('a match is found in badminfo by its players, whichever way round, with or without accents', () => {
  const who = (...n) => n.map((i) => ({ id: id(i), name: NAMES[i - 1] }));
  assert.deepEqual(matchKey(JSON_T, T, match([['Amy Sample'], ['Mia Madeup']])), { key: key(6, 1, 3), sides: [who(1), who(3)] });
  assert.deepEqual(matchKey(JSON_T, T, match([['MIA  MADEUP'], ['Amy Sample']])), { key: key(6, 1, 3), sides: [who(3), who(1)] }, 'the sides follow the match, not badminfo');
  assert.deepEqual(matchKey(JSON_T, T, match([['Zoe Example', 'Ivy Invented'], ['Mia Madeup', 'Amy Sample']], { draw: 'WD U15' })), { key: key(9, 1, 2, 3, 4), sides: [who(4, 2), who(1, 3)] });
});

test('players who met twice: the score says which match, else the kind of draw; never a guess', () => {
  const two = [['Amy Sample'], ['Zoé Example']];
  assert.equal(matchKey(JSON_T, T, match(two, { games: [[10, 15], [8, 15]] })).key, key(6, 1, 2), 'the score, turned round');
  assert.equal(matchKey(JSON_T, T, match(two, { draw: 'WS U15', round: 'Final', games: [[15, 12], [9, 15], [15, 13]] })).key, key(7, 1, 2));
  assert.equal(matchKey(JSON_T, T, match(two)).key, key(6, 1, 2), 'no score yet: a group match');
  assert.equal(matchKey(JSON_T, T, match(two, { draw: 'WS U15', round: 'Final' })).key, key(7, 1, 2), 'no score yet: the knockout');
  const unclear = structuredClone(JSON_T);
  unclear.beTournament.events[0].draws[1].type = 'Round Robin';
  assert.deepEqual(matchKey(unclear, T, match(two)), { reason: 'several' });
});

test('a match that can’t be told is said so', () => {
  assert.deepEqual(matchKey(JSON_T, T, match([['Amy Sample'], ['Ivy Invented']])), { reason: 'notFound' });
  assert.deepEqual(matchKey(JSON_T, T, match([['Amy Sample'], ['Nell Noprofile']])), { reason: 'noIds' });
  assert.deepEqual(matchKey(null, T, match([['Amy Sample'], ['Mia Madeup']])), { reason: 'notFound' });
});

/** A database with one tournament; `add` puts a match in it and returns its id. */
function setUp() {
  const db = openDb();
  db.prepare("INSERT INTO tournaments (id, be_id, badminfo_id, name) VALUES (1, 'be', ?, 'Example')").run(T);
  const add = (a, b, { draw = 'WS U15 - Group A', round = 'Round 1', games = [], parent = null, game = 0, url = null, tid = 1 } = {}) =>
    Number(db.prepare('INSERT INTO matches (tournament_id, match_date, match_time, draw, round, team_a, team_b, games, parent_id, game, youtube_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(tid, '2026-11-01', '09:00', draw, round, JSON.stringify(a), JSON.stringify(b), JSON.stringify(games), parent, game, url).lastInsertRowid);
  return { db, add, app: { db, dataDir: mkdtempSync(join(tmpdir(), 'planner-')) } };
}

/** A pretend planner and badminfo in place of fetch. `world.status` is what the planner answers with. */
function pretend(t, { account = 'Kim' } = {}) {
  const world = { info: new Map(), links: new Map(), posts: 0, badminfo: 0, status: 200, json: JSON_T, auth: null, refuse: [], account };
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('https://badstats.')) {
      world.badminfo += 1;
      return world.json ? Response.json(world.json) : new Response('', { status: 500 });
    }
    assert.equal(String(url), 'https://planner.test/api/video-links');
    world.auth = opts.headers.Authorization;
    if (world.status === 'down') throw new TypeError('fetch failed');
    if (world.status !== 200) return Response.json({ error: 'x' }, { status: world.status });
    if (!opts.method || opts.method === 'GET') return Response.json({ account: world.account, links: world.links.size });
    world.posts += 1;
    const { links } = JSON.parse(opts.body);
    for (const { key: k, video, games, info } of links) {
      if (world.refuse.includes(k)) continue;
      world.info.set(k, info);
      if (video || Object.keys(games).length) world.links.set(k, { video, games });
      else world.links.delete(k);
    }
    return Response.json({ saved: links.length, removed: 0, refused: links.map((l) => l.key).filter((k) => world.refuse.includes(k)) });
  };
  return world;
}

const post = (body) => new Request('http://127.0.0.1/api/planner', { method: 'POST', body: JSON.stringify(body) });

test('a match’s link and its games’ links go together', () => {
  const { db, add } = setUp();
  const m = add(['Amy Sample'], ['Mia Madeup'], { url: 'https://youtu.be/whole' });
  add(['Amy Sample'], ['Mia Madeup'], { parent: m, game: 2, url: 'https://youtu.be/two' });
  add(['Amy Sample'], ['Ivy Invented']);
  assert.deepEqual(linkedMatches(db).map((x) => [x.id, x.badminfoId, x.links, x.about]), [[m, T, { video: 'https://youtu.be/whole', games: { 2: 'https://youtu.be/two' } }, { event: 'WS U15 - Group A', round: 'Round 1', date: '2026-11-01', time: '09:00', score: [] }]]);
});

test('connecting sends every link; afterwards only what changed goes, and a link taken off is taken off there', async (t) => {
  const { db, add, app } = setUp();
  const world = pretend(t);
  const m = add(['Amy Sample'], ['Mia Madeup']);
  const g1 = add(['Amy Sample'], ['Mia Madeup'], { parent: m, game: 1, url: 'https://youtu.be/one' });
  const d = add(['Amy Sample', 'Mia Madeup'], ['Ivy Invented', 'Zoe Example'], { draw: 'WD U15', url: 'https://youtu.be/dbl' });
  const odd = add(['Amy Sample'], ['Ivy Invented'], { url: 'https://youtu.be/odd' });
  const res = await (await onRequestPost({ request: post({ code: CODE }), app })).json();
  assert.equal(world.auth, `Bearer bv_${'a'.repeat(43)}`);
  assert.deepEqual(Object.fromEntries(world.links), { [key(6, 1, 3)]: { video: '', games: { 1: 'https://youtu.be/one' } }, [key(9, 1, 2, 3, 4)]: { video: 'https://youtu.be/dbl', games: {} } });
  assert.deepEqual([res.connected, res.host, res.account, res.matches, res.links, res.error], [true, 'planner.test', 'Kim', 2, 2, null]);
  assert.deepEqual(res.problems.map((p) => [p.matchId, /badminfo doesn’t have/.test(p.why)]), [[odd, true]]);
  assert.ok(!JSON.stringify(res).includes('bv_'), 'the token stays here');
  assert.equal(world.badminfo, 1, 'badminfo is asked once for a tournament');

  await sendLinks(app);
  assert.deepEqual([world.posts, world.badminfo], [1, 1], 'nothing changed: nobody is asked');
  db.prepare("UPDATE matches SET youtube_url = 'https://youtu.be/again' WHERE id = ?").run(g1);
  await sendLinks(app);
  assert.deepEqual([world.posts, world.badminfo, world.links.get(key(6, 1, 3)).games], [2, 1, { 1: 'https://youtu.be/again' }]);
  db.prepare('UPDATE matches SET youtube_url = NULL WHERE id = ?').run(d);
  await sendLinks(app);
  assert.deepEqual([...world.links.keys()], [key(6, 1, 3)]);
  db.prepare('DELETE FROM matches WHERE id IN (?, ?)').run(m, g1);
  await sendLinks(app);
  assert.equal(world.links.size, 0, 'a deleted match’s links go too');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM planner_links').get().n, 0);
});

test('what can’t be sent is kept for the next try', async (t) => {
  const { db, add, app } = setUp();
  const world = pretend(t);
  const m = add(['Amy Sample'], ['Mia Madeup'], { url: 'https://youtu.be/a' });
  await connect(app, CODE);
  world.status = 'down';
  await assert.rejects(sendLinks(app), /Couldn’t reach planner\.test/);
  assert.match(status(app).error, /Couldn’t reach/);
  world.status = 200;
  await sendLinks(app);
  assert.deepEqual([status(app).error, world.links.size], [null, 1]);
  // Taking a link off while the planner is away: still taken off later.
  db.prepare('UPDATE matches SET youtube_url = NULL WHERE id = ?').run(m);
  world.status = 500;
  await assert.rejects(sendLinks(app), /answered with an error \(500\)/);
  assert.equal(world.links.size, 1);
  world.status = 200;
  await sendLinks(app);
  assert.equal(world.links.size, 0);
  // badminfo away on Send all: the key known before is used.
  db.prepare("UPDATE matches SET youtube_url = 'https://youtu.be/b' WHERE id = ?").run(m);
  await sendLinks(app, { all: true });
  world.json = null;
  world.links.clear();
  await sendLinks(app, { all: true });
  assert.deepEqual([world.links.size, status(app).problems.length], [1, 0]);
});

test('a refused match is said so and tried again', async (t) => {
  const { add, app } = setUp();
  const world = pretend(t);
  add(['Amy Sample'], ['Mia Madeup'], { url: 'https://youtu.be/a' });
  world.refuse = [key(6, 1, 3)];
  await connect(app, CODE);
  await sendLinks(app);
  assert.match(status(app).problems[0].why, /didn’t take/);
  world.refuse = [];
  await sendLinks(app);
  assert.deepEqual([world.links.size, status(app).problems.length], [1, 0]);
});

test('a match of a tournament made by hand is said to have no key', async (t) => {
  const { db, add, app } = setUp();
  pretend(t);
  db.exec("INSERT INTO tournaments (id, kind, name) VALUES (2, 'custom', 'Club night')");
  add(['Amy Sample'], ['Mia Madeup'], { tid: 2, url: 'https://youtu.be/a' });
  await connect(app, CODE);
  await sendLinks(app);
  assert.match(status(app).problems[0].why, /made by hand/);
});

test('a wrong code connects nothing; another account starts again, the same one is sent everything', async (t) => {
  const { db, add, app } = setUp();
  const world = pretend(t);
  add(['Amy Sample'], ['Mia Madeup'], { url: 'https://youtu.be/a' });
  assert.equal((await onRequestPost({ request: post({ code: 'nonsense' }), app })).status, 400);
  world.status = 401;
  assert.equal((await onRequestPost({ request: post({ code: CODE }), app })).status, 400);
  world.status = 404;
  assert.equal((await (await onRequestPost({ request: post({ code: CODE }), app })).json()).error, 'noStrategy');
  assert.equal(connection(app.dataDir), null);
  assert.equal((await sendRoute({ app })).status, 409);
  await sendLinks(app); // not connected: nothing happens
  world.status = 200;
  await connect(app, CODE);
  await sendLinks(app);
  await connect(app, CODE);
  assert.equal(db.prepare('SELECT payload FROM planner_links').get().payload, '', 'to be sent again');
  world.account = 'Lee';
  await connect(app, CODE);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM planner_links').get().n, 0);
  assert.match(readFileSync(join(app.dataDir, 'planner.json'), 'utf8'), /"account": "Lee"/);
  await disconnect(app);
  assert.deepEqual(status(app), { connected: false });
});

test('with the links go who played, marked when they are on the Players list, and what the match was', async (t) => {
  const { db, add, app } = setUp();
  const world = pretend(t);
  db.prepare("INSERT INTO favourites (name, player_id, starred) VALUES ('Amy Sample', ?, 1), ('Zoe Example', NULL, 1), ('Mia Madeup', ?, 0)").run(id(1), id(3));
  const m = add(['Mia Madeup', 'Amy Sample'], ['Zoe Example', 'Ivy Invented'], { draw: 'WD U15', round: 'Round 2', games: [[15, 4], [15, 5]], url: 'https://youtu.be/dbl' });
  db.prepare("UPDATE matches SET round_label = 'Group match 1', match_time = '14:25' WHERE id = ?").run(m);
  await connect(app, CODE);
  await sendLinks(app);
  assert.deepEqual(world.info.get(key(9, 1, 2, 3, 4)), {
    sides: [[{ id: id(1), name: 'Amy Sample', mine: true }, { id: id(3), name: 'Mia Madeup' }], [{ id: id(4), name: 'Ivy Invented' }, { id: id(2), name: 'Zoé Example', mine: true }]],
    event: 'WD U15', round: 'Group match 1', date: '2026-11-01', time: '14:25', score: [[15, 4], [15, 5]],
  });
  // A result that comes in later is sent; badminfo isn't asked again for it.
  db.prepare("UPDATE matches SET games = '[[15,4],[15,6]]' WHERE id = ?").run(m);
  await sendLinks(app);
  assert.deepEqual([world.posts, world.badminfo, world.info.get(key(9, 1, 2, 3, 4)).score], [2, 1, [[15, 4], [15, 6]]]);
});

test('links sent by an earlier version are sent again with who played', async (t) => {
  const { db, add, app } = setUp();
  const world = pretend(t);
  const m = add(['Amy Sample'], ['Mia Madeup'], { url: 'https://youtu.be/a' });
  await connect(app, CODE);
  db.prepare("INSERT INTO planner_links (match_id, be_key, payload, sent_at) VALUES (?, ?, ?, 'x')").run(m, key(6, 1, 3), JSON.stringify({ video: 'https://youtu.be/a', games: {} }));
  await sendLinks(app);
  assert.deepEqual([world.posts, world.badminfo, world.info.get(key(6, 1, 3)).sides[0][0].name], [1, 1, 'Amy Sample']);
  assert.ok(db.prepare('SELECT sides FROM planner_links').get().sides);
});
