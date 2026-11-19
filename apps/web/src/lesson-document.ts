import {loadLessonContext} from './app/lesson-context';
import type {LessonDocument} from '../../../packages/lesson-schema/index';

/** Formats this build understands. Old clients send nothing and default to v1. */
export const LESSON_FORMATS = '1,2';

/**
 * Compatibility wrapper over the single loading boundary.
 *
 * All validation, Act negotiation and caching live in `loadLessonContext`; this
 * function only returns the specialized document for callers that do not need the
 * context. New callers should load the context and pass it to Act entry points.
 */
export async function loadLessonDocument(id: string): Promise<LessonDocument> {
  const context = await loadLessonContext(id, {accountScope: 'guest'});
  return context.document;
}
