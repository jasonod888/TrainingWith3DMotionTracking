/**
 * Music-only clip preparation. Movement keeps using `prepareClip.ts`, which deliberately
 * discards audio; this module never falls back to uploading the original file.
 */
import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, WebMOutputFormat,
  canEncodeAudio, canEncodeVideo,
} from 'mediabunny';
import {
  MISSING_AUDIO_MESSAGE, PREPARATION_UNAVAILABLE_MESSAGE, usablePaths,
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
): Promise<PreparedAudioClip> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.2 || end - start > maxSeconds) {
    throw new Error('Choose a valid clip within the time limit.');
  }
  signal.throwIfAborted();
  const paths = usablePaths(await encoderSupport());
  if (!paths.length) throw new MusicPreparationUnavailable();
  const path = paths[0];

  const input = new Input({source: new BlobSource(source), formats: ALL_FORMATS});
  let conversion: Conversion | undefined;
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
    conversion = await Conversion.init({
      input, output, tracks: 'primary', trim: {start, end}, copy: false,
      video: {
        codec: path.video, fit: 'contain',
        width: Math.max(2, Math.floor(track.displayWidth * scale / 2) * 2),
        height: Math.max(2, Math.floor(track.displayHeight * scale / 2) * 2),
        frameRate: 15,
      },
      audio: {codec: path.audio},
    });
    if (!conversion.isValid) throw new MusicPreparationUnavailable();
    let tooLarge = false;
    target.on('write', ({end: written}) => {
      if (written > maxBytes) { tooLarge = true; void conversion?.cancel(); }
    });
    conversion.onProgress = onProgress;
    try {
      await conversion.execute();
    } catch (error) {
      if (tooLarge) throw new Error('The prepared clip exceeds the upload size limit. Choose a shorter clip.');
      if ((error as Error).name === 'ConversionCanceledError') throw new DOMException('Preparation cancelled.', 'AbortError');
      throw error;
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
      if (!Number.isFinite(duration) || Math.abs(duration - (end - start)) > 0.75) {
        throw new Error('The prepared clip length did not match the selection. Choose the range again.');
      }
      return {
        file: prepared, duration: end - start, path,
        audio: {
          sampleRate: await audio.getSampleRate(),
          channels: await audio.getNumberOfChannels(),
          codec: (await audio.getCodecParameterString()) ?? null,
        },
      };
    } finally {
      verify.dispose();
    }
  } finally {
    signal.removeEventListener('abort', abort);
    input.dispose();
  }
}
