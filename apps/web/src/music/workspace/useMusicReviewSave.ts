/** Cohesive save/conflict state for the music review workspace. */
import {useCallback, useEffect, useRef, useState} from 'react';
import {classifySaveError, privateSaveMessage, saveReviewedReference} from './editor-services';

export function useMusicReviewSave({lessonId, editorSession, onSaved}: {
  lessonId: string | null;
  editorSession: {saved: (revisionId: string) => void; conflict: (message: string) => void;
    reviewed?: (revisionId: string) => void; markDirty?: () => void};
  onSaved?: (manifest: {revision_id: string}, stillCurrent: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveConflict, setSaveConflict] = useState(false);
  const [conflictKind, setConflictKind] = useState<'stale' | 'verification' | 'other'>('other');
  const saveGenRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveGenRef.current += 1;
    };
  }, []);

  // Switching lessons or handing the workspace a different shared session invalidates
  // any save started for the previous lesson and clears its transient outcome.
  useEffect(() => {
    saveGenRef.current += 1;
    setSaving(false);
    setSaveError('');
    setSaveMessage('');
    setSaveConflict(false);
  }, [lessonId, editorSession]);

  const save = useCallback(async ({baseRevisionId, body, isCurrent}: {
    baseRevisionId: string | null;
    body: Record<string, unknown>;
    isCurrent: () => boolean;
  }) => {
    if (!lessonId) return null;
    const gen = ++saveGenRef.current;
    // A delayed response for this lesson may only mutate state while this exact
    // save is still current and the workspace is still mounted.
    const alive = () => mountedRef.current && gen === saveGenRef.current;
    setSaving(true);
    setSaveError('');
    setSaveMessage('');
    setSaveConflict(false);
    try {
      const manifest = await saveReviewedReference(lessonId, baseRevisionId, body);
      if (!alive()) return null;
      const stillCurrent = isCurrent();
      // This endpoint is an explicit reviewed private save; a session that supports it
      // must record a completed review, not merely a save transition.
      if (editorSession.reviewed) editorSession.reviewed(manifest.revision_id);
      else editorSession.saved(manifest.revision_id);
      // Even an older-snapshot save advances the shared base revision; newer local
      // edits stay dirty and must not be reported as saved work.
      if (!stillCurrent) editorSession.markDirty?.();
      setSaveConflict(false);
      setSaveMessage(privateSaveMessage(manifest.revision_id, stillCurrent));
      onSaved?.(manifest, stillCurrent);
      return manifest;
    } catch (cause) {
      if (!alive()) return null;
      const info = classifySaveError(cause);
      if (info.conflict) {
        editorSession.conflict(info.message);
        setSaveConflict(true);
        setConflictKind(info.kind ?? 'other');
        setSaveError(info.message);
      } else {
        setSaveError(info.message);
      }
      return null;
    } finally {
      if (alive()) setSaving(false);
    }
  }, [lessonId, editorSession, onSaved]);

  return {saving, saveMessage, saveError, saveConflict, conflictKind,
    setSaveError, setSaveConflict, setSaveMessage, save};
}
