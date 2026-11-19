import {ALL_FORMATS, AudioBufferSink, BlobSource, Input} from 'mediabunny';
import {resampleToProfile} from './audio-capture';
import {BASIC_PITCH_PROFILE, monoFloat32} from '../../../../packages/music-engine/basic-pitch';

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_DURATION_SECONDS = 600;

export type DecodedMediaAudio = {
  pcm:Float32Array;
  sampleRate:number;
  duration:number;
  channels:number;
  source:'audio-decode'|'media-demux';
};

async function decodeWithWebAudio(file:File, signal:AbortSignal):Promise<DecodedMediaAudio|null> {
  if (!file.type.startsWith('audio/')) return null;
  const Ctx=globalThis.AudioContext;
  if (!Ctx) return null;
  const context=new Ctx();
  try {
    signal.throwIfAborted();
    const buffer=await context.decodeAudioData(await file.arrayBuffer());
    signal.throwIfAborted();
    const channels=Array.from({length:buffer.numberOfChannels},(_,index)=>buffer.getChannelData(index));
    const pcm=monoFloat32(channels);
    if (buffer.duration>MAX_DURATION_SECONDS)throw new Error('Audio is longer than the supported ten-minute upload limit.');
    return {pcm,sampleRate:buffer.sampleRate,duration:buffer.duration,channels:buffer.numberOfChannels,source:'audio-decode'};
  } finally {
    await context.close().catch(()=>{});
  }
}

async function decodeWithMediabunny(file:File, signal:AbortSignal):Promise<DecodedMediaAudio> {
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  try {
    const track=await input.getPrimaryAudioTrack();
    if(!track||!(await track.canDecode()))throw new Error('This file has no decodable audio track. Try an MP4, WebM, MP3, WAV or M4A file with sound.');
    const duration=await input.computeDuration();
    if(!Number.isFinite(duration)||duration<=0)throw new Error('The uploaded media has no readable duration.');
    if(duration>MAX_DURATION_SECONDS)throw new Error('Media is longer than the supported ten-minute upload limit.');
    const sink=new AudioBufferSink(track);
    const buffers:{buffer:AudioBuffer;timestamp:number}[]=[];
    for await(const item of sink.buffers()){
      signal.throwIfAborted();
      buffers.push({buffer:item.buffer,timestamp:item.timestamp});
    }
    signal.throwIfAborted();
    if(!buffers.length)throw new Error('The uploaded media produced no audio samples.');
    const sampleRate=buffers[0].buffer.sampleRate;
    const channels=Math.max(...buffers.map(item=>item.buffer.numberOfChannels));
    const total=Math.max(1,Math.ceil(duration*sampleRate));
    const merged=new Float32Array(total);
    for(const item of buffers){
      const start=Math.max(0,Math.round(item.timestamp*sampleRate));
      const length=Math.min(item.buffer.length,total-start);
      if(length<=0)continue;
      for(let channel=0;channel<item.buffer.numberOfChannels;channel+=1){
        const data=item.buffer.getChannelData(channel);
        for(let index=0;index<length;index+=1)merged[start+index]+=data[index]/item.buffer.numberOfChannels;
      }
    }
    return {pcm:merged,sampleRate,duration:Math.min(duration,total/sampleRate),channels,source:'media-demux'};
  } finally {
    input.dispose();
  }
}

/**
 * Decodes an uploaded audio/video file locally. `decodeAudioData` is used only for
 * complete audio data; video containers go through mediabunny's demuxer/decoder.
 * Raw media never leaves the browser.
 */
export async function decodeUploadedAudio(file:File, signal:AbortSignal, onProgress?:(progress:number)=>void):Promise<DecodedMediaAudio> {
  if(!(file instanceof File)||file.size<=0)throw new Error('Choose an audio or video file.');
  if(file.size>MAX_UPLOAD_BYTES)throw new Error('The upload exceeds the supported file size limit.');
  onProgress?.(.05);
  let decoded:DecodedMediaAudio|null=null;
  try { decoded=await decodeWithWebAudio(file,signal); } catch { decoded=null; }
  onProgress?.(decoded?.source==='audio-decode'?.45:.35);
  if(!decoded)decoded=await decodeWithMediabunny(file,signal);
  onProgress?.(.6);
  const pcm=await resampleToProfile(decoded.pcm,decoded.sampleRate,BASIC_PITCH_PROFILE.sampleRate);
  onProgress?.(.75);
  return {...decoded,pcm,sampleRate:BASIC_PITCH_PROFILE.sampleRate,duration:pcm.length/BASIC_PITCH_PROFILE.sampleRate};
}
