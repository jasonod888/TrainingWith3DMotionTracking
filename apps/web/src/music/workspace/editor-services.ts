/** Music editor service boundary: review loading, save transport and outcomes. */
import {ApiError, request} from '../../api';
import type {Asset, MusicPedalSpan} from '../../../../../packages/lesson-schema/index';

export type ReviewManifestDocument = {
  revision_id?: string;
  reference?: {key: string; sha256?: string} | null;
  notation?: unknown;
  schema_version?: number;
  draft_id?: string | null;
  source_video?: Asset | null;
  preview_identity?: string | null;
  sha256?: string;
  pedal?: MusicPedalSpan[];
  section_set?: {sections?: {id: string; label: string; start: number; end: number}[]};
  assessment?: {assessment?: string};
  feedback_enabled?: boolean | null;
  piano_preview?: Asset | null;
  [key: string]: unknown;
};

export type ReviewSources<T> = {
  draft: Promise<T | null>;
  manifest: Promise<ReviewManifestDocument | null>;
};

/** Start the two independent reads so a slow draft never blocks a saved revision. */
export function startReviewLoad<T>(lessonId: string): ReviewSources<T> {
  const encoded = encodeURIComponent(lessonId);
  const draft = request<T>(`/lessons/${encoded}/music-draft`, 'GET')
    .catch(() => null);
  const manifest = request<ReviewManifestDocument>(`/lessons/${encoded}`,
    'GET', undefined, true, {'X-Lesson-Formats': '1,2'}).catch(() => null);
  return {draft, manifest};
}

export function reviewPath(lessonId: string, baseRevisionId: string | null): string {
  const encoded = encodeURIComponent(lessonId);
  return baseRevisionId
    ? `/lessons/${encoded}/music-revision`
    : `/lessons/${encoded}/music-draft/review`;
}

export async function saveReviewedReference(lessonId: string, baseRevisionId: string | null,
  body: Record<string, unknown>): Promise<{revision_id: string} & Record<string, unknown>> {
  return request<{revision_id: string} & Record<string, unknown>>(
    reviewPath(lessonId, baseRevisionId), 'POST', {
      ...body, ...(baseRevisionId ? {base_revision_id: baseRevisionId} : {}),
    });
}

export function classifySaveError(cause: unknown): {
  conflict: boolean; kind?: 'stale' | 'verification' | 'other'; message: string;
} {
  if ((cause instanceof ApiError && cause.status === 409)
      || (cause as {status?: number} | null)?.status === 409) {
    const detail = cause instanceof Error ? cause.message : '';
    // A verification-state conflict needs the diagnostics resolved; presenting it as a
    // generic newer revision would hide the actual recovery action.
    if (/verification|correction/i.test(detail)) {
      return {conflict: true, kind: 'verification',
        message: detail || 'Verification changed for this proposal. Reload and resolve it before saving.'};
    }
    return {conflict: true, kind: 'stale',
      message: `This lesson has a newer saved revision. Reload it or save on the latest revision.${
        detail ? ` (${detail})` : ''}`};
  }
  return {conflict: false, message: cause instanceof Error ? cause.message
    : 'The save could not be completed.'};
}

export function privateSaveMessage(revisionId: string, stillCurrent: boolean): string {
  return stillCurrent
    ? `Saved privately · revision ${revisionId.slice(0, 8)}`
    : `Saved privately · revision ${revisionId.slice(0, 8)} — newer edits are still unsaved.`;
}
