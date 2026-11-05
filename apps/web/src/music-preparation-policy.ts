/** Candidate preparation paths and their ordering, kept free of browser APIs for tests. */
export type AudioPreparationPath = {
  id: 'mp4-aac' | 'webm-opus';
  label: string;
  format: 'mp4' | 'webm';
  video: 'avc' | 'vp8';
  audio: 'aac' | 'opus';
  mime: string;
};

export const AUDIO_PREPARATION_PATHS: readonly AudioPreparationPath[] = [
  {id: 'mp4-aac', label: 'MP4 · AVC/AAC', format: 'mp4', video: 'avc', audio: 'aac', mime: 'video/mp4'},
  {id: 'webm-opus', label: 'WebM · VP8/Opus', format: 'webm', video: 'vp8', audio: 'opus', mime: 'video/webm'},
];

export type EncoderSupport = {avc: boolean; aac: boolean; vp8: boolean; opus: boolean};

/** Paths that can carry both streams in this browser, best first. */
export function usablePaths(support: EncoderSupport): AudioPreparationPath[] {
  return AUDIO_PREPARATION_PATHS.filter(path =>
    (path.video === 'avc' ? support.avc : support.vp8) && (path.audio === 'aac' ? support.aac : support.opus));
}

export const PREPARATION_UNAVAILABLE_MESSAGE =
  'This browser cannot prepare a clip that keeps its sound. Export the selected part as an MP4 or WebM with audio, then choose that file here.';

export const MISSING_AUDIO_MESSAGE =
  'The prepared clip lost its audio track. Export the selected part with sound, or choose another file.';
