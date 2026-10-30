import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceSession} from '../../packages/learning-engine/source-session';

test('late camera permission results are stopped after leaving or switching sources',()=>{
 const source=new SourceSession();const requested=source.generation;let stopped=0;
 source.stop();
 assert.equal(source.retain(()=>stopped++,requested),false);
 assert.equal(stopped,1);
});
test('source exit releases camera and worker exactly once, including repeated cleanup',()=>{
 const source=new SourceSession();const released:string[]=[];
 source.retain(()=>released.push('camera'),source.generation);
 source.retain(()=>released.push('worker'),source.generation);
 source.stop();source.stop();
 assert.deepEqual(released,['camera','worker']);
});
test('one failing cleanup does not leave another camera resource running',()=>{
 const source=new SourceSession();let stopped=false;
 source.retain(()=>{throw new Error('already closed');},source.generation);
 source.retain(()=>{stopped=true;},source.generation);
 source.stop();assert.equal(stopped,true);
});
