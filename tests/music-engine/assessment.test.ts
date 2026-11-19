import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bestFitAlign} from '../../packages/music-engine/best-fit-align';
import {
  EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY, assessMusicAttempt, minimumMatchedForScore, minimumTimingMatches,
} from '../../packages/music-engine/assessment';

const qualified={...EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY, qualified:true};
const notes=(count:number,start=1,step=0.5)=>
  Array.from({length:count},(_,index)=>({id:`n${index}`,onset:start+index*step,pitch:60+(index%7),optional:false}));
const run=(expected:ReturnType<typeof notes>, attacks:{id:string;pitch:number;time:number}[], overrides:Record<string,unknown>={}) => {
  const fit=bestFitAlign({expected,attacks,target:{start:0,end:10},capture:{start:-1,end:11},search:{min:-1,max:1}});
  return assessMusicAttempt({fit,expected,attacks,capture:{start:-1,end:11},target:{start:0,end:10},
    sections:[{id:'s1',label:'First',start:0,end:5},{id:'s2',label:'Second',start:5,end:10}],
    policy:qualified,speed:1,...overrides});
};

test('perfect full evidence produces the experimental formula result only when qualified',()=>{
  const expected=notes(10);
  const attacks=expected.map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset}));
  const report=run(expected,attacks);
  assert.equal(report.score,100);
  assert.equal(report.components.composite,100);
  assert.equal(report.policyQualified,true);
  assert.equal(report.timing.confidence,'normal');
  assert.equal(report.notes.filter(note=>note.status==='matched').length,10);
  assert.equal(report.sections.length,2);
  const product=assessMusicAttempt({fit:bestFitAlign({expected,attacks,target:{start:0,end:10},capture:{start:-1,end:11},search:{min:-1,max:1}}),
    expected,attacks,capture:{start:-1,end:11},target:{start:0,end:10},sections:[{id:'s1',label:'First',start:0,end:10}],speed:1});
  assert.equal(product.score,null);
  assert.ok(product.reasons.includes('experimental-policy'));
  assert.equal(product.components.composite,100,'counts and timing remain useful');
});

test('no evidence never earns a score or a composite',()=>{
  const expected=notes(10);
  const report=run(expected,[]);
  assert.equal(report.score,null);
  assert.equal(report.components.composite,null);
  assert.equal(report.components.extraRate,null);
  assert.ok(report.reasons.includes('no-matched-notes'));
  assert.equal(report.notes.filter(note=>note.status==='missing').length,10);
});

test('a short correct fragment cannot become a high whole-piece score',()=>{
  const expected=notes(20,0.5,0.5);
  const attacks=expected.slice(0,4).map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset}));
  const report=run(expected,attacks);
  assert.equal(report.score,null);
  assert.ok(report.reasons.includes('too-few-matched-notes'));
  assert.ok((report.components.pitchRecall??0)<0.3);
});

test('extras lower the score but do not erase matched notes',()=>{
  const expected=notes(10);
  const attacks=expected.map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset}));
  attacks.push({id:'extra',pitch:72,time:3.3});
  const report=run(expected,attacks);
  assert.equal(report.extra,1);
  assert.ok((report.score??100)<100);
  assert.ok(report.notes.some(note=>note.status==='extra'));
});

test('coverage and ambiguity withhold the overall score while counts remain',()=>{
  const expected=notes(20);
  const attacks=expected.slice(0,12).map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset}));
  const fit=bestFitAlign({expected,attacks,target:{start:0,end:10},capture:{start:-1,end:11},search:{min:-1,max:1}});
  const ambiguous={...fit,ambiguous:true};
  const report=assessMusicAttempt({fit:ambiguous,expected,attacks,capture:{start:-1,end:11},target:{start:0,end:10},
    sections:[{id:'all',label:'All',start:0,end:10}],policy:qualified,speed:1});
  assert.equal(report.score,null);
  assert.ok(report.reasons.includes('ambiguous-alignment'));
  assert.equal(report.matchedRequired,12);
  assert.equal(report.notes.filter(note=>note.status==='matched').length,12);
});

test('tiny references keep informative timing and counts without an eight-match floor',()=>{
  assert.equal(minimumMatchedForScore(2),1);
  assert.equal(minimumTimingMatches(2),1);
  const expected=[{id:'a',onset:1,pitch:60,optional:false},{id:'b',onset:1.5,pitch:64,optional:false}];
  const attacks=[{id:'x',pitch:60,time:1.02},{id:'y',pitch:64,time:1.47}];
  const report=run(expected,attacks,{target:{start:0,end:2},capture:{start:-1,end:3},sections:[{id:'tiny',label:'Tiny',start:0,end:2}]});
  assert.equal(report.matchedRequired,2);
  assert.equal(report.timing.available,true);
  assert.equal(report.timing.confidence,'normal');
  assert.ok(report.components.composite!==null);
});

test('practice speed reports the same source offset in real seconds',()=>{
  const expected=notes(4);
  const attacks=expected.map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset+0.5}));
  const fit=bestFitAlign({expected,attacks,target:{start:0,end:5},capture:{start:-2,end:6},search:{min:-1.5,max:1.5}});
  const report=assessMusicAttempt({fit,expected,attacks,capture:{start:-2,end:6},target:{start:0,end:5},
    sections:[{id:'all',label:'All',start:0,end:5}],policy:qualified,speed:0.5});
  assert.ok(Math.abs(report.offsetSeconds-0.5)<=0.03);
  assert.ok(Math.abs(report.offsetRealSeconds-1)<=0.06);
});

test('tempo drift is not repaired by a constant start offset',()=>{
  const expected=notes(20,1,.5);
  const attacks=expected.map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:1+(note.onset-1)*.72}));
  const fit=bestFitAlign({expected,attacks,target:{start:0,end:12},capture:{start:-1,end:13},search:{min:-2,max:2}});
  const report=assessMusicAttempt({fit,expected,attacks,capture:{start:-1,end:13},target:{start:0,end:12},
    sections:[{id:'all',label:'All',start:0,end:12}],policy:qualified,speed:1});
  assert.ok(report.matchedRequired<expected.length);
  assert.ok((report.components.pitchRecall??1)<1);
});

test('timing directions retain the signed error globally and per section',()=>{
  const expected=notes(4,1,.5);
  const attacks=expected.map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset-.1}));
  const fit=bestFitAlign({expected,attacks,target:{start:0,end:4.5},capture:{start:-1,end:5},search:{min:0,max:0}});
  const report=assessMusicAttempt({fit,expected,attacks,capture:{start:-1,end:5},target:{start:0,end:4.5},
    sections:[{id:'all',label:'All',start:0,end:4.5}],policy:qualified,speed:1});
  assert.equal(report.timing.early,4);
  assert.equal(report.timing.late,0);
  assert.equal(report.timing.onTime,0);
  assert.equal(report.sections[0].timing.early,4);
  assert.equal(report.sections[0].timing.late,0);
});

test('unmatched optional notes never become missing-note corrections',()=>{
  const expected=[{id:'req',onset:1,pitch:60,optional:false},{id:'opt',onset:1.02,pitch:64,optional:true}];
  const attacks=[{id:'a',pitch:60,time:1}];
  const fit=bestFitAlign({expected,attacks,target:{start:0,end:2},capture:{start:-1,end:3},search:{min:-.5,max:.5}});
  const report=assessMusicAttempt({fit,expected,attacks,capture:{start:-1,end:3},target:{start:0,end:2},
    sections:[{id:'all',label:'All',start:0,end:2}],policy:qualified,speed:1});
  const optional=report.notes.find(note=>note.id==='opt');
  assert.equal(optional?.optional,true);
  assert.equal(optional?.status,'unassessed');
  assert.equal(report.notes.some(note=>note.id==='opt'&&note.status==='missing'),false);
  assert.equal(report.missingRequired,0);
});

test('section extras are partitioned once and outside extras are audited separately',()=>{
  const attacks=[{id:'e1',pitch:72,time:1.9},{id:'e2',pitch:72,time:2},{id:'e3',pitch:72,time:4}];
  const fit=bestFitAlign({expected:[],attacks,target:{start:0,end:4},capture:{start:0,end:4},search:{min:0,max:0}});
  const report=assessMusicAttempt({fit,expected:[],attacks,capture:{start:0,end:4},target:{start:0,end:4},
    sections:[{id:'one',label:'One',start:0,end:2},{id:'two',label:'Two',start:2,end:4}],policy:qualified,speed:1});
  assert.equal(report.extra,3);
  assert.equal(report.sections.reduce((sum,section)=>sum+section.extra,0),2);
  assert.equal(report.extraOutsideSections,1);
  assert.equal(report.sections[0].extra,1);
  assert.equal(report.sections[1].extra,1);
});

test('offset capture bounds are shifted before eligibility and coverage',()=>{
  const expected=notes(3,0,1);
  const attacks=expected.map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset+.5}));
  const fit=bestFitAlign({expected,attacks,target:{start:0,end:3},capture:{start:.3,end:3.5},search:{min:.3,max:.7}});
  assert.ok(Math.abs(fit.offsetSeconds-.5)<=.02);
  assert.equal(fit.assessedRequired,3);
  assert.equal(fit.referenceCoverage,1);
  const report=assessMusicAttempt({fit,expected,attacks,capture:{start:.3,end:3.5},target:{start:0,end:3},
    sections:[{id:'all',label:'All',start:0,end:3}],policy:qualified,speed:1});
  assert.equal(report.notes.find(note=>note.id==='n0')?.status,'matched');
});

test('all supported practice speeds convert the fitted offset back to real time',()=>{
  for(const speed of [0.25,0.5,0.75,1,1.25]){
    const expected=notes(4);
    const attacks=expected.map((note,index)=>({id:`a${index}`,pitch:note.pitch,time:note.onset+0.5}));
    const fit=bestFitAlign({expected,attacks,target:{start:0,end:5},capture:{start:-2,end:6},search:{min:-1.5,max:1.5}});
    const report=assessMusicAttempt({fit,expected,attacks,capture:{start:-2,end:6},target:{start:0,end:5},
      sections:[{id:'all',label:'All',start:0,end:5}],policy:qualified,speed});
    assert.ok(Math.abs(report.offsetSeconds-.5)<=0.03,`speed ${speed} source offset ${report.offsetSeconds}`);
    assert.ok(Math.abs(report.offsetRealSeconds-.5/speed)<=0.06,`speed ${speed} real offset ${report.offsetRealSeconds}`);
  }
});

test('invalid policy weights are refused',()=>{
  assert.throws(()=>assessMusicAttempt({fit:bestFitAlign({expected:[],attacks:[],target:{start:0,end:1},capture:{start:-1,end:2},search:{min:-1,max:1}}),
    expected:[],attacks:[],capture:{start:-1,end:2},target:{start:0,end:1},sections:[],speed:1,
    policy:{...qualified,weights:{pitch:0.7,extra:0.2,timing:0.2}}}));
});
