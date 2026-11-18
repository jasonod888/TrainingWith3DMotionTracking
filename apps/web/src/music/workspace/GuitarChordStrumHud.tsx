import {useMemo} from 'react';
import type {GuitarChord} from '../music-reference';
import '../renderers/instrument-guide.css';

export type StrumEvent = {onset:number;pitch:number;string?:number|null};
export type StrumSlot = {slot:number;label:string;direction:'down'|'up'|null};

const LABELS = ['1','&','2','&','3','&','4','&','5','&','6','&'];

/**
 * Beat-aligned strumming grid for one measure. Clusters of 3+ guitar strings within a
 * 55 ms window are real strums: low-to-high is a downstroke and high-to-low an upstroke.
 * Empty slots fall back to alternating down/up so the bar always reads as a pattern.
 */
export function strumPatternFor(
  events:StrumEvent[], start:number, end:number, beats=4, subdivisions=2,
):StrumSlot[] {
  const slotCount=Math.max(1,Math.min(LABELS.length,Math.round(beats*subdivisions)));
  const span=Math.max(1e-6,end-start);
  const step=span/slotCount;
  const slots:StrumSlot[]=Array.from({length:slotCount},(_,slot)=>({
    slot,label:subdivisions===2?LABELS[slot]??String(slot+1):String(Math.floor(slot/subdivisions)+1),
    direction:slot%subdivisions===0?'down':'up',
  }));
  const ordered=[...events].filter(event=>event.onset>=start-1e-6&&event.onset<end-1e-6)
    .sort((left,right)=>left.onset-right.onset||left.pitch-right.pitch);
  const actual=new Map<number,StrumEvent[]>();
  for(const event of ordered){
    const slot=Math.min(slotCount-1,Math.max(0,Math.floor((event.onset-start)/step)));
    actual.set(slot,[...(actual.get(slot)??[]),event]);
  }
  for(const [slot,cluster] of actual){
    if(cluster.length<2)continue;
    const first=cluster[0], last=cluster[cluster.length-1];
    // A cluster is a strum only when its attacks are close in time.
    if(last.onset-first.onset>0.055)continue;
    // low-to-high (starting on the low string) reads as a downstroke.
    const lowFirst=first.string!=null
      ? first.string===Math.max(...cluster.map(item=>item.string??0))
      : first.pitch===Math.min(...cluster.map(item=>item.pitch));
    slots[slot].direction=lowFirst?'down':'up';
  }
  return slots;
}

function ChordDiagram({chord,label}:{chord:GuitarChord;label:string}){
 return <figure className="guitar-hud-chord" data-chord={chord.name}>
  <figcaption><strong>{chord.name}</strong><small>{label}</small></figcaption>
  <svg viewBox="0 0 100 124" role="img" aria-label={`${chord.name} chord diagram, ${chord.frets.map(f=>f<0?'muted':f).join(' ')}`}>
   <rect x="14" y="10" width="72" height="92" fill="none" stroke="currentColor" strokeWidth="1"/>
   {Array.from({length:5},(_,index)=><line key={`f-${index}`} x1="14" y1={10+index*23} x2="86" y2={10+index*23} stroke="currentColor" strokeWidth=".7"/>)}
   {Array.from({length:6},(_,index)=><line key={`s-${index}`} x1={14+index*14.4} y1="10" x2={14+index*14.4} y2="102" stroke="currentColor" strokeWidth={index===0||index===5?1.4:.8}/>)}
   {chord.frets.map((fret,index)=>{
    const x=14+index*14.4;
    if(fret<0)return <text key={`m${index}`} x={x} y="8" textAnchor="middle" fontSize="8">x</text>;
    if(fret===0)return <circle key={`o${index}`} cx={x} cy="5" r="2.6" fill="none" stroke="currentColor" strokeWidth=".8"/>;
    const row=fret-chord.position+1;
    if(row<1||row>4)return null;
    return <circle key={`d${index}`} cx={x} cy={10+row*23-11.5} r="4.2" fill="currentColor"/>;
   })}
   {chord.position>1&&<text x="90" y="26" fontSize="8" textAnchor="middle">{chord.position}fr</text>}
  </svg>
 </figure>;
}

/**
 * Chord + strum HUD for the guitar editor and practice stage. It never mutates the
 * document; the caller owns the selected chord and the transport clock.
 */
export function GuitarChordStrumHud({
 chords, time=0, events=[], measureStart, measureEnd, beatsPerBar=4, onSelectChord,
}:{
 chords:GuitarChord[];
 time?:number;
 events?:StrumEvent[];
 measureStart?:number;
 measureEnd?:number;
 beatsPerBar?:number;
 onSelectChord?:(chord:GuitarChord)=>void;
}){
 const ordered=useMemo(()=>[...chords].sort((left,right)=>left.start-right.start),[chords]);
 const active=[...ordered].reverse().find(chord=>chord.start<=time+1e-6)??null;
 const next=ordered.find(chord=>chord.start>time+1e-6)??null;
 const start=measureStart??active?.start??0;
 const end=measureEnd??(next&&next.start>start?next.start:start+2);
 const slots=useMemo(()=>strumPatternFor(events,start,end,beatsPerBar),[events,start,end,beatsPerBar]);
 return <section className="guitar-hud" aria-label="Guitar chords and strumming pattern" data-active-chord={active?.name??''}>
  <div className="guitar-hud-head">
   <div className="guitar-hud-current">
    {active?<ChordDiagram chord={active} label={`now · ${active.start.toFixed(1)}s`}/>:<p className="small muted">No chord at this point.</p>}
   </div>
   <div className="guitar-hud-next">
    {next?<ChordDiagram chord={next} label={`next · ${next.start.toFixed(1)}s`}/>:<p className="small muted">No upcoming chord.</p>}
   </div>
   {ordered.length>0&&<ol className="guitar-hud-list" aria-label="Chord sequence">
    {ordered.map(chord=><li key={chord.id}>
     <button type="button" aria-pressed={active?.id===chord.id} onClick={()=>onSelectChord?.(chord)}>
      {chord.name}<small>{chord.start.toFixed(1)}s</small>
     </button>
    </li>)}
   </ol>}
  </div>
  <div className="guitar-strum-bar" role="group" aria-label="Strumming pattern" data-strum-slots={slots.length}>
   {slots.map(slot=><span key={slot.slot} className={`guitar-strum-slot${slot.direction?' is-'+slot.direction:''}`}
     data-slot={slot.slot} data-direction={slot.direction??'rest'}>
    <small>{slot.label}</small>
    <strong aria-hidden="true">{slot.direction==='down'?'↓':slot.direction==='up'?'↑':'·'}</strong>
   </span>)}
  </div>
 </section>;
}

export default GuitarChordStrumHud;
