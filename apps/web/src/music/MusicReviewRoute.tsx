import {useEffect, useState} from 'react';
import type {MusicLessonManifest} from '../../../../packages/lesson-schema/index';
import {ApiError, request} from '../api';
import {MusicDraftReview} from './MusicDraftReview';
import {PianoWorkspaceHarness} from './workspace/PianoWorkspaceHarness';

const FORMATS = {'X-Lesson-Formats': '1,2'};

/**
 * One entry point for the normal music review route. It resolves the subject from the
 * saved music manifest first, so a saved-only revision opens even when no draft
 * exists. Piano and guitar both use the shared workspace; the legacy guitar form is
 * available only through an explicit opt-in.
 */
export function MusicReviewRoute({lessonId, onBack, onReviewed, onDirty, onFocusedChange, legacyGuitarReview = false}: {
  lessonId: string;
  onBack: () => void;
  onReviewed: (lesson: MusicLessonManifest) => void;
  onDirty: (dirty: boolean) => void;
  /** Lets the app shell hide global navigation only for the focused workspace route. */
  onFocusedChange?: (focused: boolean) => void;
  /** Escape hatch for callers that still want the legacy guitar review form. */
  legacyGuitarReview?: boolean;
}) {
  const [mode, setMode] = useState<'loading' | 'piano' | 'guitar' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    onFocusedChange?.(mode === 'piano' || mode === 'guitar');
  }, [mode, onFocusedChange]);

  useEffect(() => {
    let stopped = false;
    setMode('loading');
    onFocusedChange?.(false);
    setError('');
    void (async () => {
      // Saved revision wins: a reviewed lesson has a manifest even without a draft.
      try {
        const manifest = await request<unknown>(`/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false, FORMATS);
        if ((manifest as {schema_version?: number}).schema_version === 2) {
          const subject = (manifest as {subject?: string}).subject;
          if (!stopped) setMode(subject === 'guitar' ? 'guitar' : 'piano');
          return;
        }
      } catch {
        // No saved revision; fall through to the proposal.
      }
      try {
        const draft = await request<{subject?: string}>(`/lessons/${encodeURIComponent(lessonId)}/music-draft`);
        if (!stopped) setMode(draft.subject === 'guitar' ? 'guitar' : 'piano');
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof ApiError && cause.status === 404) {
          setError('This lesson has no draft or saved review to open.');
        } else {
          setError(cause instanceof Error ? cause.message : 'The lesson could not be opened.');
        }
        setMode('error');
      }
    })();
    return () => { stopped = true; };
  }, [lessonId]);

  // Both instruments use the unified workspace; only an explicit legacy opt-in mounts
  // the old guitar-only review form.
  if (mode === 'guitar' && legacyGuitarReview) {
    return <MusicDraftReview lessonId={lessonId} onBack={onBack} onDirty={onDirty}
      onCompare={() => {}} onReviewed={onReviewed}/>;
  }
  if (mode === 'piano' || mode === 'guitar') {
    return <PianoWorkspaceHarness lessonId={lessonId} embedded mode="review" onBack={onBack} onDirty={onDirty}
      onSaved={(_revisionId, current) => { if (current) onDirty(false); }}/>;
  }
  if (mode === 'error') {
    return <section className="music-home music-review" aria-label="Review music reference">
      <div className="workspace-heading"><button className="back-link" onClick={onBack}>Back</button></div>
      <p role="alert">{error}</p>
    </section>;
  }
  return <p role="status">Opening the review…</p>;
}

export default MusicReviewRoute;
