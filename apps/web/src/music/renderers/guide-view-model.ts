import {guitarPosition, supportsGuitarDiagram, pitchName, type MusicReference, type MusicReferenceEvent} from '../music-reference';

/** Application convention: string 1 high E, string 6 low E. Vendor options stay local. */
export function guitarGuide(instrument:MusicReference['instrument'], events:MusicReferenceEvent[]){
 const supported=supportsGuitarDiagram(instrument)&&instrument.handedness!=='left';
 const candidates=[...new Set(events.map(event=>event.pitch))].flatMap(pitch=>{
  const legacy=guitarPosition(pitch);
  return legacy?[{pitch,string:7-legacy.string,fret:legacy.fret,label:pitchName(pitch)}]:[];
 });
 const conflict=new Set(candidates.map(item=>item.string)).size!==candidates.length;
 return {positions:supported&&!conflict?candidates:[],notice:!supported
  ?instrument.handedness==='left'?'Fretboard positions are unavailable for this handedness. The reviewed pitches and video remain available.'
   :'Fretboard positions are unavailable for this tuning or capo. The reviewed pitches and video remain available.'
  :conflict?'This passage needs a reviewed fingering; no conflicting string positions are drawn.'
  :'Markers show one possible position, not confirmed instructor fingering.'};
}
export type GuitarGuideModel=ReturnType<typeof guitarGuide>;
