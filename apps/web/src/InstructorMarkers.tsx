import {useEffect,useRef,type RefObject} from 'react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {assetUrl} from './api';
import {MARKER_NAMES,markerTrack,sampleMarkers,markerBadges,markerPixel} from './instructor-markers';
import './instructor-markers.css';

export function InstructorMarkers({lesson,video,mirrored}:{lesson:LessonManifest;video:RefObject<HTMLVideoElement|null>;mirrored:boolean}){
 const svg=useRef<SVGSVGElement>(null),groups=useRef<(SVGGElement|null)[]>([]);
 useEffect(()=>{
  const abort=new AbortController();let frame=0,track:ReturnType<typeof markerTrack>=null;
  if(lesson.focused_video)void fetch(`${assetUrl(lesson.landmarks.key)}?v=${lesson.landmarks.sha256}`,{signal:abort.signal,credentials:'same-origin'})
   .then(r=>r.ok?r.json():null).then(value=>{track=markerTrack(value?.instructorMarkers,lesson.focused_video!.sha256);}).catch(()=>{});
  const draw=()=>{
   const v=video.current,overlay=svg.current;
   const hide=()=>groups.current.forEach(g=>g?.setAttribute('visibility','hidden'));
   if(!v||!overlay||!track||v.readyState<2||!v.videoWidth){hide();frame=requestAnimationFrame(draw);return;}
   const box=v.getBoundingClientRect(),area=overlay.getBoundingClientRect(),style=getComputedStyle(v);
   if(area.width<30||area.height<30){hide();frame=requestAnimationFrame(draw);return;}
   const pad=(side:string)=>parseFloat(style.getPropertyValue(`padding-${side}`))||0;
   const innerWidth=box.width-pad('left')-pad('right'),innerHeight=box.height-pad('top')-pad('bottom');
   const scale=Math.min(innerWidth/v.videoWidth,innerHeight/v.videoHeight),h=v.videoHeight*scale;
   const anchors=sampleMarkers(track,v.currentTime).map(point=>{
    if(!point)return null;
    return markerPixel(point,{x:box.left-area.left,y:box.top-area.top,width:box.width,height:box.height,
      left:pad('left'),right:pad('right'),top:pad('top'),bottom:pad('bottom')},v.videoWidth,v.videoHeight,mirrored);
   });
   const radius=Math.max(7,Math.min(10,h*.025)),badges=markerBadges(anchors,area.width,area.height,radius);
   overlay.setAttribute('viewBox',`0 0 ${area.width} ${area.height}`);
   groups.current.forEach((group,index)=>{
    const anchor=anchors[index],badge=badges[index];if(!group)return;
    group.setAttribute('visibility',anchor&&badge?'visible':'hidden');
    if(!anchor||!badge)return;
    const line=group.querySelector('line')!,dot=group.querySelector('.limb-anchor')!,label=group.querySelector('.limb-badge')!,circle=label.querySelector('circle')!;
    line.setAttribute('x1',String(anchor[0]));line.setAttribute('y1',String(anchor[1]));line.setAttribute('x2',String(badge[0]));line.setAttribute('y2',String(badge[1]));
    dot.setAttribute('cx',String(anchor[0]));dot.setAttribute('cy',String(anchor[1]));
    label.setAttribute('transform',`translate(${badge[0]} ${badge[1]})`);circle.setAttribute('r',String(radius));
   });
   frame=requestAnimationFrame(draw);
  };
  frame=requestAnimationFrame(draw);
  return()=>{abort.abort();cancelAnimationFrame(frame);};
 },[lesson,video,mirrored]);
 return <svg ref={svg} className="instructor-limb-guides" role="img" aria-label="Anatomical left and right hand and foot guides">
  {MARKER_NAMES.map((name,index)=><g ref={node=>{groups.current[index]=node;}} key={name} className={`instructor-limb-marker ${index%2?'is-right':'is-left'}`} data-limb={name} visibility="hidden"><line/><circle className="limb-anchor" r={2}/><g className="limb-badge"><circle r={10}/><text textAnchor="middle" dominantBaseline="central">{index%2?'R':'L'}</text></g></g>)}
 </svg>;
}
