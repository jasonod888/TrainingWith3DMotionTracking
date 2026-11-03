import {forwardRef,useImperativeHandle,useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {PracticePanel} from './PracticePanel';
import {HeightCalibration,fromMediaPipe,bestMatch,MP,LINKS,type Point,type Reference,type Calibration} from '../../../web/dist/pose.js';
import {placeHandLabels} from '../../../web/dist/hand-labels.js';
import {CameraFramingController,FRAMING_DEFAULTS,handPositionsForTransform,mapSourcePoint,type DisplayTransform} from './camera-framing';
import {suggestedAvatarPosition} from '../../../web/dist/composite.js';
import {VoiceCommands} from '../../../web/dist/voice.js';
import type {CameraSetupController,SetupFailure,SetupSourceIdentity} from './camera-setup-controller';
import {DEFAULT_CALIBRATION,calibrationEnabled} from './camera-setup-policy';
import type {Playback} from '../../../packages/learning-engine/playback';
import type {PracticeAction} from '../../../packages/learning-engine/practice-session';
import {SourceSession} from '../../../packages/learning-engine/source-session';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {PracticeFraming} from './practice-types';
import {assetUrl,request} from './api';
import {localRecognition} from './local-voice';
import {CameraFailure,acquireCamera,cameraIO,listCameras,stopStream,watchCameras,type AcquiredCamera} from './camera-acquisition';
import {
  applyRequest,describeCamera,deviceLabel,facingModeFor,loadPreference,savePreference,
  type CameraDevice,type CameraRequest,type CameraSelection,
} from './camera-policy';
import type {CameraStatus} from './mimic-connection';

type Mode='off'|'camera'|'recorded';
type TrackerMessage={type:string;epoch?:number;landmarks?:Point[];world?:Point[];message?:string;timestamp?:number};
export type CameraState='off'|'starting'|'live';
export type MimicHandle={start:()=>Promise<void>;stop:()=>void;stream:()=>MediaStream|null;configuration:()=>string;display:()=>{model_mirror:boolean;camera_mirror:boolean};readiness:(remote:boolean)=>string;scoringIssue:()=>string;applyCalibration:(value:Calibration)=>void;confirmControls:()=>void;transform:()=>DisplayTransform|null;sourceIdentity:()=>SetupSourceIdentity;facing:()=>'user'|'environment';selection:()=>CameraSelection|null;cameraStatus:()=>CameraStatus;sourceGeneration:()=>number;cameras:()=>CameraDevice[];request:()=>CameraRequest;refreshCameras:()=>Promise<CameraDevice[]>;setCamera:(request:CameraRequest)=>Promise<void>};
export const MimicInterface=forwardRef<MimicHandle,{lesson:LessonManifest;player:Playback;onCommand:(c:PracticeAction)=>void;renderReference:(framing:PracticeFraming)=>ReactNode;setup?:CameraSetupController;onRequestSetup?:()=>void;panel?:'camera'|'sound'|'feedback'|null;onClose?:()=>void;layout?:'combined'|'separate'|'instructor';angle?:number;competition?:boolean;onCameraState?:(state:CameraState)=>void;onSummary?:(value:{score:number|null;cue:string;coverage:number})=>void}>(function MimicInterface({lesson,player,onCommand,renderReference,panel=null,onClose=()=>{},layout='separate',angle=0,competition=false,onSummary,onCameraState,setup,onRequestSetup},ref){
 const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),pane=useRef<HTMLDivElement>(null),frame=useRef<HTMLDivElement>(null),left=useRef<HTMLSpanElement>(null),right=useRef<HTMLSpanElement>(null);
 const framingController=useRef(new CameraFramingController()).current;
 const displayHandle=useRef<{current:DisplayTransform|null}>({current:null});
 const latestPose=useRef<{image:Point[];timestamp:number}|null>(null),latestJoints=useRef<Record<string,number>|undefined>(undefined);
 const [autoFrame,setAutoFrame]=useState(true),autoFrameRef=useRef(autoFrame);autoFrameRef.current=autoFrame;
 const calibration=useRef(new HeightCalibration()).current;
 const lifetime=useRef(new SourceSession()).current;
 const resources=useRef({epoch:0,stream:null as MediaStream|null,worker:null as Worker|null,warm:null as {worker:Worker;ready:boolean}|null,keep:null as Worker|null,ready:false,inFlight:false,lastVideo:-1,lastSent:0,lastPose:0,frameErrors:0,mode:'off' as Mode,calibrating:false,locked:null as Calibration|null,reference:null as Reference|null,timer:0,lastScore:null as number|null,lastScoreAt:0,lastIndex:-1,lastTime:0,lastInvalidAt:0,selection:null as CameraSelection|null,devices:[] as CameraDevice[],status:'off' as CameraStatus});
 // One request object plus one actual-selection record: the request is what the
 // person asked for, `selection` is what the browser actually opened. They are
 // never collapsed, so the interface can always report the honest outcome.
 const options=useRef({request:loadPreference(preferenceStore()),mirrorPreview:true,mirrorReference:false,skeleton:true,composite:false,angle:0});options.current.angle=angle;
 const [,refreshUi]=useState(0);
 const [mode,setMode]=useState<Mode>('off'),[message,setMessage]=useState('Camera off'),[error,setError]=useState(''),[progress,setProgress]=useState(0),[score,setScore]=useState<number|null>(null),[voiceState,setVoiceState]=useState('off'),[voiceError,setVoiceError]=useState('');
 const [devices,setDevices]=useState<CameraDevice[]>([]),[cameraPage,setCameraPage]=useState(0),[lastCommand,setLastCommand]=useState(''),[cue,setCue]=useState(''),[feedback,setFeedback]=useState(true),[voiceConsent,setVoiceConsent]=useState(false);
 const [controlsConfirmed,setControlsConfirmed]=useState(false);
 const summaryCallback=useRef(onSummary);summaryCallback.current=onSummary;
 const cameraCallback=useRef(onCameraState);cameraCallback.current=onCameraState;
 const cueState=useRef({key:'',since:0,shown:''});
 const messageRef=useRef('');messageRef.current=message;
 const framingHint=useRef('');
 const [framing,setFraming]=useState<PracticeFraming>({active:false,calibrating:false,calibration:null,videoWidth:16,videoHeight:9,mirrored:true,mirrorReference:false,composite:matchMedia('(max-width:700px)').matches,position:.23,opacity:.85,display:displayHandle.current});
 const voice=useRef<VoiceCommands|null>(null);
 const [voiceSupported,setVoiceSupported]=useState(false);
 const voiceCallbacks=useRef({onCommand,onClose,stop:()=>{},clear:()=>{}});
 const currentFacing=()=>{const actual=resources.current.selection?.actualFacing;return (actual&&actual!=='unknown'?actual:facingModeFor(options.current.request.facing))==='environment'?'environment':'user';};
 const setupSource=():SetupSourceIdentity=>{const r=resources.current,v=video.current,s=r.selection;return {generation:r.epoch,deviceId:s?.actualDeviceId||options.current.request.deviceId||options.current.request.facing,width:v?.videoWidth??0,height:v?.videoHeight??0};};
 const applyCalibration=useCallback((value:Calibration)=>{
  const r=resources.current,v=video.current;
  r.locked={...value};r.calibrating=false;framingHint.current='';framingController.setPaused(false);player.calibrating(false);
  const mirrored=r.mode==='camera'&&options.current.mirrorPreview;
  setMessage('Height matched · locked');
  setFraming(state=>({...state,calibrating:false,calibration:{...value},position:suggestedAvatarPosition(value,'left',v?.videoWidth??16,v?.videoHeight??9,mirrored)}));
 },[framingController,player]);
 // Server switch: no height matching. Use the default alignment so the
 // instructor, scoring and readiness behave as if setup had succeeded, while the
 // message and the recorded configuration say that it did not.
 const applyDefaultAlignment=useCallback(()=>{
  const r=resources.current;
  const value={...DEFAULT_CALIBRATION};
  r.locked=value;r.calibrating=false;framingHint.current='';
  framingController.setPaused(false);player.calibrating(false);
  setProgress(1);setMessage('Default alignment · height matching off');
  setFraming(state=>({...state,calibrating:false,calibration:value}));
 },[framingController,player]);
 const confirmControls=useCallback(()=>setControlsConfirmed(true),[]);
 useImperativeHandle(ref,()=>({start:()=>start('camera'),stop,stream:()=>resources.current.stream,display:()=>({model_mirror:resources.current.mode!=='off'?options.current.mirrorPreview!==options.current.mirrorReference:options.current.mirrorReference,camera_mirror:options.current.mirrorPreview}),scoringIssue:()=>resources.current.mode!=='camera'?'Use a live camera for a scored run.':!resources.current.reference?'This practice has no compatible scoring reference.':resources.current.lastScore===null||performance.now()-resources.current.lastPose>900?'Keep your whole body clearly visible before starting.':'',configuration:()=>`${resources.current.mode}:${currentFacing()}:${options.current.mirrorReference?'mirror':'same'}:${options.current.angle}:calibration=${calibrationEnabled()?'matched':'default'}`,readiness:remote=>resources.current.mode==='off'?'':!resources.current.locked&&calibrationEnabled()?'Finish height matching before starting.':currentFacing()==='environment'&&!remote&&!controlsConfirmed?'For the rear camera, confirm your visible display and controls in Camera setup.':'',applyCalibration,confirmControls,transform:()=>displayHandle.current.current,sourceIdentity:setupSource,facing:currentFacing,selection:()=>resources.current.selection,cameraStatus:()=>resources.current.status,sourceGeneration:()=>resources.current.epoch,cameras:()=>resources.current.devices,request:()=>options.current.request,refreshCameras:()=>refreshCameras(),setCamera:request=>setCamera(request)}));
 useEffect(()=>{setFraming(value=>({...value,composite:layout==='combined'}));},[layout]);
 useEffect(()=>{setCameraPage(0);},[panel]);

 const clear=useCallback(()=>{setScore(null);setCue('');resources.current.lastScore=null;},[]);
 const clearOverlay=useCallback(()=>{const c=canvas.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height);if(left.current)left.current.hidden=true;if(right.current)right.current.hidden=true;},[]);
 const stop=useCallback(()=>{
  const r=resources.current;lifetime.stop();r.epoch=lifetime.generation;r.mode='off';r.ready=false;r.inFlight=false;r.calibrating=false;r.locked=null;r.lastPose=0;r.lastVideo=-1;
  r.selection=null;resources.current.status='off';
  clearTimeout(r.timer);if(r.worker&&r.worker===r.keep)r.warm={worker:r.keep,ready:true};r.worker=null;r.stream=null;cameraCallback.current?.('off');
  framingController.reset();framingController.setPaused(false);framingHint.current='';displayHandle.current.current=null;latestPose.current=null;latestJoints.current=undefined;clearOverlay();
  if(video.current){video.current.pause();video.current.srcObject=null;video.current.removeAttribute('src');video.current.dataset.dimensions='';video.current.load();}
  calibration.reset();player.calibrating(false);onCommand('pause');clear();setMode('off');setMessage('Camera off');setProgress(0);setFraming(value=>({...value,active:false,calibrating:false,calibration:null}));
 },[calibration,player,clear,clearOverlay,lifetime,onCommand,framingController]);
 const beginCalibration=useCallback(()=>{const r=resources.current;if(!r.ready)return;if(!calibrationEnabled()){applyDefaultAlignment();return;}calibration.reset();r.locked=null;r.calibrating=true;framingHint.current='';framingController.setPaused(true);player.calibrating(true);clear();setProgress(0);setMessage('Stand upright. Keep your whole body in view.');setFraming(value=>({...value,calibrating:true,calibration:null}));},[calibration,player,clear,framingController,applyDefaultAlignment]);

 // One owner for camera lifetime: every stream this interface opens is retained
 // against the current source generation, and a superseded acquisition is
 // stopped rather than attached. A late stream from an older request can never
 // become the visible source.
 const acquire=async(request:CameraRequest):Promise<AcquiredCamera|null>=>{
  const r=resources.current,epoch=r.epoch;
  const result=await acquireCamera(request,cameraIO(),{devices:r.devices.length?r.devices:undefined,explicit:Boolean(request.deviceId)});
  if(!lifetime.retain(()=>stopStream(result.stream),epoch))return null;
  r.devices=result.devices.length?result.devices:r.devices;
  r.selection={requested:request,actualFacing:result.facing,actualDeviceId:result.deviceId,actualLabel:result.label,width:result.width,height:result.height,lensStatus:result.lensStatus};
  r.stream=result.stream;
  return result;
 };

 // A former track ending must not tear down its replacement.
 const attachEndedGuard=(stream:MediaStream,epoch:number)=>{
  const track=stream.getVideoTracks()[0];
  if(!track)return;
  track.onended=()=>{
   if(resources.current.epoch!==epoch)return;
   if(setup&&setup.snapshot.stage!=='prepare')setup.dispatch({type:'camera_failed',failure:'camera_ended',now:performance.now()});
   stop();resources.current.status='failed';setError('Your camera stopped. Enable it again to continue.');
  };
 };

 // Camera switch transaction: pause, bump the source generation, drop the old
 // capture, then acquire and attach the new one. Calibration never survives it.
 const reacquire=async(request:CameraRequest)=>{
  const r=resources.current;
  if(r.mode!=='camera')return;
  const now=performance.now();
  onCommand('pause');
  resources.current.status='starting';cameraCallback.current?.('starting');
  lifetime.stop();r.epoch=lifetime.generation;
  r.stream=null;r.locked=null;r.calibrating=false;r.lastPose=0;r.lastVideo=-1;r.inFlight=false;
  clearTimeout(r.timer);
  calibration.reset();framingController.reset();framingController.setPaused(false);
  displayHandle.current.current=null;latestPose.current=null;latestJoints.current=undefined;
  clearOverlay();clear();player.calibrating(!setup&&calibrationEnabled());setProgress(0);setError('');setMessage('Switching camera…');
  setFraming(value=>({...value,active:false,calibrating:false,calibration:null}));
  if(video.current){video.current.pause();video.current.srcObject=null;video.current.dataset.dimensions='';}
  if(setup&&setup.snapshot.stage!=='prepare')setup.dispatch({type:'camera_starting',now});
  const epoch=r.epoch;
  try{
   const result=await acquire(request);
   if(!result)return;
   const v=video.current!;v.srcObject=result.stream;
   options.current.mirrorPreview=result.facing==='user'||(result.facing==='unknown'&&request.facing==='front');
   attachEndedGuard(result.stream,epoch);
   await waitForVideo(v);
   if(r.epoch!==epoch)return;
   setDevices(resources.current.devices);
   setFraming(value=>({...value,active:true,videoWidth:v.videoWidth,videoHeight:v.videoHeight,mirrored:options.current.mirrorPreview}));
   resources.current.status='live';cameraCallback.current?.('live');
   setMessage(describeCamera({requested:request,actualFacing:result.facing,lensStatus:result.lensStatus}));
   refreshUi(n=>n+1);
   if(setup&&setup.snapshot.stage!=='prepare'){
    const source=setupSource();
    setup.dispatch({type:'source_changed',source,now:performance.now()});
    setup.dispatch({type:'source_resolved',source,now:performance.now()});
    setup.dispatch({type:'camera_ready',now:performance.now()});
   }else beginCalibration();
  }catch(error){
   if(r.epoch!==epoch)return;
   const failure=setupFailureFor(error);
   if(setup)setup.dispatch({type:'camera_failed',failure,now:performance.now()});
   stop();resources.current.status='failed';
   setError((error as Error).message||'The camera could not start.');
   refreshUi(n=>n+1);
  }
 };

 const refreshCameras=async():Promise<CameraDevice[]>=>{
  const devices=await listCameras(cameraIO());
  if(devices.length)resources.current.devices=devices;
  setDevices(devices.length?devices:resources.current.devices);
  return devices;
 };

 // Selecting a camera while the camera is off only records the preference; the
 // next explicit start acquires it. While live it runs the switch transaction.
 const setCamera=async(request:CameraRequest)=>{
  const next=applyRequest(request,{deviceId:request.deviceId||''});
  options.current.request=next;
  savePreference(preferenceStore(),next);
  refreshUi(n=>n+1);
  if(resources.current.mode!=='camera'){
   setMessage(next.deviceId?'Selected camera. Start practice to open it.':next.facing==='rear'?(next.lens==='prefer-wide'?'Rear camera · prefer wide view':'Rear camera'):'Front camera');
   return;
  }
  await reacquire(next);
 };

 // Labels only become readable after a grant, and devices can arrive later.
 useEffect(()=>{void refreshCameras();return watchCameras(cameraIO(),()=>{void refreshCameras();});},[]);

 voiceCallbacks.current={onCommand,onClose,stop,clear};
 useEffect(()=>{
  const Speech=(window as unknown as {SpeechRecognition?:unknown;webkitSpeechRecognition?:unknown}).SpeechRecognition??(window as unknown as {webkitSpeechRecognition?:unknown}).webkitSpeechRecognition;
  let disposed=false;
  const initialize=async()=>{
   const local=await request<{available:boolean}>('/voice/capability').catch(()=>({available:false}));
   if(disposed)return;
   const Recognition=local.available&&typeof navigator.mediaDevices?.getUserMedia==='function'&&typeof AudioWorkletNode!=='undefined'
    ?localRecognition(pcm=>request('/voice/recognize','POST',{pcm})):Speech;
   setVoiceSupported(!!Recognition);
   voice.current=new VoiceCommands({Recognition,extended:true,onCommand:c=>{voiceCallbacks.current.clear();setLastCommand(c);voiceCallbacks.current.onCommand(c);},onState:state=>{setVoiceState(state);if(state==='listening')voiceCallbacks.current.onClose();},onError:setVoiceError});
  };void initialize();
  const suspend=()=>{if(document.hidden){voice.current?.stop();voiceCallbacks.current.stop();setMessage('Practice paused. Enable your camera again when ready.');}};
  const leave=()=>{voice.current?.stop();voiceCallbacks.current.stop();};
  document.addEventListener('visibilitychange',suspend);window.addEventListener('pagehide',leave);
  return()=>{disposed=true;document.removeEventListener('visibilitychange',suspend);window.removeEventListener('pagehide',leave);voice.current?.stop();voiceCallbacks.current.stop();};
 },[]);

 // Warm the pose tracker while the person is still on the practice screen. The
 // model and WASM are about 14.6 MB (pose_landmarker_lite.task plus the vision
 // wasm), and fetching plus parsing them is most of the wait after pressing
 // Start practice. The warmed worker is adopted by the first camera start and
 // re-warmed after stop, so later starts in the same visit are immediate.
 useEffect(()=>{
  if(typeof Worker==='undefined'||!isSecureContext||!navigator.mediaDevices?.getUserMedia)return;
  let disposed=false;
  const timer=window.setTimeout(()=>{
   if(disposed)return;
   const r=resources.current;
   if(r.warm||r.keep||r.mode!=='off')return;
   const worker=new Worker('/pose-worker.js');
   const entry={worker,ready:false};
   r.warm=entry;r.keep=worker;
   const forget=()=>{entry.ready=false;if(r.warm===entry)r.warm=null;if(r.keep===worker)r.keep=null;};
   worker.onmessage=({data}:{data:TrackerMessage})=>{if(data.type==='ready')entry.ready=true;if(data.type==='error')forget();};
   worker.onerror=forget;
   worker.postMessage({type:'init'});
  },700);
  return()=>{disposed=true;window.clearTimeout(timer);const r=resources.current;const worker=r.warm?.worker??r.keep;r.warm=null;r.keep=null;worker?.terminate();};
 },[]);

 const handlePose=(data:TrackerMessage)=>{
  const r=resources.current,v=video.current;if(!v)return;
  r.lastPose=performance.now();const image=data.landmarks,world=data.world,frameTime=typeof data.timestamp==='number'?data.timestamp:performance.now();
  if(setup){setup.dispatch({type:'observation',image:image??null,world:world??null,source:setupSource(),capturedAt:frameTime,receivedAt:r.lastPose});latestPose.current=null;latestJoints.current=undefined;return;}
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
  stop();player.calibrating(!setup&&calibrationEnabled());setError('');setMessage(next==='camera'?'Starting camera…':'Loading recorded test…');const r=resources.current,epoch=r.epoch;r.mode=next;setMode(next);cameraCallback.current?.('starting');
  try{
   if(lesson.engine==='sam-3d-body'){
   const response=await fetch(assetUrl(lesson.landmarks.key));if(!response.ok)throw new Error('The movement comparison data could not load.');const reference=await response.json() as Reference;
   if(epoch!==r.epoch)return;
   if(!Array.isArray(reference.times)||!Array.isArray(reference.keypoints)||reference.times.length!==reference.keypoints.length||reference.keypoints.some(row=>row.length<63))throw new Error('This lesson has no compatible comparison data.');
   const offset=lesson.animation_start??0;
   const indices=reference.times.map((t,i)=>t>=offset-1e-6&&t<=offset+lesson.duration+1e-6?i:-1).filter(i=>i>=0);
   r.reference={duration:lesson.duration,times:indices.map(i=>reference.times[i]-offset),keypoints:indices.map(i=>reference.keypoints[i])};
   }else r.reference=null;
   if(next==='camera'){
    const result=await acquire(options.current.request);
    if(!result)return;
    const v=video.current!;v.srcObject=result.stream;
    options.current.mirrorPreview=result.facing==='user'||(result.facing==='unknown'&&options.current.request.facing==='front');
    setDevices(resources.current.devices);
    attachEndedGuard(result.stream,epoch);
    await waitForVideo(v);
    if(epoch!==r.epoch)return;
   }else{
    if(!lesson.source_video)throw new Error('This lesson has no source video.');video.current!.src=assetUrl(lesson.source_video.key);video.current!.loop=true;
   }
   await video.current!.play();if(epoch!==r.epoch)return;
   const v=video.current!;if(next==='recorded'){v.currentTime=Math.min(lesson.source_start+lesson.standing_time,v.duration-.1);v.pause();}
   setFraming(value=>({...value,active:true,videoWidth:v.videoWidth,videoHeight:v.videoHeight,mirrored:next==='camera'&&options.current.mirrorPreview}));setMessage('Loading pose tracking…');
   if(next==='camera')cameraCallback.current?.('live');
   // Adopt the tracker warmed up when this screen opened. The pose model and
   // WASM are ~14.6 MB, so paying for them at first camera start is what made
   // setup feel slow; at this point they are usually already parsed.
   const warm=r.warm&&r.warm.ready?r.warm:null;
   const worker=warm?warm.worker:new Worker('/pose-worker.js');
   if(warm){r.warm=null;r.keep=warm.worker;}else if(!lifetime.retain(()=>worker.terminate(),epoch)){return;}
   r.worker=worker;r.frameErrors=0;
   const finishInit=()=>{
    if(epoch!==r.epoch||r.ready)return;
    clearTimeout(r.timer);r.ready=true;
    if(setup){const now=performance.now();setup.dispatch({type:'source_resolved',source:setupSource(),now});setup.dispatch({type:'camera_ready',now});}else beginCalibration();
   };
   worker.onmessage=({data}:{data:TrackerMessage})=>{
    if(epoch!==r.epoch)return;
    if(data.type==='ready'){finishInit();}
    if(data.type==='error'){if(setup)setup.dispatch({type:'camera_failed',failure:'tracker_failed',now:performance.now()});stop();setError('Pose tracking could not start. The player still works.');}
    if(data.type==='frame-error'&&data.epoch===epoch){r.inFlight=false;clear();if(++r.frameErrors>=3){stop();setError('This browser could not track video frames. Try another supported browser.');}}
    if(data.type==='pose'&&data.epoch===epoch){r.inFlight=false;r.frameErrors=0;handlePoseRef.current(data);}
   };
   worker.onerror=()=>{if(epoch===r.epoch){stop();setError('Pose tracking stopped. Enable the camera again to retry.');}};
   if(warm)finishInit();
   else{r.timer=window.setTimeout(()=>{if(epoch===r.epoch&&!r.ready){stop();setError('Pose tracking took too long to start. Try again.');}},30000);worker.postMessage({type:'init'});}
  }catch(e){if(epoch!==r.epoch)return;const error=e as Error;if(setup)setup.dispatch({type:'camera_failed',failure:setupFailureFor(error),now:performance.now()});stop();r.status='failed';setError(error.message||'The camera could not start.');}
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
   if(v.dataset.dimensions&&v.dataset.dimensions!==dims){r.locked=null;r.calibrating=false;framingController.setPaused(false);framingController.reset();calibration.reset();player.calibrating(false);onCommand('pause');clear();setMessage('Camera view changed. Match your height again.');setFraming(value=>({...value,calibration:null,calibrating:false,videoWidth:v.videoWidth,videoHeight:v.videoHeight}));if(setup)setup.dispatch({type:'source_changed',source:setupSource(),now:performance.now()});}v.dataset.dimensions=dims;
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
   const supported=layout==='separate'&&r.mode==='camera'&&currentFacing()==='user';
   framingController.configure({sourceWidth:v.videoWidth,sourceHeight:v.videoHeight,paneWidth:width,paneHeight:height,epoch:r.epoch,enabled:autoFrameRef.current,supported,paused:r.calibrating||!!setup,mirrored:r.mode==='camera'&&options.current.mirrorPreview});
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
   if(options.current.skeleton&&image&&!setup){
    const joints=latestJoints.current;
    for(const [a,b] of LINKS){const pa=image[MP[a]],pb=image[MP[b]];if((pa?.visibility??0)<FRAMING_DEFAULTS.visibilityThreshold||(pb?.visibility??0)<FRAMING_DEFAULTS.visibilityThreshold)continue;const p1=mapSourcePoint(transform,pa),p2=mapSourcePoint(transform,pb);ctx.strokeStyle=!competition&&joints?.[b]!==undefined&&joints[b]<55?'#ffc58a':'#d8ed9b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();}
   }
   if(setup){if(left.current)left.current.hidden=true;if(right.current)right.current.hidden=true;}
   else if(left.current&&right.current)placeHandLabels({left:left.current,right:right.current},handPositionsForTransform(image,transform,FRAMING_DEFAULTS.visibilityThreshold),width,height);
  };
  request=requestAnimationFrame(draw);
  return()=>cancelAnimationFrame(request);
 },[mode,layout,competition,framingController,setup]);

 const autoFrameSupported=layout==='separate'&&mode!=='recorded'&&currentFacing()==='user';
 const active=mode!=='off';
 const close=onClose;
 return <div className={`practice-studio layout-${layout}`} aria-label="Mimic interface">
  <div className={`practice-stage-grid ${active?'camera-active':''} ${active&&layout==='combined'?'is-composite':''}`}>
   <div className="camera-pane" ref={pane} hidden={!active}><div className="camera-frame" ref={frame}><video ref={video} muted playsInline/></div><canvas ref={canvas} aria-hidden="true"/><span ref={left} className="hand-label" hidden>L</span><span ref={right} className="hand-label" hidden>R</span><span className="camera-tag">{mode==='recorded'?'RECORDED TEST':'YOU'}</span>{framing.calibrating&&<div className="calibration-card" role="status"><span>{message}</span><progress aria-label="Height calibration" value={progress} max={1}/></div>}</div>
   <div className="reference-pane">{renderReference(framing)}</div>
  </div>
  <div className="practice-tracking" role={error||voiceError?'alert':undefined} aria-live={error||voiceError?'assertive':'off'}>{error||voiceError|| (active?angle!==0?'Observation angle · comparison paused':message:'Camera off · watch freely')}{!competition&&feedback&&active&&score!==null&&<span> · {score}% similarity</span>}{!competition&&feedback&&active&&cue&&<span> · {cue}</span>}</div>
  {voiceState!=='off'&&<p className="small" role="status">Voice {voiceState}{lastCommand&&` · heard “${lastCommand}”`}</p>}
  {panel&&<PracticePanel title={panel==='sound'?'Sound & voice':panel==='feedback'?'Feedback':'Camera setup'} onClose={close}>
   {panel==='camera'&&<>
    {cameraPage===0&&<><p>Choose the camera before you position the phone. Video is captured only when you choose Record practice.</p><div className="practice-option-grid"><button aria-pressed={!options.current.request.deviceId&&options.current.request.facing==='front'} onClick={()=>void setCamera({...options.current.request,deviceId:'',facing:'front'})}>Front camera</button><button aria-pressed={!options.current.request.deviceId&&options.current.request.facing==='rear'} onClick={()=>void setCamera({...options.current.request,deviceId:'',facing:'rear'})}>Rear camera</button></div>{options.current.request.facing==='rear'&&!options.current.request.deviceId&&<label>Prefer wide view<input type="checkbox" checked={options.current.request.lens==='prefer-wide'} onChange={e=>void setCamera({...options.current.request,lens:e.target.checked?'prefer-wide':'default'})}/></label>}<p className="small muted">Requested: {options.current.request.deviceId?'a camera you chose':options.current.request.facing==='rear'?options.current.request.lens==='prefer-wide'?'rear · prefer wide view':'rear camera':'front camera'}.</p>{resources.current.selection&&<p className="small muted" role="status">Opened: {describeCamera(resources.current.selection)}.</p>}<button onClick={()=>{if(active)stop();else void start('camera');}}>{active?'End practice':'Start practice'}</button><label>Auto-frame me<input type="checkbox" disabled={!autoFrameSupported} checked={autoFrame} onChange={e=>{const next=e.target.checked;setAutoFrame(next);autoFrameRef.current=next;setMessage(next?'Auto-frame on. Keeps you centred while leaving room to move.':'Auto-frame off · showing the complete camera image.');clear();}}/></label><p className="small muted">{autoFrameSupported?'Keeps you centred while leaving room to move.':layout!=='separate'?'Auto-framing applies to the front camera in side-by-side view.':currentFacing()==='environment'?'Auto-framing applies to the front camera in side-by-side view.':'Auto-framing applies to live front-camera practice.'}</p></>}
    {cameraPage===1&&<><p>Cameras this browser exposes. Names come from the browser; a phone may report one logical rear camera even when it has several lenses.</p><div className="practice-option-grid"><button aria-pressed={!options.current.request.deviceId} onClick={()=>void setCamera({...options.current.request,deviceId:''})}>Automatic</button>{devices.map((device,i)=><button key={device.deviceId} aria-pressed={options.current.request.deviceId===device.deviceId} onClick={()=>void setCamera({...options.current.request,deviceId:device.deviceId})}>{deviceLabel(device,i)}</button>)}</div><button onClick={()=>void refreshCameras()}>Refresh camera list</button><p className="small muted">{devices.length?'Choosing a camera by hand overrides the wide preference until you choose Automatic again.':'No cameras listed yet. Allow camera access once, then refresh.'}</p></>}
    {cameraPage===2&&<><label>Selfie preview<input type="checkbox" checked={options.current.mirrorPreview} onChange={e=>{options.current.mirrorPreview=e.target.checked;setFraming(value=>({...value,mirrored:e.target.checked}));clear();}}/></label><label>Follow instructor<select value={framing.mirrorReference?'mirror':'same'} onChange={e=>{options.current.mirrorReference=e.target.value==='mirror';setFraming(value=>({...value,mirrorReference:options.current.mirrorReference}));clear();}}><option value="same">Same anatomical side</option><option value="mirror">Mirror the instructor</option></select></label></>}
    {cameraPage===3&&<><p>{currentFacing()==='environment'?'Rear camera: point the lens toward you. Face a separate visible screen and establish voice or remote controls before starting.':'Place the device so your head and both feet stay visible. Stand upright for height matching.'}</p><label>I can see the instructor and operate controls<input type="checkbox" checked={controlsConfirmed} onChange={e=>setControlsConfirmed(e.target.checked)}/></label>{calibrationEnabled()&&<button disabled={!active} onClick={()=>{if(onRequestSetup){close();onRequestSetup();}else{beginCalibration();close();}}}>Match height again</button>}{!calibrationEnabled()&&<p className="small muted">Height matching is turned off on this server. The instructor uses a default alignment.</p>}{!competition&&import.meta.env.DEV&&new URLSearchParams(location.search).get('diagnostics')==='1'&&lesson.source_video&&<button onClick={()=>{void start('recorded');close();}}>Recorded source test</button>}</>}
    {cameraPage===4&&<><label>Instructor opacity<input type="range" min={.25} max={1} step={.05} value={framing.opacity} onChange={e=>setFraming(value=>({...value,opacity:Number(e.target.value)}))}/></label><label>Instructor position<input type="range" min={.05} max={.95} step={.01} value={framing.position} onChange={e=>setFraming(value=>({...value,position:Number(e.target.value)}))}/></label></>}
    <div className="practice-pagination"><button disabled={cameraPage===0} onClick={()=>setCameraPage(cameraPage-1)}>Back</button><span>{cameraPage+1} / 5</span><button disabled={cameraPage===4} onClick={()=>setCameraPage(cameraPage+1)}>More</button></div>
   </>}
   {panel==='sound'&&<>{voiceError&&<p role="alert">{voiceError}</p>}{cameraPage===0&&<><p>Voice uses this app’s speech service when available, otherwise your browser’s. This app does not save microphone audio.</p>{!voiceSupported&&<p role="status">Voice recognition is unavailable here. Check microphone access and use a supported browser.</p>}<label>Allow voice service<input type="checkbox" checked={voiceConsent} onChange={e=>{setVoiceConsent(e.target.checked);if(!e.target.checked)voice.current?.stop();}}/></label><button disabled={!voiceSupported||!voiceConsent} onClick={()=>{setVoiceError('');if(voice.current?.enabled)voice.current.stop();else voice.current?.start();}}>{voiceState==='off'?'Enable voice':`Voice ${voiceState} · turn off`}</button></>}{cameraPage===1&&<p>{voiceSupported?'Say: start, pause, next, back, again, slower, faster, loop.':'Speech is unavailable here. Use touch, keyboard or a paired screen.'} {lastCommand&&`Heard: ${lastCommand}`}</p>}<div className="practice-pagination"><button disabled={cameraPage===0} onClick={()=>setCameraPage(0)}>Back</button><span>{cameraPage+1} / 2</span><button disabled={cameraPage===1} onClick={()=>setCameraPage(1)}>More</button></div></>}
   {panel==='feedback'&&<><label>Show similarity and cues<input type="checkbox" checked={feedback} onChange={e=>setFeedback(e.target.checked)}/></label><label>Show skeleton<input type="checkbox" checked={options.current.skeleton} onChange={e=>{options.current.skeleton=e.target.checked;clear();}}/></label><p>Similarity is approximate, not technique correctness. Unclear joints are excluded. Reference motion confidence is unmeasured. Camera processing stays on this device.</p></>}
  </PracticePanel>}
 </div>;
});

function preferenceStore(){
 try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}
}

/** Wait for a usable frame box before reporting a source as ready. */
function waitForVideo(video:HTMLVideoElement){
 if(video.readyState>=1&&video.videoWidth>0)return Promise.resolve();
 return new Promise<void>((resolve,reject)=>{
  const clean=()=>{clearTimeout(timer);video.removeEventListener('loadedmetadata',done);video.removeEventListener('error',fail);};
  const done=()=>{clean();resolve();};
  const fail=()=>{clean();reject(new Error('The camera stream did not start.'));};
  const timer=window.setTimeout(fail,8000);
  video.addEventListener('loadedmetadata',done,{once:true});
  video.addEventListener('error',fail,{once:true});
 });
}

function setupFailureFor(error:unknown):SetupFailure{
 if(error instanceof CameraFailure){
  if(error.code==='permission_denied')return 'permission_denied';
  if(error.code==='no_camera')return 'no_camera';
  if(error.code==='insecure_context')return 'insecure_context';
  return 'unknown';
 }
 const name=(error as Error)?.name;
 if(name==='NotAllowedError'||name==='SecurityError')return 'permission_denied';
 if(name==='NotFoundError'||name==='OverconstrainedError')return 'no_camera';
 if(/HTTPS|localhost/i.test((error as Error)?.message??''))return 'insecure_context';
 return 'unknown';
}
