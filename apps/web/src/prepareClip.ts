import {ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output} from 'mediabunny';

/** The normalised clip ceiling. One authoritative clock: the worker re-derives it. */
export const MAX_CLIP_EDGE = 1920;
export const MAX_CLIP_FPS = 30;
export const CLIP_BITRATE = 6_000_000;

/**
 * Always create a standalone clip locally. Never fall back to uploading the source.
 *
 * Resolution is capped at 1920 px on the longest edge and never upsampled. The
 * frame rate is capped at 30 fps, but the source's own validated rate is kept when
 * it is lower or fractional (for example 23.976 or 29.97): MediaBunny reports the
 * measured average packet rate, and the encoder is only asked for a lower rate than
 * the source when that value is genuinely above 30. When the rate cannot be
 * measured, no rate is forced, so the encoder keeps the source cadence instead of
 * inventing frames.
 */
export async function prepareClip(file:File,start:number,end:number,maxSeconds:number,maxBytes:number,signal:AbortSignal,onProgress:(value:number)=>void):Promise<{file:File;duration:number;frameRate:number|null}>{
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<.2||end-start>maxSeconds)throw new Error('Choose a valid clip within the time limit.');
 signal.throwIfAborted();
 const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
 let conversion:Conversion|undefined;
 const abort=()=>{void conversion?.cancel();};
 signal.addEventListener('abort',abort,{once:true});
 try{
  const track=await input.getPrimaryVideoTrack();
  if(!track)throw new Error('This file has no readable video.');
  const duration=await input.computeDuration();
  if(end>duration+.05)throw new Error('Choose a range inside the video.');
  const scale=Math.min(1,MAX_CLIP_EDGE/Math.max(track.displayWidth,track.displayHeight));
  const width=Math.max(2,Math.floor(track.displayWidth*scale/2)*2);
  const height=Math.max(2,Math.floor(track.displayHeight*scale/2)*2);
  // A short prefix is enough for a stable estimate and avoids scanning the whole file.
  let sourceFrameRate:number|null=null;
  try{
   const stats=await track.computePacketStats(120);
   const measured=stats.averagePacketRate;
   if(Number.isFinite(measured)&&measured>0)sourceFrameRate=measured;
  }catch{sourceFrameRate=null;}
  const frameRate=sourceFrameRate===null?null:Math.min(MAX_CLIP_FPS,sourceFrameRate);
  const target=new BufferTarget();
  const output=new Output({format:new Mp4OutputFormat(),target});
  const video:{codec:'avc';fit:'contain';width:number;height:number;bitrate:number;frameRate?:number}={codec:'avc',fit:'contain',width,height,bitrate:CLIP_BITRATE};
  if(frameRate!==null)video.frameRate=frameRate;
  conversion=await Conversion.init({input,output,tracks:'primary',trim:{start,end},copy:false,tags:{},video,audio:{discard:true}});
  signal.throwIfAborted();
  if(!conversion.isValid||conversion.discardedTracks.some(item=>item.track===track))throw new Error('This browser cannot prepare this video. Try a different browser or export the selected clip as MP4 first.');
  let tooLarge=false;
  target.on('write',({end:written})=>{if(written>maxBytes){tooLarge=true;void conversion?.cancel();}});
  conversion.onProgress=onProgress;
  try{await conversion.execute();}catch(error){if(tooLarge)throw new Error('The prepared clip exceeds the upload size limit. Choose a shorter clip.');throw error;}
  signal.throwIfAborted();
  if(!target.buffer||target.buffer.byteLength>maxBytes)throw new Error('The prepared clip exceeds the upload size limit. Choose a shorter clip.');
  const clip=new File([target.buffer],`${file.name.replace(/\.[^.]+$/,'').slice(0,220)}-clip.mp4`,{type:'video/mp4'});
  return {file:clip,duration:end-start,frameRate};
 }finally{signal.removeEventListener('abort',abort);input.dispose();}
}
