import {useEffect,useRef,useState} from 'react';
import {MidiNotes,type MidiSnapshot} from '../../../../packages/music-engine/midi';
import {pitchName} from './music-reference';

const empty:MidiSnapshot={pressed:[],sounding:[],attacks:0,pedal:false};

/** Opt-in input setup pilot. Preview never opens MIDI; no performance is graded or saved. */
export function MidiKeyboardCheck({onSnapshot,onInputChange}:{onSnapshot?:(notes:MidiSnapshot)=>void;onInputChange?:(id:string)=>void}={}){
 const [access,setAccess]=useState<MIDIAccess|null>(null),[inputs,setInputs]=useState<MIDIInput[]>([]),[selected,setSelected]=useState('');
 const [notes,setNotes]=useState(empty),[busy,setBusy]=useState(false),[message,setMessage]=useState('Connect your keyboard, then choose its input. Use the sound from your keyboard.');
 const alive=useRef(true),requestEpoch=useRef(0),opened=useRef<MIDIInput|null>(null),state=useRef(new MidiNotes()),selectedRef=useRef(selected);selectedRef.current=selected;
 const snapshotCallback=useRef(onSnapshot),inputCallback=useRef(onInputChange);snapshotCallback.current=onSnapshot;inputCallback.current=onInputChange;
 const supported=window.isSecureContext&&typeof navigator.requestMIDIAccess==='function';
 const clear=()=>setNotes(state.current.reset());
 useEffect(()=>{snapshotCallback.current?.(notes);},[notes]);
 useEffect(()=>{inputCallback.current?.(selected);},[selected]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;requestEpoch.current++;};},[]);
 useEffect(()=>{
  if(!access)return;
  const update=()=>{const available=[...access.inputs.values()].filter(input=>input.state==='connected');setInputs(previous=>previous.length===available.length&&previous.every((input,index)=>input===available[index])?previous:available);
   if(opened.current&&!available.some(input=>input.id===opened.current?.id)){setSelected('');clear();setMessage('Keyboard disconnected. Select a connected keyboard to continue.');}};
  update();access.addEventListener('statechange',update);return()=>access.removeEventListener('statechange',update);
 },[access]);
 useEffect(()=>{
  const input=inputs.find(item=>item.id===selected);let stopped=false;
  clear();
  if(!input)return;
  const receive=(event:MIDIMessageEvent)=>{if(!stopped&&!document.hidden&&event.data)setNotes(state.current.receive(event.data));};
  void input.open().then(()=>{if(stopped){if(!alive.current||selectedRef.current!==input.id)void input.close().catch(()=>{});return;}
   opened.current=input;input.addEventListener('midimessage',receive);setMessage('Play a note to check this keyboard. This is not a scored exercise.');
  }).catch(()=>{if(!stopped){setSelected('');setMessage('This keyboard could not be opened. Choose another input or reconnect it.');}});
  return()=>{stopped=true;input.removeEventListener('midimessage',receive);if(opened.current===input)opened.current=null;void input.close().catch(()=>{});};
 },[selected,inputs]);
 useEffect(()=>{const hide=()=>{if(document.hidden){setSelected('');clear();setMessage('Keyboard input paused while this page was hidden. Choose the input again to continue.');}};
  const leave=()=>{setSelected('');clear();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);
  return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);};
 },[]);
 const connect=async()=>{
  const epoch=++requestEpoch.current;setBusy(true);setMessage('Allow keyboard access if your browser asks.');
  try{const granted=await navigator.requestMIDIAccess({sysex:false});if(!alive.current||requestEpoch.current!==epoch)return;setAccess(granted);setMessage('Choose your keyboard input. No notes are being graded.');}
  catch{if(alive.current&&requestEpoch.current===epoch)setMessage('Keyboard access was unavailable or declined. You can still watch and use the guide.');}
  finally{if(alive.current&&requestEpoch.current===epoch)setBusy(false);}
 };
 return <section className="music-home-panel midi-check" aria-label="Keyboard check">
  <h2>Keyboard check · unscored</h2><p>Your played notes stay on this device. No score, recording or attempt is saved.</p>
  {!supported?<p>This browser cannot connect a keyboard here. The video and guide remain available.</p>:!access?<button className="secondary" disabled={busy} onClick={()=>void connect()}>{busy?'Connecting keyboard…':'Connect a keyboard'}</button>:<>
   <label>Keyboard input<select aria-label="Keyboard input" value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Choose an input</option>{inputs.map(input=><option key={input.id} value={input.id}>{input.name||'Unnamed keyboard'}</option>)}</select></label>
   {!inputs.length&&<p>No keyboard inputs found. Connect a keyboard and check its cable.</p>}
   <button className="secondary" onClick={()=>{requestEpoch.current++;setSelected('');setAccess(null);setInputs([]);clear();setMessage('Keyboard disconnected.');}}>Disconnect keyboard</button>
  </>}
  <p role="status">{supported?message:'Watching and guide playback remain available.'}</p>
  <dl><div><dt>Keys pressed</dt><dd data-testid="midi-pressed">{notes.pressed.map(pitchName).join(' · ')||'None'}</dd></div>
   <div><dt>Sounding notes, including pedal</dt><dd data-testid="midi-sounding">{notes.sounding.map(pitchName).join(' · ')||'None'}</dd></div>
   <div><dt>Note attacks</dt><dd data-testid="midi-attacks">{notes.attacks}</dd></div></dl>
 </section>;
}
