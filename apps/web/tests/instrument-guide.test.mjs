import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guitarGuide} from '../src/music/renderers/guide-view-model.ts';
import {pianoGeometry,pitchName} from '../src/music/music-reference.ts';
const event=pitch=>({id:String(pitch),pitch,onset:0,duration:1,velocity:null,optional:false});
test('standard guitar pitches convert legacy low-to-high indexes to canonical strings',()=>{
 for(const [pitch,string] of [[40,6],[45,5],[50,4],[55,3],[59,2],[64,1]]){
  assert.deepEqual(guitarGuide({instrument:'guitar'},[event(pitch)]).positions.map(note=>[note.string,note.fret,note.pitch]),[[string,0,pitch]]);
 }
 assert.deepEqual(guitarGuide({instrument:'guitar'},[event(41)]).positions.map(note=>[note.string,note.fret]),[[6,1]]);
});
test('guitar diagrams refuse conflicting, unplayable and unsupported settings',()=>{
 assert.equal(guitarGuide({},[event(40),event(41)]).positions.length,0);
 assert.equal(guitarGuide({},[event(20)]).positions.length,0);
 for(const config of [{capo:2},{tuning:'DADGAD'},{handedness:'left'}])assert.equal(guitarGuide(config,[event(60)]).positions.length,0);
 assert.equal(guitarGuide({},[event(40),event(40)]).positions.length,1);
});
test('piano range uses physical keys and natural endpoints without changing pitch identities',()=>{
 const geometry=pianoGeometry([event(21),event(108),event(10),event(120)]);
 assert.deepEqual([geometry.low,geometry.high],[21,108]);
 assert.deepEqual([21,60,69,108].map(pitchName),['A0','C4','A4','C8']);
 assert.equal(pianoGeometry([event(61)]).whiteKeys.length>0,true);
});
