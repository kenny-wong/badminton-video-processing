// The people found in a match video (analysis/find_people.py: YOLO11 pose with
// ByteTrack, so each person keeps an id from frame to frame), with the players
// named. No DOM code here; the editor draws them, tests/people.test.js checks it.
//
// - Where: each person's feet go onto the marked court. The players are the
//   ones on the court, at most a team's worth per end, among the people whose
//   usual place (over all the frames they're seen in) is on the court, so an
//   umpire by the court never stands in for a player who isn't seen. Whoever
//   was named a moment ago keeps the name; then the one nearest that half's middle.
// - Which team: the team at that end at that moment, from the team at the near
//   end when the video starts and the score (ends change after each game and at
//   the deciding game's mid-point).
// - Which player: in singles there is only one. Doubles partners are told apart
//   by shirt colour: each tracked person's colour, split into two groups per
//   team, darker group first; "swap" puts the names the other way round.

import { apply, COURT } from './court.js';
import { endOf } from './score.js';

const MARGIN = 0.6; // metres outside the lines a player's feet may be in one frame
const USUAL_MARGIN = 0.4; // ... and where they usually are, over all the frames they're seen in
const NET = COURT.net;

/** Seconds of the video -> frame index (the last frame at or before t), or -1. */
export function frameAt(frames, t) {
  let lo = 0;
  let hi = frames.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The detections file as frames of people: { t (s of the video), people: [{ id, box, foot, colour, at }] },
 * `at` being the feet on the court in metres (null without a court).
 */
export function placePeople(data, toCourt) {
  const offset = data?.offset ?? 0;
  return (data?.frames ?? []).map(([t, list]) => ({
    t: Math.round((offset + t) * 1000) / 1000,
    people: list.map(([id, x1, y1, x2, y2, conf, fx, fy, colour]) => {
      const at = toCourt ? apply(toCourt, [fx, fy]) : null;
      return { id, box: [x1, y1, x2, y2], conf, foot: [fx, fy], colour, at: at && at.every(Number.isFinite) ? at : null };
    }),
  }));
}

/**
 * The team at the near end at each moment: [{ from, team }] in time order,
 * from the replayed rallies (`steps`, `initial` as from replay()) — a game
 * ending, or the deciding game reaching its mid-point, changes ends after
 * that rally.
 */
export function nearTeams({ rallies, steps, initial, rules, nearAtStart }) {
  const start = { games: initial?.games ?? [], points: initial?.points ?? [0, 0] };
  const near = (s) => (endOf('a', s, start, nearAtStart, rules) === 'near' ? 'a' : 'b');
  const out = [{ from: -Infinity, team: near(start) }];
  (steps ?? []).forEach((s, i) => {
    if (!s?.counted) return;
    const team = near(s.after);
    if (team !== out.at(-1).team) out.push({ from: rallies[i].end, team });
  });
  return out;
}

/** The team at the near end at time t. */
export const nearTeamAt = (timeline, t) => {
  let team = timeline[0]?.team ?? 'a';
  for (const x of timeline) if (x.from <= t) team = x.team;
  return team;
};

const onCourt = (p) => p.at && p.at[0] > -MARGIN && p.at[0] < COURT.width + MARGIN && p.at[1] > -MARGIN && p.at[1] < COURT.length + MARGIN;
const endOfPoint = (p) => (p.at[1] < NET ? 'near' : 'far');
const middleOf = (end) => [COURT.width / 2, end === 'near' ? NET / 2 : NET + (COURT.length - NET) / 2];

// Colour distance: lightness counts half (lighting changes across the court), the colour itself in full.
const colourGap = (p, q) => Math.hypot((p[0] - q[0]) / 2, p[1] - q[1], p[2] - q[2]);

/** Two groups of colours (each { colour, weight }): the index of each one's group, the darker group 0. */
export function twoGroups(items) {
  if (items.length < 2) return items.map(() => 0);
  // Start from the two most different colours, then a few rounds of k-means.
  let pair = [0, 1];
  let far = -1;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const d = colourGap(items[i].colour, items[j].colour);
      if (d > far) {
        far = d;
        pair = [i, j];
      }
    }
  }
  let centres = pair.map((k) => items[k].colour);
  let group = items.map(() => 0);
  for (let round = 0; round < 10; round++) {
    group = items.map((x) => (colourGap(x.colour, centres[0]) <= colourGap(x.colour, centres[1]) ? 0 : 1));
    centres = [0, 1].map((g) => {
      const members = items.filter((_, k) => group[k] === g);
      const weight = members.reduce((s, x) => s + x.weight, 0);
      if (!weight) return centres[g];
      return [0, 1, 2].map((c) => members.reduce((s, x) => s + x.colour[c] * x.weight, 0) / weight);
    });
  }
  return centres[0][0] <= centres[1][0] ? group : group.map((g) => 1 - g);
}

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * The players in each frame with their names: [{ t, players: [{ box, foot, at, team, name, id }] }].
 * `names` = { a: [...], b: [...] } (one or two each), `swap` = { a, b } to put a pair's names the other way round.
 */
export function namePlayers(frames, { timeline, names, swap = {} }) {
  const size = { a: Math.max(1, names.a?.length ?? 1), b: Math.max(1, names.b?.length ?? 1) };
  // Who can be a player at all: a followed person whose usual place (the median over all the
  // frames they're seen in) is on the court. An umpire or coach sitting by the court is seen
  // inside its edge now and then, when their feet are misplaced, but not usually.
  const places = new Map();
  for (const f of frames) {
    for (const p of f.people) {
      if (p.id === null || p.id === undefined || !p.at) continue;
      if (!places.has(p.id)) places.set(p.id, { xs: [], ys: [] });
      places.get(p.id).xs.push(p.at[0]);
      places.get(p.id).ys.push(p.at[1]);
    }
  }
  const usual = new Map([...places].map(([id, { xs, ys }]) => [id, [median(xs), median(ys)]]));
  const canPlay = (p) => {
    const at = usual.get(p.id);
    return Boolean(at) && at[0] > -USUAL_MARGIN && at[0] < COURT.width + USUAL_MARGIN && at[1] > -USUAL_MARGIN && at[1] < COURT.length + USUAL_MARGIN;
  };
  // Pick the players: on the court, at most a team's worth per end. Whoever was picked a moment
  // ago comes first, so a name stays on its person; then whoever is nearest the middle of that half.
  // When a player isn't seen, no one stands in for them.
  let before = new Set();
  let beforeT = -Infinity;
  const picked = frames.map((f) => {
    const nearTeam = nearTeamAt(timeline, f.t);
    const recent = f.t - beforeT <= 1 ? before : new Set();
    const players = [];
    for (const end of ['near', 'far']) {
      const team = end === 'near' ? nearTeam : nearTeam === 'a' ? 'b' : 'a';
      const mid = middleOf(end);
      const fromMid = (p) => Math.hypot(p.at[0] - mid[0], p.at[1] - mid[1]);
      f.people.filter((p) => onCourt(p) && canPlay(p) && endOfPoint(p) === end)
        .sort((p, q) => (recent.has(q.id) - recent.has(p.id)) || fromMid(p) - fromMid(q))
        .slice(0, size[team])
        .forEach((p) => players.push({ ...p, team }));
    }
    if (players.length) {
      before = new Set(players.map((p) => p.id));
      beforeT = f.t;
    }
    return { t: f.t, players };
  });
  // Doubles: each tracked person's shirt colour, per team, split into the two partners.
  const groupOf = {};
  for (const team of ['a', 'b']) {
    if (size[team] < 2) continue;
    const byTrack = new Map();
    for (const f of picked) {
      for (const p of f.players) {
        if (p.team !== team || p.id === null || p.id === undefined || !p.colour) continue;
        if (!byTrack.has(p.id)) byTrack.set(p.id, []);
        byTrack.get(p.id).push(p.colour);
      }
    }
    const items = [...byTrack].map(([id, cs]) => ({ id, weight: cs.length, colour: [0, 1, 2].map((c) => median(cs.map((x) => x[c]))) }));
    const groups = twoGroups(items);
    groupOf[team] = new Map(items.map((x, k) => [x.id, groups[k]]));
  }
  return picked.map((f) => ({
    t: f.t,
    players: f.players.map((p) => {
      const list = names[p.team] ?? [];
      let name = list[0] ?? p.team.toUpperCase();
      if (list.length >= 2) {
        const g = groupOf[p.team]?.get(p.id);
        name = g === undefined ? list.join(' / ') : list[(g + (swap[p.team] ? 1 : 0)) % 2];
      }
      return { id: p.id, box: p.box, foot: p.foot, at: p.at, team: p.team, name };
    }),
  }));
}
