import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolvePracticePolicy} from '../../../packages/learning-engine/practice-policy';
import {resolveMusicChallengeEligibility} from '../src/music/practice-challenge-policy';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('active practice resolves the four-axis policy and persists neutral attempts', () => {
  const body = source('../src/PracticeWorkspace.tsx');
  assert.match(body, /resolvePracticePolicy\(/);
  assert.match(body, /import \{submitAttempt\} from '\.\/practice\/submit-attempt'/);
  assert.match(body, /submitAttempt\(\{attemptId:a\.id/,
    'the active practice attempt uses the shared submission owner');
  assert.match(body, /status:assessed\?'completed':'unassessed'/);
  assert.match(body, /guard:access\.guardRef\.current/,
    'the shared submission receives the session access guard');
  assert.ok(body.indexOf("if(compete){const policy=resolvePracticePolicy") <
    body.indexOf("onModeChange(compete?'compete':'practice')"),
    'challenge policy is checked before forwarding the mode change');
  const music = source('../src/music/workspace/PianoPracticeWorkspace.tsx');
  assert.match(music, /resolvePracticePolicy\(/);
  assert.match(music, /conservativeImport\(/);
  assert.match(music, /resolveMusicChallengeEligibility\(/);
  assert.match(music, /challengeEligible = challengePolicy\.buttonEligible/);
  const drawing = source('../src/acts/drawing/DrawingPracticeEntry.tsx');
  assert.match(drawing, /import \{submitAttempt\} from '\.\.\/\.\.\/practice\/submit-attempt'/);
  assert.match(drawing, /submitAttempt\(/);
  assert.match(drawing, /status: 'unassessed'/);
});

test('music challenge eligibility uses the real policy decision', () => {
  const piano = resolveMusicChallengeEligibility({subject: 'piano', assessmentEnabled: true,
    challengeEnabled: true, referencePlayable: true, referenceReviewed: true,
    configuredEligible: true});
  assert.equal(piano.buttonEligible, true);
  assert.equal(piano.challengePolicy.modeAllowed, true);
  assert.equal(piano.challengePolicy.mayScore, true);

  const guitar = resolveMusicChallengeEligibility({subject: 'guitar', assessmentEnabled: true,
    challengeEnabled: true, referencePlayable: true, referenceReviewed: true,
    configuredEligible: true});
  assert.equal(guitar.buttonEligible, false);

  const creatorOff = resolveMusicChallengeEligibility({subject: 'piano', assessmentEnabled: false,
    challengeEnabled: true, referencePlayable: true, referenceReviewed: true,
    configuredEligible: true});
  assert.equal(creatorOff.buttonEligible, false);
});
test('creator-disabled assessment stays disabled for the learner', () => {
  const policy = resolvePracticePolicy({
    mode: 'practice',
    act: {id: 'piano', supportsChallenge: false, allowsUnassessedChallenge: false,
      assessmentAdapterId: 'piano-notes-v1', rubricVersion: 'v1',
      defaultFeedback: 'after_attempt', practiceInputs: ['midi']},
    creator: {assessmentAllowed: false, feedbackAllowed: false},
    learner: {feedback: 'on', inputs: ['midi']},
    reference: {reviewed: true, eligible: true},
    evidence: {selected: ['midi'], available: ['midi']},
  });
  assert.equal(policy.assessment.enabled, false);
  assert.equal(policy.mayScore, false);
  assert.equal(policy.challenge.kind, 'blocked');
});
