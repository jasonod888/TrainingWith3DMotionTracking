import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  listenPlayCaptureRemaining, listenPlayCaptureSpan, listenPlayGuideTime, listenPlayPhaseAt, listenPlayTimeline,
} from '../../packages/music-engine/listen-play';

const config={section:{start:1,end:5},speed:1,guardSeconds:.25,countInSeconds:3,
  earlyStartSeconds:1.5,lateStartSeconds:1.5,tailSeconds:.75};

test('listen, guard, count-in and capture windows are declared in real seconds',()=>{
  const timeline=listenPlayTimeline(config);
  assert.equal(timeline.listenEnd,4);
  assert.equal(timeline.guardEnd,4.25);
  assert.equal(timeline.countInEnd,7.25);
  assert.equal(timeline.captureGuideStart,-0.5);
  assert.equal(timeline.captureGuideEnd,7.25);
  assert.equal(timeline.captureDuration,7.75);
  assert.equal(timeline.captureEnd,15);
  assert.deepEqual(listenPlayCaptureSpan(timeline),{start:-0.5,end:7.25});
});

test('the capture guide converts elapsed time at the selected speed',()=>{
  const slow=listenPlayTimeline({...config,speed:.5});
  assert.equal(slow.listenEnd,8);
  assert.equal(slow.captureGuideStart,.25);
  assert.equal(slow.captureGuideEnd,6.125);
  assert.equal(slow.captureDuration,11.75);
  assert.equal(listenPlayGuideTime(slow,0),.25);
  assert.equal(listenPlayGuideTime(slow,2),1.25);
  assert.equal(listenPlayGuideTime(slow,slow.captureDuration),6.125);
});

test('phase boundaries are deterministic and never skip the guard',()=>{
  const timeline=listenPlayTimeline(config);
  assert.equal(listenPlayPhaseAt(timeline,0),'listening');
  assert.equal(listenPlayPhaseAt(timeline,timeline.listenEnd-1e-6),'listening');
  assert.equal(listenPlayPhaseAt(timeline,timeline.listenEnd),'acoustic-guard');
  assert.equal(listenPlayPhaseAt(timeline,timeline.guardEnd),'count-in');
  assert.equal(listenPlayPhaseAt(timeline,timeline.countInEnd),'capturing');
  assert.equal(listenPlayPhaseAt(timeline,timeline.captureEnd),'analyzing');
  assert.equal(listenPlayCaptureRemaining(timeline,timeline.captureStart),timeline.captureDuration);
  assert.equal(listenPlayCaptureRemaining(timeline,timeline.captureEnd),0);
});

test('the capture tail is recorded after the late-start allowance',()=>{
  const timeline=listenPlayTimeline({...config,lateStartSeconds:0,tailSeconds:0});
  assert.equal(timeline.captureGuideEnd,config.section.end);
  const baseline=listenPlayTimeline(config);
  const noTail=listenPlayTimeline({...config,tailSeconds:0});
  assert.ok(Math.abs(baseline.captureDuration-noTail.captureDuration-.75)<1e-9);
});

test('invalid sections, speeds and windows are refused',()=>{
  assert.throws(()=>listenPlayTimeline({...config,speed:0}));
  assert.throws(()=>listenPlayTimeline({...config,section:{start:2,end:2}}));
  assert.throws(()=>listenPlayTimeline({...config,guardSeconds:-1}));
  assert.throws(()=>listenPlayTimeline({...config,maxCaptureSeconds:1}));
  assert.throws(()=>listenPlayPhaseAt(listenPlayTimeline(config),-1));
  assert.throws(()=>listenPlayGuideTime(listenPlayTimeline(config),-1));
});
