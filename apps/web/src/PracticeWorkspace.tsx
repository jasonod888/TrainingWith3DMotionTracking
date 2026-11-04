import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {Playback} from '../../../packages/learning-engine/playback';
import {PracticeSession,type PracticeAction,type Attempt} from '../../../packages/learning-engine/practice-session';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {MimicInterface,type MimicHandle,type CameraState} from './MimicInterface';
import {browserPreferenceStore,describeCamera,facingAvailability,loadPreference,normalizeDevices,protocolFacing,type CameraDevice,type CameraRequest,type FacingAvailability} from './camera-policy';
import {iceConfiguration} from './rtc-config';
import {CameraSetup} from './CameraSetup';
import {CameraSetupController,SETUP_DEFAULTS,type SetupIntent} from './camera-setup-controller';
import {calibrationEnabled} from './camera-setup-policy';
import {MotionStage} from './MotionStage';
import {PracticePanel} from './PracticePanel';
import {PracticeTimeline} from './PracticeTimeline';
import {PracticeSettingsProvider,SettingsGroup,SettingsMount,SettingsRow,SettingsChoices} from './PracticeSettings';
import {ViewAngleControl} from './ViewAngleControl';
import type {PracticeFraming,PracticePreferences} from './practice-types';
import './practice.css';
import './practice-player.css';
import {ApiError,request} from './api';
import {pairRequest,waitIce,type Pair,type PairStatus} from './mimic-connection';

import {usePracticeRecording} from './usePracticeRecording';
import {ArrowLeft,Camera,Video,Settings2,Play,Pause,Maximize,Minimize,Mic,MicOff,RotateCcw,ChevronRight} from 'lucide-react';
import {compareLayout} from './receiver-layout';
import {CompetitionSession} from '../../../packages/learning-engine/competition-session';
import {CompetitionResults} from './CompetitionResults';
import {AttemptFeedback} from '../../../packages/learning-engine/attempt-feedback';

type Panel='settings'|'sections'|'history'|'voice'|null;
type Summary={score:number|null;cue:string;coverage:number};
type HistoryEntry={date:string;section:string;score:number|null;revision_id?:string;configuration?:string;start?:number;end?:number};
const stamp=(t:number)=>`${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')}`;
const clamp01=(value:number)=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
export function PracticeWorkspace({lesson,player,onBack,onEdit,editable,notice,onDirty,initialMode='practice',onModeChange,onPracticeSection,initialSettings,onSettings,restoredAt}:{restoredAt?:number|null;initialSettings?:PracticePreferences;onSettings?:(value:PracticePreferences)=>void;initialMode?:'practice'|'compete';onModeChange?:(mode:'watch'|'practice'|'compete')=>void;onPracticeSection?:(index:number)=>void;lesson:LessonManifest;player:Playback;onBack:()=>void;onEdit:()=>void;editable:boolean;notice:string;onDirty?:(value:boolean)=>void}){
 const [session]=useState(()=>{const value=new PracticeSession(player);if(initialMode==='practice'&&initialSettings){value.loop=initialSettings.loop;value.countdownSeconds=initialSettings.countdown;value.repetitions=initialSettings.repetitions;value.restSeconds=initialSettings.rest;}return value;});
 const camera=useRef<MimicHandle>(null),shell=useRef<HTMLElement>(null);
 const practiceDock=useRef<HTMLDivElement>(null);
 const [positionIntent,setPositionIntent]=useState<'initial'|'saved'|'selected'|'position'|'started'>(
  restoredAt ? 'saved' : 'initial'
 );
 useEffect(()=>{
  if(restoredAt)setPositionIntent(intent=>intent==='initial'?'saved':intent);
 },[restoredAt]);

 const positionIntentRef=useRef(positionIntent);
 positionIntentRef.current=positionIntent;
 const [voiceStatus,setVoiceStatus]=useState('checking');
 const [voiceChoiceMade,setVoiceChoiceMade]=useState(false);
 const [voicePrompt,setVoicePrompt]=useState<'idle'|'requesting'|'fallback'>('idle');
 const [voiceFailure,setVoiceFailure]=useState('');
 const pendingVoiceStart=useRef<(()=>void)|null>(null);
 const receiveVoiceStatus=(state:string,error?:string)=>{
  setVoiceStatus(state);
  if(error)setVoiceFailure(error);
  else if(state==='starting'||state==='listening')setVoiceFailure('');
  if(!pendingVoiceStart.current)return;
  if(state==='listening'){
   const begin=pendingVoiceStart.current;
   pendingVoiceStart.current=null;
   setVoiceChoiceMade(true);
   setVoicePrompt('idle');
   begin();
  }else if(error){
   setVoicePrompt('fallback');
  }
 };
 const [competition]=useState(()=>{const value=new CompetitionSession(session);if(initialMode==='compete')value.enter();return value;});
 const [instructorOnly,setInstructorOnly]=useState(initialMode==='practice'&&(initialSettings?.instructorOnly??true));
 const instructorOnlyRef=useRef(instructorOnly);instructorOnlyRef.current=instructorOnly;
 const settingsCallback=useRef(onSettings);settingsCallback.current=onSettings;
 useEffect(()=>()=>{if(!competition.enabled)settingsCallback.current?.({time:player.state.time,speed:player.state.speed,mode:player.state.mode,range:null,loop:session.loop,countdown:session.countdownSeconds,repetitions:session.repetitions,rest:session.restSeconds,instructorOnly:instructorOnlyRef.current});},[session,player,competition]);
 const [runResultsOpen,setRunResultsOpen]=useState(false);
 const practiceView=useRef({angle:0,source:false,companion:false,rhythm:false});
 const [,redraw]=useState(0),[panel,setPanel]=useState<Panel>(null),[query,setQuery]=useState(''),[source,setSource]=useState(initialMode==='practice'&&Boolean(lesson.source_video)),[companion,setCompanion]=useState(false),[angle,setAngle]=useState(0),[large,setLarge]=useState(false),[layout,setLayout]=useState<'combined'|'separate'|'instructor'>(initialMode==='practice'&&lesson.source_video?'separate':matchMedia('(max-width:700px)').matches?'combined':'separate');
 const threeDView=useRef<{layout:'combined'|'separate'|'instructor';angle:number}>({layout:'separate',angle:0});
 const [setupNotice,setSetupNotice]=useState('');
 const cameraCompanion=useRef(false);
 const changeInstructor=(value:'3d'|'video'|'both')=>{
  const wasVideo=source||companion;cameraCompanion.current=false;
  setSetupNotice('');
  if(value!=='3d'){
   if(!wasVideo)threeDView.current={layout,angle};
   if(!instructorOnly&&layout!=='separate')setSetupNotice('Switched to Side by side.');
   setLayout('separate');setAngle(0);
  }else if(wasVideo){
   setLayout(threeDView.current.layout);setAngle(threeDView.current.angle);
   if(!instructorOnly&&threeDView.current.layout!=='separate')setSetupNotice('Previous 3D arrangement restored.');
  }
  setSource(value==='video');setCompanion(value==='both');
 };

 const [reviewSummary,setReviewSummary]=useState<Summary>({score:null,cue:'',coverage:0}),[review,setReview]=useState<Attempt|null>(null),[history,setHistory]=useState<HistoryEntry[]>([]),[hint,setHint]=useState('Watch the instructor, or start live practice for camera feedback. Video is not saved.'),[countSound,setCountSound]=useState(false);
 const [saveHistory,setSaveHistory]=useState(false),saveHistoryRef=useRef(false);saveHistoryRef.current=saveHistory;
 const [cameraState,setCameraState]=useState<CameraState>('off'),cameraLifecycle=useRef<CameraState>('off');
 // Which choices this device can honour; the device list is readable without a prompt.
 const [cameraFacings,setCameraFacings]=useState<FacingAvailability>({front:false,rear:false,single:true,count:0});
 const [setupController]=useState(()=>new CameraSetupController());
 const [setupIntent,setSetupIntent]=useState<SetupIntent|null>(null),[setupFacing,setSetupFacing]=useState<'user'|'environment'>('user');
 const [cameraRequest,setCameraRequest]=useState<CameraRequest>(()=>loadPreference(browserPreferenceStore())),[cameraDevices,setCameraDevices]=useState<CameraDevice[]>([]),[cameraNote,setCameraNote]=useState('');
 // Screen mirroring shows this phone's screen and nothing else, so presentation
 // mode makes the phone's own layout the large-screen layout.
 const [presenting,setPresenting]=useState(false),[presentSize,setPresentSize]=useState({width:0,height:0});
 const togglePresentation=useCallback(()=>{
  const next=!presenting;
  setPresenting(next);setReview(null);
  setHint(next?'Mirroring on. Start screen mirroring first: iPhone Control Centre → Screen Mirroring; Android quick settings → Cast. Tap the screen for controls.':'Mirroring off. Controls and instructions are back on the phone.');
 },[presenting]);
 const setupIntentRef=useRef<SetupIntent|null>(null);setupIntentRef.current=setupIntent;
 const setupStartedCamera=useRef(false),handoffInFlight=useRef(false);
 const receiveCameraState=useCallback((state:CameraState)=>{const previous=cameraLifecycle.current;cameraLifecycle.current=state;setCameraState(state);if(setupIntentRef.current)return;if(!instructorOnlyRef.current&&state==='off'&&previous!=='off'){session.pause('camera stopped');stopSharingRef.current?.();setHint('Practice ended. Choose Start practice to turn your camera on again.');}if(state==='live')setHint('Choose Play when you are ready.');},[session]);
 const [replayMode,setReplayMode]=useState(false),[viewReset,setViewReset]=useState(0);
 const [takeOpen,setTakeOpen]=useState(false),[saveState,setSaveState]=useState<'idle'|'preparing'|'shared'|'downloaded'|'error'>('idle'),[takeError,setTakeError]=useState(''),[takeSaved,setTakeSaved]=useState(false);
 const takePending=useRef(false),takeActive=useRef(false),recordNext=useRef(false),savedTake=useRef(false);
 const attemptFeedback=useRef(new AttemptFeedback()).current;
 const receiveSummary=useCallback((value:Summary)=>{if(!instructorOnlyRef.current&&session.phase==='playing'){if(competition.enabled)competition.sample(player.state.time,value);else attemptFeedback.sample(value);}},[session,attemptFeedback,competition,player]);
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
 const referenceRef=useRef<'3d'|'video'|'both'>('3d');referenceRef.current=source?'video':companion?'both':'3d';
 // Guided setup owns entry, the surface, cancellation and the single handoff.
 // The entry action records the intent and opens the preparation stage, where the
 // person positions themselves. Choosing a camera feed in Practice settings opens
 // that feed instead (see chooseCamera); navigating to this screen never does.
 const startSetup=useCallback((intent:SetupIntent)=>{
  if(instructorOnlyRef.current)return;
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
 const [settingsRow,setSettingsRow]=useState<string|null>(null);
 const [historyError,setHistoryError]=useState('');
 const [fullscreen,setFullscreen]=useState(false);
 const [instructorFocus,setInstructorFocus]=useState(false);
 const [timelineHidden,setTimelineHidden]=useState(false);
 const focusFullscreen=useRef(false);
 useEffect(()=>{
  const update=()=>{
   setFullscreen(Boolean(document.fullscreenElement));
   if(!document.fullscreenElement&&focusFullscreen.current){
    focusFullscreen.current=false;
    setInstructorFocus(false);
   }
  };
  document.addEventListener('fullscreenchange',update);
  return()=>document.removeEventListener('fullscreenchange',update);
 },[]);
 const toggleInstructorFocus=()=>{
  if(instructorFocus){
   setInstructorFocus(false);
   if(focusFullscreen.current&&document.fullscreenElement===shell.current){
    focusFullscreen.current=false;
    void document.exitFullscreen().catch(()=>{});
   }
   return;
  }
  setTimelineHidden(false);
  setInstructorFocus(true);
  const stage=shell.current;
  if(!document.fullscreenElement&&stage?.requestFullscreen){
   focusFullscreen.current=true;
   void stage.requestFullscreen().catch(()=>{focusFullscreen.current=false;});
  }
 };
 const [controlsVisible,setControlsVisible]=useState(true),[interaction,setInteraction]=useState(0);
 const wakeControls=()=>{setControlsVisible(true);setInteraction(n=>n+1);};
 useEffect(()=>{setControlsVisible(true);if(session.phase!=='playing'||panel||takeOpen)return;const timer=window.setTimeout(()=>setControlsVisible(false),3500);return()=>window.clearTimeout(timer);},[session.phase,panel,takeOpen,interaction]);
 const action=useCallback((c:PracticeAction,fromSettings=false)=>{if(pendingVoiceStart.current||(panelRef.current&&!fromSettings)||takeOpenRef.current||setupIntentRef.current)return;if(competition.enabled){
   if(c==='pause'||(c==='play'&&competition.running)){session.pause('stopped');redraw(n=>n+1);return;}
   if(c!=='play'&&c!=='resume'&&c!=='again')return;
   if(competition.running)return;
   const issue=camera.current?.readiness(connection.current.wasOnline)||camera.current?.scoringIssue();
   if(cameraLifecycle.current!=='live'||issue){setHint(issue||'Prepare your camera before starting a scored run.');return;}
   setRunResultsOpen(false);competition.start();redraw(n=>n+1);return;
  }if(['play','resume','again','next','back'].includes(c)){const issue=camera.current?.readiness(connection.current.wasOnline);if(issue){setHint(issue);if(recordNext.current){recordNext.current=false;}return;}}if(c==='slower'||c==='faster'){if(takeActive.current){takeActive.current=false;takePending.current=true;}recordingRef.current.stop();}setReplayMode(false);setReview(null);
  if((c==='play'||c==='resume')&&session.phase==='paused'){
   if(positionIntentRef.current==='saved'&&!session.range){
    session.select(Math.max(0,player.state.index));
   }else if(player.state.index<0){
    player.seek(session.bounds.start);
   }
  }
  session.action(c);redraw(n=>n+1);},[session,competition]);
 actionRef.current=action;
 useEffect(()=>{if(!pair)return;let disposed=false,timer=0;connection.current={sequence:0,ack:0,wasOnline:false,recovering:false};const poll=async()=>{try{
   const status=await pairRequest<PairStatus>(pair);if(disposed)return;setPairStatus(status);
   if(status.approved){const c=connection.current;if(c.wasOnline&&!status.receiver_online){session.pause('display disconnected');c.recovering=true;setHint('Display disconnected. Reconnect, then choose Play.');}c.wasOnline=status.receiver_online;
    for(const cmd of status.commands){if(cmd.sequence>c.ack){if(!c.recovering&&status.server_time-cmd.at<2500&&status.receiver_online)actionRef.current(cmd.action);c.ack=cmd.sequence;}}if(status.receiver_online)c.recovering=false;
    const s=player.state;await pairRequest(pair,'/state','PUT',{epoch:1,sequence:++c.sequence,time:s.time,speed:s.speed,playing:s.playing,phase:session.phase,remaining:session.remaining,index:s.index,end:session.bounds.end,ack:c.ack,angle:angleRef.current,reference:referenceRef.current,...camera.current?.display(),...presentation()});
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
 const open=(next:Panel)=>{if(pendingVoiceStart.current||competition.running||setupIntentRef.current)return;if(competition.enabled&&next!=='settings'&&next!=='voice')return;session.pause('settings');setReview(null);setPanel(next);redraw(n=>n+1);};
 const openSettings=(row:string|null=null)=>{setSettingsRow(row);open('settings');};
 const close=()=>{setPanel(null);setHint(competition.enabled?'Perform the full sequence without stopping.':'Paused. Choose Play when you are ready.');};
 const switchMode=(compete:boolean)=>{if(onModeChange){if(competition.running||recording.recording||recordNext.current)return;onModeChange(compete?'compete':'practice');return;}if(!compete&&onPracticeSection){onPracticeSection(-1);return;}if(compete===competition.enabled||competition.running||recording.recording||recordNext.current)return;setReview(null);setRunResultsOpen(false);setReplayMode(false);setPanel(null);recordNext.current=false;if(compete){instructorOnlyRef.current=false;setInstructorOnly(false);practiceView.current={angle,source,companion,rhythm};competition.enter();setAngle(0);setSource(false);setCompanion(false);setRhythm(false);setViewReset(n=>n+1);setHint('Full sequence · Normal speed · Scored');}else{competition.leave();setAngle(practiceView.current.angle);setSource(practiceView.current.source);setCompanion(practiceView.current.companion);setRhythm(practiceView.current.rhythm);setHint('Practice settings restored. Choose Play when ready.');}redraw(n=>n+1);};
 const practiseSection=(index:number)=>{if(onPracticeSection){onPracticeSection(index);return;}switchMode(false);session.select(index);setHint('Repeat this section at your own pace.');redraw(n=>n+1);};
 const changePracticeMode=(onlyInstructor:boolean)=>{
  if(competition.enabled||onlyInstructor===instructorOnlyRef.current)return;
  setSetupNotice('');session.pause('practice mode changed');recordNext.current=false;
  instructorOnlyRef.current=onlyInstructor;setInstructorOnly(onlyInstructor);
  if(onlyInstructor){
   stopSharingRef.current?.();camera.current?.stop();
   if(recording.recording){takeActive.current=false;takePending.current=true;recording.stop();}
   cameraCompanion.current=companion;if(companion){setSource(true);setSetupNotice('Showing Real instructor without camera feedback.');}
   setCompanion(false);setReplayMode(false);setReview(null);
  }else{
   if(cameraCompanion.current){setSource(false);setCompanion(true);}
   if((source||companion)&&layout!=='separate'){setLayout('separate');setSetupNotice('Switched to Side by side.');}
  }
  setHint(onlyInstructor?'Instructor only · no camera or scoring. Choose Play when ready.':'Choose Start practice to use camera feedback.');
 };
 // Enabling camera feedback re-renders the interface with the camera allowed, so the
 // feed opens after that render; starting it in the same click would be refused.
 const startFeedOnEnable=useRef(false);
 useEffect(()=>{if(!startFeedOnEnable.current)return;startFeedOnEnable.current=false;if(!instructorOnly&&cameraLifecycle.current==='off')void camera.current?.start();},[instructorOnly]);
 // Labels only appear after permission, so the options follow the device list at first
 // and are re-read once a camera is running or the hardware changes.
 useEffect(()=>{
  const media=navigator.mediaDevices;if(!media?.enumerateDevices)return;
  let live=true;
  const read=()=>{void media.enumerateDevices().then(list=>{if(!live)return;setCameraFacings(facingAvailability(normalizeDevices(list.filter(device=>device.kind==='videoinput')),camera.current?.selection()?.actualFacing??'unknown'));}).catch(()=>{});};
  read();
  const change=()=>read();
  media.addEventListener?.('devicechange',change);
  return()=>{live=false;media.removeEventListener?.('devicechange',change);};
 },[cameraState]);
 // One camera control: Off is instructor-only practice, Front and Rear pick the feed.
 // Off is a different axis from the device, so it stays a choice rather than a second row.
 // Picking a feed opens it straight away: this panel decides how practice looks, so the
 // stage has to show the real arrangement instead of waiting for a separate start.
 const chooseCamera=(value:'off'|'front'|'rear')=>{
  if(value==='off'){changePracticeMode(true);return;}
  const enabling=instructorOnlyRef.current;
  if(enabling)changePracticeMode(false);
  const request=camera.current?.request();
  if(request)void camera.current?.setCamera({...request,deviceId:'',facing:value});
  if(enabling)startFeedOnEnable.current=true;
  else if(cameraLifecycle.current==='off')void camera.current?.start();
  redraw(n=>n+1);
 };
 const beginPractice=()=>{
  if(instructorOnlyRef.current){
   action(offerNextSection?'next':'play');
   return;
  }

  setReplayMode(false);setReview(null);
  if(cameraState!=='off'){session.pause('practice ended');camera.current?.stop();return;}
  session.pause('starting practice');setHint('Starting live practice. No video is being recorded.');
  startSetup('start_practice');
 };
 const startTake=()=>{
  if(instructorOnlyRef.current)return;
  if(recording.recording)return;
  if(recording.url){session.pause('watch take');setTakeOpen(true);return;}
  if(cameraState!=='live'||!camera.current?.stream()){setHint('Start practice before recording.');return;}
  const issue=camera.current.readiness(connection.current.wasOnline);if(issue){setHint(issue);return;}
  panelRef.current=null;setPanel(null);
  setTakeOpen(false);setTakeError('');setReplayMode(false);
  if(session.phase==='playing'){takeActive.current=recording.begin(camera.current.stream(),player.state.time,player.state.speed);setHint('Recording your practice…');}
  else {if(session.phase!=='paused')session.pause('starting a take');recordNext.current=true;setHint('Recording starts after the count-in.');session.start(session.countdownSeconds);redraw(n=>n+1);}
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
  if(!camera.current?.stream()){setTakeOpen(false);openSettings('camera-selection');setHint('Enable your camera before recording another take.');return;}
  recording.remove();savedTake.current=false;setTakeSaved(false);setSaveState('idle');takePending.current=false;
  panelRef.current=null;setPanel(null);session.pause('restarting take');recordNext.current=true;
  takeOpenRef.current=false;setTakeOpen(false);setTakeError('');setHint('Get ready for your next take.');session.start(session.countdownSeconds);redraw(n=>n+1);
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
 useEffect(()=>{session.onPause=reason=>{recordNext.current=false;if(competition.interrupt(reason))setRunResultsOpen(true);};session.onAttemptStart=time=>{setPositionIntent('started');attemptFeedback.reset();if(recordNext.current){recordNext.current=false;takeActive.current=true;if(!recordingRef.current.begin(camera.current?.stream()??null,time,player.state.speed)){takeActive.current=false;}}};session.onAttempt=a=>{if(competition.enabled){competition.finish(a);if(competition.result)setRunResultsOpen(true);return;}if(takeActive.current){takeActive.current=false;recordingRef.current.stop();takePending.current=true;}if(a.completed&&!instructorOnlyRef.current){const result=attemptFeedback.result(),entry={date:new Date().toISOString(),section:player.current?.label??lesson.title,score:result.score,revision_id:lesson.revision_id,configuration:camera.current?.configuration()??'watch',start:a.start,end:a.end};setReviewSummary(result);setReview(a);setHistory(values=>[entry,...values].slice(0,100));if(saveHistoryRef.current)void request(`/lessons/${lesson.lesson_id}/attempts`,'POST',{id:a.id,scoring_version:'pose-v1',...entry,...result}).catch(()=>setHint('Attempt could not save. Your practice still works.'));}};return()=>{recordNext.current=false;session.onPause=undefined;session.onAttempt=undefined;session.onAttemptStart=undefined;};},[session,lesson,player,attemptFeedback,competition]);
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
 useEffect(()=>{
  const dock=practiceDock.current;
  if(!dock||typeof ResizeObserver==='undefined')return;
  const measure=()=>shell.current?.style.setProperty('--practice-dock-height',`${dock.getBoundingClientRect().height}px`);
  const observer=new ResizeObserver(measure);
  observer.observe(dock);
  measure();
  return()=>observer.disconnect();
 },[competition.enabled]);

 const compete=competition.enabled,runActive=competition.running;
 const cameraIssue=camera.current?.readiness(connection.current.wasOnline)||(compete&&cameraState==='live'?camera.current?.scoringIssue():'');
 const runReady=cameraState==='live'&&!cameraIssue&&!player.state.calibrating;
 const s=player.state,current=player.current??player.sections[0];
 const sectionFinished=instructorOnly&&session.phase==='paused'&&!session.range
  &&s.mode==='sections'&&s.index>=0&&s.time>=current.end-1e-6;
 const offerNextSection=sectionFinished&&s.index<player.sections.length-1;
 const offerVoiceStart=!voiceChoiceMade&&voiceStatus!=='listening'&&session.phase==='paused'&&cameraState==='off'&&!offerNextSection&&!sectionFinished;
 const requestVoiceStart=(begin=pendingVoiceStart.current??beginPractice)=>{
  pendingVoiceStart.current=begin;
  setVoicePrompt('requesting');
  camera.current?.startVoice();
 };
 const continueWithoutVoice=()=>{
  const begin=pendingVoiceStart.current??beginPractice;
  pendingVoiceStart.current=null;
  camera.current?.stopVoice();
  setVoiceChoiceMade(true);
  setVoicePrompt('idle');
  begin();
 };
 const cancelVoiceStart=()=>{
  pendingVoiceStart.current=null;
  camera.current?.stopVoice();
  setVoicePrompt('idle');
 };
 const togglePractice=()=>{
  if(voicePrompt==='requesting')return;
  if(offerVoiceStart)requestVoiceStart(beginPractice);
  else {setVoiceChoiceMade(true);beginPractice();}
 };
 const hasProgress=s.time>0.05;
 const sequenceFinished=instructorOnly&&session.phase==='paused'&&!session.range&&s.time>=lesson.duration-1e-6;
 const practiceFinished=sequenceFinished||(sectionFinished&&!offerNextSection);
 const instructorAction=offerNextSection?'Next section'
  :practiceFinished?'Practise again'
  :session.phase!=='paused'?'Pause practice'
  :positionIntent==='saved'?`Resume section ${Math.max(1,s.index+1)}`
  :positionIntent==='selected'?`Start section ${Math.max(1,s.index+1)}`
  :positionIntent==='started'||positionIntent==='position'||hasProgress?'Resume practice'
  :'Start practice';
 const beginFromStart=()=>{
  session.select(0);
  setPositionIntent('selected');
  if(instructorOnlyRef.current||cameraLifecycle.current==='live')action('play');
  else beginPractice();
 };
 const startOver=()=>{
  if(offerVoiceStart)requestVoiceStart(beginFromStart);
  else beginFromStart();
 };
 const runPrimaryAction=()=>{
  if(instructorOnly&&practiceFinished){startOver();return;}
  togglePractice();
 };

 const sections=player.sections.filter(section=>section.label.toLowerCase().includes(query.toLowerCase()));
 const instructorName=source?(lesson.focused_video?'Real instructor':'Original video'):companion?'Both':'3D instructor';
 const cameraFacing=camera.current?.request().facing??'front';
 const rearAvailable=cameraFacings.rear;
 const frontAvailable=cameraFacings.single||cameraFacings.front;
 const cameraChoice:'off'|'front'|'rear'=instructorOnly?'off':rearAvailable&&cameraFacing==='rear'?'rear':frontAvailable?'front':'rear';
 const cameraName=cameraFacings.single?'Camera':cameraChoice==='rear'?'Rear':'Front';
 const cameraOptions:{value:'off'|'front'|'rear';label:string}[]=[
  {value:'off',label:'Off'},
  ...(frontAvailable?[{value:'front' as const,label:cameraFacings.single?'Camera':'Front'}]:[]),
  ...(rearAvailable?[{value:'rear' as const,label:'Rear'}]:[]),
 ];
 const layoutName=layout==='combined'?'Together':layout==='instructor'?'Side by side · Emphasised':'Side by side';
 // Viewing angle is a viewport control, so it stays with the instructor it rotates.
 const showAngleControl=!source&&!companion&&!compete&&!presenting&&!setupIntent;
 const reference=(framing:PracticeFraming)=><div className="motion-stage"><MotionStage lesson={lesson} player={player} source={source} companion={companion} onVideoUnavailable={()=>{if(competition.running)session.pause('instructor video interrupted');}} locked={compete} immersive={companion||!framing.active} fit={presenting&&!framing.active?'envelope':'none'} interactive={!presenting&&!instructorFocus} framing={{...framing,active:companion?false:framing.active,angle,resetVersion:viewReset}}/><span className="practice-reference-label">{source?lesson.focused_video?'Real instructor':'Original video':'3D instructor'}</span>{showAngleControl&&<ViewAngleControl angle={angle} onAngle={setAngle} onRecentre={()=>setViewReset(n=>n+1)}/>}</div>;
 const voiceEnabled=voiceStatus==='starting'||voiceStatus==='listening'||voiceStatus==='reconnecting';
 const voiceLabel=voiceStatus==='listening'?'Voice on':voiceStatus==='starting'?'Voice starting':voiceStatus==='reconnecting'?'Voice reconnecting':'Voice off';
 const voiceControl=(
  <button className="practice-voice-status player-tool" aria-label={voiceLabel} title={voiceLabel} aria-haspopup="dialog" onClick={()=>open('voice')}>
   {voiceEnabled?<Mic size={18} aria-hidden="true"/>:<MicOff size={18} aria-hidden="true"/>}
   <span className="player-voice-label">{voiceLabel}</span>
  </button>
 );
 const modeControl=onModeChange&&<label className="lesson-mode-control"><span className="feed-sr-only">Lesson mode</span><select aria-label="Lesson mode" value={compete?'compete':'practice'} disabled={runActive||recording.recording||Boolean(setupIntent)||voicePrompt==='requesting'} onChange={event=>onModeChange(event.target.value as 'watch'|'practice'|'compete')}><option value="watch">Watch</option><option value="practice">Practice</option><option value="compete">Challenge</option></select></label>;
 const focusActive=instructorFocus&&instructorOnly&&!compete;
 const presentLayout=compareLayout(presentSize.width,presentSize.height);
 const presentStyle=presenting?({
  '--present-columns':`minmax(0,${presentLayout.cameraShare}fr) minmax(0,${presentLayout.instructorShare}fr)`,
  '--present-rows':`minmax(0,${presentLayout.cameraShare}fr) minmax(0,${presentLayout.instructorShare}fr)`,
 } as unknown as CSSProperties):undefined;
 return <PracticeSettingsProvider row={settingsRow} setRow={setSettingsRow}><section ref={shell} onPointerDownCapture={wakeControls} onFocusCapture={wakeControls} onKeyDown={event=>{
  if(event.key==='Escape'&&focusActive&&!panel&&!document.fullscreenElement)toggleInstructorFocus();
 }} data-present-axis={presenting?presentLayout.axis:undefined} style={presentStyle} className={`mimic-shell mimic-immersive ${panel==='settings'?'settings-open':''} ${focusActive?'instructor-focus':''} ${focusActive&&timelineHidden?'focus-timeline-hidden':''} ${presenting?'is-presenting':''} ${setupIntent?'is-setting-up':''} ${instructorOnly?'instructor-only':''} ${compete?'mode-compete':'mode-practice minimal-practice'} ${cameraState==='off'?'is-watching':'is-practising'} ${session.phase==='playing'?'is-playing':''} ${controlsVisible?'':'controls-resting'} ${large?'large-display':''}`} aria-label="Practice workspace">
  <header className="mimic-header" inert={Boolean(setupIntent)||Boolean(panel)||voicePrompt==='fallback'||undefined}><button className="mimic-icon-button" aria-label="Exit" onClick={leavePractice}><ArrowLeft size={22}/></button><div><span className="mimic-eyebrow">MIMIC / {compete?'CHALLENGE':instructorOnly?'INSTRUCTOR ONLY':cameraState==='off'?'WATCH':'PRACTICE'}</span><strong>{lesson.title}</strong><span>{pair?pairStatus?.approved?pairStatus.receiver_online?'Display connected':'Display reconnecting':'Display awaiting approval':'Learn the movement. Make it yours.'}</span></div>{instructorOnly&&!compete&&<button className="mimic-icon-button instructor-focus-toggle" aria-label={focusActive?'Exit instructor fullscreen':'Fullscreen instructor'} title={focusActive?'Exit instructor fullscreen':'Fullscreen instructor'} disabled={voicePrompt==='requesting'} onClick={toggleInstructorFocus}>{focusActive?<Minimize size={20}/>:<Maximize size={20}/>}</button>}{focusActive&&<button className="focus-timeline-toggle" aria-controls="practice-section-timeline" aria-expanded={!timelineHidden} onClick={()=>setTimelineHidden(hidden=>!hidden)}>{timelineHidden?'Show controls':'Hide controls'}</button>}{focusActive&&offerNextSection&&<button className="focus-next-section" onClick={()=>action('next')}>Next section</button>}<button className="practice-settings-button" disabled={runActive} onClick={()=>openSettings()}><Settings2 size={18}/><span>Practice settings</span></button></header>
  {/* The settings drawer is a side panel on desktop, so the stage stays live: an
      angle change or preview is visible while the settings are being adjusted.
      Every other panel covers the stage and keeps it inert. */}
  <main className="mimic-stage" inert={Boolean(setupIntent)||(panel!==null&&panel!=='settings')||voicePrompt==='fallback'||undefined}><div className="live-practice-layer" hidden={replayMode}><MimicInterface ref={camera} lesson={lesson} player={player} onCommand={action} onVoiceStatus={receiveVoiceStatus} renderReference={reference} onClose={close} cameraEnabled={!instructorOnly} layout={instructorOnly||presenting||source?'separate':layout} angle={angle} onSummary={receiveSummary} onCameraState={receiveCameraState} competition={compete} setup={setupIntent?setupController:undefined} onRequestSetup={()=>startSetup('setup_only')}/></div>{replayMode&&recording.url&&<ReplayStage lesson={lesson} player={player} url={recording.url} start={recording.startTime.current} rate={recording.speed.current} onClose={()=>setReplayMode(false)}/>}
   {rhythm&&session.phase==='playing'&&<span className="practice-beat">Count {Math.floor(s.time*bpm/60)%8+1} / 8</span>}
   {(session.phase==='countdown'||session.phase==='rest')&&<div className="practice-countdown" role="status"><strong>{Math.ceil(session.remaining)}</strong><span>{session.phase==='rest'?'Rest · next repetition':'Get ready'}</span><button onClick={()=>action('pause')}>Cancel</button></div>}
   {!compete&&review&&session.phase==='paused'&&!panel&&<div className="practice-review"><strong>Section complete</strong><p>{reviewSummary.score===null?'No reliable comparison for this attempt.':`${reviewSummary.score}% approximate similarity. `}{reviewSummary.cue||'Try again or continue.'}</p><button onClick={()=>action('again')}>Repeat</button><button onClick={()=>action('next')}>Next</button><button onClick={()=>setReview(null)}>Dismiss</button></div>}
  </main>
  {compete&&<div className="mimic-context" inert={Boolean(setupIntent)||Boolean(panel)||voicePrompt==='fallback'||undefined}><span className="compete-rule">FULL SEQUENCE · 1× · SCORED</span><h2>{runActive?current.label:'One complete performance'}</h2><div className="mimic-status" role="status">{runActive?session.phase==='countdown'?'Get into position. Your run starts after the countdown.':'Scored run in progress · Finish without stopping':cameraState==='off'?'Prepare your camera, then perform the full sequence without stopping.':cameraState==='starting'?'Starting camera…':cameraIssue||'Ready for a scored run. Your result appears after you finish.'}</div></div>}
  {panel==='voice'&&<PracticePanel title="Voice commands" onClose={close}>
   <p>Say “Start,” “Pause,” “Next,” “Back,” “Repeat,” “Slower,” “Faster,” or “Loop.”</p>
   <p>Uses the app or browser speech service. The app does not save microphone audio.</p>
   <p role="status">{voiceLabel}</p>
   {voiceFailure&&<p role="alert">{voiceFailure}</p>}
   {voiceStatus==='unavailable'&&<p>Voice recognition is unavailable in this browser.</p>}
   <button disabled={voiceStatus==='checking'||voiceStatus==='unavailable'} onClick={()=>{
    if(voiceEnabled)camera.current?.stopVoice();
    else camera.current?.startVoice();
   }}>{voiceEnabled?'Turn off voice commands':'Enable voice commands'}</button>
  </PracticePanel>}
  {voicePrompt==='fallback'&&<PracticePanel title="Practise with or without voice" onClose={cancelVoiceStart}>
   <p>Voice commands are off. Tap Next section after each section, or enable voice to advance from where you’re standing.</p>
   {voiceFailure&&<p role="status">{voiceFailure}</p>}
   {/permission|blocked/i.test(voiceFailure)&&<p>If the browser blocked access, allow Microphone in the site permissions beside the address bar, then try again.</p>}
   <button onClick={continueWithoutVoice}>Continue without voice</button>
   <button disabled={voiceStatus==='unavailable'} onClick={()=>requestVoiceStart()}>Enable voice</button>
  </PracticePanel>}
  {takeOpen&&recording.url&&<PracticePanel title="Your take" onClose={()=>setTakeOpen(false)} className="take-panel">
    <video className="take-video" src={recording.url} controls playsInline aria-label="Your recorded take"/>
    <div className="take-actions"><button className="primary" disabled={saveState==='preparing'} onClick={()=>void saveTake()}>{saveState==='preparing'?'Preparing…':'Save video'}</button><button className="secondary" disabled={saveState==='preparing'} onClick={()=>{setTakeOpen(false);setReplayMode(true);}}>Compare with instructor</button><button className="secondary" disabled={saveState==='preparing'||cameraState!=='live'||!!camera.current?.readiness(connection.current.wasOnline)} onClick={restartTake}>Record another</button><button className="secondary" disabled={saveState==='preparing'} onClick={discardTake}>Discard</button></div>
    {saveState==='shared'&&<p role="status">Share sheet closed. Check that you kept a copy.</p>}
    {saveState==='downloaded'&&<p role="status">Download requested. Check your downloads for the video.</p>}
    {(saveState==='shared'||saveState==='downloaded')&&!takeSaved&&<button onClick={()=>{savedTake.current=true;setTakeSaved(true);}}>I have saved a copy</button>}
    {recording.stopReason&&<p role="status">{recording.stopReason}</p>}
    {takeError&&<p role="alert">{takeError}</p>}
    <p className="small muted">Video only · no audio. Kept in this page until you leave. Nothing is uploaded.</p>
  </PracticePanel>}
  {compete?<footer className="mimic-dock compete-dock" inert={Boolean(setupIntent)||Boolean(panel)||voicePrompt==='fallback'||undefined}><div className="compete-preparation">{modeControl}<span>Personal challenge</span><p>Full sequence · 1× speed · Front view · Camera scoring · 5s preparation.</p></div>
   {!runActive&&<div className="compete-setup-actions"><button onClick={()=>startSetup('setup_only')}>Camera setup</button><button onClick={()=>openSettings('instructor-type')}>Instructor</button><button onClick={()=>openSettings('tv-presentation')}>Connected display</button><button onClick={()=>switchMode(false)}>Back to practice</button></div>}
   {!runActive&&voiceControl}
   {competition.result&&!runActive&&<button onClick={()=>setRunResultsOpen(true)}>Review result</button>}
   <button className="practice-session-toggle" disabled={!runActive&&cameraState!=='off'&&!runReady} onClick={()=>{if(runActive)action('pause');else if(cameraState==='off')startSetup('start_compete');else action('play');}}><Camera size={16}/>{runActive?'Stop run':cameraState==='off'?'Prepare challenge':cameraState==='starting'?'Starting camera…':'Start scored run'}</button>
   {cameraState!=='off'&&!runActive&&<button onClick={()=>camera.current?.stop()}>{cameraState==='starting'?'Cancel camera setup':'Turn camera off'}</button>}
   <div className="compete-progress"><span>{stamp(s.time)}</span><progress aria-label="Run progress" value={s.time} max={lesson.duration}/><span>{stamp(lesson.duration)}</span></div>
  </footer>:
<div
   ref={practiceDock}
   id="practice-section-timeline"
   className="practice-player-dock"
   hidden={focusActive&&timelineHidden}
   inert={Boolean(setupIntent)||Boolean(panel)||voicePrompt==='fallback'||undefined}
  >
   <PracticeTimeline
    sections={player.sections} duration={lesson.duration} time={s.time} activeIndex={s.index} range={session.range}
    disabled={Boolean(setupIntent)||Boolean(panel)||voicePrompt!=='idle'||s.calibrating}
    onScrubStart={()=>{session.pause('scrubbing');setReview(null);redraw(n=>n+1);}}
    onSeek={time=>{session.seek(time);setPositionIntent('position');setReview(null);redraw(n=>n+1);}}
    onSelect={index=>{session.select(index);setPositionIntent('selected');setReview(null);redraw(n=>n+1);}}
    onBrowse={()=>open('sections')}
   />
   <div className="practice-player-toolbar">
    <div className="practice-player-actions">
     <button
      className="practice-player-primary"
      disabled={voicePrompt==='requesting'||(offerVoiceStart&&voiceStatus==='checking')}
      aria-pressed={instructorOnly?session.phase!=='paused':cameraState!=='off'}
      onClick={runPrimaryAction}
      title={offerVoiceStart?'Start with voice commands':''}
     >
      {session.phase!=='paused'&&instructorOnly?<Pause size={18} aria-hidden="true"/>:offerNextSection?<ChevronRight size={18} aria-hidden="true"/>:!instructorOnly?<Camera size={18} aria-hidden="true"/>:<Play size={18} aria-hidden="true"/>}
      <span>{voicePrompt==='requesting'?'Connecting…':instructorOnly?instructorAction:cameraState==='off'?'Start camera practice':cameraState==='starting'?'Cancel setup':'End practice'}</span>
     </button>
     {instructorOnly&&hasProgress&&session.phase==='paused'&&!sectionFinished&&(
      <button className="player-text-action" disabled={voicePrompt==='requesting'} onClick={startOver}>
       <RotateCcw size={14} aria-hidden="true"/><span>Start over</span>
      </button>
     )}
     {offerVoiceStart&&(
      <button className="player-text-action" onClick={continueWithoutVoice}>
       {voicePrompt==='requesting'?'Continue without voice':'Without voice'}
      </button>
     )}
     {offerNextSection&&<button className="player-text-action" onClick={()=>action('again')}>Repeat section</button>}
    </div>
    <div className="practice-player-tools">
     {modeControl}
     {voiceControl}
     <button className="player-tool player-speed" aria-label={`Playback speed ${s.speed}×`} title="Playback speed" onClick={()=>openSettings('speed')}>{s.speed}×</button>
     <button className="player-tool" aria-label="Practice settings" title="Practice settings" onClick={()=>openSettings()}><Settings2 size={19} aria-hidden="true"/></button>
     {instructorOnly&&<button className="player-tool" aria-label={focusActive?'Exit instructor fullscreen':'Fullscreen instructor'} title={focusActive?'Exit instructor fullscreen':'Fullscreen instructor'} disabled={voicePrompt==='requesting'} onClick={toggleInstructorFocus}>{focusActive?<Minimize size={19}/>:<Maximize size={19}/>}</button>}
    </div>
   </div>
   {!instructorOnly&&(
    <div className="practice-player-camera-actions">
     {cameraState==='live'&&(recording.recording||recordNext.current?<button className="record-take active" onClick={stopTake}>{recording.recording?'Stop recording':'Cancel recording'}</button>:!recording.url&&<button className="record-take" disabled={!!camera.current?.readiness(connection.current.wasOnline)||replayMode} onClick={startTake}><Video size={16}/>Record practice</button>)}
     {recording.url&&<button className="take-review-button" onClick={()=>{session.pause('review take');setTakeOpen(true);}}>Review take{takeSaved?'':' · not saved'}</button>}
     <button className="player-text-action" onClick={()=>open('history')}>Practice history</button>
    </div>
   )}
   <div className="practice-player-status" role="status">
    {recording.error||(recording.recording?'Recording your practice':cameraState==='starting'?'Starting camera…':voicePrompt==='requesting'?'Allow microphone access to begin':/could not|unavailable|failed/i.test(notice||hint)?notice||hint:'')}
   </div>
  </div>}

  {compete&&runResultsOpen&&competition.result&&<CompetitionResults result={competition.result} revision={lesson.revision_id} onClose={()=>setRunResultsOpen(false)} onRetry={()=>{setRunResultsOpen(false);if(cameraState==='off')void camera.current?.start();else action('play');}} onPractice={()=>switchMode(false)} onSection={practiseSection}/>}
  {panel==='settings'&&<PracticePanel title="Practice settings" onClose={close} drawer dismissOnBackdrop={false} modal={false} footer={<><span className="settings-footer-note">Changes apply immediately</span>{!compete&&<button className="settings-preview-toggle" onClick={()=>action(session.phase==='paused'?'play':'pause',true)}>{session.phase==='paused'?<Play size={15}/>:<Pause size={15}/>} {session.phase==='paused'?'Play preview':'Pause preview'}</button>}</>}>
   {compete&&<p className="settings-challenge-rules" role="status">Challenge rules: full sequence · 1× speed · front view · camera scoring · 5s preparation. Your practice preferences are kept separately.</p>}
   <SettingsGroup id="setup" title="Practice setup" summary={`${instructorName} · ${instructorOnly?'Camera off':cameraState==='live'?'Camera live':'Camera on'}`}>
    <SettingsRow id="practice-mode" label="Camera" value={instructorOnly?'Off':`${cameraName}${cameraState==='live'?' · live':''}`} disabledReason={compete?'Camera scoring is required in Challenge.':undefined} status={compete?'Fixed':undefined}>
     <SettingsChoices label="Camera" value={cameraChoice} options={cameraOptions} onChange={chooseCamera}/>
    </SettingsRow>
    <SettingsRow id="instructor-type" label="Instructor" value={instructorName} disabledReason={runActive?'Finish or stop your Challenge run before changing the instructor.':undefined}>
     <SettingsChoices label="Instructor" value={source?'video':companion?'both':'3d'} options={[{value:'3d',label:'3D'},{value:'video',label:'Real',disabled:!lesson.source_video},{value:'both',label:'Real + 3D',disabled:!lesson.source_video||instructorOnly}]} onChange={changeInstructor}/>
     {!lesson.source_video?<p>Real requires an instructor video for this lesson.</p>:instructorOnly&&<p>Real + 3D requires the camera.</p>}
    </SettingsRow>
    <SettingsRow id="layout" label="Arrangement" value={presenting?'Side by side · TV':layoutName} disabledReason={instructorOnly?'Camera is off. Your arrangement is remembered.':runActive?'Finish or stop your Challenge run before changing the arrangement.':presenting?'TV presentation uses Side by side. Turn it off below to use your remembered arrangement.':undefined} status={presenting?'Fixed':undefined}>
     <SettingsChoices label="Arrangement" value={presenting?'separate':layout==='instructor'?'separate':layout} options={[{value:'combined',label:'Together',disabled:source||companion},{value:'separate',label:'Side by side'}]} onChange={value=>{setLayout(value as 'combined'|'separate');setSetupNotice('');}}/>
     {(source||companion)&&<p>Real video requires Side by side. Your 3D arrangement is remembered.</p>}
    </SettingsRow>
    <SettingsRow id="instructor-emphasis" label="Emphasise instructor" value={layout==='instructor'?'On':'Off'} disabledReason={instructorOnly?'Turn the camera on above.':source||companion?'Requires the 3D instructor.':presenting?'Turn off TV presentation below.':layout==='combined'?'Choose Side by side above.':runActive?'Stop the Challenge run before changing emphasis.':undefined}>
     <label>Emphasise instructor<input type="checkbox" role="switch" checked={layout==='instructor'} onChange={event=>{setLayout(event.target.checked?'instructor':'separate');setSetupNotice('');}}/></label>
     <p>Uses a smaller camera preview. Auto-frame is unavailable while emphasis is On.</p>
    </SettingsRow>
    <SettingsMount slot="instructor"/>
    <SettingsMount slot="layout"/>
    {setupNotice&&<p className="settings-setup-notice" role="status">{setupNotice}</p>}
    <h4 className="settings-subheading">Camera & movement feedback</h4>
    {instructorOnly&&<p className="settings-disabled-reason">Disabled controls keep your saved preferences.</p>}
    <SettingsMount slot="camera"/>
    <SettingsRow id="recording" label="Practice recording" value={recording.recording?'Recording':recording.url?'Take ready':'Off'}>
     <button disabled={instructorOnly||compete||cameraState!=='live'||Boolean(cameraIssue)||recording.recording||Boolean(recording.url)} onClick={startTake}>Record practice</button>
     {(recording.recording||recordNext.current)&&<button onClick={stopTake}>Stop recording</button>}
     {recording.url&&<button onClick={()=>{close();setTakeOpen(true);}}>Review take</button>}
     <p>{compete?'Practice recording is available in Practice mode.':instructorOnly?'Turn the camera on above to record.':cameraState!=='live'?'Start camera practice before recording.':cameraIssue||'Video only. Recordings stay on this device until you save them.'}</p>
    </SettingsRow>
    <SettingsRow id="save-summaries" label="Save practice summaries" value={saveHistory?'On':'Off'} disabledReason={compete?'Challenge results are separate from practice summaries.':instructorOnly?'Turn the camera on above to save movement summaries.':!lesson.animation.key.startsWith('lessons/')?'Saved summaries require an account lesson.':undefined}>
     <label>Save summaries to my account<input type="checkbox" role="switch" checked={saveHistory} onChange={event=>setSaveHistory(event.target.checked)}/></label><p>Summaries only. This does not upload recordings.</p>
    </SettingsRow>
    <h4 className="settings-subheading">Screen presentation & connection</h4>
    <SettingsRow id="tv-presentation" label="TV presentation" value={presenting?'On':'Off'} disabledReason={runActive?'Stop your Challenge run before changing presentation.':undefined}>
     <button aria-pressed={presenting} onClick={togglePresentation}>{presenting?'Turn off TV presentation':'Enable TV presentation'}</button><p>Uses Side by side while On. Start Cast or screen mirroring on your device.</p>
    </SettingsRow>
    <SettingsRow id="pair-display" label="Pair another screen" value={pair?pairStatus?.approved?pairStatus.receiver_online?'Connected':'Reconnecting':'Awaiting approval':'Not connected'}>
     {!pair?<button onClick={()=>{setConnectionError('');request<Pair>('/mimic-pairs','POST',{lesson_id:lesson.lesson_id,revision_id:lesson.revision_id}).then(setPair).catch(e=>setConnectionError(e.message));}}>Create connection code</button>:<><strong className="pair-code">{pair.code}</strong><p>Enter this code on your other screen. Expires in 10 minutes.</p>{pairStatus?.pending&&!pairStatus.approved&&<button onClick={()=>void pairRequest(pair,'/approve','POST').catch(e=>setConnectionError(e.message))}>Approve display controls</button>}<button onClick={()=>{stopSharingRef.current?.();setPair(null);setPairStatus(null);setVideoSharing(false);}}>Disconnect</button></>}
     <button disabled={!videoSharing&&(instructorOnly||cameraState!=='live'||!pairStatus?.approved)} onClick={()=>void shareVideo()}>{videoSharing?'Stop sharing camera preview':'Share camera preview'}</button>
     {!videoSharing&&(instructorOnly||cameraState!=='live'||!pairStatus?.approved)&&<p>Camera sharing requires a live camera and an approved screen connection.</p>}
     {connectionError&&<p role="alert">{connectionError}</p>}
    </SettingsRow>
   </SettingsGroup>
   <SettingsGroup id="playback" title="Playback & timing" summary={compete?'Fixed for Challenge':`${s.speed}× · ${session.loop?'Repeat on':'Repeat off'}`} disabledReason={compete?'Fixed by Challenge rules above. Switch to Practice to edit.':undefined} status={compete?'Fixed':undefined}>
    <SettingsRow id="speed" label="Playback speed" value={`${s.speed}×`}><SettingsChoices label="Playback speed" value={s.speed} options={[.25,.5,.75,1].map(value=>({value,label:`${value}×`}))} onChange={value=>{player.speed(value);redraw(n=>n+1);}}/></SettingsRow>
    <SettingsRow id="repeat" label="Repeat automatically" value={session.loop?'On':'Off'}>
     <label>Repeat automatically<input type="checkbox" role="switch" checked={session.loop} onChange={event=>{session.loop=event.target.checked;redraw(n=>n+1);}}/></label>
     <label>Repetitions<select disabled={!session.loop} value={session.repetitions} onChange={event=>{session.repetitions=Number(event.target.value);session.completed=0;redraw(n=>n+1);}}>{[0,2,3,5,10].map(value=><option key={value} value={value}>{value||'Until stopped'}</option>)}</select></label>
     <label>Rest between repeats<select disabled={!session.loop} value={session.restSeconds} onChange={event=>{session.restSeconds=Number(event.target.value);redraw(n=>n+1);}}>{[0,2,5,10].map(value=><option key={value} value={value}>{value} seconds</option>)}</select></label>
     <p>{session.loop?'Repeats the current section.':'Enable Repeat automatically to adjust repetitions and rest. Your choices are remembered.'}</p>
    </SettingsRow>
    <SettingsRow id="countdown" label="Preparation countdown" value={session.countdownSeconds?`${session.countdownSeconds}s`:'Off'}>
     <SettingsChoices label="Preparation countdown" value={session.countdownSeconds} options={[0,3,5,10].map(value=>({value,label:value?`${value}s`:'Off'}))} onChange={value=>{session.countdownSeconds=value;redraw(n=>n+1);}}/>
     <label>Countdown sound<input type="checkbox" role="switch" disabled={!session.countdownSeconds} checked={countSound} onChange={event=>{setCountSound(event.target.checked);enableAudio();}}/></label>
     {!session.countdownSeconds&&<p>Countdown sound is unavailable while the countdown is Off. Your sound preference is remembered.</p>}
    </SettingsRow>
    <SettingsRow id="metronome" label="Metronome & eight-count" value={rhythm?`${bpm} BPM`:'Off'}>
     <label>Metronome & eight-count<input type="checkbox" role="switch" checked={rhythm} onChange={event=>{setRhythm(event.target.checked);enableAudio();}}/></label>
     <label>Tempo (BPM)<input type="number" disabled={!rhythm} min={30} max={240} value={bpm} onChange={event=>setBpm(Math.max(30,Math.min(240,Number(event.target.value)||100)))}/></label>
     <p>{rhythm?'Tempo is independent of playback speed.':'Enable the metronome to adjust tempo. Your tempo is remembered.'}</p>
    </SettingsRow>
   </SettingsGroup>
   <SettingsGroup id="display" title="Display" summary="Fullscreen & text size">
    <SettingsRow id="fullscreen" label="Fullscreen" value={fullscreen?'On':'Off'}><button onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen().catch(()=>setHint('Could not exit fullscreen.'));else void shell.current?.requestFullscreen?.().catch(()=>setHint('Fullscreen unavailable.'));}}>{fullscreen?'Exit fullscreen':'Enter fullscreen'}</button></SettingsRow>
    <SettingsRow id="large-text" label="Larger display text" value={large?'On':'Off'}><label>Larger display text<input type="checkbox" role="switch" checked={large} onChange={event=>setLarge(event.target.checked)}/></label></SettingsRow>
   </SettingsGroup>
  </PracticePanel>}
  {panel==='sections'&&<PracticePanel title="Sections" onClose={close}><input aria-label="Find section" placeholder="Find a section" value={query} onChange={e=>setQuery(e.target.value)}/><div className="practice-section-list">{sections.map(section=><button key={section.id} aria-current={section.id===current.id?'step':undefined} onClick={()=>{session.select(player.sections.indexOf(section));close();redraw(n=>n+1);}}>{section.label}</button>)}</div>{!sections.length&&<p>No matching sections.</p>}</PracticePanel>}
  {panel==='history'&&<PracticePanel title="Practice history" onClose={close}><button disabled={!lesson.animation.key.startsWith('lessons/')} onClick={()=>void request<HistoryEntry[]>(`/lessons/${lesson.lesson_id}/attempts`).then(setHistory).catch(e=>setHistoryError(e.message))}>Refresh saved history</button>{historyError&&<p role="alert">{historyError}</p>}{history.length?history.map((entry,index)=><article className="practice-history-entry" key={`${entry.date}-${index}`}><strong>{entry.section}</strong><span>{new Date(entry.date).toLocaleString()} · {entry.score==null?'No reliable comparison':`${entry.score}% approximate similarity`}</span>{entry.revision_id!==lesson.revision_id&&<p>Different lesson revision · scores may not be comparable.</p>}</article>):<p>No attempts yet. Completed practice summaries appear here.</p>}{editable&&<button onClick={onEdit}>Edit lesson sections</button>}</PracticePanel>}

{setupIntent&&<CameraSetup controller={setupController} getTransform={getSetupTransform} onBack={cancelSetup} onCancel={cancelSetup} onRetrySetup={()=>{setupController.dispatch({type:'retry_setup',now:performance.now()});redraw(n=>n+1);}} onRetryCamera={()=>{setupStartedCamera.current=true;setupController.dispatch({type:'retry_camera',now:performance.now()});void camera.current?.start();}} onConfirmControls={toggleControlsConfirmed} showControlsConfirmation={setupFacing==='environment'&&!pairStatus?.approved} cameraRequest={cameraRequest} cameras={cameraDevices} cameraNote={cameraNote} onSelectCamera={request=>void selectCamera(request)} onStartCamera={beginCameraSetup} onRefreshCameras={()=>void refreshCameraList()}/>}
 </section></PracticeSettingsProvider>;
}

function ReplayStage({lesson,player,url,start,rate,onClose}:{lesson:LessonManifest;player:Playback;url:string;start:number;rate:number;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{let frame=0;const tick=()=>{if(video.current)player.seek(Math.min(lesson.duration,start+video.current.currentTime*rate));frame=requestAnimationFrame(tick);};tick();return()=>cancelAnimationFrame(frame);},[player,lesson.duration,start,rate]);
 return <div className="practice-replay-grid"><video ref={video} src={url} controls playsInline/><MotionStage lesson={lesson} player={player}/><button className="replay-close" onClick={onClose}>Back to practice</button></div>;
}
