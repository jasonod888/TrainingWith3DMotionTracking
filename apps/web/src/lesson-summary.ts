import type {LessonManifest,LessonSummary} from '../../../packages/lesson-schema/index';

/** Local demo and body mutation responses only. Stored discovery uses server summaries. */
export function summarizeBody(lesson:LessonManifest,previous?:LessonSummary):LessonSummary{
 return {summary_version:1,lesson_id:lesson.lesson_id,revision_id:lesson.revision_id,title:lesson.title,
  subject:previous?.subject??'movement_other',subject_label:previous?.subject_label??'Full Body Movement',
  experience_family:'body',instrument:null,duration:lesson.duration,section_count:lesson.section_set.sections.length,
  poster:lesson.thumbnail??null,capabilities:{preview:true,practice:true,live_input:'camera'}};
}
