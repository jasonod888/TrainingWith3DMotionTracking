/** Small generation-based pager guard shared by LibraryApp and tests. */
export type PagerPage<T> = {
  lessons: T[];
  total: number;
  has_more: boolean;
  available_subjects: string[];
};

export type PagerState<T> = {
  lessons: T[];
  total: number;
  hasMore: boolean;
  availableSubjects: string[];
  loadingMore: boolean;
};

export type LibraryPager<T extends {lesson_id: string}> = {
  /** Start a reload (search/subject/account change) and invalidate older work. */
  beginReload(): number;
  /** Snapshot for a load-more request; invalidated by any beginReload(). */
  beginLoadMore(): number;
  isCurrent(generation: number): boolean;
  reload(generation: number, page: PagerPage<T>): PagerState<T> | null;
  append(generation: number, current: PagerState<T>, page: PagerPage<T>): PagerState<T> | null;
  settle(generation: number, current: PagerState<T>): PagerState<T> | null;
};

export function createLibraryPager<T extends {lesson_id: string}>(): LibraryPager<T> {
  let generation = 0;
  const normalize = (page: PagerPage<T>): Omit<PagerState<T>, 'lessons' | 'loadingMore'> => ({
    total: page.total,
    hasMore: page.has_more,
    availableSubjects: page.available_subjects,
  });
  return {
    beginReload() { generation += 1; return generation; },
    beginLoadMore() { return generation; },
    isCurrent(value) { return value === generation; },
    reload(value, page) {
      if (value !== generation) return null;
      return {lessons: page.lessons, loadingMore: false, ...normalize(page)};
    },
    append(value, current, page) {
      if (value !== generation) return null;
      return {
        lessons: [...current.lessons, ...page.lessons.filter(item =>
          !current.lessons.some(old => old.lesson_id === item.lesson_id))],
        loadingMore: false,
        ...normalize(page),
      };
    },
    settle(value, current) {
      if (value !== generation) return null;
      return {...current, loadingMore: false};
    },
  };
}
