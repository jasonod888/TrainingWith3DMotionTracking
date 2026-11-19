/**
 * Where a feed/library action opens. Kept pure so the shell stays a state machine
 * and the same decision can be unit tested without mounting the application.
 */
import type {Page} from './routes';

export type OpenMode = 'auto' | 'practice' | 'check' | 'edit';

/**
 * Music management never opens the practice surface directly: an unreviewed or
 * unreleased lesson must go through the reference review first.
 */
export function musicManageTarget(input: {
  owned: boolean;
  mode: OpenMode;
  latestRevisionId?: string | null;
}): 'music-review' | 'music-edit' | null {
  if (!input.owned) return null;
  if (input.mode === 'edit') return 'music-edit';
  if (input.mode === 'check' || !input.latestRevisionId) return 'music-review';
  return null;
}

/** Body opens preview for watchers, and check/review/move for the owner. */
export function bodyOpenTarget(input: {
  owned: boolean;
  mode: OpenMode;
  needsCheck: boolean;
}): Extract<Page, 'preview' | 'check' | 'review' | 'move'> {
  if (!input.owned || input.mode === 'practice') return 'preview';
  if (input.mode === 'edit') return 'review';
  if (input.mode === 'check' || input.needsCheck) return 'check';
  return 'move';
}

/** Audience implied by a compatibility `?source=` value, before the server answers. */
export function audienceForSource(source: string | null | undefined): 'public' | 'demo' | 'owner' {
  if (source === 'public') return 'public';
  if (source === 'demo') return 'demo';
  return 'owner';
}
