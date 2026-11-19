import {useRef, useState} from 'react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {PoseAlignmentReport} from '../../../packages/learning-engine/pose-best-fit-align';
import {assetUrl} from './api';
import {Button} from './ui/controls';
import {MOVEMENT_UPLOAD_UI_ENABLED, analyzeMovementUpload} from './movement-upload';

/**
 * Default-off whole-run movement upload surface. It never replaces the shipped
 * CompetitionSession scorer; it exists only for the reviewed upload validation path.
 */
export function MovementUploadPanel({lesson, disabled=false}:{lesson:LessonManifest; disabled?:boolean}) {
  const [progress,setProgress]=useState(0);
  const [report,setReport]=useState<PoseAlignmentReport|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const abort=useRef<AbortController|null>(null);
  if(!MOVEMENT_UPLOAD_UI_ENABLED)return null;
  const run=async(file:File)=>{
    abort.current?.abort();
    const controller=new AbortController();
    abort.current=controller;
    setBusy(true);setError('');setReport(null);setProgress(0);
    try{
      if(!lesson.landmarks)throw new Error('This lesson has no movement comparison reference.');
      const response=await fetch(assetUrl(lesson.landmarks.key),{credentials:'same-origin',signal:controller.signal});
      if(!response.ok)throw new Error('The movement comparison reference could not load.');
      const reference=await response.json() as {times?:unknown;keypoints?:unknown};
      if(!Array.isArray(reference.times)||!Array.isArray(reference.keypoints)||reference.keypoints.some(row=>!Array.isArray(row)||row.length<63))
        throw new Error('This lesson has no compatible movement reference.');
      const result=await analyzeMovementUpload(file,reference as {times:number[];keypoints:number[][][]},{
        sections:lesson.section_set.sections,signal:controller.signal,
        onProgress:value=>setProgress(value),
      });
      setReport(result.report);
    }catch(cause){
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'The uploaded video could not be analysed.');
    }finally{
      if(!controller.signal.aborted)setBusy(false);
    }
  };
  return <section className="movement-upload-panel" aria-label="Movement video upload">
    <h3>Movement video upload · experimental</h3>
    <p className="small muted">Local pose sampling and whole-run alignment only. This does not replace the shipped challenge scorer and is not used for leaderboards.</p>
    <input type="file" accept="video/*,.mp4,.webm,.mov" aria-label="Upload movement video" disabled={disabled||busy}
      onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void run(file);}}/>
    {busy&&<p className="small muted" role="status">Analysing frames… {Math.round(progress*100)}%
      <Button variant="immersive-action" type="button" onClick={()=>abort.current?.abort()}>Cancel</Button></p>}
    {error&&<p className="small muted" role="alert">{error}</p>}
    {report&&<p className="small muted" role="status">Offset {report.offsetSeconds===null?'unavailable':`${report.offsetSeconds.toFixed(2)}s`} · coverage {Math.round(report.coverage*100)}% · score withheld{report.ambiguous?' · ambiguous alignment':''}.</p>}
  </section>;
}
