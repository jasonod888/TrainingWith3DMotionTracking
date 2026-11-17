import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditionEnvelope, envelopeGainAt, grandPianoEnvelope, schedulePianoVoice} from '../src/music/piano-audition';
import {velocityGain} from '../src/music/music-velocity';
import {resolveAudibleNoteTiming, resolvePerformanceAudibleTimings} from '../src/music/piano-playback';
import {keyTouchVelocity} from '../src/music/notation/KeyboardEditor';

test('a long note remains audible near its end and releases at its declared duration', () => {
  const envelope = auditionEnvelope(6, 60, .6);
  assert.ok(envelopeGainAt(envelope, 5.5) >= velocityGain(.6) * .17);
  assert.equal(envelope.at(-1)!.time, 6);
  assert.equal(envelopeGainAt(envelope, 6), .0001);
  assert.ok(envelopeGainAt(envelope, 5.99) < envelopeGainAt(envelope, 5.9));
});

test('very short notes do not receive a minimum-length extension or reversed automation', () => {
  for (const duration of [.001, .03, .08, .25, 6, 20]) {
    const envelope = auditionEnvelope(duration, 60, .5);
    assert.equal(envelope.at(-1)!.time, duration);
    assert.ok(envelope.every(point => point.gain > 0 && Number.isFinite(point.gain)));
    for (let i = 1; i < envelope.length; i++) assert.ok(envelope[i].time > envelope[i-1].time);
  }
});

test('sustained tails preserve soft/loud differences', () => {
  for (const pitch of [36, 60, 84]) for (const time of [.02, 1, 5.5]) {
    const soft = envelopeGainAt(auditionEnvelope(6, pitch, .15), time);
    const loud = envelopeGainAt(auditionEnvelope(6, pitch, .9), time);
    assert.ok(loud > soft * 2);
  }
});

function fakeAudio() {
  const oscillators: {starts:number[];stops:number[]}[] = [];
  const curves: {value:number;time:number}[][] = [];
  const node = () => ({connect() {return this;}, disconnect() {}});
  const context = {
    createGain() {
      const curve: {value:number;time:number}[] = []; curves.push(curve);
      const record = (value:number,time:number) => curve.push({value,time});
      return {...node(), gain:{setValueAtTime:record, exponentialRampToValueAtTime:record}};
    },
    createOscillator() {
      const times = {starts:[] as number[],stops:[] as number[]}; oscillators.push(times);
      return {...node(), frequency:{value:0}, setPeriodicWave() {},
        start(time:number) {times.starts.push(time);}, stop(time:number) {times.stops.push(time);}};
    },
    createBiquadFilter() {return {...node(), frequency:{value:0},Q:{value:0},type:''};},
    createPeriodicWave() {return {};},
  } as unknown as BaseAudioContext;
  return {context, destination:node() as unknown as AudioNode, oscillators, curves};
}

test('a range beginning mid-note retains its elapsed envelope without a fresh strike', () => {
  const audio = fakeAudio();
  schedulePianoVoice(audio.context, audio.destination,
    {pitch:60,velocity:.6,startTime:10,duration:6,elapsed:3,windowSeconds:1});
  assert.equal(audio.curves[0][0].value, envelopeGainAt(auditionEnvelope(6,60,.6),3));
  assert.ok(audio.curves[0][0].value < velocityGain(.6) * .45);
  assert.ok(audio.curves[0].every(point => point.time >= 10 && point.time <= 11));
  assert.deepEqual(audio.oscillators[0].starts, [10]);
  assert.deepEqual(audio.oscillators[0].stops, [11.005]);
  assert.deepEqual(audio.curves[0].at(-1), {value:.0001,time:11});
});

test('repeated and overlapping same-pitch notes keep independent voices and endings', () => {
  const audio = fakeAudio();
  schedulePianoVoice(audio.context,audio.destination,{pitch:60,startTime:0,duration:2});
  schedulePianoVoice(audio.context,audio.destination,{pitch:60,startTime:.5,duration:.2});
  assert.equal(audio.oscillators.length, 2);
  assert.deepEqual(audio.oscillators[0].stops,[2.005]);
  assert.deepEqual(audio.oscillators[1].stops,[.705]);
});

test('expired or invalid notes do not allocate a voice', () => {
  const audio = fakeAudio();
  assert.equal(schedulePianoVoice(audio.context,audio.destination,{pitch:60,startTime:0,duration:1,elapsed:1}),null);
  assert.equal(schedulePianoVoice(audio.context,audio.destination,{pitch:128,startTime:0,duration:1}),null);
  assert.equal(audio.oscillators.length,0);
});

test('touch velocity follows the key strike position and meaningful pressure', () => {
  assert.ok(keyTouchVelocity(0) < keyTouchVelocity(.5));
  assert.ok(keyTouchVelocity(.5) < keyTouchVelocity(1));
  assert.ok(keyTouchVelocity(0) >= .25 && keyTouchVelocity(1) <= .95);
  assert.ok(keyTouchVelocity(.5, .9) > keyTouchVelocity(.5));
  assert.equal(keyTouchVelocity(.5, .5), keyTouchVelocity(.5), 'neutral pressure is ignored');
  assert.ok(keyTouchVelocity(-1) >= .25 && keyTouchVelocity(-1) <= .35);
  assert.ok(keyTouchVelocity(2) <= .95 && keyTouchVelocity(2) >= .85);
});

test('sustain pedal extends audible ring while unpedaled staccato keeps a natural tail', () => {
  const short = resolveAudibleNoteTiming({id: 'short', pitch: 60, onset: 1, duration: 0.08});
  assert.equal(short.dampedByKey, true);
  assert.ok(short.soundingDuration >= 0.22);
  const pedaled = resolveAudibleNoteTiming({id: 'pedaled', pitch: 60, onset: 1, duration: 0.08},
    [{onset: 0.5, offset: 3, type: 'sustain'}]);
  assert.equal(pedaled.dampedByKey, false);
  assert.ok(pedaled.soundingDuration > 1.9);
  const capped = resolveAudibleNoteTiming({id: 'capped', pitch: 60, onset: 1, duration: 0.5},
    [{onset: 0, offset: 4, type: 'sustain'}], 1.8);
  assert.ok(Math.abs(capped.soundingDuration - 0.8) < 1e-9, 'same-pitch re-strike caps the old string');
  const all = resolvePerformanceAudibleTimings([
    {id: 'first', pitch: 60, onset: 1, duration: 0.2},
    {id: 'second', pitch: 60, onset: 1.5, duration: 0.2},
    {id: 'other', pitch: 64, onset: 1.2, duration: 0.2},
  ], [{onset: 0, offset: 2}]);
  assert.ok(all.get('first')!.soundingDuration <= 0.5);
  assert.ok(all.get('other')!.dampedByKey === false);
});

test('grand piano envelope decays continuously without the old audition floor', () => {
  const envelope = grandPianoEnvelope(6, 60, .65, false);
  assert.ok(envelope.length >= 5);
  for (let index = 1; index < envelope.length; index++) {
    assert.ok(envelope[index].time > envelope[index - 1].time);
    assert.ok(Number.isFinite(envelope[index].gain) && envelope[index].gain > 0);
  }
  const beforeRelease = envelopeGainAt(envelope, 5.2);
  const late = envelopeGainAt(envelope, 5.6);
  assert.ok(late < beforeRelease, 'string decay is continuous');
  assert.ok(late < velocityGain(.65) * .18, 'there is no flat 18 percent sustain plateau');
  const damped = grandPianoEnvelope(6, 60, .65, true);
  assert.ok(damped.at(-1)!.time - damped.at(-2)!.time <= .17);
});

test('acoustic voice exposes a click-free re-strike release', () => {
  const audio = fakeAudio();
  const voice = schedulePianoVoice(audio.context, audio.destination,
    {pitch: 60, velocity: .7, duration: 2, startTime: 1, acousticDecay: true});
  assert.ok(voice?.releaseAt);
  voice!.releaseAt!(1.5, .015);
  assert.ok(audio.oscillators[0].stops.some(stop => Math.abs(stop - 1.52) < 1e-9));
  assert.ok(audio.curves[0].some(point => point.time === 1.5 && point.value > 0));
  assert.equal(audio.curves[0].at(-1)?.value, .0001);
});
