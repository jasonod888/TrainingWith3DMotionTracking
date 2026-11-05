/**
 * Music-only clip preparation. Movement keeps using `prepareClip.ts`, which deliberately
 * discards audio; this module never falls back to uploading the original file.
 */
import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, WebMOutputFormat,
  canEncodeAudio, canEncodeVideo,
} from 'mediabunny';
import {
  AUDIO_PREPARATION_PATHS, MISSING_AUDIO_MESSAGE, PREPARATION_UNAVAILABLE_MESSAGE, usablePaths,
  type AudioPreparationPath, type EncoderSupport,
} from './music-preparation-policy';

export class MusicPreparationUnavailable extends Error {
  readonly recoverable = true;
  constructor(message = PREPARATION_UNAVAILABLE_MESSAGE) { super(message); }
}

export type PreparedAudioClip = {
  file: File;
  duration: number;
  path: AudioPreparationPath;
  audio: {sampleRate: number; channels: number; codec: string | null};
};

async function encoderSupport(): Promise<EncoderSupport> {
  const [avc, aac, vp8, opus] = await Promise.all([
    canEncodeVideo('avc'), canEncodeAudio('aac'), canEncodeVideo('vp8'), canEncodeAudio('opus'),
  ]);
  return {avc, aac, vp8, opus};
}

export async function prepareAudioClip(
  source: File, start: number, end: number, maxSeconds: number, maxBytes: number,
  signal: AbortSignal, onProgress: (value: number) => void,
  options:{importPrepared?:boolean}={},
): Promise<PreparedAudioClip> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.2 || end - start > maxSeconds) {
    throw new Error('Choose a valid clip within the time limit.');
  }
  signal.throwIfAborted();
  if(options.importPrepared)return importPreparedClip(source,start,end,maxBytes,signal);
  const paths = usablePaths(await encoderSupport());
  if (!paths.length) throw new MusicPreparationUnavailable();
  for (const path of paths) {
    try { return await preparePath(source,start,end,maxBytes,signal,onProgress,path); }
    catch(error) {
      signal.throwIfAborted();
      if (!(error instanceof MusicPreparationUnavailable) || path === paths[paths.length-1]) throw error;
    }
  }
  throw new MusicPreparationUnavailable();
}

/** Explicit recovery only: the user confirms this file is the entire exported lesson clip. */
async function importPreparedClip(source:File,start:number,end:number,maxBytes:number,signal:AbortSignal):Promise<PreparedAudioClip>{
  if(source.size>maxBytes)throw new Error('The exported clip exceeds the upload size limit.');
  const input=new Input({source:new BlobSource(source),formats:ALL_FORMATS});
  try{
    const [video,audio,duration]=await Promise.all([input.getPrimaryVideoTrack(),input.getPrimaryAudioTrack(),input.computeDuration()]);
    signal.throwIfAborted();
    if(start!==0||!Number.isFinite(duration)||Math.abs(end-duration)>.15)throw new Error('Use the entire exported clip, or export the selected part again.');
    if(!video||!audio)throw new MusicPreparationUnavailable(MISSING_AUDIO_MESSAGE);
    const [videoCodec,audioCodec,sampleRate,channels,videoStart,audioStart]=await Promise.all([
      video.getCodecParameterString(),audio.getCodecParameterString(),audio.getSampleRate(),audio.getNumberOfChannels(),video.getFirstTimestamp(),audio.getFirstTimestamp(),
    ]);
    signal.throwIfAborted();
    const path=AUDIO_PREPARATION_PATHS.find(candidate=>candidate.format==='mp4'
      ?/^avc[13]\./i.test(videoCodec??'')&&/^mp4a\.40\./i.test(audioCodec??'')
      :/^vp0?8/i.test(videoCodec??'')&&/^opus/i.test(audioCodec??''));
    if(!path)throw new MusicPreparationUnavailable('Export MP4 with H.264/AAC or WebM with VP8/Opus, then choose that clip.');
    if(sampleRate<=0||channels<=0||![videoStart,audioStart].every(Number.isFinite)||Math.abs(videoStart)>.05||Math.abs(audioStart)>.05||Math.abs(videoStart-audioStart)>.05){
      throw new MusicPreparationUnavailable('The exported audio and video do not start together. Export the clip starting at zero.');
    }
    return {file:new File([source],`${source.name.replace(/\.[^.]+$/,'').slice(0,220)}-music.${path.format}`,{type:path.mime}),duration,path,audio:{sampleRate,channels,codec:audioCodec}};
  }finally{input.dispose();}
}

async function preparePath(source:File,start:number,end:number,maxBytes:number,signal:AbortSignal,onProgress:(value:number)=>void,path:AudioPreparationPath):Promise<PreparedAudioClip>{
  signal.throwIfAborted();
  const input = new Input({source: new BlobSource(source), formats: ALL_FORMATS});
  let conversion: Conversion | undefined;
  let completed=false;
  const abort = () => void conversion?.cancel();
  signal.addEventListener('abort', abort, {once: true});
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This file has no readable video.');
    const sourceDuration = await input.computeDuration();
    if (end > sourceDuration + 0.05) throw new Error('Choose a range inside the video.');
    if (!(await input.getPrimaryAudioTrack())) throw new MusicPreparationUnavailable(MISSING_AUDIO_MESSAGE);

    const scale = Math.min(1, 1280 / Math.max(track.displayWidth, track.displayHeight));
    const target = new BufferTarget();
    const output = new Output({
      format: path.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
      target,
    });
    signal.throwIfAborted();
    try { conversion = await Conversion.init({
      input, output, tracks: 'primary', trim: {start, end}, copy: false,
      video: {
        codec: path.video, fit: 'contain',
        width: Math.max(2, Math.floor(track.displayWidth * scale / 2) * 2),
        height: Math.max(2, Math.floor(track.displayHeight * scale / 2) * 2),
        frameRate: 15,
      },
      audio: {codec: path.audio},
    }); } catch {
      signal.throwIfAborted();
      throw new MusicPreparationUnavailable();
    }
    signal.throwIfAborted();
    if (!conversion.isValid) throw new MusicPreparationUnavailable();
    let tooLarge = false;
    target.on('write', ({end: written}) => {
      if (written > maxBytes) { tooLarge = true; void conversion?.cancel(); }
    });
    conversion.onProgress = onProgress;
    try {
      signal.throwIfAborted();
      await conversion.execute();
      completed=true;
    } catch (error) {
      if (tooLarge) throw new Error('The prepared clip exceeds the upload size limit. Choose a shorter clip.');
      if ((error as Error).name === 'ConversionCanceledError') throw new DOMException('Preparation cancelled.', 'AbortError');
      signal.throwIfAborted();
      throw new MusicPreparationUnavailable();
    }
    signal.throwIfAborted();
    if (!target.buffer) throw new MusicPreparationUnavailable();
    if (target.buffer.byteLength > maxBytes) {
      throw new Error('The prepared clip exceeds the upload size limit. Choose a shorter clip.');
    }
    const prepared = new File([target.buffer], `${source.name.replace(/\.[^.]+$/, '').slice(0, 220)}-music.${path.format}`,
      {type: path.mime});

    // Verify the output itself, not the encoder's promise: the clip must carry sound.
    const verify = new Input({source: new BlobSource(prepared), formats: ALL_FORMATS});
    try {
      const audio = await verify.getPrimaryAudioTrack();
      const video = await verify.getPrimaryVideoTrack();
      if (!audio || !video) throw new MusicPreparationUnavailable(MISSING_AUDIO_MESSAGE);
      const duration = await verify.computeDuration();
      if (!Number.isFinite(duration) || Math.abs(duration - (end - start)) > 0.15) {
        throw new Error('The prepared clip length did not match the selection. Choose the range again.');
      }
      const [sampleRate,channels,audioStart,videoStart,codec]=await Promise.all([
        audio.getSampleRate(),audio.getNumberOfChannels(),audio.getFirstTimestamp(),video.getFirstTimestamp(),audio.getCodecParameterString(),
      ]);
      signal.throwIfAborted();
      if(sampleRate<=0||channels<=0||![audioStart,videoStart].every(Number.isFinite)||
        Math.abs(audioStart)>.05||Math.abs(videoStart)>.05||Math.abs(audioStart-videoStart)>.05){
        throw new MusicPreparationUnavailable('The prepared audio and video did not align. Export the selected clip with sound, then choose that file.');
      }
      return {
        file: prepared, duration: end - start, path,
        audio: {
          sampleRate,
          channels,
          codec: codec ?? null,
        },
      };
    } finally {
      verify.dispose();
    }
  } finally {
    signal.removeEventListener('abort', abort);
    if(!completed&&conversion)await conversion.cancel().catch(()=>{});
    input.dispose();
  }
}
