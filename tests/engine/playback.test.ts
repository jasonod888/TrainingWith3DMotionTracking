import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Playback} from '../../packages/learning-engine/playback';
import {splitSection,mergeNext,validateSections} from '../../packages/lesson-schema/index';
import {readFileSync} from 'node:fs';
const sections=[{id:'a',label:'Ready',start:0,end:2},{id:'b',label:'Move',start:2,end:4}];
test('shared synthetic manifest uses the same section contract',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../../packages/lesson-schema/fixture.json',import.meta.url),'utf8'));
 assert.equal(validateSections(fixture.section_set.sections,fixture.duration).length,2);
});
test('holds exact section end; replay and previous play forwards',()=>{
 const p=new Playback(sections,4);p.command('next');p.tick(5);assert.deepEqual(p.snapshot(),{time:2,index:0,playing:false,speed:1,mode:'sections',calibrating:false});
 p.command('next');p.tick(.5);p.command('back');assert.equal(p.state.time,0);assert.equal(p.state.playing,true);
 p.command('again');assert.equal(p.state.time,0);
});
test('pause resumes position while completed section play repeats',()=>{
 const p=new Playback(sections,4);p.command('play');p.tick(1);p.command('pause');p.tick(1);assert.equal(p.state.time,1);
 p.command('play');p.tick(1);assert.equal(p.state.time,2);p.command('play');assert.equal(p.state.time,0);
});
test('no wrap after final section and no negative index',()=>{
 const p=new Playback(sections,4);p.command('back');assert.equal(p.state.index,0);p.command('next');p.tick(10);p.command('next');assert.equal(p.state.time,4);assert.equal(p.state.playing,false);
});
test('calibration blocks navigation; scrub pauses and mode preserves time',()=>{
 const p=new Playback(sections,4);p.calibrating(true);p.command('next');assert.equal(p.state.index,-1);p.calibrating(false);p.command('next');p.seek(2.5);assert.equal(p.state.playing,false);assert.equal(p.state.index,1);p.mode('continuous');assert.equal(p.state.time,2.5);
});
test('speed, invalid tick, and continuous end clamping',()=>{
 const p=new Playback(sections,4);p.mode('continuous');p.command('play');p.speed(.5);p.tick(2);assert.equal(p.state.time,1);p.tick(NaN);assert.equal(p.state.time,1);p.tick(20);assert.equal(p.state.time,4);assert.equal(p.state.playing,false);
});
test('split and merge preserve timeline and left section ID',()=>{
 const split=splitSection(sections,4,1,'c');assert.equal(split.length,3);assert.equal(split[0].id,'a');assert.deepEqual(mergeNext(split,4,0),sections);
 assert.throws(()=>splitSection(sections,4,.01,'d'));assert.throws(()=>splitSection(sections,4,1,'a'));
});
test('rejects gaps, overlaps, nonfinite times, duplicate IDs and truncated timeline',()=>{
 for(const bad of [[{...sections[0],end:1},sections[1]],[sections[0],{...sections[1],start:1}],[{...sections[0],end:NaN},sections[1]],[sections[0],{...sections[1],id:'a'}],[sections[0]]])assert.throws(()=>validateSections(bad,4));
});
