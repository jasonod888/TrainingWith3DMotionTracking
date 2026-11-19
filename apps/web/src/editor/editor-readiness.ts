/**
 * Readiness is more than "the editor opened".
 *
 * `playbackValid` is required to review or practise a lesson. `assessmentReady`
 * is optional: an Act may offer a useful, valid, unassessed lesson, and the user
 * must never be told it is broken because scoring is unavailable.
 */
export type AssessmentSupport = 'supported' | 'unsupported' | 'unavailable';

export type ReadinessBlocker = {code: string; message: string};

export type EditorReadiness = {
  playbackValid: boolean;
  assessmentReady: boolean;
  reviewReady: boolean;
  assessmentSupport: AssessmentSupport;
  /** Why assessment is not ready, when it is not. Never a playback blocker. */
  unassessedReason: string | null;
  blockers: ReadinessBlocker[];
  warnings: string[];
};

export type ReadinessInput = {
  playback: {valid: boolean; reason?: string};
  assessment: {
    support: AssessmentSupport;
    available: boolean;
    reasonCode: string;
    explanation: string;
  };
  /** True while the Act still requires its specialized review step. */
  reviewRequired: boolean;
  warnings?: readonly string[];
};

export function editorReadiness(input: ReadinessInput): EditorReadiness {
  const blockers: ReadinessBlocker[] = [];
  if (!input.playback.valid) {
    blockers.push({
      code: 'invalid_playback',
      message: input.playback.reason ?? 'This lesson has no valid playback source.',
    });
  }
  const assessmentReady = input.assessment.support === 'supported'
    && input.assessment.available;
  return {
    playbackValid: input.playback.valid,
    assessmentReady,
    // Review may proceed unassessed; it may not proceed without valid playback.
    reviewReady: input.playback.valid && blockers.length === 0,
    assessmentSupport: input.assessment.support,
    unassessedReason: assessmentReady ? null : input.assessment.explanation,
    blockers,
    warnings: [...(input.warnings ?? [])],
  };
}

/** First blocking reason for an action, or null when the action may proceed. */
export function blockReason(readiness: EditorReadiness, action: 'review' | 'practice'): string | null {
  const requiresPlayback = action === 'review' || action === 'practice';
  if (requiresPlayback && !readiness.playbackValid) {
    return readiness.blockers[0]?.message ?? 'This lesson has no valid playback source.';
  }
  if (action === 'review' && !readiness.reviewReady) {
    return readiness.blockers[0]?.message ?? 'This lesson is not ready for review.';
  }
  return null;
}
