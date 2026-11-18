import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPracticeStore} from '../src/practice/practice-store';
import {reconcilePracticePlan, definePracticePlan} from '../../../packages/learning-engine/practice-plan';

const identity = (planId: string) => ({lessonId: 'lesson', revisionId: 'rev-1', planId, duration: 10});

test('records are keyed by revision and plan and restore the saved unit', async () => {
  const store = createLocalPracticeStore();
  await store.save(identity('plan-a'), {
    revisionId: 'rev-1', planId: 'plan-a', unitId: 'two', time: 4,
    speed: 0.75, mode: 'sections', loop: true, repetitions: 2,
    countdownSeconds: 3, restSeconds: 2, updatedAt: 1,
  });
  const record = await store.load(identity('plan-a'));
  assert.equal(record?.unitId, 'two');
  assert.equal(record?.time, 4);
  assert.equal(record?.loop, true);
  assert.equal(record?.speed, 0.75);
});

test('a changed plan falls back to the revision-level latest record for remapping', async () => {
  const store = createLocalPracticeStore();
  await store.save(identity('plan-a'), {
    revisionId: 'rev-1', planId: 'plan-a', unitId: 'removed-unit', time: 4,
    speed: 1, mode: 'sections', loop: false, repetitions: 0,
    countdownSeconds: 0, restSeconds: 0, updatedAt: 1,
  });
  const latest = await store.load(identity('plan-b'));
  assert.equal(latest?.planId, 'plan-a');
  assert.equal(latest?.time, 4);
  const next = definePracticePlan({lessonId: 'lesson', revisionId: 'rev-1', duration: 10, units: [
    {id: 'one', label: 'One', start: 0, end: 5},
    {id: 'two', label: 'Two', start: 5, end: 10},
  ]});
  assert.equal(reconcilePracticePlan(next, {unitId: latest?.unitId, time: latest!.time, planId: latest?.planId}).unitId, 'one');
});

test('a different revision never returns another revision record', async () => {
  const store = createLocalPracticeStore();
  await store.save(identity('plan-a'), {
    revisionId: 'rev-1', planId: 'plan-a', unitId: 'one', time: 1,
    speed: 1, mode: 'sections', loop: false, repetitions: 0,
    countdownSeconds: 0, restSeconds: 0, updatedAt: 1,
  });
  assert.equal(await store.load({lessonId: 'lesson', revisionId: 'rev-2', planId: 'plan-a', duration: 10}), null);
});

test('preferences are revision scoped and include repeat/count-in', () => {
  const store = createLocalPracticeStore();
  store.savePreferences({lessonId: 'lesson', revisionId: 'rev-1'}, {
    speed: 0.5, mode: 'sections', loop: true, repetitions: 3, countdownSeconds: 5, restSeconds: 1.5,
  });
  assert.deepEqual(store.loadPreferences({lessonId: 'lesson', revisionId: 'rev-1'}), {
    speed: 0.5, mode: 'sections', loop: true, repetitions: 3, countdownSeconds: 5, restSeconds: 1.5,
  });
  assert.equal(store.loadPreferences({lessonId: 'lesson', revisionId: 'rev-2'}), null);
});
