import type {BasicPitchNote} from '../../../../packages/music-engine/basic-pitch';

export type TranscribeProfileId = 'piano' | 'default';
export type TranscribeRequest =
  | {type:'INITIALIZE'; requestId:string; modelUrl?:string; wasmPath?:string; numThreads?:number}
  | {type:'TRANSCRIBE_PCM'; requestId:string; pcm:Float32Array; sampleRate:number; duration:number; profile:TranscribeProfileId}
  | {type:'CANCEL'; requestId:string};
export type TranscribeResponse =
  | {type:'READY'; requestId:string; inputName:string; outputNames:string[]; model:string; weightsSha256:string}
  | {type:'PROGRESS'; requestId:string; stage:'model-loading'|'inference'; progress:number}
  | {type:'TRANSCRIBE_RESULT'; requestId:string; notes:BasicPitchNote[]; profile:TranscribeProfileId;
      sampleRate:number; duration:number; model:string; weightsSha256:string; elapsedMs:number}
  | {type:'ERROR'; requestId:string; code:string; message:string; recoverable:boolean};
