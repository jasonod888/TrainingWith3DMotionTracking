/** Shared publication binding: readiness, exact revision, mutation and handoff. */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {loadPublishability, updatePublic, type Publishability} from '../api';
import {applyReleaseChange} from '../editor/revision-handoff';

export type PublicationInput = {
  title: string;
  creatorName: string;
  tags: string[];
  description?: string;
  rightsAcknowledged: boolean;
  roles?: string[];
  /** Exact accepted revision when the caller is releasing a specific save. */
  releaseRevisionId?: string;
};

export function usePublicationController({lessonId, initialRoles = []}: {
  lessonId: string; initialRoles?: string[];
}) {
  const [publishability, setPublishability] = useState<Publishability | null>(null);
  const [roles, setRoles] = useState<string[]>(initialRoles);
  const [rights, setRights] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadGenRef = useRef(0);
  const mountedRef = useRef(true);
  const roleKey = roles.join(',');

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    loadGenRef.current += 1;
    setPublishability(null);
  }, [lessonId]);

  const reload = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true); setError('');
    try {
      const value = await loadPublishability(lessonId, 'public', roles);
      if (!mountedRef.current || gen !== loadGenRef.current) return;
      setPublishability(value);
      if (!roles.length && value.roles.length) setRoles(value.roles);
    } catch (cause) {
      if (!mountedRef.current || gen !== loadGenRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Publication readiness could not load.');
    } finally {
      if (mountedRef.current && gen === loadGenRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, roleKey]);

  useEffect(() => { void reload(); }, [reload]);

  const canPublish = Boolean(publishability?.publishable && rights
    && (roles.length || publishability?.roles.length));

  const publish = useCallback(async (input: PublicationInput) => {
    setBusy(true); setError(''); setNotice('');
    if (!input.rightsAcknowledged) {
      setBusy(false); setError('Confirm you have the right to publish this lesson publicly.');
      return false;
    }
    try {
      await updatePublic(lessonId, {
        listed: true, title: input.title, creator_name: input.creatorName,
        description: input.description, tags: input.tags,
        rights_acknowledged: true, public_roles: input.roles ?? roles,
        ...(input.releaseRevisionId ? {release_revision_id: input.releaseRevisionId} : {}),
      });
      applyReleaseChange(lessonId);
      setNotice('This lesson is now public.');
      await reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This lesson could not be published.');
      return false;
    } finally { setBusy(false); }
  }, [lessonId, roles, reload]);

  const unlist = useCallback(async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await updatePublic(lessonId, {listed: false});
      applyReleaseChange(lessonId);
      setNotice('This lesson is no longer public.');
      await reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This lesson could not be unpublished.');
      return false;
    } finally { setBusy(false); }
  }, [lessonId, reload]);

  return useMemo(() => ({
    publishability, roles, setRoles, rights, setRights, loading, busy, error, notice,
    canPublish, publish, unlist, reload,
  }), [publishability, roles, rights, loading, busy, error, notice, canPublish, publish, unlist, reload]);
}
