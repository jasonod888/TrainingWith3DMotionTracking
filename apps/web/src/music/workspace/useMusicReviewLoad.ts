/** Loading/hydration coordinator for the music review workspace. */
import {useCallback, useEffect, useRef, useState} from 'react';
import {buildNotation, scoreClock} from '../../../../../packages/music-notation/index.ts';
import {parseMusicDraftView} from '../../../../../packages/lesson-schema/parse';
import {request} from '../../api';
import {loadReferenceValue, pinReference, unpinReference} from '../../app/lesson-context';
import {startReviewLoad, type ReviewManifestDocument} from './editor-services';
import {restoreFromReference, type RestoredReference} from './save-payload';

export type ReviewDraft = Extract<ReturnType<typeof parseMusicDraftView>, {ok: true}>['value'];
export type LoadedReview =
  | {kind: 'saved'; restored: RestoredReference; revisionId: string; manifest: ReviewManifestDocument}
  | {kind: 'draft'; draft: ReviewDraft; document: ReturnType<typeof buildNotation>};

export type ReopenSavedResult =
  | {status: 'applied'; value: Extract<LoadedReview, {kind: 'saved'}>}
  | {status: 'cancelled'}
  | {status: 'stale'}
  | {status: 'error'; message: string};

export function useMusicReviewLoad({lessonId, demo = false, onLoaded}: {
  lessonId: string; demo?: boolean; onLoaded: (value: LoadedReview) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reopenMessage, setReopenMessage] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);
  const pinned = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const callback = useRef(onLoaded); callback.current = onLoaded;

  /** Keep exactly one reviewed reference pinned, whichever load/reopen produced it. */
  const pinReviewed = (sha256: string | undefined) => {
    if (sha256 && sha256 === pinned.current) return;
    if (pinned.current) {
      unpinReference(pinned.current);
      pinned.current = null;
    }
    if (sha256) {
      pinReference(sha256);
      pinned.current = sha256;
    }
  };

  const load = useCallback(async () => {
    abort.current?.abort();
    abort.current = null;
    const run = ++generation.current;
    const alive = () => mounted.current && run === generation.current;
    if (demo) { setLoading(false); return; }
    if (!lessonId) { setError('This review link is incomplete.'); setLoading(false); return; }
    setLoading(true); setError(''); setReopenMessage('');
    try {
      const sources = startReviewLoad<unknown>(lessonId);
      const draftPromise = sources.draft;
      const manifest = await sources.manifest;
      if (!alive()) return;
      if (manifest?.revision_id && manifest.reference?.key) {
        try {
          const payload = await loadReferenceValue(manifest.reference);
          if (!alive()) return;
          const restored = restoreFromReference(payload);
          if (restored.ok) {
            if (!alive()) return;
            pinReviewed(manifest.reference.sha256);
            callback.current({kind: 'saved', restored: restored.value,
              revisionId: manifest.revision_id, manifest});
            setLoading(false);
            return;
          }
          if (alive()) setReopenMessage(
            `The saved revision could not be opened (${restored.message}); showing the proposal instead.`);
        } catch (cause) {
          if (!alive()) return;
          const status = (cause as {status?: number} | null)?.status;
          if (status === 401 || status === 403 || status === 404) {
            setError(cause instanceof Error ? cause.message
              : 'This lesson is no longer available for editing.');
            setLoading(false);
            return;
          }
          setReopenMessage('The saved revision could not be read; showing the current proposal instead.');
        }
      }
      if (!alive()) return;
      const value = await draftPromise;
      if (!alive()) return;
      if (value === null) {
        setError('No draft or saved revision is available for this lesson.');
        setLoading(false);
        return;
      }
      const parsed = parseMusicDraftView(value);
      if (!parsed.ok) throw new Error(parsed.message);
      const draft = parsed.value;
      const spans = draft.spans.map(span => ({start: span.start, end: span.end, kind: span.kind}));
      const clock = scoreClock(spans, draft.duration);
      const document = buildNotation(draft.events.map(event => ({
        id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
        velocity: event.velocity, confidence: event.confidence, optional: event.optional,
        string: event.string, fret: event.fret, notation_duration: event.notation_duration ?? null,
      })), {duration: draft.duration, subject: draft.subject === 'guitar' ? 'guitar' : 'piano',
        scoreSeconds: note => clock.toScore(note.onset), scoreDuration: clock.scoreDuration});
      if (!alive()) return;
      callback.current({kind: 'draft', draft, document});
      setLoading(false);
    } catch (cause) {
      if (alive()) {
        setError(cause instanceof Error ? cause.message : 'The draft could not be opened.');
        setLoading(false);
      }
    }
  }, [lessonId, demo]);

  /**
   * Explicitly re-open the currently saved revision. This shares the load
   * generation/abort owner so navigation, unmount and a newer reopen invalidate a
   * delayed response, and `shouldApply` lets the workspace refuse to overwrite local
   * edits made while the reference was in flight.
   */
  const reopenSaved = useCallback(async (options?: {shouldApply?: () => boolean}):
    Promise<ReopenSavedResult> => {
    if (demo) return {status: 'error', message: 'The demo workspace has no saved revision to reopen.'};
    if (!lessonId) return {status: 'error', message: 'This review link is incomplete.'};
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const run = ++generation.current;
    const alive = () => mounted.current && run === generation.current;
    try {
      const manifest = await request<ReviewManifestDocument>(
        `/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false,
        {'X-Lesson-Formats': '1,2'}, controller.signal);
      if (!alive()) return {status: 'cancelled'};
      if (!manifest?.revision_id || !manifest.reference?.key) {
        return {status: 'error', message: 'The saved revision is no longer available to reopen.'};
      }
      let payload: unknown;
      try {
        // SHA-256 (and size, when supplied) is verified before the value is ever cached.
        payload = await loadReferenceValue(manifest.reference);
      } catch (cause) {
        if (!alive()) return {status: 'cancelled'};
        return {status: 'error', message: cause instanceof Error
          ? cause.message : 'The saved revision could not be reopened.'};
      }
      if (!alive()) return {status: 'cancelled'};
      const restored = restoreFromReference(payload);
      if (!restored.ok) return {status: 'error', message: restored.message};
      if (options?.shouldApply && !options.shouldApply()) {
        return alive() ? {status: 'stale'} : {status: 'cancelled'};
      }
      pinReviewed(manifest.reference.sha256);
      const value: Extract<LoadedReview, {kind: 'saved'}> = {
        kind: 'saved', restored: restored.value, revisionId: manifest.revision_id, manifest,
      };
      callback.current(value);
      return {status: 'applied', value};
    } catch (cause) {
      if (!alive()) return {status: 'cancelled'};
      return {status: 'error', message: cause instanceof Error
        ? cause.message : 'The saved revision could not be reopened.'};
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }, [lessonId, demo]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
      abort.current?.abort();
      abort.current = null;
      if (pinned.current) { unpinReference(pinned.current); pinned.current = null; }
    };
  }, [load]);

  return {loading, error, reopenMessage, reopenSaved};
}
