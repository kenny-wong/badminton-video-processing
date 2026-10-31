import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clipArgs, courtMiddle, cropCommands, cropPath, uprightCrop } from '../lib/clip.js';
import { baseIndex, reelUnits } from '../lib/reel.js';
import { openDb } from '../lib/db.js';
import { saveEntrants } from '../lib/players.js';

test('uprightCrop is 9:16 of the full height, and nothing for upright videos', () => {
  assert.deepEqual(uprightCrop(1920, 1080), { w: 608, h: 1080 });
  assert.deepEqual(uprightCrop(3840, 2160), { w: 1216, h: 2160 });
  assert.equal(uprightCrop(1080, 1920), null);
  assert.equal(courtMiddle([[0.2, 0.9], [0.8, 0.9], [0.7, 0.3], [0.3, 0.3]]), 0.5);
  assert.equal(courtMiddle(null), 0.5);
});

test('cropPath eases towards the shuttle, holds when it is lost and stays inside the picture', () => {
  const points = [{ t: 10, x: 0.6 }, { t: 10.2, x: 0.62 }, { t: 10.4, x: 0.65 }];
  const path = cropPath(points, { start: 10, end: 12, width: 1920, cropW: 608, fallback: 0.5 });
  assert.equal(path.length, 11);
  assert.equal(path[0].t, 10);
  assert.ok(path.every((p) => p.x >= 0 && p.x <= 1920 - 608));
  assert.equal(path[0].x, Math.round(0.62 * 1920 - 304)); // starts on the shuttle, not swung in from the fallback
  assert.equal(path.at(-1).x, path.at(-2).x); // lost: held
  const none = cropPath([], { start: 0, end: 1, width: 1920, cropW: 608, fallback: 0.25 });
  assert.ok(none.every((p) => p.x === 176));
  assert.equal(cropCommands([{ t: 0, x: 10 }, { t: 0.2, x: 12 }]), '0 crop x 10;\n0.2 crop x 12;\n');
});

test('clipArgs crops along the path, draws the board and shrinks only when asked', () => {
  const a = clipArgs({ src: 'm.mp4', start: 30, end: 42, out: 'c.mp4', crop: { w: 608, h: 1080 }, startX: 500, encoder: 'h264_nvenc' });
  assert.equal(a[a.indexOf('-vf') + 1], 'setpts=PTS+30/TB,sendcmd=f=clip.cmd,crop=608:1080:500:0,ass=clip.ass,setpts=PTS-STARTPTS,format=yuv420p');
  const wide = clipArgs({ src: 'm.mp4', start: 0, end: 5, out: 'c.mp4', overlay: false });
  assert.equal(wide[wide.indexOf('-vf') + 1], 'setpts=PTS+0/TB,setpts=PTS-STARTPTS,format=yuv420p');
  const big = clipArgs({ src: 'm.mp4', start: 0, end: 5, out: 'c.mp4', crop: { w: 1216, h: 2160 }, upright: { w: 1080, h: 1920 } });
  assert.match(big[big.indexOf('-vf') + 1], /scale=1080:1920,setsar=1,format=yuv420p$/);
});

test('a reel takes the filmed matches with favourites: all of a tournament’s, or one player’s', () => {
  const db = openDb();
  db.prepare("INSERT INTO tournaments (be_id, name, start_date, end_date) VALUES ('b1', 'Example Open', '2026-10-24', '2026-10-24'), ('b2', 'Second Open', '2026-11-01', '2026-11-01')").run();
  const fav = JSON.stringify([{ start: 1, end: 2, winner: 'a', fav: true }]);
  const add = (t, time, a, b, rallies) => {
    const id = db.prepare(`INSERT INTO matches (tournament_id, match_date, match_time, draw, round, team_a, team_b, rallies) VALUES (?, ?, ?, 'WS', 'R1', ?, ?, ?)`)
      .run(t, t === 1 ? '2026-10-24' : '2026-11-01', time, JSON.stringify([a]), JSON.stringify([b]), rallies).lastInsertRowid;
    db.prepare(`INSERT INTO videos (path, size, modified_at, match_id) VALUES (?, 1, 'x', ?)`).run(`C:/v/${id}.mp4`, id);
    return id;
  };
  add(1, '10:00', 'Amy Lee', 'Cat Ho', fav);
  add(1, '09:00', 'Ben Ng', 'Dee Wu', fav);
  add(1, '11:00', 'Amy Lee', 'Eve Ma', '[]'); // no favourites
  add(2, '09:00', 'Fay Yu', 'Amy Lee', fav);
  assert.deepEqual(reelUnits(db, { tournamentId: 1 }).map((m) => m.teamA[0]), ['Ben Ng', 'Amy Lee']);
  assert.deepEqual(reelUnits(db, { playerName: 'Amy Lee' }).map((m) => m.tournamentId), [1, 2]);
  const id = '00000000-0000-0000-0000-000000000001';
  saveEntrants(db, 2, [{ id, name: 'Amy Lee', grades: {}, ratings: {}, ratingsDate: null }]);
  assert.deepEqual(reelUnits(db, { playerId: id }).map((m) => m.tournamentId), [2]); // only where the draws tie the name to her
});

test('a reel takes the shape most of its videos have, landscape on a tie', () => {
  const up = { width: 1080, height: 1920 };
  const flat = { width: 1920, height: 1080 };
  assert.equal(baseIndex([up, flat]), 1);
  assert.equal(baseIndex([up, flat, up]), 0);
  assert.equal(baseIndex([flat, up, up]), 1);
  assert.equal(baseIndex([flat]), 0);
});
