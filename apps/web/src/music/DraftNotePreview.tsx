import {useEffect,useMemo,useRef,useState,type RefObject} from 'react';
import type {MusicDraftEvent,MusicPedalSpan} from '../../../../packages/lesson-schema/index';
import {MASTER_GAIN} from './music-velocity';
import {schedulePianoVoice} from './piano-audition';

type Scheduled = {oscillator: OscillatorNode; gain: GainNode};
const BLACK = new Set([1, 3, 6, 8, 10]);

/** Piano-roll, keyboard and synthesized audition for the unreviewed note proposal. */
export function DraftNotePreview({events,duration,highlightIds,selection,sourceTime,sourceRef,pedal=[]}:{
  events:MusicDraftEvent[];duration:number;highlightIds?:Set<string>;
  selection?:{ids:Set<string>;pitches:Set<number>;time:number};
  sourceTime?:number;
  sourceRef?:RefObject<HTMLVideoElement|null>;
  pedal?:MusicPedalSpan[];
}){
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[volume,setVolume]=useState(70);
 const MAX_AUDITION=1000;
 const audio=useRef<AudioContext|null>(null),master=useRef<GainNode|null>(null),scheduled=useRef<Scheduled[]>([]),frame=useRef(0);
 const controlled=sourceTime!==undefined||sourceRef!==undefined;
 const displayTime=sourceTime??time;
 const notes=useMemo(()=>{const visible=events.filter(event=>event.onset<duration&&event.onset+(event.duration??.25)>0);return controlled?visible:visible.slice(0,MAX_AUDITION);},[events,duration,controlled]);
 const truncated=!controlled&&events.filter(event=>event.onset<duration).length>MAX_AUDITION;
 const pitches=notes.map(event=>event.pitch);
 const low=pitches.length?Math.min(...pitches):48,high=pitches.length?Math.max(...pitches):72;
 const rowLow=Math.max(0,low-1),rowHigh=Math.min(127,high+1),rows=rowHigh-rowLow+1;
 const activePitches=new Set((controlled||playing?notes:[]).filter(event=>event.onset<=displayTime+1e-6&&displayTime<event.onset+(event.duration??.25)).map(event=>event.pitch));
 const selectedPitches=selection?.pitches??new Set<number>();
 // Update just the visual guide, not the thousands of editable form controls in
 // its parent. This reads the same source clock; it never advances a new clock.
 useEffect(()=>{
  const media=sourceRef?.current;if(!media)return;
  let animation=0;
  const update=()=>{animation=0;setTime(media.currentTime);if(!media.paused&&!media.ended)animation=requestAnimationFrame(update);};
  const refresh=()=>{if(animation)cancelAnimationFrame(animation);update();};
  const names=['play','pause','seeked','timeupdate','ended'];
  for(const name of names)media.addEventListener(name,refresh);refresh();
  return()=>{if(animation)cancelAnimationFrame(animation);for(const name of names)media.removeEventListener(name,refresh);};
 },[sourceRef]);
 const rollW=760,rollH=190,left=38,top=12,plotW=rollW-left-14,plotH=rollH-top-26;
 const y=(pitch:number)=>top+(rowHigh-pitch)/Math.max(1,rows-1)*plotH;
 const x=(onset:number)=>left+Math.min(1,Math.max(0,onset/duration))*plotW;
 const noteW=(note:MusicDraftEvent)=>Math.max(2,Math.min(plotW,((Math.min(duration,note.onset+(note.duration??.25))-Math.max(0,note.onset))/duration)*plotW));
 const keyboard=useMemo(()=>{
  let first=Math.floor(rowLow/12)*12,last=Math.ceil(rowHigh/12)*12;
  if(last-first>48&&!controlled){const middle=Math.floor((rowLow+rowHigh)/24)*12;first=Math.max(0,middle-24);last=first+48;}
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
 },[rowLow,rowHigh,notes,controlled]);

 const stop=()=>{
  if(frame.current)cancelAnimationFrame(frame.current);frame.current=0;
  for(const {oscillator,gain} of scheduled.current){try{oscillator.stop()}catch{}try{gain.disconnect()}catch{}}
  scheduled.current=[];
  if(audio.current){void audio.current.close().catch(()=>{});audio.current=null;}master.current=null;
  setPlaying(false);setTime(0);
 };
 useEffect(()=>()=>{if(frame.current)cancelAnimationFrame(frame.current);for(const {oscillator} of scheduled.current){try{oscillator.stop()}catch{}}if(audio.current)void audio.current.close().catch(()=>{});audio.current=null;},[]);
 useEffect(()=>{if(master.current)master.current.gain.value=MASTER_GAIN*(volume/100);},[volume]);
 useEffect(()=>{stop();},[events,duration]);

 const play=async()=>{
  if(playing){stop();return;}
  if(!notes.length)return;
  stop();
  const Ctor=window.AudioContext??(window as typeof window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Ctor){return;}
  const context=new Ctor();audio.current=context;
  try{await context.resume();}catch{if(audio.current===context)stop();return;}
  if(audio.current!==context)return;
  const base=context.currentTime+.05;
  const output=context.createGain();output.gain.value=MASTER_GAIN*(volume/100);master.current=output;
  const compressor=context.createDynamicsCompressor();compressor.threshold.value=-18;compressor.knee.value=12;
  compressor.ratio.value=8;compressor.attack.value=.003;compressor.release.value=.25;
  compressor.connect(output).connect(context.destination);
  for(const note of notes){
   const voice=schedulePianoVoice(context,compressor,{pitch:note.pitch,velocity:note.velocity,
    startTime:base+note.onset,duration:note.duration??.25,windowSeconds:duration-note.onset});
   if(voice)scheduled.current.push(voice);
  }
  setPlaying(true);
  const tick=()=>{if(audio.current!==context)return;const elapsed=Math.max(0,context.currentTime-base);setTime(Math.min(duration,elapsed));if(elapsed<duration)frame.current=requestAnimationFrame(tick);else stop();};
  tick();
 };
 return <section className="draft-note-preview" aria-label="Proposed note preview">
  <div className="draft-preview-head"><div><h2>Proposed notes preview</h2><p className="small muted">{controlled?'The keyboard and roll follow the original video in either audio mode. Note lengths and intensity are model estimates.':'The roll and keyboard show what the transcription currently claims. Play a harmonic piano audition; velocity changes loudness and brightness.'}</p></div>
   {!controlled&&<div className="draft-preview-controls"><label className="small muted">Preview volume<input aria-label="Preview volume" type="range" min={0} max={100} value={volume} onChange={e=>setVolume(Number(e.target.value))}/><span>{volume}%</span></label><button type="button" className={playing?'secondary':'primary'} onClick={()=>void play()} disabled={!notes.length} aria-pressed={playing}>{playing?'Stop audition':'Play proposed notes'}</button></div>}</div>
  <div className="draft-roll-scroll">
   <svg className="draft-roll" viewBox={`0 0 ${rollW} ${rollH}`} role="img" aria-label={`Piano roll, ${notes.length} proposed notes, ${duration.toFixed(1)} seconds`} data-note-count={notes.length}>
    <rect x={left} y={top} width={plotW} height={plotH} className="draft-roll-bg"/>
    {[0,.25,.5,.75,1].map(fraction=><line key={fraction} x1={left+fraction*plotW} y1={top} x2={left+fraction*plotW} y2={top+plotH} className="draft-roll-grid"/>)}
    {[0,.5,1].map(fraction=><text key={fraction} x={left+fraction*plotW} y={rollH-8} textAnchor={fraction===0?'start':fraction===1?'end':'middle'} className="draft-roll-label">{(duration*fraction).toFixed(1)}s</text>)}
    {notes.map(note=><rect key={note.id} x={x(note.onset)} y={y(note.pitch)-3} width={noteW(note)} height={6} rx={2}
      className={highlightIds?.has(note.id)?'draft-roll-note is-highlighted':activePitches.has(note.pitch)&&note.onset<=displayTime+1e-6&&displayTime<note.onset+(note.duration??.25)?'draft-roll-note is-active':'draft-roll-note'}>
      <title>{`Note at ${note.onset.toFixed(2)}s, pitch ${note.pitch}`}</title></rect>)}
    <line x1={x(displayTime)} y1={top} x2={x(displayTime)} y2={top+plotH} className="draft-roll-playhead"/>
   </svg>
  </div>
  <div className="draft-preview-status" role="status">{controlled?`Following source: ${displayTime.toFixed(1)} of ${duration.toFixed(1)} seconds.`:playing?`Auditioning ${time.toFixed(1)} of ${duration.toFixed(1)} seconds.`:'Ready to audition. The video at the top stays visible while you edit.'}</div>
  {pedal.length>0&&<p className="small muted" data-pedal-active={pedal.some(span=>displayTime>=span.onset&&displayTime<span.offset)}>Sustain pedal: {pedal.some(span=>displayTime>=span.onset&&displayTime<span.offset)?'on':'off'} (estimated)</p>}
  <p className="small muted draft-preview-limit">{controlled?`All ${notes.length} visible proposed notes follow the source.`:truncated?`Showing and auditioning the first ${MAX_AUDITION} notes of this proposal; remaining notes are still editable below.`:`All ${notes.length} proposed notes are shown and auditioned.`}</p>
  <div className="draft-keyboard-scroll" tabIndex={0} role="region" aria-label="Scrollable piano keyboard">
  <svg className="draft-keyboard" viewBox="0 0 720 92" role="img" aria-label="Piano keyboard, lit keys follow the audition">
   {keyboard.whites.map((pitch,index)=><g key={pitch}>
    <rect x={index*keyboard.whiteW} y="4" width={keyboard.whiteW-1} height="80" rx="2" className={activePitches.has(pitch)||selectedPitches.has(pitch)?'draft-key-white is-active':'draft-key-white'}/>
    {pitch%12===0&&<text x={index*keyboard.whiteW+keyboard.whiteW/2} y="90" textAnchor="middle" className="draft-key-label">{noteName(pitch)}</text>}
   </g>)}
   {keyboard.blacks.map(item=><rect key={item.pitch} x={item.x} y="4" width="18" height="50" rx="2" className={activePitches.has(item.pitch)||selectedPitches.has(item.pitch)?'draft-key-black is-active':'draft-key-black'}/>)}
  </svg>
  </div>
 </section>;
}

function noteName(pitch:number){return `${['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][pitch%12]}${Math.floor(pitch/12)-1}`;}
