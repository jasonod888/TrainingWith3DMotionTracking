import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPracticeChunks, chunkAtTime, parseVoiceCommand} from '../src/music/practice-chunks.ts';

const alignment = {
  alignment_version: 1,
  mode: 'anchored',
  basis: 'passages',
  passages: [{kind: 'timed', source_seconds: [0, 16], ticks: [0, 15360]}],
};
const measures = [
  {id: 'm0', index: 0, start: 0, duration: 3840},
  {id: 'm1', index: 1, start: 3840, duration: 3840},
  {id: 'm2', index: 2, start: 7680, duration: 3840},
  {id: 'm3', index: 3, start: 11520, duration: 3840},
];

test('builds barline-aligned chunks by bar count', () => {
  const two = buildPracticeChunks(measures, alignment, 0, 16, 2);
  assert.deepEqual(two.map(chunk => [chunk.label, chunk.start, chunk.end]), [
    ['Bars 1–2', 0, 8],
    ['Bars 3–4', 8, 16],
  ]);
  const four = buildPracticeChunks(measures, alignment, 0, 16, 4);
  assert.deepEqual(four.map(chunk => [chunk.label, chunk.start, chunk.end]), [
    ['Bars 1–4', 0, 16],
  ]);
  assert.equal(buildPracticeChunks(measures, alignment, 0, 16, 0).length, 0);
  assert.equal(buildPracticeChunks(measures, null, 0, 16, 2).length, 0);
  const offset = buildPracticeChunks(measures, alignment, 0.5, 16, 2);
  assert.equal(offset[0].start, 0.5);
});

test('finds the chunk at a time including boundaries', () => {
  const chunks = buildPracticeChunks(measures, alignment, 0, 16, 2);
  assert.equal(chunkAtTime(chunks, 0), 0);
  assert.equal(chunkAtTime(chunks, 7.99), 0);
  assert.equal(chunkAtTime(chunks, 8), 1);
  assert.equal(chunkAtTime(chunks, 15.9), 1);
  assert.equal(chunkAtTime([], 2), 0);
});

test('parses voice commands and ignores unrelated speech', () => {
  assert.equal(parseVoiceCommand('Next please'), 'next');
  assert.equal(parseVoiceCommand('skip ahead'), 'next');
  assert.equal(parseVoiceCommand('go back'), 'back');
  assert.equal(parseVoiceCommand('previous one'), 'back');
  assert.equal(parseVoiceCommand('again'), 'again');
  assert.equal(parseVoiceCommand('replay this'), 'again');
  assert.equal(parseVoiceCommand('play'), 'play');
  assert.equal(parseVoiceCommand('start now'), 'play');
  assert.equal(parseVoiceCommand('pause'), 'pause');
  assert.equal(parseVoiceCommand('hold on'), 'pause');
  assert.equal(parseVoiceCommand('the weather is nice'), null);
});
