import test from 'node:test';
import assert from 'node:assert/strict';
import {Playback} from '../../../packages/learning-engine/playback.ts';
import {clampSectionPreview,sectionPreviewRange,playSectionPreview} from '../src/section-preview.ts';

const sections=[{id:'a',label:'Opening',start:0,end:2},{id:'b',label:'1',start:2,end:5},{id:'c',label:'2',start:5,end:8}];
test('every section has a directly selectable preview range, including the final remainder',()=>{
 assert.deepEqual([0,1,2].map(marker=>{const s=sectionPreviewRange(sections,marker);return [s.start,s.end];}),[[0,2],[2,5],[5,8]]);
});
test('section playback respects the independent playhead and stops at the selected marker',()=>{
 const player=new Playback(sections,8);player.seek(3);
 playSectionPreview(player,1);assert.equal(player.state.time,3);
 player.tick(10);assert.equal(player.state.time,5);assert.equal(player.state.playing,false);
 playSectionPreview(player,1);assert.equal(player.state.time,2);assert.equal(player.state.playing,true);
 player.tick(.5);playSectionPreview(player,1);assert.equal(player.state.time,2.5);assert.equal(player.state.playing,false);
 playSectionPreview(player,1);assert.equal(player.state.time,2.5);
 assert.deepEqual(player.sections,sections);
});
test('an outside playhead restarts at the selected section; the tail and unsplit video remain playable',()=>{
 const player=new Playback(sections,8);player.seek(7);playSectionPreview(player,0);
 assert.equal(player.state.time,0);player.tick(20);assert.equal(player.state.time,2);
 playSectionPreview(player,2);assert.equal(player.state.time,5);player.tick(20);assert.equal(player.state.time,8);
 const full=new Playback([{id:'full',label:'Full movement',start:0,end:8}],8);
 full.seek(4);playSectionPreview(full,0);full.tick(20);assert.equal(full.state.time,8);assert.equal(full.state.playing,false);
});

test('preview inputs clamp to the selected section when dragged or stepped outside it',()=>{
 assert.equal(clampSectionPreview(sections,0,6),2);
 assert.equal(clampSectionPreview(sections,1,0),2);
 assert.equal(clampSectionPreview(sections,1,7),5);
 assert.equal(clampSectionPreview(sections,1,3.5),3.5);
 const resized=[{...sections[0],end:1},{...sections[1],start:1},sections[2]];
 assert.equal(clampSectionPreview(resized,0,1.5),1);
});
