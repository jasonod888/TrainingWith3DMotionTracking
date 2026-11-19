import {BASIC_PITCH_MODEL_IDENTITY, type BasicPitchNote} from '../../../../packages/music-engine/basic-pitch';
import type {TranscribeProfileId, TranscribeResponse} from './transcribe-protocol';

export type Transcriber = {
  ready:boolean;
  initialize:()=>Promise<void>;
  transcribe:(pcm:Float32Array, sampleRate:number, duration:number, profile:TranscribeProfileId,
    onProgress?:(stage:'model-loading'|'inference', progress:number)=>void)=>Promise<{notes:BasicPitchNote[]; elapsedMs:number}>;
  cancel:(requestId:string)=>void;
  dispose:()=>void;
};

/**
 * Main-thread controller for the bounded transcription worker. Capture/upload code
 * never receives a percentage without provenance; the worker returns decoded notes,
 * model identity and timing.
 */
export function createTranscriber():Transcriber {
  if (typeof Worker==='undefined') throw new Error('This browser cannot start the music transcription worker.');
  const worker=new Worker(new URL('./transcribe.worker.ts',import.meta.url),{type:'module'});
  let sequence=0;
  let initialized=false;
  const pending=new Map<string,{
    resolve:(value:any)=>void;
    reject:(reason:Error)=>void;
    progress?:(stage:'model-loading'|'inference',progress:number)=>void;
  }>();
  worker.onmessage=(event:MessageEvent<TranscribeResponse>)=>{
    const message=event.data;
    if(!message||message.type==='READY'&&message.requestId==='boot')return;
    if(message.type==='READY'){
      const item=pending.get(message.requestId);
      pending.delete(message.requestId);
      item?.resolve(undefined);
      return;
    }
    if(message.type==='PROGRESS'){
      pending.get(message.requestId)?.progress?.(message.stage,message.progress);
      return;
    }
    if(message.type==='TRANSCRIBE_RESULT'){
      const item=pending.get(message.requestId);
      pending.delete(message.requestId);
      item?.resolve({notes:message.notes,elapsedMs:message.elapsedMs});
      return;
    }
    if(message.type==='ERROR'){
      const item=pending.get(message.requestId);
      pending.delete(message.requestId);
      item?.reject(new Error(message.message));
    }
  };
  worker.onerror=()=>{
    for(const item of pending.values())item.reject(new Error('The music transcription worker stopped.'));
    pending.clear();
  };
  const initialize=async()=>{
    if(initialized)return;
    const requestId=`init-${++sequence}`;
    const result=new Promise<void>((resolve,reject)=>{
      pending.set(requestId,{resolve:()=>resolve(),reject});
      setTimeout(()=>{if(pending.delete(requestId))reject(new Error('The music model did not finish loading.'));},60000);
    });
    worker.postMessage({type:'INITIALIZE',requestId,modelUrl:BASIC_PITCH_MODEL_IDENTITY.modelUrl,
      wasmPath:BASIC_PITCH_MODEL_IDENTITY.wasmPath,numThreads:1});
    await result;
    initialized=true;
  };
  const transcribe=async(pcm:Float32Array,sampleRate:number,duration:number,profile:TranscribeProfileId,
    onProgress?:(stage:'model-loading'|'inference',progress:number)=>void)=>{
    await initialize();
    const requestId=`pcm-${++sequence}`;
    const result=new Promise<{notes:BasicPitchNote[];elapsedMs:number}>((resolve,reject)=>{
      pending.set(requestId,{resolve,reject,progress:onProgress});
      setTimeout(()=>{if(pending.delete(requestId))reject(new Error('Transcription took too long.'));},120000);
    });
    const copy=new Float32Array(pcm);
    worker.postMessage({type:'TRANSCRIBE_PCM',requestId,pcm:copy,sampleRate,duration,profile},[copy.buffer]);
    return result;
  };
  return {
    get ready(){return initialized;},
    initialize,
    transcribe,
    cancel:(requestId:string)=>{worker.postMessage({type:'CANCEL',requestId});pending.get(requestId)?.reject(new Error('Transcription cancelled.'));pending.delete(requestId);},
    dispose:()=>{for(const item of pending.values())item.reject(new Error('Transcription worker disposed.'));pending.clear();worker.terminate();},
  };
}
