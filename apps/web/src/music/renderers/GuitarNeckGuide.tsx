import {memo,useEffect,useRef,useState} from 'react';
import {Fretboard,type Position} from '@moonwave99/fretboard.js';
import type {GuitarGuideModel} from './guide-view-model';
import './instrument-guide.css';
export default memo(function GuitarNeckGuide({positions}:{positions:GuitarGuideModel['positions']}){
 const host=useRef<HTMLDivElement>(null),board=useRef<Fretboard|null>(null),latest=useRef(positions);latest.current=positions;
 const [error,setError]=useState<Error|null>(null);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  let width=0;
  const render=()=>{try{
    const next=Math.max(520,Math.round(element.getBoundingClientRect().width));
    if(next===width&&board.current)return;
    width=next;board.current?.removeEventListeners();element.replaceChildren();
    const instance=new Fretboard({el:element,tuning:['E2','A2','D3','G3','B3','E4'],fretCount:12,
     height:170,width:next,showFretNumbers:true,dotFill:'#6c8050',dotText:(dot:Position)=>String(dot.label??''),font:'Arial'});
    board.current=instance;instance.setDots(latest.current).render();
   }catch(cause){setError(cause instanceof Error?cause:Error('Guitar guide could not draw.'));}};
  render();const observer=new ResizeObserver(render);observer.observe(element);
  return()=>{observer.disconnect();board.current?.removeEventListeners();board.current=null;element.replaceChildren();};
 },[]);
 useEffect(()=>{try{board.current?.setDots(positions).render();}catch(cause){setError(cause instanceof Error?cause:Error('Guitar markers could not draw.'));}},[positions]);
 if(error)throw error;
 return <><div className="library-guide-scroll" role="img" aria-label="Guitar guide, standard tuning, string 1 high E" data-renderer="guitar-library" data-positions={positions.map(item=>`${item.string}:${item.fret}:${item.pitch}`).join(',')}>
  <div className="library-neck" ref={host} aria-hidden="true"/>
 </div><p className="small muted">Top to bottom: E4, B3, G3, D3, A2, E2. Scroll the diagram for frets 0–12.</p></>;
},(before,after)=>JSON.stringify(before.positions)===JSON.stringify(after.positions));
