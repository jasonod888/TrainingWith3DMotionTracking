import {definePracticePlan, type PracticePlan, type PracticeUnit} from '../../../../packages/learning-engine/practice-plan';
import type {LessonManifest, MusicLessonManifest, Section} from '../../../../packages/lesson-schema/index';
import type {PracticeChunk} from '../music/practice-chunks';

const unitsFromSections = (sections: readonly Section[]): PracticeUnit[] => sections.map(section => ({
  id: section.id,
  label: section.label,
  start: section.start,
  end: section.end,
}));

const wholeLesson = (duration: number, label = 'Whole lesson'): PracticeUnit[] => [{
  id: 'whole-lesson', label, start: 0, end: duration,
}];

export function bodyPracticePlan(lesson: LessonManifest): PracticePlan {
  const sections = lesson.section_set?.sections ?? [];
  return definePracticePlan({
    lessonId: lesson.lesson_id,
    revisionId: lesson.revision_id,
    title: lesson.title,
    duration: lesson.duration,
    units: sections.length ? unitsFromSections(sections) : wholeLesson(lesson.duration),
  });
}

export function musicPracticePlan(lesson: MusicLessonManifest): PracticePlan {
  const sections = lesson.section_set?.sections ?? [];
  return definePracticePlan({
    lessonId: lesson.lesson_id,
    revisionId: lesson.revision_id,
    title: lesson.title,
    duration: lesson.duration,
    units: sections.length ? unitsFromSections(sections) : wholeLesson(lesson.duration, 'Whole piece'),
  });
}

/**
 * Piano units come from reviewed bars and alignment. The unit identity uses the
 * measure span, so changing bars-per-chunk remaps a restored position by time.
 */
export function pianoPracticePlan(input: {
  lessonId: string;
  revisionId: string;
  title: string;
  duration: number;
  chunks: readonly PracticeChunk[];
  wholePieceLabel?: string;
}): PracticePlan {
  const units: PracticeUnit[] = input.chunks.length
    ? input.chunks.map(chunk => ({
      id: chunk.measureEnd > chunk.measureStart
        ? `bars:${chunk.measureStart}-${chunk.measureEnd}`
        : `bars:${chunk.measureStart}`,
      label: chunk.label,
      start: chunk.start,
      end: chunk.end,
      metadata: {measureStart: chunk.measureStart, measureEnd: chunk.measureEnd},
    }))
    : wholeLesson(input.duration, input.wholePieceLabel ?? 'Whole piece');
  return definePracticePlan({
    lessonId: input.lessonId,
    revisionId: input.revisionId,
    title: input.title,
    duration: input.duration,
    units,
  });
}
