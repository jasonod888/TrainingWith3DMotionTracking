import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,Pause,Play,Plus,Scissors,SlidersHorizontal,Video,Box} from 'lucide-react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {Playback} from '../../../packages/learning-engine/playback';
import {MotionStage} from './MotionStage';
import {PreviewScrubber} from './PreviewScrubber';
import {acceptMove} from './api';

export function MoveCheck({lesson,onBack,onAccepted,onAdjust,onChooseAnother,onMore}:{
 lesson:LessonManifest;onBack:()=>void;onAccepted:()=>void;onAdjust:()=>void;onChooseAnother:()=>void;onMore:()=>void;
}){
 const player=useRef(new Playback(lesson.section_set.sections,lesson.duration)).current;
 useEffect(()=>{player.mode('continuous');},[player]);
 const [state,setState]=useState(player.snapshot());
 const [source,setSource]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let frame=0,last=performance.now(),draw=last;
  const tick=(now:number)=>{player.tick(Math.min((now-last)/1000,.25));last=now;if(now-draw>80){setState(player.snapshot());draw=now;}frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame);
 },[player]);
 const play=()=>{player.command(player.state.playing?'pause':'play');setState(player.snapshot());};
 const accept=async()=>{setBusy(true);setError('');try{await acceptMove(lesson.lesson_id,lesson.revision_id,lesson.warnings);onAccepted();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="workflow-screen check-screen">
  <div className="workflow-head">
   <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>My moves</button>
   <p className="eyebrow">CHECK YOUR MOVE</p>
   <h1>{lesson.title}</h1>
   <p className="subtle">This is what you will practise. Accept it when the movement looks right.</p>
  </div>
  <div className="check-stage motion-stage">
   <div className="stage-top"><span className="stage-pill"><i/>{source?'Original video':'3D move'}</span>
    {lesson.source_video&&<div className="view-switch" aria-label="Preview source"><button aria-label="Show 3D move" aria-pressed={!source} className={!source?'selected':''} onClick={()=>setSource(false)}><Box size={17}/></button><button aria-label="Show original video" aria-pressed={source} className={source?'selected':''} onClick={()=>setSource(true)}><Video size={17}/></button></div>}
   </div>
   <MotionStage lesson={lesson} player={player} source={source}/>
   <div className="stage-bottom"><button className="check-play" onClick={play} aria-label={state.playing?'Pause preview':'Play preview'}>{state.playing?<Pause size={18}/>:<Play size={18} fill="currentColor"/>}{state.playing?'Pause':'Play'}</button><span>{(state.time).toFixed(1)}s · {lesson.section_set.sections.length===1?'One move':`${lesson.section_set.sections.length} parts`}</span></div>
  </div>
  <PreviewScrubber player={player}/>
  {lesson.warnings.length>0&&<div className="check-warnings" role="note"><strong>Worth a look</strong><ul>{lesson.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></div>}
  {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
  <div className="check-actions">
   <button className="primary" disabled={busy} onClick={()=>void accept()}><Check size={18}/>{busy?'Saving…':'Looks good'}</button>
   <button className="secondary" disabled={busy} onClick={onAdjust}><Scissors size={16}/>Adjust clip</button>
   <button className="secondary" disabled={busy} onClick={onChooseAnother}><Plus size={16}/>Choose another video</button>
   <button className="back-link" disabled={busy} onClick={onMore}><SlidersHorizontal size={15}/>More adjustments</button>
  </div>
  <p className="small muted check-note">Timing tools can split the movement into parts. They cannot repair the reconstructed body; if the pose is wrong, adjust the clip or choose another video.</p>
 </section>;
}
