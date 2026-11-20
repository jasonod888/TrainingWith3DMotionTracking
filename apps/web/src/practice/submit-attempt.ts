/** One neutral attempt submission path: envelope, wire, guard and local fallback. */
import {buildAttemptEnvelope, type PracticeAttemptEnvelope} from '../../../../packages/learning-engine/attempt-envelope';
import {submitPracticeAttempt as postPracticeAttempt} from '../api';
import {saveLocalAttempt} from './practice-store';
import type {SessionGuard} from './session-guard';

export type SubmitAttemptInput = {
  attemptId: string;
  lessonId: string;
  revisionId: string;
  actId: string;
  mode: 'watch' | 'practice' | 'challenge';
  planId: string;
  unitId?: string | null;
  durationMs: number;
  status: PracticeAttemptEnvelope['status'];
  assessmentAdapter?: string | null;
  rubricVersion?: string | null;
  report?: Record<string, unknown>;
  accountScope: string;
};

export async function submitAttempt(input: SubmitAttemptInput, options: {
  guard?: SessionGuard | null;
  localOnly?: boolean;
} = {}): Promise<{ok: boolean; envelope: PracticeAttemptEnvelope; error?: unknown}> {
  const envelope = buildAttemptEnvelope(input);
  if (options.localOnly) {
    saveLocalAttempt(input.accountScope, envelope);
    return {ok: false, envelope};
  }
  try {
    await postPracticeAttempt({
      attempt_id: envelope.attemptId, lesson_id: envelope.lessonId,
      revision_id: envelope.revisionId, act_id: envelope.actId, mode: envelope.mode,
      plan_id: envelope.planId, unit_id: envelope.unitId, duration_ms: envelope.durationMs,
      status: envelope.status, assessment_adapter: envelope.assessmentAdapter,
      rubric_version: envelope.rubricVersion, report: envelope.report,
    });
    return {ok: true, envelope};
  } catch (cause) {
    // Guest/offline/revoked: keep the neutral envelope on this device only.
    saveLocalAttempt(input.accountScope, envelope);
    await options.guard?.handleError(cause);
    return {ok: false, envelope, error: cause};
  }
}
