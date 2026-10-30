import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AttemptFeedback} from '../../packages/learning-engine/attempt-feedback';
test('unclear coverage never produces an attempt score',()=>{const f=new AttemptFeedback();for(let i=0;i<10;i++)f.sample({score:95,cue:'',coverage:.5});assert.equal(f.result().score,null);});
test('attempt summary averages clear samples, requires enough evidence and resets',()=>{const f=new AttemptFeedback();f.sample({score:100,cue:'Left elbow',coverage:1});f.sample({score:50,cue:'Left elbow',coverage:1});assert.equal(f.result().score,null);f.sample({score:75,cue:'Right knee',coverage:1});assert.equal(f.result().score,75);assert.equal(f.result().cue,'Left elbow');f.reset();assert.equal(f.result().score,null);});
