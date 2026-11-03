import {useEffect,useRef,useState,type KeyboardEvent,type PointerEvent,type RefObject} from 'react';
import {clampTime,timeLabel,trimBounds} from './timeline';
import './video-timeline.css';

type Marker={id:string;time:number;label:string;min:number;max:number};
type Segment={id:string;start:number;end:number;label:string};
type Props={compact?:boolean;frameRate?:number;sourceStart?:number;duration:number;time:number;onSeek:(time:number)=>void;disabled?:boolean;source?:string;range?:{start:number;end:number;maxLength:number;onChange:(start:number,end:number)=>void};markers?:Marker[];onMarkerChange?:(id:string,time:number)=>void;segments?:Segment[];selected?:number;onSelect?:(index:number)=>void};

// Decode only a small, fixed number of frames, separately from the preview player.
function useFilmstrip(source:string|undefined,duration:number,interacting:RefObject<boolean>,sourceStart=0,frameRate?:number){
 const [frames,setFrames]=useState<string[]>([]);
 useEffect(()=>{
  setFrames([]);if(!source||!(duration>0))return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>;const video=document.createElement('video');
  video.muted=true;video.preload='metadata';video.playsInline=true;
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=72;
  const context=canvas.getContext('2d');let index=0;const result:string[]=[];
  const stop=()=>{clearTimeout(timer);video.onloadedmetadata=null;video.onseeked=null;video.onerror=null;video.removeAttribute('src');video.load();};
  const next=()=>{clearTimeout(timer);if(cancelled)return;if(interacting.current){timer=setTimeout(next,100);return;}if(index>=10){stop();return;}const time=Math.min(duration-.001,duration*(index+.5)/10);video.currentTime=sourceStart+(frameRate?Math.floor((time+1e-7)*frameRate)/frameRate:time);timer=setTimeout(stop,15000);};
  video.onloadedmetadata=next;
  video.onseeked=()=>{clearTimeout(timer);if(cancelled||!context)return;try{context.drawImage(video,0,0,128,72);result.push(canvas.toDataURL('image/jpeg',.6));setFrames([...result]);index++;next();}catch{stop();}};
  video.onerror=stop;video.src=source;timer=setTimeout(stop,15000);
  return()=>{cancelled=true;stop();};
 },[source,duration,interacting,sourceStart,frameRate]);
 return frames;
}

export function VideoTimeline({compact=false,frameRate,sourceStart=0,duration,time,onSeek,disabled=false,source,range,markers=[],onMarkerChange,segments=[],selected,onSelect}:Props){
 const track=useRef<HTMLDivElement>(null),interacting=useRef(false),drag=useRef<{offset:number;value:number;min:number;max:number;apply:(value:number)=>void}|null>(null);
 const frames=useFilmstrip(source,duration,interacting,sourceStart,frameRate);
 const ready=duration>0&&Number.isFinite(duration),locked=disabled||!ready;
 const snap=(value:number)=>frameRate?Math.min(duration,Math.round(value*frameRate)/frameRate):value;
 const percent=(value:number)=>`${clampTime(ready?value/duration*100:0,0,100)}%`;
 const at=(event:PointerEvent)=>{const rect=track.current!.getBoundingClientRect();return clampTime((event.clientX-rect.left)/Math.max(1,rect.width)*duration,0,duration);};
 const move=(event:PointerEvent)=>{event.stopPropagation();const current=drag.current;if(current){current.value=clampTime(snap(at(event)+current.offset),current.min,current.max);current.apply(current.value);}};
 const begin=(event:PointerEvent,min:number,max:number,apply:(value:number)=>void,initial?:number)=>{if(locked||event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);const position=at(event),value=clampTime(initial??snap(position),min,max);interacting.current=true;drag.current={offset:initial===undefined?0:value-position,value,min,max,apply};apply(value);};
 const finish=()=>{const current=drag.current;drag.current=null;interacting.current=false;current?.apply(current.value);};
 const key=(event:KeyboardEvent,value:number,min:number,max:number,apply:(value:number)=>void)=>{
  const amount=frameRate ? (event.shiftKey?10:1)/frameRate : (event.shiftKey ? .01 : .1);
  const values:Record<string,number>={ArrowLeft:value-amount,ArrowDown:value-amount,ArrowRight:value+amount,ArrowUp:value+amount,Home:min,End:max,PageDown:value-1,PageUp:value+1};
  if(event.key in values){event.preventDefault();event.stopPropagation();apply(clampTime(snap(values[event.key]),min,max));}
 };
 const handle=(id:string,label:string,value:number,min:number,max:number,apply:(value:number)=>void,kind:string)=><button key={id} type="button" role="slider" aria-label={label} aria-orientation="horizontal" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={timeLabel(value)} disabled={locked} className={`timeline-handle ${kind}`} style={{left:percent(value)}} onPointerDown={e=>begin(e,min,max,apply,value)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={e=>key(e,value,min,max,apply)} title={`${label}: ${timeLabel(value)}`}><span/></button>;
 return <div className={`video-timeline ${locked?'is-disabled':''} ${compact?'trim-filmstrip':''}`} role="group" aria-label={range?'Trim video':'Edit section timing'}>
  {!compact&&<div className="timeline-heading"><strong>{range?'Trim clip':'Section timeline'}</strong><span>{range?`${timeLabel(range.end-range.start)} selected`:timeLabel(time)}</span></div>}
  <div className="timeline-track" ref={track} onPointerDown={e=>begin(e,0,duration,onSeek)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
   <div className="timeline-filmstrip" aria-hidden="true">{frames.map((frame,i)=><img key={i} src={frame} alt="" draggable={false} style={{width:'10%'}}/>)}</div>
   {segments.map((segment,i)=><button key={segment.id} type="button" disabled={locked} className={`timeline-segment ${selected===i?'selected':''}`} style={{left:percent(segment.start),width:percent(segment.end-segment.start)}} aria-label={`Select section ${i+1}: ${segment.label}`} onPointerDown={e=>e.stopPropagation()} onClick={()=>onSelect?.(i)} title={segment.label}>{i+1}</button>)}
   {range&&<><div className="timeline-shade" style={{left:0,width:percent(range.start)}}/><div className="timeline-shade" style={{left:percent(range.end),right:0}}/><div className="timeline-selection" style={{left:percent(range.start),width:percent(range.end-range.start)}}/>
    {(['start','end'] as const).map(edge=>{const bounds=frameRate?(edge==='start'?{min:0,max:Math.max(0,range.end-Math.max(1,Math.ceil(.05*frameRate))/frameRate)}:{min:Math.min(duration,range.start+Math.max(1,Math.ceil(.05*frameRate))/frameRate),max:duration}):trimBounds(duration,range.start,range.end,range.maxLength,edge);return handle(edge,edge==='start'?'Clip start':'Clip end',range[edge],bounds.min,bounds.max,value=>{range.onChange(edge==='start'?value:range.start,edge==='end'?value:range.end);onSeek(value);},`trim-${edge}`);})}</>}
   {markers.map(marker=>handle(marker.id,marker.label,marker.time,marker.min,marker.max,value=>{onMarkerChange?.(marker.id,value);onSeek(value);},'boundary'))}
   {compact?handle('playhead','Preview position',time,range?.start??0,range?.end??duration,onSeek,'scrub-head'):<div className="timeline-playhead" style={{left:percent(time)}} aria-hidden="true"/>}
  </div>
  {compact&&range?<div className="trim-filmstrip-times"><span>{timeLabel(range.start)}</span><span>Drag the ends to trim</span><span>{timeLabel(range.end)}</span></div>:<><div className="timeline-ruler" aria-hidden="true">{[0,.25,.5,.75,1].map(ratio=><span key={ratio}>{timeLabel(duration*ratio)}</span>)}</div>
  <label className="timeline-scrub-label">Playhead<input type="range" aria-label="Video playhead" min={0} max={duration||0} step={.01} value={clampTime(time,0,duration)} disabled={locked} onChange={e=>onSeek(Number(e.target.value))}/></label>
  <p className="timeline-help">{range?'Drag the end handles to trim. Click the strip to preview.':'Drag a boundary to adjust steps. Select a step to preview it.'} Arrow keys fine-tune · Shift for smaller changes.</p></>}
 </div>;
}
