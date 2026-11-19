/**
 * Step-based practice adapter for drawing.
 *
 * Transport evaluation: drawing has no video/audio timeline produced by drawing
 * authoring, and inventing media timestamps would make step progress meaningless.
 * The transport therefore exposes the *step index* as its position and the number
 * of steps as its duration: `seek(i)` selects step i, and nothing advances over
 * wall-clock time. `PracticeRuntime` remains the one session authority; the adapter
 * does not create a second timer.
 */
import {definePracticePlan, type PracticePlan} from '../../../../../packages/learning-engine/practice-plan';
import type {PracticeTransport, PracticeTransportSnapshot} from '../../../../../packages/learning-engine/practice-transport';
import type {DrawingLessonManifest} from '../../../../../packages/lesson-schema/index';

export function drawingPlan(document: DrawingLessonManifest): PracticePlan {
  const steps = document.steps;
  return definePracticePlan({
    lessonId: document.lesson_id,
    revisionId: document.revision_id,
    duration: Math.max(1, steps.length),
    units: steps.map((step, index) => ({
      id: step.id,
      label: step.title,
      start: index,
      end: index + 1,
    })),
  });
}

export type DrawingTransport = PracticeTransport & {
  stepCount(): number;
  currentIndex(): number;
};

export function createDrawingTransport(document: DrawingLessonManifest): DrawingTransport {
  const total = Math.max(1, document.steps.length);
  let index = 0;
  let playing = false;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const clamp = (value: number) => Math.max(0, Math.min(total - 1, Math.round(value)));
  const snapshot = (): PracticeTransportSnapshot => ({
    time: index,
    duration: total,
    playing,
    ready: true,
    buffering: false,
    ended: index >= total - 1 && !playing,
    rate: 1,
    error: '',
    mode: 'sections',
  });
  return {
    snapshot,
    play: () => { playing = true; emit(); },
    pause: () => { playing = false; emit(); },
    seek: (seconds: number) => { index = clamp(seconds); emit(); },
    setRate: () => {},
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    destroy: () => { listeners.clear(); playing = false; },
    stepCount: () => total,
    currentIndex: () => index,
  };
}

export function currentStep(document: DrawingLessonManifest, index: number) {
  return document.steps[Math.max(0, Math.min(document.steps.length - 1, index))];
}
