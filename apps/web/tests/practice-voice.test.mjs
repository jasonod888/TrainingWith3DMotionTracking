import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PracticeVoice} from '../src/practice/practice-voice.ts';

class Recognition {
  static latest = null;
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  aborted = false;
  constructor() { Recognition.latest = this; }
  start() { this.onstart?.(); }
  abort() { this.aborted = true; this.onend?.(); }
  say(text) {
    const result = [{transcript: text, confidence: 0.95}];
    result.isFinal = true;
    this.onresult?.({resultIndex: 0, results: [result]});
  }
}

const setup = () => {
  const commands = [];
  const states = [];
  const errors = [];
  const voice = new PracticeVoice({
    browserRecognition: Recognition,
    checkLocal: async () => ({available: false}),
    onCommand: command => commands.push(command),
    onStatus: status => states.push(status),
    onError: message => errors.push(message),
  });
  return {voice, commands, states, errors};
};

test('availability is checked without starting the microphone', async () => {
  const {voice} = setup();
  await voice.initialize();
  assert.equal(voice.status, 'off');
  assert.equal(Recognition.latest, null);
});

test('listening is observed from recognition, not assumed', async () => {
  const {voice, states} = setup();
  await voice.initialize();
  voice.start();
  assert.equal(voice.status, 'listening');
  assert.ok(states.includes('starting'));
  assert.ok(states.includes('listening'));
});

test('pause is delivered while a run is playing and duplicates are suppressed', async () => {
  const {voice, commands} = setup();
  await voice.initialize();
  voice.start();
  const recognition = Recognition.latest;
  recognition.say('pause');
  recognition.say('pause');
  recognition.say('next');
  assert.deepEqual(commands, ['pause', 'next']);
});

test('start-over and repeat-section keep distinct normalized commands', async () => {
  const {voice, commands} = setup();
  await voice.initialize();
  voice.start();
  const recognition = Recognition.latest;
  recognition.say('start over');
  recognition.say('repeat section');
  assert.deepEqual(commands, ['restart-lesson', 'repeat-section']);
});

test('unsupported providers report unavailable without throwing', async () => {
  const errors = [];
  const voice = new PracticeVoice({
    browserRecognition: null,
    checkLocal: async () => ({available: false}),
    onCommand: () => {},
    onStatus: () => {},
    onError: message => errors.push(message),
  });
  await voice.initialize();
  assert.equal(voice.status, 'unavailable');
  assert.equal(voice.start(), false);
  assert.ok(errors[0].includes('unavailable'));
});

test('destroy releases the microphone and late results are ignored', async () => {
  const {voice, commands} = setup();
  await voice.initialize();
  voice.start();
  const recognition = Recognition.latest;
  voice.destroy();
  assert.equal(recognition.aborted, true);
  recognition.say('next');
  assert.deepEqual(commands, []);
});
