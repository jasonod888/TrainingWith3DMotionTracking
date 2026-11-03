import test from 'node:test';
import assert from 'node:assert/strict';
import {initialMarkers,addMarker,moveMarker,newMarkerTime,removeMarker} from '../src/section-markers.ts';
import {validateSections} from '../../../packages/lesson-schema/index.ts';

const one=()=>initialMarkers([{id:'first',label:'Full movement',start:0,end:12}]);
test('adding timeline markers needs no names and preserves complete movement coverage',()=>{
 const second=addMarker(one(),12,4,'second',15);
 const third=addMarker(second.sections,12,8,'third',15);
 assert.deepEqual(third.sections.map(s=>s.label),['1','2','3']);
 assert.equal(third.selected,2);
 assert.equal(validateSections(third.sections,12).length,3);
 assert.throws(()=>addMarker(third.sections,12,8,'duplicate',15),/inside a section/);
});
test('moving a marker snaps to a frame and cannot cross its neighbours',()=>{
 const sections=addMarker(addMarker(one(),12,4,'b',15).sections,12,8,'c',15).sections;
 const next=moveMarker(sections,12,1,6.14,15);
 assert.equal(next[1].start,92/15);assert.equal(next[0].end,92/15);
 const clamped=moveMarker(next,12,1,11,15);
 assert.ok(clamped[1].start<clamped[1].end);
 assert.equal(validateSections(clamped,12).length,3);
 assert.equal(clamped[1].end,8);
});
test('removing a marker joins sections, renumbers defaults, and preserves edited labels',()=>{
 const sections=addMarker(addMarker(one(),12,4,'b',15).sections,12,8,'c',15).sections;
 sections[2].label='Turn and block';
 const next=removeMarker(sections,12,1);
 assert.deepEqual(next.map(s=>s.label),['1','Turn and block']);
 assert.equal(next[0].end,8);assert.equal(next[1].start,8);
 assert.equal(validateSections(next,12).length,2);
 assert.throws(()=>removeMarker(next,12,0),/start of the move/);
 assert.equal(sections.length,3);
});

test('new markers use the blue line frame and reject duplicate or endpoint boundaries',()=>{
 const sections=one();
 assert.equal(newMarkerTime(sections,4.21,15),4.2);
 const inserted=addMarker(sections,12,4.2,'new',15);
 assert.equal(newMarkerTime(inserted.sections,4.2,15),null);
 assert.equal(newMarkerTime(inserted.sections,0,15),null);
 assert.equal(newMarkerTime(inserted.sections,12,15),null);
 assert.equal(newMarkerTime(inserted.sections,8.3,15),125/15);
 assert.equal(newMarkerTime(inserted.sections,2,15),2);
 const middle=addMarker(inserted.sections,12,2,'earlier',15);
 assert.deepEqual(middle.sections.map(s=>s.start),[0,2,4.2]);
 assert.deepEqual(middle.sections.map(s=>s.label),['1','2','3']);
});
