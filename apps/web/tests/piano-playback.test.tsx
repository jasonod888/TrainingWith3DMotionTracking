import test from 'node:test';
import assert from 'node:assert/strict';
import {clampOffsetSeconds,isNoteActive,isNoteVisible,needsPianoResync,pianoTimeFor,shiftOnset} from '../src/music/piano-playback';

test('piano time is source time shifted by the signed offset',()=>{
  assert.equal(pianoTimeFor(5,0.12),4.88);
  assert.equal(pianoTimeFor(5,-0.12),5.12);
  assert.equal(pianoTimeFor(0.05,-0.2),0.25);
});

test('offsets are clamped to the product limit',()=>{
  assert.equal(clampOffsetSeconds(10),10);
  assert.equal(clampOffsetSeconds(-25),-10);
  assert.equal(clampOffsetSeconds(Number.NaN),0);
});

test('resync only when drift exceeds the threshold',()=>{
  assert.equal(needsPianoResync(1.0,1.03),false);
  assert.equal(needsPianoResync(1.0,1.05),true);
  assert.equal(needsPianoResync(Number.NaN,1),false);
});

test('a recent correction holds small drift before seeking again',()=>{
  assert.equal(needsPianoResync(1.0,1.05,100,100.05),false);
  assert.equal(needsPianoResync(1.0,1.05,100,101),true);
  assert.equal(needsPianoResync(1.0,1.05,0,101),true);
  assert.equal(needsPianoResync(1.0,1.2,100,101),true);
});

test('a note shifted before zero can still be active at source zero',()=>{
  assert.ok(Math.abs(shiftOnset(0.05,-0.2)+0.15)<1e-9);
  assert.equal(isNoteActive(0.05,0.3,-0.2,0),true);
  assert.equal(isNoteActive(0.05,0.1,-0.2,0),false);
  assert.equal(isNoteVisible(0.05,0.3,-0.2,10),true);
});

test('a note shifted beyond the clip is not visible',()=>{
  assert.equal(isNoteVisible(9.5,1.0,1.0,10),false);
  assert.equal(isNoteVisible(9.5,1.0,0,10),true);
});
