import {useEffect,useMemo,useRef,useState} from 'react';
import type {MusicDraftEvent} from '../../../../packages/lesson-schema/index';

type Scheduled = {oscillator: OscillatorNode; gain: GainNode};
const BLACK = new Set([1, 3, 6, 8, 10]);

/** Piano-roll, keyboard and synthesized audition for the unreviewed note proposal. */
export function DraftNotePreview({events,duration}:{events:MusicDraftEvent[];duration:number}){
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false);
 const MAX_AUDITION=1000;
 const audio=useRef<AudioContext|null>(null),scheduled=useRef<Scheduled[]>([]),frame=useRef(0),startedAt=useRef(0);
 const notes=useMemo(()=>events.filter(event=>event.onset<duration).slice(0,MAX_AUDITION),[events,duration]);
 const truncated=events.filter(event=>event.onset<duration).length>MAX_AUDITION;
 const pitches=notes.map(event=>event.pitch);
 const low=pitches.length?Math.min(...pitches):48,high=pitches.length?Math.max(...pitches):72;
 const rowLow=Math.max(0,low-1),rowHigh=Math.min(127,high+1),rows=rowHigh-rowLow+1;
 const activePitches=new Set(notes.filter(event=>event.onset<=time+1e-6&&time<event.onset+(event.duration??.25)).map(event=>event.pitch));
 const rollW=760,rollH=190,left=38,top=12,plotW=rollW-left-14,plotH=rollH-top-26;
 const y=(pitch:number)=>top+(rowHigh-pitch)/Math.max(1,rows-1)*plotH;
 const x=(onset:number)=>left+Math.min(1,Math.max(0,onset/duration))*plotW;
 const noteW=(note:MusicDraftEvent)=>Math.max(2,Math.min(plotW,((note.duration??.25)/duration)*plotW));
 const keyboard=useMemo(()=>{
  let first=Math.floor(rowLow/12)*12,last=Math.ceil(rowHigh/12)*12;
  if(last-first>48){const middle=Math.floor((rowLow+rowHigh)/24)*12;first=Math.max(0,middle-24);last=first+48;}
  const whites=[],blacks=[];
  for(let octave=first;octave<=last;octave+=12)for(const pitchClass of [0,2,4,5,7,9,11]){
   const pitch=octave+pitchClass;if(pitch>127)continue;whites.push(pitch);
  }
  const whiteW=720/Math.max(1,whites.length);
  for(let index=0;index<whites.length-1;index++){
   const pitch=whites[index];
   if(!BLACK.has((pitch+1)%12))continue;
   const black=pitch+1;if(black>127)continue;
   blacks.push({pitch:black,x:(index+1)*whiteW-9});
  }
  return {whites,blacks,whiteW};
 },[rowLow,rowHigh,notes]);

 const stop=()=>{
  if(frame.current)cancelAnimationFrame(frame.current);frame.current=0;
  for(const {oscillator,gain} of scheduled.current){try{oscillator.stop()}catch{}try{gain.disconnect()}catch{}}
  scheduled.current=[];
  if(audio.current){void audio.current.close().catch(()=>{});audio.current=null;}
  setPlaying(false);setTime(0);
 };
 useEffect(()=>()=>{if(frame.current)cancelAnimationFrame(frame.current);for(const {oscillator} of scheduled.current){try{oscillator.stop()}catch{}}if(audio.current)void audio.current.close().catch(()=>{});},[]);

 const play=async()=>{
  if(playing){stop();return;}
  if(!notes.length)return;
  stop();
  const Ctor=window.AudioContext??(window as typeof window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Ctor){return;}
  const context=new Ctor();await context.resume();audio.current=context;
  const base=context.currentTime+.05;
  const wave=context.createPeriodicWave(new Float32Array([0,1,.55,.3,.16,.09]),new Float32Array(6));
  for(const note of notes){
   const oscillator=context.createOscillator(),gain=context.createGain();
   oscillator.setPeriodicWave(wave);oscillator.frequency.value=440*2**((note.pitch-69)/12);
   const begin=base+note.onset,length=Math.max(.06,note.duration??.25),volume=Math.min(.09,.035+(note.velocity??.6)*.04);
   gain.gain.setValueAtTime(.0001,begin);gain.gain.exponentialRampToValueAtTime(volume,begin+.015);
   gain.gain.exponentialRampToValueAtTime(.0001,begin+length);
   oscillator.connect(gain).connect(context.destination);oscillator.start(begin);oscillator.stop(begin+length+.02);
   scheduled.current.push({oscillator,gain});
  }
  startedAt.current=performance.now()+50;setPlaying(true);
  const tick=()=>{const elapsed=Math.max(0,(performance.now()-startedAt.current)/1000);setTime(Math.min(duration,elapsed));if(elapsed<duration)frame.current=requestAnimationFrame(tick);else stop();};
  tick();
 };
 return <section className="draft-note-preview" aria-label="Proposed note preview">
  <div className="draft-preview-head"><div><h2>Proposed notes preview</h2><p className="small muted">The roll and keyboard show what the transcription currently claims. Play a synthesized audition; the original video stays pinned above.</p></div>
   <button type="button" className={playing?'secondary':'primary'} onClick={()=>void play()} disabled={!notes.length} aria-pressed={playing}>{playing?'Stop audition':'Play proposed notes'}</button></div>
  <div className="draft-roll-scroll">
   <svg className="draft-roll" viewBox={`0 0 ${rollW} ${rollH}`} role="img" aria-label={`Piano roll, ${notes.length} proposed notes, ${duration.toFixed(1)} seconds`} data-note-count={notes.length}>
    <rect x={left} y={top} width={plotW} height={plotH} className="draft-roll-bg"/>
    {[0,.25,.5,.75,1].map(fraction=><line key={fraction} x1={left+fraction*plotW} y1={top} x2={left+fraction*plotW} y2={top+plotH} className="draft-roll-grid"/>)}
    {[0,.5,1].map(fraction=><text key={fraction} x={left+fraction*plotW} y={rollH-8} textAnchor={fraction===0?'start':fraction===1?'end':'middle'} className="draft-roll-label">{(duration*fraction).toFixed(1)}s</text>)}
    {notes.map(note=><rect key={note.id} x={x(note.onset)} y={y(note.pitch)-3} width={noteW(note)} height={6} rx={2}
      className={activePitches.has(note.pitch)&&note.onset<=time+1e-6&&time<note.onset+(note.duration??.25)?'draft-roll-note is-active':'draft-roll-note'}>
      <title>{`Note at ${note.onset.toFixed(2)}s, pitch ${note.pitch}`}</title></rect>)}
    <line x1={x(time)} y1={top} x2={x(time)} y2={top+plotH} className="draft-roll-playhead"/>
   </svg>
  </div>
  <div className="draft-preview-status" role="status" aria-live="polite">{playing?`Auditioning ${time.toFixed(1)} of ${duration.toFixed(1)} seconds.`:'Ready to audition. The video at the top stays visible while you edit.'}</div>
  <p className="small muted draft-preview-limit">{truncated?`Showing and auditioning the first ${MAX_AUDITION} notes of this proposal; remaining notes are still editable below.`:`All ${notes.length} proposed notes are shown and auditioned.`}</p>
  <svg className="draft-keyboard" viewBox="0 0 720 92" role="img" aria-label="Piano keyboard, lit keys follow the audition">
   {keyboard.whites.map((pitch,index)=><g key={pitch}>
    <rect x={index*keyboard.whiteW} y="4" width={keyboard.whiteW-1} height="80" rx="2" className={activePitches.has(pitch)?'draft-key-white is-active':'draft-key-white'}/>
    {pitch%12===0&&<text x={index*keyboard.whiteW+keyboard.whiteW/2} y="90" textAnchor="middle" className="draft-key-label">{noteName(pitch)}</text>}
   </g>)}
   {keyboard.blacks.map(item=><rect key={item.pitch} x={item.x} y="4" width="18" height="50" rx="2" className={activePitches.has(item.pitch)?'draft-key-black is-active':'draft-key-black'}/>)}
  </svg>
 </section>;
}

function noteName(pitch:number){return `${['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][pitch%12]}${Math.floor(pitch/12)-1}`;}
