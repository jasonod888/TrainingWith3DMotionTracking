import {poseBestFitAlign, type PoseAlignmentReport, type PoseFrame, type PoseSection} from '../../../packages/learning-engine/pose-best-fit-align';

/**
 * Bounded, timestamped pose retention for a whole run. Samples are compact joint
 * maps, not raw video. The live report prompt is deliberately default-off via
 * POSE_ALIGNMENT_REPORT_ENABLED until browser/device validation is reviewed.
 */
export class PoseRunCapture {
  private readonly frames:PoseFrame[]=[];
  private lastTime=-Infinity;

  add(frame:PoseFrame, minimumIntervalSeconds=.09):boolean {
    if (!Number.isFinite(frame?.time) || !frame.joints || typeof frame.joints !== 'object') return false;
    if (this.frames.length >= 20000) return false;
    if (frame.time < this.lastTime) return false;
    if (frame.time - this.lastTime < minimumIntervalSeconds) return false;
    this.frames.push({time:frame.time, joints:frame.joints});
    this.lastTime=frame.time;
    return true;
  }

  reset():void {
    this.frames.length=0;
    this.lastTime=-Infinity;
  }

  get sampleCount():number { return this.frames.length; }
  get samples():readonly PoseFrame[] { return this.frames; }

  report(reference:PoseFrame[], search:{min:number; max:number}, sections?:PoseSection[]):PoseAlignmentReport {
    return poseBestFitAlign({captured:[...this.frames], reference, search, sections});
  }
}
