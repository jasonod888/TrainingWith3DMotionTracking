import {forwardRef,useImperativeHandle,useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {PracticePanel} from './PracticePanel';
import {HeightCalibration,fromMediaPipe,bestMatch,MP,LINKS,type Point,type Reference,type Calibration} from '../../../web/dist/pose.js';
import {placeHandLabels} from '../../../web/dist/hand-labels.js';
import {CameraFramingController,FRAMING_DEFAULTS,handPositionsForTransform,mapSourcePoint,type DisplayTransform} from './camera-framing';
import {suggestedAvatarPosition} from '../../../web/dist/composite.js';
import {VoiceCommands} from '../../../web/dist/voice.js';
import type {Playback} from '../../../packages/learning-engine/playback';
import type {PracticeAction} from '../../../packages/learning-engine/practice-session';
import {SourceSession} from '../../../packages/learning-engine/source-session';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {PracticeFraming} from './practice-types';
import {assetUrl} from './api';

type Mode='off'|'camera'|'recorded';
type TrackerMessage={type:string;epoch?:number;landmarks?:Point[];world?:Point[];message?:string;timestamp?:number};
export type CameraState='off'|'starting'|'live';
export type MimicHandle={start:()=>Promise<void>;stop:()=>void;stream:()=>MediaStream|null;configuration:()=>string;display:()=>{model_mirror:boolean;camera_mirror:boolean};readiness:(remote:boolean)=>string;scoringIssue:()=>string};
export const MimicInterface=forwardRef<MimicHandle,{lesson:LessonManifest;player:Playback;onCommand:(c:PracticeAction)=>void;renderReference:(framing:PracticeFraming)=>ReactNode;panel?:'camera'|'sound'|'feedback'|null;onClose?:()=>void;layout?:'combined'|'separate'|'instructor';angle?:number;competition?:boolean;onCameraState?:(state:CameraState)=>void;onSummary?:(value:{score:number|null;cue:string;coverage:number})=>void}>(function MimicInterface({lesson,player,onCommand,renderReference,panel=null,onClose=()=>{},layout='separate',angle=0,competition=false,onSummary,onCameraState},ref){
 const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),pane=useRef<HTMLDivElement>(null),frame=useRef<HTMLDivElement>(null),left=useRef<HTMLSpanElement>(null),right=useRef<HTMLSpanElement>(null);
 const framingController=useRef(new CameraFramingController()).current;
 const displayHandle=useRef<{current:DisplayTransform|null}>({current:null});
 const latestPose=useRef<{image:Point[];timestamp:number}|null>(null),latestJoints=useRef<Record<string,number>|undefined>(undefined);
 const [autoFrame,setAutoFrame]=useState(true),autoFrameRef=useRef(autoFrame);autoFrameRef.current=autoFrame;
 const calibration=useRef(new HeightCalibration()).current;
 const lifetime=useRef(new SourceSession()).current;
 const resources=useRef({epoch:0,stream:null as MediaStream|null,worker:null as Worker|null,ready:false,inFlight:false,lastVideo:-1,lastSent:0,lastPose:0,frameErrors:0,mode:'off' as Mode,calibrating:false,locked:null as Calibration|null,reference:null as Reference|null,timer:0,lastScore:null as number|null,lastScoreAt:0,lastIndex:-1,lastTime:0,lastInvalidAt:0});
 const options=useRef({facing:'user',deviceId:'',mirrorPreview:true,mirrorReference:false,skeleton:true,composite:false,angle:0});options.current.angle=angle;
 const [mode,setMode]=useState<Mode>('off'),[message,setMessage]=useState('Camera off'),[error,setError]=useState(''),[progress,setProgress]=useState(0),[score,setScore]=useState<number|null>(null),[voiceState,setVoiceState]=useState('off'),[voiceError,setVoiceError]=useState('');
 const [devices,setDevices]=useState<MediaDeviceInfo[]>([]),[cameraPage,setCameraPage]=useState(0),[lastCommand,setLastCommand]=useState(''),[cue,setCue]=useState(''),[feedback,setFeedback]=useState(true),[voiceConsent,setVoiceConsent]=useState(false);
 const [controlsConfirmed,setControlsConfirmed]=useState(false);
 const summaryCallback=useRef(onSummary);summaryCallback.current=onSummary;
 const cameraCallback=useRef(onCameraState);cameraCallback.current=onCameraState;
 const cueState=useRef({key:'',since:0,shown:''});
 const messageRef=useRef('');messageRef.current=message;
 const framingHint=useRef('');
 const [framing,setFraming]=useState<PracticeFraming>({active:false,calibrating:false,calibration:null,videoWidth:16,videoHeight:9,mirrored:true,mirrorReference:false,composite:matchMedia('(max-width:700px)').matches,position:.23,opacity:.85,display:displayHandle.current});
 const voice=useRef<VoiceCommands|null>(null);
 const [voiceSupported,setVoiceSupported]=useState(false);
 useImperativeHandle(ref,()=>({start:()=>start('camera'),stop,stream:()=>resources.current.stream,display:()=>({model_mirror:resources.current.mode!=='off'?options.current.mirrorPreview!==options.current.mirrorReference:options.current.mirrorReference,camera_mirror:options.current.mirrorPreview}),scoringIssue:()=>resources.current.mode!=='camera'?'Use a live camera for a scored run.':!resources.current.reference?'This practice has no compatible scoring reference.':resources.current.lastScore===null||performance.now()-resources.current.lastPose>900?'Keep your whole body clearly visible before starting.':'',configuration:()=>`${resources.current.mode}:${options.current.facing}:${options.current.mirrorReference?'mirror':'same'}:${options.current.angle}`,readiness:remote=>resources.current.mode==='off'?'':!resources.current.locked?'Finish height matching before starting.':options.current.facing==='environment'&&!remote&&!controlsConfirmed&&voiceState!=='listening'?'For the rear camera, confirm your visible display and controls in Camera setup.':''}));
 useEffect(()=>{setFraming(value=>({...value,composite:layout==='combined'}));},[layout]);
 useEffect(()=>{setCameraPage(0);},[panel]);

 const clear=useCallback(()=>{setScore(null);setCue('');resources.current.lastScore=null;},[]);
 const clearOverlay=useCallback(()=>{const c=canvas.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height);if(left.current)left.current.hidden=true;if(right.current)right.current.hidden=true;},[]);
 const stop=useCallback(()=>{
  const r=resources.current;lifetime.stop();r.epoch=lifetime.generation;r.mode='off';r.ready=false;r.inFlight=false;r.calibrating=false;r.locked=null;r.lastPose=0;r.lastVideo=-1;
  clearTimeout(r.timer);r.worker=null;r.stream=null;cameraCallback.current?.('off');
  framingController.reset();framingController.setPaused(false);framingHint.current='';displayHandle.current.current=null;latestPose.current=null;latestJoints.current=undefined;clearOverlay();
  if(video.current){video.current.pause();video.current.srcObject=null;video.current.removeAttribute('src');video.current.dataset.dimensions='';video.current.load();}
  calibration.reset();player.calibrating(false);onCommand('pause');clear();setMode('off');setMessage('Camera off');setProgress(0);setFraming(value=>({...value,active:false,calibrating:false,calibration:null}));
 },[calibration,player,clear,clearOverlay,lifetime,onCommand,framingController]);
 const beginCalibration=useCallback(()=>{const r=resources.current;if(!r.ready)return;calibration.reset();r.locked=null;r.calibrating=true;framingHint.current='';framingController.setPaused(true);player.calibrating(true);clear();setProgress(0);setMessage('Stand upright. Keep your whole body in view.');setFraming(value=>({...value,calibrating:true,calibration:null}));},[calibration,player,clear,framingController]);

 useEffect(()=>{
  const Speech=(window as unknown as {SpeechRecognition?:unknown;webkitSpeechRecognition?:unknown}).SpeechRecognition??(window as unknown as {webkitSpeechRecognition?:unknown}).webkitSpeechRecognition;
  setVoiceSupported(!!Speech);
  voice.current=new VoiceCommands({Recognition:Speech,extended:true,onCommand:c=>{clear();setLastCommand(c);onCommand(c);},onState:setVoiceState,onError:setVoiceError});
  const suspend=()=>{if(document.hidden){voice.current?.stop();stop();setMessage('Practice paused. Enable your camera again when ready.');}};
  const leave=()=>{voice.current?.stop();stop();};
  document.addEventListener('visibilitychange',suspend);window.addEventListener('pagehide',leave);
  return()=>{document.removeEventListener('visibilitychange',suspend);window.removeEventListener('pagehide',leave);voice.current?.stop();stop();};
 },[onCommand,stop,clear]);

 const handlePose=(data:TrackerMessage)=>{
  const r=resources.current,v=video.current;if(!v)return;
  r.lastPose=performance.now();const image=data.landmarks,world=data.world,frameTime=typeof data.timestamp==='number'?data.timestamp:performance.now();
  const previousScore=r.lastScore,previousScoreAt=r.lastScoreAt;clear();
  if(!image||!world||image.length<33||world.length<33){latestPose.current=null;latestJoints.current=undefined;summaryCallback.current?.({score:null,cue:'',coverage:0});setMessage('Step back into view.');if(r.calibrating){calibration.reset();setProgress(0);}framingController.observe(null,frameTime,r.epoch);return;}
  latestPose.current={image,timestamp:frameTime};
  const mirrored=r.mode==='camera'&&options.current.mirrorPreview;
  if(r.calibrating){
   const result=calibration.sample(image,world,performance.now());setProgress(result.progress);setMessage(result.message);
   if(result.done){r.locked={...result.value};r.calibrating=false;framingHint.current='';framingController.setPaused(false);player.calibrating(false);setMessage('Height matched · locked');setFraming(value=>({...value,calibrating:false,calibration:{...result.value},position:suggestedAvatarPosition(result.value,'left',v.videoWidth,v.videoHeight,mirrored)}));if(r.mode==='recorded'){v.currentTime=lesson.source_start;void v.play().catch(()=>setMessage('Play the recorded test again to continue.'));}}
  }
  let joints:Record<string,number>|undefined;
  if(r.locked&&!r.calibrating&&r.reference&&options.current.angle===0){
   const state=player.state;
   let reference=r.reference;
   if(state.mode==='sections'&&player.current){const current=player.current;const indices=reference.times.map((t,i)=>t>=current.start&&t<=current.end?i:-1).filter(i=>i>=0);if(indices.length)reference={duration:current.end,times:indices.map(i=>reference.times[i]),keypoints:indices.map(i=>reference.keypoints[i])};}
   const result=bestMatch(fromMediaPipe(world,image),reference,state.index<0?lesson.standing_time:state.time,options.current.mirrorReference,state.playing);
   if(result){const stamp=performance.now(),dt=previousScoreAt?(stamp-previousScoreAt)/1000:.2;r.lastScore=previousScore===null?result.score:previousScore+(result.score-previousScore)*(1-Math.exp(-dt/.4));r.lastScoreAt=stamp;setScore(Math.round(r.lastScore));joints=result.joints;setMessage(competition?'Tracking clearly':r.mode==='recorded'?'Recorded test · approximate pose match':'Tracking clearly · approximate similarity');
    const names:Record<string,string>={le:'left elbow',re:'right elbow',ls:'left shoulder',rs:'right shoulder',lh:'left hip',rh:'right hip',lk:'left knee',rk:'right knee'};
    const worst=Object.entries(result.joints).sort((a,b)=>a[1]-b[1])[0];const key=worst&&worst[1]<55?worst[0]:'';if(cueState.current.key!==key)cueState.current={key,since:stamp,shown:cueState.current.shown};
    if(stamp-cueState.current.since>1000){cueState.current.shown=key?`Compare your ${names[key]??'position'} with the instructor.`:'';setCue(cueState.current.shown);}
    summaryCallback.current?.({score:competition?result.score:Math.round(r.lastScore),cue:cueState.current.shown,coverage:Object.keys(result.joints).length/8});
   }
   else {summaryCallback.current?.({score:null,cue:'',coverage:0});setMessage('Keep your joints clearly visible.');}
  }
  latestJoints.current=joints;
  const update=framingController.observe(image,frameTime,r.epoch);
  if(!r.calibrating){
   if(update.hint){framingHint.current=update.hint;messageRef.current=update.hint;setMessage(update.hint);}
   else if(framingHint.current&&messageRef.current===framingHint.current){framingHint.current='';const next=r.locked?'Tracking clearly · approximate similarity':'Stand upright. Keep your whole body in view.';messageRef.current=next;setMessage(next);}
   else if(!update.hint)framingHint.current='';
  }
 };
 const handlePoseRef=useRef(handlePose);handlePoseRef.current=handlePose;

 const start=async(next:Exclude<Mode,'off'>)=>{
  stop();player.calibrating(true);setError('');setMessage(next==='camera'?'Starting camera…':'Loading recorded test…');const r=resources.current,epoch=r.epoch;r.mode=next;setMode(next);cameraCallback.current?.('starting');
  try{
   if(lesson.engine==='sam-3d-body'){
   const response=await fetch(assetUrl(lesson.landmarks.key));if(!response.ok)throw new Error('The movement comparison data could not load.');const reference=await response.json() as Reference;
   if(epoch!==r.epoch)return;
   if(!Array.isArray(reference.times)||!Array.isArray(reference.keypoints)||reference.times.length!==reference.keypoints.length||reference.keypoints.some(row=>row.length<63))throw new Error('This lesson has no compatible comparison data.');
   r.reference=reference;
   }else r.reference=null;
   if(next==='camera'){
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access needs HTTPS or localhost.');
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(options.current.deviceId?{deviceId:{exact:options.current.deviceId}}:{facingMode:{ideal:options.current.facing}}),width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}});
    if(!lifetime.retain(()=>stream.getTracks().forEach(t=>t.stop()),epoch))return;r.stream=stream;video.current!.srcObject=stream;
    const track=stream.getVideoTracks()[0],actual=track.getSettings().facingMode;if(actual)options.current.facing=actual;
    options.current.mirrorPreview=actual?actual==='user':options.current.facing==='user';
    setDevices((await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='videoinput'));
    track.onended=()=>{stop();setError('Your camera stopped. Enable it again to continue.');};
   }else{
    if(!lesson.source_video)throw new Error('This lesson has no source video.');video.current!.src=assetUrl(lesson.source_video.key);video.current!.loop=true;
   }
   await video.current!.play();if(epoch!==r.epoch)return;
   const v=video.current!;if(next==='recorded'){v.currentTime=Math.min(lesson.source_start+lesson.standing_time,v.duration-.1);v.pause();}
   setFraming(value=>({...value,active:true,videoWidth:v.videoWidth,videoHeight:v.videoHeight,mirrored:next==='camera'&&options.current.mirrorPreview}));setMessage('Loading pose tracking…');
   if(next==='camera')cameraCallback.current?.('live');
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
   if(r.lastPose&&now-r.lastPose>900){clear();if(now-r.lastInvalidAt>250){summaryCallback.current?.({score:null,cue:'',coverage:0});r.lastInvalidAt=now;}setMessage('Waiting for a clear frame…');}
   if(player.state.index!==r.lastIndex||Math.abs(player.state.time-r.lastTime)>.5){clear();r.lastIndex=player.state.index;}r.lastTime=player.state.time;
   if(r.inFlight||v.readyState<2||(v.currentTime===r.lastVideo&&!(r.mode==='recorded'&&r.calibrating))||now-r.lastSent<70)return;
   const dims=`${v.videoWidth}x${v.videoHeight}`;
   if(v.dataset.dimensions&&v.dataset.dimensions!==dims){r.locked=null;r.calibrating=false;framingController.setPaused(false);framingController.reset();calibration.reset();player.calibrating(false);onCommand('pause');clear();setMessage('Camera view changed. Match your height again.');setFraming(value=>({...value,calibration:null,calibrating:false,videoWidth:v.videoWidth,videoHeight:v.videoHeight}));}v.dataset.dimensions=dims;
   r.inFlight=true;r.lastSent=now;r.lastVideo=v.currentTime;const epoch=r.epoch;
   try{const bitmap=await createImageBitmap(v);if(epoch!==r.epoch||!r.worker){bitmap.close();return;}r.worker.postMessage({type:'frame',bitmap,timestamp:now,epoch},[bitmap]);}
   catch{if(epoch===r.epoch){r.inFlight=false;clear();if(++r.frameErrors>=3){stop();setError('This browser could not read video frames. The player still works.');}}}
  };frame=requestAnimationFrame(time=>void tick(time));return()=>cancelAnimationFrame(frame);
 },[calibration,player,clear,stop,framingController]);

 // One animation loop owns the display transform: video, pose skeleton,
 // joint dots and hand labels all consume the same interpolated crop.
 useEffect(()=>{
  if(mode==='off')return;
  let request=0;
  const draw=(now:number)=>{
   request=requestAnimationFrame(draw);
   const v=video.current,c=canvas.current,host=pane.current,wrap=frame.current;
   if(!v||!c||!host||!wrap||!v.videoWidth||!v.videoHeight)return;
   const width=host.clientWidth,height=host.clientHeight;if(width<2||height<2)return;
   const r=resources.current;
   if(r.ready&&r.lastPose&&now-r.lastPose>900)framingController.markStale();
   const supported=layout==='separate'&&r.mode==='camera'&&options.current.facing==='user';
   framingController.configure({sourceWidth:v.videoWidth,sourceHeight:v.videoHeight,paneWidth:width,paneHeight:height,epoch:r.epoch,enabled:autoFrameRef.current,supported,paused:r.calibrating,mirrored:r.mode==='camera'&&options.current.mirrorPreview});
   const transform=framingController.sample(now);displayHandle.current.current=transform;
   wrap.style.left=`${transform.destination.x}px`;wrap.style.top=`${transform.destination.y}px`;wrap.style.width=`${transform.destination.width}px`;wrap.style.height=`${transform.destination.height}px`;
   const flip=transform.mirrored?'scaleX(-1)':'none';if(wrap.style.transform!==flip)wrap.style.transform=flip;
   v.style.left=`${-transform.crop.x*transform.scale}px`;v.style.top=`${-transform.crop.y*transform.scale}px`;v.style.width=`${transform.sourceWidth*transform.scale}px`;v.style.height=`${transform.sourceHeight*transform.scale}px`;
   const ratio=Math.min(devicePixelRatio||1,2);
   if(c.width!==Math.round(width*ratio)||c.height!==Math.round(height*ratio)){c.width=Math.round(width*ratio);c.height=Math.round(height*ratio);}
   const ctx=c.getContext('2d');if(!ctx)return;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
   const pose=latestPose.current;
   // A stopped pose stream must not leave the last skeleton and hand labels
   // frozen on a later camera image.
   const image=pose&&now-pose.timestamp<=FRAMING_DEFAULTS.lossMs?pose.image:undefined;
   if(options.current.skeleton&&image){
    const joints=latestJoints.current;
    for(const [a,b] of LINKS){const pa=image[MP[a]],pb=image[MP[b]];if((pa?.visibility??0)<FRAMING_DEFAULTS.visibilityThreshold||(pb?.visibility??0)<FRAMING_DEFAULTS.visibilityThreshold)continue;const p1=mapSourcePoint(transform,pa),p2=mapSourcePoint(transform,pb);ctx.strokeStyle=!competition&&joints?.[b]!==undefined&&joints[b]<55?'#ffc58a':'#d8ed9b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();}
   }
   if(left.current&&right.current)placeHandLabels({left:left.current,right:right.current},handPositionsForTransform(image,transform,FRAMING_DEFAULTS.visibilityThreshold),width,height);
  };
  request=requestAnimationFrame(draw);
  return()=>cancelAnimationFrame(request);
 },[mode,layout,competition,framingController]);

 const autoFrameSupported=layout==='separate'&&mode!=='recorded'&&options.current.facing==='user';
 const active=mode!=='off';
 const close=onClose;
 return <div className={`practice-studio layout-${layout}`} aria-label="Mimic interface">
  <div className={`practice-stage-grid ${active?'camera-active':''} ${active&&layout==='combined'?'is-composite':''}`}>
   <div className="camera-pane" ref={pane} hidden={!active}><div className="camera-frame" ref={frame}><video ref={video} muted playsInline/></div><canvas ref={canvas} aria-hidden="true"/><span ref={left} className="hand-label" hidden>L</span><span ref={right} className="hand-label" hidden>R</span><span className="camera-tag">{mode==='recorded'?'RECORDED TEST':'YOU'}</span>{framing.calibrating&&<div className="calibration-card" role="status"><span>{message}</span><progress aria-label="Height calibration" value={progress} max={1}/></div>}</div>
   <div className="reference-pane">{renderReference(framing)}</div>
  </div>
  <div className="practice-tracking" role={error||voiceError?'alert':undefined} aria-live={error||voiceError?'assertive':'off'}>{error||voiceError|| (active?angle!==0?'Observation angle · comparison paused':message:'Camera off · watch freely')}{!competition&&feedback&&active&&score!==null&&<span> · {score}% similarity</span>}{!competition&&feedback&&active&&cue&&<span> · {cue}</span>}</div>
  {panel&&<PracticePanel title={panel==='sound'?'Sound & voice':panel==='feedback'?'Feedback':'Camera setup'} onClose={close}>
   {panel==='camera'&&<>
    {cameraPage===0&&<><p>Practice shows your live camera. Video is captured only when you choose Record practice.</p><button onClick={()=>{if(active)stop();else void start('camera');}}>{active?'End practice':'Start practice'}</button><label>Camera<select value={options.current.deviceId||options.current.facing} onChange={e=>{stop();const value=e.target.value;setControlsConfirmed(false);options.current.deviceId=value==='user'||value==='environment'?'':value;if(!options.current.deviceId)options.current.facing=value;setMessage('Camera changed. Enable it to check your position.');}}><option value="user">Front camera</option><option value="environment">Rear camera</option>{devices.map((device,i)=><option key={device.deviceId} value={device.deviceId}>{device.label||`Camera ${i+1}`}</option>)}</select></label><label>Auto-frame me<input type="checkbox" disabled={!autoFrameSupported} checked={autoFrame} onChange={e=>{const next=e.target.checked;setAutoFrame(next);autoFrameRef.current=next;setMessage(next?'Auto-frame on. Keeps you centred while leaving room to move.':'Auto-frame off · showing the complete camera image.');clear();}}/></label><p className="small muted">{autoFrameSupported?'Keeps you centred while leaving room to move.':layout!=='separate'?'Auto-framing applies to the front camera in side-by-side view.':options.current.facing==='environment'?'Auto-framing applies to the front camera in side-by-side view.':'Auto-framing applies to live front-camera practice.'}</p></>}
    {cameraPage===1&&<><label>Selfie preview<input type="checkbox" checked={options.current.mirrorPreview} onChange={e=>{options.current.mirrorPreview=e.target.checked;setFraming(value=>({...value,mirrored:e.target.checked}));clear();}}/></label><label>Follow instructor<select value={framing.mirrorReference?'mirror':'same'} onChange={e=>{options.current.mirrorReference=e.target.value==='mirror';setFraming(value=>({...value,mirrorReference:options.current.mirrorReference}));clear();}}><option value="same">Same anatomical side</option><option value="mirror">Mirror the instructor</option></select></label></>}
    {cameraPage===2&&<><p>{options.current.facing==='environment'?'Rear camera: point the lens toward you. Face a separate visible screen and establish voice or remote controls before starting.':'Place the device so your head and both feet stay visible. Stand upright for height matching.'}</p><label>I can see the instructor and operate controls<input type="checkbox" checked={controlsConfirmed} onChange={e=>setControlsConfirmed(e.target.checked)}/></label><button disabled={!active} onClick={()=>{beginCalibration();close();}}>Match height again</button>{!competition&&import.meta.env.DEV&&new URLSearchParams(location.search).get('diagnostics')==='1'&&lesson.source_video&&<button onClick={()=>{void start('recorded');close();}}>Recorded source test</button>}</>}
    {cameraPage===3&&<><label>Instructor opacity<input type="range" min={.25} max={1} step={.05} value={framing.opacity} onChange={e=>setFraming(value=>({...value,opacity:Number(e.target.value)}))}/></label><label>Instructor position<input type="range" min={.05} max={.95} step={.01} value={framing.position} onChange={e=>setFraming(value=>({...value,position:Number(e.target.value)}))}/></label></>}
    <div className="practice-pagination"><button disabled={cameraPage===0} onClick={()=>setCameraPage(cameraPage-1)}>Back</button><span>{cameraPage+1} / 4</span><button disabled={cameraPage===3} onClick={()=>setCameraPage(cameraPage+1)}>More</button></div>
   </>}
   {panel==='sound'&&<>{cameraPage===0&&<><p>Voice may send audio to your browser’s speech service.</p><label>Allow voice service<input type="checkbox" checked={voiceConsent} onChange={e=>{setVoiceConsent(e.target.checked);if(!e.target.checked)voice.current?.stop();}}/></label><button disabled={!voiceSupported||!voiceConsent} onClick={()=>{setVoiceError('');if(voice.current?.enabled)voice.current.stop();else voice.current?.start();}}>{voiceState==='off'?'Enable voice':`Voice ${voiceState} · turn off`}</button></>}{cameraPage===1&&<p>{voiceSupported?'Say: start, pause, next, back, again, slower, faster, loop.':'Speech is unavailable here. Use touch, keyboard or a paired screen.'} {lastCommand&&`Heard: ${lastCommand}`}</p>}<div className="practice-pagination"><button disabled={cameraPage===0} onClick={()=>setCameraPage(0)}>Back</button><span>{cameraPage+1} / 2</span><button disabled={cameraPage===1} onClick={()=>setCameraPage(1)}>More</button></div></>}
   {panel==='feedback'&&<><label>Show similarity and cues<input type="checkbox" checked={feedback} onChange={e=>setFeedback(e.target.checked)}/></label><label>Show skeleton<input type="checkbox" checked={options.current.skeleton} onChange={e=>{options.current.skeleton=e.target.checked;clear();}}/></label><p>Similarity is approximate, not technique correctness. Unclear joints are excluded. Reference motion confidence is unmeasured. Camera processing stays on this device.</p></>}
  </PracticePanel>}
 </div>;
});
