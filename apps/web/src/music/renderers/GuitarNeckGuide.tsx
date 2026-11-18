import {memo,useEffect,useRef,useState} from 'react';
import {Fretboard,type Position} from '@moonwave99/fretboard.js';
import type {GuitarGuideModel} from './guide-view-model';
import {
  GUITAR_FINGER_PALETTE, GUITAR_TUNINGS, fingerForFret, normalizeGuitarSetup,
  type GuitarFinger, type GuitarTuningId,
} from '../../../../../packages/music-notation/guitar.ts';
import './instrument-guide.css';

export type NeckPoint = {string:number;fret:number;pitch?:number;label?:string;finger?:GuitarFinger};
export type NeckPosition = GuitarGuideModel['positions'][number] & {finger?: GuitarFinger};

/**
 * Shared guitar neck. It keeps the original `positions` contract used by the read-only
 * guide and adds editor/practice affordances behind optional props:
 * - alternate tuning/capo and up to 24 frets,
 * - upcoming lookahead markers and candidate positions,
 * - finger colors from the current hand position,
 * - click-to-pick a (string, fret), and
 * - left-handed orientation.
 */
export default memo(function GuitarNeckGuide({
  positions, fretCount = 12, upcomingPositions = [], candidatePositions = [],
  onPositionSelect, handedness = 'right', tuning, capo = 0,
  ariaLabel = 'Guitar guide, standard tuning, string 1 high E',
}:{
  positions:ReadonlyArray<NeckPosition>;
  /** Number of frets drawn; the shared editor uses 15 or 24. */
  fretCount?:number;
  /** Notes starting within the next 0.5 s, drawn as lookahead rings. */
  upcomingPositions?:NeckPoint[];
  /** Alternative strings/frets for the selected pitch, drawn as ghost dots. */
  candidatePositions?:NeckPoint[];
  onPositionSelect?:(string:number,fret:number)=>void;
  handedness?:'right'|'left';
  tuning?:GuitarTuningId;
  capo?:number;
  ariaLabel?:string;
}){
 const setup=normalizeGuitarSetup({tuning,capo});
 const tuningConfig=GUITAR_TUNINGS[setup.tuning];
 const host=useRef<HTMLDivElement>(null),board=useRef<Fretboard|null>(null),latest=useRef({positions,upcomingPositions,candidatePositions});
 latest.current={positions,upcomingPositions,candidatePositions};
 const select=useRef(onPositionSelect);select.current=onPositionSelect;
 const [error,setError]=useState<Error|null>(null);
 const requestedFrets=Math.max(0,Math.min(24,Math.round(fretCount)));
 // Never hide an active/upcoming/candidate note above the caller's default neck.
 const neededFret=Math.max(0,
  ...positions.map(item=>item.fret),
  ...upcomingPositions.map(item=>item.fret),
  ...candidatePositions.map(item=>item.fret));
 const frets=Math.min(24,Math.max(requestedFrets,neededFret));

 const positive=positions.map(item=>item.fret).filter(fret=>fret>0);
 const basePosition=positive.length?Math.min(...positive):1;
 const fingerOf=(item:{fret:number;finger?:GuitarFinger}):GuitarFinger=>
  item.finger??fingerForFret(item.fret,basePosition);

 const merged=():Position[]=>{
  const {positions,upcomingPositions,candidatePositions}=latest.current;
  const active:Position[]=positions.map(item=>{
   const finger=fingerOf(item);
   return {...item,kind:'active',finger,fingerColor:GUITAR_FINGER_PALETTE[finger].color} as unknown as Position;
  });
  const upcoming:Position[]=upcomingPositions.map(item=>({string:item.string,fret:item.fret,label:'',kind:'upcoming'} as unknown as Position));
  const candidates:Position[]=candidatePositions.map(item=>({string:item.string,fret:item.fret,label:String(item.fret),kind:'candidate',disabled:true} as unknown as Position));
  return [...active,...upcoming,...candidates];
 };

 useEffect(()=>{
  const element=host.current;if(!element)return;
  let width=0;
  const render=()=>{try{
    const next=Math.max(520,Math.round(element.getBoundingClientRect().width));
    if(next===width&&board.current)return;
    width=next;board.current?.removeEventListeners();element.replaceChildren();
    const instance=new Fretboard({el:element,tuning:[...tuningConfig.fretboardTuning],fretCount:frets,
     height:170,width:next,showFretNumbers:true,
     // The library's types describe dotFill as a string, but its d3 renderer accepts
     // a value function, which is how each finger gets its own color.
     dotFill:((dot:Position)=>String((dot as unknown as {fingerColor?:string}).fingerColor??'#6c8050')) as unknown as string,
     dotText:(dot:Position)=>String(dot.kind==='upcoming'?'•':(dot.label??'')),font:'Arial'});
    instance.on('click',(position:Position)=>select.current?.(position.string,position.fret));
    board.current=instance;instance.setDots(merged()).render();
   }catch(cause){setError(cause instanceof Error?cause:Error('Guitar guide could not draw.'));}};
  render();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(render);
  observer?.observe(element);
  if(!observer)globalThis.window?.addEventListener('resize',render);
  return()=>{observer?.disconnect();globalThis.window?.removeEventListener('resize',render);board.current?.removeEventListeners();board.current=null;element.replaceChildren();};
 },[frets,setup.tuning,setup.capo]);

 useEffect(()=>{try{board.current?.setDots(merged()).render();}catch(cause){setError(cause instanceof Error?cause:Error('Guitar markers could not draw.'));}},[positions,upcomingPositions,candidatePositions]);

 const fingerData=positions.map(item=>`${item.string}:${item.fret}:${fingerOf(item)}`).join(',');
 const positionData=positions.map(item=>`${item.string}:${item.fret}:${item.pitch}`).join(',');
 const caption=setup.tuning==='standard'&&setup.capo===0
  ? `Top to bottom: ${[...tuningConfig.stringLabels].join(', ')}.`
  : `${tuningConfig.label}${setup.capo?` · capo ${setup.capo}`:''}. Strings: ${[...tuningConfig.stringLabels].join(', ')}.`;
 const fingerLegend=<div className="guitar-finger-legend" aria-label="Finger colors">
   {[1,2,3,4,0].map(finger=>{
     const entry=GUITAR_FINGER_PALETTE[finger as GuitarFinger];
     return <span key={finger} data-finger-legend={finger} style={{color:entry.color}}>
       <i aria-hidden="true" style={{background:entry.color}}/>{finger} {entry.label}
     </span>;
   })}
 </div>;

 if(error)return <><div className="library-guide-scroll" role="img" aria-label={ariaLabel}
   data-renderer="guitar-library" data-error="true"
   data-positions={positionData}
   data-upcoming-positions={upcomingPositions.map(item=>`${item.string}:${item.fret}`).join(',')}
   data-candidate-positions={candidatePositions.map(item=>`${item.string}:${item.fret}`).join(',')}
   data-handedness={handedness} data-fret-count={frets} data-interactive={onPositionSelect?'true':'false'}
   data-tuning={setup.tuning} data-capo={setup.capo} data-finger-colors="true" data-fingers={fingerData}>
   <p className="small muted" role="alert">The fretboard could not draw here. {error.message}</p>
 </div>{fingerLegend}</>;
 return <><div className="library-guide-scroll" role="img" aria-label={ariaLabel}
   data-renderer="guitar-library" data-positions={positionData}
   data-upcoming-positions={upcomingPositions.map(item=>`${item.string}:${item.fret}`).join(',')}
   data-candidate-positions={candidatePositions.map(item=>`${item.string}:${item.fret}`).join(',')}
   data-handedness={handedness} data-fret-count={frets}
   data-interactive={onPositionSelect?'true':'false'}
   data-tuning={setup.tuning} data-capo={setup.capo} data-finger-colors="true" data-fingers={fingerData}>
  <div className={`library-neck${handedness==='left'?' is-left-handed':''}${onPositionSelect?' is-interactive':''}`} ref={host} aria-hidden="true"/>
 </div><p className="small muted">
   {caption} {handedness==='left'?'Left-handed':'Right-handed'} view, frets 0–{frets}.
   {onPositionSelect?' Click a string and fret to place the selected note.':''}
 </p>
 {fingerLegend}</>;
},(before,after)=>before.positions===after.positions
  &&before.upcomingPositions===after.upcomingPositions
  &&before.candidatePositions===after.candidatePositions
  &&before.fretCount===after.fretCount
  &&before.handedness===after.handedness
  &&before.tuning===after.tuning
  &&before.capo===after.capo
  &&before.onPositionSelect===after.onPositionSelect);
