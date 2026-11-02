import assert from 'node:assert/strict';
import { test } from 'node:test';

import { courtDisplay, courtLabel, parseCourt, shortVenues } from '../public/shared/venues.js';

test('court numbers in the usual forms read "Court n"; others stay as given', () => {
  for (const t of ['3', '03', 'Ct3', 'ct 3', 'C3', 'Court 3', 'Crt3']) assert.equal(courtLabel(t), 'Court 3', t);
  assert.equal(courtLabel('CtA'), 'Court A');
  for (const t of ['JA-1', 'UoW-01', 'Main hall', 'Show court']) assert.equal(courtLabel(t), t);
});

test('a court name splits into venue and court at its last " - "', () => {
  assert.deepEqual(parseCourt('Winchester House School Sports Centre - 3'), { venue: 'Winchester House School Sports Centre', court: 'Court 3' });
  assert.deepEqual(parseCourt('University of Warwick - UoW-01'), { venue: 'University of Warwick', court: 'UoW-01' });
  assert.deepEqual(parseCourt('Middlesex Dome'), { venue: 'Middlesex Dome', court: null });
  assert.deepEqual(parseCourt('Court 2'), { venue: null, court: 'Court 2' });
  assert.deepEqual(parseCourt('3'), { venue: null, court: '3' });
  assert.deepEqual(parseCourt('Hall 2, Court 3'), { venue: 'Hall 2, Court 3', court: null }); // another separator: not guessed at
  for (const t of [null, undefined, '', '   ']) assert.equal(parseCourt(t), null);
});

test('one venue: just the court, the venue once at the top', () => {
  const c = courtDisplay(['Winchester House School Sports Centre - 3', 'Winchester House School Sports Centre - 1', 'Winchester House School Sports Centre', '']);
  assert.deepEqual(c.venues, ['Winchester House School Sports Centre']);
  assert.equal(c.label('Winchester House School Sports Centre - 3'), 'Court 3');
  assert.equal(c.label('Winchester House School Sports Centre'), ''); // no court yet: the top says where
  assert.equal(c.label(''), '');
  assert.equal(c.label(null), '');
  // Names differing only in capitals are one venue, shown with its capitals.
  assert.deepEqual(courtDisplay(['bartholomew sports centre', 'Bartholomew Sports Centre - 2']).venues, ['Bartholomew Sports Centre']);
  assert.deepEqual(courtDisplay(['Bartholomew Sports Centre', 'bartholomew sports centre']).venues, ['Bartholomew Sports Centre']);
});

test('courts numbered at one venue stay plain; another venue named on its own gets its short name', () => {
  const c = courtDisplay(['Main Location - 1', 'Main Location - C2', 'Woodford Park Leisure Centre']);
  assert.deepEqual(c.venues, ['Main Location', 'Woodford Park Leisure Centre']);
  assert.equal(c.label('Main Location - 1'), 'Court 1');
  assert.equal(c.label('Main Location - C2'), 'Court 2');
  assert.equal(c.label('Woodford Park Leisure Centre'), 'Woodford');
});

test('courts numbered at two venues say which venue, shortened only as far as it stays unique', () => {
  const c = courtDisplay(['Crosfields Sports Hall - 1', 'Bracknell Leisure Centre - 2', 'Bracknell Leisure Centre']);
  assert.equal(c.label('Crosfields Sports Hall - 1'), 'Crosfields · Court 1');
  assert.equal(c.label('Bracknell Leisure Centre - 2'), 'Bracknell · Court 2');
  assert.equal(c.label('Bracknell Leisure Centre'), 'Bracknell');
  const medway = courtDisplay(['Medway - 06', 'Medway Park Sports Centre - 1']);
  assert.equal(medway.label('Medway - 06'), 'Medway · Court 6');
  assert.equal(medway.label('Medway Park Sports Centre - 1'), 'Medway Park · Court 1');
});

test('venues starting the same keep enough words to tell apart', () => {
  const short = shortVenues(['Medway', 'Medway Park Sports Centre', 'Rivermead Leisure Complex', 'Rivermead Leisure Centre']);
  assert.equal(short.get('medway'), 'Medway');
  assert.equal(short.get('medway park sports centre'), 'Medway Park');
  assert.equal(short.get('rivermead leisure complex'), 'Rivermead Leisure Complex');
  assert.equal(short.get('rivermead leisure centre'), 'Rivermead Leisure Centre');
  const c = courtDisplay(['Medway - 06', 'Medway - 10', 'Medway Park Sports Centre']);
  assert.equal(c.label('Medway - 06'), 'Court 6');
  assert.equal(c.label('Medway Park Sports Centre'), 'Medway Park');
});

test('unfamiliar formats stay readable', () => {
  const c = courtDisplay(['John Atkinson Sports Centre - JA-1', 'John Atkinson Sports Centre - JA-2']);
  assert.equal(c.label('John Atkinson Sports Centre - JA-1'), 'JA-1');
  const hand = courtDisplay(['Court A', 'Main hall', '3']);
  assert.deepEqual(hand.venues, ['Main hall']);
  assert.equal(hand.label('Court A'), 'Court A');
  assert.equal(hand.label('3'), '3');
  assert.equal(hand.label('Main hall'), '');
  const other = courtDisplay(['Hall 2, Court 3', 'Hall 2, Court 4']);
  assert.equal(other.label('Hall 2, Court 3'), 'Hall 2, Court 3');
  assert.equal(other.label('Hall 2, Court 4'), 'Hall 2, Court 4');
});
