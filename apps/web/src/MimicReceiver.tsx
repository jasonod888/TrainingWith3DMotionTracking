import {useCallback,useEffect,useRef,useState} from 'react';
import {Playback} from '../../../packages/learning-engine/playback';
import type {PracticeAction} from '../../../packages/learning-engine/practice-session';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {PracticeFraming} from './practice-types';
import {MotionStage} from './MotionStage';
import {request} from './api';
import {pairRequest,signalKey,waitIce,type Pair,type PairStatus,type RemoteState} from './mimic-connection';
import {containedTransform} from './camera-framing';
import {guideBox,rectForBox} from './camera-setup-guide';
import {compareLayout,setupHeadline,setupHintCopy,setupPresentation,setupProgress} from './receiver-layout';
import {
  RECEIVER_MEDIA_DEFAULTS,displayLabel,mediaLabel,nextMediaState,
  type MediaSignal,type MediaState,
} from './receiver-media';
import {RTC_DEFAULTS,connectionFailureCopy,iceConfiguration} from './rtc-config';
import './practice.css';

/**
 * Paired practice display.
 *
 * The receiver renders the lesson locally and projects the capture device's
 * playback state forward between updates; it never owns the session. Camera
 * media arrives on a separate peer connection, and "paired" is never shown as
 * "live" until decoded frames are actually advancing.
 */
export function MimicReceiver({onBack}:{onBack:()=>void}){
 const [code,setCode]=useState(''),[pair,setPair]=useState<Pair|null>(null),[lesson,setLesson]=useState<LessonManifest|null>(null);
 const [message,setMessage]=useState('Sign into the same account as your camera device, then enter its connection code.');
 const [busy,setBusy]=useState(false),[approved,setApproved]=useState(false),[pending,setPending]=useState(false);
 const [media,setMedia]=useState<MediaState>('off'),[remote,setRemote]=useState<RemoteState|null>(null),[stale,setStale]=useState(false);
 const [cameraMirror,setCameraMirror]=useState(false),[countdown,setCountdown]=useState<{phase:string;remaining:number}|null>(null);
 const [measured,setMeasured]=useState({width:0,height:0}),[fullscreen,setFullscreen]=useState(false);
 const player=useRef<Playback|null>(null),anchor=useRef<{value:RemoteState;received:number;age:number}|null>(null),last=useRef(0);
 const video=useRef<HTMLVideoElement>(null),rtc=useRef<RTCPeerConnection|null>(null),stage=useRef<HTMLElement>(null),compare=useRef<HTMLDivElement>(null),pane=useRef<HTMLDivElement>(null),guide=useRef<SVGRectElement>(null);
 const signalSeen=useRef(''),pollRef=useRef<(()=>void)|null>(null),remoteRef=useRef<RemoteState|null>(null);
 remoteRef.current=remote;

 const signal=(value:MediaSignal)=>setMedia(state=>nextMediaState(state,value));

 useEffect(()=>{document.body.classList.add('in-practice');return()=>{document.body.classList.remove('in-practice');rtc.current?.close();};},[]);

 // Measure the presentation container itself, never the phone or a nominal TV size.
 useEffect(()=>{
  const element=compare.current;if(!element||typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(()=>setMeasured({width:element.clientWidth,height:element.clientHeight}));
  observer.observe(element);setMeasured({width:element.clientWidth,height:element.clientHeight});
  return()=>observer.disconnect();
 },[pair]);

 useEffect(()=>{
  const change=()=>setFullscreen(Boolean(document.fullscreenElement));
  document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change);
 },[]);

 // Media liveness: a frame counter, not a connection state.
 useEffect(()=>{
  const element=video.current;if(!element)return;
  let previous=-1,since=performance.now();
  const timer=window.setInterval(()=>{
   if(!element.srcObject)return;
   const now=performance.now();
   if(element.readyState>=2&&element.currentTime!==previous){previous=element.currentTime;since=now;signal({type:'frame'});}
   else if(now-since>RECEIVER_MEDIA_DEFAULTS.frameTimeoutMs)signal({type:'stall'});
  },350);
  return()=>window.clearInterval(timer);
 },[]);

 useEffect(()=>{
  if(!pair)return;
  let disposed=false,timer=0,inFlight=false,connectTimer=0;
  const poll=async()=>{
   if(inFlight||disposed)return;inFlight=true;
   try{
    const start=performance.now(),status=await pairRequest<PairStatus>(pair);
    if(disposed)return;
    setApproved(status.approved);setPending(status.pending);last.current=performance.now();setStale(false);
    if(status.manifest&&!player.current){player.current=new Playback(status.manifest.section_set.sections,status.manifest.duration);setLesson(status.manifest);}
    if(status.approved){
     const value=status.snapshot;
     if('time' in value){
      setCountdown(value.phase==='countdown'||value.phase==='rest'?{phase:value.phase,remaining:value.remaining}:null);
      setCameraMirror(value.camera_mirror);
      setRemote(value as RemoteState);
      anchor.current={value:value as RemoteState,received:performance.now(),age:Math.max(0,(status.server_time-value.server_time)/1000)+(performance.now()-start)/1000/2};
     }
     if(status.signal_generation!==undefined&&status.answer_generation!==undefined&&status.answer_generation&&status.answer_generation!==status.signal_generation){
      setMessage('The camera device is negotiating a new stream. Stay on this screen.');
     }
    }else setMessage('Waiting for approval on the camera device.');
    if(!status.signal&&rtc.current){rtc.current.close();rtc.current=null;signal({type:'reset'});signalSeen.current='';setMessage('The camera device is not sharing video.');}
    if(status.signal){
     const key=signalKey(status.signal,status.signal_generation);
     if(key!==signalSeen.current){
      let description:RTCSessionDescriptionInit|null=null;
      try{description=JSON.parse(status.signal) as RTCSessionDescriptionInit;}catch{description=null;}
      if(description?.type==='offer'){
       signalSeen.current=key;
       rtc.current?.close();
       const generation=status.signal_generation??0;
       const pc=new RTCPeerConnection(iceConfiguration());
       rtc.current=pc;signal({type:'track'});
       pc.ontrack=event=>{
        const target=video.current;if(!target)return;
        target.srcObject=event.streams[0]??new MediaStream([event.track]);
        event.track.onmute=()=>signal({type:'stall'});
        event.track.onended=()=>signal({type:'track-ended'});
        void target.play().catch(()=>signal({type:'autoplay-blocked'}));
       };
       pc.onconnectionstatechange=()=>{if(rtc.current!==pc)return;signal({type:'connection',state:pc.connectionState});};
       window.clearTimeout(connectTimer);
       connectTimer=window.setTimeout(()=>{if(rtc.current===pc&&pc.connectionState!=='connected'){signal({type:'connection',state:'failed'});setMessage(connectionFailureCopy(iceConfiguration()));}},RTC_DEFAULTS.connectTimeoutMs);
       try{
        await pc.setRemoteDescription(description);await pc.setLocalDescription(await pc.createAnswer());await waitIce(pc);
        window.clearTimeout(connectTimer);
        if(disposed)return;
        await pairRequest(pair,'/signal','PUT',{description:JSON.stringify(pc.localDescription),generation});
       }catch(error){
        if(rtc.current===pc){pc.close();rtc.current=null;signal({type:'connection',state:'failed'});}
        setMessage(connectionFailureCopy(iceConfiguration()));
       }
      }
     }
    }
   }catch(error){
    if(disposed)return;
    setStale(true);setMessage((error as Error).message);
    player.current?.command('pause');
    rtc.current?.close();rtc.current=null;signal({type:'reset'});
   }finally{
    inFlight=false;
    if(!disposed)timer=window.setTimeout(()=>void poll(),300);
   }
  };
  pollRef.current=()=>void poll();
  void poll();
  return()=>{disposed=true;clearTimeout(timer);window.clearTimeout(connectTimer);void pairRequest(pair,'','DELETE',{},true).catch(()=>{});rtc.current?.close();rtc.current=null;};
 },[pair]);

 // Project the capture device's authoritative clock forward between snapshots.
 useEffect(()=>{
  let frame=0;
  const tick=()=>{
   frame=requestAnimationFrame(tick);
   const playback=player.current,current=anchor.current;
   if(!playback||!current)return;
   if(last.current&&performance.now()-last.current>2500){playback.command('pause');setStale(true);return;}
   const elapsed=(performance.now()-current.received)/1000,value=current.value;
   playback.state.index=value.index;playback.state.speed=value.speed;
   playback.state.time=Math.min(value.end,value.time+(value.playing?(elapsed+current.age)*value.speed:0));
   playback.state.playing=value.playing;
  };
  tick();return()=>cancelAnimationFrame(frame);
 },[]);

 // The positioning guide is drawn from source-normalised geometry through the
 // same contain-fit that places the video, so it cannot drift into the margins.
 const setupPhase=remote?.setup_phase??null;
 const presentation=setupPresentation(setupPhase);
 useEffect(()=>{
  if(presentation!=='takeover')return;
  let frame=0;
  const draw=()=>{
   frame=requestAnimationFrame(draw);
   const host=pane.current,rect=guide.current,element=video.current,value=remoteRef.current;
   if(!host||!rect)return;
   const width=host.clientWidth,height=host.clientHeight;
   const sourceWidth=element?.videoWidth||value?.source_width||0,sourceHeight=element?.videoHeight||value?.source_height||0;
   if(width<2||height<2||sourceWidth<=0||sourceHeight<=0){rect.style.display='none';return;}
   const transform=containedTransform(sourceWidth,sourceHeight,width,height,cameraMirror);
   const box=value?.guide??guideBox({videoWidth:sourceWidth,videoHeight:sourceHeight});
   const mapped=rectForBox(transform,box);
   rect.style.display='';
   rect.setAttribute('x',String(mapped.x));rect.setAttribute('y',String(mapped.y));
   rect.setAttribute('width',String(mapped.width));rect.setAttribute('height',String(mapped.height));
  };
  frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
 },[presentation,cameraMirror]);

 const commandSequence=useRef(0),sending=useRef(false);
 const control=async(action:PracticeAction)=>{
  if(!pair||!approved||stale||sending.current)return;
  sending.current=true;
  // Only advance the sequence once the server accepted the command, so a failed
  // send cannot leave a permanent gap that every later command would trip over.
  const sequence=commandSequence.current+1;
  try{await pairRequest(pair,'/commands','POST',{id:crypto.randomUUID(),sequence,epoch:1,action});commandSequence.current=sequence;}
  catch(error){setMessage((error as Error).message);}
  finally{sending.current=false;}
 };
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.target instanceof HTMLInputElement||event.target instanceof HTMLButtonElement||!approved||stale)return;
   const commands:Record<string,PracticeAction>={' ':'resume',p:'pause',r:'again',ArrowRight:'next',ArrowLeft:'back'};
   if(commands[event.key]){event.preventDefault();void control(commands[event.key]);}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 });

 const showCamera=useCallback(()=>{
  const target=video.current;if(!target)return;
  signal({type:'metadata'});
  void target.play().then(()=>signal({type:'frame'})).catch(()=>setMessage('Your browser needs a tap on the picture before it can play it.'));
 },[]);

 const toggleFullscreen=useCallback(()=>{
  const element=stage.current;if(!element)return;
  if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});
  else void element.requestFullscreen?.().catch(()=>setMessage('Fullscreen is unavailable here. Practice still fits this window.'));
 },[]);

 const layout=compareLayout(measured.width,measured.height,{takeover:presentation==='takeover'});
 const takeover=layout.takeover;
 const framing:PracticeFraming={active:false,calibrating:false,calibration:null,videoWidth:remote?.source_width||16,videoHeight:remote?.source_height||9,mirrored:false,mirrorReference:remote?.model_mirror??false,composite:false,position:.23,opacity:1,angle:remote?.angle??0};
 const progress=setupProgress(setupPhase,remote?.setup_progress??0);
 const gridStyle=takeover
  ? {gridTemplateColumns:'minmax(0,1fr)'}
  : layout.axis==='columns'
   ? {gridTemplateColumns:`minmax(0,${layout.cameraShare}fr) minmax(0,${layout.instructorShare}fr)`}
   : {gridTemplateRows:`minmax(0,${layout.cameraShare}fr) minmax(0,${layout.instructorShare}fr)`};
 const canControl=approved&&!stale;
 const status=stale?'Display not responding':displayLabel(approved,pending,media);
 const retryMedia=()=>{pollRef.current?.();if(media==='interrupted')showCamera();};

 return <section ref={stage} className="mimic-shell large-display receiver-shell" aria-label="Paired practice display">
  <header className="receiver-header">
   <button onClick={onBack}>Exit</button>
   <div className="receiver-title"><strong>Practice display</strong><span role="status">{status}</span></div>
   {typeof document!=='undefined'&&document.fullscreenEnabled&&<button onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen?'Exit fullscreen':'Fullscreen'}</button>}
  </header>

  <main className="receiver-stage">
   {!pair?<form className="receiver-entry" onSubmit={event=>{event.preventDefault();setBusy(true);request<Pair>('/mimic-pairs/claim','POST',{code:code.replace(/\s/g,'').toUpperCase()}).then(setPair).catch(error=>setMessage(error.message)).finally(()=>setBusy(false));}}>
     <label>Connection code<input value={code} maxLength={12} inputMode="text" autoComplete="off" onChange={event=>setCode(event.target.value)} required pattern="[a-fA-F0-9]{12}"/></label>
     <button disabled={busy||!!pair}>{busy?'Connecting…':pair?'Waiting for approval':'Connect'}</button>
   </form>
   :<div ref={compare} className="receiver-compare" data-axis={layout.axis} data-takeover={takeover} style={gridStyle}>
     <div ref={pane} className="receiver-pane receiver-camera-pane" data-media={media}>
      <video ref={video} muted playsInline className={cameraMirror?'receiver-video mirrored':'receiver-video'} onLoadedMetadata={()=>signal({type:'metadata'})} onPlaying={()=>signal({type:'metadata'})} onEnded={()=>signal({type:'track-ended'})}/>
      {takeover&&<svg className="receiver-guide" aria-hidden="true"><rect ref={guide}/></svg>}
      {media!=='live'&&<div className="receiver-media-placeholder" role="status"><strong>{mediaLabel(media)}</strong>{media!=='starting'&&<p>{stale?'Waiting for the camera device to respond.':message}</p>}{media==='failed'&&<p className="small">{connectionFailureCopy(iceConfiguration())}</p>}</div>}
      {media==='interrupted'&&<button className="receiver-show-camera" onClick={showCamera}>Show camera</button>}
      {takeover&&<div className="receiver-setup" role="status">
        <p className="receiver-setup-headline">{setupHeadline(setupPhase)}</p>
        {remote?.setup_hint_code?<p className="receiver-setup-hint">{setupHintCopy(remote.setup_hint_code)}</p>:null}
        {setupPhase==='measuring'&&<progress aria-label="Height matching progress" value={Math.round(progress*100)} max={100}/>}
        {setupPhase==='help'||setupPhase==='error'?<p className="receiver-setup-hint">Finish this step on the camera device, then continue here.</p>:null}
      </div>}
     </div>
     {lesson&&player.current&&<div className="receiver-pane receiver-instructor-pane" hidden={takeover}>
       <MotionStage lesson={lesson} player={player.current} framing={framing} fit="envelope" interactive={false}/>
       <span className="receiver-label">3D instructor</span>
     </div>}
    </div>}
   {countdown&&approved&&<div className="practice-countdown" role="status"><strong>{Math.max(1,Math.ceil(countdown.remaining))}</strong><span>{countdown.phase==='rest'?'Rest before repeating':'Get ready'}</span></div>}
  </main>

  <p className="mimic-status receiver-status" role={media==='failed'||stale?'alert':undefined}>{message}</p>

  <footer className="receiver-dock">
   <div className="mimic-transport">{(['back','resume','pause','again','next'] as PracticeAction[]).map(action=><button key={action} disabled={!canControl} onClick={()=>void control(action)}>{({back:'Previous',resume:'Start',pause:'Pause',again:'Repeat',next:'Next'} as Record<string,string>)[action]}</button>)}</div>
   <div className="receiver-recovery">
     {!canControl&&<button onClick={retryMedia}>Try again</button>}
     {media!=='live'&&media!=='off'&&<button onClick={showCamera}>Show camera</button>}
     <span className="small muted" aria-live="polite">{approved?mediaLabel(media):'Enter the code shown on the phone.'}</span>
   </div>
  </footer>
 </section>;
}
