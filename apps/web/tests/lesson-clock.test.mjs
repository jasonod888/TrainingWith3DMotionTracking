import test from 'node:test';
import assert from 'node:assert/strict';
import {lessonFrameTime,instructorStart,animationFrameTime} from '../src/lesson-clock.ts';

test('animation and focused video address the same reconstructed frame after trims',()=>{
 const lesson={duration:8,frame_rate:15,animation_start:5/15,source_start:5.5+5/15,focused_video_start:5/15};
 for(const time of [0,.01,.066666666,.5,3.94,7.99,8]){
  const frame=lessonFrameTime(lesson,time);
  assert.equal(animationFrameTime(lesson,time),instructorStart(lesson,true)+frame);
  assert.ok(Math.abs(frame*15-Math.round(frame*15))<1e-6);
 }
});
test('zero focused-video offset is distinct from the original wide-source offset',()=>{
 const lesson={duration:8,source_start:5.5,focused_video_start:0};
 assert.equal(instructorStart(lesson,true),0);
 assert.equal(instructorStart(lesson,false),5.5);
 assert.equal(instructorStart({...lesson,focused_video_start:null},true),5.5);
 assert.equal(lessonFrameTime(lesson,.1),1/15);
});
