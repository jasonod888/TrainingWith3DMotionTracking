import {ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output} from 'mediabunny';

/** Always create a standalone clip locally. Never fall back to uploading the source. */
export async function prepareClip(file:File,start:number,end:number,maxSeconds:number,maxBytes:number,signal:AbortSignal,onProgress:(value:number)=>void):Promise<{file:File;duration:number}>{
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
  const scale=Math.min(1,1280/Math.max(track.displayWidth,track.displayHeight));
  const target=new BufferTarget();
  const output=new Output({format:new Mp4OutputFormat(),target});
  conversion=await Conversion.init({input,output,tracks:'primary',trim:{start,end},copy:false,tags:{},
   video:{codec:'avc',fit:'contain',width:Math.max(2,Math.floor(track.displayWidth*scale/2)*2),height:Math.max(2,Math.floor(track.displayHeight*scale/2)*2),frameRate:15,bitrate:4_000_000},audio:{discard:true}});
  signal.throwIfAborted();
  if(!conversion.isValid||conversion.discardedTracks.some(item=>item.track===track))throw new Error('This browser cannot prepare this video. Try a different browser or export the selected clip as MP4 first.');
  let tooLarge=false;
  target.on('write',({end:written})=>{if(written>maxBytes){tooLarge=true;void conversion?.cancel();}});
  conversion.onProgress=onProgress;
  try{await conversion.execute();}catch(error){if(tooLarge)throw new Error('The prepared clip exceeds the upload size limit. Choose a shorter clip.');throw error;}
  signal.throwIfAborted();
  if(!target.buffer||target.buffer.byteLength>maxBytes)throw new Error('The prepared clip exceeds the upload size limit. Choose a shorter clip.');
  const clip=new File([target.buffer],`${file.name.replace(/\.[^.]+$/,'').slice(0,220)}-clip.mp4`,{type:'video/mp4'});
  return {file:clip,duration:end-start};
 }finally{signal.removeEventListener('abort',abort);input.dispose();}
}
