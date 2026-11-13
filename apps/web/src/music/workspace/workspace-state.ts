/**
 * One working document, one occurrence selection, one bounded history.
 *
 * History stores per-command patches (only the occurrences and events that
 * changed) rather than whole documents, and undoing back to the loaded document
 * restores that exact object and clears the unsaved-change indicator.
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

export type Snapshot = { document: NotationDocument; selection: CorrectionSelection | null };

export type HistoryEntry = { patch: DocumentPatch; label: string; bytes: number };

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
  historyBytes: number;
};

export type WorkspaceAction =
  | { type: 'select'; occurrenceId: string | null }
  | { type: 'command'; command: CorrectionCommand }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; document: NotationDocument };

/** Defensible budget for retained patches (serialised-size estimate, not a heap). */
export const HISTORY_BYTE_BUDGET = 4 * 1024 * 1024;
export const HISTORY_LIMIT = 500;

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

function keepOrRevalidate(document: NotationDocument, selection: CorrectionSelection | null): CorrectionSelection | null {
  return isValidSelection(document, selection);
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
      const outcome = applyCommand(state.document, action.command);
      if (outcome.status === 'rejected') return { ...state, lastReport: reportOf(outcome, action.command.type) };
      if (outcome.status === 'unchanged' || outcome.document === state.document) {
        return { ...state, lastReport: reportOf(outcome, action.command.type) };
      }
      const patch = diffDocuments(state.document, outcome.document);
      if (isEmptyPatch(patch)) return { ...state, lastReport: reportOf(outcome, action.command.type) };

      const bytes = patchBytes(patch);
      const past = [...state.past, { patch, label: outcome.label, bytes }];
      let total = state.historyBytes + bytes;
      let evicted = state.evicted;
      while ((past.length > HISTORY_LIMIT || total > HISTORY_BYTE_BUDGET) && past.length > 1) {
        const dropped = past.shift()!;
        total -= dropped.bytes;
        evicted = true;
      }
      const requested = outcome.selection === undefined ? state.selection : outcome.selection;
      return {
        ...state,
        document: outcome.document,
        selection: keepOrRevalidate(outcome.document, requested),
        past,
        future: [],
        dirty: true,
        evicted,
        revision: state.revision + 1,
        lastReport: reportOf(outcome, action.command.type),
        historyBytes: total,
      };
    }

    case 'undo': {
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
        selection: keepOrRevalidate(document, state.selection),
        past,
        future,
        dirty: !reachedOrigin,
        revision: state.revision + 1,
        historyBytes: state.historyBytes - entry.bytes,
        lastReport: { status: 'applied', label: 'Undone' },
      };
    }

    case 'redo': {
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
        selection: keepOrRevalidate(document, state.selection),
        past,
        future,
        dirty: true,
        revision: state.revision + 1,
        historyBytes: state.historyBytes + entry.bytes,
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
  if (state.dirty) return 'Unsaved changes (not saved — this harness has no save)';
  return 'No changes';
}

/** Serialised-size estimate of retained history, for the harness and benchmarks. */
export function historySummary(state: WorkspaceState): {steps: number; bytes: number; evicted: boolean} {
  return { steps: state.past.length, bytes: state.historyBytes, evicted: state.evicted };
}
