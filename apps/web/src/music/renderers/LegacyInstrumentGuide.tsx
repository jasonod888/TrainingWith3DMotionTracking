import {useMemo,type CSSProperties} from 'react';
import {pianoGeometry,pitchName,type MusicReference} from '../music-reference';
import type {GuitarGuideModel} from './guide-view-model';
import {GUITAR_TUNINGS,type GuitarTuningId} from '../../../../../packages/music-notation/guitar.ts';

export function LegacyInstrumentGuide({reference,pitches,guitar,tuning,capo=0}:{
  reference:MusicReference;
  pitches:number[];
  guitar:GuitarGuideModel;
  tuning?:GuitarTuningId;
  capo?:number;
}){
 const geometry=useMemo(()=>pianoGeometry(reference.events),[reference]);
 if(reference.subject!=='guitar'){
  return <div className="piano" role="img" aria-label={`Piano guide with ${geometry.whiteKeys.length} white keys`}
   style={{'--white-count':geometry.width} as CSSProperties}>
   {geometry.whiteKeys.map(key=><span key={key.pitch} className={`piano-white${pitches.includes(key.pitch)?' is-active':''}`}
    style={{left:`${key.whiteIndex*100/geometry.width}%`,width:`${100/geometry.width}%`}}>{key.pitch%12===0&&<small>{pitchName(key.pitch)}</small>}</span>)}
   {geometry.blackKeys.map(key=><span key={key.pitch} className={`piano-black${pitches.includes(key.pitch)?' is-active':''}`}
    style={{left:`${(key.left-.31)*100/geometry.width}%`,width:`${62/geometry.width}%`}}/>)}
  </div>;
 }
 const id=tuning??'standard';
 const config=GUITAR_TUNINGS[id];
 const standard=id==='standard'&&!(capo&&capo>0);
 const label=standard?'Guitar guide, standard tuning'
  :`Guitar guide, ${config.label}${capo?`, capo ${capo}`:''}`;
 const maxFret=Math.max(12,...guitar.positions.map(item=>item.fret));
 return <div className="fretboard" role="img" aria-label={label} data-tuning={id} data-capo={capo}>
  {config.fretboardTuning.map((stringLabel,row)=><div className="fret-row" key={`${row}-${stringLabel}`}>
   <span className="fret-label">{stringLabel}</span>
   {Array.from({length:maxFret+1},(_,fret)=>{const hit=guitar.positions.find(item=>item.string===6-row&&item.fret===fret);
    return <span key={fret} className={`fret-cell${hit?' is-active':''}`}>{hit?hit.label:String(fret)}</span>;})}
  </div>)}
 </div>;
}
