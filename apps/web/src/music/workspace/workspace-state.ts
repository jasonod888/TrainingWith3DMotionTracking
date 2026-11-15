/**
 * One working document, one occurrence selection, one bounded history.
 *
 * History stores per-command patches (only the occurrences and events that
 * changed) plus the selection on each side of the command, so undo and redo
 * restore both the document and the selection that belonged to it. Byte figures
 * are UTF-8 byte counts of the patches, not heap measurements.
 *
 * The reducer is pure and DOM-free so it can be unit tested without React.
 */
import {
  applyCommand, isValidSelection, selectionForOccurrence,
  type CommandOutcome, type CorrectionCommand, type CorrectionSelection, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {
  applyPatch, diffDocuments, isEmptyPatch, patchBytes,
  type DocumentPatch,
} from './document-patch';
import { INTERACTIVE_OCCURRENCE_LIMIT, interactiveLimitActive } from './interactive-limit';

export type Snapshot = { document: NotationDocument; selection: CorrectionSelection | null };

function readOnlyRejection(state: WorkspaceState): WorkspaceState | null {
  if (!interactiveLimitActive() || state.document.performance.length <= INTERACTIVE_OCCURRENCE_LIMIT) {
    return null;
  }
  return {...state, lastReport: {status: 'rejected', label: 'Read-only lesson',
    code: 'interactive-limit-read-only',
    message: `This lesson has ${state.document.performance.length} occurrences; editing is limited to `
      + `${INTERACTIVE_OCCURRENCE_LIMIT}. This edit was not applied.`}};
}

function overLimitCandidate(document: NotationDocument): boolean {
  return interactiveLimitActive() && document.performance.length > INTERACTIVE_OCCURRENCE_LIMIT;
}

export let historySerial = 0;

type HistoryEntry = {
  /** Unique path entry identity, used for dirty comparison across undo/branching. */
  id: string;
  patch: DocumentPatch;
  label: string;
  bytes: number;
  /** Selection immediately before the command; restored by undo. */
  selectionBefore: CorrectionSelection | null;
  /** Selection immediately after the command; restored by redo. */
  selectionAfter: CorrectionSelection | null;
};

export type CommandReport = {
  status: 'applied' | 'unchanged' | 'rejected';
  label: string;
  code?: string;
  message?: string;
};

export type WorkspaceState = {
  document: NotationDocument;
  /** The document as loaded; restored verbatim when the history is undone fully. */
  origin: NotationDocument;
  selection: CorrectionSelection | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  dirty: boolean;
  /** True once the oldest entry has been dropped: undo can no longer reach origin. */
  evicted: boolean;
  revision: number;
  lastReport: CommandReport | null;
  /** Retained undo + redo patches, in UTF-8 bytes. */
  historyBytes: number;
};

export type WorkspaceAction =
  | { type: 'select'; occurrenceId: string | null }
  | { type: 'command'; command: CorrectionCommand }
  | { type: 'commands'; commands: CorrectionCommand[]; label?: string;
      candidate?: NotationDocument; base?: NotationDocument }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; document: NotationDocument };

/** Defensible budget for retained patches, counted across undo and redo. */
export const HISTORY_BYTE_BUDGET = 4 * 1024 * 1024;
export const HISTORY_LIMIT = 500;

/**
 * Stable savepoint identity, independent of how many patches are retained. The top
 * entry id identifies the exact path; an empty history distinguishes the true root
 * from an evicted root (where older patches were dropped). Branching replaces the
 * top entry id, and external document replacement is covered by the caller's epoch.
 */
export function historyIdentity(state: WorkspaceState): string {
  if (!state.past.length) return state.evicted ? 'origin:evicted' : 'origin';
  return `entry:${state.past[state.past.length - 1].id}`;
}

/** Backwards-compatible alias for the eviction-safe identity. */
export const historyPath = historyIdentity;

export function createWorkspaceState(document: NotationDocument): WorkspaceState {
  return {
    document, origin: document, selection: null, past: [], future: [],
    dirty: false, evicted: false, revision: 0, lastReport: null, historyBytes: 0,
  };
}

function reportOf(outcome: CommandOutcome, label: string): CommandReport {
  if (outcome.status === 'applied') return { status: 'applied', label: outcome.label || label };
  if (outcome.status === 'unchanged') return { status: 'unchanged', label: outcome.label };
  return { status: 'rejected', label: 'Not applied', code: outcome.code, message: outcome.message };
}

function entryBytes(entries: HistoryEntry[]): number {
  return entries.reduce((total, entry) => total + entry.bytes, 0);
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'select': {
      if (!action.occurrenceId) {
        return state.selection === null ? state : { ...state, selection: null };
      }
      const selection = selectionForOccurrence(state.document, action.occurrenceId);
      if (!selection) {
        return {
          ...state, selection: null,
          lastReport: { status: 'rejected', label: 'Not selected', code: 'unknown-occurrence', message: 'That note is no longer in the document.' },
        };
      }
      return { ...state, selection };
    }

    case 'command': {
      const blocked = readOnlyRejection(state);
      if (blocked) return blocked;
      const outcome = applyCommand(state.document, action.command);
      if (outcome.status === 'rejected') return { ...state, lastReport: reportOf(outcome, action.command.type) };
      if (outcome.status === 'unchanged' || outcome.document === state.document) {
        return { ...state, lastReport: reportOf(outcome, action.command.type) };
      }
      if (overLimitCandidate(outcome.document)) {
        return {...state, lastReport: {status: 'rejected', label: 'Read-only lesson',
          code: 'interactive-limit-read-only',
          message: `This edit would exceed the ${INTERACTIVE_OCCURRENCE_LIMIT}-occurrence interactive limit. Nothing was changed.`}};
      }
      const patch = diffDocuments(state.document, outcome.document);
      if (isEmptyPatch(patch)) return { ...state, lastReport: reportOf(outcome, action.command.type) };

      const requested = outcome.selection === undefined ? state.selection : outcome.selection;
      const selectionAfter = isValidSelection(outcome.document, requested);
      const entry: HistoryEntry = {
        id: `history-${++historySerial}`,
        patch, label: outcome.label, bytes: patchBytes(patch),
        selectionBefore: state.selection, selectionAfter,
      };

      const past = [...state.past, entry];
      let total = entryBytes(past);
      let evicted = state.evicted;
      while ((past.length > HISTORY_LIMIT || total > HISTORY_BYTE_BUDGET) && past.length > 1) {
        const dropped = past.shift()!;
        total -= dropped.bytes;
        evicted = true;
      }
      return {
        ...state,
        document: outcome.document,
        selection: selectionAfter,
        past,
        future: [],
        dirty: true,
        evicted,
        revision: state.revision + 1,
        lastReport: reportOf(outcome, action.command.type),
        historyBytes: total,
      };
    }

    case 'commands': {
      const blocked = readOnlyRejection(state);
      if (blocked) return blocked;
      // A pre-staged candidate is only valid against the document it was prepared
      // from; otherwise restage the commands against the current document.
      const useCandidate = Boolean(action.candidate && action.base === state.document);
      let candidate = useCandidate ? action.candidate! : state.document;
      let selection = state.selection;
      for (const command of useCandidate ? [] : action.commands) {
        const outcome = applyCommand(candidate, command);
        if (outcome.status === 'rejected') {
          return {...state, lastReport: {status: 'rejected', label: 'Not applied',
            code: outcome.code, message: outcome.message}};
        }
        if (outcome.status === 'applied') {
          candidate = outcome.document;
          selection = outcome.selection === undefined ? selection : outcome.selection;
        }
      }
      if (candidate === state.document) return {...state, lastReport: {status: 'unchanged', label: 'No change'}};
      if (overLimitCandidate(candidate)) {
        return {...state, lastReport: {status: 'rejected', label: 'Read-only lesson',
          code: 'interactive-limit-read-only',
          message: `This edit would exceed the ${INTERACTIVE_OCCURRENCE_LIMIT}-occurrence interactive limit. Nothing was changed.`}};
      }
      const patch = diffDocuments(state.document, candidate);
      if (isEmptyPatch(patch)) return {...state, lastReport: {status: 'unchanged', label: 'No change'}};
      const selectionAfter = isValidSelection(candidate, selection);
      const entry: HistoryEntry = {id: `history-${++historySerial}`, patch,
        label: action.label ?? 'Applied verification suggestion',
        bytes: patchBytes(patch), selectionBefore: state.selection, selectionAfter};
      const past = [...state.past, entry];
      let total = entryBytes(past);
      let evicted = state.evicted;
      while ((past.length > HISTORY_LIMIT || total > HISTORY_BYTE_BUDGET) && past.length > 1) {
        const dropped = past.shift()!;
        total -= dropped.bytes;
        evicted = true;
      }
      return {...state, document: candidate, selection: selectionAfter, past, future: [],
        dirty: true, evicted, revision: state.revision + 1, historyBytes: total,
        lastReport: {status: 'applied', label: entry.label}};
    }

    case 'undo': {
      const blocked = readOnlyRejection(state);
      if (blocked) return blocked;
      if (!state.past.length) return state;
      const entry = state.past[state.past.length - 1];
      const past = state.past.slice(0, -1);
      let document: NotationDocument;
      try {
        document = applyPatch(state.document, entry.patch, 'before');
      } catch (cause) {
        return { ...state, lastReport: { status: 'rejected', label: 'Undo failed', message: cause instanceof Error ? cause.message : 'Undo failed.' } };
      }
      const reachedOrigin = past.length === 0 && !state.evicted;
      if (reachedOrigin) document = state.origin;
      const future = [entry, ...state.future];
      return {
        ...state,
        document,
        selection: isValidSelection(document, entry.selectionBefore),
        past,
        future,
        dirty: !reachedOrigin,
        revision: state.revision + 1,
        historyBytes: entryBytes(past) + entryBytes(future),
        lastReport: { status: 'applied', label: 'Undone' },
      };
    }

    case 'redo': {
      const blocked = readOnlyRejection(state);
      if (blocked) return blocked;
      if (!state.future.length) return state;
      const [entry, ...future] = state.future;
      let document: NotationDocument;
      try {
        document = applyPatch(state.document, entry.patch, 'after');
      } catch (cause) {
        return { ...state, lastReport: { status: 'rejected', label: 'Redo failed', message: cause instanceof Error ? cause.message : 'Redo failed.' } };
      }
      const past = [...state.past, entry];
      return {
        ...state,
        document,
        selection: isValidSelection(document, entry.selectionAfter),
        past,
        future,
        dirty: true,
        revision: state.revision + 1,
        historyBytes: entryBytes(past) + entryBytes(future),
        lastReport: { status: 'applied', label: 'Redone' },
      };
    }

    case 'reset':
      return createWorkspaceState(action.document);

    default:
      return state;
  }
}

/** Truthful status text; Phase 2 has no persistence, so it must not claim “Saved”. */
export function workspaceStatus(state: WorkspaceState): string {
  if (state.lastReport?.status === 'rejected') return 'Not applied';
  if (state.dirty) return 'Unsaved changes';
  return 'No changes';
}

/** Separates undo and redo retention, both counted in UTF-8 bytes. */
export function historySummary(state: WorkspaceState): {
  undoSteps: number; redoSteps: number; undoBytes: number; redoBytes: number; totalBytes: number; evicted: boolean;
} {
  const undoBytes = entryBytes(state.past);
  const redoBytes = entryBytes(state.future);
  return {
    undoSteps: state.past.length,
    redoSteps: state.future.length,
    undoBytes,
    redoBytes,
    totalBytes: undoBytes + redoBytes,
    evicted: state.evicted,
  };
}
