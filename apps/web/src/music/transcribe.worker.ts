/// <reference lib="webworker" />
// The dependency is pinned in package.json; install/prepare-ort supplies the
// browser runtime. Keeping this import at the worker boundary isolates ORT.
// @ts-ignore - resolved by the pinned dependency at build time.
import * as ort from 'onnxruntime-web';
import {
  BASIC_PITCH_MODEL_IDENTITY, BASIC_PITCH_PROFILE, PIANO_PEAKS_PROFILE, decodeBasicPitch,
  monoFloat32, resampleLinear, stitchActivations, validatePcmDuration, windowAudio,
  type BasicPitchProfile,
} from '../../../../packages/music-engine/basic-pitch';
import type {TranscribeRequest, TranscribeResponse} from './transcribe-protocol';

const scope=self as unknown as DedicatedWorkerGlobalScope;
let session:any=null;
let cancelledRequest='';
let initialized=Boolean(session);

function post(value:TranscribeResponse):void { scope.postMessage(value); }
function profileFor(id:'piano'|'default'):BasicPitchProfile { return id==='piano'?PIANO_PEAKS_PROFILE:BASIC_PITCH_PROFILE; }
function error(requestId:string,code:string,message:string,recoverable=true):void {
  post({type:'ERROR',requestId,code,message,recoverable});
}

async function initialize(message:Extract<TranscribeRequest,{type:'INITIALIZE'}>):Promise<void> {
  try {
    const runtime:any=ort;
    if (runtime?.env?.wasm) {
      runtime.env.wasm.wasmPaths=message.wasmPath??BASIC_PITCH_MODEL_IDENTITY.wasmPath;
      runtime.env.wasm.numThreads=Math.max(1,Math.min(4,message.numThreads??1));
    }
    post({type:'PROGRESS',requestId:message.requestId,stage:'model-loading',progress:0});
    const response=await fetch(message.modelUrl??BASIC_PITCH_MODEL_IDENTITY.modelUrl,{credentials:'same-origin'});
    if (!response.ok) throw new Error(`The pinned music model could not be loaded (${response.status}).`);
    const bytes=await response.arrayBuffer();
    post({type:'PROGRESS',requestId:message.requestId,stage:'model-loading',progress:.7});
    session=await runtime.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    initialized=true;
    post({type:'READY',requestId:message.requestId,inputName:runtime.env?.session?.inputName??BASIC_PITCH_MODEL_IDENTITY.inputName,
      outputNames:[BASIC_PITCH_MODEL_IDENTITY.noteOutput,BASIC_PITCH_MODEL_IDENTITY.onsetOutput,BASIC_PITCH_MODEL_IDENTITY.contourOutput],
      model:BASIC_PITCH_MODEL_IDENTITY.model,weightsSha256:BASIC_PITCH_MODEL_IDENTITY.weightsSha256});
  } catch (cause) {
    initialized=false;
    error(message.requestId,'model-load-failed',cause instanceof Error?cause.message:'The music model could not start.',true);
  }
}

async function transcribe(message:Extract<TranscribeRequest,{type:'TRANSCRIBE_PCM'}>):Promise<void> {
  if (!session) { error(message.requestId,'model-not-ready','The music model is not ready.',true); return; }
  const started=performance.now();
  cancelledRequest=message.requestId;
  try {
    if (!Number.isFinite(message.sampleRate)||message.sampleRate<=0||!Number.isFinite(message.duration)||message.duration<=0) throw new Error('Invalid captured audio.');
    let pcm=monoFloat32(message.pcm);
    validatePcmDuration(pcm.length,message.sampleRate);
    if (message.sampleRate!==BASIC_PITCH_PROFILE.sampleRate) pcm=resampleLinear(pcm,message.sampleRate,BASIC_PITCH_PROFILE.sampleRate);
    const profile=profileFor(message.profile);
    const windows=windowAudio(pcm,profile);
    const outputs:{note:Float32Array;onset:Float32Array;contour:Float32Array}[]=[];
    const runtime:any=ort;
    for (let index=0; index<windows.length; index+=1) {
      if (cancelledRequest!==message.requestId) return;
      const tensor=new runtime.Tensor('float32',windows[index],[1,profile.windowSamples,1]);
      const result=await session.run({[BASIC_PITCH_MODEL_IDENTITY.inputName]:tensor});
      if (cancelledRequest!==message.requestId) return;
      const note=result[BASIC_PITCH_MODEL_IDENTITY.noteOutput]?.data;
      const onset=result[BASIC_PITCH_MODEL_IDENTITY.onsetOutput]?.data;
      const contour=result[BASIC_PITCH_MODEL_IDENTITY.contourOutput]?.data;
      if (!(note instanceof Float32Array)||!(onset instanceof Float32Array)||!(contour instanceof Float32Array)) throw new Error('The model returned unexpected activations.');
      outputs.push({note,onset,contour});
      post({type:'PROGRESS',requestId:message.requestId,stage:'inference',progress:(index+1)/windows.length});
    }
    if (cancelledRequest!==message.requestId) return;
    const stitched=stitchActivations(outputs,Math.min(pcm.length,Math.round(message.duration*profile.sampleRate)),profile);
    const notes=decodeBasicPitch(stitched,message.duration,profile).filter(note=>note.onset<message.duration);
    post({type:'TRANSCRIBE_RESULT',requestId:message.requestId,notes,profile:message.profile,
      sampleRate:profile.sampleRate,duration:message.duration,model:BASIC_PITCH_MODEL_IDENTITY.model,
      weightsSha256:BASIC_PITCH_MODEL_IDENTITY.weightsSha256,elapsedMs:Math.round(performance.now()-started)});
  } catch (cause) {
    if (cancelledRequest===message.requestId) error(message.requestId,'transcription-failed',cause instanceof Error?cause.message:'Transcription failed.',true);
  }
}

scope.onmessage=async (event:MessageEvent<TranscribeRequest>)=>{
  const message=event.data;
  if (!message||typeof message.type!=='string') return;
  if (message.type==='INITIALIZE') { await initialize(message); return; }
  if (message.type==='CANCEL') { if (cancelledRequest===message.requestId) cancelledRequest=''; return; }
  if (message.type==='TRANSCRIBE_PCM') { await transcribe(message); }
};
scope.postMessage({type:'READY',requestId:'boot',inputName:BASIC_PITCH_MODEL_IDENTITY.inputName,
  outputNames:[BASIC_PITCH_MODEL_IDENTITY.noteOutput,BASIC_PITCH_MODEL_IDENTITY.onsetOutput,BASIC_PITCH_MODEL_IDENTITY.contourOutput],
  model:BASIC_PITCH_MODEL_IDENTITY.model,weightsSha256:BASIC_PITCH_MODEL_IDENTITY.weightsSha256} satisfies TranscribeResponse);
