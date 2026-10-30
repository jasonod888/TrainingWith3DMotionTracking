import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Camera,CameraOff,Mic,MicOff,SlidersHorizontal,Video} from 'lucide-react';
import {HeightCalibration,videoFit,fromMediaPipe,bestMatch,MP,LINKS,type Point,type Reference,type Calibration} from '../../../web/dist/pose.js';
import {liveHandPositions,placeHandLabels} from '../../../web/dist/hand-labels.js';
import {suggestedAvatarPosition} from '../../../web/dist/composite.js';
import {VoiceCommands} from '../../../web/dist/voice.js';
import type {Playback,Command} from '../../../packages/learning-engine/playback';
import {SourceSession} from '../../../packages/learning-engine/source-session';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {PracticeFraming} from './practice-types';
import {assetUrl} from './api';

type Mode='off'|'camera'|'recorded';
type TrackerMessage={type:string;epoch?:number;landmarks?:Point[];world?:Point[];message?:string};
export function PracticeStudio({lesson,player,onCommand,renderReference}:{lesson:LessonManifest;player:Playback;onCommand:(c:Command)=>void;renderReference:(framing:PracticeFraming)=>ReactNode}){
 const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),pane=useRef<HTMLDivElement>(null),left=useRef<HTMLSpanElement>(null),right=useRef<HTMLSpanElement>(null);
 const calibration=useRef(new HeightCalibration()).current;
 const lifetime=useRef(new SourceSession()).current;
 const resources=useRef({epoch:0,stream:null as MediaStream|null,worker:null as Worker|null,ready:false,inFlight:false,lastVideo:-1,lastSent:0,lastPose:0,frameErrors:0,mode:'off' as Mode,calibrating:false,locked:null as Calibration|null,reference:null as Reference|null,timer:0,lastScore:null as number|null,lastScoreAt:0,lastIndex:-1,lastTime:0});
 const options=useRef({facing:'user',mirrorReference:false,skeleton:true,composite:false});
 const [mode,setMode]=useState<Mode>('off'),[message,setMessage]=useState('Camera off'),[error,setError]=useState(''),[progress,setProgress]=useState(0),[score,setScore]=useState<number|null>(null),[settings,setSettings]=useState(false),[voiceState,setVoiceState]=useState('off'),[voiceError,setVoiceError]=useState('');
 const [framing,setFraming]=useState<PracticeFraming>({active:false,calibrating:false,calibration:null,videoWidth:16,videoHeight:9,mirrored:true,mirrorReference:false,composite:matchMedia('(max-width:700px)').matches,position:.23,opacity:.85});
 const voice=useRef<VoiceCommands|null>(null);
 const [voiceSupported,setVoiceSupported]=useState(false);

 const clear=useCallback(()=>{setScore(null);resources.current.lastScore=null;const c=canvas.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height);if(left.current)left.current.hidden=true;if(right.current)right.current.hidden=true;},[]);
 const stop=useCallback(()=>{
  const r=resources.current;lifetime.stop();r.epoch=lifetime.generation;r.mode='off';r.ready=false;r.inFlight=false;r.calibrating=false;r.locked=null;r.lastPose=0;r.lastVideo=-1;
  clearTimeout(r.timer);r.worker=null;r.stream=null;
  if(video.current){video.current.pause();video.current.srcObject=null;video.current.removeAttribute('src');video.current.dataset.dimensions='';video.current.load();}
  calibration.reset();player.calibrating(false);clear();setMode('off');setMessage('Camera off');setProgress(0);setFraming(value=>({...value,active:false,calibrating:false,calibration:null}));
 },[calibration,player,clear,lifetime]);
 const beginCalibration=useCallback(()=>{const r=resources.current;if(!r.ready)return;calibration.reset();r.locked=null;r.calibrating=true;player.calibrating(true);clear();setProgress(0);setMessage('Stand upright. Keep your whole body in view.');setFraming(value=>({...value,calibrating:true,calibration:null}));},[calibration,player,clear]);

 useEffect(()=>{
  const Speech=(window as unknown as {SpeechRecognition?:unknown;webkitSpeechRecognition?:unknown}).SpeechRecognition??(window as unknown as {webkitSpeechRecognition?:unknown}).webkitSpeechRecognition;
  setVoiceSupported(!!Speech);
  voice.current=new VoiceCommands({Recognition:Speech,onCommand:c=>{clear();onCommand(c);},onState:setVoiceState,onError:setVoiceError});
  const suspend=()=>{if(document.hidden){voice.current?.stop();stop();setMessage('Practice paused. Enable your camera again when ready.');}};
  const leave=()=>{voice.current?.stop();stop();};
  document.addEventListener('visibilitychange',suspend);window.addEventListener('pagehide',leave);
  return()=>{document.removeEventListener('visibilitychange',suspend);window.removeEventListener('pagehide',leave);voice.current?.stop();stop();};
 },[onCommand,stop,clear]);

 const handlePose=(data:TrackerMessage)=>{
  const r=resources.current,v=video.current,c=canvas.current,host=pane.current;if(!v||!c||!host)return;
  r.lastPose=performance.now();const image=data.landmarks,world=data.world;
  const previousScore=r.lastScore,previousScoreAt=r.lastScoreAt;clear();
  if(!image||!world||image.length<33||world.length<33){setMessage('Step back into view.');if(r.calibrating){calibration.reset();setProgress(0);}return;}
  const mirrored=r.mode==='camera'&&options.current.facing==='user';
  if(left.current&&right.current)placeHandLabels({left:left.current,right:right.current},liveHandPositions(image,v.videoWidth,v.videoHeight,host.clientWidth,host.clientHeight,mirrored),host.clientWidth,host.clientHeight);
  if(r.calibrating){
   const result=calibration.sample(image,world,performance.now());setProgress(result.progress);setMessage(result.message);
   if(result.done){r.locked={...result.value};r.calibrating=false;player.calibrating(false);setMessage('Height matched · locked');setFraming(value=>({...value,calibrating:false,calibration:{...result.value},position:suggestedAvatarPosition(result.value,'left',v.videoWidth,v.videoHeight,mirrored)}));if(r.mode==='recorded'){v.currentTime=lesson.source_start;void v.play().catch(()=>setMessage('Play the recorded test again to continue.'));}}
  }
  let joints:Record<string,number>|undefined;
  if(r.locked&&!r.calibrating&&r.reference){
   const state=player.state;
   let reference=r.reference;
   if(state.mode==='sections'&&player.current){const current=player.current;const indices=reference.times.map((t,i)=>t>=current.start&&t<=current.end?i:-1).filter(i=>i>=0);if(indices.length)reference={duration:current.end,times:indices.map(i=>reference.times[i]),keypoints:indices.map(i=>reference.keypoints[i])};}
   const result=bestMatch(fromMediaPipe(world,image),reference,state.index<0?lesson.standing_time:state.time,options.current.mirrorReference,state.playing);
   if(result){const stamp=performance.now(),dt=previousScoreAt?(stamp-previousScoreAt)/1000:.2;r.lastScore=previousScore===null?result.score:previousScore+(result.score-previousScore)*(1-Math.exp(-dt/.4));r.lastScoreAt=stamp;setScore(Math.round(r.lastScore));joints=result.joints;setMessage(r.mode==='recorded'?'Recorded test · approximate pose match':'Approximate pose match');}
   else setMessage('Keep your joints clearly visible.');
  }
  if(options.current.skeleton){
   const w=host.clientWidth,h=host.clientHeight,ratio=Math.min(devicePixelRatio,2);c.width=Math.round(w*ratio);c.height=Math.round(h*ratio);const ctx=c.getContext('2d')!;ctx.setTransform(ratio,0,0,ratio,0,0);const fit=videoFit(v.videoWidth,v.videoHeight,w,h);
   const xy=(key:string)=>{const p=image[MP[key]];return {x:fit.x+(mirrored?1-p.x:p.x)*fit.width,y:fit.y+p.y*fit.height};};
   for(const [a,b] of LINKS){if((image[MP[a]].visibility??0)<.6||(image[MP[b]].visibility??0)<.6)continue;const x=xy(a),y=xy(b);ctx.strokeStyle=joints?.[b]!==undefined&&joints[b]<55?'#ffc58a':'#d8ed9b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x.x,x.y);ctx.lineTo(y.x,y.y);ctx.stroke();}
  }
 };
 const handlePoseRef=useRef(handlePose);handlePoseRef.current=handlePose;

 const start=async(next:Exclude<Mode,'off'>)=>{
  stop();setError('');setMessage(next==='camera'?'Starting camera…':'Loading recorded test…');const r=resources.current,epoch=r.epoch;r.mode=next;setMode(next);
  try{
   if(lesson.engine!=='sam-3d-body')throw new Error('Pose comparison is not available for this lesson. You can still use the player.');
   const response=await fetch(assetUrl(lesson.landmarks.key));if(!response.ok)throw new Error('The movement comparison data could not load.');const reference=await response.json() as Reference;
   if(epoch!==r.epoch)return;
   if(!Array.isArray(reference.times)||!Array.isArray(reference.keypoints)||reference.times.length!==reference.keypoints.length||reference.keypoints.some(row=>row.length<63))throw new Error('This lesson has no compatible comparison data.');
   r.reference=reference;
   if(next==='camera'){
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access needs HTTPS or localhost.');
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:options.current.facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}});
    if(!lifetime.retain(()=>stream.getTracks().forEach(t=>t.stop()),epoch))return;r.stream=stream;video.current!.srcObject=stream;
    stream.getVideoTracks()[0].onended=()=>{stop();setError('Your camera stopped. Enable it again to continue.');};
   }else{
    if(!lesson.source_video)throw new Error('This lesson has no source video.');video.current!.src=assetUrl(lesson.source_video.key);video.current!.loop=true;
   }
   await video.current!.play();if(epoch!==r.epoch)return;
   const v=video.current!;if(next==='recorded'){v.currentTime=Math.min(lesson.source_start+lesson.standing_time,v.duration-.1);v.pause();}
   setFraming(value=>({...value,active:true,videoWidth:v.videoWidth,videoHeight:v.videoHeight,mirrored:next==='camera'&&options.current.facing==='user'}));setMessage('Loading pose tracking…');
   const worker=new Worker('/pose-worker.js');if(!lifetime.retain(()=>worker.terminate(),epoch))return;r.worker=worker;r.frameErrors=0;
   r.timer=window.setTimeout(()=>{if(epoch===r.epoch&&!r.ready){stop();setError('Pose tracking took too long to start. Try again.');}},30000);
   worker.onmessage=({data}:{data:TrackerMessage})=>{
    if(epoch!==r.epoch)return;
    if(data.type==='ready'){clearTimeout(r.timer);r.ready=true;beginCalibration();}
    if(data.type==='error'){stop();setError('Pose tracking could not start. The player still works.');}
    if(data.type==='frame-error'&&data.epoch===epoch){r.inFlight=false;clear();if(++r.frameErrors>=3){stop();setError('This browser could not track video frames. Try another supported browser.');}}
    if(data.type==='pose'&&data.epoch===epoch){r.inFlight=false;r.frameErrors=0;handlePoseRef.current(data);}
   };
   worker.onerror=()=>{if(epoch===r.epoch){stop();setError('Pose tracking stopped. Enable the camera again to retry.');}};worker.postMessage({type:'init'});
  }catch(e){if(epoch!==r.epoch)return;stop();const error=e as Error;setError(error.name==='NotAllowedError'?'Camera permission was denied. Allow access, then try again.':error.name==='NotFoundError'?'No camera was found on this device.':error.message);}
 };

 useEffect(()=>{
  let frame=0;
  const tick=async(now:number)=>{
   frame=requestAnimationFrame(time=>void tick(time));const r=resources.current,v=video.current;
   if(!v||!r.ready||r.mode==='off')return;
   if(r.lastPose&&now-r.lastPose>900){clear();setMessage('Waiting for a clear frame…');}
   if(player.state.index!==r.lastIndex||Math.abs(player.state.time-r.lastTime)>.5){clear();r.lastIndex=player.state.index;}r.lastTime=player.state.time;
   if(r.inFlight||v.readyState<2||(v.currentTime===r.lastVideo&&!(r.mode==='recorded'&&r.calibrating))||now-r.lastSent<70)return;
   const dims=`${v.videoWidth}x${v.videoHeight}`;
   if(v.dataset.dimensions&&v.dataset.dimensions!==dims){r.locked=null;r.calibrating=false;calibration.reset();player.calibrating(false);clear();setMessage('Camera view changed. Match your height again.');setFraming(value=>({...value,calibration:null,calibrating:false,videoWidth:v.videoWidth,videoHeight:v.videoHeight}));}v.dataset.dimensions=dims;
   r.inFlight=true;r.lastSent=now;r.lastVideo=v.currentTime;const epoch=r.epoch;
   try{const bitmap=await createImageBitmap(v);if(epoch!==r.epoch||!r.worker){bitmap.close();return;}r.worker.postMessage({type:'frame',bitmap,timestamp:now,epoch},[bitmap]);}
   catch{if(epoch===r.epoch){r.inFlight=false;clear();if(++r.frameErrors>=3){stop();setError('This browser could not read video frames. The player still works.');}}}
  };frame=requestAnimationFrame(time=>void tick(time));return()=>cancelAnimationFrame(frame);
 },[calibration,player,clear,stop]);

 const active=mode!=='off';
 return <div className="practice-studio">
  <div className={`practice-stage-grid ${active?'camera-active':''} ${active&&framing.composite?'is-composite':''}`}>
   <div className="camera-pane" ref={pane} hidden={!active}><video ref={video} muted playsInline className={mode==='camera'&&options.current.facing==='user'?'mirrored':''}/><canvas ref={canvas} aria-hidden="true"/><span ref={left} className="hand-label" hidden>L</span><span ref={right} className="hand-label" hidden>R</span><span className="camera-tag">{mode==='recorded'?'RECORDED TEST':'YOU'}</span>{framing.calibrating&&<div className="calibration-card" role="status"><span>{message}</span><progress aria-label="Height calibration" value={progress} max={1}/></div>}</div>
   <div className="reference-pane">{renderReference(framing)}</div>
  </div>
  <div className="practice-tools"><button className="secondary" onClick={()=>active?stop():void start('camera')}>{active?<CameraOff size={17}/>:<Camera size={17}/>}<span>{active?'Camera off':'Enable camera'}</span></button><button className="secondary" disabled={!voiceSupported} aria-pressed={voiceState!=='off'} onClick={()=>{setVoiceError('');if(voice.current?.enabled)voice.current.stop();else if(window.confirm('Voice uses your browser’s speech service, which may send audio online. Enable voice commands?'))voice.current?.start();}}>{voiceState==='off'?<Mic size={17}/>:<MicOff size={17}/>}<span>{voiceState==='off'?'Voice':voiceState==='listening'?'Listening':'Voice on'}</span></button><button className="round" aria-label="Camera and voice settings" aria-expanded={settings} onClick={()=>setSettings(!settings)}><SlidersHorizontal size={18}/></button>{active&&<span className="pose-score" aria-label="Approximate pose similarity">{score===null?'—':`${score}%`}<small>pose match</small></span>}</div>
  {active&&<p className="tracking-status" role="status">{message}</p>}{(error||voiceError)&&<p className="inline-notice error-notice" role="alert">{error||voiceError}</p>}
  {settings&&<div className="settings-panel camera-settings"><label>View<select value={framing.composite?'composite':'comparison'} onChange={e=>{const composite=e.target.value==='composite';options.current.composite=composite;setFraming(value=>({...value,composite}));clear();}}><option value="comparison">Side by side</option><option value="composite">Together in one view</option></select></label><label>Camera<select value={options.current.facing} onChange={e=>{stop();options.current.facing=e.target.value;setMessage('Enable the selected camera when ready.');}}><option value="user">Front</option><option value="environment">Back</option></select></label><label>Mirror reference<input type="checkbox" checked={framing.mirrorReference} onChange={e=>{options.current.mirrorReference=e.target.checked;setFraming(value=>({...value,mirrorReference:e.target.checked}));clear();}}/></label><label>Skeleton<input type="checkbox" defaultChecked onChange={e=>{options.current.skeleton=e.target.checked;clear();}}/></label><label>Reference opacity<input type="range" aria-label="Reference opacity" min={.25} max={1} step={.05} value={framing.opacity} onChange={e=>setFraming(value=>({...value,opacity:Number(e.target.value)}))}/></label>{framing.composite&&<label>Reference position<input type="range" aria-label="Reference position" min={.05} max={.95} step={.01} value={framing.position} onChange={e=>setFraming(value=>({...value,position:Number(e.target.value)}))}/></label>}<div className="practice-tools"><button className="secondary" disabled={!active} onClick={beginCalibration}>Match height</button>{lesson.source_video&&<button className="secondary" onClick={()=>void start('recorded')}><Video size={16}/>Recorded test</button>}</div><p className="small muted">Pose match is approximate, not technique coaching. Camera frames stay on this device.</p><p className="small muted">Voice uses your browser’s speech service and may send audio online. Buttons always work.</p>{!voiceSupported&&<p className="small muted">Voice recognition is unavailable in this browser.</p>}</div>}
 </div>;
}
