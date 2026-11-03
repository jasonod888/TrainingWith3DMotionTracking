import {useEffect,useId,useRef,useState,type CSSProperties,type PointerEvent} from 'react';
import {ChevronDown,Layers} from 'lucide-react';
import type {Section} from '../../../packages/lesson-schema/index';
import {clampTime,timeLabel} from './timeline';
import {practiceTimeLabel,timelineKeyTime,timelineSectionAt,timelineTimeAt} from './practice-timeline';
import './practice-timeline.css';

export function PracticeTimeline({sections,duration,time,activeIndex,range,onSeek,onSelect,onBrowse,onScrubStart,disabled=false}:{
 sections:Section[];duration:number;time:number;activeIndex:number;range:{start:number;end:number}|null;
 onSeek:(time:number)=>void;onSelect:(index:number)=>void;onBrowse:()=>void;onScrubStart:()=>void;disabled?:boolean;
}){
 const track=useRef<HTMLDivElement>(null),gesture=useRef<{id:number;x:number;dragging:boolean}|null>(null);
 const pending=useRef(0),seek=useRef(onSeek);seek.current=onSeek;
 const [preview,setPreview]=useState<number|null>(null),[hover,setHover]=useState<number|null>(null);
 const helpId=useId(),shown=preview??time;
 const index=preview===null?Math.max(0,activeIndex):timelineSectionAt(sections,shown),section=sections[index];
 const min=range?.start??0,max=range?.end??duration;
 const at=(event:PointerEvent)=>{const box=track.current!.getBoundingClientRect();return timelineTimeAt(event.clientX,box.left,box.width,duration);};
 const cancelPending=()=>{cancelAnimationFrame(pending.current);pending.current=0;};
 useEffect(()=>()=>cancelAnimationFrame(pending.current),[]);
 const schedule=(value:number)=>{cancelPending();pending.current=requestAnimationFrame(()=>{pending.current=0;seek.current(value);});};
 const begin=(event:PointerEvent<HTMLInputElement>)=>{
  if(disabled||event.button!==0||!event.isPrimary)return;
  event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
  gesture.current={id:event.pointerId,x:event.clientX,dragging:false};setHover(at(event));onScrubStart();
 };
 const move=(event:PointerEvent<HTMLInputElement>)=>{
  if(disabled)return;
  const value=at(event),current=gesture.current;
  if(!current){if(event.pointerType!=='touch')setHover(value);return;}
  if(event.pointerId!==current.id)return;
  current.dragging ||= Math.abs(event.clientX-current.x)>=4;
  if(current.dragging){const next=clampTime(value,min,max);setPreview(next);setHover(next);schedule(next);}
 };
 const finish=(event:PointerEvent<HTMLInputElement>)=>{
  const current=gesture.current;if(!current||current.id!==event.pointerId)return;
  cancelPending();gesture.current=null;
  if(current.dragging)onSeek(clampTime(at(event),min,max));
  else {const selected=timelineSectionAt(sections,at(event));if(selected>=0)onSelect(selected);}
  setPreview(null);setHover(null);
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
 };
 const cancel=()=>{cancelPending();gesture.current=null;setPreview(null);setHover(null);};
 const tooltipTime=hover??preview,tooltipIndex=tooltipTime===null?-1:timelineSectionAt(sections,tooltipTime);
 const tooltipSection=sections[tooltipIndex];
 const percent=(value:number)=>duration>0?clampTime(value/duration*100,0,100):0;
 const sectionName=section&&section.label!==String(index+1)?section.label:'';
 return <section className={`practice-timeline ${preview!==null?'is-scrubbing':''}`} aria-label="Practice section timeline">
  <div className="practice-timeline-heading">
   <button type="button" className="practice-timeline-browse" disabled={disabled} onClick={onBrowse} aria-label={`Browse sections. Section ${index+1} of ${sections.length}${sectionName?`: ${sectionName}`:''}`}>
    <Layers size={14} aria-hidden="true"/><span className="practice-timeline-count">Section {String(index+1).padStart(2,'0')} <span>/ {sections.length}</span></span>{sectionName&&<span className="practice-timeline-name">{sectionName}</span>}<ChevronDown size={13} aria-hidden="true"/>
   </button>
   <span className="practice-timeline-times"><strong>{preview===null?practiceTimeLabel(shown):timeLabel(shown)}</strong><span>/ {practiceTimeLabel(duration)}</span></span>
  </div>
  <div className="practice-timeline-track mimic-scrub" ref={track}>
   <div className="practice-timeline-rail" aria-hidden="true">{sections.map((item,i)=><span key={item.id} className={`practice-timeline-segment ${i===index?'is-current':''}`} style={{left:`${percent(item.start)}%`,width:`${percent(item.end-item.start)}%`,'--section-fill':`${clampTime((shown-item.start)/(item.end-item.start)*100,0,100)}%`} as CSSProperties}/>)}</div>
   <span className="practice-timeline-playhead" aria-hidden="true" style={{left:`${percent(shown)}%`}}/>
   {tooltipTime!==null&&tooltipSection&&<div className="practice-timeline-tooltip" aria-hidden="true" style={{left:`clamp(85px, ${percent(tooltipTime)}%, calc(100% - 85px))`}}><strong>Section {tooltipIndex+1}<span>{timeLabel(tooltipTime)}</span></strong>{tooltipSection.label!==String(tooltipIndex+1)&&<span>{tooltipSection.label}</span>}</div>}
   <input aria-label="Lesson position" aria-describedby={helpId} aria-valuetext={`${timeLabel(shown)} of ${practiceTimeLabel(duration)}, section ${index+1} of ${sections.length}`} type="range" min={min} max={max} step={.01} value={clampTime(shown,min,max)} disabled={disabled} onChange={event=>onSeek(Number(event.target.value))} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onPointerLeave={()=>{if(!gesture.current)setHover(null);}} onBlur={()=>{if(!gesture.current)setHover(null);}} onKeyDown={event=>{const next=timelineKeyTime(event.key,time,min,max,event.shiftKey);if(next!==null){event.preventDefault();onSeek(next);}}}/>
  </div>
  <span className="practice-timeline-hint" id={helpId}>Tap a section to jump · drag to seek<span className="practice-timeline-keyboard-hint"> · Arrow keys fine-tune</span></span>
 </section>;
}
