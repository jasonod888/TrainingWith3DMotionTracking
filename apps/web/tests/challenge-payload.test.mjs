import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bestFitAlign} from '../../../packages/music-engine/best-fit-align.ts';
import {assessMusicAttempt} from '../../../packages/music-engine/assessment.ts';
import {challengeAttemptPayload} from '../src/music/challenge-payload.ts';

test('challenge payload is scoreless, versioned and bound to the exact reference',()=>{
  const expected=[{id:'a',onset:1,pitch:60,optional:false},{id:'b',onset:2,pitch:64,optional:false}];
  const attacks=[{id:'x',pitch:60,time:1.02},{id:'y',pitch:64,time:2.01}];
  const fit=bestFitAlign({expected,attacks,target:{start:0,end:3},capture:{start:0,end:3},search:{min:-2,max:2}});
  const report=assessMusicAttempt({fit,expected,attacks,capture:{start:0,end:3},target:{start:0,end:3},
    sections:[{id:'all',label:'All',start:0,end:3}],speed:1});
  const value=challengeAttemptPayload(report,{id:'97196a00-a988-4ded-b55b-a5f1bb0976ec',revisionId:'rev',referenceSha256:'a'.repeat(64),duration:3,inputMode:'midi'});
  assert.equal(value.report_version,2);
  assert.equal(value.status,'insufficient-evidence');
  assert.equal(value.score,null);
  assert.equal(value.policy_qualified,false);
  assert.equal(value.rubric_version,'piano-midi-v1');
  assert.equal(value.scorer_version,'piano-challenge-v1');
  assert.equal(value.reference_sha256,'a'.repeat(64));
  assert.equal(value.end,3);
  assert.equal(value.counts.expected_required,2);
  assert.equal(value.sections.length,1);
  assert.equal(value.timing.on_time+value.timing.early+value.timing.late,value.timing.matches);
  assert.throws(()=>challengeAttemptPayload({...report,score:100},{id:'97196a00-a988-4ded-b55b-a5f1bb0976ec',revisionId:'rev',referenceSha256:'a'.repeat(64),duration:3,inputMode:'midi'}));
});
