import type {LessonManifest} from '../../../../packages/lesson-schema/index';
import type {PracticeAttemptEnvelope} from '../../../../packages/learning-engine/attempt-envelope';
import {loadPlanProgress, loadProgress, savePlanProgress, saveProgress} from '../api';

/**
 * Shared progress/preferences contract.
 *
 * Keys always include lesson revision and plan identity. A record for another
 * revision or plan is rejected by the caller before it can move the learner to a
 * section that no longer exists. The body keeps its existing server endpoint;
 * music uses local-first storage with the same record shape.
 */
export type PracticeRecord = {
  revisionId: string;
  planId: string;
  unitId: string | null;
  time: number;
  speed: number;
  mode: 'sections' | 'continuous';
  loop: boolean;
  repetitions: number;
  countdownSeconds: number;
  restSeconds: number;
  updatedAt: number;
};

export type PracticePreferencesRecord = Pick<PracticeRecord,
  'speed' | 'mode' | 'loop' | 'repetitions' | 'countdownSeconds' | 'restSeconds'>;

export type PracticeIdentity = {
  lessonId: string;
  revisionId: string;
  planId: string;
  duration: number;
};

export type PracticeStore = {
  load(identity: PracticeIdentity): Promise<PracticeRecord | null>;
  save(identity: PracticeIdentity, record: PracticeRecord, keepalive?: boolean): Promise<void>;
  loadPreferences(identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>): PracticePreferencesRecord | null;
  savePreferences(identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>, preferences: PracticePreferencesRecord): void;
  /** Re-scope a local store when the signed-in account changes. */
  useAccount?: (accountId: string | null) => void;
};

const PREFIX = 'form-practice-v2';
const memory = new Map<string, PracticeRecord>();
const preferenceMemory = new Map<string, PracticePreferencesRecord>();

const scopeOf = (accountId: string | null | undefined) =>
  accountId ? `account:${accountId}` : 'guest';

const keyFor = (identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId' | 'planId'>, scope: string) =>
  `${PREFIX}:${scope}:${identity.lessonId}:${identity.revisionId}:${identity.planId}`;

const preferenceKey = (identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>, scope: string) =>
  `${PREFIX}:${scope}:preferences:${identity.lessonId}:${identity.revisionId}`;
const latestKey = (identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>, scope: string) =>
  `${PREFIX}:${scope}:latest:${identity.lessonId}:${identity.revisionId}`;

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

// The local keys predate accounts. A separate owner marker lets a conservative
// import decide whether a record may belong to the signed-in account at all.
const OWNER_PREFIX = 'form-practice-owner';
const ownerKey = (identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>, scope: string) =>
  `${OWNER_PREFIX}:${scope}:${identity.lessonId}:${identity.revisionId}`;

export function readLocalOwner(identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>, accountId: string | null = null): string | null {
  try { return storage()?.getItem(ownerKey(identity, scopeOf(accountId))) ?? null; } catch { return null; }
}

export function writeLocalOwner(identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>, accountId: string): void {
  try { storage()?.setItem(ownerKey(identity, scopeOf(accountId)), accountId); } catch { /* optional metadata */ }
}

function readLocal(identity: PracticeIdentity, scope: string): PracticeRecord | null {
  const key = keyFor(identity, scope);
  const cached = memory.get(key) ?? memory.get(latestKey(identity, scope));
  if (cached) return {...cached};
  try {
    const raw = storage()?.getItem(key) ?? storage()?.getItem(latestKey(identity, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PracticeRecord;
    if (!parsed || parsed.revisionId !== identity.revisionId || !Number.isFinite(parsed.time)) return null;
    memory.set(key, parsed);
    return {...parsed};
  } catch { return null; }
}

function writeLocal(identity: PracticeIdentity, record: PracticeRecord, scope: string) {
  const key = keyFor(identity, scope);
  memory.set(key, {...record});
  memory.set(latestKey(identity, scope), {...record});
  try {
    const target = storage();
    target?.setItem(key, JSON.stringify(record));
    // A revision-level pointer lets a changed plan (for example piano bars-per-chunk)
    // remap the last position by time instead of starting from the beginning.
    target?.setItem(latestKey(identity, scope), JSON.stringify(record));
  } catch { /* Practice still works. */ }
}

function readPreferences(identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>, scope: string): PracticePreferencesRecord | null {
  const key = preferenceKey(identity, scope);
  const cached = preferenceMemory.get(key);
  if (cached) return {...cached};
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PracticePreferencesRecord;
    preferenceMemory.set(key, parsed);
    return {...parsed};
  } catch { return null; }
}

function writePreferences(identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>, preferences: PracticePreferencesRecord, scope: string) {
  const key = preferenceKey(identity, scope);
  preferenceMemory.set(key, {...preferences});
  try { storage()?.setItem(key, JSON.stringify(preferences)); } catch { /* Preferences are optional. */ }
}

/** Local-first store used by music and as the rich-field companion for body. */
export function createLocalPracticeStore(accountId: string | null = null): PracticeStore {
  let scope = scopeOf(accountId);
  return {
    async load(identity) {
      return readLocal(identity, scope);
    },
    async save(identity, record) {
      if (record.revisionId !== identity.revisionId || record.planId !== identity.planId) return;
      writeLocal(identity, record, scope);
    },
    loadPreferences: (identity) => readPreferences(identity, scope),
    savePreferences: (identity, preferences) => writePreferences(identity, preferences, scope),
    useAccount(value) { scope = scopeOf(value); },
  };
}

const local = createLocalPracticeStore();

/**
 * Body store: the existing server endpoint remains the position authority;
 * section/plan/repetition fields are stored locally beside it. A server
 * failure never discards the local record.
 */
export function createBodyPracticeStore(lesson: LessonManifest, accountId: string | null = null): PracticeStore {
  const scope = scopeOf(accountId);
  return {
    async load(identity) {
      if (identity.revisionId !== lesson.revision_id) return null;
      // Body rich fields must use the same account scope as the server progress.
      const cached = readLocal(identity, scope);
      try {
        const progress = await loadProgress(lesson);
        if (!progress || progress.revision_id !== identity.revisionId) return cached;
        return {
          revisionId: progress.revision_id,
          planId: cached?.planId ?? identity.planId,
          unitId: cached?.unitId ?? null,
          time: progress.time,
          speed: progress.speed,
          mode: progress.mode,
          loop: cached?.loop ?? false,
          repetitions: cached?.repetitions ?? 0,
          countdownSeconds: cached?.countdownSeconds ?? 3,
          restSeconds: cached?.restSeconds ?? 2,
          updatedAt: Date.now(),
        };
      } catch {
        return cached;
      }
    },
    async save(identity, record, keepalive = false) {
      if (identity.revisionId !== lesson.revision_id || record.revisionId !== identity.revisionId) return;
      writeLocal(identity, record, scope);
      try {
        await saveProgress(lesson, {
          time: Math.max(0, Math.min(identity.duration, record.time)),
          speed: (([.25, .5, .75, 1] as const).includes(record.speed as .25 | .5 | .75 | 1)
            ? record.speed as .25 | .5 | .75 | 1 : 1),
          mode: record.mode,
        });
      } catch {
        // Keepalive/failed network saves still retain the local record.
      }
      void keepalive;
    },
    loadPreferences: (identity) => readPreferences(identity, scope),
    savePreferences: (identity, preferences) => writePreferences(identity, preferences, scope),
  };
}

/**
 * Authenticated Acts: server is the cross-device authority, local is the fallback.
 * A guest (null account) stays entirely local and never calls the service.
 */
export function createServerPracticeStore(input: {
  accountId: string | null;
  local?: PracticeStore;
}): PracticeStore {
  const fallback = input.local ?? createLocalPracticeStore(input.accountId);
  if (!input.accountId) return fallback;
  const accountId = input.accountId;
  return {
    async load(identity) {
      const cached = await fallback.load(identity);
      try {
        const value = await loadPlanProgress(identity.lessonId, identity.revisionId, identity.planId);
        if (!value) return cached;
        // Never apply another revision/plan's position.
        if (value.revision_id !== identity.revisionId || value.plan_id !== identity.planId) return cached;
        return {
          revisionId: value.revision_id,
          planId: value.plan_id,
          unitId: value.unit_id,
          time: value.time,
          speed: value.speed,
          mode: value.mode,
          loop: Boolean(value.loop),
          repetitions: value.repetitions,
          countdownSeconds: value.countdown_seconds,
          restSeconds: value.rest_seconds,
          updatedAt: value.updated_at ? Date.parse(value.updated_at) || Date.now() : Date.now(),
        };
      } catch {
        // Offline or service failure keeps the local record usable.
        return cached;
      }
    },
    async save(identity, record, keepalive = false) {
      if (identity.revisionId !== record.revisionId || identity.planId !== record.planId) return;
      writeLocalOwner(identity, accountId);
      await fallback.save(identity, record, keepalive);
      try {
        await savePlanProgress({
          lesson_id: identity.lessonId,
          revision_id: identity.revisionId,
          plan_id: identity.planId,
          unit_id: record.unitId,
          time: record.time,
          speed: record.speed,
          mode: record.mode,
          loop: record.loop,
          repetitions: record.repetitions,
          countdown_seconds: record.countdownSeconds,
          rest_seconds: record.restSeconds,
        });
      } catch {
        // The local record already holds the position; retry on the next save.
      }
    },
    loadPreferences: fallback.loadPreferences,
    savePreferences: fallback.savePreferences,
  };
}

export type LocalImportReason =
  | 'guest'
  | 'no_record'
  | 'cross_account'
  | 'revision_mismatch'
  | 'server_newer'
  | 'server_unavailable';

export type LocalImportDecision = {
  allowed: boolean;
  reason: LocalImportReason | null;
  record?: PracticeRecord;
};

/**
 * Conservative import of pre-sync local progress.
 *
 * Never imports into a guest session, across accounts, or across revisions.
 * A changed plan is accepted (the caller can remap by time) but the record is
 * re-scoped to the target plan id.
 */
export function conservativeImport(input: {
  accountId: string | null;
  localAccountId: string | null;
  localRecord: PracticeRecord | null;
  targetRevisionId: string;
  targetPlanId: string;
}): LocalImportDecision {
  if (!input.accountId) return {allowed: false, reason: 'guest'};
  if (!input.localRecord) return {allowed: false, reason: 'no_record'};
  if (!input.localAccountId || input.localAccountId !== input.accountId) {
    return {allowed: false, reason: 'cross_account'};
  }
  if (input.localRecord.revisionId !== input.targetRevisionId) {
    return {allowed: false, reason: 'revision_mismatch'};
  }
  return {
    allowed: true,
    reason: null,
    record: {...input.localRecord, planId: input.targetPlanId},
  };
}

/** Import is best-effort: a failed upload leaves local progress in place. */
export async function importLocalProgress(input: {
  accountId: string | null;
  localAccountId: string | null;
  localRecord: PracticeRecord | null;
  targetLessonId: string;
  targetRevisionId: string;
  targetPlanId: string;
}): Promise<LocalImportDecision> {
  const decision = conservativeImport(input);
  if (!decision.allowed || !decision.record) return decision;
  let server;
  try {
    server = await loadPlanProgress(input.targetLessonId, input.targetRevisionId, input.targetPlanId);
  } catch (cause) {
    if ((cause as {status?: number}).status === 404) server = null;
    else return {allowed: false, reason: 'server_unavailable'};
  }
  if (server) {
    const serverAt = server.updated_at ? Date.parse(server.updated_at) : Number.NaN;
    if (!Number.isFinite(serverAt) || !decision.record.updatedAt
        || serverAt >= decision.record.updatedAt) {
      return {allowed: false, reason: 'server_newer'};
    }
  }
  try {
    await savePlanProgress({
      lesson_id: input.targetLessonId,
      revision_id: input.targetRevisionId,
      plan_id: input.targetPlanId,
      unit_id: decision.record.unitId,
      time: decision.record.time,
      speed: decision.record.speed,
      mode: decision.record.mode,
      loop: decision.record.loop,
      repetitions: decision.record.repetitions,
      countdown_seconds: decision.record.countdownSeconds,
      rest_seconds: decision.record.restSeconds,
    });
    return decision;
  } catch {
    return {allowed: false, reason: 'server_unavailable'};
  }
}

export const practiceStore = local;

const attemptKey = (scope: string) => `${PREFIX}:${scope}:attempts`;

/** Guest/offline fallback: neutral attempts are still kept account-scoped. */
export function saveLocalAttempt(accountId: string | null, envelope: PracticeAttemptEnvelope): void {
  try {
    const key = attemptKey(scopeOf(accountId));
    const target = storage();
    const current = JSON.parse(target?.getItem(key) ?? '[]') as PracticeAttemptEnvelope[];
    const next = [envelope, ...(Array.isArray(current) ? current : [])].slice(0, 20);
    target?.setItem(key, JSON.stringify(next));
  } catch { /* Local fallback is best-effort. */ }
}

export function loadLocalAttempts(accountId: string | null): PracticeAttemptEnvelope[] {
  try {
    const value = JSON.parse(storage()?.getItem(attemptKey(scopeOf(accountId))) ?? '[]');
    return Array.isArray(value) ? value as PracticeAttemptEnvelope[] : [];
  } catch { return []; }
}

/** Test/diagnostic reset for the in-memory cache; storage keys are untouched. */
export function clearPracticeStoreMemory() {
  memory.clear();
  preferenceMemory.clear();
}
