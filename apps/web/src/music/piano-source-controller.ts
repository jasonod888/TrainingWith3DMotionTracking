import {pianoTimeFor} from './piano-playback';

/** Source is the sole transport clock. Drift correction never edits note timing. */
export function createPianoSourceController(source:HTMLMediaElement,piano:HTMLMediaElement,
 publish:(state:{time:number;playing:boolean;ready:boolean;error:string})=>void,onFailure:()=>void=()=>{}){
 let mode:'original'|'piano'='original',offset=0,stalled=false,seeking=false,dead=false;
 let error='',frame=0,pending=false,generation=0,forceWhenReady=false;
 let originalMuted=source.muted;
 const muteSource=(value:boolean)=>{if(source.muted!==value)source.muted=value;};
 const listeners:Array<[HTMLMediaElement,string,EventListener]>=[];
 const emit=()=>publish({time:source.currentTime,playing:!source.paused&&!source.ended&&!stalled&&!seeking,
  ready:piano.readyState>=2&&!piano.error,error});
 const pause=()=>{generation++;pending=false;piano.pause();};
 const fail=()=>{if(dead)return;const wasPiano=mode==='piano';error='Piano audio could not play. Using original audio; retry Piano when it is ready.';
  mode='original';pause();muteSource(originalMuted);emit();if(wasPiano)onFailure();};
 const sync=(force=false)=>{
  if(dead)return;
  if(mode==='original'){piano.pause();muteSource(originalMuted);emit();return;}
  muteSource(true);if(piano.volume!==source.volume)piano.volume=source.volume;if(piano.muted!==originalMuted)piano.muted=originalMuted;
  if('preservesPitch' in piano){const preserve='preservesPitch' in source?source.preservesPitch:true;if(piano.preservesPitch!==preserve)piano.preservesPitch=preserve;}
  const mapped=pianoTimeFor(source.currentTime,offset);
  if(!Number.isFinite(piano.duration)||piano.readyState<2){forceWhenReady=forceWhenReady||force;pause();muteSource(originalMuted);emit();return;}
  if(mapped<0||mapped>=piano.duration){pause();emit();return;}
  const drift=mapped-piano.currentTime;
  if(force?Math.abs(drift)>.0001:Math.abs(drift)>.25){
   try{piano.currentTime=mapped;}catch{fail();return;}
  }
  // Small continuous drift is corrected smoothly. Repeated short seeks keep
  // resetting the browser's audio output buffer and can starve playback.
  const adjustment=!force&&!source.paused&&!piano.paused&&Math.abs(drift)>.01&&Math.abs(drift)<=.25
   ?Math.max(-.1,Math.min(.1,drift*4)):0;
  const rate=Math.max(.25,Math.min(4,source.playbackRate+adjustment));
  if(piano.playbackRate!==rate)piano.playbackRate=rate;
  if(source.paused||source.ended||source.seeking||stalled||seeking){pause();emit();return;}
  if(piano.paused&&!pending){
   pending=true;const attempt=generation;
   void piano.play().then(()=>{if(attempt!==generation||dead||mode!=='piano'){if(dead||mode!=='piano'||source.paused||stalled||seeking)piano.pause();return;}pending=false;},()=>{if(attempt===generation){pending=false;fail();}});
  }
  emit();
 };
 const tick=()=>{frame=0;if(dead)return;sync();if(!source.paused&&!source.ended)frame=requestAnimationFrame(tick);};
 const startTick=()=>{if(!frame)frame=requestAnimationFrame(tick);};
 const listen=(element:HTMLMediaElement,name:string,handler:()=>void)=>{element.addEventListener(name,handler);listeners.push([element,name,handler]);};
 listen(source,'play',()=>{stalled=source.readyState<3;sync(true);startTick();});
 listen(source,'playing',()=>{stalled=false;seeking=false;sync(true);startTick();});
 listen(source,'waiting',()=>{stalled=true;pause();emit();});
 // A stopped network download is not a playback stall when buffered frames
 // remain. Browsers need not emit another playing event in that case.
 listen(source,'stalled',()=>{if(source.readyState<3){stalled=true;pause();emit();}});
 listen(source,'seeking',()=>{seeking=true;pause();emit();});
 listen(source,'seeked',()=>{seeking=false;sync(true);});
 for(const name of ['pause','ended','error','emptied'])listen(source,name,()=>{pause();if(frame)cancelAnimationFrame(frame);frame=0;emit();});
 listen(source,'timeupdate',()=>sync());
 listen(source,'ratechange',()=>sync(true));
 listen(source,'volumechange',()=>{if(mode==='original')originalMuted=source.muted;else if(!source.muted){originalMuted=false;muteSource(true);}sync();});
 listen(piano,'loadedmetadata',()=>sync(true));
 // canplay also fires after our own seeks. Forcing another seek on each one
 // creates a feedback loop while the source clock continues moving.
 listen(piano,'canplay',()=>{const force=forceWhenReady;forceWhenReady=false;sync(force);});
 listen(piano,'error',fail);
 return {
  configure(next:'original'|'piano',seconds:number){
   if(next!==mode){if(mode==='original')originalMuted=source.muted;pause();}
   mode=next;offset=seconds;if(next==='piano')error='';sync(true);if(!source.paused)startTick();
  },
  destroy(){dead=true;pause();if(frame)cancelAnimationFrame(frame);for(const [element,name,handler]of listeners)element.removeEventListener(name,handler);muteSource(originalMuted);},
 };
}
