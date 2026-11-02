import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clampTime,trimBounds} from '../src/timeline.ts';
import {splitSection,validateSections} from '../../../packages/lesson-schema/index.ts';

test('trim handles preserve the opposite endpoint, minimum length and upload limit',()=>{
 for(const duration of [.1,.2,1,54.9,900])for(const start of [0,duration/2]){
  const end=Math.min(duration,start+300);
  for(const edge of ['start','end']){
   const bounds=trimBounds(duration,start,end,300,edge);
   for(const proposed of [-100,0,duration/3,duration,10000,NaN]){
    const value=clampTime(proposed,bounds.min,bounds.max);
    const from=edge==='start'?value:start,to=edge==='end'?value:end;
    assert.ok(from>=0&&to<=duration);
    assert.ok(to-from>=Math.min(.2,duration-start)-1e-9);
    assert.ok(to-from<=300+1e-9);
   }
  }
 }
});

test('moving a shared step boundary preserves complete coverage and both minimum lengths',()=>{
 const sections=splitSection([{id:'one',label:'Move',start:0,end:10}],10,5,'two');
 for(const requested of [-1,0,3,10,11]){
  const value=clampTime(requested,sections[0].start+.05,sections[1].end-.05);
  const next=sections.map(s=>({...s}));next[0].end=value;next[1].start=value;
  assert.equal(validateSections(next,10)[0].end,value);
 }
});
