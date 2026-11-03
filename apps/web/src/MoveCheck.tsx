import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,Pause,Play,RotateCcw,Video,Box} from 'lucide-react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {Playback} from '../../../packages/learning-engine/playback';
import {MotionStage} from './MotionStage';
import {VideoTimeline} from './VideoTimeline';
import {acceptMove,trimMove,assetUrl} from './api';
import {instructorStart,lessonFrameTime} from './lesson-clock';

export function MoveCheck({lesson,onBack,onAccepted,onChooseAnother,onDirty}:{
 lesson:LessonManifest;onBack:()=>void;onAccepted:(lesson:LessonManifest)=>void;onChooseAnother:()=>void;onDirty?:(dirty:boolean)=>void;
}){
 const player=useRef(new Playback(lesson.section_set.sections,lesson.duration)).current;
 const fps=lesson.frame_rate??15,total=Math.ceil(lesson.duration*fps),minimum=Math.ceil(.05*fps);
 const [start,setStart]=useState(0),[end,setEnd]=useState(total);
 const range=useRef({start:0,end:lesson.duration});range.current={start:start/fps,end:Math.min(end/fps,lesson.duration)};
 const [state,setState]=useState(player.snapshot());
 const notes=useRef<HTMLDialogElement>(null);
 const [source,setSource]=useState(Boolean(lesson.focused_video||lesson.source_video)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[warnings,setWarnings]=useState(false);
 const previewVideo=lesson.focused_video??lesson.source_video;
 const switchPreview=(video:boolean)=>{player.seek(lessonFrameTime(lesson,player.state.time));setState(player.snapshot());setSource(video);};
 const changed=start!==0||end!==total;
 useEffect(()=>{if(warnings)notes.current?.showModal();else notes.current?.close();},[warnings]);
 useEffect(()=>{player.mode('continuous');},[player]);
 useEffect(()=>{onDirty?.(changed);const leave=(e:BeforeUnloadEvent)=>{if(changed){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>{onDirty?.(false);window.removeEventListener('beforeunload',leave);};},[changed,onDirty]);
 useEffect(()=>{
  let frame=0,last=performance.now(),draw=last;
  const tick=(now:number)=>{player.tick(Math.min((now-last)/1000,.25));last=now;if(player.state.time>=range.current.end)player.seek(range.current.end);if(now-draw>60){setState(player.snapshot());draw=now;}frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[player]);
 const seek=(time:number)=>{player.seek(Math.max(range.current.start,Math.min(time,range.current.end)));setState(player.snapshot());};
 const adjust=(from:number,to:number)=>{
  const nextStart=Math.max(0,Math.min(Math.round(from*fps),total-minimum));
  const nextEnd=Math.max(nextStart+minimum,Math.min(to>=lesson.duration-1e-6?total:Math.round(to*fps),total));
  const time=nextStart!==start?nextStart/fps:Math.min(nextEnd/fps,lesson.duration);
  range.current={start:nextStart/fps,end:Math.min(nextEnd/fps,lesson.duration)};
  setError('');setStart(nextStart);setEnd(nextEnd);player.seek(time);setState(player.snapshot());
 };
 const play=()=>{if(player.state.playing)player.command('pause');else{if(player.state.time<range.current.start||player.state.time>=range.current.end-1e-6)player.seek(range.current.start);player.command('play');}setState(player.snapshot());};
 const accept=async()=>{setBusy(true);setError('');player.command('pause');try{const value=changed?await trimMove(lesson,start,end):lesson;if(!changed)await acceptMove(value.lesson_id,value.revision_id,value.warnings);onDirty?.(false);onAccepted(value);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const stamp=(time:number)=>`${Math.floor(time/60)}:${(time%60).toFixed(2).padStart(5,'0')}`;
 return <section className="workflow-screen check-screen" aria-label="Review and trim your move">
  <header className="check-heading"><button className="round" aria-label="Back to my moves" disabled={busy} onClick={onBack}><ArrowLeft size={20}/></button><div><p className="eyebrow">REVIEW & TRIM</p><h1 title={lesson.title}>{lesson.title}</h1></div><span className="check-instruction">Keep the movement you want to practise.</span></header>
  <div className="check-stage motion-stage">
   <div className="stage-top"><span className="stage-pill"><i/>{source?lesson.focused_video?'Segmented instructor':'Original video':'3D move'}</span>
    {previewVideo&&<div className="view-switch" aria-label="Preview source"><button aria-label="Show segmented instructor" title={lesson.focused_video?'Segmented instructor':'Original video'} aria-pressed={source} className={source?'selected':''} onClick={()=>switchPreview(true)}><Video size={17}/></button><button aria-label="Show 3D move" title="3D move · same selected frames" aria-pressed={!source} className={!source?'selected':''} onClick={()=>switchPreview(false)}><Box size={17}/></button></div>}
   </div>
   <MotionStage lesson={lesson} player={player} source={source} fit="envelope"/>
   <div className="stage-bottom"><button className="check-play" disabled={busy} onClick={play} aria-label={state.playing?'Pause preview':'Play selected frames'}>{state.playing?<Pause size={18}/>:<Play size={18} fill="currentColor"/>}{state.playing?'Pause':'Play selection'}</button><span>{stamp(state.time)} / {stamp(lesson.duration)}</span></div>
  </div>
  <div className="check-trim" aria-label="Trim movement frames">
   <div className="check-trim-heading"><strong>Trim both views <span>· {stamp(range.current.end-range.current.start)} kept</span></strong><button className="back-link" disabled={busy||!changed} onClick={()=>{setStart(0);setEnd(total);player.seek(0);setState(player.snapshot());}}><RotateCcw size={14}/>Reset</button></div>
   <VideoTimeline compact frameRate={fps} source={previewVideo?assetUrl(previewVideo.key):undefined} sourceStart={instructorStart(lesson,Boolean(lesson.focused_video))} duration={lesson.duration} time={state.time} disabled={busy} onSeek={seek} range={{start:range.current.start,end:range.current.end,maxLength:lesson.duration,onChange:adjust}}/>

  </div>
  <footer className="check-footer"><div className="check-feedback">{error?<p role="alert">{error}</p>:<span>Preview the selection, then keep it. {lesson.warnings.length>0&&<button onClick={()=>setWarnings(true)}>Review notes ({lesson.warnings.length})</button>}</span>}</div><div className="check-actions"><button className="secondary" disabled={busy} onClick={onChooseAnother}>Choose another video</button><button className="primary" disabled={busy} onClick={()=>void accept()}><Check size={18}/>{busy?'Saving…':'Looks good'}</button></div></footer>
  <dialog ref={notes} className="check-notes" aria-label="Review notes" onClose={()=>setWarnings(false)}><strong>Review notes</strong><ul>{lesson.warnings.map(w=><li key={w}>{w}</li>)}</ul><button className="primary" autoFocus onClick={()=>setWarnings(false)}>Got it</button></dialog>
 </section>;
}
