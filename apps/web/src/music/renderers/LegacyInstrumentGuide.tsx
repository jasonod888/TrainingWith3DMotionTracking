import {useMemo,type CSSProperties} from 'react';
import {pianoGeometry,GUITAR_STRING_LABELS,pitchName,type MusicReference} from '../music-reference';
import type {GuitarGuideModel} from './guide-view-model';
export function LegacyInstrumentGuide({reference,pitches,guitar}:{reference:MusicReference;pitches:number[];guitar:GuitarGuideModel}){
 const geometry=useMemo(()=>pianoGeometry(reference.events),[reference]);
 return reference.subject==='piano'?<div className="piano" role="img" aria-label={`Piano guide with ${geometry.whiteKeys.length} white keys`}
  style={{'--white-count':geometry.width} as CSSProperties}>
  {geometry.whiteKeys.map(key=><span key={key.pitch} className={`piano-white${pitches.includes(key.pitch)?' is-active':''}`}
   style={{left:`${key.whiteIndex*100/geometry.width}%`,width:`${100/geometry.width}%`}}>{key.pitch%12===0&&<small>{pitchName(key.pitch)}</small>}</span>)}
  {geometry.blackKeys.map(key=><span key={key.pitch} className={`piano-black${pitches.includes(key.pitch)?' is-active':''}`}
   style={{left:`${(key.left-.31)*100/geometry.width}%`,width:`${62/geometry.width}%`}}/>)}
 </div>:<div className="fretboard" role="img" aria-label="Guitar guide, standard tuning">
  {GUITAR_STRING_LABELS.map((label,row)=><div className="fret-row" key={label}><span className="fret-label">{label}</span>
   {Array.from({length:13},(_,fret)=>{const hit=guitar.positions.find(item=>item.string===6-row&&item.fret===fret);
    return <span key={fret} className={`fret-cell${hit?' is-active':''}`}>{hit?hit.label:String(fret)}</span>;})}</div>)}
 </div>;
}
