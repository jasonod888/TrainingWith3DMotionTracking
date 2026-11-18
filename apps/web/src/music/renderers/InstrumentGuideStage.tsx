import {Component,lazy,Suspense,useMemo,type ReactNode} from 'react';
import {pianoGeometry,pitchName,type MusicReference,type MusicReferenceEvent} from '../music-reference';
import {guitarGuide, guitarPositionsForSetup} from './guide-view-model';
import {isGuitarTuningId, normalizeGuitarSetup} from '../../../../../packages/music-notation/guitar.ts';
const GuitarChordCards=lazy(()=>import('./GuitarChordCards'));
import {LegacyInstrumentGuide} from './LegacyInstrumentGuide';
const PianoGuide=lazy(()=>import('./PianoGuide'));
const GuitarNeckGuide=lazy(()=>import('./GuitarNeckGuide'));
class DrawingBoundary extends Component<{fallback:ReactNode;children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<><p className="small muted" role="status">Using the basic guide because the enhanced drawing could not load.</p>{this.props.fallback}</>:this.props.children;}
}
export function InstrumentGuideStage({reference,active,time=0,pianoLibrary=false,guitarLibrary=false}:{reference:MusicReference;active:MusicReferenceEvent[];time?:number;pianoLibrary?:boolean;guitarLibrary?:boolean}){
 const range=useMemo(()=>pianoGeometry(reference.events),[reference]);
 const pitches=[...new Set(active.map(event=>event.pitch))].sort((a,b)=>a-b);
 const guitar=guitarGuide(reference.instrument,active);
 // Watch uses the notation's saved tuning/capo when present; top-level events may be
 // deliberately unpositioned for non-standard setups.
 const savedNotation=reference.notation&&typeof reference.notation==='object'
   ?reference.notation as {guitar_tuning?: unknown; guitar_capo?: unknown; performance?: unknown}:null;
 const savedSetup=normalizeGuitarSetup({
   ...(isGuitarTuningId(savedNotation?.guitar_tuning)?{tuning:savedNotation.guitar_tuning}:{}),
   ...(typeof savedNotation?.guitar_capo==='number'?{capo:savedNotation.guitar_capo}:{}),
 });
 const savedPerformance=Array.isArray(savedNotation?.performance)
   ?savedNotation.performance.filter((item):item is Record<string,unknown>=>Boolean(item)&&typeof item==='object')
   :[];
 const savedPositions=useMemo(()=>{
   if(!savedPerformance.length)return null;
   const events=active.map(event=>{
     const performance=savedPerformance.find(item=>item.id===event.id);
     return {...event,
       string:performance&&typeof performance.string==='number'?performance.string:event.string,
       fret:performance&&typeof performance.fret==='number'?performance.fret:event.fret};
   });
   return guitarPositionsForSetup(events,savedSetup);
 },[active,savedPerformance,savedSetup.tuning,savedSetup.capo]);
 const guitarPositions=savedPositions??guitar.positions;
 const guitarNotice=savedPositions&&(savedSetup.tuning!=='standard'||savedSetup.capo>0)
   ?`Markers use the saved ${savedSetup.tuning.replaceAll('_',' ')}${savedSetup.capo?` · capo ${savedSetup.capo}`:''} positions.`
   :guitar.notice;
 const effectiveGuitar={positions:guitarPositions,notice:guitarNotice};
 const legacy=<LegacyInstrumentGuide reference={reference} pitches={pitches} guitar={effectiveGuitar}
   tuning={savedSetup.tuning} capo={savedSetup.capo}/>;
 const library=reference.subject==='piano'?pianoLibrary:guitarLibrary;
 return <div className="instrument-guide-stage">
  {library?<DrawingBoundary key={`${reference.subject}:${library}`} fallback={legacy}><Suspense fallback={<><p className="small muted" role="status">Opening instrument guide…</p>{legacy}</>}>
   {reference.subject==='piano'?<PianoGuide low={range.low} high={range.high} pitches={pitches} noteLabel={pitchName}/>:<GuitarNeckGuide positions={guitarPositions} tuning={savedSetup.tuning} capo={savedSetup.capo}/>}
  </Suspense></DrawingBoundary>:legacy}
  {reference.subject==='guitar'&&<p className="small muted">{guitarNotice}</p>}
  {reference.subject==='guitar'&&reference.guitarChords.length>0&&<Suspense fallback={null}><GuitarChordCards chords={reference.guitarChords} time={time}/></Suspense>}
 </div>;
}
