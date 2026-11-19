import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {
  BASIC_PITCH_PROFILE, PIANO_PEAKS_PROFILE, decodeBasicPitch, monoFloat32, resampleLinear,
  stitchActivations, windowAudio, type BasicPitchActivations,
} from '../../packages/music-engine/basic-pitch';
import {PIANO_ACTIVATION_FIXTURE} from '../../apps/web/tests/fixtures/piano-activations';

function activations():BasicPitchActivations {
  const decode=(chunks:readonly string[]):Float32Array=>{
    const bytes=inflateSync(Buffer.from(chunks.join(''),'base64'));
    assert.equal(bytes.length,PIANO_ACTIVATION_FIXTURE.frames*PIANO_ACTIVATION_FIXTURE.freqs);
    return Float32Array.from(bytes,value=>value/255);
  };
  return {frames:PIANO_ACTIVATION_FIXTURE.frames,freqs:PIANO_ACTIVATION_FIXTURE.freqs,
    note:decode(PIANO_ACTIVATION_FIXTURE.note),onset:decode(PIANO_ACTIVATION_FIXTURE.onset),
    contourFrames:PIANO_ACTIVATION_FIXTURE.frames,frequencyBins:PIANO_ACTIVATION_FIXTURE.freqs};
}

test('profile decoder matches Python note events on saved quantized activations',()=>{
  const notes=decodeBasicPitch(activations(),2,PIANO_PEAKS_PROFILE);
  const expected=[...PIANO_ACTIVATION_FIXTURE.notes].sort((left,right)=>left[0]-right[0]||left[2]-right[2]);
  assert.equal(notes.length,expected.length);
  notes.forEach((note,index)=>{
    const [onset,end,pitch,amplitude]=expected[index];
    const duration=end-onset;
    assert.equal(note.pitch,pitch);
    assert.ok(Math.abs(note.onset-onset)<=0.02,`onset ${note.onset} vs ${onset}`);
    assert.ok(Math.abs(note.duration-duration)<=0.03,`duration ${note.duration} vs ${duration}`);
    assert.ok(Math.abs(note.amplitude-amplitude)<=0.02,`amplitude ${note.amplitude} vs ${amplitude}`);
  });
});

test('windowing and stitching use the verified profile constants',()=>{
  const pcm=new Float32Array(43844*2);
  const windows=windowAudio(pcm,BASIC_PITCH_PROFILE);
  assert.equal(windows.length,3);
  assert.ok(windows.every(window=>window.length===43844));
  const frames=172;
  const note=new Float32Array(frames*88); note.fill(.4);
  const onset=new Float32Array(frames*88); onset.fill(.7);
  const contour=new Float32Array(frames*264);
  const stitched=stitchActivations([{note,onset,contour}],43844,BASIC_PITCH_PROFILE);
  assert.equal(stitched.frames,142);
  assert.equal(stitched.note.length,142*88);
});

test('mono downmix and resampling reject invalid audio and preserve duration',()=>{
  assert.deepEqual(Array.from(monoFloat32([new Float32Array([1,-1]),new Float32Array([-1,1])])),[0,0]);
  const input=new Float32Array(44100).fill(.25);
  const output=resampleLinear(input,44100,22050);
  assert.equal(output.length,22050);
  assert.ok(output.every(value=>Math.abs(value-.25)<1e-9));
  assert.throws(()=>resampleLinear(input,0,22050));
  assert.throws(()=>monoFloat32([]));
});

test('decoder refuses malformed or oversized activation dimensions',()=>{
  const broken={frames:2,freqs:88,note:new Float32Array(3),onset:new Float32Array(3),contourFrames:2,frequencyBins:88};
  assert.throws(()=>decodeBasicPitch(broken,1,PIANO_PEAKS_PROFILE));
  assert.throws(()=>decodeBasicPitch({...broken,note:new Float32Array(2*88),onset:new Float32Array(2*88)},0,PIANO_PEAKS_PROFILE));
});
