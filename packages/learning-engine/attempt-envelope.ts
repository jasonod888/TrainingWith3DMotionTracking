/**
 * Neutral attempt envelope shared by every Act.
 *
 * It carries identity and lifecycle only. A score is never a top-level field:
 * Act-specific assessment stays inside `report`, and body/music report formats are
 * preserved rather than made comparable. Unassessed and insufficient-evidence
 * attempts are first-class statuses, not failures.
 */
import type {AttemptOutcomeStatus} from './practice-policy';

export type PracticeAttemptStatus = AttemptOutcomeStatus;

export type PracticeAttemptEnvelope = {
  attemptId: string;
  lessonId: string;
  revisionId: string;
  actId: string;
  mode: 'watch' | 'practice' | 'challenge';
  planId: string;
  unitId: string | null;
  durationMs: number;
  status: PracticeAttemptStatus;
  assessmentAdapter: string | null;
  rubricVersion: string | null;
  /** Optional Act-specific report. Never a cross-Act comparable score. */
  report?: Record<string, unknown>;
};

export type BuildAttemptInput = {
  attemptId: string;
  lessonId: string;
  revisionId: string;
  actId: string;
  mode: PracticeAttemptEnvelope['mode'];
  planId: string;
  unitId?: string | null;
  durationMs: number;
  status: PracticeAttemptStatus;
  assessmentAdapter?: string | null;
  rubricVersion?: string | null;
  report?: Record<string, unknown>;
};

export function buildAttemptEnvelope(input: BuildAttemptInput): PracticeAttemptEnvelope {
  // An unassessed attempt never claims an adapter or rubric.
  const assessed = input.status !== 'unassessed';
  const adapter = assessed ? input.assessmentAdapter ?? null : null;
  const rubric = assessed ? input.rubricVersion ?? null : null;
  return {
    attemptId: input.attemptId,
    lessonId: input.lessonId,
    revisionId: input.revisionId,
    actId: input.actId,
    mode: input.mode,
    planId: input.planId,
    unitId: input.unitId ?? null,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    status: input.status,
    assessmentAdapter: adapter,
    rubricVersion: rubric,
    ...(input.report ? {report: input.report} : {}),
  };
}

export type AttemptValidation =
  | {ok: true; value: PracticeAttemptEnvelope}
  | {ok: false; message: string};

const MODES = new Set(['watch', 'practice', 'challenge']);
const STATUSES = new Set(['completed', 'interrupted', 'unassessed', 'insufficient_evidence']);
const KEYS = new Set(['attemptId', 'lessonId', 'revisionId', 'actId', 'mode', 'planId',
  'unitId', 'durationMs', 'status', 'assessmentAdapter', 'rubricVersion', 'report']);

export function validateAttemptEnvelope(value: unknown): AttemptValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {ok: false, message: 'The attempt envelope could not be read.'};
  }
  const record = value as Record<string, unknown>;
  // A top-level score is exactly the cross-Act comparison this envelope prevents.
  if (Object.keys(record).some(key => !KEYS.has(key))) {
    return {ok: false, message: 'The attempt envelope has unexpected fields.'};
  }
  for (const name of ['attemptId', 'lessonId', 'revisionId', 'actId', 'planId'] as const) {
    if (typeof record[name] !== 'string' || !(record[name] as string).trim()) {
      return {ok: false, message: `The attempt envelope is missing ${name}.`};
    }
  }
  if (!MODES.has(String(record.mode))) return {ok: false, message: 'Unknown practice mode.'};
  if (!STATUSES.has(String(record.status))) return {ok: false, message: 'Unknown attempt status.'};
  if (typeof record.durationMs !== 'number' || !Number.isFinite(record.durationMs)
      || record.durationMs < 0) {
    return {ok: false, message: 'The attempt duration is invalid.'};
  }
  if (record.unitId !== null && record.unitId !== undefined && typeof record.unitId !== 'string') {
    return {ok: false, message: 'The attempt unit is invalid.'};
  }
  const adapter = record.assessmentAdapter ?? null;
  const rubric = record.rubricVersion ?? null;
  if (adapter !== null && typeof adapter !== 'string' || rubric !== null && typeof rubric !== 'string') {
    return {ok: false, message: 'The attempt assessment identity is invalid.'};
  }
  if (record.status === 'unassessed' && (adapter !== null || rubric !== null)) {
    return {ok: false, message: 'An unassessed attempt cannot claim an assessment adapter.'};
  }
  if (record.status === 'completed' && (adapter === null || rubric === null)) {
    return {ok: false, message: 'A completed assessed attempt needs its adapter and rubric.'};
  }
  if (record.report !== undefined && (typeof record.report !== 'object' || record.report === null
      || Array.isArray(record.report))) {
    return {ok: false, message: 'The attempt report must be an object.'};
  }
  return {ok: true, value: {
    ...(record as unknown as PracticeAttemptEnvelope),
    unitId: (record.unitId as string | null | undefined) ?? null,
    assessmentAdapter: adapter,
    rubricVersion: rubric,
  }};
}
