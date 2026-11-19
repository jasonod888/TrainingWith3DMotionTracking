/**
 * Music review loading and save orchestration, extracted from the workspace view.
 *
 * These are transport/lifecycle services, not presentation: they start the saved
 * revision and draft requests together, choose the exact save endpoint, and turn a
 * conflict into a typed result. Undo history, selection and verification state stay
 * in the Act editor.
 */
import {ApiError, request} from '../../api';
import type {Asset, MusicPedalSpan} from '../../../../../packages/lesson-schema/index';

/** The saved-manifest fields the review workspace actually reads. */
export type ReviewManifestDocument = {
  revision_id: string;
  reference: {key: string; sha256?: string};
  source_video?: Asset | null;
  piano_preview?: Asset | null;
  preview_identity?: string | null;
  pedal?: MusicPedalSpan[];
  draft_id?: string | null;
  section_set?: {sections?: {id: string; label: string; start: number; end: number}[]};
  assessment?: {assessment?: string};
  feedback_enabled?: boolean | null;
};

/**
 * Start both requests together: a slow draft must not delay a saved reference.
 * Failures are returned as null so the caller can fall back deterministically.
 */
export function startReviewLoad<TManifest = unknown>(lessonId: string): {
  manifest: Promise<TManifest | null>;
  draft: Promise<unknown | null>;
} {
  return {
    manifest: request<TManifest>(`/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false,
      {'X-Lesson-Formats': '1,2'}).catch(() => null),
    draft: request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-draft`).catch(() => null),
  };
}

/** A first review and a later private edit use different endpoints on purpose. */
export function reviewPath(lessonId: string, baseRevisionId: string | null): string {
  const lesson = encodeURIComponent(lessonId);
  return baseRevisionId
    ? `/lessons/${lesson}/music-revision`
    : `/lessons/${lesson}/music-draft/review`;
}

export function saveReviewedReference(
  lessonId: string,
  baseRevisionId: string | null,
  body: unknown,
): Promise<{revision_id: string}> {
  return request<{revision_id: string}>(reviewPath(lessonId, baseRevisionId), 'POST', body);
}

export type SaveConflictKind = 'verification' | 'stale' | 'other';

export type SaveErrorInfo = {
  conflict: boolean;
  kind: SaveConflictKind | null;
  message: string;
};

/**
 * 409 is a conflict with kept local edits, not a failed save. The message is
 * chosen once here so every caller classifies stale/verification conflicts alike.
 */
export function classifySaveError(cause: unknown): SaveErrorInfo {
  if (cause instanceof ApiError && cause.status === 409) {
    const message = cause.message ?? '';
    if (/verification|working notes/i.test(message)) {
      return {conflict: true, kind: 'verification',
        message: 'The verification decisions changed. Your edits are kept; reload the saved revision to review them.'};
    }
    if (/already been reviewed|already edited|newer saved revision|newer revision/i.test(message)) {
      return {conflict: true, kind: 'stale',
        message: 'This lesson has a newer saved revision. Your edits are kept locally.'};
    }
    return {conflict: true, kind: 'other',
      message: `${message || 'The save conflicted with the saved lesson.'} Your edits are kept locally.`};
  }
  return {conflict: false, kind: null,
    message: cause instanceof Error ? cause.message : 'The save failed; your edits are kept.'};
}

/** Never claim "Saved" when newer edits exist; report exactly what was saved. */
export function privateSaveMessage(revisionId: string, stillCurrent: boolean): string {
  const short = revisionId.slice(0, 8);
  return stillCurrent
    ? `Saved privately · revision ${short}`
    : `Saved an earlier version · revision ${short}; newer edits remain unsaved.`;
}
