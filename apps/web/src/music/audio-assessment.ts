import {
  BASIC_PITCH_MODEL_IDENTITY, type BasicPitchNote,
} from '../../../../packages/music-engine/basic-pitch';
import {
  assessMusicAttempt, EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY, type MusicAssessmentReport,
} from '../../../../packages/music-engine/assessment';
import {bestFitAlign, type FitAttack, type FitExpected} from '../../../../packages/music-engine/best-fit-align';
import {createTranscriber} from './transcribe-client';

export type AudioTranscription = {
  notes:BasicPitchNote[];
  attacks:FitAttack[];
  elapsedMs:number;
  model:string;
  weightsSha256:string;
  profile:'piano-peaks-v1';
};

export type AudioAssessment = {
  report:MusicAssessmentReport;
  transcription:AudioTranscription;
  captureDuration:number;
};

export function notesToAttacks(notes:BasicPitchNote[],mapTime:(seconds:number)=>number=(seconds)=>seconds):FitAttack[] {
  return notes.map((note,index)=>({id:`audio-${index}-${note.pitch}`,pitch:note.pitch,time:mapTime(note.onset)}));
}

/** Transcribe captured/uploaded PCM and align it to one whole reference interval. */
export async function transcribeCapturedAudio(input:{
  pcm:Float32Array;
  sampleRate:number;
  duration:number;
  expected:FitExpected[];
  sections:{id:string;label:string;start:number;end:number}[];
  target:{start:number;end:number};
  onProgress?:(stage:'model-loading'|'inference'|'analyzing',progress:number)=>void;
  signal?:AbortSignal;
  mapNoteTime?:(seconds:number)=>number;
  capture?:{start:number;end:number};
  speed?:number;
  transcriber?:{transcribe:(pcm:Float32Array,sampleRate:number,duration:number,profile:'piano'|'default',
    onProgress?:(stage:'model-loading'|'inference',progress:number)=>void)=>Promise<{notes:BasicPitchNote[];elapsedMs:number}>;dispose:()=>void};
}):Promise<AudioAssessment> {
  const transcriber=input.transcriber??createTranscriber();
  const owned=!input.transcriber;
  try {
    input.signal?.throwIfAborted();
    input.onProgress?.('model-loading',0);
    const transcription=await transcriber.transcribe(input.pcm,input.sampleRate,input.duration,'piano',
      (stage,progress)=>input.onProgress?.(stage,progress));
    input.signal?.throwIfAborted();
    input.onProgress?.('analyzing',.9);
    const attacks=notesToAttacks(transcription.notes,input.mapNoteTime);
    const capture=input.capture??{start:0,end:Math.max(0,Math.min(input.duration,input.target.end))};
    const fit=bestFitAlign({expected:input.expected,attacks,target:input.target,capture,
      search:{min:-Math.max(1,input.target.end),max:Math.max(1,input.duration)}});
    const report=assessMusicAttempt({fit,expected:input.expected,attacks,capture,target:input.target,
      sections:input.sections,speed:input.speed??1,policy:EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY,
      modelProfile:`${BASIC_PITCH_MODEL_IDENTITY.model}-${BASIC_PITCH_MODEL_IDENTITY.version}/piano-peaks-v1`});
    return {report,captureDuration:input.duration,transcription:{notes:transcription.notes,attacks,
      elapsedMs:transcription.elapsedMs,model:BASIC_PITCH_MODEL_IDENTITY.model,
      weightsSha256:BASIC_PITCH_MODEL_IDENTITY.weightsSha256,profile:'piano-peaks-v1'}};
  } finally {
    if(owned)transcriber.dispose();
  }
}
