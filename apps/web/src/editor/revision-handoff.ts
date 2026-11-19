/**
 * Revision handoff from an Act editor back to the shell.
 *
 * A saved/reviewed revision invalidates that lesson's cached context (and its
 * release pointer) so the feed, preview and editor cannot keep showing stale
 * capabilities or stale release metadata. Preview/practice of a private draft
 * never changes the released revision.
 */
import {invalidateLessonContext} from '../app/lesson-context';

export type SavedRevision = {lessonId: string; revisionId: string};

export function applySavedRevision(lessonId: string, revisionId: string): SavedRevision {
  invalidateLessonContext(lessonId);
  return {lessonId, revisionId};
}

/** Called after an explicit release change (publish/unpublish/update). */
export function applyReleaseChange(lessonId: string): void {
  invalidateLessonContext(lessonId);
}
