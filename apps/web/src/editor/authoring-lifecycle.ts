/**
 * Shared authoring lifecycle for every Act.
 *
 * A completed AI job is only ever `needs-review`. It is not reviewed, saved or
 * published by the processing pipeline. Review is an explicit human step, and a
 * release is tracked against one exact immutable revision so later private edits
 * never move what recipients see.
 */
export type AuthoringState =
  | 'source-selected'
  | 'uploading'
  | 'processing'
  | 'needs-review'
  | 'editing'
  | 'saved-private'
  | 'ready-to-release'
  | 'failed'
  | 'cancelled';

export type AuthoringSnapshot = {
  state: AuthoringState;
  /** The exact revision the editor has saved or is working from. */
  revisionId: string | null;
  /** The revision currently released to recipients, if any. */
  releasedRevisionId: string | null;
  reviewed: boolean;
  dirty: boolean;
  error: string | null;
  errorCode: 'processing_failed' | 'cancelled' | 'conflict' | 'save_failed' | null;
};

export type AuthoringEvent =
  | {type: 'select-source'}
  | {type: 'upload-started'}
  | {type: 'processing-started'}
  | {type: 'processing-completed'; revisionId?: string | null}
  | {type: 'review-opened'}
  | {type: 'edit-started'}
  | {type: 'dirty'}
  | {type: 'save-succeeded'; revisionId: string}
  | {type: 'review-completed'; revisionId: string}
  | {type: 'ready-to-release'}
  | {type: 'release-published'; revisionId: string}
  | {type: 'failed'; message: string}
  | {type: 'cancelled'}
  | {type: 'reset'};

export const INITIAL_AUTHORING: AuthoringSnapshot = {
  state: 'source-selected',
  revisionId: null,
  releasedRevisionId: null,
  reviewed: false,
  dirty: false,
  error: null,
  errorCode: null,
};

/** Stable user-facing labels shared by every Act. */
export const AUTHORING_LABELS = {
  savedPrivate: 'Saved privately',
  unsaved: 'Unsaved changes',
  reviewRequired: 'Review required',
  publish: 'Publish',
  updatePublished: 'Update published version',
  processingFailed: 'Processing failed',
  readyToRelease: 'Ready to release',
  cancelled: 'Cancelled',
} as const;

export const isProcessing = (state: AuthoringState): boolean =>
  state === 'uploading' || state === 'processing';

/** Publication is allowed only for a reviewed revision that is not yet released. */
export function canPublish(snapshot: AuthoringSnapshot): boolean {
  return snapshot.reviewed
    && Boolean(snapshot.revisionId)
    && snapshot.revisionId !== snapshot.releasedRevisionId
    && (snapshot.state === 'saved-private' || snapshot.state === 'ready-to-release');
}

export function publishLabel(snapshot: AuthoringSnapshot): string {
  return snapshot.releasedRevisionId
    ? AUTHORING_LABELS.updatePublished
    : AUTHORING_LABELS.publish;
}

/** Status text for the common header. Act-specific controls stay outside this. */
export function statusLabel(snapshot: AuthoringSnapshot): string {
  switch (snapshot.state) {
    case 'failed':
      return AUTHORING_LABELS.processingFailed;
    case 'cancelled':
      return AUTHORING_LABELS.cancelled;
    case 'needs-review':
      return AUTHORING_LABELS.reviewRequired;
    case 'saved-private':
      return snapshot.dirty ? AUTHORING_LABELS.unsaved : AUTHORING_LABELS.savedPrivate;
    case 'ready-to-release':
      return snapshot.dirty ? AUTHORING_LABELS.unsaved : AUTHORING_LABELS.readyToRelease;
    case 'editing':
      return AUTHORING_LABELS.unsaved;
    default:
      return '';
  }
}

export function reduceAuthoring(
  snapshot: AuthoringSnapshot,
  event: AuthoringEvent,
): AuthoringSnapshot {
  switch (event.type) {
    case 'reset':
      return {...INITIAL_AUTHORING};
    case 'select-source':
      return {...INITIAL_AUTHORING, state: 'source-selected'};
    case 'upload-started':
      return {...snapshot, state: 'uploading', dirty: false, error: null, errorCode: null};
    case 'processing-started':
      return {...snapshot, state: 'processing', dirty: false, error: null, errorCode: null};
    case 'processing-completed': {
      // A finished job is never reviewed or released. It only becomes review work.
      const revisionId = event.revisionId ?? snapshot.revisionId;
      return {...snapshot, state: 'needs-review', revisionId, dirty: false, reviewed: false,
        error: null, errorCode: null};
    }
    case 'review-opened':
      return isProcessing(snapshot.state) || snapshot.state === 'failed'
        ? snapshot
        : {...snapshot, state: 'needs-review'};
    case 'edit-started':
      return {...snapshot, state: 'editing', dirty: true, error: null, errorCode: null};
    case 'dirty':
      if (snapshot.state === 'failed' || snapshot.state === 'cancelled') return snapshot;
      return {...snapshot, dirty: true,
        state: snapshot.state === 'needs-review' ? 'editing' : snapshot.state};
    case 'save-succeeded':
      return {...snapshot, revisionId: event.revisionId, dirty: false, error: null,
        errorCode: null,
        state: snapshot.reviewed ? 'saved-private' : 'needs-review'};
    case 'review-completed':
      return {...snapshot, revisionId: event.revisionId, reviewed: true, dirty: false,
        error: null, errorCode: null, state: 'saved-private'};
    case 'ready-to-release':
      return snapshot.reviewed && snapshot.revisionId
        ? {...snapshot, state: 'ready-to-release', dirty: false}
        : snapshot;
    case 'release-published':
      return {
        ...snapshot,
        releasedRevisionId: event.revisionId,
        // Publishing the exact revision does not make newer private work public.
        state: snapshot.revisionId === event.revisionId ? 'saved-private' : snapshot.state,
        dirty: snapshot.revisionId !== event.revisionId ? snapshot.dirty : false,
      };
    case 'failed':
      // Processing can fail; a saved private revision cannot be un-saved by it.
      if (!isProcessing(snapshot.state)) return snapshot;
      return {...snapshot, state: 'failed', dirty: false, error: event.message,
        errorCode: 'processing_failed'};
    case 'cancelled':
      if (!isProcessing(snapshot.state)) return snapshot;
      return {...snapshot, state: 'cancelled', dirty: false, error: null,
        errorCode: 'cancelled'};
    default:
      return snapshot;
  }
}
