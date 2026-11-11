import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupLabels, labelGroupMatches } from '../lib/group-rounds.js';
import { matchFromRow, openDb } from '../lib/db.js';
import { addFavourite, setStarred } from '../lib/favourites.js';

const m = (id, round, time, teamA, teamB, draw = 'WD U15') => ({ id, draw, round, date: '2026-11-01', time, teamA, teamB });
const A = ['Amy Lee', 'Bea Ng'], B = ['Cat Ho', 'Dee Yu'], C = ['Eve Ko', 'Fay Li'], D = ['Gin Wu', 'Hal Ma'];

test('a group of four played Round 1, 3, 2 is numbered 1, 2, 3 by start time', () => {
  const labels = groupLabels([
    m(1, 'Round 1', '14:25', A, B), m(2, 'Round 1', '14:25', C, D),
    m(3, 'Round 3', '14:50', A, C), m(4, 'Round 3', '14:50', B, D),
    m(5, 'Round 2', '15:15', A, D), m(6, 'Round 2', '15:15', B, C),
  ]);
  assert.deepEqual([...labels], [[1, 'Group match 1'], [2, 'Group match 1'], [3, 'Group match 2'], [4, 'Group match 2'], [5, 'Group match 3'], [6, 'Group match 3']]);
});

test('a draw named Group already says Match k', () => {
  const labels = groupLabels([m(1, 'Round 2', '10:00', A, B, 'XD U15 - Group A'), m(2, 'Round 1', '10:30', A, C, 'XD U15 - Group A')]);
  assert.equal(labels.get(2), 'Match 2/1');
  assert.equal(groupLabels([m(1, 'Round 2', '10:00', A, B, 'XD U15 - Group A')]).get(1), 'Match 1');
});

test('knockout draws keep their own rounds', () => {
  const labels = groupLabels([
    m(1, 'Round of 16', '10:00', A, B, 'MS U15'), m(2, 'Quarter final', '11:00', A, C, 'MS U15'),
    m(3, 'Semi final', '12:00', A, D, 'GS U13'), m(4, 'Round 1', '09:00', B, C, 'GS U13'),
  ]);
  assert.equal(labels.size, 0);
});

test('a group of three: sides on different numbers take the starred side, else show both', () => {
  // A v B (both's 1st), A v C (A's 2nd, C's 1st), B v C (both's 2nd)
  const list = [m(1, 'Round 1', '10:00', A, B), m(2, 'Round 3', '10:30', A, C), m(3, 'Round 2', '11:00', B, C)];
  assert.deepEqual([...groupLabels(list)], [[1, 'Group match 1'], [2, 'Group match 2/1'], [3, 'Group match 2']]);
  assert.equal(groupLabels(list, (t) => t === C).get(2), 'Group match 1');
  assert.equal(groupLabels(list, (t) => t === A).get(2), 'Group match 2');
  assert.equal(groupLabels(list, () => true).get(2), 'Group match 2/1');
});

test('same time: the fixture order decides; a pair written the other way round is the same side', () => {
  const labels = groupLabels([m(1, 'Round 2', '10:00', A, B), m(2, 'Round 1', '10:00', [...A].reverse(), C)]);
  assert.equal(labels.get(2), 'Group match 1');
  assert.equal(labels.get(1), 'Group match 2/1');
});

test('labelGroupMatches writes the label on the match and its game rows; starring changes a split number', () => {
  const db = openDb(':memory:');
  const t = Number(db.prepare(`INSERT INTO tournaments (be_id, name, start_date, end_date) VALUES ('x', 'Test', '2026-11-01', '2026-11-01')`).run().lastInsertRowid);
  const add = (round, time, a, b) => Number(db.prepare(`INSERT INTO matches (tournament_id, match_date, match_time, draw, round, team_a, team_b) VALUES (?, '2026-11-01', ?, 'WD U15', ?, ?, ?)`)
    .run(t, time, round, JSON.stringify(a), JSON.stringify(b)).lastInsertRowid);
  const ab = add('Round 1', '10:00', A, B), ac = add('Round 3', '10:30', A, C), bc = add('Round 2', '11:00', B, C);
  const game = Number(db.prepare(`INSERT INTO matches (tournament_id, parent_id, game, match_date, match_time, draw, round, team_a, team_b)
    SELECT tournament_id, id, 2, match_date, match_time, draw, round, team_a, team_b FROM matches WHERE id = ?`).run(ac).lastInsertRowid);
  assert.ok(labelGroupMatches(db) >= 4);
  const round = (id) => matchFromRow(db.prepare('SELECT * FROM matches WHERE id = ?').get(id));
  assert.equal(round(ab).round, 'Group match 1');
  assert.equal(round(bc).round, 'Group match 2');
  assert.equal(round(ac).round, 'Group match 2/1');
  assert.equal(round(ac).beRound, 'Round 3');
  assert.equal(round(game).round, 'Group match 2/1');
  const key = addFavourite(db, { name: 'Eve Ko' });
  labelGroupMatches(db);
  assert.equal(round(ac).round, 'Group match 1');
  assert.equal(round(game).round, 'Group match 1');
  setStarred(db, key, false);
  labelGroupMatches(db);
  assert.equal(round(ac).round, 'Group match 2/1');
  assert.equal(labelGroupMatches(db), 0, 'nothing to change the second time');
});
