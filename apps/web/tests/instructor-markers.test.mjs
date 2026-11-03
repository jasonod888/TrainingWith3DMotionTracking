import test from 'node:test';
import assert from 'node:assert/strict';
import {MARKER_NAMES,markerTrack,sampleMarkers,markerPixel,markerBadges} from '../src/instructor-markers.ts';

const track=()=>({schema:1,video_sha256:'match',order:[...MARKER_NAMES],times:[0,1],
 frames:[[[.2,.4],[.8,.4],[.3,.9],[.7,.9]],[[.3,.5],[.7,.5],[.4,.9],[.6,.9]]]});
test('guides bind to the exact video and named anatomical ordering',()=>{
 assert.ok(markerTrack(track(),'match'));
 assert.equal(markerTrack(track(),'different'),null);
 const bad=track();bad.order.reverse();assert.equal(markerTrack(bad,'match'),null);
 const invalid=track();invalid.frames[0][0]=[NaN,.4];assert.equal(markerTrack(invalid,'match'),null);
});
test('clock sampling interpolates nearby poses and hides missing or discontinuous joints',()=>{
 assert.deepEqual(sampleMarkers(track(),.5)[0],[.25,.45]);
 const hidden=track();hidden.frames[1][0]=null;assert.equal(sampleMarkers(hidden,.5)[0],null);
 const jump=track();jump.frames[1][0]=[.9,.9];assert.equal(sampleMarkers(jump,.5)[0],null);
 assert.deepEqual(sampleMarkers(track(),2),[null,null,null,null]);
});
test('letterboxing, control padding, and mirroring preserve the landmark projection',()=>{
 const box={x:10,y:20,width:800,height:600,left:0,right:100,top:40,bottom:60};
 const left=markerPixel([.2,.4],box,158,224,false),mirror=markerPixel([.2,.4],box,158,224,true);
 assert.equal(left[1],mirror[1]);
 assert.ok(Math.abs((left[0]-box.x)+(mirror[0]-box.x)-box.width)<1e-8);
 assert.equal(MARKER_NAMES[0],'left_hand');
 assert.ok(left[1]>box.y+box.top&&left[1]<box.y+box.height-box.bottom);
});
test('crossed hand labels separate without leaving the available pane',()=>{
 const badges=markerBadges([[100,100],[100,100],[90,200],[110,200]],300,300);
 assert.ok(Math.hypot(badges[0][0]-badges[1][0],badges[0][1]-badges[1][1])>=23);
 for(const [x,y] of badges){assert.ok(x>=12&&x<=288);assert.ok(y>=12&&y<=288);}
});
