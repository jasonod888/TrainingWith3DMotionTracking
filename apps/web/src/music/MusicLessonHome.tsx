import {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {MusicLessonManifest} from '../../../../packages/lesson-schema/index';
import { assetUrl, request} from '../api';
import {
  activeEvents, currentSpan, parseMusicReference,
  bindMusicReference, pitchName, type MusicReference,
} from './music-reference';
import './music.css';
import '../practice.css';
import '../practice-player.css';
import {InstrumentGuideStage} from './renderers/InstrumentGuideStage';
import {PianoNoteRoll} from './PianoNoteRoll';
import {shiftOnset,clampOffsetSeconds} from './piano-playback';
import {usePianoSourcePlayer} from './usePianoSourcePlayer';
import {usePianoPreferences} from './piano-preferences';
import {usePianoPreviewAsset} from './usePianoPreviewAsset';
import {MidiKeyboardCheck} from './MidiKeyboardCheck';
const MusicHistoryPanel=lazy(()=>import('./MusicHistoryPanel').then(module=>({default:module.MusicHistoryPanel})));
import {attackSourceTime} from '../../../../packages/music-engine/onsets';
import {buildRunFeedback, calibrateLatency, effectiveFeedbackEnabled, feedbackEligibility, invalidFeedback, type Attack, type MusicFeedback, type RunClock} from './music-feedback';
import {FeedbackChoice, setFeedbackChoice} from './workspace/FeedbackChoice';
import {useFeedbackPreference} from '../feedback-preference';
import {MUSIC_CAPABILITIES, countInFromBeats, countInOptionsFromBeats, voiceControl, type PracticeCapabilities} from '../../../../packages/learning-engine/practice-capabilities';
import {emptyPracticeSnapshot} from '../../../../packages/learning-engine/practice-runtime';
import {musicPracticePlan} from '../practice/practice-plans';
import {createLocalPracticeStore} from '../practice/practice-store';
import {useMusicPractice} from '../practice/useMusicPractice';
import {usePracticeVoice} from '../practice/usePracticeVoice';
import {voiceCommandToPractice} from '../practice/practice-input';
import {PracticeShell} from '../practice/PracticeShell';
import {ExperienceModeSelector} from '../practice/ExperienceModeSelector';
import {experienceModeCapabilitiesFrom, experienceModeToLegacy} from '../../../../packages/learning-engine/experience-mode';

const label = (lesson: MusicLessonManifest) => lesson.subject === 'piano' ? 'Piano' : 'Guitar';
const mediaKeyHint = (source: string) => source ? 'Preparing practice…' : 'Practice needs a playable lesson source.';
const PRACTICE_SPEEDS = [0.5, 0.75, 1, 1.25] as const;
type PracticeSpeed = (typeof PRACTICE_SPEEDS)[number];
type SaveState = {id:string;state:'saving'|'saved'|'error';message?:string};

function timeLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

/**
 * Reviewed music lesson: instructor playback plus an animated guide.
 *
 * The reviewed reference is read and validated at runtime. It requests no camera,
 * microphone or MIDI access, offers no scoring, and keeps the original instructor audio.
 */
export function MusicLessonHome({lesson, onBack,onModeChange,midiSetupEnabled=false,musicHistoryEnabled=false,pianoLibrary=false,guitarLibrary=false}: {lesson: MusicLessonManifest; onBack: () => void;onModeChange?:(mode:'watch'|'practice'|'compete')=>void;midiSetupEnabled?:boolean;musicHistoryEnabled?:boolean;pianoLibrary?:boolean;guitarLibrary?:boolean}) {
  const [loaded,setLoaded]=useState<{identity:string;value:MusicReference}|null>(null);
  const identity=`${lesson.revision_id}:${lesson.reference.key}:${lesson.reference.sha256}`;
  const reference=loaded?.identity===identity?loaded.value:null;
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoFailed,setVideoFailed]=useState(false),[retry,setRetry]=useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const piano = useRef<HTMLAudioElement>(null);
  const {audioMode,setAudioMode,volume,setVolume}=usePianoPreferences();
  const [syncOffsetMs,setSyncOffsetMs]=useState(()=>Math.round((lesson.playback?.sync_offset_seconds??0)*1000));
  const syncOffset=syncOffsetMs/1000;
  const [loop,setLoop]=useState(false);
  const [loopStart,setLoopStart]=useState(0);
  const [loopEnd,setLoopEnd]=useState(0);
  const clock = useRef(0);
  const [captured,setCaptured]=useState(0);
  const [keyboardConnected,setKeyboardConnected]=useState(false);
  const [practiceSection,setPracticeSection]=useState('all');
  const [latency,setLatency]=useState<number|null>(null);
  const [calibration,setCalibration]=useState<{pulse:number;samples:number}|null>(null);
  const [feedback,setFeedback]=useState<MusicFeedback[]>([]);
  const [feedbackNotice,setFeedbackNotice]=useState('');
  const [feedbackEnabled,setFeedbackEnabled]=useFeedbackPreference(lesson.lesson_id);
  const effectiveAssessment=lesson.assessment;
  const lessonFeedbackEnabled=effectiveFeedbackEnabled(lesson);
  const [saves,setSaves]=useState<Record<string,SaveState>>({});
  const [historyRefresh,setHistoryRefresh]=useState(0);
  const [drawer,setDrawer]=useState<'sections'|'settings'|'midi'|null>(null);
  const saveSession=useRef(0),saveAlive=useRef(true),saveIdentity=useRef(identity);saveIdentity.current=identity;
  const saveEntries=useRef(new Map<string,{id:string;state:SaveState['state'];payload:Record<string,unknown>}>());
  const resetSaves=()=>{saveSession.current++;saveEntries.current.clear();setSaves({});};
  useEffect(()=>{saveAlive.current=true;return()=>{saveAlive.current=false;saveSession.current++;};},[identity]);
  const runs=useRef<{run:number;attacks:Attack[];clock:RunClock;complete:boolean}[]>([]);
  const runClock=useRef<RunClock|null>(null);
  const referenceRef=useRef<MusicReference|null>(null);referenceRef.current=reference;
  const latencyRef=useRef<number|null>(null);latencyRef.current=latency;
  const calibrationRef=useRef<{active:boolean;expected:number[];samples:number[]}>({active:false,expected:[],samples:[]});
  const calibrationTimer=useRef<number|null>(null);
  const calibrationFinish=useRef<number|null>(null);
  const cancelCalibration=()=>{
    if(calibrationTimer.current!==null)window.clearInterval(calibrationTimer.current);
    if(calibrationFinish.current!==null)window.clearTimeout(calibrationFinish.current);
    calibrationTimer.current=null;calibrationFinish.current=null;
    calibrationRef.current={active:false,expected:[],samples:[]};setCalibration(null);
  };
  const eligibility=feedbackEligibility({assessment:effectiveAssessment,subject:lesson.subject,
    referenceReviewed:lesson.reference_reviewed===true,inputSelected:keyboardConnected,latencyMeasured:latency!==null,
    creatorEnabled:lessonFeedbackEnabled});
  const eligibilityRef=useRef(eligibility);eligibilityRef.current=eligibility;
  const source = lesson.source_video && !videoFailed ? assetUrl(lesson.source_video.key) : '';
  const plan=useMemo(()=>musicPracticePlan(lesson),[lesson]);
  const practiceStore=useMemo(()=>createLocalPracticeStore(),[]);
  const countInSeconds=countInFromBeats(4,120);
  const capabilities=useMemo<PracticeCapabilities>(()=>({...MUSIC_CAPABILITIES,
    speeds:[0.5,0.75,1,1.25],
    countIn:{supported:true,value:countInSeconds,options:countInOptionsFromBeats([0,2,4],120)},
    rest:{supported:true,value:1.5,options:[0,1.5,3,5]},
  }),[countInSeconds]);
  const practice=useMusicPractice({plan,mediaRef:video,transportKey:source,capabilities,store:practiceStore});
  const snapshot=practice.snapshot;
  const practiceActive=Boolean(snapshot&&['countdown','playing','resting','buffering'].includes(snapshot.status));
  const voice=usePracticeVoice(command=>{
    const mapped=voiceCommandToPractice(command,{rates:PRACTICE_SPEEDS,rate:snapshot?.rate??1,loop:snapshot?.loop??false});
    if(mapped)practice.dispatch(mapped);
  });
  const liveCapabilities=useMemo<PracticeCapabilities>(()=>({...capabilities,
    voice:voiceControl(voice.status,voice.error,voice.supported)}),[capabilities,voice.status,voice.error,voice.supported]);

  useEffect(() => {
    let stopped = false;const abort=new AbortController();
    setLoaded(null);setError('');setTime(0);clock.current=0;setPlaying(false);setVideoFailed(false);
    setCaptured(0);setFeedback([]);setFeedbackNotice('');runs.current=[];runClock.current=null;resetSaves();cancelCalibration();setLatency(null);
    void fetch(assetUrl(lesson.reference.key), {signal:abort.signal,credentials:'same-origin',headers: {'Accept': 'application/json'}})
      .then(async response => {
        if (!response.ok) throw new Error('The reviewed reference could not be loaded.');
        const bytes=await response.arrayBuffer();
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
        if(bytes.byteLength!==lesson.reference.bytes||digest!==lesson.reference.sha256)throw new Error('The reference does not match its reviewed file. Reopen the lesson.');
        return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      })
      .then(value => { if (!stopped) setLoaded({identity,value:bindMusicReference(parseMusicReference(value),lesson)}); })
      .catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : 'The reviewed reference could not be loaded.'); });
    return () => { stopped = true;abort.abort(); };
  }, [identity,retry]);

  useEffect(() => {
    if (!playing || !reference) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(reference.duration, video.current ? video.current.currentTime : clock.current + (now - last) / 1000);
      last = now;
      clock.current = next;
      setTime(next);
      if (next >= reference.duration) {video.current?.pause();setPlaying(false);}
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, source, reference]);

  useEffect(()=>()=>{
    if(calibrationTimer.current!==null)window.clearInterval(calibrationTimer.current);
    if(calibrationFinish.current!==null)window.clearTimeout(calibrationFinish.current);
    calibrationRef.current.active=false;
  },[]);

  useEffect(()=>{const media=video.current;const pause=()=>{cancelCalibration();media?.pause();setPlaying(false);practice.dispatch({type:'action',action:'pause'});void practice.saveNow();};const hide=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',pause);return()=>{media?.pause();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',pause);};},[source,lesson.revision_id,reference,practice.dispatch,practice.saveNow]);

  const selectedUnit=plan.units.find(unit=>unit.id===practiceSection)??null;
  const seek = (value: number) => {
    if(practice.runtime)practice.dispatch({type:'seek',time:value});
    const next = Math.max(0, Math.min(reference?.duration ?? lesson.duration, value));
    clock.current = next;
    setTime(next);
    if (video.current) video.current.currentTime = next;
  };

  const toggle = async () => {
    setError('');
    if(practiceActive)practice.dispatch({type:'action',action:'pause'});
    if (!playing&&clock.current>=(reference?.duration??lesson.duration)-.01)seek(0);
    if (!video.current) { setPlaying(value => !value); return; }
    if (video.current.paused) {
      try { await video.current.play(); } catch { setError('Playback could not start. Press play again.'); }
    } else {
      video.current.pause();
    }
  };

  const stopPractice=(returnToStart=true)=>{
    practice.dispatch({type:'action',action:'pause'});
    setFeedback([]);setFeedbackNotice('');runs.current=[];runClock.current=null;resetSaves();setPlaying(false);
    const unit=selectedUnit??plan.units[0];
    if(returnToStart&&unit){clock.current=unit.start;setTime(unit.start);if(video.current)video.current.currentTime=unit.start;}
  };

  const initializedPlan=useRef<string|null>(null);
  useEffect(()=>{initializedPlan.current=null;},[plan.id]);
  const selectPracticeUnit=(id:string)=>{
    setPracticeSection(id);
    const index=id==='all'?0:plan.units.findIndex(unit=>unit.id===id);
    if(index>=0)practice.dispatch({type:'select',index});
  };
  const startFresh=()=>{
    if(!reference||calibrationRef.current.active)return;
    if(!source){setError('Practice needs the lesson video or audio source. Playback is unavailable for this lesson.');return;}
    if(initializedPlan.current!==plan.id){
      selectPracticeUnit(practiceSection);
      practice.dispatch({type:'set-mode',mode:practiceSection==='all'?'continuous':'sections'});
      initializedPlan.current=plan.id;
    }
    setFeedback([]);setFeedbackNotice('');runs.current=[];runClock.current=null;resetSaves();setCaptured(0);
    practice.dispatch({type:'action',action:'start'});
  };

  const dispatchPractice=(command:Parameters<typeof practice.dispatch>[0])=>{
    if(command.type==='action'&&command.action==='restart-lesson'){
      practice.dispatch({type:'set-mode',mode:'continuous'});
      practice.dispatch({type:'action',action:'restart-lesson'});
      return;
    }
    if(command.type==='action'&&(command.action==='start'||command.action==='play'||command.action==='resume')){
      if(snapshot?.status==='paused'&&snapshot.hasProgress){
        practice.dispatch({type:'action',action:snapshot.intent==='restored'?'resume':'play'});
        return;
      }
      startFresh();
      return;
    }
    practice.dispatch(command);
  };

  useEffect(()=>{
    if(snapshot?.status==='buffering')return;
    if(snapshot?.status!=='playing'){runClock.current=null;return;}
    if(runClock.current)return;
    const unit=plan.units[snapshot.unitIndex];if(!unit)return;
    const measured={wallStartMs:performance.now()-(snapshot.time-unit.start)*1000/Math.max(snapshot.rate,.01),
      sourceStart:unit.start,sourceEnd:unit.end,speed:snapshot.rate,inputLatencyMs:latencyRef.current??0};
    runClock.current=measured;
    runs.current.push({run:snapshot.run,attacks:[],clock:measured,complete:false});
    setCaptured(0);
  },[snapshot?.status,snapshot?.unitIndex,snapshot?.run,snapshot?.time,snapshot?.rate,plan]);

  useEffect(()=>{
    const attempt=practice.lastAttempt;if(!attempt)return;
    const run=runs.current.find(item=>item.run===snapshot?.run&&!item.complete)??runs.current.find(item=>!item.complete);
    if(!run)return;
    run.complete=true;
    const unit=plan.units[snapshot?.unitIndex??0];
    const gate=eligibilityRef.current;
    if(!attempt.completed){runClock.current=null;setFeedbackNotice('Practice was interrupted. This run is not scored.');return;}
    if(!lessonFeedbackEnabled){setFeedbackNotice('Feedback not enabled for this lesson.');}
    else if(feedbackEnabled&&gate.eligible&&referenceRef.current&&unit){
      setFeedback(previous=>[...previous,buildRunFeedback({reference:referenceRef.current!,sectionId:unit.id,
        start:unit.start,end:unit.end,speed:snapshot?.rate??1,run:run.run,attacks:run.attacks,
        latencyMs:latencyRef.current??0,latencyMeasured:latencyRef.current!==null})]);
    }else if(!feedbackEnabled){setFeedbackNotice('Feedback is Off. Ordinary practice playback remains available.');}
    else{setFeedbackNotice(gate.reasons[0]??'Feedback is unavailable until setup is complete.');}
    runClock.current=null;
  },[practice.lastAttempt,feedbackEnabled,lessonFeedbackEnabled]);

  useEffect(()=>{
    if(lessonFeedbackEnabled)return;
    setFeedback([]);
    setFeedbackNotice('Feedback not enabled for this lesson.');
    cancelCalibration();
  },[lessonFeedbackEnabled]);

  const handleAttack=useCallback(({pitch,timeStamp}:{pitch:number;timeStamp:number})=>{
    const calibrationState=calibrationRef.current;
    if(calibrationState.active){
      const expected=calibrationState.expected[calibrationState.expected.length-1];
      const offset=timeStamp-expected;
      if(Number.isFinite(offset)&&offset>=0&&offset<=300){
        // Consume at most one tap for this pulse; chords are not extra samples.
        calibrationState.expected.pop();
        calibrationState.samples.push(offset);
        setCalibration(value=>value?{...value,samples:calibrationState.samples.length}:value);
      }
      return;
    }
    const measured=runClock.current;
    if(document.hidden||snapshot?.status!=='playing'||!measured)return;
    if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(timeStamp))return;
    const sourceTime=attackSourceTime(timeStamp,measured);
    if(sourceTime==null)return;
    const run=runs.current.find(item=>item.run===snapshot.run&&!item.complete);
    if(!run)return;
    if(run.attacks.length>=20000){stopPractice(false);setFeedback([invalidFeedback('Too much input to analyse this run.',snapshot.run,plan.units[snapshot.unitIndex]?.id??'all')]);return;}
    run.attacks.push({id:`run-${snapshot.run}-${run.attacks.length}`,pitch,sourceTime});
    setCaptured(value=>value+1);
  },[snapshot?.status,snapshot?.run,snapshot?.unitIndex,plan]);

  const startCalibration=()=>{
    stopPractice(false);cancelCalibration();setLatency(null);
    calibrationRef.current={active:true,expected:[],samples:[]};
    setCalibration({pulse:0,samples:0});setFeedbackNotice('');
    let pulse=0;
    calibrationTimer.current=window.setInterval(()=>{
      pulse+=1;
      calibrationRef.current.expected.push(performance.now());
      setCalibration(value=>value?{...value,pulse}:value);
      if(pulse>=8){
        if(calibrationTimer.current)window.clearInterval(calibrationTimer.current);
        calibrationTimer.current=null;
        calibrationFinish.current=window.setTimeout(finishCalibration,700);
      }
    },600);
  };

  const finishCalibration=()=>{
    if(!calibrationRef.current.active)return;
    calibrationFinish.current=null;
    const samples=calibrationRef.current.samples;
    try{const measured=calibrateLatency(samples);setLatency(measured);setFeedbackNotice(`Personal timing alignment estimated at ${measured} ms; hardware latency is not measured.`);}
    catch{setFeedbackNotice('Not enough taps to measure delay. Play one note with each pulse and try again.');}
    calibrationRef.current={active:false,expected:[],samples:[]};
    setCalibration(null);
  };

  const saveRun=async(run:MusicFeedback)=>{
    if(!musicHistoryEnabled||!eligibilityRef.current.eligible||run.status!=='complete')return;
    const session=saveSession.current,view=identity;
    const key=`${session}:${run.run}-${run.window.start}-${run.window.end}`;
    let entry=saveEntries.current.get(key);
    if(entry?.state==='saving'||entry?.state==='saved')return;
    if(!entry){
      const id=crypto.randomUUID();
      entry={id,state:'saving',payload:{summary_version:1,status:'complete',id,save_requested:true,
        revision_id:lesson.revision_id,reference_sha256:lesson.reference.sha256,
        rubric_version:effectiveAssessment.rubric_version,section_id:run.sectionId,
        start:run.window.start,end:run.window.end,speed:run.speed,run:run.run,
        assessment:'unscored',alignment:run.latencyMeasured?'visual-estimate':'none',
        note_window:{total:run.total,eligible:run.assessed,matched:run.matched,missing:run.missing,extra:run.extra}}};
      saveEntries.current.set(key,entry);
    }
    entry.state='saving';setSaves(previous=>({...previous,[key]:{id:entry!.id,state:'saving'}}));
    const current=()=>saveAlive.current&&saveSession.current===session&&saveIdentity.current===view;
    try{
      await request(`/lessons/${encodeURIComponent(lesson.lesson_id)}/music-attempts`,'POST',entry.payload);
      if(!current())return;
      entry.state='saved';setSaves(previous=>({...previous,[key]:{id:entry!.id,state:'saved'}}));setHistoryRefresh(value=>value+1);
    }catch(error){
      if(!current())return;
      entry.state='error';setSaves(previous=>({...previous,[key]:{id:entry!.id,state:'error',message:error instanceof Error?error.message:'The summary was not saved.'}}));
    }
  };

  const preview=usePianoPreviewAsset(lesson.piano_preview);
  const player=usePianoSourcePlayer(video,piano,preview.url?audioMode:'original',syncOffset,`${identity}:${preview.url}`,()=>setAudioMode('original'));
  useEffect(()=>{setSyncOffsetMs(Math.round((lesson.playback?.sync_offset_seconds??0)*1000));setLoop(false);setLoopStart(0);setLoopEnd(lesson.duration);if(!lesson.piano_preview)setAudioMode('original');},[identity]);
  useEffect(()=>{if(video.current&&video.current.volume!==volume)video.current.volume=volume;});

  const shiftedReference=useMemo(()=>reference?{...reference,
    events:reference.events.map(event=>({...event,onset:shiftOnset(event.onset,syncOffset)})),
    spans:reference.spans.map(span=>({...span,start:span.start+syncOffset,end:span.end+syncOffset}))}:null,
    [reference,syncOffset]);
  const active = useMemo(() => shiftedReference ? activeEvents(shiftedReference, time) : [], [shiftedReference, time]);
  referenceRef.current=shiftedReference;
  const sectionIndex=sectionsAt(lesson.section_set.sections,time);
  const span = shiftedReference ? currentSpan(shiftedReference, time) : null;
  const sections = lesson.section_set.sections;

  const displaySnapshot=snapshot??emptyPracticeSnapshot(plan, mediaKeyHint(source));
  return <PracticeShell className="practice-runtime-music music-practice-shell" stageClassName="music-practice-stage"
    title={lesson.title} eyebrow={`${label(lesson).toUpperCase()} LESSON`} onBack={onBack}
    modeControl={onModeChange&&<ExperienceModeSelector compact current="practice"
      capabilities={experienceModeCapabilitiesFrom(liveCapabilities)}
      onSelect={mode=>onModeChange(experienceModeToLegacy(mode))}/>}
    plan={plan} snapshot={displaySnapshot} capabilities={liveCapabilities} voice={voice}
    onCommand={dispatchPractice} onSeek={value=>dispatchPractice({type:'seek',time:value})}
    onSelect={index=>dispatchPractice({type:'select',index})} onBrowse={()=>setDrawer('sections')}
    disabled={!snapshot} autoStartVoice
    status={!snapshot?(source?'starting':'Practice source unavailable'):practice.transportError||(practice.restoring?'Restoring your place…':undefined)}
    headerActions={<div className="music-practice-topbar-actions">
      <button type="button" aria-expanded={drawer==='sections'} aria-controls="music-practice-drawer"
        onClick={()=>setDrawer(value=>value==='sections'?null:'sections')}>Sections</button>
      <button type="button" aria-expanded={drawer==='settings'} aria-controls="music-practice-drawer"
        onClick={()=>setDrawer(value=>value==='settings'?null:'settings')}>Settings</button>
      {midiSetupEnabled&&(lesson.subject==='piano'||lesson.subject==='guitar')&&<button type="button" aria-expanded={drawer==='midi'} aria-controls="music-practice-drawer"
        onClick={()=>setDrawer(value=>value==='midi'?null:'midi')}>MIDI</button>}
    </div>}
    toolsBefore={<div className="music-audio-modes" role="group" aria-label="Playback audio">
      <button className={audioMode==='original'?'secondary active':'secondary'} aria-pressed={audioMode==='original'} onClick={()=>setAudioMode('original')}>Original</button>
      <button className={audioMode==='piano'?'secondary active':'secondary'} aria-pressed={audioMode==='piano'} disabled={!preview.url||!player.ready} onClick={()=>setAudioMode('piano')}>Piano</button>
    </div>}
    settingsExtra={<>
      <FeedbackChoice subject={lesson.subject} assessment={effectiveAssessment}
        referenceReviewed={lesson.reference_reviewed===true} inputSelected={keyboardConnected}
        inputMode="midi" microphoneAvailable={false} enabled={feedbackEnabled}
        lessonEnabled={lessonFeedbackEnabled}
        active={snapshot?.status==='playing'} onEnabledChange={value=>setFeedbackChoice(value,{
          eligible:eligibility.eligible,creatorEnabled:lessonFeedbackEnabled,
          cancel:()=>{},setEnabled:setFeedbackEnabled})}/>
      <label>Practice section<select aria-label="Practice section" value={practiceSection}
        onChange={event=>selectPracticeUnit(event.target.value)}><option value="all">Whole lesson</option>
        {plan.units.map(section=><option key={section.id} value={section.id}>{section.label}</option>)}</select></label>
      <label>Listening volume<input aria-label="Listening volume" type="range" min={0} max={1} step={.01}
        value={volume} onChange={event=>setVolume(Number(event.target.value))}/></label>
      <button type="button" onClick={()=>setDrawer('settings')}>All lesson settings</button>
      <p className="small muted">Practice is unscored. Count-in labels state beats at the lesson tempo; the scheduler uses seconds.</p>
    </>}
    stage={<>
      {error && <p className="inline-notice error-notice" role="alert">{error}<button onClick={()=>setRetry(value=>value+1)}>Retry reference</button></p>}
      {!reference && !error && <p role="status">Loading the reviewed reference…</p>}
      {reference && <>
        <div className="music-video music-stage-video">
          {source
            ? <video ref={video} src={source} playsInline preload="metadata"
                onVolumeChange={event=>setVolume(event.currentTarget.volume)}
                onLoadedMetadata={event=>{if(loopEnd===0)setLoopEnd(event.currentTarget.duration);}}
                onTimeUpdate={event => { const current=event.currentTarget.currentTime;
                  if(loop&&loopEnd>loopStart&&current>=loopEnd){event.currentTarget.currentTime=loopStart;clock.current=loopStart;setTime(loopStart);return;}
                  clock.current=current;setTime(current); }}
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
                onError={() => {setVideoFailed(true);setPlaying(false);}}/>
            : <div className="music-no-video">The original video is unavailable. The guide can still play on its own.</div>}
          <audio ref={piano} src={preview.url||undefined} preload="auto" hidden/>
        </div>
        {(displaySnapshot.status==='countdown'||active.length>0||span||displaySnapshot.status==='playing')&&<div className="music-stage-overlay">
          {displaySnapshot.status==='countdown'&&<div className="practice-count" role="status"><strong>{Math.max(1,Math.ceil(displaySnapshot.remaining))}</strong><span>Get ready</span></div>}
          <p className="music-now" role="status">
            {active.length ? active.map(event => pitchName(event.pitch)).join(' · ') : 'No note sounding'}
            {span && <span className="music-span"> · {span.start.toFixed(1)}–{span.end.toFixed(1)}s</span>}
            {displaySnapshot.status==='playing'?<span className="music-time"> · {displaySnapshot.time.toFixed(1)}s</span>:null}
          </p>
        </div>}
        <div className="music-stage-guide">
          <InstrumentGuideStage key={identity} reference={reference} active={active} time={time} pianoLibrary={pianoLibrary} guitarLibrary={guitarLibrary}/>
          <PianoNoteRoll events={reference.events.map(event=>({pitch:event.pitch,onset:event.onset,duration:event.duration??null}))}
            duration={reference.duration} time={time} offsetSeconds={syncOffset}/>
        </div>
        {(lesson.pedal?.length??0)>0&&<p className="small muted music-stage-note" data-pedal-active={lesson.pedal!.some(span=>time>=span.onset+syncOffset&&time<span.offset+syncOffset)}>Sustain pedal: {lesson.pedal!.some(span=>time>=span.onset+syncOffset&&time<span.offset+syncOffset)?'on':'off'} (estimated)</p>}
      </>}
    </>}>
    {reference&&<aside id="music-practice-drawer" className="practice-drawer music-practice-drawer" hidden={!drawer}
      aria-label="Lesson controls">
      <div className="music-drawer-head">
        <h2>{drawer==='sections'?'Sections':drawer==='midi'?'MIDI':'Settings'}</h2>
        <button type="button" className="back-link" onClick={()=>setDrawer(null)}>Close</button>
      </div>
      <div className="music-drawer-pane" hidden={drawer!=='sections'}>
      <div className="practice-panel-body">
        <ol className="music-sections" aria-label="Teaching sections">
          {sections.map(section => <li key={section.id}>
            <button className="secondary" aria-current={sectionIndex===sections.indexOf(section) ? 'step' : undefined}
              aria-label={`Seek to section ${section.label}`} onClick={() => seek(section.start)}>
              {section.label}<small>{section.start.toFixed(1)}–{section.end.toFixed(1)}s</small>
            </button>
          </li>)}
        </ol>
      </div></div>
      <div className="music-drawer-pane" hidden={drawer!=='settings'}>
      <div className="practice-panel-body">
        <div className="music-transport">
          <label className="music-sync">Sync
            <input aria-label="Sync offset in milliseconds" type="number" step={10} min={-10000} max={10000} value={syncOffsetMs} onChange={event=>setSyncOffsetMs(clampOffsetSeconds(Number(event.target.value)/1000)*1000)}/> ms (temporary)
          </label>
          <label className="music-sync"><input aria-label="Loop playback" type="checkbox" checked={loop} onChange={event=>setLoop(event.target.checked)}/> Loop</label>
          <label className="music-sync">from <input aria-label="Loop start" type="number" min={0} max={reference.duration} step={0.1} value={loopStart} onChange={event=>setLoopStart(Number(event.target.value))}/></label>
          <label className="music-sync">to <input aria-label="Loop end" type="number" min={0} max={reference.duration} step={0.1} value={loopEnd} onChange={event=>setLoopEnd(Number(event.target.value))}/></label>
          {!lesson.piano_preview&&<p className="small muted">Piano audio is unavailable for this lesson.</p>}
          {player.error&&<p role="alert">{player.error}</p>}
          {preview.error&&<p role="alert">{preview.error} <button onClick={preview.retry}>Retry piano audio</button></p>}
          {lesson.piano_preview&&!preview.url&&!preview.error&&<p role="status">Preparing piano audio. Original audio is available.</p>}
          <label>Listening volume<input aria-label="Listening volume" type="range" min={0} max={1} step={.01} value={volume} onChange={event=>setVolume(Number(event.target.value))}/></label>
          <input aria-label="Lesson position" type="range" min={0} max={reference.duration} step={0.01}
            value={Math.min(time, reference.duration)} onChange={event => seek(Number(event.target.value))}/>
          <span className="music-time">{timeLabel(time)} / {timeLabel(reference.duration)}</span>
        </div>
        {!snapshot?<div className="practice-setup" role="group" aria-label="Timed practice">
          <p className="small muted">Practice needs the reviewed lesson video or audio source. This lesson has no playable source in practice.</p>
        </div>:<div className="practice-setup" role="group" aria-label="Timed practice">
          <label>Practice section<select aria-label="Practice section" value={practiceSection} onChange={event=>selectPracticeUnit(event.target.value)}><option value="all">Whole lesson</option>{plan.units.map(section=><option key={section.id} value={section.id}>{section.label}</option>)}</select></label>
          <p className="small muted">Silent guide practice: use your instrument’s sound. Core speed, count-in and repeat controls live in Practice settings; count-in is measured at 120 beats per minute.</p>
        </div>}
        {snapshot&&<section className="music-practice" aria-label="Timed practice" role="status">
          <p className="practice-status">{snapshot.status==='playing'?'Practice in progress':snapshot.status==='countdown'?'Count-in':snapshot.status==='resting'?'Rest':snapshot.status==='buffering'?'Video buffering · practice time paused':snapshot.status==='section-complete'?'Section complete':snapshot.status==='lesson-complete'||practice.lastAttempt?.completed?'Practice complete':'Ready when you are'}
            {snapshot.status==='playing'?<span className="music-time"> · {snapshot.time.toFixed(1)}s</span>:null}</p>
          {snapshot.status==='buffering'&&<p className="small muted">Practice resumes from the same source position when the video is ready.</p>}
          {(snapshot.status==='lesson-complete'||practice.lastAttempt?.completed)&&<><p><strong>Practice complete</strong> · {keyboardConnected?`${captured} MIDI ${captured===1?'attack':'attacks'} counted locally`:'No keyboard input was measured'}. This run is unscored.{eligibility.eligible?' Local feedback appears below.':' This lesson stays ungraded.'}</p><button className="back-link" onClick={()=>stopPractice()}>Close practice</button></>}
        </section>}
        {lessonFeedbackEnabled&&feedback.length>0&&<section className="music-feedback" aria-label="Practice feedback">
          <h2>Local feedback · unscored</h2>
          <p className="small muted">Note eligibility reflects complete timing windows, not keyboard observation coverage or accuracy.</p>
          {feedback.map((run,index)=><article className="feedback-run" key={`${run.run}-${index}`}>
            <h3>Run {run.run+1}</h3>
            {run.status==='invalid'?<p role="alert">This run could not be analysed: {run.reason}</p>:<p>{run.matched} matched · {run.missing} missing · {run.extra} extra · {run.assessed} of {run.total} notes eligible for comparison ({Math.round(run.coverage*100)}% of reference notes){run.unassessed?` · ${run.unassessed} unassessed`:''}</p>}
            {run.status==='complete'&&<ul>{run.notes.map((note,noteIndex)=><li key={noteIndex} className={`feedback-note ${note.status}`}>{note.status==='matched'?`${note.name} ${note.timing}${note.errorSeconds!==null?` (${Math.round(note.errorSeconds*1000)} ms)`:''}`:note.status==='missing'?`Missing ${note.name}`:`Extra ${note.name}`}</li>)}</ul>}
            {musicHistoryEnabled&&eligibility.eligible&&run.status==='complete'&&(()=>{const key=`${saveSession.current}:${run.run}-${run.window.start}-${run.window.end}`;const saved=saves[key];
              return <div className="feedback-save">{saved?.state==='saved'?<p role="status">Summary saved to your private history.</p>:
                <><button className="secondary" disabled={saved?.state==='saving'} onClick={()=>void saveRun(run)}>{saved?.state==='saving'?'Saving…':saved?.state==='error'?'Retry save':'Save summary'}</button>
                {saved?.state==='error'&&<p className="small muted" role="alert">{saved.message}</p>}</>}</div>;})()}
          </article>)}
          {feedback.some(run=>!run.latencyMeasured)&&<p className="small muted">No timing alignment estimate was made; timing feedback is approximate.</p>}
          <p className="small muted">Timing remains approximate, including after visual alignment. {musicHistoryEnabled?'Feedback is unscored. A summary is sent only when you choose Save summary.':'Feedback is local and unscored. Nothing is saved or sent.'}</p>
        </section>}
        {musicHistoryEnabled&&<Suspense fallback={<p>Opening history controls…</p>}><MusicHistoryPanel key={identity} lessonId={lesson.lesson_id} refreshToken={historyRefresh} onDelete={id=>{
          for(const [key,entry] of saveEntries.current)if(entry.id===id)saveEntries.current.delete(key);
          setSaves(previous=>Object.fromEntries(Object.entries(previous).filter(([,value])=>value.id!==id)));
        }}/></Suspense>}
        <div className="music-home-grid">
          <article className="music-home-panel">
            <h2>Reference</h2>
            <dl>
              <div><dt>Instrument</dt><dd>{label(lesson)}</dd></div>
              <div><dt>Duration</dt><dd>{timeLabel(reference.duration)}</dd></div>
              <div><dt>Notes</dt><dd>{reference.events.length}{reference.events.some(event => event.optional) ? ' · optional notes marked' : ''}</dd></div>
              <div><dt>Assessment</dt><dd>Notes · pitch and timing</dd></div>
              {lesson.instrument.capo ? <div><dt>Capo</dt><dd>{lesson.instrument.capo}</dd></div> : null}
              {lesson.instrument.tuning ? <div><dt>Tuning</dt><dd>{lesson.instrument.tuning}</dd></div> : null}
            </dl>
          </article>
          <article className="music-home-panel">
            <h2>How the guide works</h2>
            <p className="subtle">Notes light up at their reviewed start time and stay lit until their reviewed length ends.
              Notes without a held length flash briefly. Optional notes are drawn like other notes; the guide does not grade your playing.</p>
            <p className="small muted">{midiSetupEnabled&&(lesson.subject==='piano'||lesson.subject==='guitar')?'No camera or microphone is used. MIDI access is requested only when you connect a keyboard.':'No camera, microphone or MIDI access has been requested.'}</p>
          </article>
        </div>
      </div></div>
      <div className="music-drawer-pane" hidden={drawer!=='midi'}>
      <div className="practice-panel-body">
        {midiSetupEnabled&&(lesson.subject==='piano'||lesson.subject==='guitar')&&effectiveAssessment.assessment==='notes'&&<section className="music-home-panel input-delay" aria-label="Timing alignment">
          <h2>Timing alignment · approximate</h2>
          {latency!==null?<p role="status">Estimated personal alignment: {latency} ms. <button className="back-link" onClick={()=>setLatency(null)}>Measure again</button></p>:<button className="secondary" disabled={!keyboardConnected||Boolean(calibration)||practiceActive} onClick={startCalibration}>Estimate timing alignment</button>}
          {calibration?<div className="calibration-pulse" role="status"><strong>{calibration.pulse}</strong><span>Play one note with each pulse</span><small>{calibration.samples} taps measured</small></div>:<p className="small muted">Play one note with each of eight visual pulses. This estimates your alignment, including reaction time; it does not measure hardware latency.</p>}
          {feedbackNotice&&<p className="small muted" role="status">{feedbackNotice}</p>}
        </section>}
        {midiSetupEnabled&&(lesson.subject==='piano'||lesson.subject==='guitar')&&<MidiKeyboardCheck key={lesson.revision_id} onAttack={handleAttack} onInputChange={id=>{setKeyboardConnected(Boolean(id));cancelCalibration();setLatency(null);if(practice.runtime)stopPractice();}}/>}
        {(!midiSetupEnabled||lesson.subject!=='piano')&&<p className="small muted">MIDI keyboard input is not enabled for this lesson.</p>}
      </div></div>
    </aside>}
  </PracticeShell>;
}

export default MusicLessonHome;

function sectionsAt(sections:MusicLessonManifest['section_set']['sections'],time:number):number{
 const index=sections.findIndex(section=>time>=section.start&&time<section.end);return index>=0?index:time>=sections[sections.length-1].end?sections.length-1:-1;
}
