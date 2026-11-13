/**
 * One working document, one occurrence selection, one history.
 *
 * Phase 2 foundation: the reducer is pure and DOM-free so it can be unit tested
 * without React, and so every surface drives the same state instead of keeping a
 * private copy of the notes.
 */
import {
  applyCommand, isValidSelection, selectionForOccurrence,
  type CommandOutcome, type CorrectionCommand, type CorrectionSelection, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';

export type Snapshot = { document: NotationDocument; selection: CorrectionSelection | null };

export type CommandReport = {
  status: 'applied' | 'unchanged' | 'rejected';
  label: string;
  code?: string;
  message?: string;
};

export type WorkspaceState = {
  document: NotationDocument;
  selection: CorrectionSelection | null;
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
  revision: number;
  lastReport: CommandReport | null;
};

export type WorkspaceAction =
  | { type: 'select'; occurrenceId: string | null }
  | { type: 'command'; command: CorrectionCommand }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; document: NotationDocument };

const HISTORY_LIMIT = 100;

export function createWorkspaceState(document: NotationDocument): WorkspaceState {
  return { document, selection: null, past: [], future: [], dirty: false, revision: 0, lastReport: null };
}

function reportOf(outcome: CommandOutcome, label: string): CommandReport {
  if (outcome.status === 'applied') return { status: 'applied', label: outcome.label || label };
  if (outcome.status === 'unchanged') return { status: 'unchanged', label: outcome.label };
  return { status: 'rejected', label: 'Not applied', code: outcome.code, message: outcome.message };
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'select': {
      if (!action.occurrenceId) {
        return state.selection === null ? state : { ...state, selection: null };
      }
      const selection = selectionForOccurrence(state.document, action.occurrenceId);
      if (!selection) {
        return { ...state, selection: null, lastReport: { status: 'rejected', label: 'Not selected', code: 'unknown-occurrence', message: 'That note is no longer in the document.' } };
      }
      return { ...state, selection };
    }

    case 'command': {
      const outcome = applyCommand(state.document, action.command);
      if (outcome.status === 'rejected') {
        return { ...state, lastReport: reportOf(outcome, action.command.type) };
      }
      if (outcome.status === 'unchanged' || outcome.document === state.document) {
        return { ...state, lastReport: reportOf(outcome, action.command.type) };
      }
      const past = [...state.past.slice(-(HISTORY_LIMIT - 1)), { document: state.document, selection: state.selection }];
      const selection = outcome.selection === undefined ? state.selection : isValidSelection(outcome.document, outcome.selection);
      return {
        document: outcome.document,
        selection,
        past,
        future: [],
        dirty: true,
        revision: state.revision + 1,
        lastReport: reportOf(outcome, action.command.type),
      };
    }

    case 'undo': {
      if (!state.past.length) return state;
      const snapshot = state.past[state.past.length - 1];
      const past = state.past.slice(0, -1);
      const future = [{ document: state.document, selection: state.selection }, ...state.future].slice(0, HISTORY_LIMIT);
      return {
        ...state,
        document: snapshot.document,
        selection: isValidSelection(snapshot.document, snapshot.selection),
        past,
        future,
        revision: state.revision + 1,
        lastReport: { status: 'applied', label: 'Undone' },
      };
    }

    case 'redo': {
      if (!state.future.length) return state;
      const [snapshot, ...future] = state.future;
      const past = [...state.past.slice(-(HISTORY_LIMIT - 1)), { document: state.document, selection: state.selection }];
      return {
        ...state,
        document: snapshot.document,
        selection: isValidSelection(snapshot.document, snapshot.selection),
        past,
        future,
        revision: state.revision + 1,
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
