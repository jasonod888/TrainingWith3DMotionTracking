/**
 * Versioned device-local recovery checkpoints.
 *
 * A checkpoint is never server-saved data: the UI must label it as local. Reading only
 * succeeds when the account, lesson, draft and source identity all match, so one
 * account or draft can never restore another's work.
 */
import type {SavedAlignment, SavedSpan} from './save-payload';

const KEY = 'piano-workspace-recovery-v1';

export type RecoveryIdentity = {
  accountId: string;
  lessonId: string;
  draftId: string;
  sourceSha256: string;
  /** The saved revision the local work was based on; empty for a never-saved draft. */
  baseRevisionId?: string | null;
};

export type RecoveryCheckpoint = {
  version: 1;
  savedAt: string;
  identity: RecoveryIdentity;
  title: string;
  notation: unknown;
  alignment: SavedAlignment | null;
  offsetSeconds: number;
  spans: SavedSpan[];
  /** Server identity the local work was based on, so a retry is not a first review. */
  baseRevisionId?: string | null;
  verificationToken?: string | null;
};

export type RecoveryRead =
  | {status: 'none'}
  | {status: 'restored'; checkpoint: RecoveryCheckpoint}
  | {status: 'rejected'; reason: string};

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function writeRecovery(checkpoint: Omit<RecoveryCheckpoint, 'version' | 'savedAt'>): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify({...checkpoint, version: 1, savedAt: new Date().toISOString()}));
    return true;
  } catch {
    return false;
  }
}

export function readRecovery(identity: RecoveryIdentity): RecoveryRead {
  const store = storage();
  if (!store) return {status: 'none'};
  const raw = store.getItem(KEY);
  if (!raw) return {status: 'none'};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {status: 'rejected', reason: 'The local checkpoint is unreadable and was ignored.'};
  }
  if (typeof value !== 'object' || value === null) {
    return {status: 'rejected', reason: 'The local checkpoint is unreadable and was ignored.'};
  }
  const checkpoint = value as Partial<RecoveryCheckpoint>;
  if (checkpoint.version !== 1) {
    return {status: 'rejected', reason: 'The local checkpoint version is unsupported and was ignored.'};
  }
  const recorded = checkpoint.identity;
  if (!recorded || typeof recorded !== 'object') {
    return {status: 'rejected', reason: 'The local checkpoint has no identity and was ignored.'};
  }
  const mismatch = (['accountId', 'lessonId', 'draftId', 'sourceSha256'] as const)
    .find(field => recorded[field] !== identity[field]);
  if (mismatch) {
    return {
      status: 'rejected',
      reason: 'A local checkpoint belongs to a different account, draft or source; it was not restored.',
    };
  }
  // The base revision is part of the identity: a checkpoint written against an older
  // saved revision must not be restored as if it were current work.
  const recordedBase = recorded.baseRevisionId ?? null;
  const currentBase = identity.baseRevisionId ?? null;
  if (recordedBase !== currentBase) {
    return {
      status: 'rejected',
      reason: recordedBase === null
        ? 'A local checkpoint predates base-revision tracking; confirm before restoring it.'
        : 'A local checkpoint was written against an older saved revision of this clip; it is stale.',
    };
  }
  if (!checkpoint.notation || typeof checkpoint.notation !== 'object') {
    return {status: 'rejected', reason: 'The local checkpoint has no notation and was ignored.'};
  }
  return {status: 'restored', checkpoint: checkpoint as RecoveryCheckpoint};
}

/** Reads the checkpoint shape without identity checks, for explicit stale-base recovery. */
export function peekRecovery(): RecoveryCheckpoint | null {
  const store = storage();
  if (!store) return null;
  try {
    const value = JSON.parse(store.getItem(KEY) ?? 'null');
    if (!value || value.version !== 1 || typeof value.notation !== 'object') return null;
    return value as RecoveryCheckpoint;
  } catch {
    return null;
  }
}

export function clearRecovery(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // A failed clear leaves the checkpoint for the next load; it never becomes "saved".
  }
}
