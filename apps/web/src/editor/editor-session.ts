/**
 * Shared editor session: lifecycle + dirty/review/release bookkeeping.
 *
 * Deliberately separate from preview transport, editor selection, undo history
 * and AI verification state. Those remain Act-owned; this object only answers
 * "what is the authoring state, what is dirty, and which revision is released".
 */
import {
  INITIAL_AUTHORING, AUTHORING_LABELS, canPublish, publishLabel, reduceAuthoring,
  statusLabel, type AuthoringEvent, type AuthoringSnapshot,
} from './authoring-lifecycle';

export type EditorSession = {
  getSnapshot(): AuthoringSnapshot;
  subscribe(listener: (snapshot: AuthoringSnapshot) => void): () => void;
  dispatch(event: AuthoringEvent): AuthoringSnapshot;
  processingCompleted(revisionId?: string | null): AuthoringSnapshot;
  beginEdit(): AuthoringSnapshot;
  markDirty(): AuthoringSnapshot;
  saved(revisionId: string): AuthoringSnapshot;
  reviewed(revisionId: string): AuthoringSnapshot;
  readyToRelease(): AuthoringSnapshot;
  published(revisionId: string): AuthoringSnapshot;
  fail(message: string): AuthoringSnapshot;
  conflict(message: string): AuthoringSnapshot;
  cancel(): AuthoringSnapshot;
  reset(): AuthoringSnapshot;
  canPublish(): boolean;
  statusLabel(): string;
  publishActionLabel(): string;
  labels(): typeof AUTHORING_LABELS;
};

export function createEditorSession(initial: Partial<AuthoringSnapshot> = {}): EditorSession {
  let snapshot: AuthoringSnapshot = {...INITIAL_AUTHORING, ...initial};
  const listeners = new Set<(value: AuthoringSnapshot) => void>();
  const emit = () => {
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };
  const dispatch = (event: AuthoringEvent) => {
    snapshot = reduceAuthoring(snapshot, event);
    return emit();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispatch,
    processingCompleted: revisionId => dispatch({type: 'processing-completed', revisionId}),
    beginEdit: () => dispatch({type: 'edit-started'}),
    markDirty: () => dispatch({type: 'dirty'}),
    saved: revisionId => dispatch({type: 'save-succeeded', revisionId}),
    reviewed: revisionId => dispatch({type: 'review-completed', revisionId}),
    readyToRelease: () => dispatch({type: 'ready-to-release'}),
    published: revisionId => dispatch({type: 'release-published', revisionId}),
    fail: message => dispatch({type: 'failed', message}),
    // A conflict is not a failed save: the edits are still here and still dirty.
    conflict(message) {
      snapshot = {...snapshot, dirty: true, error: message, errorCode: 'conflict'};
      return emit();
    },
    cancel: () => dispatch({type: 'cancelled'}),
    reset: () => dispatch({type: 'reset'}),
    canPublish: () => canPublish(snapshot),
    statusLabel: () => statusLabel(snapshot),
    publishActionLabel: () => publishLabel(snapshot),
    labels: () => AUTHORING_LABELS,
  };
}
