import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notesToAttacks, transcribeCapturedAudio} from '../src/music/audio-assessment.ts';
import {resampleToProfile, captureMicrophonePcm} from '../src/music/audio-capture.ts';
import {decodeUploadedAudio} from '../src/music/media-audio.ts';

test('audio note events become exact-pitch attacks in the requested clock',()=>{
  const mapped=notesToAttacks([{onset:.5,duration:.2,pitch:60,amplitude:.5},{onset:1,duration:.1,pitch:64,amplitude:.4}],
    seconds=>seconds+2);
  assert.deepEqual(mapped.map(item=>[item.pitch,item.time]),[[60,2.5],[64,3]]);
});

test('PCM transcription is aligned once and remains scoreless',async()=>{
  const expected=[{id:'a',onset:.5,pitch:60,optional:false},{id:'b',onset:1,pitch:64,optional:false}];
  let disposed=0;
  const transcriber={
    async transcribe(){return {notes:[{onset:.5,duration:.2,pitch:60,amplitude:.8},{onset:1.01,duration:.2,pitch:64,amplitude:.7}],elapsedMs:12};},
    dispose(){disposed+=1;},
  };
  const result=await transcribeCapturedAudio({pcm:new Float32Array(44100),sampleRate:22050,duration:2,
    expected,target:{start:0,end:2},sections:[{id:'all',label:'All',start:0,end:2}],transcriber});
  assert.equal(result.report.matchedRequired,2);
  assert.equal(result.report.score,null);
  assert.ok(result.report.reasons.includes('experimental-policy'));
  assert.equal(result.transcription.attacks.length,2);
  assert.equal(disposed,0,'caller-owned transcriber is not disposed by the assessment');
});

test('microphone guide time maps decoded events back into the reviewed clock',async()=>{
  const expected=[{id:'a',onset:.5,pitch:60,optional:false}];
  const transcriber={async transcribe(){return {notes:[{onset:.5,duration:.2,pitch:60,amplitude:.8}],elapsedMs:4};},dispose(){}};
  const result=await transcribeCapturedAudio({pcm:new Float32Array(22050),sampleRate:22050,duration:1,
    expected,target:{start:0,end:1},sections:[{id:'all',label:'All',start:0,end:1}],
    capture:{start:-.7,end:1},mapNoteTime:seconds=>seconds-1,speed:1,transcriber});
  assert.equal(result.report.matchedRequired,1);
  assert.equal(result.transcription.attacks[0].time,-.5);
});

test('audio preparation and upload refusal are explicit',async()=>{
  await assert.rejects(()=>captureMicrophonePcm({duration:1}),/Microphone capture|Web Audio/);
  await assert.rejects(()=>decodeUploadedAudio(new File([],''),new AbortController().signal),/Choose an audio/);
  const input=new Float32Array(44100).fill(.1);
  const output=await resampleToProfile(input,44100,22050);
  assert.equal(output.length,22050);
  assert.ok(output.every(value=>Math.abs(value-.1)<.001));
});
