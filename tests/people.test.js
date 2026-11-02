import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, courtMapping } from '../public/shared/court.js';
import { frameAt, namePlayers, nearTeamAt, nearTeams, placePeople, twoGroups } from '../public/shared/people.js';
import { replay } from '../public/shared/score.js';

// A camera behind the near baseline: court metres <-> picture fractions.
const CORNERS = [[0.15, 0.9], [0.85, 0.9], [0.65, 0.35], [0.35, 0.35]];
const { toCourt, toPicture } = courtMapping(CORNERS);
const RED = [50, 60, 40];
const BLUE = [35, 10, -50];
const WHITE = [90, 0, 0];

/** A detection standing at court metres [x, y]: [id, box…, conf, foot x, foot y, colour]. */
function standing(id, [x, y], colour = WHITE) {
  const [fx, fy] = apply(toPicture, [x, y]);
  return [id, fx - 0.02, fy - 0.15, fx + 0.02, fy, 0.9, fx, fy, colour];
}

test('frames are found by time', () => {
  const frames = [{ t: 0 }, { t: 0.1 }, { t: 0.2 }];
  assert.equal(frameAt(frames, 0.15), 1);
  assert.equal(frameAt(frames, 5), 2);
  assert.equal(frameAt(frames, -1), -1);
});

test('people are placed on the court from their feet, with the file’s offset', () => {
  const [f] = placePeople({ offset: 30, frames: [[1.5, [standing(4, [2, 3])]]] }, toCourt);
  assert.equal(f.t, 31.5);
  assert.ok(Math.abs(f.people[0].at[0] - 2) < 1e-6 && Math.abs(f.people[0].at[1] - 3) < 1e-6);
  assert.equal(placePeople({ frames: [[0, [standing(1, [2, 3])]]] }, null)[0].people[0].at, null);
});

test('ends change after a game and at the deciding game’s mid-point', () => {
  const rules = { points: 11, setting: true, bestOf: 3 };
  const rallies = Array.from({ length: 11 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, winner: 'a' }));
  const { steps, initial } = replay(rallies, rules, 'a', null);
  const timeline = nearTeams({ rallies, steps, initial, rules, nearAtStart: 'a' });
  assert.deepEqual(timeline.map((x) => [x.from, x.team]), [[-Infinity, 'a'], [105, 'b']]); // after game 1
  assert.equal(nearTeamAt(timeline, 50), 'a');
  assert.equal(nearTeamAt(timeline, 200), 'b');
  // A deciding game filmed on its own: A at the near end until someone reaches 6.
  const third = Array.from({ length: 6 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, winner: 'b' }));
  const r3 = replay(third, rules, 'a', { games: [[11, 5], [5, 11]], points: [0, 0] }, { oneGame: true });
  const t3 = nearTeams({ rallies: third, steps: r3.steps, initial: r3.initial, rules, nearAtStart: 'a' });
  assert.deepEqual(t3.map((x) => [x.from, x.team]), [[-Infinity, 'a'], [55, 'b']]);
});

test('singles players are named by the end they stand at; people off the court aren’t', () => {
  const data = { frames: [[0, [standing(1, [3, 2]), standing(2, [3, 11]), standing(3, [8, 5]), standing(4, [3, 14.5])]]] };
  const timeline = [{ from: -Infinity, team: 'b' }];
  const [f] = namePlayers(placePeople(data, toCourt), { timeline, names: { a: ['Hayley Wong'], b: ['Saindhavi Hemanth'] } });
  assert.deepEqual(f.players.map((p) => [p.id, p.team, p.name]), [[1, 'b', 'Saindhavi Hemanth'], [2, 'a', 'Hayley Wong']]);
});

test('doubles partners are told apart by shirt colour, darker first, and can be swapped', () => {
  // Team A at the near end: a red shirt (lighter) and a blue one (darker), each followed over two frames.
  const frame = (t) => [t, [standing(1, [1.5, 4], RED), standing(2, [4.5, 1.5], BLUE), standing(3, [2, 10], WHITE), standing(4, [4, 9], WHITE), standing(9, [3, 0.5], RED)]];
  const frames = placePeople({ frames: [frame(0), frame(0.1)] }, toCourt);
  const opts = { timeline: [{ from: -Infinity, team: 'a' }], names: { a: ['Amy Dark', 'Ann Light'], b: ['Bea One', 'Bo Two'] } };
  const [f] = namePlayers(frames, opts);
  const nameOf = (id, list) => list.players.find((p) => p.id === id)?.name;
  assert.equal(nameOf(2, f), 'Amy Dark'); // blue: darker
  assert.equal(nameOf(1, f), 'Ann Light');
  assert.equal(f.players.filter((p) => p.team === 'a').length, 2); // a third person at that end isn't a player
  const [swapped] = namePlayers(frames, { ...opts, swap: { a: true } });
  assert.equal(nameOf(2, swapped), 'Ann Light');
});

test('two groups of colours: the darker group first', () => {
  const items = [{ colour: RED, weight: 5 }, { colour: [52, 58, 41], weight: 3 }, { colour: BLUE, weight: 4 }];
  assert.deepEqual(twoGroups(items), [1, 1, 0]);
  assert.deepEqual(twoGroups([{ colour: RED, weight: 1 }]), [0]);
});
