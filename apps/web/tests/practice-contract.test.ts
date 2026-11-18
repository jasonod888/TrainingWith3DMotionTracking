import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BODY_CAPABILITIES, MUSIC_CAPABILITIES, countInFromBeats, countInOptionsFromBeats, voiceControl} from '../../../packages/learning-engine/practice-capabilities';
import {definePracticePlan} from '../../../packages/learning-engine/practice-plan';
import {PracticeRuntime} from '../../../packages/learning-engine/practice-runtime';
import {derivePracticeView} from '../../../packages/learning-engine/practice-view';
import {bodyPracticePlan, musicPracticePlan, pianoPracticePlan} from '../src/practice/practice-plans';
import type {LessonManifest, MusicLessonManifest} from '../../../packages/lesson-schema/index';

const body = {
  lesson_id: 'body', revision_id: 'r1', title: 'Body', duration: 6,
  section_set: {id: 's', revision: 1, duration: 6, sections: [
    {id: 'one', label: 'One', start: 0, end: 3},
    {id: 'two', label: 'Two', start: 3, end: 6},
  ]},
} as unknown as LessonManifest;

const music = {
  lesson_id: 'music', revision_id: 'r1', title: 'Music', duration: 6, subject: 'guitar',
  section_set: {id: 's', revision: 1, duration: 6, sections: [
    {id: 'one', label: 'One', start: 0, end: 3},
    {id: 'two', label: 'Two', start: 3, end: 6},
  ]},
} as unknown as MusicLessonManifest;

const chunks = [
  {index: 0, label: 'Bars 1–2', start: 0, end: 3, measureStart: 1, measureEnd: 2},
  {index: 1, label: 'Bars 3–4', start: 3, end: 6, measureStart: 3, measureEnd: 4},
];

function runtimeFor(plan: ReturnType<typeof definePracticePlan>) {
  let time = 0;
  let playing = false;
  return new PracticeRuntime({
    plan, countdownSeconds: 0,
    transport: {
      snapshot: () => ({time, duration: plan.duration, playing, ready: true, buffering: false,
        ended: time >= plan.duration, rate: 1, error: ''}),
      play() { playing = true; },
      pause() { playing = false; },
      seek(value) { time = value; playing = false; },
      setRate() {},
      subscribe() { return () => {}; },
      advance(delta) { if (playing) time += delta; },
    },
  });
}

test('body, guitar and piano plans reach the same restored state and wording', () => {
  const plans = [bodyPracticePlan(body), musicPracticePlan(music), pianoPracticePlan({
    lessonId: 'piano', revisionId: 'r1', title: 'Piano', duration: 6, chunks,
  })];
  for (const plan of plans) {
    const runtime = runtimeFor(plan);
    runtime.restore({unitId: plan.units[1].id, time: 4});
    const view = derivePracticeView(runtime.snapshot, MUSIC_CAPABILITIES);
    assert.equal(view.primary.id, 'resume');
    assert.equal(view.primary.label, 'Resume section 2');
    assert.equal(view.statusLabel, 'Your place is saved. Ready when you are.');
  }
});

test('the same completed state has the same next-section action in every subject', () => {
  const plans = [bodyPracticePlan(body), musicPracticePlan(music), pianoPracticePlan({
    lessonId: 'piano', revisionId: 'r1', title: 'Piano', duration: 6, chunks,
  })];
  for (const plan of plans) {
    const runtime = runtimeFor(plan);
    runtime.play();
    runtime.tick(3);
    const view = derivePracticeView(runtime.snapshot, MUSIC_CAPABILITIES);
    assert.equal(runtime.snapshot.status, 'section-complete');
    assert.equal(view.primary.id, 'next');
    assert.equal(view.primary.label, 'Next section');
  }
});

test('capabilities hide Challenge and expose only available speeds', () => {
  assert.equal(MUSIC_CAPABILITIES.challenge, 'unsupported');
  assert.equal(BODY_CAPABILITIES.challenge, 'supported');
  assert.deepEqual(MUSIC_CAPABILITIES.speeds, [0.25, 0.5, 0.75, 1]);
});

test('beat count-in is converted to scheduler seconds and keeps explicit units', () => {
  assert.equal(countInFromBeats(4, 120), 2);
  assert.equal(countInFromBeats(2, 120), 1);
  const options = countInOptionsFromBeats([0, 2, 4], 120);
  assert.deepEqual(options.map(option => option.label), ['Off', '2 beats', '4 beats']);
  assert.deepEqual(options.map(option => option.seconds), [0, 1, 2]);
});

test('voice support, off and unavailable remain distinct', () => {
  assert.equal(voiceControl('off', '', true).off, true);
  assert.equal(voiceControl('unavailable', '', false).supported, false);
  assert.equal(voiceControl('off', 'Microphone denied.', true).enabled, false);
  assert.match(voiceControl('off', 'Microphone denied.', true).reason ?? '', /denied/);
});

test('a restored plan identity changes when piano bars-per-chunk changes', () => {
  const twoBars = pianoPracticePlan({lessonId: 'p', revisionId: 'r1', title: 'P', duration: 6, chunks});
  const fourBars = pianoPracticePlan({lessonId: 'p', revisionId: 'r1', title: 'P', duration: 6,
    chunks: [{index: 0, label: 'Bars 1–4', start: 0, end: 6, measureStart: 1, measureEnd: 4}]});
  assert.notEqual(twoBars.id, fourBars.id);
  const runtime = runtimeFor(twoBars);
  runtime.restore({unitId: 'bars:3-4', time: 4});
  runtime.replacePlan(fourBars);
  assert.equal(runtime.snapshot.unitId, 'bars:1-4');
  assert.equal(runtime.snapshot.time, 4);
});
