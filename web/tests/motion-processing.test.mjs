import test from 'node:test';
import assert from 'node:assert/strict';
import {JOINTS,EDGES,extractFrame,conditionFrames} from '../dist/motion-processing.js';
test('landmarks become hip-relative in the rendering axes',()=>{
 const w=Array.from({length:33},(_,i)=>({x:i,y:i+1,z:i+2})),image=w.map(()=>({visibility:.9,presence:.8}));
 const f=extractFrame(w,image);assert.deepEqual(f.hips.p,[0,0,0]);assert.deepEqual(f.lw.p,[-8.5,8.5,8.5]);assert.equal(f.lw.confidence,.8);assert.equal(extractFrame(null,null),null);
});
test('fixed lengths stay consistent and missing detections remain gaps',()=>{
 function frame(time,factor){return {time,joints:Object.fromEntries(Object.keys(JOINTS).map((n,i)=>[n,{p:[i*.05*factor,i*.03*factor,0],confidence:1}]))};}
 const input=[frame(0,1),frame(.1,1.1),{time:.2,joints:null},frame(.3,.9)];const result=conditionFrames(input);
 assert.equal(result.frames[2].joints,null);assert.equal(input[1].joints.ls.p[0],.05500000000000001);
 for(const f of result.frames.filter(f=>f.joints))for(const [a,b] of EDGES){const length=Math.hypot(...f.joints[b].p.map((v,i)=>v-f.joints[a].p[i]));assert.ok(Math.abs(length-result.lengths[b])<1e-8);}
});
