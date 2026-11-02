import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {Playback} from '../../../packages/learning-engine/playback';
import {PracticeSession,type PracticeAction,type Attempt} from '../../../packages/learning-engine/practice-session';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {MimicInterface,type MimicHandle,type CameraState} from './MimicInterface';
import {browserPreferenceStore,describeCamera,loadPreference,protocolFacing,type CameraDevice,type CameraRequest} from './camera-policy';
import {iceConfiguration} from './rtc-config';
import {CameraSetup} from './CameraSetup';
import {CameraSetupController,SETUP_DEFAULTS,type SetupIntent} from './camera-setup-controller';
import {calibrationEnabled} from './camera-setup-policy';
import {MotionStage} from './MotionStage';
import {PracticePanel} from './PracticePanel';
import type {PracticeFraming,PracticePreferences} from './practice-types';
import './practice.css';
import {ApiError,request} from './api';
import {pairRequest,waitIce,type Pair,type PairStatus} from './mimic-connection';

import {usePracticeRecording} from './usePracticeRecording';
import {ArrowLeft,Camera,Video,Ellipsis,Layers,Gauge,Scan,Repeat2,SkipBack,SkipForward,Play,Pause,RotateCcw,Tv} from 'lucide-react';
import {compareLayout} from './receiver-layout';
import {CompetitionSession} from '../../../packages/learning-engine/competition-session';
import {CompetitionResults} from './CompetitionResults';
import {AttemptFeedback} from '../../../packages/learning-engine/attempt-feedback';

type Panel='sections'|'speed'|'view'|'more'|'camera'|'sound'|'feedback'|'loop'|'connect'|'history'|'recording'|'rhythm'|null;
type Summary={score:number|null;cue:string;coverage:number};
type HistoryEntry={date:string;section:string;score:number|null;revision_id?:string;configuration?:string;start?:number;end?:number};
const stamp=(t:number)=>`${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const clamp01=(value:number)=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
export function PracticeWorkspace({lesson,player,onBack,onEdit,editable,notice,onDirty,initialMode='practice',onPracticeSection,initialSettings,onSettings}:{initialSettings?:PracticePreferences;onSettings?:(value:PracticePreferences)=>void;initialMode?:'practice'|'compete';onPracticeSection?:(index:number)=>void;lesson:LessonManifest;player:Playback;onBack:()=>void;onEdit:()=>void;editable:boolean;notice:string;onDirty?:(value:boolean)=>void}){
 const [session]=useState(()=>{const value=new PracticeSession(player);if(initialMode==='practice'&&initialSettings){value.range=initialSettings.range;value.loop=initialSettings.loop;value.countdownSeconds=initialSettings.countdown;value.repetitions=initialSettings.repetitions;value.restSeconds=initialSettings.rest;}return value;});
 const camera=useRef<MimicHandle>(null),shell=useRef<HTMLElement>(null);
 const [competition]=useState(()=>{const value=new CompetitionSession(session);if(initialMode==='compete')value.enter();return value;});
 const settingsCallback=useRef(onSettings);settingsCallback.current=onSettings;
 useEffect(()=>()=>{if(!competition.enabled)settingsCallback.current?.({time:player.state.time,speed:player.state.speed,mode:player.state.mode,range:session.range?{...session.range}:null,loop:session.loop,countdown:session.countdownSeconds,repetitions:session.repetitions,rest:session.restSeconds});},[session,player,competition]);
 const [runResultsOpen,setRunResultsOpen]=useState(false);
 const practiceView=useRef({angle:0,source:false,rhythm:false});
 const [,redraw]=useState(0),[panel,setPanel]=useState<Panel>(null),[page,setPage]=useState(0),[query,setQuery]=useState(''),[source,setSource]=useState(false),[angle,setAngle]=useState(0),[large,setLarge]=useState(false),[layout,setLayout]=useState<'combined'|'separate'|'instructor'>(matchMedia('(max-width:700px)').matches?'combined':'separate');
 const [reviewSummary,setReviewSummary]=useState<Summary>({score:null,cue:'',coverage:0}),[review,setReview]=useState<Attempt|null>(null),[history,setHistory]=useState<HistoryEntry[]>([]),[rangeStart,setRangeStart]=useState(0),[rangeEnd,setRangeEnd]=useState(lesson.duration),[hint,setHint]=useState('Watch the instructor, or start live practice for camera feedback. Video is not saved.'),[countSound,setCountSound]=useState(false);
 const [saveHistory,setSaveHistory]=useState(false),saveHistoryRef=useRef(false);saveHistoryRef.current=saveHistory;
 const [cameraState,setCameraState]=useState<CameraState>('off'),cameraLifecycle=useRef<CameraState>('off');
 const [setupController]=useState(()=>new CameraSetupController());
 const [setupIntent,setSetupIntent]=useState<SetupIntent|null>(null),[setupFacing,setSetupFacing]=useState<'user'|'environment'>('user');
 const [cameraRequest,setCameraRequest]=useState<CameraRequest>(()=>loadPreference(browserPreferenceStore())),[cameraDevices,setCameraDevices]=useState<CameraDevice[]>([]),[cameraNote,setCameraNote]=useState('');
 // Screen mirroring shows this phone's screen and nothing else, so presentation
 // mode makes the phone's own layout the large-screen layout.
 const [presenting,setPresenting]=useState(false),[presentSize,setPresentSize]=useState({width:0,height:0});
 const togglePresentation=useCallback(()=>{
  const next=!presenting;
  setPresenting(next);setPanel(null);panelRef.current=null;setReview(null);
  setHint(next?'Mirroring on. Start screen mirroring first: iPhone Control Centre → Screen Mirroring; Android quick settings → Cast. Tap the screen for controls.':'Mirroring off. Controls and instructions are back on the phone.');
 },[presenting]);
 const setupIntentRef=useRef<SetupIntent|null>(null);setupIntentRef.current=setupIntent;
 const setupStartedCamera=useRef(false),handoffInFlight=useRef(false);
 const receiveCameraState=useCallback((state:CameraState)=>{const previous=cameraLifecycle.current;cameraLifecycle.current=state;setCameraState(state);if(setupIntentRef.current)return;if(state==='off'&&previous!=='off'){session.pause('camera stopped');stopSharingRef.current?.();setHint('Practice ended. Choose Start practice to turn your camera on again.');}if(state==='live')setHint('Choose Play when you are ready.');},[session]);
 const [replayMode,setReplayMode]=useState(false),[viewReset,setViewReset]=useState(0);
 const [takeOpen,setTakeOpen]=useState(false),[saveState,setSaveState]=useState<'idle'|'preparing'|'shared'|'downloaded'|'error'>('idle'),[takeError,setTakeError]=useState(''),[takeSaved,setTakeSaved]=useState(false);
 const takePending=useRef(false),takeActive=useRef(false),recordNext=useRef(false),savedTake=useRef(false);
 const attemptFeedback=useRef(new AttemptFeedback()).current;
 const receiveSummary=useCallback((value:Summary)=>{if(session.phase==='playing'){if(competition.enabled)competition.sample(player.state.time,value);else attemptFeedback.sample(value);}},[session,attemptFeedback,competition,player]);
 const recording=usePracticeRecording(),recordingRef=useRef(recording);recordingRef.current=recording;
 const audio=useRef<AudioContext|null>(null),lastTone=useRef(''),[bpm,setBpm]=useState(100),[rhythm,setRhythm]=useState(false);
 const enableAudio=()=>{try{audio.current??=new AudioContext();void audio.current.resume().catch(()=>{});}catch{setHint('Audio unavailable. Visual counts still work.');}};
 useEffect(()=>()=>{void audio.current?.close();},[]);
 useEffect(()=>{const count=Math.ceil(session.remaining),beat=Math.floor(player.state.time*bpm/60);const key=session.phase==='countdown'&&countSound?`count-${count}`:session.phase==='playing'&&rhythm?`beat-${beat}`:'';
  if(key&&key!==lastTone.current&&audio.current?.state==='running'){const ctx=audio.current,o=ctx.createOscillator(),gain=ctx.createGain();o.frequency.value=key.startsWith('count')?660:beat%8===0?880:440;gain.gain.setValueAtTime(.08,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.08);o.connect(gain).connect(ctx.destination);o.start();o.stop(ctx.currentTime+.09);}lastTone.current=key;
 });
 const [pair,setPair]=useState<Pair|null>(null),[pairStatus,setPairStatus]=useState<PairStatus|null>(null),[connectionError,setConnectionError]=useState(''),[videoSharing,setVideoSharing]=useState(false);
 const sender=useRef<RTCRtpSender|null>(null),signalGeneration=useRef(0),stopSharingRef=useRef<(()=>void)|null>(null);
 const angleRef=useRef(angle);angleRef.current=angle;
 // Guided setup owns entry, the surface, cancellation and the single handoff.
 // The entry action records the intent and opens the preparation stage, where
 // the camera is chosen before the person walks into position. Camera access is
 // requested only by the explicit "Start camera" action.
 const startSetup=useCallback((intent:SetupIntent)=>{
  if(competition.running||recordingRef.current.recording)return;
  setPanel(null);panelRef.current=null;setReview(null);setRunResultsOpen(false);
  session.pause('camera setup');
  if(!calibrationEnabled()){
   // Server switch: skip the preparation and positioning surface entirely and
   // use the default alignment, which MimicInterface applies once the tracker
   // is ready. Height matching is not claimed anywhere.
   setHint(intent==='setup_only'?'Height matching is turned off on this server.':'Height matching is turned off on this server. The instructor uses default alignment; choose Play when you are ready.');
   if(cameraLifecycle.current==='off')void camera.current?.start();
   redraw(n=>n+1);
   return;
  }
  setupStartedCamera.current=false;handoffInFlight.current=false;
  setupController.dispatch({type:'prepare',intent,now:performance.now()});
  setSetupIntent(intent);
 },[competition,session,setupController]);
 const beginCameraSetup=useCallback(()=>{
  const intent=setupIntentRef.current;
  if(!intent||competition.running||recordingRef.current.recording)return;
  const facing=camera.current?.facing()??'user';
  const source=camera.current?.sourceIdentity()??{generation:0,deviceId:'',width:0,height:0};
  const now=performance.now();
  setSetupFacing(facing);
  setupController.dispatch({type:'begin',intent,source,requirements:{facing,pairedDisplay:Boolean(pairStatus?.approved),controlsConfirmed:false},now});
  if(cameraLifecycle.current==='off'){setupStartedCamera.current=true;void camera.current?.start();}
  else{const current=camera.current?.sourceIdentity()??source;setupController.dispatch({type:'source_resolved',source:current,now});setupController.dispatch({type:'camera_ready',now});}
 },[competition,pairStatus,setupController]);
 // A camera change is a source change: pause, finish any take, reacquire through
 // the single camera owner, then let the person see what actually opened.
 const selectCamera=useCallback(async(request:CameraRequest)=>{
  if(competition.running)return;
  if(recordingRef.current.recording)recordingRef.current.stop();
  setCameraRequest(request);setCameraNote('Switching camera…');
  await camera.current?.setCamera(request);
  const selection=camera.current?.selection();
  setCameraNote(selection?`Opened: ${describeCamera(selection)}`:'');
  setCameraDevices(camera.current?.cameras()??[]);
 },[competition]);
 const refreshCameraList=useCallback(async()=>{const devices=await camera.current?.refreshCameras()??[];setCameraDevices(devices);},[]);
 useEffect(()=>{if(!setupIntent)return;const current=camera.current?.request();if(current)setCameraRequest(current);setCameraDevices(camera.current?.cameras()??[]);setCameraNote('');},[setupIntent]);
 const cancelSetup=useCallback(()=>{
  setupController.dispatch({type:'cancel',now:performance.now()});
  setSetupIntent(null);
  if(setupStartedCamera.current){setupStartedCamera.current=false;camera.current?.stop();setHint('Setup cancelled. Choose Start practice when you are ready to try again.');}
  else setHint('Setup cancelled. Choose Play when you are ready.');
 },[setupController]);
 const toggleControlsConfirmed=useCallback(()=>{
  const current=setupController.snapshot.requirements??{facing:setupFacing,pairedDisplay:Boolean(pairStatus?.approved),controlsConfirmed:false};
  const next=!current.controlsConfirmed;
  setupController.dispatch({type:'requirements',requirements:{...current,controlsConfirmed:next}});
  if(next)camera.current?.confirmControls();
  redraw(n=>n+1);
 },[pairStatus,setupController,setupFacing]);
 const tryHandoff=useCallback(()=>{
  if(!setupIntentRef.current||handoffInFlight.current)return;
  const snapshot=setupController.snapshot;
  if(snapshot.stage!=='handoff'||!snapshot.handoff.pending)return;
  handoffInFlight.current=true;
  try{
   const handoff=setupController.consumeHandoff();
   if(!handoff)return;
   camera.current?.applyCalibration(handoff.calibration);
   setupStartedCamera.current=false;
   setSetupIntent(null);
   if(handoff.intent==='setup_only'){setHint('Camera ready. Choose Play when you are ready.');redraw(n=>n+1);return;}
   if(handoff.intent==='start_compete'){
    if(!competition.enabled)return;
    setRunResultsOpen(false);competition.start();redraw(n=>n+1);return;
   }
   session.start(handoff.countdownSeconds);
   redraw(n=>n+1);
  }finally{handoffInFlight.current=false;}
 },[competition,session,setupController]);
 useEffect(()=>{
  if(!setupIntent)return;
  const unsubscribe=setupController.subscribe(()=>{redraw(n=>n+1);tryHandoff();});
  let frame=0;
  const loop=()=>{
   frame=requestAnimationFrame(loop);
   const now=performance.now();
   setupController.dispatch({type:'tick',now});
   const snapshot=setupController.snapshot;
   // Silent flow: there is no announcement to wait for, so report it complete
   // at the minimum display time. Phase C replaces this with real playback.
   if(snapshot.stage==='ready'&&snapshot.ready.announcement==='pending'&&snapshot.ready.elapsedMs>=SETUP_DEFAULTS.readyMinimumMs)setupController.dispatch({type:'announcement_finished',now});
  };
  frame=requestAnimationFrame(loop);
  return()=>{unsubscribe();cancelAnimationFrame(frame);};
 },[setupIntent,setupController,tryHandoff]);
 useEffect(()=>{if(cameraState==='live')setSetupFacing(camera.current?.facing()??'user');},[cameraState]);
 useEffect(()=>{
  if(!setupIntent)return;
  const current=setupController.snapshot.requirements;
  if(!current)return;
  const paired=Boolean(pairStatus?.approved);
  if(current.facing===setupFacing&&current.pairedDisplay===paired)return;
  setupController.dispatch({type:'requirements',requirements:{...current,facing:setupFacing,pairedDisplay:paired}});
 },[setupIntent,setupFacing,pairStatus,setupController]);
 const getSetupTransform=useCallback(()=>camera.current?.transform()??null,[]);
 // What the receiver is allowed to know about the capture source. Device ids
 // never leave the phone; only bounded status, dimensions and guide geometry do.
 const presentation=()=>{
  const selection=camera.current?.selection();
  const setupSnapshot=setupIntentRef.current?setupController.snapshot:null;
  const identity=camera.current?.sourceIdentity();
  const outline=setupSnapshot?.outline;
  const guide=outline&&outline.right>outline.left&&outline.bottom>outline.top
   ?{left:clamp01(outline.left),top:clamp01(outline.top),right:clamp01(outline.right),bottom:clamp01(outline.bottom)}
   :null;
  return {
   source_generation:camera.current?.sourceGeneration()??0,
   camera_status:camera.current?.cameraStatus()??'off',
   camera_facing:selection?protocolFacing(selection.actualFacing):'unknown',
   lens_status:selection?.lensStatus??'unknown',
   source_width:identity?.width??0,
   source_height:identity?.height??0,
   setup_phase:setupSnapshot?.stage??null,
   setup_hint_code:setupSnapshot?.issue??null,
   setup_progress:Math.max(0,Math.min(1,setupSnapshot?.progress??0)),
   guide,
  };
 };
 const connection=useRef({sequence:0,ack:0,wasOnline:false,recovering:false}),rtc=useRef<RTCPeerConnection|null>(null),actionRef=useRef<(c:PracticeAction)=>void>(()=>{});
 const panelRef=useRef(panel);panelRef.current=panel;const takeOpenRef=useRef(takeOpen);takeOpenRef.current=takeOpen;
 const [optionSlots,setOptionSlots]=useState(8);
 const [controlsVisible,setControlsVisible]=useState(true),[interaction,setInteraction]=useState(0);
 const wakeControls=()=>{setControlsVisible(true);setInteraction(n=>n+1);};
 useEffect(()=>{setControlsVisible(true);if(session.phase!=='playing'||panel||takeOpen)return;const timer=window.setTimeout(()=>setControlsVisible(false),3500);return()=>window.clearTimeout(timer);},[session.phase,panel,takeOpen,interaction]);
 useEffect(()=>{const resize=()=>{const height=window.visualViewport?.height??innerHeight,font=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;setOptionSlots(height/font>=23?8:height/font>=14?4:2);setPage(0);};resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);};},[]);
 const action=useCallback((c:PracticeAction)=>{if(panelRef.current||takeOpenRef.current||setupIntentRef.current)return;if(competition.enabled){
   if(c==='pause'||(c==='play'&&competition.running)){session.pause('stopped');redraw(n=>n+1);return;}
   if(c!=='play'&&c!=='resume'&&c!=='again')return;
   if(competition.running)return;
   const issue=camera.current?.readiness(connection.current.wasOnline)||camera.current?.scoringIssue();
   if(cameraLifecycle.current!=='live'||issue){setHint(issue||'Prepare your camera before starting a scored run.');return;}
   setRunResultsOpen(false);competition.start();redraw(n=>n+1);return;
  }if(['play','resume','again','next','back'].includes(c)){const issue=camera.current?.readiness(connection.current.wasOnline);if(issue){setHint(issue);if(recordNext.current){recordNext.current=false;}return;}}if(c==='slower'||c==='faster'){if(takeActive.current){takeActive.current=false;takePending.current=true;}recordingRef.current.stop();}setReplayMode(false);setReview(null);session.action(c);redraw(n=>n+1);},[session,competition]);
 actionRef.current=action;
 useEffect(()=>{if(!pair)return;let disposed=false,timer=0;connection.current={sequence:0,ack:0,wasOnline:false,recovering:false};const poll=async()=>{try{
   const status=await pairRequest<PairStatus>(pair);if(disposed)return;setPairStatus(status);
   if(status.approved){const c=connection.current;if(c.wasOnline&&!status.receiver_online){session.pause('display disconnected');c.recovering=true;setHint('Display disconnected. Reconnect, then choose Play.');}c.wasOnline=status.receiver_online;
    for(const cmd of status.commands){if(cmd.sequence>c.ack){if(!c.recovering&&status.server_time-cmd.at<2500&&status.receiver_online)actionRef.current(cmd.action);c.ack=cmd.sequence;}}if(status.receiver_online)c.recovering=false;
    const s=player.state;await pairRequest(pair,'/state','PUT',{epoch:1,sequence:++c.sequence,time:s.time,speed:s.speed,playing:s.playing,phase:session.phase,remaining:session.remaining,index:s.index,end:session.bounds.end,ack:c.ack,angle:angleRef.current,...camera.current?.display(),...presentation()});
    if(status.signal&&rtc.current&&!rtc.current.remoteDescription&&(status.answer_generation??0)===(status.signal_generation??0)){const answer=JSON.parse(status.signal) as RTCSessionDescriptionInit;if(answer.type==='answer')await rtc.current.setRemoteDescription(answer);}
   }
  }catch(e){if(!disposed){session.pause('connection interrupted');connection.current.recovering=true;setConnectionError((e as Error).message);setHint('Display connection interrupted. Reconnect, then choose Play.');if(e instanceof ApiError&&[401,403,404,409].includes(e.status)){setPair(null);setPairStatus(null);setVideoSharing(false);}}}finally{if(!disposed)timer=window.setTimeout(()=>void poll(),300);}};void poll();return()=>{disposed=true;clearTimeout(timer);session.pause('display closed');rtc.current?.close();rtc.current=null;void pairRequest(pair,'','DELETE',{},true).catch(()=>{});};},[pair,player,session]);
 // Sharing is an explicit, revocable state. A replacement camera never turns it
 // on; an ordinary switch replaces the live track so no re-approval is needed.
 const closePeer=()=>{try{rtc.current?.close();}catch{/* already closed */}rtc.current=null;sender.current=null;};
 const stopSharing=useCallback(()=>{
  closePeer();setVideoSharing(false);
  if(pair)void pairRequest(pair,'/signal','PUT',{description:'',generation:0}).catch(()=>{});
 },[pair]);
 stopSharingRef.current=stopSharing;
 const publishOffer=useCallback(async(stream:MediaStream)=>{
  const generation=++signalGeneration.current;
  closePeer();
  const pc=new RTCPeerConnection(iceConfiguration());rtc.current=pc;
  sender.current=pc.addTrack(stream.getVideoTracks()[0],stream);
  pc.onconnectionstatechange=()=>{if(rtc.current===pc&&(pc.connectionState==='failed'||pc.connectionState==='closed'))stopSharingRef.current?.();};
  await pc.setLocalDescription(await pc.createOffer());await waitIce(pc);
  await pairRequest(pair!,'/signal','PUT',{description:JSON.stringify(pc.localDescription),generation});
 },[]);
 const shareVideo=async()=>{
  if(!pair)return;
  if(rtc.current){stopSharing();return;}
  const stream=camera.current?.stream();
  if(!stream){setConnectionError('Enable the camera before sharing its preview.');return;}
  try{await publishOffer(stream);setVideoSharing(true);setConnectionError('');}
  catch(e){closePeer();setConnectionError((e as Error).message);}
 };
 // A camera switch keeps the peer connection and swaps the track. Only when the
 // sender refuses the replacement do we negotiate a fresh, generation-tagged offer.
 useEffect(()=>{
  if(!videoSharing||cameraState!=='live')return;
  const current=sender.current,track=camera.current?.stream()?.getVideoTracks()[0];
  if(!current||!track||current.track===track)return;
  void current.replaceTrack(track).catch(()=>{
   const stream=camera.current?.stream();
   if(stream)void publishOffer(stream).catch(()=>setConnectionError('The camera changed, but the display could not be updated. Share the preview again.'));
  });
 },[cameraState,videoSharing,publishOffer]);
 const open=(next:Panel)=>{if(competition.running||setupIntentRef.current)return;if(competition.enabled&&!['more','camera','sound','view','connect'].includes(next??''))return;session.pause('settings');setReview(null);setPage(0);setPanel(next);redraw(n=>n+1);};
 const close=()=>{setPanel(null);setHint(competition.enabled?'Perform the full sequence without stopping.':'Paused. Choose Play when you are ready.');};
 const switchMode=(compete:boolean)=>{if(!compete&&onPracticeSection){onPracticeSection(-1);return;}if(compete===competition.enabled||competition.running||recording.recording||recordNext.current)return;setReview(null);setRunResultsOpen(false);setReplayMode(false);setPanel(null);recordNext.current=false;if(compete){practiceView.current={angle,source,rhythm};competition.enter();setAngle(0);setSource(false);setRhythm(false);setViewReset(n=>n+1);setHint('Full sequence · Normal speed · Scored');}else{competition.leave();setAngle(practiceView.current.angle);setSource(practiceView.current.source);setRhythm(practiceView.current.rhythm);setHint('Practice settings restored. Choose Play when ready.');}redraw(n=>n+1);};
 const practiseSection=(index:number)=>{if(onPracticeSection){onPracticeSection(index);return;}switchMode(false);session.select(index);setHint('Repeat this section at your own pace.');redraw(n=>n+1);};
 const togglePractice=()=>{
  setReplayMode(false);setReview(null);
  if(cameraState!=='off'){session.pause('practice ended');camera.current?.stop();return;}
  session.pause('starting practice');setHint('Starting live practice. No video is being recorded.');
  startSetup('start_practice');
 };
 const startTake=()=>{
  if(recording.recording)return;
  if(recording.url){session.pause('watch take');setTakeOpen(true);return;}
  if(cameraState!=='live'||!camera.current?.stream()){setHint('Start practice before recording.');return;}
  const issue=camera.current.readiness(connection.current.wasOnline);if(issue){setHint(issue);return;}
  panelRef.current=null;setPanel(null);
  setTakeOpen(false);setTakeError('');setReplayMode(false);
  if(session.phase==='playing'){takeActive.current=recording.begin(camera.current.stream(),player.state.time,player.state.speed);setHint('Recording your practice…');}
  else {if(session.phase!=='paused')session.pause('starting a take');recordNext.current=true;setHint('Recording starts after the count-in.');action('play');}
 };
 const stopTake=()=>{recordNext.current=false;takeActive.current=false;takePending.current=true;setHint('Finishing your recording. Live practice continues.');recording.stop();redraw(n=>n+1);};
 const saveTake=async()=>{
  setSaveState('preparing');setTakeError('');
  try{
   const blob=recording.blob.current;if(!blob)throw new Error('No take available.');
   const type=blob.type||'video/webm',ext=type.includes('mp4')?'mp4':'webm';
   const file=new File([blob],`my-practice-take.${ext}`,{type});
   const share=navigator as Navigator&{canShare?:(data:ShareData)=>boolean};
   if(share.canShare?.({files:[file]})){await navigator.share({files:[file],title:'My practice take'});setSaveState('shared');}
   else{const href=URL.createObjectURL(blob);const link=document.createElement('a');link.href=href;link.download=file.name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),10000);setSaveState('downloaded');}

  }catch(e){if((e as Error).name==='AbortError'){setSaveState('idle');return;}setSaveState('error');setTakeError('Saving was interrupted. Your take is still here.');}
 };
 const restartTake=()=>{
  const issue=camera.current?.readiness(connection.current.wasOnline);if(issue){setTakeError(issue);return;}
  if(!savedTake.current&&!window.confirm('Replace this take? Save it first if you want to keep it.'))return;
  if(!camera.current?.stream()){setTakeOpen(false);open('camera');setHint('Enable your camera before recording another take.');return;}
  recording.remove();savedTake.current=false;setTakeSaved(false);setSaveState('idle');takePending.current=false;
  panelRef.current=null;setPanel(null);session.pause('restarting take');recordNext.current=true;
  takeOpenRef.current=false;setTakeOpen(false);setTakeError('');setHint('Get ready for your next take.');action('play');
 };
 useEffect(()=>{onDirty?.(recording.recording||!!recording.url&&!takeSaved);return()=>onDirty?.(false);},[recording.recording,recording.url,takeSaved,onDirty]);
 const discardTake=()=>{
  if(recording.url&&!savedTake.current&&!window.confirm('Discard this take? It has not been saved.'))return;
  setTakeOpen(false);recording.remove();savedTake.current=false;setTakeSaved(false);setSaveState('idle');
 };
 const leavePractice=()=>{onBack();};
 useEffect(()=>{if(recording.url){takePending.current=false;takeActive.current=false;setHint('Take ready to review or save. Live practice does not capture video.');setSaveState('idle');setTakeSaved(false);savedTake.current=false;setTakeError('');}},[recording.url]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(recording.url&&!savedTake.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[recording.url]);
 useEffect(()=>{document.body.classList.add('in-practice');return()=>{document.body.classList.remove('in-practice');session.pause('exit');};},[session]);
 useEffect(()=>{let frame=0,last=performance.now(),draw=last;const tick=(now:number)=>{competition.tick((now-last)/1000);last=now;if(now-draw>80){redraw(n=>n+1);draw=now;}frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);const hide=()=>{if(document.hidden)session.pause('background');};document.addEventListener('visibilitychange',hide);return()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',hide);};},[session]);
 useEffect(()=>{session.onPause=reason=>{recordNext.current=false;if(competition.interrupt(reason))setRunResultsOpen(true);};session.onAttemptStart=time=>{attemptFeedback.reset();if(recordNext.current){recordNext.current=false;takeActive.current=true;if(!recordingRef.current.begin(camera.current?.stream()??null,time,player.state.speed)){takeActive.current=false;}}};session.onAttempt=a=>{if(competition.enabled){competition.finish(a);if(competition.result)setRunResultsOpen(true);return;}if(takeActive.current){takeActive.current=false;recordingRef.current.stop();takePending.current=true;}if(a.completed){const result=attemptFeedback.result(),entry={date:new Date().toISOString(),section:player.current?.label??lesson.title,score:result.score,revision_id:lesson.revision_id,configuration:camera.current?.configuration()??'watch',start:a.start,end:a.end};setReviewSummary(result);setReview(a);setHistory(values=>[entry,...values].slice(0,100));if(saveHistoryRef.current)void request(`/lessons/${lesson.lesson_id}/attempts`,'POST',{id:a.id,scoring_version:'pose-v1',...entry,...result}).catch(()=>setHint('Attempt could not save. Your practice still works.'));}};return()=>{recordNext.current=false;session.onPause=undefined;session.onAttempt=undefined;session.onAttemptStart=undefined;};},[session,lesson,player,attemptFeedback,competition]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(panelRef.current||takeOpen||setupIntentRef.current||e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLButtonElement||e.metaKey||e.ctrlKey||e.altKey)return;const commands:Record<string,PracticeAction>={' ':'play',ArrowRight:'next',ArrowLeft:'back',r:'again',p:'pause'};if(commands[e.key]){e.preventDefault();action(commands[e.key]);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[action,takeOpen]);
 useEffect(()=>{
  if(!presenting)return;
  const element=shell.current;
  if(!element||typeof ResizeObserver==='undefined')return;
  const measure=()=>setPresentSize({width:element.clientWidth,height:element.clientHeight});
  const observer=new ResizeObserver(measure);observer.observe(element);measure();
  return()=>observer.disconnect();
 },[presenting]);
 useEffect(()=>{const vv=window.visualViewport;const resize=()=>{if(shell.current){shell.current.style.setProperty('--practice-height',`${vv?.height??innerHeight}px`);shell.current.style.setProperty('--practice-top',`${vv?.offsetTop??0}px`);}};resize();vv?.addEventListener('resize',resize);vv?.addEventListener('scroll',resize);window.addEventListener('orientationchange',resize);screen.orientation?.addEventListener('change',resize);return()=>{vv?.removeEventListener('resize',resize);vv?.removeEventListener('scroll',resize);window.removeEventListener('orientationchange',resize);screen.orientation?.removeEventListener('change',resize);};},[]);
 useEffect(()=>{let lock:{release:()=>Promise<void>}|undefined,cancelled=false;const wake=navigator as Navigator&{wakeLock?:{request:(type:'screen')=>Promise<{release:()=>Promise<void>}>}};if(session.phase!=='paused'&&!document.hidden)void wake.wakeLock?.request('screen').then(value=>{if(cancelled)void value.release();else lock=value;}).catch(()=>{});return()=>{cancelled=true;void lock?.release();};},[session.phase]);
 const compete=competition.enabled,runActive=competition.running;
 const cameraIssue=camera.current?.readiness(connection.current.wasOnline)||(compete&&cameraState==='live'?camera.current?.scoringIssue():'');
 const runReady=cameraState==='live'&&!cameraIssue&&!player.state.calibrating;
 const s=player.state,current=player.current??player.sections[0];
 const sections=player.sections.filter(section=>section.label.toLowerCase().includes(query.toLowerCase()));
 const viewPage=page%3;
 const reference=(framing:PracticeFraming)=><div className="motion-stage"><MotionStage lesson={lesson} player={player} source={source&&layout!=='combined'} locked={compete} immersive={!framing.active} fit={presenting&&!framing.active?'envelope':'none'} interactive={!presenting} framing={{...framing,angle,resetVersion:viewReset}}/><span className="practice-reference-label">{source&&layout!=='combined'?'Original video':'3D instructor'}{angle!==0?' · observation angle':''}</span></div>;
 const presentLayout=compareLayout(presentSize.width,presentSize.height);
 const presentStyle=presenting?({
  '--present-columns':`minmax(0,${presentLayout.cameraShare}fr) minmax(0,${presentLayout.instructorShare}fr)`,
  '--present-rows':`minmax(0,${presentLayout.cameraShare}fr) minmax(0,${presentLayout.instructorShare}fr)`,
 } as unknown as CSSProperties):undefined;
 return <section ref={shell} onPointerDownCapture={wakeControls} onFocusCapture={wakeControls} data-present-axis={presenting?presentLayout.axis:undefined} style={presentStyle} className={`mimic-shell mimic-immersive ${presenting?'is-presenting':''} ${setupIntent?'is-setting-up':''} ${compete?'mode-compete':'mode-practice'} ${cameraState==='off'?'is-watching':'is-practising'} ${session.phase==='playing'?'is-playing':''} ${controlsVisible?'':'controls-resting'} ${large?'large-display':''}`} aria-label="Practice workspace">
  <header className="mimic-header" inert={Boolean(setupIntent)||undefined}><button className="mimic-icon-button" aria-label="Exit" onClick={leavePractice}><ArrowLeft size={22}/></button><div><span className="mimic-eyebrow">MIMIC / {compete?'COMPETE':cameraState==='off'?'WATCH':'PRACTICE'}</span><strong>{lesson.title}</strong><span>{pair?pairStatus?.approved?pairStatus.receiver_online?'Display connected':'Display reconnecting':'Display awaiting approval':'Learn the movement. Make it yours.'}</span></div><button className="mimic-icon-button" aria-label="More" disabled={runActive} onClick={()=>open('more')}><Ellipsis size={24}/></button></header>
  <main className="mimic-stage" inert={Boolean(setupIntent)||undefined}><div className="live-practice-layer" hidden={replayMode}><MimicInterface ref={camera} lesson={lesson} player={player} onCommand={action} renderReference={reference} panel={panel==='camera'||panel==='sound'||panel==='feedback'?panel:null} onClose={close} layout={presenting?'separate':layout} angle={angle} onSummary={receiveSummary} onCameraState={receiveCameraState} competition={compete} setup={setupIntent?setupController:undefined} onRequestSetup={()=>startSetup('setup_only')}/></div>{replayMode&&recording.url&&<ReplayStage lesson={lesson} player={player} url={recording.url} start={recording.startTime.current} rate={recording.speed.current} onClose={()=>setReplayMode(false)}/>}
   {rhythm&&session.phase==='playing'&&<span className="practice-beat">Count {Math.floor(s.time*bpm/60)%8+1} / 8</span>}
   {(session.phase==='countdown'||session.phase==='rest')&&<div className="practice-countdown" role="status"><strong>{Math.ceil(session.remaining)}</strong><span>{session.phase==='rest'?'Rest · next repetition':'Get ready'}</span><button onClick={()=>action('pause')}>Cancel</button></div>}
   {!compete&&review&&session.phase==='paused'&&!panel&&<div className="practice-review"><strong>Section complete</strong><p>{reviewSummary.score===null?'No reliable comparison for this attempt.':`${reviewSummary.score}% approximate similarity. `}{reviewSummary.cue||'Try again or continue.'}</p><button onClick={()=>action('again')}>Repeat</button><button onClick={()=>action('next')}>Next</button><button onClick={()=>setReview(null)}>Dismiss</button></div>}
  </main>
  {compete?<div className="mimic-context" inert={Boolean(setupIntent)||undefined}><span className="compete-rule">FULL SEQUENCE · 1× · SCORED</span><h2>{runActive?current.label:'One complete performance'}</h2><div className="mimic-status" role="status">{runActive?session.phase==='countdown'?'Get into position. Your run starts after the countdown.':'Scored run in progress · Finish without stopping':cameraState==='off'?'Prepare your camera, then perform the full sequence without stopping.':cameraState==='starting'?'Starting camera…':cameraIssue||'Ready for a scored run. Your result appears after you finish.'}</div></div>:
<div className="mimic-context" inert={Boolean(setupIntent)||undefined}><button className="mimic-section-link" onClick={()=>open('sections')} aria-label={`Section ${Math.max(1,s.index+1)}/${player.sections.length}`}><Layers size={14}/> SECTION {String(Math.max(1,s.index+1)).padStart(2,'0')} <span>/ {String(player.sections.length).padStart(2,'0')}</span></button><h2>{current.label}</h2><div className="mimic-status" role="status">{recording.recording?`Recording your take · ${Math.max(0,Math.ceil(recording.maxSeconds-recording.elapsed))}s left`:recordNext.current?'Get ready · recording starts after the count-in':cameraState==='starting'?'Starting camera…':cameraState==='live'&&s.calibrating?'Stand upright with your whole body in view for height matching':session.phase==='countdown'?'Get into position':session.phase==='rest'?'Rest before repeating':session.phase==='playing'?`${cameraState==='live'?'Live practice · not recording':'Watch the instructor'}${session.loop?` · repetition ${session.completed+1}`:''}`:notice||(cameraState==='live'?'Live practice · not recording. '+hint:hint)}</div></div>}
  {takeOpen&&recording.url&&<PracticePanel title="Your take" onClose={()=>setTakeOpen(false)} className="take-panel">
    <video className="take-video" src={recording.url} controls playsInline aria-label="Your recorded take"/>
    <div className="take-actions"><button className="primary" disabled={saveState==='preparing'} onClick={()=>void saveTake()}>{saveState==='preparing'?'Preparing…':'Save video'}</button><button className="secondary" disabled={saveState==='preparing'||cameraState!=='live'||!!camera.current?.readiness(connection.current.wasOnline)} onClick={restartTake}>Record another</button><button className="secondary" disabled={saveState==='preparing'} onClick={discardTake}>Discard</button></div>
    {saveState==='shared'&&<p role="status">Share sheet closed. Check that you kept a copy.</p>}
    {saveState==='downloaded'&&<p role="status">Download requested. Check your downloads for the video.</p>}
    {(saveState==='shared'||saveState==='downloaded')&&!takeSaved&&<button onClick={()=>{savedTake.current=true;setTakeSaved(true);}}>I have saved a copy</button>}
    {recording.stopReason&&<p role="status">{recording.stopReason}</p>}
    {takeError&&<p role="alert">{takeError}</p>}
    <p className="small muted">Video only · no audio. Kept in this page until you leave. Nothing is uploaded.</p>
  </PracticePanel>}
  {compete?<footer className="mimic-dock compete-dock" inert={Boolean(setupIntent)||undefined}><div className="compete-preparation"><span>Personal challenge</span><p>Complete the published movement at normal speed. Scores measure approximate movement match.</p></div>
   {!runActive&&<div className="compete-setup-actions"><button onClick={()=>startSetup('setup_only')}>Camera setup</button><button aria-pressed={presenting} aria-label="Mirror this screen to a TV" onClick={togglePresentation}>{presenting?'Turn off mirroring':'Mirror to TV'}</button><button onClick={()=>switchMode(false)}>Back to practice</button></div>}
   {competition.result&&!runActive&&<button onClick={()=>setRunResultsOpen(true)}>Review result</button>}
   <button className="practice-session-toggle" disabled={!runActive&&cameraState!=='off'&&!runReady} onClick={()=>{if(runActive)action('pause');else if(cameraState==='off')startSetup('start_compete');else action('play');}}><Camera size={16}/>{runActive?'Stop run':cameraState==='off'?'Prepare to compete':cameraState==='starting'?'Starting camera…':'Start scored run'}</button>
   {cameraState!=='off'&&!runActive&&<button onClick={()=>camera.current?.stop()}>{cameraState==='starting'?'Cancel camera setup':'Turn camera off'}</button>}
   <div className="compete-progress"><span>{stamp(s.time)}</span><progress aria-label="Run progress" value={s.time} max={lesson.duration}/><span>{stamp(lesson.duration)}</span></div>
  </footer>:
<footer className="mimic-dock" inert={Boolean(setupIntent)||undefined}><div className="mimic-record-bar">
   <button className="practice-session-toggle" aria-pressed={cameraState!=='off'} onClick={togglePractice}><Camera size={16}/>{cameraState==='off'?'Start practice':cameraState==='starting'?'Cancel camera setup':'End practice'}</button>
   {cameraState==='live'&&(recording.recording||recordNext.current?<button className="record-take active" onClick={stopTake}><span className="record-dot"/>{recording.recording?'Stop recording':'Cancel recording'}</button>:!recording.url&&<button className="record-take" disabled={!!camera.current?.readiness(connection.current.wasOnline)||replayMode} onClick={startTake}><Video size={16}/>Record practice</button>)}
   {recording.url&&<button className="take-review-button" onClick={()=>{session.pause('review take');setTakeOpen(true);}}>Review take{takeSaved?'':' · not saved'}</button>}
   {recording.error&&<span className="small muted" role="alert">{recording.error}</span>}
  </div><div className="mimic-shortcuts" aria-label="Practice tools"><button aria-label={`${s.speed}× Speed`} onClick={()=>open('speed')}><Gauge size={22}/><span>{s.speed}×</span></button><button onClick={()=>open('view')}><Scan size={22}/><span>View</span></button><button aria-label={session.loop?'Loop on':'Loop off'} aria-pressed={session.loop} onClick={()=>open('loop')}><Repeat2 size={22}/><span>{session.loop?'Loop on':'Loop'}</span></button><button aria-label="Mirror this screen to a TV" aria-pressed={presenting} onClick={togglePresentation}><Tv size={22}/><span>{presenting?'Mirror on':'Mirror'}</span></button></div>
   <div className="mimic-scrub"><span>{stamp(s.time)}</span><input aria-label="Lesson position" type="range" min={0} max={lesson.duration} step={.01} value={s.time} onChange={e=>{session.seek(Number(e.target.value));setReview(null);redraw(n=>n+1);}}/><span>{stamp(lesson.duration)}</span></div>
   <div className="mimic-transport"><button aria-label="Previous" onClick={()=>action('back')}><SkipBack size={20}/></button><button aria-label="Repeat" onClick={()=>action('again')}><RotateCcw size={20}/></button><button className="mimic-play" aria-label={session.phase==='paused'?'Play':'Pause'} onClick={()=>action('play')}>{session.phase==='paused'?<Play size={25} fill="currentColor"/>:<Pause size={25} fill="currentColor"/>}</button><button aria-label="Next" onClick={()=>action('next')}><SkipForward size={20}/></button></div>
  </footer>}
  {compete&&runResultsOpen&&competition.result&&<CompetitionResults result={competition.result} revision={lesson.revision_id} onClose={()=>setRunResultsOpen(false)} onRetry={()=>{setRunResultsOpen(false);if(cameraState==='off')void camera.current?.start();else action('play');}} onPractice={()=>switchMode(false)} onSection={practiseSection}/>}
  {panel&& !['camera','sound','feedback'].includes(panel)&&<PracticePanel title={panel==='more'?'Practice options':panel[0].toUpperCase()+panel.slice(1)} onClose={close}>
   {panel==='more'&&<><div className="practice-option-grid">{((compete?['camera','sound','view','connect']:['camera','sound','loop','feedback','connect','history','recording','rhythm']) as Panel[]).slice(page*optionSlots,page*optionSlots+optionSlots).map(item=><button key={item} onClick={()=>open(item)}>{item==='sound'?'Sound & voice':item==='connect'?'Larger screen':item==='history'?'Practice history':item![0].toUpperCase()+item!.slice(1)}</button>)}</div>{optionSlots<8&&<Pager page={page} count={Math.ceil(8/optionSlots)} setPage={setPage}/>}</>}
   {panel==='sections'&&<><input aria-label="Find section" placeholder="Find a section" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/><div className="practice-option-grid">{sections.slice(page*2,page*2+2).map(section=><button key={section.id} onClick={()=>{session.select(player.sections.indexOf(section));close();redraw(n=>n+1);}}>{section.label}</button>)}</div><Pager page={page} count={Math.max(1,Math.ceil(sections.length/2))} setPage={setPage}/></>}
   {panel==='speed'&&<div className="practice-option-grid">{[.25,.5,.75,1].map(speed=><button key={speed} aria-pressed={s.speed===speed} onClick={()=>{player.speed(speed);close();}}>{speed}×</button>)}</div>}
   {panel==='view'&&<>{viewPage===0&&<label>Layout<select value={layout} onChange={e=>setLayout(e.target.value as typeof layout)}><option value="combined">Together in one view</option><option value="separate">Side by side</option><option value="instructor">Large instructor · small self view</option></select></label>}{viewPage===1&&<><label>Instructor angle<select disabled={compete} value={angle} onChange={e=>setAngle(Number(e.target.value))}><option value={0}>Front / reset</option><option value={Math.PI}>Back</option><option value={Math.PI/2}>Left</option><option value={-Math.PI/2}>Right</option></select></label><button onClick={()=>{setAngle(0);setViewReset(n=>n+1);}}>Reset instructor view</button><p>Other angles are for observation. Pose comparison pauses until you return to Front.</p></>}{viewPage===2&&<><label>Reference<select disabled={compete} value={source?'video':'3d'} onChange={e=>{setSource(e.target.value==='video');if(e.target.value==='video')setLayout('separate');}}><option value="3d">3D instructor</option><option value="video" disabled={!lesson.source_video}>Original video</option></select></label><button onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});else void shell.current?.requestFullscreen?.().catch(()=>setHint('Fullscreen unavailable. Practice still fits this window.'));}}>Toggle fullscreen</button></>}<Pager page={viewPage} count={3} setPage={setPage}/></>}
   {panel==='loop'&&<>{page===0&&<><label>Repeat automatically<input type="checkbox" checked={session.loop} onChange={e=>{session.loop=e.target.checked;redraw(n=>n+1);}}/></label><label>Repetitions<select value={session.repetitions} onChange={e=>{session.repetitions=Number(e.target.value);session.completed=0;redraw(n=>n+1);}}>{[0,2,3,5,10].map(n=><option key={n} value={n}>{n||'Until stopped'}</option>)}</select></label></>}{page===1&&<><label>Count-in<select value={session.countdownSeconds} onChange={e=>{session.countdownSeconds=Number(e.target.value);redraw(n=>n+1);}}>{[0,3,5,10].map(n=><option key={n} value={n}>{n} seconds</option>)}</select></label><label>Rest between repeats<select value={session.restSeconds} onChange={e=>{session.restSeconds=Number(e.target.value);redraw(n=>n+1);}}>{[0,2,5,10].map(n=><option key={n} value={n}>{n} seconds</option>)}</select></label></>}{page===2&&<><div className="practice-range-fields"><label>From (seconds)<input type="number" min={0} max={lesson.duration} step={.1} value={rangeStart} onChange={e=>setRangeStart(Number(e.target.value))}/></label><label>To (seconds)<input type="number" min={0} max={lesson.duration} step={.1} value={rangeEnd} onChange={e=>setRangeEnd(Number(e.target.value))}/></label></div><div className="practice-option-grid"><button onClick={()=>{try{session.setRange(rangeStart,rangeEnd);close();}catch(e){setHint((e as Error).message);close();}}}>Use range</button><button onClick={()=>{session.range=null;close();}}>Use section</button></div></>}<Pager page={page} count={3} setPage={setPage}/></>}
   {panel==='connect'&&<>{page===0&&<><p><strong>Mirror</strong> reshapes this screen into a large camera-and-instructor view, then you mirror the phone with the operating system: iPhone Control Centre → Screen Mirroring, or Android quick settings → Cast. A web page cannot start mirroring itself. For a sharper, lower-delay picture, sign into the same account on another screen and choose “Use as practice display”.</p><button aria-pressed={presenting} onClick={togglePresentation}>{presenting?'Turn off mirroring':'Mirror this screen to a TV'}</button><label>Large-screen text<input type="checkbox" checked={large} onChange={e=>setLarge(e.target.checked)}/></label></>}{page===1&&<>{!pair?<button onClick={()=>{setConnectionError('');request<Pair>('/mimic-pairs','POST',{lesson_id:lesson.lesson_id,revision_id:lesson.revision_id}).then(setPair).catch(e=>setConnectionError(e.message));}}>Create connection code</button>:<><strong className="pair-code">{pair.code}</strong><p>{pairStatus?.approved?pairStatus.receiver_online?'Display connected':'Display reconnecting':pairStatus?.pending?'A display is waiting for your approval.':'Enter this code on your other screen. Expires in 10 minutes.'}</p>{pairStatus?.pending&&!pairStatus.approved&&<button onClick={()=>void pairRequest(pair,'/approve','POST').catch(e=>setConnectionError(e.message))}>Approve display controls</button>}<button onClick={()=>{setPair(null);setPairStatus(null);setVideoSharing(false);}}>Disconnect</button></>}</>}{page===2&&<><p>Optional: send your live camera preview to the approved display. Video uses a separate device-to-device connection; some networks need a relay that is not configured here.</p><button disabled={!pairStatus?.approved} onClick={()=>void shareVideo()}>{videoSharing?'Stop sharing camera preview':'Share camera preview with display'}</button></>}{connectionError&&<p role="alert">{connectionError}</p>}<Pager page={page} count={3} setPage={setPage}/></>}
   {panel==='history'&&<>{page===0?<><label>Save future summaries to my account<input disabled={!lesson.animation.key.startsWith('lessons/')} type="checkbox" checked={saveHistory} onChange={e=>setSaveHistory(e.target.checked)}/></label><button disabled={!lesson.animation.key.startsWith('lessons/')} onClick={()=>void request<HistoryEntry[]>(`/lessons/${lesson.lesson_id}/attempts`).then(values=>{setHistory(values);setPage(values.length?1:0);}).catch(e=>setHint(e.message))}>Load saved practice history</button><p>Only summaries are saved when enabled. Recordings stay on this device.</p></>:<><p>{history[page-1]?.section??'No attempts yet'} · {history[page-1]?.score==null?'No reliable comparison':`${history[page-1].score}% approximate similarity`}</p><p>{history[page-1]?.revision_id===lesson.revision_id?'Current lesson revision':'Different lesson revision · scores may not be comparable'}</p></>}<Pager page={page} count={1+history.length} setPage={setPage}/>{editable&&<button onClick={onEdit}>Edit lesson sections</button>}</>}
   {panel==='recording'&&<>{page===0&&<><p>Start practice for a live camera view without saving video. During practice, you can optionally record a take. Video only, up to {Math.round(recording.maxSeconds/60)} minutes. Nothing is uploaded.</p><button className="primary" disabled={cameraState!=='live'||!!camera.current?.readiness(connection.current.wasOnline)} onClick={()=>{panelRef.current=null;setPanel(null);startTake();}}>Record practice</button>{recording.url&&<button className="secondary" onClick={()=>setTakeOpen(true)}>Watch my take</button>}{recording.error&&<p role="alert">{recording.error}</p>}</>}{page===1&&<>{recording.url?<><button className="secondary" onClick={()=>{setTakeOpen(false);setReplayMode(true);}}>Compare beside instructor</button><button className="secondary" onClick={discardTake}>Delete take</button></>:<p>No take yet. Start practice, then choose Record practice when you want to capture video.</p>}</>}<Pager page={page} count={2} setPage={setPage}/></>}
   {panel==='rhythm'&&<>{page===0&&<><label>Audible preparation countdown<input type="checkbox" checked={countSound} onChange={e=>{setCountSound(e.target.checked);enableAudio();}}/></label><label>Metronome and eight-count display<input type="checkbox" checked={rhythm} onChange={e=>{setRhythm(e.target.checked);enableAudio();}}/></label></>}{page===1&&<><label>Tempo (BPM)<input type="number" min={30} max={240} value={bpm} onChange={e=>setBpm(Math.max(30,Math.min(240,Number(e.target.value)||100)))}/></label><p>Manual practice tempo. This does not detect the original music’s beats or measure rhythm accuracy.</p></>}<Pager page={page} count={2} setPage={setPage}/></>}
  </PracticePanel>}
{setupIntent&&<CameraSetup controller={setupController} getTransform={getSetupTransform} onBack={cancelSetup} onCancel={cancelSetup} onRetrySetup={()=>{setupController.dispatch({type:'retry_setup',now:performance.now()});redraw(n=>n+1);}} onRetryCamera={()=>{setupStartedCamera.current=true;setupController.dispatch({type:'retry_camera',now:performance.now()});void camera.current?.start();}} onConfirmControls={toggleControlsConfirmed} showControlsConfirmation={setupFacing==='environment'&&!pairStatus?.approved} cameraRequest={cameraRequest} cameras={cameraDevices} cameraNote={cameraNote} onSelectCamera={request=>void selectCamera(request)} onStartCamera={beginCameraSetup} onRefreshCameras={()=>void refreshCameraList()}/>}
 </section>;
}
export function Pager({page,count,setPage}:{page:number;count:number;setPage:(n:number)=>void}){return <div className="practice-pagination"><button disabled={page<=0} onClick={()=>setPage(page-1)}>Back</button><span>{page+1} / {count}</span><button disabled={page>=count-1} onClick={()=>setPage(page+1)}>More</button></div>;}
function ReplayStage({lesson,player,url,start,rate,onClose}:{lesson:LessonManifest;player:Playback;url:string;start:number;rate:number;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{let frame=0;const tick=()=>{if(video.current)player.seek(Math.min(lesson.duration,start+video.current.currentTime*rate));frame=requestAnimationFrame(tick);};tick();return()=>cancelAnimationFrame(frame);},[player,lesson.duration,start,rate]);
 return <div className="practice-replay-grid"><video ref={video} src={url} controls playsInline/><MotionStage lesson={lesson} player={player}/><button className="replay-close" onClick={onClose}>Back to practice</button></div>;
}
