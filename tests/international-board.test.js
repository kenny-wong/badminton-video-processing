import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanBoard, cleanBoardOverride, resolveBoard, boardLayout, fontOf } from '../public/shared/board.js';
import { serveShuttle } from '../public/shared/international-board.js';
import { COUNTRIES, cleanCountries, flagShapes } from '../public/shared/flags.js';
import { assScript } from '../lib/overlay.js';
import { boardAt, replayMatch, startFor } from '../public/shared/score.js';

const style = resolveBoard(null, { preset: 'international', countries: ['DEN', 'ENG'] });
const state = { games: [], points: [0,0], won: [0,0], server: 'a' };
const names = ['LEE / MORGAN', 'CHEN / WILLIAMS'];

test('countries are explicit, validated team choices, preserved with the board override', () => {
  assert.deepEqual(cleanCountries(['den','ENG','JPN']), ['DEN','ENG']);
  assert.deepEqual(cleanCountries(['nonsense','<svg>']), ['','']);
  assert.deepEqual(cleanCountries(null), ['','']);
  assert.deepEqual(cleanBoardOverride({countries:['DEN','ENG']}), {countries:['DEN','ENG']});
  assert.deepEqual(cleanBoardOverride({countries:[]}), {countries:['','']});
  assert.deepEqual(style.countries, ['DEN','ENG']);
  assert.equal(cleanBoard({nationalFlags:false}).nationalFlags, false);
});

test('every selectable country produces finite vector shapes clipped to its flag panel', () => {
  for (const code of Object.keys(COUNTRIES)) {
    const items = flagShapes(code, 100, 200, 90, 60);
    assert.ok(items.length, code);
    for (const item of items) for (const [x,y] of item.points) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), code);
      assert.ok(x>=100 && x<=190 && y>=200 && y<=260, `${code}: ${x},${y}`);
    }
  }
  assert.deepEqual(flagShapes('unknown',0,0,90,60), []);
});

test('the international board matches the reference proportions and has separate shaded score tiles', () => {
  const l = boardLayout({ width:1920, height:1080, names, state, style });
  assert.equal(l.box.x, 80);
  assert.equal(l.box.y, 81);
  assert.ok(l.box.w / 1920 > 0.14 && l.box.w / 1920 < 0.19, String(l.box.w));
  assert.ok(l.box.h / 1080 > 0.075 && l.box.h / 1080 < 0.09, String(l.box.h));
  const points = l.items.filter(it=>it.cell);
  assert.deepEqual(points.map(it=>it.key), ['points0','points1']);
  assert.ok(l.items.some(it=>it.type==='rect' && it.opacity===0.16));
  assert.ok(l.items.some(it=>it.type==='poly' && it.colour==='#c8102e'));
  assert.ok(l.items.some(it=>it.type==='poly' && it.colour==='#ce1124'));
  const hidden = boardLayout({width:1920,height:1080,names,state,style:{...style,nationalFlags:false}});
  assert.ok(!hidden.items.some(it=>it.colour==='#ce1124'));
  assert.ok(hidden.box.w < l.box.w);
});

test('all corners, long doubles names, earlier games and portrait video keep the board inside the picture', () => {
  for(const [width,height] of [[1920,1080],[1080,1920],[360,640],[3840,2160]]) for(const corner of ['tl','tr','bl','br']) {
    const l=boardLayout({width,height,names:['AMY RICHARDSON / BETH MACDONALD','CARA WILLIAMS / DANA MONTGOMERY'],state:{...state,games:[[21,15],[18,21]],points:[10,9]},style:{...style,corner}});
    assert.ok(l.box.x>=0 && l.box.y>=0 && l.box.x+l.box.w<=width && l.box.y+l.box.h<=height, JSON.stringify(l.box));
    const first=l.items.find(it=>it.text==='AMY RICHARDSON / BETH MACDONALD');
    assert.ok(first.stretch>0 && first.stretch<=100); // D-DIN Condensed as drawn, squeezed only to fit
  }
});

test('international score changes slide inside their own tile, beginning at the rally end', () => {
  const spans=[{from:0,to:2,state},{from:2,to:4,state:{...state,points:[0,1],server:'b'}}];
  const ass=assScript({width:1920,height:1080,teams:[['Amy Lee'],['Cat Ho']],style,spans});
  const lines=ass.split('\n');
  const motion=lines.filter(l=>l.includes('\\move('));
  const move=(l)=>l.match(/\\move\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/).slice(1).map(Number);
  const cell=boardLayout({width:1920,height:1080,names:['AMY LEE','CAT HO'],state,style}).items.find(it=>it.key==='points1').cell;
  // As on the broadcast: the old number slides right half a tile at a steady speed (one straight move) for
  // 0.2 s and stays there half out of its tile until 0.24 s ...
  const out=motion.filter(l=>l.endsWith('}0'));
  assert.deepEqual(out.map(l=>l.split(',').slice(1,3).join('-')),['0:00:02.00-0:00:02.24']);
  const [ox0,oy0,ox1,oy1,ot0,ot1]=move(out[0]);
  assert.deepEqual([ox1-ox0,oy1-oy0,ot0,ot1],[Math.round(cell.w/2),0,0,200]);
  // ... and from 0.2 s the new one slides in from half a tile to the left, at the same speed, done at 0.4 s.
  const into=motion.filter(l=>l.endsWith('}1'));
  assert.deepEqual(into.map(l=>l.split(',').slice(1,3).join('-')),['0:00:02.20-0:00:04.00']);
  const [ix0,iy0,ix1,iy1,it0,it1]=move(into[0]);
  assert.deepEqual([ix1-ix0,iy1-iy0,it0,it1,ix1],[Math.round(cell.w/2),0,0,200,ox0]);
  // Cut off at the tile's left edge and, as on the broadcast, a little before its right edge.
  assert.ok(motion.every(l=>l.includes(`\\clip(${cell.x},${cell.y},${cell.x+Math.round(cell.w*0.918)},${cell.y+cell.h})`) && !l.includes('\\pos(')));
  assert.ok(!lines.some(l=>l.includes(',Text,') && l.includes('\\fscy0'))); // no vertical flip on this board's numbers
  // The serve marker leaves A's row at once and grows in on B's from 0.04 s through the broadcast's sizes, 40 ms apart.
  const grow='\\fscx0\\fscy0\\t(0,40,\\fscx30\\fscy30)\\t(40,80,\\fscx64\\fscy64)\\t(80,120,\\fscx89\\fscy89)\\t(120,160,\\fscx100\\fscy100)';
  assert.equal(lines.filter(l=>l.includes(grow) && l.includes('0:00:02.04,0:00:04.00')).length,3); // skirt, its base and the cork
  assert.match(ass,/\\1c&H2E10C8&/); // Denmark's red is a drawing in the actual video.
  assert.match(ass,/\\1c&H2411CE&/); // England's red, independently chosen.
  const stopped=assScript({width:1920,height:1080,teams:[['Amy Lee'],['Cat Ho']],style,spans:[spans[0],{...spans[1],from:2.5}]});
  assert.doesNotMatch(stopped,/\\move\(/);
  // A span too short for the whole change just shows the new score.
  const quick=assScript({width:1920,height:1080,teams:[['Amy Lee'],['Cat Ho']],style,spans:[spans[0],{...spans[1],to:2.3}]});
  assert.doesNotMatch(quick,/\\move\(|fscx0\\fscy0/);
});

test('game two shows the first game in pale tiles beside equally sized current scores', () => {
  const match = { game:2, games:[[21,14],[15,21]], startScore:{points:[15,16]}, firstServer:'b', rallies:[{start:1,end:3,winner:'b'}] };
  const {steps,initial} = replayMatch(match);
  assert.deepEqual(startFor(match).games, [[21,14]]);
  const shown = boardAt(match.rallies, steps, 4, initial);
  const layout = boardLayout({width:1920,height:1080,names,state:shown,style});
  const number = (key) => layout.items.find(it=>it.key===key);
  assert.deepEqual(['game0-0','points0','game0-1','points1'].map(key=>number(key).text), ['21','15','14','17']);
  for(const row of [0,1]) {
    const previous = number(`game0-${row}`), current = number(`points${row}`);
    assert.equal(previous.size, current.size);
    assert.equal(previous.stretch, current.stretch);
    assert.equal(previous.colour, style.text);
    assert.equal(current.colour, style.pointsText);
    assert.equal(previous.y, current.y);
    assert.equal(current.x - previous.x, current.cell.w);
    assert.equal(previous.flip, false);
    assert.ok(layout.items.some(it=>it.type==='rect' && it.colour==='#e9e3dd' && it.w===current.cell.w && it.x+it.w===current.cell.x));
  }
  assert.equal(shown.server,'b');
  const span = {from:0,to:5,state:shown};
  const ass = assScript({width:1920,height:1080,teams:[['Amy Lee'],['Cat Ho']],style,spans:[span]});
  assert.match(ass,/\\1c&HDDE3E9&/);
});

test('the final score of a game-two video keeps the earlier game once and the final game in brown', () => {
  const match = {game:2,games:[[21,14],[15,21]],startScore:{points:[15,20]},firstServer:'b',rallies:[{start:1,end:2,winner:'b'}]};
  const {steps,initial} = replayMatch(match);
  const shown = boardAt(match.rallies,steps,3,initial);
  assert.equal(shown.final,true);
  const items=boardLayout({width:1920,height:1080,names,state:shown,style}).items;
  assert.deepEqual(items.filter(it=>it.key?.startsWith('game')).map(it=>it.text), ['21','14']);
  assert.deepEqual(items.filter(it=>it.cell).map(it=>it.text), ['15','21']);
});

test('the serve marker is the broadcast’s shuttle: tilted 52.8°, its proportions and colours as traced', () => {
  const R = 100;
  const [skirt, base, cork] = serveShuttle(500, 300, R, '#965038');
  assert.deepEqual([skirt.colour, base.colour, cork.colour], ['#a76c58', '#844631', '#5f4339']); // traced: #a46852, #84533d, #5c4039
  // Measured along and across the shuttle: in row heights, 0.486 long, the skirt 0.22 then 0.36 wide, the cork 0.164.
  const a = -52.8 * Math.PI / 180, along = ([x, y]) => (x - 500) * Math.cos(a) + (y - 300) * Math.sin(a), across = ([x, y]) => -(x - 500) * Math.sin(a) + (y - 300) * Math.cos(a);
  const all = [skirt, cork].flatMap((p) => p.points);
  const span = (pts, f) => Math.max(...pts.map(f)) - Math.min(...pts.map(f));
  assert.ok(Math.abs(span(all, along) - 0.486 * R) < 0.5, String(span(all, along)));
  assert.ok(Math.abs(span(skirt.points, across) - 0.36 * R) < 0.5);
  assert.ok(Math.abs(span(cork.points, across) - 0.164 * R) < 0.5);
  assert.ok(Math.abs(Math.min(...skirt.points.map(along)) - Math.max(...cork.points.map(along)) - 0.073 * R) < 0.5); // the gap
  assert.ok(cork.points.length > 10); // a round end, not a diamond
  // In the board: its middle 0.45 rows left of the score tiles, 0.02 rows below the row's middle, on the server's row.
  const style = resolveBoard(null, { preset: 'international', countries: ['DEN', 'ENG'] });
  const l = boardLayout({ width: 1920, height: 1080, names: ['AMY LEE', 'CAT HO'], state: { games: [], points: [3, 4], won: [0, 0], server: 'b' }, style });
  const tile = l.items.find((it) => it.key === 'points1').cell;
  const marker = l.items.filter((it) => it.serve);
  assert.equal(marker.length, 3);
  const [cx, cy] = marker[0].centre;
  assert.ok(Math.abs(tile.x - cx - 0.45 * (tile.h + 1)) < 1 && Math.abs(cy - (tile.y + (tile.h + 1) / 2) - 0.02 * (tile.h + 1)) < 1, JSON.stringify([cx, cy, tile]));
  const name = l.items.find((it) => it.text === 'CAT HO');
  assert.ok(Math.max(...marker.flatMap((p) => p.points).map(([x]) => x)) < tile.x && Math.min(...marker.flatMap((p) => p.points).map(([x]) => x)) > name.x);
});

test('lettering as on the broadcast: name capitals 0.479 of a row, figures 0.596, D-DIN Condensed slightly thickened, never squeezed', () => {
  const style = resolveBoard(null, { preset: 'international' });
  const l = boardLayout({ width: 1920, height: 1080, names: ['AMY LEE', 'CAT HO'], state: { games: [], points: [3, 4], won: [0, 0], server: 'a' }, style });
  const font = fontOf(style.font);
  const row = l.items.find((it) => it.key === 'points0').cell.h + 1;
  const name = l.items.find((it) => it.text === 'AMY LEE');
  const figure = l.items.find((it) => it.key === 'points0');
  assert.ok(Math.abs(name.size * font.cap / row - 0.479) < 0.02 && Math.abs(figure.size * font.cap / row - 0.596) < 0.02, JSON.stringify([name.size, figure.size, row]));
  assert.deepEqual([name.stretch, figure.stretch, name.bold], [100, 100, false]);
  assert.ok(name.embolden > 0 && figure.embolden > name.embolden);
});

