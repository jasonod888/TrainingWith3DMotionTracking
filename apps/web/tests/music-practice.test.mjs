import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePractice, BEAT_SECONDS, practiceLabel, practiceProgress, practiceSourceTime, REST_SECONDS, startPractice,
} from '../src/music/music-practice.ts';

const options = {sectionId: 'intro', start: 1, end: 1.8, repeats: 2, countInBeats: 4, speed: 1};

test('count-in counts down and then starts the first run', () => {
  let state = startPractice(options);
  assert.equal(state.phase, 'count-in');
  assert.equal(state.beat, 4);
  const beats = [];
  for (let index = 0; index < 3; index += 1) {
    state = advancePractice(state, BEAT_SECONDS, options);
    beats.push(state.beat);
  }
  assert.deepEqual(beats, [3, 2, 1]);
  state = advancePractice(state, BEAT_SECONDS, options);
  assert.equal(state.phase, 'playing');
  assert.equal(state.run, 0);
});

test('a run ends, rests and repeats before completing', () => {
  const start = startPractice({...options, countInBeats: 0});
  assert.equal(start.phase, 'playing');
  const rest = advancePractice(start, 0.8, options);
  assert.equal(rest.phase, 'rest');
  const repeat = advancePractice(rest, REST_SECONDS, options);
  assert.equal(repeat.phase, 'playing');
  assert.equal(repeat.run, 1);
  const done = advancePractice(repeat, 0.8, options);
  assert.equal(done.phase, 'done');
});

test('speed scales wall time without changing the reviewed source time range', () => {
  const half = {...options, speed: 0.5};
  let state = startPractice({...half, countInBeats: 0});
  state = advancePractice(state, 1.5, half);
  assert.equal(state.phase, 'playing');
  assert.equal(practiceSourceTime(state, half), 1 + 1.5 * 0.5);
  assert.ok(practiceProgress(state, half) < 1);
  state = advancePractice(state, 0.12, half);
  assert.equal(state.phase, 'rest');
});

test('source time holds at the section start during count-in and rest', () => {
  const state = startPractice(options);
  assert.equal(practiceSourceTime(state, options), options.start);
  assert.equal(practiceSourceTime({phase: 'rest', run: 0, elapsed: 0, beat: 0}, options), options.start);
  const playing = {phase: 'playing', run: 0, elapsed: 0.4, beat: 0};
  assert.equal(practiceSourceTime(playing, options), 1.4);
  assert.equal(practiceSourceTime({phase: 'playing', run: 0, elapsed: 999, beat: 0}, options), 1.8);
});

test('labels describe each phase without implying a score', () => {
  assert.match(practiceLabel(startPractice(options), options), /Count-in 4/);
  assert.match(practiceLabel({phase: 'playing', run: 0, elapsed: 0, beat: 0}, options), /Run 1 of 2/);
  assert.match(practiceLabel({phase: 'rest', run: 0, elapsed: 0, beat: 0}, options), /Rest/);
  assert.match(practiceLabel({phase: 'done', run: 1, elapsed: 0, beat: 0}, options), /complete/);
  assert.doesNotMatch(practiceLabel({phase: 'done', run: 1, elapsed: 0, beat: 0}, options), /score|grade/i);
});
