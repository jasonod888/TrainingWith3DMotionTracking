/**
 * Versioned device-local recovery checkpoints.
 *
 * A checkpoint is never server-saved data: the UI must label it as local. Reading only
 * succeeds when the account, lesson, draft and source identity all match, so one
 * account or draft can never restore another's work.
 */
import type {SavedAlignment, SavedGuitarChord, SavedSpan} from './save-payload';

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
  /** Added after v1 shipped: older checkpoints legitimately lack these. */
  sections?: {id: string; label: string; start: number; end: number}[];
  assessment?: {policy: 'none' | 'notes'};
  /** Clip duration the sections were written against, for strict validation. */
  durationSeconds?: number;
  /** finding id → occurrence id → authored spelling, for faithful reversals. */
  authoredSpellings?: Record<string, Record<string, string>>;
  /** Accepted performance+notation baseline per finding, for guarded reversal. */
  acceptedBaselines?: Record<string, Record<string, unknown>>;
  /** Reviewed guitar chord shapes; older checkpoints legitimately lack this. */
  guitarChords?: SavedGuitarChord[];
};

export type RecoveryRead =
  | {status: 'none'}
  | {status: 'restored'; checkpoint: RecoveryCheckpoint}
  | {status: 'rejected'; reason: string};

/**
 * Normalize stored chord shapes instead of rejecting in-progress edits. A blank name
 * becomes "Chord"; a stale base position is recomputed from the positive frets.
 * Structurally impossible shapes (wrong fret count, out-of-range frets, all muted,
 * span wider than four frets) still make the whole checkpoint invalid.
 */
export function sanitizeGuitarChords(value: unknown): SavedGuitarChord[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const ids = new Set<string>();
  const sanitized: SavedGuitarChord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const chord = raw as Record<string, unknown>;
    const id = typeof chord.id === 'string' ? chord.id : '';
    const name = typeof chord.name === 'string' ? chord.name.trim() : null;
    const start = typeof chord.start === 'number' ? chord.start : Number.NaN;
    const frets = chord.frets;
    if (!id || id.length > 80 || ids.has(id) || name === null || name.length > 40) return null;
    if (!Number.isFinite(start) || start < 0) return null;
    if (!Array.isArray(frets)) return null;
    if (frets.length !== 6
      || !frets.every(fret => Number.isInteger(fret) && fret >= -1 && fret <= 24)
      || !frets.some(fret => fret >= 0)) return null;
    const positive = frets.filter(fret => fret > 0);
    if (positive.length && Math.max(...positive) - Math.min(...positive) > 3) return null;
    const position = positive.length ? Math.min(...positive) : 1;
    ids.add(id);
    sanitized.push({
      id, name: name || 'Chord', start,
      frets: frets.map(fret => fret as number),
      position: Math.max(1, Math.min(24, position)),
    });
  }
  return sanitized;
}

/**
 * Non-destructive write-side normalization: keep every recoverable chord instead of
 * replacing the collection with `[]` because one entry is temporarily invalid.
 */
export function salvageGuitarChords(value: unknown, fallback: SavedGuitarChord[] = []): SavedGuitarChord[] {
  const whole = sanitizeGuitarChords(value);
  if (whole !== null) return whole;
  if (!Array.isArray(value)) return fallback;
  if (value.length === 0) return [];
  const salvaged: SavedGuitarChord[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const one = sanitizeGuitarChords([raw]);
    const chord = one?.[0];
    if (!chord || ids.has(chord.id)) continue;
    ids.add(chord.id);
    salvaged.push(chord);
    if (salvaged.length >= 100) break;
  }
  return salvaged.length ? salvaged : fallback;
}

/** Shared shape validation for readRecovery and peekRecovery. */
function normalizeCheckpointShapes(checkpoint: Partial<RecoveryCheckpoint>): string | null {
  if (checkpoint.sections !== undefined) {
    const sections = checkpoint.sections;
    const valid = Array.isArray(sections) && sections.length > 0 && sections.length <= 500
      && sections.every(section => section && typeof section === 'object'
        && typeof section.id === 'string' && section.id.length > 0 && section.id.length <= 80
        && typeof section.label === 'string' && section.label.length <= 80
        && Number.isFinite(section.start) && Number.isFinite(section.end)
        && section.start >= 0 && section.end > section.start)
      && sections.every((section, index) => index === 0
        || Math.abs(section.start - sections[index - 1].end) < 1e-6)
      && sections[0].start === 0
      && new Set(sections.map(section => section.id)).size === sections.length
      && (typeof checkpoint.durationSeconds !== 'number'
        || Math.abs(sections[sections.length - 1].end - checkpoint.durationSeconds) < 1e-6);
    if (!valid) return 'The local checkpoint has invalid teaching sections and was ignored.';
  }
  if (checkpoint.assessment !== undefined
    && (!checkpoint.assessment || !['none', 'notes'].includes(checkpoint.assessment.policy))) {
    return 'The local checkpoint has an invalid assessment policy and was ignored.';
  }
  if (checkpoint.guitarChords !== undefined) {
    const chords = sanitizeGuitarChords(checkpoint.guitarChords);
    if (chords === null) return 'The local checkpoint has invalid guitar chords and was ignored.';
    checkpoint.guitarChords = chords;
  }
  return null;
}

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
  if (checkpoint.acceptedBaselines !== undefined) {
    const value = checkpoint.acceptedBaselines;
    // Detailed semantic validation happens in verification-transaction on use;
    // here only the versioned container shape is checked so older/partial data
    // still restores the notation and simply refuses reversal.
    const valid = value && typeof value === 'object' && !Array.isArray(value)
      && Object.values(value).every(group => {
        if (!group || typeof group !== 'object' || Array.isArray(group)) return false;
        const item = group as Record<string, unknown>;
        return item.version === 1 && typeof item.findingId === 'string'
          && item.entries && typeof item.entries === 'object' && !Array.isArray(item.entries)
          && item.before && typeof item.before === 'object' && !Array.isArray(item.before);
      });
    // Drop an unusable baseline but keep the recovered work; reversal will refuse.
    if (!valid) delete checkpoint.acceptedBaselines;
  }
  if (checkpoint.authoredSpellings !== undefined) {
    const value = checkpoint.authoredSpellings;
    const valid = value && typeof value === 'object' && !Array.isArray(value)
      && Object.values(value).every(entry => entry && typeof entry === 'object' && !Array.isArray(entry)
        && Object.entries(entry).every(([id, spelling]) => id.length <= 120
          && typeof spelling === 'string' && spelling.length > 0 && spelling.length <= 12));
    if (!valid) delete checkpoint.authoredSpellings;
  }
  if (!checkpoint.notation || typeof checkpoint.notation !== 'object') {
    return {status: 'rejected', reason: 'The local checkpoint has no notation and was ignored.'};
  }
  const shapeProblem = normalizeCheckpointShapes(checkpoint);
  if (shapeProblem) return {status: 'rejected', reason: shapeProblem};
  return {status: 'restored', checkpoint: checkpoint as RecoveryCheckpoint};
}

/** Reads the checkpoint shape without identity checks, for explicit stale-base recovery. */
export function peekRecovery(): RecoveryCheckpoint | null {
  const store = storage();
  if (!store) return null;
  try {
    const value = JSON.parse(store.getItem(KEY) ?? 'null');
    if (!value || value.version !== 1 || typeof value.notation !== 'object') return null;
    const checkpoint = value as Partial<RecoveryCheckpoint>;
    // Stale-base restore must never bypass the same shape checks as readRecovery.
    if (normalizeCheckpointShapes(checkpoint)) return null;
    return checkpoint as RecoveryCheckpoint;
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
