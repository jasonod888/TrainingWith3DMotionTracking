import {useEffect, useState} from 'react';
import type {MusicLessonManifest} from '../../../../packages/lesson-schema/index';
import {ApiError, request} from '../api';
import {MusicDraftReview} from './MusicDraftReview';
import {PianoWorkspaceHarness} from './workspace/PianoWorkspaceHarness';

const FORMATS = {'X-Lesson-Formats': '1,2'};

/**
 * One entry point for the normal music review route. It resolves the subject from the
 * saved music manifest first, so a saved-only piano revision opens even when no draft
 * exists, and only the guitar path mounts the legacy review form.
 */
export function MusicReviewRoute({lessonId, onBack, onReviewed, onDirty}: {
  lessonId: string;
  onBack: () => void;
  onReviewed: (lesson: MusicLessonManifest) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [mode, setMode] = useState<'loading' | 'piano' | 'guitar' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    setMode('loading');
    setError('');
    void (async () => {
      // Saved revision wins: a reviewed lesson has a manifest even without a draft.
      try {
        const manifest = await request<unknown>(`/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false, FORMATS);
        if ((manifest as {schema_version?: number; subject?: string}).schema_version === 2
          && (manifest as {subject?: string}).subject === 'piano') {
          if (!stopped) setMode('piano');
          return;
        }
        if ((manifest as {schema_version?: number}).schema_version === 2) {
          if (!stopped) setMode('guitar');
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

  if (mode === 'piano') {
    return <PianoWorkspaceHarness lessonId={lessonId} embedded onBack={onBack} onDirty={onDirty}
      onSaved={(_revisionId, current) => { if (current) onDirty(false); }}/>;
  }
  if (mode === 'guitar') {
    return <MusicDraftReview lessonId={lessonId} onBack={onBack} onDirty={onDirty}
      onCompare={() => {}} onReviewed={onReviewed}/>;
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
