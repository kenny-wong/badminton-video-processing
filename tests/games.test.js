import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createApp } from '../server.js';
import { matchFromRow, openDb } from '../lib/db.js';
import { saveTournament } from '../lib/tournaments.js';
import { parseMatches } from '../lib/schedule.js';
import { outputPath, videoTitle } from '../lib/naming.js';
import { replayMatch, startFor } from '../public/shared/score.js';
import { PAGE } from './fixtures/be-pages.js';

const fetched = () => ({ beId: 'b997c3c5-38fb-4caf-a402-009664189ad6', badminfoId: null, name: 'Example', start: '2026-10-24', end: '2026-10-24', matches: parseMatches(PAGE, '20261024') });

/** Rallies that win one game for `side` to `points`-`other`. */
const gameRallies = (side, other = 0, points = 21, from = 0) => {
  const lose = side === 'a' ? 'b' : 'a';
  return [...Array(other).fill(lose), ...Array(points).fill(side)].map((w, i) => ({ start: from + i * 10, end: from + i * 10 + 5, winner: w }));
};

test('a game’s video starts after the earlier games and ends with its own game', () => {
  const match = { game: 2, games: [[19, 21], [21, 15], [12, 21]], startScore: null, firstServer: 'a', rallies: [...gameRallies('a', 15), { start: 900, end: 905, winner: 'b' }] };
  assert.deepEqual(startFor(match), { games: [[19, 21]], points: [0, 0] });
  assert.deepEqual(startFor({ ...match, startScore: { games: [], points: [4, 2] } }), { games: [[19, 21]], points: [4, 2] });
  const out = replayMatch(match, { points: 21, setting: true, bestOf: 3 });
  assert.deepEqual(out.games, [[19, 21], [21, 15]]);
  assert.equal(out.winner, 'a');
  assert.equal(out.steps.at(-1).reason, 'afterMatch'); // a rally after the game ended counts for nothing
  // The whole match keeps going into game 3.
  assert.equal(replayMatch({ ...match, game: 0 }, { points: 21, setting: true, bestOf: 3 }).steps.at(-1).counted, true);
});

test('a game’s title and file name say which game', () => {
  const m = { date: '2026-10-24', time: '09:00', draw: 'OS U15', round: 'Final', teamA: ['Eli Ma'], teamB: ["Fin O'Neil"], game: 2 };
  assert.equal(videoTitle({ tournament: { name: 'Example' }, match: m, games: [[19, 21], [21, 15], [12, 21]] }), "Example · OS U15 Final Game 2 · Eli Ma v Fin O'Neil · 21-15");
  assert.equal(outputPath({ tournament: { name: 'Example', start: '2026-10-24' }, match: m })[2], "0900 OS U15 Final - Ma v O'Neil - Game 2.mp4");
});

test('re-importing keeps game rows and brings their time and result up to date', () => {
  const db = openDb();
  const tid = saveTournament(db, fetched());
  const parent = db.prepare("SELECT id FROM matches WHERE draw = 'OS U15 - Group B'").get().id;
  db.prepare(`INSERT INTO matches (tournament_id, parent_id, game, match_date, match_time, draw, round, team_a, team_b, games, rallies)
    SELECT tournament_id, id, 2, match_date, match_time, draw, round, team_a, team_b, games, '[{"start":1,"end":2,"winner":"a"}]' FROM matches WHERE id = ?`).run(parent);
  const again = fetched();
  again.matches[1] = { ...again.matches[1], time: '10:15', games: [[19, 21], [21, 16], [12, 21]] };
  saveTournament(db, again);
  const g = matchFromRow(db.prepare('SELECT * FROM matches WHERE parent_id = ? AND game = 2').get(parent));
  assert.deepEqual([g.time, g.games[1], g.rallies.length], ['10:15', [21, 16], 1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE tournament_id = ? AND game = 0').get(tid).n, 3);
});

test('an untagged game row has the winner of the game before serving first, following the result', () => {
  const db = openDb();
  const tid = saveTournament(db, fetched());
  const parent = db.prepare("SELECT id FROM matches WHERE draw = 'OS U15 - Group B'").get().id; // 19-21 21-15 12-21
  const addGame = (game, rallies = '[]', server = 'a') => db.prepare(`INSERT INTO matches (tournament_id, parent_id, game, match_date, match_time, draw, round, team_a, team_b, games, rallies, first_server)
    SELECT tournament_id, id, ?, match_date, match_time, draw, round, team_a, team_b, games, ?, ? FROM matches WHERE id = ?`).run(game, rallies, server, parent);
  addGame(2, '[]', 'a');
  addGame(3, '[{"start":1,"end":2,"winner":"a"}]', 'b');
  const servers = () => db.prepare('SELECT game, first_server AS s FROM matches WHERE parent_id = ? ORDER BY game').all(parent).map((r) => r.s);
  // The migration's SQL puts the untagged game 2 right (B won game 1); tagged game 3 keeps the user's choice.
  db.exec(readFileSync(new URL('../migrations/0021_winner_serves.sql', import.meta.url), 'utf8'));
  assert.deepEqual(servers(), ['b', 'b']);
  // A changed result moves the untagged game's server with it.
  const again = fetched();
  again.matches[1] = { ...again.matches[1], games: [[21, 19], [21, 15]] };
  saveTournament(db, again);
  assert.equal(tid, saveTournament(db, again));
  assert.deepEqual(servers(), ['a', 'b']);
});

test('setting the near end on one game’s video sets the other games’ (ends change each game)', async () => {
  const app = { db: openDb(), port: 0 };
  const server = createApp(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  app.port = server.address().port;
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, { method, headers: { Origin: base }, body: body && JSON.stringify(body) });
    assert.equal(res.status, 200, `${method} ${path}`);
    return res.json();
  };
  try {
    saveTournament(app.db, fetched());
    const m = app.db.prepare("SELECT id FROM matches WHERE draw = 'OS U15 - Group B'").get().id; // three games
    app.db.prepare(`INSERT INTO videos (path, size, modified_at, recorded_at, duration) VALUES ('C:/v/1.mp4', 1, 'x', '2026-10-24T08:05:00Z', 600),
      ('C:/v/2.mp4', 1, 'x', '2026-10-24T08:20:00Z', 600), ('C:/v/3.mp4', 1, 'x', '2026-10-24T08:35:00Z', 600)`).run();
    await call(`/api/matches/${m}/games/1/videos`, 'PUT', { videoIds: [1] });
    await call(`/api/matches/${m}/games/2/videos`, 'PUT', { videoIds: [2] });
    const near = () => app.db.prepare('SELECT near_at_start AS n FROM matches WHERE parent_id = ? ORDER BY game').all(m).map((r) => r.n);
    assert.deepEqual(near(), [null, null]);
    const [g1, g2] = app.db.prepare('SELECT id FROM matches WHERE parent_id = ? ORDER BY game').all(m).map((r) => r.id);
    await call(`/api/matches/${g2}`, 'PUT', { nearAtStart: 'a' });
    assert.deepEqual(near(), ['b', 'a']);
    // A game linked later takes it too; changing game 1 moves the others.
    await call(`/api/matches/${m}/games/3/videos`, 'PUT', { videoIds: [3] });
    assert.deepEqual(near(), ['b', 'a', 'b']);
    await call(`/api/matches/${g1}`, 'PUT', { nearAtStart: 'a' });
    assert.deepEqual(near(), ['a', 'b', 'a']);
    // A game 3 video starting after the change of ends at 11: that game began with the ends the other way.
    const g3 = app.db.prepare('SELECT id FROM matches WHERE parent_id = ? AND game = 3').get(m).id;
    await call(`/api/matches/${g3}`, 'PUT', { startScore: { points: [11, 6] } });
    await call(`/api/matches/${g3}`, 'PUT', { nearAtStart: 'b' });
    assert.deepEqual(near(), ['a', 'b', 'b']);
    await call(`/api/matches/${g3}`, 'PUT', { nearAtStart: 'a' });
    assert.deepEqual(near(), ['b', 'a', 'a']);
    // Saving again without a change (the editor's autosave) moves nothing.
    app.db.prepare('UPDATE matches SET near_at_start = ? WHERE id = ?').run('a', g1);
    await call(`/api/matches/${g3}`, 'PUT', { nearAtStart: 'a', rallies: [] });
    assert.deepEqual(near(), ['a', 'a', 'a']);
  } finally {
    server.close();
  }
});

test('who serves first must be chosen (games 2 and 3 know it from the result); until then the video is not tagged', async () => {
  const app = { db: openDb(), port: 0 };
  const server = createApp(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  app.port = server.address().port;
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (path, method = 'GET', body) => (await fetch(base + path, { method, headers: { Origin: base }, body: body && JSON.stringify(body) })).json();
  try {
    saveTournament(app.db, fetched());
    const m = app.db.prepare("SELECT id FROM matches WHERE draw = 'OS U15 - Group B'").get().id; // 19-21 21-15 12-21
    app.db.prepare(`INSERT INTO videos (path, size, modified_at, recorded_at, duration) VALUES ('C:/v/1.mp4', 1, 'x', '2026-10-24T08:05:00Z', 600), ('C:/v/2.mp4', 1, 'x', '2026-10-24T08:20:00Z', 600)`).run();
    await call(`/api/matches/${m}/games/1/videos`, 'PUT', { videoIds: [1] });
    await call(`/api/matches/${m}/games/2/videos`, 'PUT', { videoIds: [2] });
    const [g1, g2] = app.db.prepare('SELECT id FROM matches WHERE parent_id = ? ORDER BY game').all(m).map((r) => r.id);
    const set = (id) => app.db.prepare('SELECT server_set, first_server FROM matches WHERE id = ?').get(id);
    assert.deepEqual([set(g1).server_set, set(g2).server_set, set(g2).first_server], [null, 1, 'b']); // game 1: the toss; game 2: B won game 1
    // Saving rallies (the editor's autosave) without a first server leaves it unchosen: not tagged.
    await call(`/api/matches/${g1}`, 'PUT', { rallies: gameRallies('b', 19) });
    let t = await call(`/api/tournaments/${app.db.prepare('SELECT tournament_id FROM matches WHERE id = ?').get(m).tournament_id}`);
    let unit = t.matches.find((x) => x.id === m).units.find((u) => u.game === 1);
    assert.deepEqual([unit.rallyCount, unit.tagged, unit.serverSet], [40, 40, false]);
    await call(`/api/matches/${g1}`, 'PUT', { firstServer: 'a' });
    assert.equal(set(g1).server_set, 1);
    t = await call(`/api/tournaments/${app.db.prepare('SELECT tournament_id FROM matches WHERE id = ?').get(m).tournament_id}`);
    unit = t.matches.find((x) => x.id === m).units.find((u) => u.game === 1);
    assert.equal(unit.serverSet, true);
    // Unlinking clears it with the rest of the tagging (it goes with the video's carried tagging).
    await call(`/api/matches/${g1}/videos`, 'PUT', { videoIds: [] });
    assert.equal(set(g1).server_set, null);
    assert.equal(JSON.parse(app.db.prepare('SELECT carried_tagging FROM videos WHERE id = 1').get().carried_tagging).server_set, 1);
  } finally {
    server.close();
  }
});

test('linking a video to one game gives that game its own row and status', async () => {
  const app = { db: openDb(), port: 0 };
  const server = createApp(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  app.port = server.address().port;
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, { method, headers: { Origin: base }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const tid = saveTournament(app.db, fetched());
    app.db.prepare(`INSERT INTO videos (path, size, modified_at, recorded_at, duration) VALUES ('C:/v/g1.mp4', 1, 'x', '2026-10-24T08:05:00Z', 600), ('C:/v/g2.mp4', 1, 'x', '2026-10-24T08:20:00Z', 600)`).run();
    let t = (await call(`/api/tournaments/${tid}`)).body;
    const m = t.matches.find((x) => x.draw === 'OS U15 - Group B');
    assert.deepEqual(m.units.map((u) => [u.id, u.game]), [[null, 1], [null, 2], [null, 3]]);
    assert.equal(t.matches.find((x) => x.draw === 'XD U15 - Group A').units.length, 1); // one game: no per-game rows

    assert.equal((await call(`/api/matches/${m.id}/games/1/videos`, 'PUT', { videoIds: [1] })).status, 200);
    assert.equal((await call(`/api/matches/${m.id}/games/2/videos`, 'PUT', { videoIds: [2] })).status, 200);
    t = (await call(`/api/tournaments/${tid}`)).body;
    const units = t.matches.find((x) => x.id === m.id).units;
    assert.deepEqual(units.map((u) => u.videoIds), [[1], [2], []]);
    const [g1, g2] = units;
    assert.deepEqual([g1.thumb, g2.thumb], [`/media/thumb/${g1.id}`, `/media/thumb/${g2.id}`]);
    // B serves first in game 2 unless changed; the editor can move between the match and its games.
    assert.deepEqual([g1.firstServer, g2.firstServer], ['a', 'b']);
    assert.deepEqual((await call(`/api/matches/${g2.id}`)).body.units, [
      { id: m.id, game: 0, linked: false }, { id: g1.id, game: 1, linked: true }, { id: g2.id, game: 2, linked: true }]);
    assert.deepEqual((await call(`/api/matches/${m.id}`)).body.units.map((u) => u.id), [m.id, g1.id, g2.id]);
    assert.equal(t.tournaments, undefined);
    assert.equal((await call('/api/tournaments')).body.tournaments[0].matches, 3); // game rows aren't extra matches
    assert.equal((await call('/api/tournaments')).body.tournaments[0].filmed, 1);

    // Each game is tagged and checked on its own: game 2 is 21-15 to A.
    await call(`/api/matches/${g2.id}`, 'PUT', { rallies: gameRallies('a', 15) });
    t = (await call(`/api/tournaments/${tid}`)).body;
    const tagged = t.matches.find((x) => x.id === m.id).units;
    assert.deepEqual([tagged[0].rallyCount, tagged[1].rallyCount, tagged[1].check.ok], [0, 36, true]);
    const g2view = (await call(`/api/matches/${g2.id}`)).body;
    assert.match(g2view.output.title, /Game 2 · Eli Ma v Fin O'Neil · 21-15$/);
    // Its start score can only change the points; earlier games stay the official ones.
    const s = await call(`/api/matches/${g2.id}`, 'PUT', { startScore: { games: [[1, 21]], points: [3, 1] } });
    assert.deepEqual(s.body.startScore, { games: [[19, 21]], points: [3, 1] });

    // Unlinking game 1 clears only game 1.
    await call(`/api/matches/${g1.id}`, 'PUT', { rallies: gameRallies('b', 19) });
    await call(`/api/matches/${g1.id}/videos`, 'PUT', { videoIds: [] });
    const after = (await call(`/api/tournaments/${tid}`)).body.matches.find((x) => x.id === m.id).units;
    assert.deepEqual([after[0].videoIds, after[0].rallyCount, after[1].rallyCount], [[], 0, 36]);
    assert.equal((await call(`/api/matches/${m.id}/games/9/videos`, 'PUT', { videoIds: [1] })).status, 404);
    // Unlinking game 2 puts its first server back to B.
    await call(`/api/matches/${g2.id}`, 'PUT', { firstServer: 'a' });
    await call(`/api/matches/${g2.id}/videos`, 'PUT', { videoIds: [] });
    assert.equal((await call(`/api/matches/${g2.id}`)).body.match.firstServer, 'b');
  } finally {
    server.close();
  }
});
