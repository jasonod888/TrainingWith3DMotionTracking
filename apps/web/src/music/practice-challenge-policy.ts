/**
 * Pure music challenge eligibility. Production and tests use this exact function;
 * a blocked policy can never leave an eligible-looking challenge button.
 */
import {resolvePracticePolicy, type PracticePolicy} from '../../../../packages/learning-engine/practice-policy';

export type MusicChallengeInput = {
  subject: 'piano' | 'guitar';
  assessmentEnabled: boolean;
  challengeEnabled: boolean;
  referencePlayable: boolean;
  referenceReviewed: boolean;
  configuredEligible: boolean;
};

export type MusicChallengeEligibility = {
  buttonEligible: boolean;
  challengePolicy: PracticePolicy;
  practicePolicy: PracticePolicy;
};

export function resolveMusicChallengeEligibility(input: MusicChallengeInput): MusicChallengeEligibility {
  const adapter = input.assessmentEnabled
    ? `${input.subject === 'guitar' ? 'guitar' : 'piano'}-notes-v1` : null;
  const act = {
    id: input.subject,
    supportsChallenge: input.subject === 'piano' && input.challengeEnabled,
    allowsUnassessedChallenge: false,
    assessmentAdapterId: adapter,
    rubricVersion: adapter ? 'v1' : null,
    defaultFeedback: 'after_attempt' as const,
    practiceInputs: ['midi', 'microphone'] as const,
  };
  const creator = {assessmentAllowed: input.assessmentEnabled, feedbackAllowed: true};
  const learner = {feedback: 'on' as const, inputs: ['midi'] as const};
  const reference = {reviewed: input.referenceReviewed, eligible: input.referencePlayable};
  const challengePolicy = resolvePracticePolicy({
    mode: 'challenge', act, creator, learner, reference,
    evidence: {selected: ['midi'], available: ['midi']},
  });
  const practicePolicy = resolvePracticePolicy({
    mode: 'practice', act, creator, learner, reference,
    evidence: {selected: [], available: []},
  });
  return {
    challengePolicy, practicePolicy,
    buttonEligible: input.configuredEligible && act.supportsChallenge
      && challengePolicy.modeAllowed && challengePolicy.mayScore,
  };
}
