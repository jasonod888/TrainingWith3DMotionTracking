import {useCallback, useRef, useState} from 'react';
import type {FitExpected} from '../../../../packages/music-engine/best-fit-align';
import type {MusicAssessmentReport} from '../../../../packages/music-engine/assessment';
import {decodeUploadedAudio} from './media-audio';
import {transcribeCapturedAudio, type AudioTranscription} from './audio-assessment';

export type UploadPhase = 'idle' | 'decoding' | 'transcribing' | 'analyzing' | 'feedback' | 'error';
export type UploadAssessmentState = {
  phase:UploadPhase;
  progress:number;
  report:MusicAssessmentReport|null;
  transcription:AudioTranscription|null;
  error:string;
  analyze:(file:File)=>Promise<void>;
  cancel:()=>void;
};

/**
 * Explicit-upload path: decode locally, transcribe through the pinned worker, then
 * align and assess the whole reference. Raw media is never uploaded. The caller
 * must gate this behind an inference capability; the product score stays withheld.
 */
export function useUploadAssessment(input:{
  expected:FitExpected[];
  target:{start:number;end:number};
  sections:{id:string;label:string;start:number;end:number}[];
  /** Injectable async boundaries for deferred-promise lifecycle tests. */
  decode?:typeof decodeUploadedAudio;
  transcribe?:typeof transcribeCapturedAudio;
}):UploadAssessmentState {
  const [phase,setPhase]=useState<UploadPhase>('idle');
  const [progress,setProgress]=useState(0);
  const [report,setReport]=useState<MusicAssessmentReport|null>(null);
  const [transcription,setTranscription]=useState<AudioTranscription|null>(null);
  const [error,setError]=useState('');
  const abort=useRef<AbortController|null>(null);
  const run=useRef(0);
  const inputRef=useRef(input);inputRef.current=input;

  const cancel=useCallback(()=>{
    run.current+=1;
    abort.current?.abort();
    abort.current=null;
    setPhase('idle');
    setProgress(0);
    setReport(null);
    setTranscription(null);
    setError('');
  },[]);

  const analyze=useCallback(async(file:File)=>{
    const current=++run.current;
    const inputAtStart=inputRef.current;
    const decode=inputAtStart.decode??decodeUploadedAudio;
    const transcribe=inputAtStart.transcribe??transcribeCapturedAudio;
    abort.current?.abort();
    const controller=new AbortController();
    abort.current=controller;
    const isCurrent=()=>current===run.current&&!controller.signal.aborted;
    setPhase('decoding');setProgress(0);setError('');setReport(null);setTranscription(null);
    try {
      const decoded=await decode(file,controller.signal,value=>{
        if(isCurrent())setProgress(value*.4);
      });
      if(!isCurrent())return;
      setPhase('transcribing');
      const result=await transcribe({pcm:decoded.pcm,sampleRate:decoded.sampleRate,duration:decoded.duration,
        expected:inputAtStart.expected,target:inputAtStart.target,sections:inputAtStart.sections,
        signal:controller.signal,onProgress:(stage,value)=>{
          if(!isCurrent())return;
          setPhase(stage==='analyzing'?'analyzing':'transcribing');
          setProgress(.4+value*.6);
        }});
      if(!isCurrent())return;
      setReport(result.report);
      setTranscription(result.transcription);
      setProgress(1);
      setPhase('feedback');
    } catch (cause) {
      if(!isCurrent())return;
      setError(cause instanceof Error?cause.message:'The uploaded performance could not be analysed.');
      setPhase('error');
    }
  },[]);

  return {phase,progress,report,transcription,error,analyze,cancel};
}
