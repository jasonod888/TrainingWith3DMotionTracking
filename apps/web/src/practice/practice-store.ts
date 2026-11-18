import type {LessonManifest} from '../../../../packages/lesson-schema/index';
import {loadProgress, saveProgress} from '../api';

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
};

const PREFIX = 'form-practice-v2';
const memory = new Map<string, PracticeRecord>();
const preferenceMemory = new Map<string, PracticePreferencesRecord>();

const keyFor = (identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId' | 'planId'>) =>
  `${PREFIX}:${identity.lessonId}:${identity.revisionId}:${identity.planId}`;

const preferenceKey = (identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>) =>
  `${PREFIX}:preferences:${identity.lessonId}:${identity.revisionId}`;
const latestKey = (identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>) =>
  `${PREFIX}:latest:${identity.lessonId}:${identity.revisionId}`;

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function readLocal(identity: PracticeIdentity): PracticeRecord | null {
  const key = keyFor(identity);
  const cached = memory.get(key) ?? memory.get(latestKey(identity));
  if (cached) return {...cached};
  try {
    const raw = storage()?.getItem(key) ?? storage()?.getItem(latestKey(identity));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PracticeRecord;
    if (!parsed || parsed.revisionId !== identity.revisionId || !Number.isFinite(parsed.time)) return null;
    memory.set(key, parsed);
    return {...parsed};
  } catch { return null; }
}

function writeLocal(identity: PracticeIdentity, record: PracticeRecord) {
  const key = keyFor(identity);
  memory.set(key, {...record});
  memory.set(latestKey(identity), {...record});
  try {
    const target = storage();
    target?.setItem(key, JSON.stringify(record));
    // A revision-level pointer lets a changed plan (for example piano bars-per-chunk)
    // remap the last position by time instead of starting from the beginning.
    target?.setItem(latestKey(identity), JSON.stringify(record));
  } catch { /* Practice still works. */ }
}

function readPreferences(identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>): PracticePreferencesRecord | null {
  const key = preferenceKey(identity);
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

function writePreferences(identity: Pick<PracticeIdentity, 'lessonId' | 'revisionId'>, preferences: PracticePreferencesRecord) {
  const key = preferenceKey(identity);
  preferenceMemory.set(key, {...preferences});
  try { storage()?.setItem(key, JSON.stringify(preferences)); } catch { /* Preferences are optional. */ }
}

/** Local-first store used by music and as the rich-field companion for body. */
export function createLocalPracticeStore(): PracticeStore {
  return {
    async load(identity) {
      return readLocal(identity);
    },
    async save(identity, record) {
      if (record.revisionId !== identity.revisionId || record.planId !== identity.planId) return;
      writeLocal(identity, record);
    },
    loadPreferences: readPreferences,
    savePreferences: writePreferences,
  };
}

const local = createLocalPracticeStore();

/**
 * Body store: the existing server endpoint remains the position authority;
 * section/plan/repetition fields are stored locally beside it. A server
 * failure never discards the local record.
 */
export function createBodyPracticeStore(lesson: LessonManifest): PracticeStore {
  return {
    async load(identity) {
      if (identity.revisionId !== lesson.revision_id) return null;
      const cached = await local.load(identity);
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
      writeLocal(identity, record);
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
    loadPreferences: readPreferences,
    savePreferences: writePreferences,
  };
}

export const practiceStore = local;

/** Test/diagnostic reset for the in-memory cache; storage keys are untouched. */
export function clearPracticeStoreMemory() {
  memory.clear();
  preferenceMemory.clear();
}
