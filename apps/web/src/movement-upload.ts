import {fromMediaPipe, fromReference} from '../../../web/dist/pose.js';
import {
  poseBestFitAlign, type PoseAlignmentReport, type PoseFrame, type PoseSection,
} from '../../../packages/learning-engine/pose-best-fit-align';

/** Whole-run upload UI is deliberately off until the movement validation matrix passes. */
export const MOVEMENT_UPLOAD_UI_ENABLED = false;

/** Timestamped frame plan shared by upload and tests; no stale repeated frames. */
export function movementSampleTimes(duration:number, fps=10):number[] {
  if (!Number.isFinite(duration)||duration<=0) throw new Error('The uploaded video has no readable duration.');
  if (!Number.isFinite(fps)||fps<=0||fps>30) throw new Error('Invalid pose sampling rate.');
  const count=Math.min(20000,Math.max(1,Math.ceil(duration*fps)));
  return Array.from({length:count},(_,index)=>Math.min(duration-1e-4,index/fps));
}

type PoseWorkerResult = {landmarks?:unknown;world?:unknown};
type WorkerHandle = Worker & {pending?:Map<number,(value:PoseWorkerResult)=>void>};

function workerFrame(worker:Worker,bitmap:ImageBitmap,timestamp:number,epoch:number):Promise<PoseWorkerResult> {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Pose tracking took too long for a video frame.')),15000);
    const onMessage=(event:MessageEvent)=>{
      const data=event.data as {type?:string;landmarks?:unknown;world?:unknown;message?:string};
      if(data?.type==='pose'){clearTimeout(timer);worker.removeEventListener('message',onMessage);resolve({landmarks:data.landmarks,world:data.world});}
      if(data?.type==='frame-error'||data?.type==='error'){clearTimeout(timer);worker.removeEventListener('message',onMessage);reject(new Error(data.message||'Pose tracking failed.'));}
    };
    worker.addEventListener('message',onMessage);
    worker.postMessage({type:'frame',bitmap,timestamp,epoch},[bitmap]);
  });
}

async function seek(video:HTMLVideoElement,time:number,signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();
  if(Math.abs(video.currentTime-time)<1e-4&&video.readyState>=2)return;
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('The video seek did not finish.'));},15000);
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);signal.removeEventListener('abort',abort);};
    const done=()=>{cleanup();resolve();};
    const abort=()=>{cleanup();reject(new DOMException('Upload analysis cancelled.','AbortError'));};
    video.addEventListener('seeked',done,{once:true});
    signal.addEventListener('abort',abort,{once:true});
    video.currentTime=time;
  });
}

/**
 * Local uploaded-video pose runner. Frames are only used after the browser reports
 * `seeked`, and every sample carries its actual media timestamp. This module does not
 * replace the shipped body scorer; callers must gate it behind a reviewed capability.
 */
export async function analyzeMovementUpload(file:File, reference:{times:number[];keypoints:number[][][]}, input:{
  fps?:number;
  maxSeconds?:number;
  sections?:PoseSection[];
  signal?:AbortSignal;
  onProgress?:(progress:number)=>void;
}):Promise<{report:PoseAlignmentReport; capturedFrames:number; duration:number}> {
  if(!(file instanceof File)||file.size<=0)throw new Error('Choose a video file with a readable person.');
  const signal=input.signal??new AbortController().signal;
  const maxSeconds=Math.min(600,input.maxSeconds??600);
  const url=URL.createObjectURL(file);
  const video=document.createElement('video');
  video.muted=true;video.playsInline=true;video.preload='auto';video.src=url;
  let worker:Worker|null=null;
  try {
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('The video metadata did not load.')),15000);
      video.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});
      video.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('This browser cannot decode the uploaded video.'));},{once:true});
    });
    const duration=Math.min(maxSeconds,video.duration);
    if(!Number.isFinite(duration)||duration<=0)throw new Error('The uploaded video has no readable duration.');
    // A row that is too short has no comparable reference pose; skipping it keeps
    // the alignment honest instead of casting a null map into the scorer.
    const referenceFrames:PoseFrame[]=[];
    for(let index=0;index<reference.times.length;index++){
      const joints=fromReference(reference.keypoints[index]);
      if(joints)referenceFrames.push({time:reference.times[index],joints:joints as unknown as PoseFrame['joints']});
    }
    worker=new Worker('/pose-worker.js');
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Pose tracking did not start.')),30000);
      const handler=(event:MessageEvent)=>{
        const data=event.data as {type?:string;message?:string};
        if(data?.type==='ready'){clearTimeout(timer);worker?.removeEventListener('message',handler);resolve();}
        if(data?.type==='error'){clearTimeout(timer);worker?.removeEventListener('message',handler);reject(new Error(data.message||'Pose tracking could not start.'));}
      };
      worker!.addEventListener('message',handler);
      worker!.postMessage({type:'init'});
    });
    const frames:PoseFrame[]=[];
    const times=movementSampleTimes(duration,input.fps??10);
    for(let index=0;index<times.length;index+=1){
      signal.throwIfAborted();
      await seek(video,times[index],signal);
      const bitmap=await createImageBitmap(video);
      const pose=await workerFrame(worker,bitmap,times[index],1);
      if(Array.isArray(pose.world)&&Array.isArray(pose.landmarks)&&pose.world.length>=33&&pose.landmarks.length>=33){
        frames.push({time:video.currentTime,joints:fromMediaPipe(pose.world as never,pose.landmarks as never) as PoseFrame['joints']});
      }
      input.onProgress?.((index+1)/times.length);
    }
    const referenceDuration=referenceFrames.length?referenceFrames[referenceFrames.length-1].time-referenceFrames[0].time:duration;
    const report=poseBestFitAlign({captured:frames,reference:referenceFrames,
      search:{min:-Math.max(1,duration),max:Math.max(1,referenceDuration)},sections:input.sections});
    return {report,capturedFrames:frames.length,duration};
  } finally {
    worker?.terminate();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
