import {useCallback, useEffect, useRef, useState} from 'react';
import type {PracticeRuntime, PracticeRuntimeSnapshot} from '../../../../packages/learning-engine/practice-runtime';
import {bestFitAlign, type FitAttack, type FitExpected} from '../../../../packages/music-engine/best-fit-align';
import {assessMusicAttempt, EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY, type MusicAssessmentReport} from '../../../../packages/music-engine/assessment';
import {captureMicrophonePcm} from './audio-capture';
import {transcribeCapturedAudio} from './audio-assessment';

export type MusicChallengePhase = 'idle' | 'countdown' | 'capturing' | 'analyzing' | 'feedback' | 'error';
export type MusicChallengeAttempt = {id:string; start:number; end:number; completed:boolean; reason:string};

/**
 * Whole-piece live MIDI challenge. The reference is audible nowhere during the run:
 * the practice transport plays the visual guide muted at 1x. One global offset is
 * fitted after the run and the product policy withholds the overall score.
 */
export function useMusicChallenge(input:{
  runtime:PracticeRuntime|null;
  snapshot:PracticeRuntimeSnapshot|null;
  lastAttempt:MusicChallengeAttempt|null;
  duration:number;
  expected:FitExpected[];
  sections:{id:string; label:string; start:number; end:number}[];
  midiConnected:boolean;
  inputMode?:'midi'|'microphone';
  /** Injectable worker boundary for deferred-promise lifecycle tests. */
  microphone?:{capture:typeof captureMicrophonePcm; transcribe:typeof transcribeCapturedAudio};
  countdownSeconds?:number;
  /** Recording guards in real seconds. Defaults mirror the practice policy. */
  lateStartSeconds?:number;
  tailSeconds?:number;
  onPauseRuntime?:()=>void;
}):{
  phase:MusicChallengePhase;
  active:boolean;
  captured:number;
  report:MusicAssessmentReport|null;
  error:string;
  start:()=>void;
  cancel:(reason?:string)=>void;
  recordAttack:(pitch:number,timeStamp:number)=>void;
} {
  const [phase,setPhase]=useState<MusicChallengePhase>('idle');
  const [captured,setCaptured]=useState(0);
  const [report,setReport]=useState<MusicAssessmentReport|null>(null);
  const [error,setError]=useState('');
  const inputRef=useRef(input);inputRef.current=input;
  const phaseRef=useRef<MusicChallengePhase>('idle');
  const generation=useRef(0);
  const attacks=useRef<FitAttack[]>([]);
  const rawAttacks=useRef<{pitch:number;timeStamp:number}[]>([]);
  const baselineAttempt=useRef<string|null>(null);
  const pauseTimer=useRef<number|null>(null);
  const captureTimer=useRef<number|null>(null);
  const captureStartMs=useRef(0);
  const guideStartMs=useRef(0);
  const guards=useRef({late:1.5,tail:.75});
  const armed=useRef(false);
  const captureAbort=useRef<AbortController|null>(null);
  const capturePromise=useRef<Promise<{pcm:Float32Array;sampleRate:number;duration:number}>|null>(null);
  const mounted=useRef(true);

  const updatePhase=(next:MusicChallengePhase)=>{phaseRef.current=next;setPhase(next);};
  const reset=()=>{
    generation.current+=1;
    armed.current=false;
    if(pauseTimer.current!==null){window.clearTimeout(pauseTimer.current);pauseTimer.current=null;}
    if(captureTimer.current!==null){window.clearTimeout(captureTimer.current);captureTimer.current=null;}
    captureAbort.current?.abort();
    captureAbort.current=null;
    capturePromise.current=null;
    attacks.current=[];
    rawAttacks.current=[];
    captureStartMs.current=0;
    guideStartMs.current=0;
    setCaptured(0);
    setReport(null);
    setError('');
    updatePhase('idle');
  };
  const fail=(message:string)=>{
    reset();
    setError(message);
    updatePhase('error');
    inputRef.current.onPauseRuntime?.();
  };
  const cancel=useCallback((reason='The challenge run was cancelled.')=>{
    const wasActive=phaseRef.current!=='idle'&&phaseRef.current!=='feedback'&&phaseRef.current!=='error';
    if(!wasActive)return;
    reset();
    setError(reason);
    inputRef.current.onPauseRuntime?.();
  },[]);
  const cancelRef=useRef(cancel);cancelRef.current=cancel;

  const finish=async()=>{
    const state=inputRef.current;
    if(phaseRef.current!=='capturing')return;
    // Snapshot all run-controlled async inputs before awaiting. Cancel/reset/new
    // start increments generation and aborts this exact controller; the old
    // continuation must not read the refs belonging to the new run.
    const generationAtStart=generation.current;
    const controller=captureAbort.current;
    const signal=controller?.signal;
    const capturePromiseAtStart=capturePromise.current;
    const transcribe=inputRef.current.microphone?.transcribe??transcribeCapturedAudio;
    const target={start:0,end:state.duration};
    const sections=state.sections.length?state.sections:[{id:'all',label:'Whole piece',start:0,end:state.duration}];
    const guide=guideStartMs.current;
    const captureOffset=guide?(captureStartMs.current-guide)/1000:0;
    const guardsAtStart={...guards.current};
    const rawAttacksAtStart=[...rawAttacks.current];
    const isCurrent=()=>mounted.current&&generation.current===generationAtStart
      &&phaseRef.current==='analyzing'&&!signal?.aborted;
    updatePhase('analyzing');
    try{
      if(!guide)throw new Error('The guide start was not observed.');
      if((state.inputMode??'midi')==='microphone'){
        if(!capturePromiseAtStart)throw new Error('The microphone capture did not start.');
        const captured=await capturePromiseAtStart;
        if(!isCurrent())return;
        const capture={start:captureOffset,end:captureOffset+captured.duration};
        const result=await transcribe({pcm:captured.pcm,sampleRate:captured.sampleRate,duration:captured.duration,
          expected:state.expected,target,sections,signal,capture,
          mapNoteTime:seconds=>captureOffset+seconds,onProgress:(stage,progress)=>{
            if(isCurrent())setCaptured(Math.round(progress*10000));
          }});
        if(!isCurrent())return;
        setCaptured(result.transcription.attacks.length);
        setReport(result.report);
        updatePhase('feedback');
        return;
      }
      // The recording starts at the challenge action (including countdown) so the
      // first target notes have a real pre-roll, and ends after late-start + tail.
      const timedAttacks:FitAttack[]=rawAttacksAtStart.map((attack,index)=>({
        id:`challenge-${generationAtStart}-${index}`,pitch:attack.pitch,
        time:(attack.timeStamp-guide)/1000,
      }));
      const capture={start:captureOffset,end:state.duration+guardsAtStart.late+guardsAtStart.tail};
      const search=Math.max(2,guardsAtStart.late);
      const fit=bestFitAlign({expected:state.expected,attacks:timedAttacks,target,capture,search:{min:-search,max:search}});
      const assessment=assessMusicAttempt({fit,expected:state.expected,attacks:timedAttacks,capture,target,sections,
        speed:1,policy:EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY});
      if(!isCurrent())return;
      setCaptured(timedAttacks.length);
      setReport(assessment);
      updatePhase('feedback');
    }catch(cause){
      if(isCurrent())fail(cause instanceof Error?cause.message:'The challenge could not be analysed.');
    }
  };

  const start=useCallback(()=>{
    const state=inputRef.current;
    if(!state.runtime){fail('Practice playback is not ready yet.');return;}
    if((state.inputMode??'midi')==='midi'&&!state.midiConnected){fail('Connect a keyboard before starting the challenge.');return;}
    if((state.inputMode??'midi')==='microphone'&&(typeof navigator==='undefined'||!navigator.mediaDevices?.getUserMedia)){fail('Microphone capture is unavailable in this browser.');return;}
    if(!Number.isFinite(state.duration)||state.duration<=0){fail('This lesson has no usable duration.');return;}
    reset();
    setError('');
    const runAtStart=generation.current;
    const countdown=state.countdownSeconds??5;
    const late=Math.max(0,state.lateStartSeconds??1.5);
    const tail=Math.max(0,state.tailSeconds??.75);
    guards.current={late,tail};
    captureStartMs.current=performance.now();
    rawAttacks.current=[];
    guideStartMs.current=0;
    if((state.inputMode??'midi')==='microphone'){
      const controller=new AbortController();
      captureAbort.current=controller;
      const capture=state.microphone?.capture??captureMicrophonePcm;
      capturePromise.current=capture({duration:Math.min(600,countdown+state.duration+late+tail+.25),signal:controller.signal,
        onStarted:timestamp=>{if(generation.current===runAtStart)captureStartMs.current=timestamp;}});
    }
    try{
      state.runtime.pause('challenge start', false);
      state.runtime.range=null;
      state.runtime.setMode('continuous');
      state.runtime.setRate(1);
      state.runtime.seek(0);
      baselineAttempt.current=state.lastAttempt?.id??null;
      armed.current=countdown<=0;
      updatePhase('countdown');
      state.runtime.start(countdown);
    }catch{
      fail('The challenge could not start.');
    }
  },[inputRef]);

  const recordAttack=useCallback((pitch:number,timeStamp:number)=>{
    if((inputRef.current.inputMode??'midi')!=='midi')return;
    // Record raw timestamps through countdown, performance and the capture tail.
    // They are mapped to guide time only after the guide start is known.
    if((phaseRef.current!=='countdown'&&phaseRef.current!=='capturing')||
      !Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(timeStamp))return;
    if(rawAttacks.current.length>=20000)return;
    rawAttacks.current.push({pitch,timeStamp});
    setCaptured(rawAttacks.current.length);
  },[]);

  useEffect(()=>{
    if(phaseRef.current!=='countdown'&&phaseRef.current!=='capturing')return;
    const snapshot=input.snapshot;
    if(!snapshot)return;
    if(snapshot.status==='countdown'){
      armed.current=true;
      if(phaseRef.current!=='countdown')updatePhase('countdown');
    }
    if(snapshot.status==='playing'&&!snapshot.buffering&&armed.current&&phaseRef.current!=='capturing'){
      if(!guideStartMs.current)guideStartMs.current=performance.now();
      updatePhase('capturing');
      setCaptured(rawAttacks.current.length);
      if((inputRef.current.inputMode??'midi')==='microphone'&&!capturePromise.current){
        const controller=new AbortController();
        captureAbort.current=controller;
        const runAtStart=generation.current;
        const capture=inputRef.current.microphone?.capture??captureMicrophonePcm;
        capturePromise.current=capture({duration:Math.min(600,inputRef.current.duration+guards.current.late+guards.current.tail),signal:controller.signal,
          onStarted:timestamp=>{if(generation.current===runAtStart)captureStartMs.current=timestamp;}});
      }
    }
    if(snapshot.status==='error')fail(snapshot.error||'Challenge playback failed.');
  },[input.snapshot?.status,input.snapshot?.buffering,input.snapshot?.error]);

  useEffect(()=>{
    if(phaseRef.current!=='countdown'&&phaseRef.current!=='capturing')return;
    const attempt=input.lastAttempt;
    if(!attempt||attempt.id===baselineAttempt.current)return;
    if(!attempt.completed){cancel('The challenge was interrupted. This run is not scored.');return;}
    if(captureTimer.current!==null)return;
    const guide=guideStartMs.current||performance.now();
    const endAt=guide+(inputRef.current.duration+guards.current.late+guards.current.tail)*1000;
    captureTimer.current=window.setTimeout(()=>{
      captureTimer.current=null;
      void finish();
    },Math.max(0,endAt-performance.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[input.lastAttempt?.id,input.lastAttempt?.completed]);

  useEffect(()=>{
    if(phaseRef.current!=='countdown'&&phaseRef.current!=='capturing')return;
    if(input.snapshot?.status!=='paused')return;
    if(pauseTimer.current!==null)window.clearTimeout(pauseTimer.current);
    pauseTimer.current=window.setTimeout(()=>{
      if(phaseRef.current==='countdown'||phaseRef.current==='capturing')cancel('The challenge was interrupted. This run is not scored.');
    },350);
  },[input.snapshot?.status]);

  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;generation.current+=1;
      if(pauseTimer.current!==null)window.clearTimeout(pauseTimer.current);
      if(captureTimer.current!==null)window.clearTimeout(captureTimer.current);
      captureAbort.current?.abort();};
  },[]);

  useEffect(()=>{
    const hide=()=>{if(document.hidden&&phaseRef.current!=='idle'&&phaseRef.current!=='feedback')cancelRef.current('The challenge paused while the page was hidden. This run is not scored.');};
    document.addEventListener('visibilitychange',hide);
    return ()=>document.removeEventListener('visibilitychange',hide);
  },[]);

  return {phase,active:phase==='countdown'||phase==='capturing'||phase==='analyzing',captured,report,error,start,cancel,recordAttack};
}
