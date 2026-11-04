import {useEffect,useRef,useState,type RefObject} from 'react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {Playback} from '../../../packages/learning-engine/playback';
import {assetUrl} from './api';
import {InstructorMarkers} from './InstructorMarkers';
import {instructorStart,lessonFrameTime} from './lesson-clock';

/** A presentation of the shared lesson clock; never an independent player. */
export function InstructorVideo({lesson,player,mirrored=false,onUnavailable,videoRef,alpha=false}:{alpha?:boolean;lesson:LessonManifest;player:Playback;mirrored?:boolean;onUnavailable?:()=>void;videoRef?:RefObject<HTMLVideoElement|null>}){
 const localVideo=useRef<HTMLVideoElement>(null),video=videoRef??localVideo,callback=useRef(onUnavailable);callback.current=onUnavailable;
 const [fallback,setFallback]=useState(false),[failed,setFailed]=useState(false);
 // The transparent companion is the same clock and framing; it is only preferred when the
 // caller is drawing over the camera, because the opaque MP4 still plays everywhere.
 const asset=(alpha&&lesson.focused_video_alpha)||(!fallback&&lesson.focused_video)||lesson.source_video;
 useEffect(()=>{setFallback(false);setFailed(false);},[lesson]);
 useEffect(()=>{
  let frame=0,blockedAt=0,notified=false,pendingPlay=false;
  const notify=()=>{if(!notified){notified=true;callback.current?.();}};
  const sync=(now:number)=>{
   const v=video.current,s=player.state;
   if(v){
    const offset=instructorStart(lesson,Boolean(!fallback&&lesson.focused_video));
    const time=s.calibrating?lesson.standing_time:s.time;
    const target=offset+(s.playing?time:lessonFrameTime(lesson,time));
    if(v.readyState>=2){
     if(!v.seeking&&Math.abs(v.currentTime-target)>(s.playing?1/(lesson.frame_rate??15):1e-5))v.currentTime=target;
     v.playbackRate=s.speed;
     if(s.playing&&!s.calibrating&&v.paused&&!pendingPlay&&!failed){
      pendingPlay=true;void v.play().catch(notify).finally(()=>{pendingPlay=false;});
     }
     if((!s.playing||s.calibrating)&&!v.paused)v.pause();
    }
    const blocked=s.playing&&(failed||v.readyState<2||v.seeking||Math.abs(v.currentTime-target)>.35);
    if(blocked){if(!blockedAt)blockedAt=now;if(now-blockedAt>1000)notify();}
    else{blockedAt=0;notified=false;}
   }
   frame=requestAnimationFrame(sync);
  };
  frame=requestAnimationFrame(sync);
  return()=>{cancelAnimationFrame(frame);video.current?.pause();};
 },[lesson,player,asset?.key,failed,fallback,video]);
 if(!asset||failed)return <div className="stage-message" role="status">Instructor video unavailable. Choose the 3D instructor to continue.</div>;
 return <><video key={asset.key} ref={video} data-focused={Boolean(!fallback&&lesson.focused_video)} className="instructor-video" src={assetUrl(asset.key)} muted playsInline preload="auto" aria-label={fallback||!lesson.focused_video?'Original instructor video':'Person-focused instructor video'} style={{transform:mirrored?'scaleX(-1)':undefined}}
  onError={()=>{if(lesson.focused_video&&!fallback&&lesson.source_video){setFallback(true);}else{setFailed(true);callback.current?.();}}}/>
  {!fallback&&lesson.focused_video&&<InstructorMarkers lesson={lesson} video={video} mirrored={mirrored}/>}
  {(fallback||!lesson.focused_video)&&<span className="instructor-video-notice" role="status">Person-focused video unavailable · showing original wide video</span>}</>;
}
