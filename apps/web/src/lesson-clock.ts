import type {LessonManifest} from '../../../packages/lesson-schema/index';

/** One reconstructed frame is the common unit for video, animation and trims. */
export function lessonFrameTime(lesson:LessonManifest,time:number):number{
 const fps=lesson.frame_rate??15;
 return Math.min(lesson.duration,Math.max(0,Math.floor((time+1e-7)*fps)/fps));
}
export function instructorStart(lesson:LessonManifest,focused:boolean):number{
 return focused?(lesson.focused_video_start??lesson.source_start):lesson.source_start;
}
export function animationFrameTime(lesson:LessonManifest,time:number):number{
 return (lesson.animation_start??0)+lessonFrameTime(lesson,time);
}
