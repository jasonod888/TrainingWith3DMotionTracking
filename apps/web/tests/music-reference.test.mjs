import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  activeEvents, currentSpan, eventDuration, guitarPosition, parseMusicReference, pianoGeometry, pitchName, bindMusicReference,supportsGuitarDiagram,
} from '../src/music/music-reference.ts';

const base = {
  review:{reviewer_id:'fixture-author',reviewed_at:'2026-11-05T12:00:00Z',draft_id:'fixture-draft',source_reference_sha256:'a'.repeat(64)},
  reference_version: 1,
  subject: 'piano',
  instrument: {instrument: 'piano'},
  duration: 4,
  spans: [{start: 0.5, end: 3.5}],
  events: [
    {id: 'a', onset: 0.5, duration: 0.5, pitch: 60, velocity: 0.8},
    {id: 'b', onset: 1.2, duration: null, pitch: 64, optional: true},
  ],
};

test('a reviewed reference is read, sorted and keeps optional notes', () => {
  const reference = parseMusicReference({...base, events: [base.events[1], base.events[0]]});
  assert.equal(reference.events[0].id, 'a');
  assert.equal(reference.events[1].optional, true);
  assert.equal(reference.events[1].duration, null);
  assert.equal(eventDuration(reference.events[1]), 0.25);
});

test('invalid references are refused rather than rendered', () => {
  assert.throws(()=>parseMusicReference({...base,review:undefined}),/review evidence/);
  assert.throws(()=>parseMusicReference({...base,review:{...base.review,source_reference_sha256:'invalid'}}),/review evidence/);
  assert.throws(()=>parseMusicReference({...base,instrument:{instrument:'guitar'}}),/instrument/);
  assert.throws(() => parseMusicReference({...base, reference_version: 2}), /unsupported version/);
  assert.throws(() => parseMusicReference({...base, events: {...base.events}}), /no notes/);
  assert.throws(() => parseMusicReference({...base, events: [{...base.events[0], id: 'a'}, {...base.events[1], id: 'a'}]}), /repeats note id/);
  assert.throws(() => parseMusicReference({...base, events: [{...base.events[0], onset: 3.8, duration: 1}]}), /ends outside/);
  assert.throws(() => parseMusicReference({...base, events: [{...base.events[0], pitch: 200}]}), /invalid pitch/);
  assert.throws(() => parseMusicReference({...base, spans: [{start: 3, end: 2}]}), /outside the clip/);
});

test('reference binding refuses cross-lesson duration/instrument and unsupported guitar setups do not produce positions',()=>{
 const reference=parseMusicReference(base);
 assert.equal(bindMusicReference(reference,{subject:'piano',duration:4,instrument:{instrument:'piano',capo:null}}),reference);
 assert.throws(()=>bindMusicReference(reference,{subject:'piano',duration:8,instrument:{instrument:'piano'}}),/does not match/);
 assert.equal(supportsGuitarDiagram({instrument:'guitar',capo:2}),false);
 assert.equal(supportsGuitarDiagram({instrument:'guitar',tuning:'D2 A2 D3 G3 B3 E4'}),false);
 assert.equal(supportsGuitarDiagram({instrument:'guitar',tuning:'E2 A2 D3 G3 B3 E4'}),true);
 assert.ok(pianoGeometry([{pitch:0},{pitch:127}]).width>0);
});

test('active notes follow reviewed start and length', () => {
  const reference = parseMusicReference(base);
  assert.deepEqual(activeEvents(reference, 0.4, 0).map(event => event.id), []);
  assert.deepEqual(activeEvents(reference, 0.5, 0).map(event => event.id), ['a']);
  assert.deepEqual(activeEvents(reference, 0.99, 0).map(event => event.id), ['a']);
  assert.deepEqual(activeEvents(reference, 1.0, 0).map(event => event.id), []);
  assert.deepEqual(activeEvents(reference, 1.3, 0).map(event => event.id), ['b']);
  assert.equal(currentSpan(reference, 0.4), null);
  assert.equal(currentSpan(reference, 2)?.start, 0.5);
});

test('piano geometry covers the reference and marks black keys', () => {
  const reference = parseMusicReference(base);
  const geometry = pianoGeometry(reference.events);
  assert.ok(geometry.low <= 60 && geometry.high >= 64);
  assert.equal(geometry.whiteKeys.length, geometry.width);
  assert.ok(geometry.whiteKeys.some(key => key.pitch === 60));
  assert.ok(geometry.blackKeys.every(key => !geometry.whiteKeys.some(white => white.pitch === key.pitch)));
  const c4 = geometry.whiteKeys.find(key => key.pitch === 60);
  assert.equal(c4?.left, geometry.whiteKeys.findIndex(key => key.pitch === 60));
  assert.equal(geometry.blackKeys.find(key=>key.pitch===61)?.left,c4.whiteIndex+1);
});

test('guitar positions use standard tuning and the lowest fret', () => {
  assert.deepEqual(guitarPosition(40), {string: 1, fret: 0, label: 'E2'});
  assert.deepEqual(guitarPosition(45), {string: 2, fret: 0, label: 'A2'});
  assert.deepEqual(guitarPosition(64), {string: 6, fret: 0, label: 'E4'});
  assert.deepEqual(guitarPosition(61), {string: 5, fret: 2, label: 'B3'});
  assert.equal(guitarPosition(20), null);
  assert.equal(pitchName(60), 'C4');
});
