import {useEffect,useRef,useState} from 'react';

/** Source-clock piano roll. Note lengths are model estimates when duration is present. */
export function PianoNoteRoll({events,duration,time,offsetSeconds=0}:{
 events:{pitch:number;onset:number;duration:number|null}[];
 duration:number;time:number;offsetSeconds?:number;
}){
 const canvas=useRef<HTMLCanvasElement|null>(null);
 const [sizeRevision,setSizeRevision]=useState(0);
 useEffect(()=>{
  if(typeof ResizeObserver==='undefined'||!canvas.current)return;
  const observer=new ResizeObserver(()=>setSizeRevision(value=>value+1));
  observer.observe(canvas.current);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const element=canvas.current;if(!element)return;
  const context=element.getContext('2d');if(!context)return;
  const ratio=window.devicePixelRatio||1;
  const width=element.clientWidth||640,height=150;
  element.width=width*ratio;element.height=height*ratio;
  context.setTransform(ratio,0,0,ratio,0,0);
  context.clearRect(0,0,width,height);
  context.fillStyle='#f4f1ea';context.fillRect(0,0,width,height);
  const span=Math.max(duration,0.001);
  for(const event of events){
   const onset=event.onset+offsetSeconds;
   const length=Math.max(event.duration??0.25,0.05);
   if(onset>=duration||onset+length<=0)continue;
   const start=Math.max(0,onset),end=Math.min(duration,onset+length);
   const x=(start/span)*width;
   const w=Math.max(((end-start)/span)*width,1);
   const y=height-((event.pitch-21)/87)*height;
   context.fillStyle='#35556b';context.fillRect(x,y,w,3);
  }
  const playhead=(Math.max(0,Math.min(time,duration))/span)*width;
  context.strokeStyle='#b6442e';context.lineWidth=2;
  context.beginPath();context.moveTo(playhead,0);context.lineTo(playhead,height);context.stroke();
 },[events,duration,time,offsetSeconds,sizeRevision]);
 return <canvas ref={canvas} className="piano-note-roll" aria-label="Piano note roll synchronized to the source"/>
}
