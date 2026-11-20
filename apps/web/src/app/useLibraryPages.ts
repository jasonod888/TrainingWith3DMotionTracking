/** Cohesive owned-library paging binding over createLibraryPager(). */
import {useCallback, useEffect, useRef, useState} from 'react';
import {loadLessonSummariesPage, type LessonSummaryPage} from '../api';
import type {LessonSummary} from '../../../../packages/lesson-schema/index';
import {createLibraryPager} from './library-pager';

export type LibraryPagesLoader = (options: {limit: number; offset: number;
  q?: string; subject?: string}) => Promise<LessonSummaryPage>;

export function useLibraryPages({accountId, query, subject, enabled = true,
  loadPage = loadLessonSummariesPage}: {
  accountId: string | null;
  query: string;
  subject: string;
  enabled?: boolean;
  loadPage?: LibraryPagesLoader;
}) {
  const pager = useRef(createLibraryPager<LessonSummary>()).current;
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const apply = useCallback((generation: number, page: LessonSummaryPage) => {
    const next = pager.reload(generation, page);
    if (!next) return false;
    setLessons(next.lessons); setTotal(next.total); setHasMore(next.hasMore);
    setAvailableSubjects(next.availableSubjects); setLoading(false);
    setLoadingMore(false);
    return true;
  }, [pager]);

  const reload = useCallback(async () => {
    if (!accountId || !enabled) {
      setLessons([]); setTotal(0); setHasMore(false); setLoadingMore(false); return;
    }
    const generation = pager.beginReload();
    setLoading(true); setError(''); setLoadingMore(false);
    try {
      const page = await loadPage({limit: 100, offset: 0, q: query,
        subject: subject === 'all' ? undefined : subject});
      apply(generation, page);
    } catch (cause) {
      if (pager.isCurrent(generation)) {
        setError(cause instanceof Error ? cause.message : 'Your library could not load.');
        setLoading(false);
      }
    }
  }, [accountId, enabled, query, subject, pager, loadPage, apply]);

  useEffect(() => {
    pager.beginReload();
    setLoadingMore(false);
    if (!accountId || !enabled) {
      setLessons([]); setTotal(0); setHasMore(false); setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => { void reload(); }, 200);
    return () => window.clearTimeout(timer);
  }, [accountId, query, subject, enabled, reload, pager]);

  const loadMore = useCallback(async () => {
    if (!accountId || loadingMore || !hasMore) return;
    const generation = pager.beginLoadMore();
    const current = {lessons, total, hasMore, availableSubjects, loadingMore: true};
    setLoadingMore(true);
    try {
      const page = await loadPage({limit: 100, offset: lessons.length, q: query,
        subject: subject === 'all' ? undefined : subject});
      const next = pager.append(generation, current, page);
      if (!next) return;
      setLessons(next.lessons); setTotal(next.total); setHasMore(next.hasMore);
      setAvailableSubjects(next.availableSubjects);
    } catch (cause) {
      if (pager.isCurrent(generation)) setError(cause instanceof Error ? cause.message : 'More lessons could not load.');
    } finally {
      if (pager.isCurrent(generation)) setLoadingMore(false);
    }
  }, [accountId, loadingMore, hasMore, lessons, total, availableSubjects, query, subject, pager, loadPage]);

  const invalidate = useCallback(() => { pager.beginReload(); }, [pager]);

  return {lessons, total, hasMore, loadingMore, availableSubjects, loading, error,
    reload, loadMore, invalidate};
}
