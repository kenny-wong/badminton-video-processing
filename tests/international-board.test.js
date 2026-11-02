import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanBoard, cleanBoardOverride, resolveBoard, boardLayout } from '../public/shared/board.js';
import { COUNTRIES, cleanCountries, flagShapes } from '../public/shared/flags.js';
import { assScript } from '../lib/overlay.js';

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
    assert.ok(first.stretch>0 && first.stretch<=78);
  }
});

test('international score changes slide inside their own tile, beginning at the rally end', () => {
  const spans=[{from:0,to:2,state},{from:2,to:4,state:{...state,points:[0,1],server:'b'}}];
  const ass=assScript({width:1920,height:1080,teams:[['Amy Lee'],['Cat Ho']],style,spans});
  const motion=ass.split('\n').filter(l=>l.includes('\\move('));
  assert.equal(motion.length,2);
  assert.ok(motion.every(l=>l.includes('\\clip(') && l.includes('0:00:02.00')));
  assert.ok(motion.some(l=>l.includes('0:00:02.20') && l.endsWith('}0')));
  assert.ok(motion.some(l=>l.includes('0:00:04.00') && l.endsWith('}1')));
  assert.doesNotMatch(ass,/fscy0/);
  assert.ok(motion.every(l=>!l.includes('\\pos(')));
  assert.match(ass,/\\1c&H2E10C8&/); // Denmark's red is a drawing in the actual video.
  assert.match(ass,/\\1c&H2411CE&/); // England's red, independently chosen.
  const stopped=assScript({width:1920,height:1080,teams:[['Amy Lee'],['Cat Ho']],style,spans:[spans[0],{...spans[1],from:2.5}]});
  assert.doesNotMatch(stopped,/\\move\(/);
});
