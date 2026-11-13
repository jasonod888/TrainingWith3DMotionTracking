import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditionEnvelope, envelopeGainAt, schedulePianoVoice} from '../src/music/piano-audition';
import {velocityGain} from '../src/music/music-velocity';

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
