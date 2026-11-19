import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAttemptOutcome, resolvePracticePolicy, unassessedChallengeAllowed,
  type ActPracticePolicy, type PracticePolicyInput,
} from '../../../packages/learning-engine/practice-policy';
import {
  assertPracticeAdapter, createResourceBag, type ActPracticeAdapter,
} from '../../../packages/learning-engine/practice-adapter';
import {BODY_CAPABILITIES} from '../../../packages/learning-engine/practice-capabilities';
import {definePracticePlan} from '../../../packages/learning-engine/practice-plan';
import {emptyTransportSnapshot} from '../../../packages/learning-engine/practice-transport';

const BODY: ActPracticePolicy = {
  id: 'full_body',
  supportsChallenge: true,
  allowsUnassessedChallenge: true,
  assessmentAdapterId: 'pose-v1',
  rubricVersion: 'pose-v1',
  defaultFeedback: 'live',
  practiceInputs: ['camera', 'microphone'],
};

const UNASSESSED_ACT: ActPracticePolicy = {
  ...BODY,
  assessmentAdapterId: null,
  rubricVersion: null,
};

function input(overrides: Partial<PracticePolicyInput> = {}): PracticePolicyInput {
  return {
    mode: 'practice',
    act: BODY,
    creator: {assessmentAllowed: true, feedbackAllowed: true},
    learner: {feedback: 'on'},
    reference: {reviewed: true, eligible: true},
    evidence: {selected: ['camera'], available: ['camera']},
    ...overrides,
  };
}

test('the four policy axes are independent', () => {
  const live = resolvePracticePolicy(input());
  assert.equal(live.mode, 'practice');
  assert.equal(live.assessment.enabled, true);
  assert.equal(live.feedbackPresentation, 'live');
  assert.deepEqual(live.evidenceInputs, ['camera']);

  const quiet = resolvePracticePolicy(input({learner: {feedback: 'hide_live_feedback'}}));
  assert.equal(quiet.mode, 'practice', 'feedback choice does not change the mode');
  assert.equal(quiet.assessment.enabled, true, 'hiding presentation keeps assessment');
  assert.equal(quiet.feedbackPresentation, 'after_attempt');
  assert.deepEqual(quiet.evidenceInputs, ['camera'], 'input choice is unchanged');
});

test('an unassessed challenge needs no input permission and never scores', () => {
  const policy = resolvePracticePolicy(input({
    mode: 'challenge', act: UNASSESSED_ACT,
    evidence: {selected: ['camera'], available: ['camera']},
  }));
  assert.equal(policy.assessment.enabled, false);
  if (policy.assessment.enabled) throw new Error('unreachable');
  assert.equal(policy.assessment.reasonCode, 'no_adapter');
  assert.equal(policy.challenge.kind, 'unassessed');
  assert.equal(policy.requiresInputPermission, false);
  assert.equal(policy.mayScore, false);
  assert.equal(policy.feedbackPresentation, 'hidden');
  assert.equal(unassessedChallengeAllowed(input({mode: 'challenge', act: UNASSESSED_ACT})), true);
});

test('creator-disabled assessment cannot be re-enabled by a learner', () => {
  const policy = resolvePracticePolicy(input({
    creator: {assessmentAllowed: false, feedbackAllowed: true},
    learner: {feedback: 'on'},
  }));
  assert.equal(policy.assessment.enabled, false);
  if (policy.assessment.enabled) throw new Error('unreachable');
  assert.equal(policy.assessment.reasonCode, 'creator_disabled');
  // The learner asking for assessment does not override the creator.
  const override = resolvePracticePolicy(input({
    creator: {assessmentAllowed: false, feedbackAllowed: true},
    learner: {feedback: 'on'},
  }));
  assert.equal(override.assessment.enabled, false);
  assert.equal(override.mayScore, false);
});

test('hide-live-feedback is not the same as disabling assessment', () => {
  const hidden = resolvePracticePolicy(input({learner: {feedback: 'hide_live_feedback'}}));
  assert.equal(hidden.assessment.enabled, true);
  assert.equal(hidden.feedbackPresentation, 'after_attempt');

  const disabled = resolvePracticePolicy(input({learner: {feedback: 'disable_assessment'}}));
  assert.equal(disabled.assessment.enabled, false);
  if (disabled.assessment.enabled) throw new Error('unreachable');
  assert.equal(disabled.assessment.reasonCode, 'learner_disabled');
  assert.equal(disabled.feedbackPresentation, 'hidden');
});

test('an assessed challenge hides live feedback and requires evidence', () => {
  const ready = resolvePracticePolicy(input({mode: 'challenge'}));
  assert.equal(ready.assessment.enabled, true);
  assert.equal(ready.challenge.kind, 'scored');
  assert.equal(ready.feedbackPresentation, 'after_attempt');
  assert.equal(ready.requiresInputPermission, true);

  const noEvidence = resolvePracticePolicy(input({
    mode: 'challenge', evidence: {selected: [], available: []},
  }));
  assert.equal(noEvidence.challenge.kind, 'blocked');
  assert.equal(noEvidence.challenge.reasonCode, 'evidence_required');
  assert.equal(noEvidence.mayScore, false);
});

test('unassessed and insufficient evidence are distinct from a low score', () => {
  const low = classifyAttemptOutcome({
    interrupted: false, assessmentEnabled: true, evidenceRequired: true,
    evidenceSufficient: true, score: 12,
  });
  assert.deepEqual(low, {status: 'completed', score: 12, reasonCode: 'completed'});

  const insufficient = classifyAttemptOutcome({
    interrupted: false, assessmentEnabled: true, evidenceRequired: true,
    evidenceSufficient: false, score: null,
  });
  assert.equal(insufficient.status, 'insufficient_evidence');
  assert.equal(insufficient.score, null);

  const unassessed = classifyAttemptOutcome({
    interrupted: false, assessmentEnabled: false, evidenceRequired: false,
    evidenceSufficient: false, score: null,
  });
  assert.equal(unassessed.status, 'unassessed');
  assert.equal(unassessed.score, null);

  const interrupted = classifyAttemptOutcome({
    interrupted: true, assessmentEnabled: true, evidenceRequired: true,
    evidenceSufficient: true, score: 90,
  });
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.score, null, 'a partial run is not a score');
});

test('a challenge on an Act without one is blocked', () => {
  const policy = resolvePracticePolicy(input({
    mode: 'challenge', act: {...BODY, supportsChallenge: false},
  }));
  assert.equal(policy.challenge.kind, 'blocked');
  assert.equal(policy.challenge.reasonCode, 'act_unsupported');
});

test('adapter resources release exactly once, even when one release throws', async () => {
  const released: string[] = [];
  const bag = createResourceBag();
  for (const kind of ['camera', 'microphone', 'audio', 'subscription',
    'animation_frame', 'worker'] as const) {
    bag.add({kind, release: () => { released.push(kind); }});
  }
  bag.add({kind: 'worker', release: () => { throw new Error('worker already gone'); }});
  assert.equal(bag.size(), 7);
  const first = await bag.releaseAll();
  assert.equal(first.released, 6);
  assert.equal(first.failed, 1);
  assert.equal(bag.size(), 0);
  assert.deepEqual(released.sort(), ['animation_frame', 'audio', 'camera', 'microphone',
    'subscription', 'worker']);
  const second = await bag.releaseAll();
  assert.deepEqual(second, {released: 0, failed: 0}, 'release is idempotent');
});

test('the practice adapter contract is explicit and guarded', () => {
  assert.throws(() => assertPracticeAdapter({actId: 'piano'} as unknown as ActPracticeAdapter),
    /missing buildPlan/);
  const adapter: ActPracticeAdapter = {
    actId: 'full_body',
    buildPlan: ({lessonId, revisionId, duration, units}) =>
      definePracticePlan({lessonId, revisionId, duration, units}),
    createTransport: () => ({
      snapshot: () => emptyTransportSnapshot(),
      play: async () => {},
      pause: () => {},
      seek: () => {},
      setRate: () => {},
      subscribe: () => () => {},
      advance: () => emptyTransportSnapshot(),
      destroy: () => {},
    }),
    prepareInputs: async () => createResourceBag(),
    stage: {kind: 'body', id: 'motion-stage'},
    assessmentSupport: () => ({supported: true, adapterId: 'pose-v1', rubricVersion: 'pose-v1'}),
    settings: () => ['camera', 'layout'],
    capabilities: () => BODY_CAPABILITIES,
  };
  assert.doesNotThrow(() => assertPracticeAdapter(adapter));
});
