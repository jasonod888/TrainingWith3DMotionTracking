import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MidiNotes} from '../../packages/music-engine/midi';

test('MIDI attacks, velocity-zero releases and sustain keep pressed keys separate from sounding notes',()=>{
 const midi=new MidiNotes();
 assert.deepEqual(midi.receive([0x90,60,100]).pressed,[60]);
 midi.receive([0x90,60,100]);assert.equal(midi.snapshot().attacks,2);
 midi.receive([0xb0,64,127]);
 const released=midi.receive([0x90,60,0]);assert.deepEqual(released.pressed,[]);assert.deepEqual(released.sounding,[60]);
 assert.deepEqual(midi.receive([0xb0,64,0]).sounding,[]);
});
test('channels are isolated and all-notes-off/reset discard stuck notes and pedal state',()=>{
 const midi=new MidiNotes();midi.receive([0x90,60,100]);midi.receive([0x91,60,100]);
 midi.receive([0xb0,123,0]);assert.deepEqual(midi.snapshot().pressed,[60]);
 midi.receive([0xb1,64,127]);midi.receive([0x81,60,0]);
 assert.deepEqual(midi.receive([0xb1,120,0]).sounding,[]);
 midi.receive([0x90,61,100]);assert.deepEqual(midi.reset(),{pressed:[],sounding:[],attacks:0,pedal:false});
});
test('malformed and unsupported MIDI messages never add notes',()=>{
 const midi=new MidiNotes();for(const message of [[0xf0,60,10],[0x90,60],[0x90,60,200],[0x90,128,0],[0x90,-1,10],[0x90,60,1.5],[0xb0,1,10]])midi.receive(message);
 assert.deepEqual(midi.snapshot(),{pressed:[],sounding:[],attacks:0,pedal:false});
});
