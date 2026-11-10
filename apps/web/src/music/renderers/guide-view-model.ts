import {guitarPosition, supportsGuitarDiagram, pitchName, type MusicReference, type MusicReferenceEvent} from '../music-reference';

/** Application convention: string 1 high E, string 6 low E. Vendor options stay local. */
export function guitarGuide(instrument:MusicReference['instrument'], events:MusicReferenceEvent[]){
 const supported=supportsGuitarDiagram(instrument)&&instrument.handedness!=='left';
 const explicit=events.filter(event=>event.string!=null&&event.fret!=null)
  .map(event=>({pitch:event.pitch,string:event.string!,fret:event.fret!,label:pitchName(event.pitch)}));
 const fallbackPitches=[...new Set(events.filter(event=>event.string==null).map(event=>event.pitch))];
 const fallback=fallbackPitches.flatMap(pitch=>{
  const legacy=guitarPosition(pitch);
  return legacy?[{pitch,string:7-legacy.string,fret:legacy.fret,label:pitchName(pitch)}]:[];
 });
 const candidates=[...explicit,...fallback];
 const conflict=explicit.length===0&&new Set(candidates.map(item=>item.string)).size!==candidates.length;
 return {positions:supported&&!conflict?candidates:[],notice:!supported
  ?instrument.handedness==='left'?'Fretboard positions are unavailable for this handedness. The reviewed pitches and video remain available.'
   :'Fretboard positions are unavailable for this tuning or capo. The reviewed pitches and video remain available.'
  :conflict?'This passage needs a reviewed fingering; no conflicting string positions are drawn.'
  :explicit.length?"Markers show the instructor's reviewed positions."
  :'Markers show one possible position, not confirmed instructor fingering.'};
}
export type GuitarGuideModel=ReturnType<typeof guitarGuide>;
