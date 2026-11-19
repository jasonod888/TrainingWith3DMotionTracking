/**
 * Independent practice policy axes.
 *
 * These are deliberately NOT one enum:
 *   mode                  watch | practice | challenge
 *   assessment            disabled(reason) | enabled(adapter/rubric)
 *   feedbackPresentation  live | after_attempt | hidden | unavailable
 *   evidenceInput         a selected input set, or none
 *
 * The combinations that matter:
 * - practice with no assessment is valid and needs no device permission;
 * - an unassessed challenge is a structured personal attempt with no score;
 * - an assessed challenge hides live feedback and reports after completion;
 * - "no feedback" means either hiding presentation or disabling assessment —
 *   never the same switch;
 * - a creator-disabled assessment can never be re-enabled by a learner.
 */
export type PracticeMode = 'watch' | 'practice' | 'challenge';
export type FeedbackPresentation = 'live' | 'after_attempt' | 'hidden' | 'unavailable';
export type EvidenceInput = 'camera' | 'midi' | 'microphone' | 'uploaded_recording' | 'pointer_stylus';

export type LearnerFeedbackChoice = 'on' | 'hide_live_feedback' | 'disable_assessment';

export type AssessmentDisabledReason =
  | 'no_adapter'
  | 'reference_not_eligible'
  | 'creator_disabled'
  | 'learner_disabled';

export type AssessmentState =
  | {enabled: false; reasonCode: AssessmentDisabledReason; explanation: string}
  | {enabled: true; adapterId: string; rubricVersion: string};

export type ActPracticePolicy = {
  id: string;
  supportsChallenge: boolean;
  /** True when the Act permits a scored-less personal challenge attempt. */
  allowsUnassessedChallenge: boolean;
  assessmentAdapterId: string | null;
  rubricVersion: string | null;
  defaultFeedback: 'live' | 'after_attempt';
  practiceInputs: readonly EvidenceInput[];
};

export type CreatorPracticePolicy = {
  assessmentAllowed: boolean;
  feedbackAllowed: boolean;
};

export type ReferenceEligibility = {reviewed: boolean; eligible: boolean};

export type EvidenceSelection = {
  /** Inputs the learner selected/attached. */
  selected: readonly EvidenceInput[];
  /** Inputs the device can actually provide right now. */
  available: readonly EvidenceInput[];
};

export type ChallengeDecision = {
  kind: 'scored' | 'unassessed' | 'blocked';
  reasonCode: string;
  explanation: string;
};

export type PracticePolicy = {
  mode: PracticeMode;
  assessment: AssessmentState;
  feedbackPresentation: FeedbackPresentation;
  evidenceInputs: EvidenceInput[] | 'none';
  challenge: ChallengeDecision;
  /** Only an assessed attempt that actually uses an input may prompt for it. */
  requiresInputPermission: boolean;
  /** The requested mode itself is permitted (a blocked challenge is not). */
  modeAllowed: boolean;
  mayScore: boolean;
};

export type PracticePolicyInput = {
  mode: PracticeMode;
  act: ActPracticePolicy;
  creator: CreatorPracticePolicy;
  learner: {feedback: LearnerFeedbackChoice; inputs?: readonly EvidenceInput[]};
  reference: ReferenceEligibility;
  evidence: EvidenceSelection;
};

const REASONS: Record<AssessmentDisabledReason, string> = {
  no_adapter: 'This Act has no assessment adapter.',
  reference_not_eligible: 'This reference is not eligible for assessment.',
  creator_disabled: 'The creator turned assessment off for this lesson.',
  learner_disabled: 'You turned assessment off for this lesson.',
};

function resolveAssessment(input: PracticePolicyInput): AssessmentState {
  const {act, creator, learner, reference, mode} = input;
  if (!act.assessmentAdapterId || !act.rubricVersion) {
    return {enabled: false, reasonCode: 'no_adapter', explanation: REASONS.no_adapter};
  }
  if (!reference.eligible || (mode === 'challenge' && !reference.reviewed)) {
    return {enabled: false, reasonCode: 'reference_not_eligible',
      explanation: REASONS.reference_not_eligible};
  }
  // Creator policy is authoritative: a learner preference cannot override it.
  if (!creator.assessmentAllowed) {
    return {enabled: false, reasonCode: 'creator_disabled', explanation: REASONS.creator_disabled};
  }
  if (learner.feedback === 'disable_assessment') {
    return {enabled: false, reasonCode: 'learner_disabled', explanation: REASONS.learner_disabled};
  }
  return {enabled: true, adapterId: act.assessmentAdapterId, rubricVersion: act.rubricVersion};
}

export function resolvePracticePolicy(input: PracticePolicyInput): PracticePolicy {
  const assessment = resolveAssessment(input);
  const selected = input.evidence.selected;
  const usable = selected.filter(value => input.evidence.available.includes(value));

  let challenge: ChallengeDecision;
  if (input.mode !== 'challenge') {
    challenge = {kind: 'blocked', reasonCode: 'not_challenge',
      explanation: 'This attempt is not a challenge.'};
  } else if (!input.act.supportsChallenge) {
    challenge = {kind: 'blocked', reasonCode: 'act_unsupported',
      explanation: 'This Act has no challenge mode.'};
  } else if (assessment.enabled) {
    challenge = usable.length > 0
      ? {kind: 'scored', reasonCode: 'scored',
        explanation: 'A scored challenge needs this evidence input.'}
      : {kind: 'blocked', reasonCode: 'evidence_required',
        explanation: 'Connect an evidence input before starting a scored challenge.'};
  } else if (input.act.allowsUnassessedChallenge) {
    challenge = {kind: 'unassessed', reasonCode: assessment.reasonCode,
      explanation: 'This challenge records a personal attempt without a score.'};
  } else {
    challenge = {kind: 'blocked', reasonCode: 'assessment_required',
      explanation: 'This Act requires assessment for a challenge.'};
  }

  let feedbackPresentation: FeedbackPresentation;
  if (input.mode === 'watch' || !assessment.enabled) {
    // An unassessed attempt has no score to present; it never invents feedback.
    feedbackPresentation = 'hidden';
  } else if (!input.creator.feedbackAllowed) {
    feedbackPresentation = 'unavailable';
  } else if (input.learner.feedback === 'hide_live_feedback' || input.mode === 'challenge') {
    // An assessed challenge hides live cues and reports after completion.
    feedbackPresentation = 'after_attempt';
  } else {
    feedbackPresentation = input.act.defaultFeedback;
  }

  const requiresInputPermission = input.mode !== 'watch' && assessment.enabled
    && usable.length > 0;
  const mayScore = assessment.enabled
    && (input.mode !== 'challenge' || challenge.kind === 'scored');

  return {
    mode: input.mode,
    assessment,
    feedbackPresentation,
    evidenceInputs: usable.length ? usable : 'none',
    challenge,
    requiresInputPermission,
    modeAllowed: input.mode !== 'challenge' || challenge.kind !== 'blocked',
    mayScore,
  };
}

/** True when the learner may start an unassessed challenge for this Act. */
export function unassessedChallengeAllowed(input: PracticePolicyInput): boolean {
  return input.mode === 'challenge'
    && input.act.supportsChallenge
    && input.act.allowsUnassessedChallenge
    && !resolveAssessment(input).enabled;
}

// ---------------------------------------------------------------------------
// Attempt outcome: unassessed / insufficient evidence / low score are distinct.
// ---------------------------------------------------------------------------

export type AttemptOutcomeStatus =
  | 'completed'
  | 'interrupted'
  | 'unassessed'
  | 'insufficient_evidence';

export type AttemptOutcome = {
  status: AttemptOutcomeStatus;
  /** Null unless a real, qualified score exists. Never fabricated. */
  score: number | null;
  reasonCode: string;
};

export function classifyAttemptOutcome(input: {
  interrupted: boolean;
  assessmentEnabled: boolean;
  evidenceRequired: boolean;
  evidenceSufficient: boolean;
  score: number | null;
}): AttemptOutcome {
  if (input.interrupted) {
    // A partial run is interrupted, not a low score.
    return {status: 'interrupted', score: null, reasonCode: 'interrupted'};
  }
  if (!input.assessmentEnabled) {
    return {status: 'unassessed', score: null, reasonCode: 'unassessed'};
  }
  if (input.evidenceRequired && !input.evidenceSufficient) {
    return {status: 'insufficient_evidence', score: null, reasonCode: 'insufficient_evidence'};
  }
  if (input.score === null || !Number.isFinite(input.score)) {
    return {status: 'insufficient_evidence', score: null, reasonCode: 'no_qualified_score'};
  }
  // A low score is still a completed score.
  return {status: 'completed', score: input.score, reasonCode: 'completed'};
}
