import {useCallback, useEffect, useRef, useState} from 'react';

export type MidiAttack = {pitch:number; timeStamp:number};
export type MidiInputView = {
  supported:boolean;
  busy:boolean;
  connected:boolean;
  selected:string;
  inputs:{id:string; name:string}[];
  message:string;
  connect:()=>Promise<void>;
  select:(id:string)=>void;
  disconnect:()=>void;
};

/**
 * Headless Web MIDI input. Permission is requested only by `connect()` from a user
 * action; the selected port is opened once, closed on change/unmount, and releases
 * itself when the page is hidden. No note is graded or persisted here.
 */
export function useMidiInput({onAttack, onInputChange}:{
  onAttack?:(attack:MidiAttack)=>void;
  onInputChange?:(id:string)=>void;
} = {}):MidiInputView {
  const [access,setAccess]=useState<MIDIAccess|null>(null);
  const [inputs,setInputs]=useState<MIDIInput[]>([]);
  const [selected,setSelected]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('Connect your keyboard, then choose its input.');
  const alive=useRef(true), requestEpoch=useRef(0), opened=useRef<MIDIInput|null>(null);
  const attackCallback=useRef(onAttack), inputCallback=useRef(onInputChange), selectedRef=useRef(selected);
  attackCallback.current=onAttack; inputCallback.current=onInputChange; selectedRef.current=selected;
  const supported=typeof window!=='undefined'&&window.isSecureContext&&typeof navigator.requestMIDIAccess==='function';

  useEffect(()=>{
    alive.current=true;
    return ()=>{alive.current=false;requestEpoch.current++;};
  },[]);

  useEffect(()=>{
    if(!access)return;
    const update=()=>{
      const available=[...access.inputs.values()].filter(input=>input.state==='connected');
      setInputs(previous=>previous.length===available.length&&previous.every((input,index)=>input===available[index])?previous:available);
      if(opened.current&&!available.some(input=>input.id===opened.current?.id)){
        setSelected('');
        setMessage('Keyboard disconnected. Select a connected keyboard to continue.');
        inputCallback.current?.('');
      }
    };
    update();
    access.addEventListener('statechange',update);
    return ()=>access.removeEventListener('statechange',update);
  },[access]);

  useEffect(()=>{
    const input=inputs.find(item=>item.id===selected) ?? null;
    let stopped=false;
    if(!input){inputCallback.current?.('');return;}
    const receive=(event:MIDIMessageEvent)=>{
      if(stopped||document.hidden||!event.data)return;
      const [status,pitch,velocity]=event.data;
      if(event.data.length===3&&status>=0x90&&status<=0x9f&&pitch<=127&&velocity>0&&velocity<=127){
        attackCallback.current?.({pitch,timeStamp:event.timeStamp});
      }
    };
    void input.open().then(()=>{
      if(stopped){if(!alive.current||selectedRef.current!==input.id)void input.close().catch(()=>{});return;}
      opened.current=input;
      input.addEventListener('midimessage',receive);
      inputCallback.current?.(input.id);
      setMessage('Listening to your keyboard. No note is graded until you start Listen & play.');
    }).catch(()=>{
      if(!stopped){setSelected('');setMessage('This keyboard could not be opened. Choose another input or reconnect it.');}
    });
    return ()=>{
      stopped=true;
      input.removeEventListener('midimessage',receive);
      if(opened.current?.id===input.id)opened.current=null;
      void input.close().catch(()=>{});
    };
  },[selected,inputs]);

  useEffect(()=>{
    const hide=()=>{if(document.hidden){setSelected('');setMessage('Keyboard input paused while this page was hidden. Choose the input again.');inputCallback.current?.('');}};
    const leave=()=>{setSelected('');inputCallback.current?.('');};
    document.addEventListener('visibilitychange',hide);
    window.addEventListener('pagehide',leave);
    return ()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);};
  },[]);

  const connect=useCallback(async()=>{
    if(!supported){setMessage('This browser cannot connect a keyboard here.');return;}
    const epoch=++requestEpoch.current;
    setBusy(true);
    setMessage('Allow keyboard access if your browser asks.');
    try{
      const granted=await navigator.requestMIDIAccess({sysex:false});
      if(!alive.current||requestEpoch.current!==epoch)return;
      setAccess(granted);
      setMessage('Choose your keyboard input.');
    }catch{
      if(alive.current&&requestEpoch.current===epoch)setMessage('Keyboard access was unavailable or declined.');
    }finally{
      if(alive.current&&requestEpoch.current===epoch)setBusy(false);
    }
  },[]);

  const select=useCallback((id:string)=>{setSelected(id);},[]);
  const disconnect=useCallback(()=>{
    requestEpoch.current++;
    setSelected('');
    setAccess(null);
    setInputs([]);
    inputCallback.current?.('');
    setMessage('Keyboard disconnected.');
  },[]);

  return {supported,busy,connected:Boolean(selected)&&inputs.some(input=>input.id===selected),selected,
    inputs:inputs.map(input=>({id:input.id,name:input.name||'Unnamed keyboard'})),message,connect,select,disconnect};
}
