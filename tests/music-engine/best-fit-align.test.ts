import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bestFitAlign} from '../../packages/music-engine/best-fit-align';

const notes=(count:number, start=0.5, step=0.5)=>
  Array.from({length:count},(_,index)=>({id:`n${index}`,onset:start+index*step,pitch:60+(index%8),optional:false}));

test('one global offset is recovered from distributed evidence',()=>{
  const expected=notes(12,1,0.6);
  const attacks=expected.map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset+0.42}));
  const result=bestFitAlign({expected,attacks,target:{start:0,end:9},capture:{start:-1,end:10},search:{min:-2,max:2}});
  assert.ok(Math.abs(result.offsetSeconds-0.42)<=0.03,`offset ${result.offsetSeconds}`);
  assert.equal(result.matchedRequired,expected.length);
  assert.deepEqual(result.missingRequired,[]);
  assert.deepEqual(result.extra,[]);
  assert.ok(result.referenceCoverage===1);
  assert.ok(result.support===1);
  assert.equal(result.ambiguous,false);
});

test('negative shifted attacks are matched rather than discarded',()=>{
  const expected=[{id:'first',onset:0,pitch:60,optional:false}];
  const attacks=[{id:'early',pitch:60,time:-0.1}];
  const result=bestFitAlign({expected,attacks,target:{start:0,end:1},capture:{start:-1,end:2},search:{min:-0.5,max:0.5}});
  assert.equal(result.matchedRequired,1);
  assert.ok(Math.abs(result.offsetSeconds+0.1)<=0.03);
  assert.deepEqual(result.extra,[]);
});

test('a short correct fragment leaves the full denominator and withholds a score',()=>{
  const expected=notes(20,0.5,0.5);
  const attacks=expected.slice(0,4).map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset}));
  const result=bestFitAlign({expected,attacks,target:{start:0,end:11},capture:{start:-1,end:12},search:{min:-1,max:1}});
  assert.equal(result.expectedRequired,20);
  assert.equal(result.assessedRequired,20);
  assert.equal(result.matchedRequired,4);
  assert.equal(result.referenceCoverage,1);
  assert.ok(result.support<0.5);
});

test('wrong octaves never receive exact-pitch credit',()=>{
  const expected=[{id:'n',onset:1,pitch:60,optional:false}];
  const result=bestFitAlign({expected,attacks:[{id:'octave',pitch:72,time:1}],target:{start:0,end:2},capture:{start:-1,end:3},search:{min:-1,max:1}});
  assert.equal(result.matchedRequired,0);
  assert.deepEqual(result.missingRequired,['n']);
  assert.deepEqual(result.extra,['octave']);
});

test('repeated notes and chords are matched one-to-one',()=>{
  const expected=[
    {id:'a',onset:1,pitch:60,optional:false},{id:'b',onset:1.1,pitch:60,optional:false},
    {id:'c',onset:1,pitch:64,optional:false},{id:'d',onset:1.05,pitch:64,optional:true},
  ];
  const result=bestFitAlign({expected,attacks:[
    {id:'x',pitch:60,time:1.02},{id:'y',pitch:60,time:1.08},{id:'z',pitch:64,time:1.01},
  ],target:{start:0,end:2},capture:{start:-1,end:3},search:{min:-0.5,max:0.5}});
  assert.equal(result.matchedRequired,3);
  assert.equal(result.matchedOptional,0);
  assert.equal(result.extra.length,0);
  assert.equal(result.missingRequired.length,0);
});

test('optional notes absorb input without creating misses',()=>{
  const expected=[{id:'req',onset:1,pitch:60,optional:false},{id:'opt',onset:1.02,pitch:60,optional:true}];
  const result=bestFitAlign({expected,attacks:[{id:'x',pitch:60,time:1}],target:{start:0,end:2},capture:{start:-1,end:3},search:{min:-0.5,max:0.5}});
  assert.equal(result.matchedRequired,1);
  assert.equal(result.matchedOptional,0);
  assert.deepEqual(result.missingRequired,[]);
});

test('boundary notes without a full tolerance window stay unassessed and reduce coverage',()=>{
  const expected=[{id:'edge',onset:0,pitch:60,optional:false},{id:'inside',onset:1,pitch:64,optional:false}];
  const result=bestFitAlign({expected,attacks:[],target:{start:0,end:2},capture:{start:0,end:2},search:{min:-0.5,max:0.5}});
  assert.equal(result.expectedRequired,2);
  assert.equal(result.assessedRequired,1);
  assert.equal(result.unassessedRequired,1);
  assert.equal(result.referenceCoverage,0.5);
});

test('competing repeated evidence is reported as ambiguous',()=>{
  const expected=Array.from({length:8},(_,index)=>({id:`n${index}`,onset:index+1,pitch:60,optional:false}));
  const attacks=expected.flatMap((note,index)=>[
    {id:`early${index}`,pitch:60,time:note.onset-0.5},
    {id:`late${index}`,pitch:60,time:note.onset+0.5},
  ]);
  const result=bestFitAlign({expected,attacks,target:{start:0,end:10},capture:{start:-2,end:11},search:{min:-1.5,max:1.5}});
  assert.equal(result.ambiguous,true);
  assert.ok(result.candidates.length>=2);
});

test('invalid and oversized evidence is refused deterministically',()=>{
  assert.throws(()=>bestFitAlign({expected:[{id:'a',onset:0,pitch:60,optional:false}],attacks:[],target:{start:0,end:1},capture:{start:-1,end:2},search:{min:2,max:-2}}));
  assert.throws(()=>bestFitAlign({expected:[{id:'a',onset:0,pitch:60,optional:false}],attacks:[{id:'x',pitch:60,time:0}],target:{start:0,end:1},capture:{start:-1,end:2},search:{min:-1,max:1},options:{maxEvents:0}}));
  const many=Array.from({length:20001},(_,index)=>({id:`n${index}`,onset:index/1000,pitch:60,optional:false}));
  assert.throws(()=>bestFitAlign({expected:many,attacks:[],target:{start:0,end:30},capture:{start:-1,end:31},search:{min:-1,max:1}}));
});
