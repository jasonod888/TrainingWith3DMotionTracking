import assert from 'node:assert/strict';
import {test} from 'node:test';
import {timelineTimeAt,timelineSectionAt,timelineKeyTime} from '../src/practice-timeline.ts';

test('chapter taps resolve unequal and very short sections including exact boundaries',()=>{
 const sections=[{start:0,end:8},{start:8,end:8.1},{start:8.1,end:46}];
 assert.equal(timelineSectionAt(sections,0),0);
 assert.equal(timelineSectionAt(sections,7.99),0);
 assert.equal(timelineSectionAt(sections,8),1);
 assert.equal(timelineSectionAt(sections,8.05),1);
 assert.equal(timelineSectionAt(sections,8.1),2);
 assert.equal(timelineSectionAt(sections,46),2);
 assert.equal(timelineSectionAt([],0),-1);
});

test('scrubbing uses the rail geometry and stays bounded when captured outside it',()=>{
 assert.equal(timelineTimeAt(300,100,400,46),23);
 assert.equal(timelineTimeAt(-50,100,400,46),0);
 assert.equal(timelineTimeAt(900,100,400,46),46);
 assert.equal(timelineTimeAt(300,100,0,46),0);
});

test('keyboard seeking supports precision, range bounds and start/end shortcuts',()=>{
 assert.equal(timelineKeyTime('ArrowRight',8,0,46),9);
 assert.equal(timelineKeyTime('ArrowLeft',8,0,46,true),7.9);
 assert.equal(timelineKeyTime('ArrowLeft',8,8,12),8);
 assert.equal(timelineKeyTime('ArrowRight',11.5,8,12),12);
 assert.equal(timelineKeyTime('Home',10,8,12),8);
 assert.equal(timelineKeyTime('End',10,8,12),12);
 assert.equal(timelineKeyTime('PageUp',40,0,46),46);
 assert.equal(timelineKeyTime(' ',8,0,46),null);
});
