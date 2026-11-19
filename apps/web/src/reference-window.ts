import type {Reference} from '../../../web/dist/pose.js';

/**
 * Slice a scoring reference by frame indices.
 *
 * `times`, `keypoints` and `visibility` are always sliced with the *same*
 * indices: a confidence row that drifted by even one frame would score a pose
 * against another frame's visibility, which is exactly the failure a section or
 * trim window introduces. The landmark format and the standing-calibration flag
 * travel with the slice, so a rebuilt reference keeps its meaning instead of
 * silently reverting to the SAM default or to "standing is calibrated".
 */
export function sliceReference(
  reference:Reference,
  indices:number[],
  options:{duration:number;offset?:number},
):Reference{
  const offset=options.offset??0;
  const visibility=reference.visibility;
  return {
    duration:options.duration,
    times:indices.map(index=>reference.times[index]-offset),
    keypoints:indices.map(index=>reference.keypoints[index]),
    visibility:visibility?indices.map(index=>visibility[index]):null,
    landmarkFormat:reference.landmarkFormat,
    standingCalibrationAvailable:reference.standingCalibrationAvailable,
  };
}
