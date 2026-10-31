import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,Pause,Play,Scissors,Share2,SlidersHorizontal} from 'lucide-react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {Playback} from '../../../packages/learning-engine/playback';
import {MotionStage} from './MotionStage';
import {PreviewScrubber} from './PreviewScrubber';
import {audienceLabel,renameMove,type MoveState} from './api';

export function MoveDetail({lesson,state,onBack,onPractice,onShare,onMore,onAdjust,onRenamed}:{
 lesson:LessonManifest;state?:MoveState;onBack:()=>void;onPractice:()=>void;onShare:()=>void;
 onMore:()=>void;onAdjust:()=>void;onRenamed:(value:LessonManifest)=>void;
}){
 const player=useRef(new Playback(lesson.section_set.sections,lesson.duration)).current;
 useEffect(()=>{player.mode('continuous');},[player]);
 const [playing,setPlaying]=useState(false),[title,setTitle]=useState(lesson.title),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{
  let frame=0,last=performance.now();
  const tick=(now:number)=>{player.tick(Math.min((now-last)/1000,.25));last=now;setPlaying(player.state.playing);frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[player]);
 const play=()=>{player.command(player.state.playing?'pause':'play');};
 const rename=async()=>{setSaving(true);setError('');try{const value=await renameMove(lesson.lesson_id,title);onRenamed(value);setNotice('Name saved.');}catch(e){setError((e as Error).message);}finally{setSaving(false);}};
 return <section className="workflow-screen move-screen">
  <div className="workflow-head">
   <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>My moves</button>
   <p className="eyebrow">YOUR MOVE</p>
   <h1>{lesson.title}</h1>
   <p className="subtle">{state?audienceLabel(state.audiences):'Only you'} · {lesson.section_set.sections.length} {lesson.section_set.sections.length===1?'part':'parts'}</p>
  </div>
  <div className="move-stage motion-stage">
   <MotionStage lesson={lesson} player={player}/>
   <button className="move-play" onClick={play} aria-label={playing?'Pause move':'Play move'}>{playing?<Pause size={20}/>:<Play size={20} fill="currentColor"/>}</button>
  </div>
  <PreviewScrubber player={player}/>
  <div className="move-actions">
   <button className="primary" onClick={onPractice}><Play size={18} fill="currentColor"/>Try it now</button>
   <button className="secondary" onClick={onShare}><Share2 size={16}/>Share</button>
  </div>
  <div className="move-tools">
   <button onClick={onAdjust}><Scissors size={15}/>Adjust clip</button>
   <button onClick={onMore}><SlidersHorizontal size={15}/>More adjustments</button>
  </div>
  <div className="name-row">
   <label>Name<input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/></label>
   <button className="secondary" disabled={saving||title.trim()===lesson.title} onClick={()=>void rename()}>{saving?'Saving…':'Save name'}</button>
  </div>
  {notice&&<p className="inline-notice" role="status">{notice}</p>}
  {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
  <p className="small muted">Sharing is optional. Your take is never shared automatically.</p>
 </section>;
}
