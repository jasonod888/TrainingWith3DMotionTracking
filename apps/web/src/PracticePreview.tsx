import {useEffect,useRef,useState} from 'react';
import {Maximize,Pause,Play,Rotate3D,Volume2,VolumeX,VideoOff} from 'lucide-react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {assetUrl,loadPublicMoves,type PublicMove} from './api';
import {PracticeTimeline} from './PracticeTimeline';
import {timelineSectionAt} from './practice-timeline';
import './preview.css';

export type WatchLesson={lesson:LessonManifest;owned:boolean};
export function PracticePreview({lesson,owned,resumeAt,onPosition,onChoose,lessons=[],onOpen,onPublic}:{lesson:LessonManifest;owned:boolean;resumeAt:number;onPosition:(time:number)=>void;onChoose:(mode:'practice'|'compete')=>void;lessons?:WatchLesson[];onOpen:(item:WatchLesson)=>void;onPublic:(id:string)=>void}){
 const video=useRef<HTMLVideoElement>(null),player=useRef<HTMLDivElement>(null),position=useRef(onPosition);position.current=onPosition;
 const start=lesson.source_start,end=start+lesson.duration;
 const initial=resumeAt>=end-.1?start:Math.max(start,Math.min(resumeAt||start,end));
 const lastPosition=useRef(initial);
 const [time,setTime]=useState(initial-start),[unavailable,setUnavailable]=useState(!lesson.source_video),[ready,setReady]=useState(false),[paused,setPaused]=useState(true),[muted,setMuted]=useState(true),[browse,setBrowse]=useState(false);
 const [publicMoves,setPublicMoves]=useState<PublicMove[]>([]),[recommendationsError,setRecommendationsError]=useState(false),[recommendationsLoading,setRecommendationsLoading]=useState(true),[retry,setRetry]=useState(0);
 const meta=lesson as LessonManifest&{creator_name?:string;description?:string};
 const creator=meta.creator_name||(owned?'Your lesson':lesson.animation.key.startsWith('public/')?'Public lesson':lesson.animation.key.startsWith('lessons/')?'Shared with you':'Form · Demonstration');
 const available=lessons.filter((item,index,all)=>item.lesson.lesson_id!==lesson.lesson_id&&all.findIndex(other=>other.lesson.lesson_id===item.lesson.lesson_id)===index);
 const related=publicMoves.filter(item=>item.lesson_id!==lesson.lesson_id&&!available.some(other=>other.lesson.lesson_id===item.lesson_id));
 useEffect(()=>{document.body.classList.add('in-preview');return()=>document.body.classList.remove('in-preview');},[]);
 useEffect(()=>{let stopped=false;setRecommendationsLoading(true);setRecommendationsError(false);loadPublicMoves().then(value=>{if(!stopped)setPublicMoves(value.moves);}).catch(()=>{if(!stopped)setRecommendationsError(true);}).finally(()=>{if(!stopped)setRecommendationsLoading(false);});return()=>{stopped=true;};},[retry]);
 useEffect(()=>{
  const v=video.current;
  const save=()=>position.current(lastPosition.current);
  const hide=()=>{if(document.hidden){v?.pause();save();}};
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',save);
  return()=>{save();v?.pause();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',save);};
 },[]);
 const remember=(absolute:number)=>{lastPosition.current=Math.max(start,Math.min(absolute,end));setTime(lastPosition.current-start);};
 const seek=(relative:number)=>{const v=video.current;if(!v)return;v.currentTime=Math.max(start,Math.min(start+relative,Math.min(end,v.duration)));remember(v.currentTime);};
 const toggle=()=>{const v=video.current;if(!v)return;if(v.paused){if(v.currentTime<start||v.currentTime>=Math.min(end,v.duration)-.05)seek(0);void v.play().catch(()=>setPaused(true));}else v.pause();};
 const choose=()=>{video.current?.pause();position.current(lastPosition.current);onChoose('practice');};
 const poster=(thumbnail:string|null)=>(thumbnail?<img src={thumbnail} alt="" loading="lazy" onError={event=>{event.currentTarget.hidden=true;}}/>:<Rotate3D size={30}/>);
 const duration=(value:number)=>`${Math.floor(value/60)}:${Math.floor(value%60).toString().padStart(2,'0')}`;
 return <section className="lesson-watch" aria-label="Watch lesson">
  <div className="watch-layout">
   <div className="watch-main">
    <div className="watch-player" ref={player}>
     <div className="preview-media">{!unavailable&&lesson.source_video?<video ref={video} src={assetUrl(lesson.source_video.key)} muted={muted} playsInline autoPlay preload="metadata" className={ready?'is-ready':''} aria-label="Original lesson video"
      onLoadedMetadata={()=>{const v=video.current;if(!v)return;if(!Number.isFinite(v.duration)||v.duration<=start){setUnavailable(true);return;}v.currentTime=Math.min(initial,Math.min(end,v.duration)-.05);remember(v.currentTime);setReady(true);void v.play().catch(()=>setPaused(true));}}
      onTimeUpdate={()=>{const v=video.current;if(!v)return;if(v.currentTime>=end){v.pause();if(v.currentTime>end+.05)v.currentTime=end;remember(end);}else remember(v.currentTime);}}
      onPlay={()=>setPaused(false)} onPause={()=>setPaused(true)} onEnded={()=>{setPaused(true);remember(Math.min(end,video.current?.duration??end));}} onError={()=>setUnavailable(true)}/>:lesson.thumbnail?<img src={assetUrl(lesson.thumbnail.key)} alt="Lesson thumbnail"/>:null}</div>
     {!unavailable&&<button className="watch-video-toggle" aria-label="Toggle video playback" onClick={toggle}>{paused&&<Play size={38} fill="currentColor"/>}</button>}
     {unavailable&&<div className="watch-unavailable" role="status"><VideoOff size={27}/><strong>Original video unavailable</strong><span>You can still practise with the 3D instructor.</span></div>}
     <div className="watch-controls">
      <PracticeTimeline sections={lesson.section_set.sections} duration={lesson.duration} time={time} activeIndex={timelineSectionAt(lesson.section_set.sections,time+.001)} range={null} disabled={unavailable||!ready} onScrubStart={()=>{}} onSeek={seek} onSelect={index=>seek(lesson.section_set.sections[index].start)} onBrowse={()=>setBrowse(value=>!value)}/>
      <div className="watch-control-row"><button aria-label={paused?'Play video':'Pause video'} disabled={unavailable||!ready} onClick={toggle}>{paused?<Play size={21} fill="currentColor"/>:<Pause size={21} fill="currentColor"/>}</button><button aria-label={muted?'Unmute video':'Mute video'} disabled={unavailable} onClick={()=>setMuted(value=>!value)}>{muted?<VolumeX size={20}/>:<Volume2 size={20}/>}</button><span className="watch-continuous">Full video</span><button className="watch-practice" onClick={choose}>Practice</button><button aria-label="Fullscreen video" onClick={()=>{void player.current?.requestFullscreen?.().catch(()=>{});}}><Maximize size={20}/></button></div>
     </div>
    </div>
    {browse&&<div className="watch-sections" aria-label="Video sections">{lesson.section_set.sections.map((section,index)=><button key={section.id} onClick={()=>{seek(section.start);setBrowse(false);}}><span>{String(index+1).padStart(2,'0')}</span><strong>{section.label}</strong><small>{duration(section.start)}</small></button>)}</div>}
    <div className="watch-description"><h1>{lesson.title}</h1><p>{creator} <span>· {duration(lesson.duration)} · {lesson.section_set.sections.length} sections</span></p>{meta.description&&<p>{meta.description}</p>}</div>
   </div>
   <aside className="watch-related" aria-label="Other lessons"><h2>More lessons</h2>
    {available.map(item=><button className="watch-lesson" key={item.lesson.lesson_id} onClick={()=>onOpen(item)}><span className="watch-thumbnail">{poster(item.lesson.thumbnail?assetUrl(item.lesson.thumbnail.key):null)}<small>{duration(item.lesson.duration)}</small></span><span className="watch-lesson-copy"><strong>{item.lesson.title}</strong><span>{item.owned?'Your lesson':'Available lesson'}</span><span>{item.lesson.section_set.sections.length} sections</span></span></button>)}
    {related.map(item=><button className="watch-lesson" key={item.lesson_id} onClick={()=>onPublic(item.lesson_id)}><span className="watch-thumbnail">{poster(item.thumbnail_url)}<small>{duration(item.duration)}</small></span><span className="watch-lesson-copy"><strong>{item.title}</strong><span>{item.creator_name}</span></span></button>)}
    {recommendationsError&&<p className="watch-related-note">More lessons couldn’t load. <button onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
    {!available.length&&!related.length&&!recommendationsError&&<p className="watch-related-note">{recommendationsLoading?'Loading more lessons…':'Other available lessons will appear here.'}</p>}
   </aside>
  </div>
 </section>;
}
