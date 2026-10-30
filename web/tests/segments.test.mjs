import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SectionSequence,defaultSegments,validateSegments} from '../dist/segments.js';
const {duration}=JSON.parse(readFileSync(new URL('../dist/assets/reference.json',import.meta.url)));
const sample=()=>new SectionSequence([{label:'one',start:0,end:1},{label:'two',start:1,end:3},{label:'three',start:3,end:4}],4);
test('manual sections cover the accepted full animation without gaps or overlaps',()=>{
  const sections=defaultSegments(duration);assert.equal(sections.length,20);assert.equal(sections[0].start,0);assert.equal(sections.at(-1).end,duration);
  sections.forEach((s,i)=>{assert.ok(s.end>s.start);if(i)assert.equal(s.start,sections[i-1].end);});
});
test('next, back and again navigate whole sections, preserving the final section at the end',()=>{
  const s=sample();assert.equal(s.current,null);
  assert.equal(s.command('next').label,'one');assert.equal(s.command('again').label,'one');
  assert.equal(s.command('next').label,'two');assert.equal(s.command('back').label,'one');
  s.command('next');assert.equal(s.command('next').label,'three');assert.equal(s.command('next'),null);assert.equal(s.current.label,'three');
});
test('back and again before the first move play the first section',()=>{
  assert.equal(sample().command('back').start,0);assert.equal(sample().command('again').start,0);
});
test('splitting and merging at the playhead preserves all animation time',()=>{
  const s=sample();s.split(2);assert.equal(s.segments.length,4);assert.equal(s.current.start,2);
  validateSegments(s.segments,4);s.mergeNext(1);assert.equal(s.segments.length,3);assert.equal(s.segments[1].end,3);
  assert.throws(()=>s.split(0));assert.throws(()=>s.mergeNext(2));
});
test('invalid or out-of-order manual timings are rejected',()=>{
  assert.throws(()=>validateSegments([{start:0,end:2},{start:1,end:4}],4));
  assert.throws(()=>validateSegments([{start:0,end:3}],4));
  assert.throws(()=>validateSegments([{start:0,end:NaN}],4));
});
