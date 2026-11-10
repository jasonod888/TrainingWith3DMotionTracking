import {Component,lazy,Suspense,useMemo,type ReactNode} from 'react';
import {pianoGeometry,pitchName,type MusicReference,type MusicReferenceEvent} from '../music-reference';
import {guitarGuide} from './guide-view-model';
import {LegacyInstrumentGuide} from './LegacyInstrumentGuide';
const PianoGuide=lazy(()=>import('./PianoGuide'));
const GuitarNeckGuide=lazy(()=>import('./GuitarNeckGuide'));
class DrawingBoundary extends Component<{fallback:ReactNode;children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<><p className="small muted" role="status">Using the basic guide because the enhanced drawing could not load.</p>{this.props.fallback}</>:this.props.children;}
}
export function InstrumentGuideStage({reference,active,pianoLibrary=false,guitarLibrary=false}:{reference:MusicReference;active:MusicReferenceEvent[];pianoLibrary?:boolean;guitarLibrary?:boolean}){
 const range=useMemo(()=>pianoGeometry(reference.events),[reference]);
 const pitches=[...new Set(active.map(event=>event.pitch))].sort((a,b)=>a-b);
 const guitar=guitarGuide(reference.instrument,active);
 const legacy=<LegacyInstrumentGuide reference={reference} pitches={pitches} guitar={guitar}/>;
 const library=reference.subject==='piano'?pianoLibrary:guitarLibrary;
 return <div className="instrument-guide-stage">
  {library?<DrawingBoundary key={`${reference.subject}:${library}`} fallback={legacy}><Suspense fallback={<><p className="small muted" role="status">Opening instrument guide…</p>{legacy}</>}>
   {reference.subject==='piano'?<PianoGuide low={range.low} high={range.high} pitches={pitches} noteLabel={pitchName}/>:<GuitarNeckGuide positions={guitar.positions}/>}
  </Suspense></DrawingBoundary>:legacy}
  {reference.subject==='guitar'&&<p className="small muted">{guitar.notice}</p>}
 </div>;
}
