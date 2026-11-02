import {InterpolateLinear, type AnimationClip} from 'three';

/** The native exporter emits STEP tracks; compare both rigs with the same playback
 * sampling. Quaternion tracks use spherical interpolation through Three's factory.
 * Samples and timestamps remain unchanged, including when scrubbing exact frames.
 */
export function continuousPlayback(clip: AnimationClip): AnimationClip {
  const result=clip.clone();
  for (const track of result.tracks) track.setInterpolation(InterpolateLinear);
  return result;
}
