import {useCallback, useEffect, useRef, useState} from 'react';
import type {PracticeRuntime, PracticeRuntimeSnapshot} from '../../../../packages/learning-engine/practice-runtime';
import {
  bestFitAlign, type FitAttack, type FitExpected,
} from '../../../../packages/music-engine/best-fit-align';
import {
  assessMusicAttempt, EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY, type MusicAssessmentReport,
} from '../../../../packages/music-engine/assessment';
import {
  DEFAULT_LISTEN_PLAY, listenPlayCaptureSpan, listenPlayGuideTime, listenPlayTimeline,
  type ListenPlayTimeline,
} from '../../../../packages/music-engine/listen-play';
import {captureMicrophonePcm} from './audio-capture';
import {transcribeCapturedAudio} from './audio-assessment';
import {createCaptureJob} from './capture-job';

export type ListenPlayPhase = 'idle' | 'listening' | 'guard' | 'count-in' | 'capturing' | 'analyzing' | 'feedback' | 'error';
export type ListenPlayUnit = {id:string; label:string; start:number; end:number};
export type ListenPlayAttempt = {id:string; start:number; end:number; completed:boolean; reason:string};

export type ListenPlaySession = {
  phase:ListenPlayPhase;
  active:boolean;
  remaining:number;
  captured:number;
  capturePlayhead:number|null;
  report:MusicAssessmentReport|null;
  error:string;
  start:()=>void;
  cancel:(reason?:string)=>void;
  recordAttack:(pitch:number, timeStamp:number)=>void;
};

/**
 * Browser binding for the listen-then-play policy. It uses the practice runtime for
 * the audible listen pass, then a monotonic capture clock for the response. MIDI
 * timestamps are raw event times; a fitted global offset absorbs a constant start
 * delay, so measured input latency is not subtracted a second time.
 */
export function useListenPlay(input:{
  runtime:PracticeRuntime|null;
  snapshot:PracticeRuntimeSnapshot|null;
  lastAttempt:ListenPlayAttempt|null;
  unit:ListenPlayUnit|null;
  speed:number;
  expected:FitExpected[];
  sections:{id:string; label:string; start:number; end:number}[];
  timing?:Partial<Pick<typeof DEFAULT_LISTEN_PLAY, 'guardSeconds' | 'countInSeconds' | 'earlyStartSeconds' | 'lateStartSeconds' | 'tailSeconds'>>;
  inputMode?:'midi'|'microphone';
  /** Injectable worker boundary for deferred-promise lifecycle tests. */
  microphone?:{capture:typeof captureMicrophonePcm; transcribe:typeof transcribeCapturedAudio};
  onPauseRuntime?:()=>void;
}):ListenPlaySession {
  const [phase,setPhase]=useState<ListenPlayPhase>('idle');
  const [remaining,setRemaining]=useState(0);
  const [captured,setCaptured]=useState(0);
  const [capturePlayhead,setCapturePlayhead]=useState<number|null>(null);
  const [report,setReport]=useState<MusicAssessmentReport|null>(null);
  const [error,setError]=useState('');
  const inputRef=useRef(input);inputRef.current=input;
  const phaseRef=useRef<ListenPlayPhase>('idle');
  const generation=useRef(0);
  const timeline=useRef<ListenPlayTimeline|null>(null);
  const timing=useRef({early:0, late:0});
  const captureStart=useRef(0);
  const attacks=useRef<FitAttack[]>([]);
  const timer=useRef<number|null>(null);
  const frame=useRef<number|null>(null);
  const baselineAttempt=useRef<string|null>(null);
  const pauseTimer=useRef<number|null>(null);
  const captureAbort=useRef<AbortController|null>(null);
  const capturePromise=useRef<Promise<{pcm:Float32Array;sampleRate:number;duration:number}>|null>(null);
  const mounted=useRef(true);
  const captureJob=useRef(createCaptureJob()).current;
  const runToken=useRef(0);

  const updatePhase=(next:ListenPlayPhase)=>{phaseRef.current=next;setPhase(next);};
  const clearTimers=()=>{
    if(timer.current!==null){window.clearInterval(timer.current);timer.current=null;}
    if(frame.current!==null){window.cancelAnimationFrame?.(frame.current);frame.current=null;}
    if(pauseTimer.current!==null){window.clearTimeout(pauseTimer.current);pauseTimer.current=null;}
  };
  const reset=()=>{
    generation.current+=1;
    captureJob.cancel();
    clearTimers();
    timeline.current=null;
    attacks.current=[];
    captureAbort.current?.abort();
    captureAbort.current=null;
    capturePromise.current=null;
    setCaptured(0);
    setCapturePlayhead(null);
    setRemaining(0);
    setError('');
    updatePhase('idle');
  };
  const fail=(message:string)=>{
    reset();
    setError(message);
    updatePhase('error');
    inputRef.current.onPauseRuntime?.();
  };
  const cancel=useCallback((reason='Listen & play was cancelled.')=>{
    const wasActive=phaseRef.current!=='idle'&&phaseRef.current!=='feedback'&&phaseRef.current!=='error';
    if(!wasActive)return;
    reset();
    setError(reason);
    inputRef.current.onPauseRuntime?.();
  },[]);
  const cancelRef=useRef(cancel);cancelRef.current=cancel;

  const beginCapture=()=>{
    const current=timeline.current;
    if(!current||!mounted.current)return;
    updatePhase('capturing');
    captureStart.current=performance.now();
    attacks.current=[];
    if((inputRef.current.inputMode??'midi')==='microphone'){
      const controller=new AbortController();
      captureAbort.current=controller;
      captureJob.register({release:()=>controller.abort()});
      const capture=inputRef.current.microphone?.capture??captureMicrophonePcm;
      capturePromise.current=capture({duration:current.captureDuration,signal:controller.signal});
    }
    setCaptured(0);
    setRemaining(current.captureDuration);
    setCapturePlayhead(current.captureGuideStart);
    const generationAtStart=generation.current;
    const tick=()=>{
      if(!mounted.current||generation.current!==generationAtStart||!timeline.current)return;
      const elapsed=(performance.now()-captureStart.current)/1000;
      const bounded=Math.max(0,Math.min(timeline.current.captureDuration,elapsed));
      setCapturePlayhead(listenPlayGuideTime(timeline.current,bounded));
      setRemaining(Math.max(0,timeline.current.captureDuration-bounded));
      if(elapsed>=timeline.current.captureDuration){void finish();return;}
      frame.current=window.requestAnimationFrame(tick);
    };
    frame.current=window.requestAnimationFrame(tick);
  };

  const beginCountIn=()=>{
    const current=timeline.current;
    if(!current)return;
    updatePhase('count-in');
    const start=performance.now();
    const duration=current.countInEnd-current.guardEnd;
    const generationAtStart=generation.current;
    timer.current=window.setInterval(()=>{
      if(!mounted.current||generation.current!==generationAtStart)return;
      const elapsed=(performance.now()-start)/1000;
      setRemaining(Math.max(0,duration-elapsed));
      if(elapsed>=duration){clearTimers();beginCapture();}
    },50);
  };

  const beginGuard=()=>{
    const current=timeline.current;
    if(!current)return;
    updatePhase('guard');
    const start=performance.now();
    const duration=current.guardEnd-current.listenEnd;
    const generationAtStart=generation.current;
    timer.current=window.setInterval(()=>{
      if(!mounted.current||generation.current!==generationAtStart)return;
      const elapsed=(performance.now()-start)/1000;
      setRemaining(Math.max(0,duration-elapsed));
      if(elapsed>=duration){clearTimers();beginCountIn();}
    },50);
  };

  const finish=async()=>{
    const current=timeline.current;
    const state=inputRef.current;
    if(!current||!state.unit||phaseRef.current!=='capturing')return;
    // Snapshot the run identity and async inputs before the first await. A cancel
    // or new start invalidates this continuation; it must never inspect new refs.
    const generationAtStart=generation.current;
    const controller=captureAbort.current;
    const signal=controller?.signal;
    const capturePromiseAtStart=capturePromise.current;
    const transcribe=inputRef.current.microphone?.transcribe??transcribeCapturedAudio;
    const unit={start:state.unit.start,end:state.unit.end};
    const sections=(state.sections.filter(section=>section.start>=unit.start-1e-6&&section.end<=unit.end+1e-6).length
      ?state.sections.filter(section=>section.start>=unit.start-1e-6&&section.end<=unit.end+1e-6)
      :[{id:state.unit.id,label:state.unit.label,start:unit.start,end:unit.end}]);
    const capture=listenPlayCaptureSpan(current);
    const isCurrent=()=>mounted.current&&generation.current===generationAtStart
      &&captureJob.isCurrent(runToken.current)
      &&phaseRef.current==='analyzing'&&!signal?.aborted;
    clearTimers();
    updatePhase('analyzing');
    setCapturePlayhead(current.captureGuideEnd);
    try{
      if((state.inputMode??'midi')==='microphone'){
        if(!capturePromiseAtStart)throw new Error('The microphone capture did not start.');
        const captured=await capturePromiseAtStart;
        if(!isCurrent())return;
        const result=await transcribe({pcm:captured.pcm,sampleRate:captured.sampleRate,duration:captured.duration,
          expected:state.expected,target:unit,sections,signal,
          mapNoteTime:seconds=>current.captureGuideStart+current.speed*seconds,
          capture,speed:current.speed,
          onProgress:(stage,progress)=>{
            if(isCurrent())setRemaining(progress);
          }});
        if(!isCurrent())return;
        setCaptured(result.transcription.attacks.length);
        setReport(result.report);
        setRemaining(0);
        updatePhase('feedback');
        captureJob.settle(runToken.current,true);
        return;
      }
      const search={min:-Math.max(0.5,timing.current.early)*current.speed,
        max:Math.max(0.5,timing.current.late)*current.speed};
      const fit=bestFitAlign({expected:state.expected,attacks:attacks.current,target:unit,capture,search});
      const assessment=assessMusicAttempt({fit,expected:state.expected,attacks:attacks.current,capture,target:unit,sections,
        speed:current.speed,policy:EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY});
      if(!isCurrent())return;
      setReport(assessment);
      setRemaining(0);
      updatePhase('feedback');
      captureJob.settle(runToken.current,true);
    }catch(cause){
      if(isCurrent())fail(cause instanceof Error?cause.message:'The performance could not be analysed.');
    }
  };

  const start=useCallback(()=>{
    const state=inputRef.current;
    if(!state.unit){fail('Choose a section before listening.');return;}
    if(!state.runtime){fail('Practice playback is not ready yet.');return;}
    if((state.inputMode??'midi')==='microphone'&&(typeof navigator==='undefined'||!navigator.mediaDevices?.getUserMedia)){fail('Microphone capture is unavailable in this browser.');return;}
    reset();
    setError('');
    runToken.current=captureJob.begin().generation;
    const configured={...DEFAULT_LISTEN_PLAY,...state.timing};
    const early=configured.earlyStartSeconds, late=configured.lateStartSeconds;
    timing.current={early,late};
    let next:ListenPlayTimeline;
    try{
      next=listenPlayTimeline({section:{start:state.unit.start,end:state.unit.end},speed:state.speed,
        guardSeconds:configured.guardSeconds,countInSeconds:configured.countInSeconds,
        earlyStartSeconds:early,lateStartSeconds:late,tailSeconds:configured.tailSeconds,
        maxCaptureSeconds:configured.maxCaptureSeconds});
    }catch(cause){
      fail(cause instanceof Error?cause.message:'Invalid listen-then-play timing.');
      return;
    }
    timeline.current=next;
    baselineAttempt.current=state.lastAttempt?.id??null;
    setRemaining(next.listenEnd);
    setReport(null);
    updatePhase('listening');
    try{
      state.runtime.seek(state.unit.start);
      state.runtime.start(0);
    }catch{
      fail('Practice playback could not start.');
    }
  },[inputRef]);

  const recordAttack=useCallback((pitch:number,timeStamp:number)=>{
    if((inputRef.current.inputMode??'midi')!=='midi')return;
    const current=timeline.current;
    if(!current||phaseRef.current!=='capturing'||!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(timeStamp))return;
    const elapsed=(timeStamp-captureStart.current)/1000;
    if(elapsed< -0.05||elapsed>current.captureDuration+0.25)return;
    if(attacks.current.length>=20000)return;
    const guide=current.captureGuideStart+current.speed*Math.max(0,elapsed);
    attacks.current.push({id:`listen-${generation.current}-${attacks.current.length}`,pitch,time:guide});
    setCaptured(attacks.current.length);
  },[]);

  useEffect(()=>{
    if(phaseRef.current!=='listening')return;
    const attempt=input.lastAttempt;
    if(!attempt||attempt.id===baselineAttempt.current)return;
    if(!attempt.completed){cancel('Practice was interrupted. This listen-then-play run is not scored.');return;}
    beginGuard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[input.lastAttempt?.id,input.lastAttempt?.completed]);

  useEffect(()=>{
    const snapshot=input.snapshot;
    if(phaseRef.current!=='listening'||!snapshot)return;
    if(snapshot.status==='error'){fail(snapshot.error||'Practice playback failed.');return;}
    if(snapshot.status==='paused'){
      if(pauseTimer.current!==null)window.clearTimeout(pauseTimer.current);
      pauseTimer.current=window.setTimeout(()=>{
        if(phaseRef.current==='listening')cancel('Practice was interrupted before listening finished.');
      },350);
    }else if(pauseTimer.current!==null){
      window.clearTimeout(pauseTimer.current);pauseTimer.current=null;
    }
  },[input.snapshot?.status,input.snapshot?.error]);

  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;generation.current+=1;captureJob.cancel();clearTimers();};
  },[]);

  useEffect(()=>{
    const hide=()=>{if(document.hidden&&phaseRef.current!=='idle'&&phaseRef.current!=='feedback')cancelRef.current('Listen & play paused while the page was hidden.');};
    document.addEventListener('visibilitychange',hide);
    return ()=>document.removeEventListener('visibilitychange',hide);
  },[]);

  return {phase,active:phase!=='idle'&&phase!=='feedback'&&phase!=='error',remaining,captured,capturePlayhead,report,error,start,cancel,recordAttack};
}
