import {test} from 'node:test';
import assert from 'node:assert/strict';
import {poseBestFitAlign, poseSimilarity, type PoseFrame, type PoseJointName} from '../../packages/learning-engine/pose-best-fit-align';

function joints(t:number, confidence=1):Record<PoseJointName,{p:[number,number,number];confidence:number}>{
  const swing=Math.sin(t*1.3)*.6+Math.cos(t*.7)*.2;
  const point=(x:number,y:number,z=0)=>({p:[x,y,z] as [number,number,number],confidence});
  return {
    nose:point(0,1.6),ls:point(-1,1),rs:point(1,1),
    le:point(-.6,.5),re:point(.6,.5),
    lw:point(-1+swing,.2),rw:point(1-swing,.2),
    lh:point(-.7,-.5),rh:point(.7,-.5),
    lk:point(-.7,-1.4),rk:point(.7,-1.4),
    la:point(-.7,-2.2),ra:point(.7,-2.2),
    lf:point(-.7,-2.4),rf:point(.7,-2.4),
  };
}
function frame(t:number,confidence=1):PoseFrame{return {time:t,joints:joints(t,confidence)};}
function reference(count=51):PoseFrame[]{return Array.from({length:count},(_,index)=>frame(index*.1));}
function shifted(source:PoseFrame[],offset:number):PoseFrame[]{return source.map(item=>({time:item.time+offset,joints:item.joints}));}

test('identical poses compare at full similarity',()=>{
  const a=frame(.4);
  assert.equal(poseSimilarity(a,a)?.score,100);
});

test('one global offset recovers a shifted whole-performance capture',()=>{
  const referenceFrames=reference();
  const result=poseBestFitAlign({captured:shifted(referenceFrames,.7),reference:referenceFrames,search:{min:-2,max:2}});
  assert.ok(Math.abs((result.offsetSeconds??0)-.7)<=.06,`offset ${result.offsetSeconds}`);
  assert.ok((result.score??0)>=99,`score ${result.score}`);
  assert.equal(result.ambiguous,false);
  assert.ok(result.coverage>.99);
});

test('missing capture cannot score a whole run',()=>{
  const referenceFrames=reference();
  const captured=shifted(referenceFrames,.7).filter(item=>item.time>=.7&&item.time<=2.2);
  const result=poseBestFitAlign({captured,reference:referenceFrames,search:{min:-2,max:2}});
  assert.equal(result.score,null);
  assert.ok(result.reasons.includes('insufficient-pose-coverage')||result.reasons.includes('insufficient-capture-coverage'));
});

test('static or repeated evidence is reported as ambiguous instead of certain',()=>{
  const referenceFrames=Array.from({length:51},(_,index)=>frame(index*.1)).map(item=>({time:item.time,joints:joints(0)}));
  const captured=referenceFrames.map(item=>({time:item.time,joints:item.joints}));
  const result=poseBestFitAlign({captured,reference:referenceFrames,search:{min:-2,max:2}});
  assert.equal(result.score,null);
  assert.equal(result.ambiguous,true);
});

test('low visibility produces insufficient evidence rather than a low learner score',()=>{
  const referenceFrames=reference();
  const captured=shifted(referenceFrames,.5).map(item=>({time:item.time,joints:joints(item.time,.2)}));
  const result=poseBestFitAlign({captured,reference:referenceFrames,search:{min:-2,max:2}});
  assert.equal(result.score,null);
  assert.ok(result.reasons.includes('insufficient-pose-coverage'));
});

test('reversed order does not become a valid match',()=>{
  const referenceFrames=reference();
  const captured=referenceFrames.map((item,index)=>({time:item.time+.5,joints:referenceFrames[referenceFrames.length-1-index].joints}));
  const result=poseBestFitAlign({captured,reference:referenceFrames,search:{min:-2,max:2}});
  assert.equal(result.score,null);
});

test('sections use the same global offset and report their own coverage',()=>{
  const referenceFrames=reference();
  const result=poseBestFitAlign({captured:shifted(referenceFrames,.4),reference:referenceFrames,search:{min:-2,max:2},
    sections:[{id:'first',label:'First',start:0,end:2.5},{id:'second',label:'Second',start:2.5,end:5}]});
  assert.equal(result.sections.length,2);
  assert.ok(result.sections.every(section=>section.score!==null));
  assert.ok(result.sections.every(section=>section.coverage>.9));
});

test('invalid or oversized pose evidence is refused',()=>{
  assert.throws(()=>poseBestFitAlign({captured:[{time:NaN,joints:{}}],reference:[]}));
  assert.throws(()=>poseBestFitAlign({captured:[],reference:[],search:{min:2,max:1}}));
  const many=Array.from({length:20001},(_,index)=>frame(index/1000));
  assert.throws(()=>poseBestFitAlign({captured:many,reference:many}));
});
