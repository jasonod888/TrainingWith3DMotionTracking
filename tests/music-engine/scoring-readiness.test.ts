import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoringReadiness,type ScoringPolicy} from '../../packages/music-engine/scoring-readiness';
const policy:ScoringPolicy={version:'piano-midi-readiness-v1',referenceSha256:'a'.repeat(64),revisionId:'revision-1',rubricVersion:'piano-midi-v1',
 assessable:[{start:1,end:3},{start:2,end:4}],minCoverage:.95,minRequiredNotes:3,maxPolyphony:3,allowedSpeeds:[.5,1],qualified:true};
const evidence={policy,referenceSha256:policy.referenceSha256,revisionId:policy.revisionId,rubricVersion:policy.rubricVersion,
 range:{start:0,end:5},observed:[{start:0,end:5}],interrupted:false,latencyEvidence:'device-qualified' as const,requiredNotes:3,polyphony:2,speed:1};
test('readiness uses unioned coverage over explicitly assessable spans, never a score',()=>{
 const result=scoringReadiness({...evidence,observed:[{start:1,end:3},{start:2,end:3.5}]});
 assert.ok(Math.abs(result.coverage-2.5/3)<1e-9);assert.equal(result.ready,false);assert.ok(!('score' in result));
 assert.equal(scoringReadiness(evidence).ready,true);
});
test('visual calibration, interruption and unqualified policy cannot authorize scoring',()=>{
 assert.equal(scoringReadiness({...evidence,latencyEvidence:'visual-alignment'}).ready,false);
 assert.equal(scoringReadiness({...evidence,interrupted:true}).ready,false);
 assert.equal(scoringReadiness({...evidence,policy:{...policy,qualified:false}}).ready,false);
});
test('exact identity and exercise limits are required, not inferred from perfect matches',()=>{
 for(const change of [{revisionId:'other'},{referenceSha256:'b'.repeat(64)},{rubricVersion:'other'},
 {requiredNotes:0},{polyphony:4},{speed:1.25}])assert.equal(scoringReadiness({...evidence,...change}).ready,false);
 assert.equal(scoringReadiness({...evidence,policy:{...policy,assessable:[]}}).ready,false);
 assert.equal(scoringReadiness({...evidence,observed:[{start:NaN,end:2}]}).ready,false);
});
