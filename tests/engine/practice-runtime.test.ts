import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BODY_CAPABILITIES} from '../../packages/learning-engine/practice-capabilities';
import {definePracticePlan, reconcilePracticePlan} from '../../packages/learning-engine/practice-plan';
import {derivePracticeView} from '../../packages/learning-engine/practice-view';
import {Playback} from '../../packages/learning-engine/playback';
import {PracticeSession} from '../../packages/learning-engine/practice-session';
import {PracticeRuntime} from '../../packages/learning-engine/practice-runtime';
import type {PracticeTransport, PracticeTransportSnapshot} from '../../packages/learning-engine/practice-transport';

function plan(id = 'plan-1', sameUnits = false) {
  return definePracticePlan({
    lessonId: 'lesson', revisionId: 'rev-1', duration: 6, title: 'Fixture',
    units: sameUnits ? [
      {id: 'a', label: 'One', start: 0, end: 2},
      {id: 'b', label: 'Two', start: 2, end: 4},
      {id: 'c', label: 'Three', start: 4, end: 6},
    ] : [
      {id: 'a', label: 'One', start: 0, end: 2},
      {id: 'b', label: 'Two', start: 2, end: 4},
      {id: 'c', label: 'Three', start: 4, end: 6},
    ],
    ...(id ? {} : {}),
  });
}

function internalTransport(duration: number) {
  let time = 0;
  let playing = false;
  let rate = 1;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const transport: PracticeTransport = {
    snapshot(): PracticeTransportSnapshot {
      return {time, duration, playing, ready: true, buffering: false, ended: time >= duration && !playing,
        rate, error: '', mode: 'sections'};
    },
    play() { playing = true; notify(); },
    pause() { playing = false; notify(); },
    seek(value) { time = Math.max(0, Math.min(duration, value)); playing = false; notify(); },
    setRate(value) { rate = value; notify(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    advance(delta) { if (playing) time = Math.min(duration, time + delta * rate); notify(); },
  };
  return transport;
}

function externalTransport(duration: number) {
  let time = 0;
  let playing = false;
  let buffering = false;
  let rate = 1;
  let fail = false;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const transport: PracticeTransport & {move: (t: number) => void; setBuffering: (value: boolean) => void; failNext: () => void} = {
    snapshot(): PracticeTransportSnapshot {
      return {time, duration, playing, ready: true, buffering, ended: time >= duration && !playing,
        rate, error: '', mode: 'sections'};
    },
    play() {
      if (fail) { fail = false; return Promise.reject(new Error('Playback was blocked.')); }
      playing = true; notify(); return Promise.resolve();
    },
    pause() { playing = false; notify(); },
    seek(value) { time = Math.max(0, Math.min(duration, value)); notify(); },
    setRate(value) { rate = value; notify(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    move(value) { time = value; notify(); },
    setBuffering(value) { buffering = value; notify(); },
    failNext() { fail = true; },
  };
  return transport;
}

test('same state and capabilities produce the same primary action and wording', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6), countdownSeconds: 0});
  runtime.restore({unitId: 'b', time: 2.5});
  const view = derivePracticeView(runtime.snapshot, BODY_CAPABILITIES);
  assert.deepEqual(view.primary, {id: 'resume', label: 'Resume section 2'});
  assert.equal(view.statusLabel, 'Your place is saved. Ready when you are.');

  runtime.play();
  runtime.tick(1.5);
  const complete = derivePracticeView(runtime.snapshot, BODY_CAPABILITIES);
  assert.equal(complete.primary.id, 'next');
  assert.equal(complete.primary.label, 'Next section');
  assert.notEqual(complete.primary.label, view.primary.label,
    'a restored pause and a completed section are different states');
});

test('lesson completion offers one "Practise again" action with no duplicate restart', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6), countdownSeconds: 0});
  runtime.select(2);
  runtime.play();
  runtime.tick(3);
  const view = derivePracticeView(runtime.snapshot, BODY_CAPABILITIES);
  assert.equal(runtime.snapshot.status, 'lesson-complete');
  assert.equal(view.primary.label, 'Practise again');
  assert.equal(view.primary.id, 'restart-lesson');
  assert.equal(view.secondary.filter(action => action.id === 'restart-lesson').length, 0);
});

test('repeat section and restart lesson are distinct and preserve their boundaries', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6), countdownSeconds: 0});
  runtime.select(1);
  runtime.play();
  runtime.tick(0.4);
  runtime.repeatSection();
  assert.equal(runtime.snapshot.unitIndex, 1);
  assert.equal(runtime.snapshot.time, 2);
  runtime.tick(0.25);
  runtime.restartLesson();
  assert.equal(runtime.snapshot.unitIndex, 0);
  assert.equal(runtime.snapshot.time, 0);
  assert.equal(runtime.snapshot.intent, 'started');
});

test('duplicate play and pause commands are idempotent', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6), countdownSeconds: 0});
  let starts = 0;
  let attempts = 0;
  runtime.onAttemptStart = () => { starts += 1; };
  runtime.onAttempt = () => { attempts += 1; };
  runtime.play();
  runtime.play();
  runtime.resume();
  assert.equal(starts, 1);
  assert.equal(runtime.snapshot.status, 'playing');
  runtime.pause('user');
  runtime.pause('settings');
  assert.equal(attempts, 1);
  assert.equal(runtime.snapshot.status, 'paused');
});

test('a rejected play reports an error and never creates a completed attempt', async () => {
  const transport = externalTransport(6);
  transport.failNext();
  const runtime = new PracticeRuntime({plan: plan(), transport, countdownSeconds: 0});
  let completed = 0;
  runtime.onAttempt = attempt => { if (attempt.completed) completed += 1; };
  runtime.play();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(runtime.snapshot.status, 'error');
  assert.equal(runtime.snapshot.pauseReason, 'play-failed');
  assert.equal(completed, 0);
});

test('buffering freezes practice time and keeps the attempt open until media resumes', async () => {
  const transport = externalTransport(6);
  const runtime = new PracticeRuntime({plan: plan(), transport, countdownSeconds: 0});
  let ended = 0;
  runtime.onAttempt = () => { ended += 1; };
  runtime.play();
  await Promise.resolve();
  transport.move(0.5);
  transport.setBuffering(true);
  runtime.tick(0.2);
  assert.equal(runtime.snapshot.status, 'buffering');
  assert.equal(runtime.snapshot.time, 0.5);
  assert.equal(runtime.snapshot.attempt?.completed, false);
  assert.equal(ended, 0);
  transport.setBuffering(false);
  runtime.tick(0.2);
  assert.equal(runtime.snapshot.status, 'playing');
  transport.move(0.8);
  runtime.tick(0.1);
  assert.equal(runtime.snapshot.time, 0.8);
});

test('continuous progression only completes at lesson end', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6), countdownSeconds: 0, mode: 'continuous'});
  runtime.play();
  runtime.tick(2.5);
  assert.equal(runtime.snapshot.status, 'playing');
  assert.equal(runtime.snapshot.unitIndex, 1);
  runtime.tick(3.5);
  assert.equal(runtime.snapshot.status, 'lesson-complete');
});

test('repetition count rests and then stops at the requested number', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6),
    countdownSeconds: 0, loop: true, repetitions: 2, restSeconds: 0.5});
  runtime.play();
  runtime.tick(2);
  assert.equal(runtime.snapshot.status, 'resting');
  runtime.tick(0.5);
  assert.equal(runtime.snapshot.status, 'playing');
  assert.equal(runtime.snapshot.run, 1);
  runtime.tick(2);
  assert.equal(runtime.snapshot.status, 'section-complete');
  assert.equal(runtime.snapshot.run, 2);
});

test('a changed plan remaps a restored position by time and rejects a revision mismatch', () => {
  const original = plan();
  const changed = definePracticePlan({
    lessonId: 'lesson', revisionId: 'rev-1', duration: 6,
    units: [
      {id: 'a', label: 'One', start: 0, end: 1.5},
      {id: 'b1', label: 'Two (a)', start: 1.5, end: 3},
      {id: 'b2', label: 'Two (b)', start: 3, end: 4.5},
      {id: 'c', label: 'Three', start: 4.5, end: 6},
    ],
  });
  const reconciled = reconcilePracticePlan(changed, {unitId: 'b', time: 3.5, planId: original.id, revisionId: 'rev-1'});
  assert.equal(reconciled.unitId, 'b2');
  assert.equal(reconciled.time, 3.5);
  assert.equal(reconciled.planChanged, true);
  const mismatched = reconcilePracticePlan(changed, {unitId: 'b', time: 3.5, revisionId: 'rev-2'});
  assert.equal(mismatched.revisionMismatch, true);
});

test('destroy pauses and releases the transport without late attempts', () => {
  const transport = internalTransport(6);
  const runtime = new PracticeRuntime({plan: plan(), transport, countdownSeconds: 0});
  runtime.play();
  let paused = '';
  runtime.onPause = reason => { paused = reason; };
  runtime.destroy();
  assert.equal(transport.snapshot().playing, false);
  assert.equal(paused, 'exit');
  runtime.tick(4);
  assert.equal(runtime.snapshot.time, 0);
});

test('a pre-seeked body Playback keeps its saved time through session construction', () => {
  const player = new Playback([
    {id: 'a', label: 'One', start: 0, end: 2},
    {id: 'b', label: 'Two', start: 2, end: 4},
    {id: 'c', label: 'Three', start: 4, end: 6},
  ], 6);
  player.seek(3);
  const session = new PracticeSession(player);
  assert.equal(session.snapshot.time, 3);
  assert.equal(session.snapshot.unitIndex, 1);
  assert.equal(player.state.time, 3);
});

test('a global timeline seek moves to the lesson position and active unit, not the old unit end', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6), countdownSeconds: 0});
  runtime.select(1);
  runtime.seek(5);
  assert.equal(runtime.snapshot.time, 5);
  assert.equal(runtime.snapshot.unitIndex, 2);
  assert.equal(runtime.snapshot.unitId, 'c');
});

test('continuous full-lesson repetition rests at zero and executes the next run', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6),
    countdownSeconds: 0, mode: 'continuous', loop: true, repetitions: 2, restSeconds: 1});
  runtime.play();
  runtime.tick(6);
  assert.equal(runtime.snapshot.status, 'resting');
  assert.equal(runtime.snapshot.time, 0);
  assert.equal(runtime.snapshot.unitIndex, 0);
  runtime.tick(1);
  assert.equal(runtime.snapshot.status, 'playing');
  assert.equal(runtime.snapshot.time, 0);
  runtime.tick(6);
  assert.equal(runtime.snapshot.status, 'lesson-complete');
});

test('an explicit range executes its delayed rest at the range start', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6),
    countdownSeconds: 0, loop: true, repetitions: 2, restSeconds: 1});
  runtime.range = {start: 1, end: 2};
  runtime.play();
  runtime.tick(2);
  assert.equal(runtime.snapshot.status, 'resting');
  assert.equal(runtime.snapshot.time, 1);
  runtime.tick(1);
  assert.equal(runtime.snapshot.status, 'playing');
  assert.equal(runtime.snapshot.time, 1);
});

test('mode changes cancel a countdown/interrupt an attempt exactly once and remain paused', () => {
  const runtime = new PracticeRuntime({plan: plan(), transport: internalTransport(6),
    countdownSeconds: 3, mode: 'sections'});
  const pauses: string[] = [];
  runtime.onPause = reason => pauses.push(reason);
  runtime.start();
  runtime.setMode('continuous');
  assert.equal(runtime.snapshot.status, 'paused');
  assert.equal(runtime.snapshot.phase, 'paused');
  assert.equal(runtime.snapshot.remaining, 0);
  assert.deepEqual(pauses, ['mode changed']);
  runtime.play();
  runtime.tick(0.5);
  runtime.setMode('sections');
  assert.equal(runtime.snapshot.status, 'paused');
  assert.equal(runtime.snapshot.phase, 'paused');
  assert.deepEqual(pauses, ['mode changed', 'mode changed']);
});
