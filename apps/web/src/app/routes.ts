/**
 * Route and auth-return vocabulary for the application shell.
 *
 * Pure parsing: no React, no fetch, no navigation side effects. LibraryApp keeps
 * the state machine, but every query/hash shape and the short-lived return intent
 * live here so links, invites and refresh/back behave the same in one place.
 */

export type Page =
  | 'music-review' | 'music-edit' | 'music-comparison' | 'drawing-edit' | 'drawing-share' | 'moves' | 'preview'
  | 'compete' | 'practice' | 'review' | 'create' | 'account' | 'share' | 'join'
  | 'receiver' | 'check' | 'move' | 'groups' | 'group' | 'groupjoin'
  | 'explore' | 'public' | 'studio' | 'admin';

export const ROUTE_PAGES: ReadonlySet<Page> = new Set<Page>([
  'music-review', 'music-edit', 'music-comparison', 'drawing-edit', 'drawing-share', 'moves', 'preview', 'compete',
  'practice', 'review', 'create', 'account', 'share', 'join', 'receiver', 'check',
  'move', 'groups', 'group', 'groupjoin', 'explore', 'public', 'studio', 'admin',
]);

/** Pages that address one lesson through `?id=` (or `?source=` / `?adjust=`). */
export const LESSON_PAGES: ReadonlySet<Page> = new Set<Page>([
  'preview', 'compete', 'practice', 'review', 'check', 'move', 'share', 'drawing-edit', 'drawing-share',
]);

/** Pages that need an authenticated account before they can resolve. */
export const ACCOUNT_PAGES: ReadonlySet<Page> = new Set<Page>([
  'group', 'studio', 'receiver', 'admin', 'music-review', 'music-comparison', 'drawing-edit', 'drawing-share',
]);

export type RouteState = {
  page: Page;
  id: string | null;
  source: string | null;
  adjust: string | null;
  linkedLesson: string | null;
};

/** Public/demo routing is derived from validated audience, never media keys. */
export function lessonPageUrl({page, lessonId, audience}: {
  page: Page; lessonId: string; audience?: string | null;
}): string {
  const query = new URLSearchParams({page, id: lessonId});
  if (audience === 'public') query.set('source', 'public');
  else if (audience === 'demo') query.set('source', 'demo');
  return `/?${query.toString()}`;
}

export function routeOf(search?: string): RouteState {
  const query = new URLSearchParams(
    search ?? (typeof location === 'undefined' ? '' : location.search));
  const requested = query.get('page') ?? '';
  return {
    page: (ROUTE_PAGES.has(requested as Page) ? requested : 'moves') as Page,
    id: query.get('id'),
    source: query.get('source'),
    adjust: query.get('adjust'),
    linkedLesson: query.get('lesson'),
  };
}

export type AuthView = 'login' | 'register' | 'forgot' | 'reset' | 'verify';

export type AuthLink = {view: AuthView; token: string};

/** `#verify=<token>` / `#reset=<token>` — consumed once, never put in a query. */
export function linkAction(hash?: string): AuthLink | null {
  const value = hash ?? (typeof location === 'undefined' ? '' : location.hash);
  const match = value.match(/^#(verify|reset)=([A-Za-z0-9_-]{32,128})$/);
  return match ? {view: match[1] as AuthView, token: match[2]} : null;
}

/** `#group=<token>` — the group invitation secret. */
export function groupInviteOf(hash?: string): string | null {
  const value = hash ?? (typeof location === 'undefined' ? '' : location.hash);
  const match = value.match(/^#group=([A-Za-z0-9_-]{32,128})$/);
  return match ? match[1] : null;
}

type PendingRecord<T> = {value: T; until: number};

/**
 * Short-lived same-tab intent (auth return, invite). Survives a sign-in round trip
 * but expires; it is not a durable cache and never holds lesson content.
 */
export function pending<T>(key: string, value?: T): T | null {
  try {
    if (value !== undefined) {
      sessionStorage.setItem(key, JSON.stringify({value, until: Date.now() + 30 * 60 * 1000}));
      return value;
    }
    const item = JSON.parse(sessionStorage.getItem(key) ?? 'null') as PendingRecord<T> | null;
    if (item && item.until > Date.now()) return item.value;
    sessionStorage.removeItem(key);
  } catch {
    /* Storage can be unavailable; the caller still has its in-memory intent. */
  }
  return null;
}
