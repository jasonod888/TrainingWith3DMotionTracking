import {useEffect,useRef,useState} from 'react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {Playback} from '../../../packages/learning-engine/playback';
import {heightPlacement} from '../../../web/dist/pose.js';
import {compositeOffset} from '../../../web/dist/composite.js';
import type {PracticeFraming} from './practice-types';
import {InstructorVideo} from './InstructorVideo';

/** The exporter's per-side body padding in `following_crops(..., padding=.08)`. */
const BODY_PADDING=.08;

/**
 * The real instructor drawn over the live camera at the same scale and floor line the
 * 3D reference uses. Sizing comes from `heightPlacement`, so "Together" means the same
 * thing for both references; the matte comes from the transparent WebM companion.
 */
export function InstructorGhost({lesson,player,framing,mirrored,onUnavailable}:{lesson:LessonManifest;player:Playback;framing:PracticeFraming;mirrored:boolean;onUnavailable?:()=>void}){
 const host=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null);
 const [box,setBox]=useState({width:0,height:0}),[aspect,setAspect]=useState(3/4);
 const failed=useRef(false),report=useRef(onUnavailable);report.current=onUnavailable;
 useEffect(()=>{
  const node=host.current;if(!node)return;
  const measure=()=>setBox({width:node.clientWidth,height:node.clientHeight});
  measure();
  const observer=new ResizeObserver(measure);observer.observe(node);
  return()=>observer.disconnect();
 },[]);
 // Whether a decoder honours the alpha plane is a property of the decoder, not the
 // platform, so draw one frame and look. An opaque frame means the ghost would be a
 // rectangle, and side by side is the honest fallback.
 useEffect(()=>{
  const node=video.current;if(!node)return;
  const check=()=>{
   if(failed.current||!node.videoWidth)return;
   try{
    const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw new Error('No 2D context.');
    context.drawImage(node,0,0,8,8);
    const pixels=context.getImageData(0,0,8,8).data;
    let clear=false;for(let index=3;index<pixels.length;index+=4)if(pixels[index]<250){clear=true;break;}
    if(!clear)throw new Error('Opaque composition.');
    setAspect(node.videoWidth/node.videoHeight);
   }catch{failed.current=true;report.current?.();}
  };
  node.addEventListener('loadeddata',check);
  if(node.readyState>=2)check();
  return()=>node.removeEventListener('loadeddata',check);
 },[]);
 const {width,height}=box;
 const calibration=framing.calibration;
 let scale=3*.68/1.8,floorY=-3*.36,person=1.8*scale*(height/3);
 if(calibration&&width>1&&height>1){
  const placement=heightPlacement(calibration,framing.videoWidth,framing.videoHeight,width,height,3,1.8);
  scale=placement.scale;floorY=placement.floorY;
  person=placement.screenHeight||1.8*scale*(height/3);
 }
 // The crop keeps the person at a stable scale with BODY_PADDING on each side.
 const videoHeight=person*(1+2*BODY_PADDING),videoWidth=videoHeight*aspect;
 // `pixelX` is already the reference's centre inside the fitted camera rectangle,
 // which is where the 3D rig is drawn too, so only half the frame is subtracted.
 const centreX=compositeOffset(framing.position,framing.videoWidth,framing.videoHeight,width,height,3).pixelX;
 const feet=height/2-floorY*(height/3);
 return <div className="instructor-ghost-host" ref={host}>
  <div className="instructor-ghost" style={{left:centreX-videoWidth/2,top:feet+BODY_PADDING*videoHeight-videoHeight,width:videoWidth,height:videoHeight,opacity:framing.opacity}}>
   <InstructorVideo lesson={lesson} player={player} mirrored={mirrored} videoRef={video} alpha onUnavailable={()=>report.current?.()}/>
  </div>
 </div>;
}
