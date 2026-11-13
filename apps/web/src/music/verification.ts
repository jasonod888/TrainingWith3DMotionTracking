/** Owner-facing verification report types, parsing and API calls. */
import type {MusicDraftEvent} from '../../../../packages/lesson-schema/index';
import {ApiError, request} from '../api';

export type VerificationEdit = {op: string; event_ids: string[]; before: unknown; after: unknown; reason?: string};
export type FindingSummary = {
  kind: string; status?: string; pitch: number | null; time_range: [number, number]; explanation: string;
};
export type VerificationFinding = FindingSummary & {
  id: string; status: 'suggested' | 'flagged' | 'unresolved';
  event_ids: string[]; evidence: Record<string, unknown>; alternatives: unknown[];
  proposed_edits: VerificationEdit[]; ambiguous: boolean; ambiguity_reasons: string[];
  correction_status?: 'diagnostic' | 'qualified' | 'withheld' | 'none';
  withheld_reason?: string;
  qualification?: {policy_version: string; category: string};
};
export type VerificationDecision = {
  finding_id: string; decision: 'accepted' | 'rejected'; decided_at: string | null;
  report_sha256?: string | null; edits: VerificationEdit[]; finding?: FindingSummary;
};
export type VerificationReport = {
  schema_version: 1; verifier_version: string; mode: string; status: string;
  source: {proposal_sha256: string; audio_sha256: string | null; duration?: number; note_count?: number};
  findings: VerificationFinding[];
  summary: {finding_count?: number; suggested_count?: number; unresolved_count?: number; runtime_seconds?: number};
  warnings?: string[];
  coverage?: Record<string, unknown>;
  correction_policy?: {
    mode: string; policy_version: string | null; policy_sha256: string | null;
    enabled_categories: string[]; withheld_count?: number;
  };
};
export type AutomaticCorrection = {
  finding_id: string; kind: string; applied_at: string; reverted_at?: string | null;
  policy_sha256?: string | null; report_sha256?: string | null; edits: unknown[];
};
export type VerificationState = {
  schema_version: 1; available: boolean; draft_id: string; lesson_id: string;
  proposal_sha256: string; report_proposal_sha256: string | null; report_sha256: string | null;
  stale: boolean; report_error: string | null; invalid_working: string | null;
  working_corrected?: boolean; automatic_corrections?: AutomaticCorrection[];
  decisions: VerificationDecision[]; events: MusicDraftEvent[]; conflicts: string[]; state_token: string;
  report: VerificationReport | null;
};

type Parsed<T> = {ok: true; value: T} | {ok: false; message: string};
const fail = (message: string): Parsed<never> => ({ok: false, message});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isTimeRange = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1]) && value[0] <= value[1];

const EVENT_KEYS = ['id', 'onset', 'duration', 'notation_duration', 'pitch', 'velocity', 'confidence', 'optional', 'string', 'fret'];
const EDIT_KEYS = ['op', 'event_ids', 'before', 'after', 'reason'];

function readEvent(value: unknown): MusicDraftEvent | null {
  if (!isRecord(value) || Object.keys(value).some(key => !EVENT_KEYS.includes(key))) return null;
  if (!isText(value.id) || !isNumber(value.onset) || value.onset < 0 || !Number.isInteger(value.pitch) ||
      (value.pitch as number) < 0 || (value.pitch as number) > 127) return null;
  const duration = value.duration ?? null, notationDuration = value.notation_duration ?? null, velocity = value.velocity ?? null;
  const confidence = value.confidence ?? null, optional = value.optional ?? false;
  if (duration !== null && (!isNumber(duration) || duration <= 0)) return null;
  if (notationDuration !== null && (!isNumber(notationDuration) || notationDuration <= 0)) return null;
  if (velocity !== null && (!isNumber(velocity) || velocity < 0 || velocity > 1)) return null;
  if (confidence !== null && (!isNumber(confidence) || confidence < 0 || confidence > 1)) return null;
  if (typeof optional !== 'boolean') return null;
  const string = value.string ?? null, fret = value.fret ?? null;
  if ((string === null) !== (fret === null)) return null;
  if (string !== null && (!Number.isInteger(string) || (string as number) < 1 || (string as number) > 6)) return null;
  if (fret !== null && (!Number.isInteger(fret) || (fret as number) < 0 || (fret as number) > 24)) return null;
  return {id: value.id as string, onset: value.onset as number, duration: duration as number | null,
    notation_duration: notationDuration as number | null,
    pitch: value.pitch as number, velocity: velocity as number | null, confidence: confidence as number | null,
    optional, string: string as number | null, fret: fret as number | null};
}

function readEdit(value: unknown): VerificationEdit | null {
  if (!isRecord(value) || Object.keys(value).some(key => !EDIT_KEYS.includes(key))) return null;
  if (!isText(value.op) || !Array.isArray(value.event_ids) ||
      value.event_ids.some(id => !isText(id)) ||
      !(value.after === null || isRecord(value.after) || Array.isArray(value.after))) return null;
  if ('before' in value && value.before !== null && !isRecord(value.before) && !Array.isArray(value.before)) return null;
  if ('reason' in value && !isText(value.reason)) return null;
  return {op: value.op as string, event_ids: [...value.event_ids] as string[],
    before: value.before ?? null, after: value.after, ...(value.reason ? {reason: value.reason as string} : {})};
}

function readFinding(value: unknown): VerificationFinding | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.kind) || !isText(value.explanation)) return null;
  if (!['suggested', 'flagged', 'unresolved'].includes(String(value.status))) return null;
  if (!isTimeRange(value.time_range) || !Array.isArray(value.event_ids) ||
      value.event_ids.some(id => !isText(id))) return null;
  if (!(value.pitch === null || Number.isInteger(value.pitch))) return null;
  if (!isRecord(value.evidence) || !Array.isArray(value.alternatives) ||
      !Array.isArray(value.proposed_edits) || typeof value.ambiguous !== 'boolean' ||
      !Array.isArray(value.ambiguity_reasons) || value.ambiguity_reasons.some(reason => !isText(reason))) return null;
  const edits: VerificationEdit[] = [];
  for (const edit of value.proposed_edits) { const parsed = readEdit(edit); if (!parsed) return null; edits.push(parsed); }
  if (value.correction_status !== undefined &&
      !['diagnostic', 'qualified', 'withheld', 'none'].includes(String(value.correction_status))) return null;
  if (value.withheld_reason !== undefined && !isText(value.withheld_reason)) return null;
  if (value.qualification !== undefined && (!isRecord(value.qualification) ||
      !isText(value.qualification.policy_version) || !isText(value.qualification.category))) return null;
  return {id: value.id, kind: value.kind, status: value.status as VerificationFinding['status'],
    time_range: value.time_range, event_ids: [...value.event_ids] as string[],
    pitch: value.pitch as number | null, explanation: value.explanation,
    evidence: value.evidence, alternatives: [...value.alternatives], proposed_edits: edits,
    ambiguous: value.ambiguous, ambiguity_reasons: [...value.ambiguity_reasons] as string[],
    ...(value.correction_status !== undefined
      ? {correction_status: value.correction_status as VerificationFinding['correction_status']} : {}),
    ...(value.withheld_reason !== undefined ? {withheld_reason: value.withheld_reason as string} : {}),
    ...(value.qualification !== undefined
      ? {qualification: value.qualification as NonNullable<VerificationFinding['qualification']>} : {})};
}

function readSummary(value: unknown): FindingSummary | undefined {
  if (!isRecord(value) || !isText(value.kind) || !isTimeRange(value.time_range) ||
      !isText(value.explanation) || !(value.pitch === null || Number.isInteger(value.pitch))) return undefined;
  return {kind: value.kind, status: value.status ? String(value.status) : undefined,
    pitch: value.pitch as number | null, time_range: value.time_range, explanation: value.explanation};
}

function readDecision(value: unknown): VerificationDecision | null {
  if (!isRecord(value) || !isText(value.finding_id) || !['accepted', 'rejected'].includes(String(value.decision))) return null;
  if (!(value.decided_at === null || isText(value.decided_at)) || !Array.isArray(value.edits)) return null;
  const edits: VerificationEdit[] = [];
  for (const edit of value.edits) { const parsed = readEdit(edit); if (!parsed) return null; edits.push(parsed); }
  const summary = value.finding === undefined ? undefined : readSummary(value.finding);
  if (value.report_sha256 !== undefined && !(value.report_sha256 === null || isHash(value.report_sha256))) return null;
  return {finding_id: value.finding_id, decision: value.decision as 'accepted' | 'rejected',
    decided_at: value.decided_at as string | null,
    report_sha256: value.report_sha256 as string | null | undefined,
    edits, ...(summary ? {finding: summary} : {})};
}

export function parseVerificationState(value: unknown): Parsed<VerificationState> {
  if (!isRecord(value) || value.schema_version !== 1 || typeof value.available !== 'boolean' ||
      !isText(value.draft_id) || !isText(value.lesson_id) || !isHash(value.proposal_sha256) ||
      !isHash(value.state_token) ||
      !(value.report_proposal_sha256 === null || isHash(value.report_proposal_sha256)) ||
      !(value.report_sha256 === null || isHash(value.report_sha256)) ||
      typeof value.stale !== 'boolean' ||
      !(value.report_error === null || isText(value.report_error)) ||
      !(value.invalid_working === null || isText(value.invalid_working)) ||
      !Array.isArray(value.decisions) || !Array.isArray(value.events) || !Array.isArray(value.conflicts) ||
      value.conflicts.some(item => !isText(item))) return fail('This verification report could not be read. Reopen the review.');
  if (value.available && !isRecord(value.report)) return fail('This verification report could not be read. Reopen the review.');
  if (!value.available && value.report !== null) return fail('This verification report could not be read. Reopen the review.');
  const events: MusicDraftEvent[] = [];
  for (const event of value.events) { const parsed = readEvent(event); if (!parsed) return fail('The revised proposal could not be read.'); events.push(parsed); }
  const decisions: VerificationDecision[] = [];
  for (const decision of value.decisions) { const parsed = readDecision(decision); if (!parsed) return fail('A verification decision could not be read.'); decisions.push(parsed); }
  let automatic: AutomaticCorrection[] = [];
  if (value.automatic_corrections !== undefined) {
    if (!Array.isArray(value.automatic_corrections) || value.automatic_corrections.length > 500) {
      return fail('Automatic correction history could not be read.');
    }
    for (const item of value.automatic_corrections) {
      if (!isRecord(item) || !isText(item.finding_id) || !isText(item.kind) ||
          !isText(item.applied_at) || !Array.isArray(item.edits) ||
          !(item.reverted_at == null || isText(item.reverted_at))) {
        return fail('Automatic correction history could not be read.');
      }
      automatic.push({finding_id: item.finding_id, kind: item.kind,
        applied_at: item.applied_at, reverted_at: (item.reverted_at as string | null | undefined) ?? null,
        policy_sha256: (item.policy_sha256 as string | null | undefined) ?? null,
        report_sha256: (item.report_sha256 as string | null | undefined) ?? null,
        edits: [...item.edits]});
    }
  }
  let report: VerificationReport | null = null;
  if (value.available) {
    const raw = value.report as Record<string, unknown>;
    if (raw.schema_version !== 1 || !isText(raw.verifier_version) || !isRecord(raw.source) ||
        !isHash(raw.source.proposal_sha256) || !Array.isArray(raw.findings) || !isRecord(raw.summary)) {
      return fail('This verification report could not be read. Reopen the review.');
    }
    const findings: VerificationFinding[] = [];
    for (const finding of raw.findings) { const parsed = readFinding(finding); if (!parsed) return fail('A verification finding could not be read.'); findings.push(parsed); }
    report = {schema_version: 1, verifier_version: raw.verifier_version,
      mode: String(raw.mode ?? ''), status: String(raw.status ?? 'complete'),
      source: raw.source as VerificationReport['source'], findings,
      summary: raw.summary as VerificationReport['summary'],
      ...(Array.isArray(raw.warnings) ? {warnings: raw.warnings.filter(isText)} : {}),
      ...(isRecord(raw.coverage) ? {coverage: raw.coverage} : {}),
      ...(isRecord(raw.correction_policy) ? {correction_policy: {
        mode: String(raw.correction_policy.mode ?? ''),
        policy_version: typeof raw.correction_policy.policy_version === 'string'
          ? raw.correction_policy.policy_version : null,
        policy_sha256: isHash(raw.correction_policy.policy_sha256)
          ? raw.correction_policy.policy_sha256 : null,
        enabled_categories: Array.isArray(raw.correction_policy.enabled_categories)
          ? raw.correction_policy.enabled_categories.filter(isText) : [],
        ...(typeof raw.correction_policy.withheld_count === 'number'
          ? {withheld_count: raw.correction_policy.withheld_count} : {}),
      }} : {})};
  }
  return {ok: true, value: {
    schema_version: 1, available: value.available, draft_id: value.draft_id, lesson_id: value.lesson_id,
    proposal_sha256: value.proposal_sha256, report_proposal_sha256: value.report_proposal_sha256,
    report_sha256: value.report_sha256, stale: value.stale, report_error: value.report_error,
    invalid_working: value.invalid_working, decisions, events,
    ...(typeof value.working_corrected === 'boolean' ? {working_corrected: value.working_corrected} : {}),
    automatic_corrections: automatic,
    conflicts: [...value.conflicts] as string[], state_token: value.state_token, report,
  }};
}

export async function loadVerification(lessonId: string, draftId: string): Promise<unknown | null> {
  try {
    return await request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-analysis/verification?draft_id=${encodeURIComponent(draftId)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function decideVerification(lessonId: string, draftId: string, baseProposalSha256: string,
                                   baseStateToken: string, baseReportSha256: string | null,
                                   findingId: string, decision: 'accepted' | 'rejected' | 'cleared') {
  return request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-draft/verification-decision`, 'POST',
    {draft_id: draftId, base_proposal_sha256: baseProposalSha256, base_state_token: baseStateToken,
     base_report_sha256: baseReportSha256, finding_id: findingId, decision});
}

export const findingDecision = (state: VerificationState, findingId: string) =>
  state.decisions.find(item => item.finding_id === findingId);

export function rollbackAutomaticCorrections(lessonId: string, draftId: string,
                                             baseStateToken: string) {
  return request<{rolled_back: boolean; draft_id: string}>(
    `/lessons/${encodeURIComponent(lessonId)}/music-draft/corrections/rollback`, 'POST',
    {draft_id: draftId, base_state_token: baseStateToken});
}
