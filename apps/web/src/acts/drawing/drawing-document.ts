/**
 * Drawing document boundary. A drawing lesson is its own discriminated payload:
 * ordered steps, a medium, and explicit `assessment: none`. Body fields and music
 * fields are refused by the shared validator rather than coerced.
 */
import {parseDrawingLessonManifest} from '../../../../../packages/lesson-schema/parse';
import type {DrawingLessonManifest, DrawingStep} from '../../../../../packages/lesson-schema/index';
import type {LessonDocument} from '../../../../../packages/lesson-schema/index';

export type {DrawingLessonManifest, DrawingStep};

export function isDrawingDocument(document: LessonDocument): document is {kind: 'drawing'; value: DrawingLessonManifest} {
  return document.kind === 'drawing';
}

export function parseDrawing(value: unknown): {ok: true; value: DrawingLessonManifest} | {ok: false; message: string} {
  return parseDrawingLessonManifest(value);
}

export function drawingSteps(value: DrawingLessonManifest): DrawingStep[] {
  return [...value.steps];
}
