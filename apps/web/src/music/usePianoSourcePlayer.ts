import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPianoSourceController} from './piano-source-controller';

/**
 * One source-driven Original/Piano controller shared by review and lesson pages.
 * The source element owns the clock; Piano is muted/mapped and never free-runs.
 */
export function usePianoSourcePlayer(
  source:RefObject<HTMLVideoElement|null>,
  piano:RefObject<HTMLAudioElement|null>,
  mode:'original'|'piano',
  offsetSeconds:number,identity='',onFailure?:()=>void,
){
  const [state,setState]=useState({playing:false,ready:false,error:''});
  const binding=useRef<{source:HTMLMediaElement;piano:HTMLMediaElement;controller:ReturnType<typeof createPianoSourceController>}|null>(null);
  const failure=useRef(onFailure);failure.current=onFailure;
  const configuration=useRef('');
  // Ref objects are stable, but their elements may mount after the draft loads.
  useEffect(()=>{
    const media=source.current,target=piano.current;
    const key=JSON.stringify([mode,offsetSeconds,identity]);
    if(binding.current&&(binding.current.source!==media||binding.current.piano!==target)){
      binding.current.controller.destroy();binding.current=null;configuration.current='';
    }
    if(!media||!target)return;
    if(!binding.current){
      const controller=createPianoSourceController(media,target,next=>setState(previous=>
        previous.playing===next.playing&&previous.ready===next.ready&&previous.error===next.error?previous:
          {playing:next.playing,ready:next.ready,error:next.error}),()=>failure.current?.());
      binding.current={source:media,piano:target,controller};
    }
    if(configuration.current!==key){configuration.current=key;binding.current.controller.configure(mode,offsetSeconds);}
  });
  useEffect(()=>()=>{binding.current?.controller.destroy();binding.current=null;},[]);
  return state;
}
