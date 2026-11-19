import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PoseRunCapture} from '../src/pose-capture.ts';
import {movementSampleTimes} from '../src/movement-upload.ts';

const joint=(x,y,z=0)=>({p:[x,y,z],confidence:1});
const frame=time=>({time,joints:{ls:joint(-1,1),le:joint(-.6,.5),lw:joint(-1,.2),rs:joint(1,1),re:joint(.6,.5),rw:joint(1,.2),
  lh:joint(-.7,-.5),rh:joint(.7,-.5),lk:joint(-.7,-1.4),rk:joint(.7,-1.4),la:joint(-.7,-2.2),ra:joint(.7,-2.2),lf:joint(-.7,-2.4),rf:joint(.7,-2.4),nose:joint(0,1.6)}});

test('pose capture samples at a bounded interval and resets cleanly',()=>{
  const capture=new PoseRunCapture();
  assert.equal(capture.add(frame(0)),true);
  assert.equal(capture.add(frame(.04)),false);
  assert.equal(capture.add(frame(.1)),true);
  assert.equal(capture.sampleCount,2);
  capture.reset();
  assert.equal(capture.sampleCount,0);
  assert.equal(capture.add(frame(1)),true);
});

test('uploaded movement sampling is timestamped, bounded and rejects bad durations',()=>{
  const times=movementSampleTimes(2,10);
  assert.equal(times.length,20);
  assert.equal(times[0],0);
  assert.ok(times.at(-1)<2);
  assert.equal(new Set(times).size,times.length);
  assert.throws(()=>movementSampleTimes(0));
  assert.throws(()=>movementSampleTimes(2,0));
});

test('pose capture refuses invalid and huge evidence and reports through the shared aligner',()=>{
  const capture=new PoseRunCapture();
  assert.equal(capture.add({time:NaN,joints:{}}),false);
  for(let index=0;index<20001;index+=1)capture.add(frame(index*.1));
  assert.ok(capture.sampleCount<=20000);
  const reference=Array.from({length:20},(_,index)=>frame(index*.1));
  const report=capture.report(reference,{min:-1,max:1});
  assert.ok(report.referenceFrames===20);
  assert.ok(Array.isArray(report.reasons));
});
