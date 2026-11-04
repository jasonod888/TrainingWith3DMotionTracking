import {ApiError} from './api';
import type {LessonDocument} from '../../../packages/lesson-schema/index';
import {parseLessonDocument} from '../../../packages/lesson-schema/parse';

/** Formats this build understands. Old clients send nothing and default to v1. */
export const LESSON_FORMATS = '1,2';

/**
 * Load one lesson through the validated boundary.
 *
 * A 406 means the server knows this lesson is a format this build does not speak;
 * that is recoverable (refresh), unlike a body-shaped fake or a permission error.
 */
export async function loadLessonDocument(id: string): Promise<LessonDocument> {
  const response = await fetch(`/api/lessons/${encodeURIComponent(id)}`, {
    credentials: 'same-origin',
    headers: {'X-Lesson-Formats': LESSON_FORMATS},
  });
  if (response.status === 406) {
    const data = await response.json().catch(() => null);
    throw new ApiError(typeof data?.detail === 'string' ? data.detail : 'This lesson needs a newer version of the app. Refresh to update.', 406);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(typeof data?.detail === 'string' ? data.detail : 'Your lesson could not be loaded. Try again.', response.status);
  }
  const parsed = parseLessonDocument(await response.json().catch(() => null));
  if (!parsed.ok) throw new ApiError(parsed.message, 422);
  return parsed.value;
}
