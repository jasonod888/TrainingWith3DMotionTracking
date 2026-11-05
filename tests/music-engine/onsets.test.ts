import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attackSourceTime,matchOnsets} from '../../packages/music-engine/onsets';

test('MIDI timestamps map measured latency onto source time at each practice speed',()=>{
 const clock={wallStartMs:1000,sourceStart:2,sourceEnd:4,speed:0.5,inputLatencyMs:40};
 assert.equal(attackSourceTime(1540,clock),2.25);
 assert.equal(attackSourceTime(1039,clock),null);
 assert.equal(attackSourceTime(5040,clock),null);
 assert.equal(attackSourceTime(1540,{...clock,speed:1.25}),2.625);
 assert.throws(()=>attackSourceTime(1200,{...clock,inputLatencyMs:NaN}));
});

test('one-to-one matching handles repeated attacks, chords, missing and extra pitches',()=>{
 const expected=[{id:'a',pitch:60,onset:1,optional:false},{id:'b',pitch:60,onset:1.15,optional:false},{id:'c',pitch:64,onset:1,optional:false}];
 const attacks=[{id:'x',pitch:60,sourceTime:.91},{id:'y',pitch:60,sourceTime:1.06},{id:'z',pitch:65,sourceTime:1}];
 const result=matchOnsets(expected,attacks,{start:0,end:2},.1);
 assert.equal(result.matches.length,2);assert.deepEqual(result.missing,['c']);assert.deepEqual(result.extra,['z']);
 const held=matchOnsets(expected,[attacks[0]],{start:0,end:2},.1);
 assert.ok(held.missing.includes('b'));
});

test('required notes have priority and absent optional notes never produce corrections',()=>{
 const expected=[{id:'optional',pitch:60,onset:1,optional:true},{id:'required',pitch:60,onset:1.05,optional:false}];
 const result=matchOnsets(expected,[{id:'x',pitch:60,sourceTime:1}],{start:0,end:2},.1);
 assert.equal(result.matches[0].expectedId,'required');assert.deepEqual(result.missing,[]);
 assert.equal(matchOnsets(expected,[],{start:0,end:2},.1).missing.length,1);
});

test('partial edge windows are unassessed and invalid/duplicate evidence is refused',()=>{
 const note={id:'edge',pitch:60,onset:1,optional:false};
 const result=matchOnsets([note],[{id:'x',pitch:60,sourceTime:1}],{start:1,end:2},.1);
 assert.equal(result.unassessed,1);assert.deepEqual(result.missing,[]);assert.deepEqual(result.extra,[]);
 assert.throws(()=>matchOnsets([note,note],[],{start:0,end:2},.1));
 assert.throws(()=>matchOnsets([],[],{start:0,end:2},NaN));
});
