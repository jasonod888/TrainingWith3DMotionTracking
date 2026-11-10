import type {GuitarChord} from '../music-reference';
import './instrument-guide.css';

/** Reviewed chord cards: hand-drawn SVG diagrams, no vendor assets or chord database. */
export function GuitarChordCards({chords,time=0}:{chords:GuitarChord[];time?:number}){
 if(!chords.length)return null;
 const ordered=[...chords].sort((left,right)=>left.start-right.start);
 const active=[...ordered].reverse().find(chord=>chord.start<=time+1e-6)??null;
 return <section className="guitar-chords" aria-label="Reviewed guitar chords">
  <h3>Reviewed chord shapes</h3>
  <div className="guitar-chord-list">{ordered.map(chord=><figure key={chord.id} className={active?.id===chord.id?'is-active':''}>
   <figcaption>{chord.name}<small> · {chord.start.toFixed(1)}s</small></figcaption>
   <svg viewBox="0 0 100 124" role="img" aria-label={`${chord.name} chord diagram, ${chord.frets.map(f=>f<0?'muted':f).join(' ')}`}>
    <rect x="14" y="10" width="72" height="92" fill="none" stroke="currentColor" strokeWidth="1"/>
    {Array.from({length: 5},(_, index)=><line key={`fret-${index}`} x1="14" y1={10+index*23} x2="86" y2={10+index*23} stroke="currentColor" strokeWidth=".7"/>)}
    {Array.from({length: 6},(_, index)=><line key={`string-${index}`} x1={14+index*14.4} y1="10" x2={14+index*14.4} y2="102" stroke="currentColor" strokeWidth={index===0||index===5?1.4:.8}/>)}
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
  </figure>)}</div>
  <p className="small muted">String order left to right: low E, A, D, G, B, high E. These are instructor-reviewed shapes, not inferred fingering.</p>
 </section>;
}

export default GuitarChordCards;
