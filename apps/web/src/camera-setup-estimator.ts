// Stable measurement continuity for guided camera setup.
//
// `HeightCalibration` in web/dist/pose.js is the legacy estimator: it keeps a
// 3000 ms sample window, resets on every invalid assessment and counts raw
// elapsed time between samples. That combination cannot reach the 30-sample
// requirement below 10 accepted observations per second, and it credits time
// the user was not being observed. This adapter keeps the estimator's meaning
// (same standing checks, same height/floor/centre tolerances) and replaces only
// its continuity policy, for the new setup flow. The legacy class and the
// standalone motion lab are untouched.
//
// Policy (see docs/guided-camera-setup-implementation-plan.md §8):
//  - 30 distinct accepted observations AND 2500 ms of credited time;
//  - credited time only across consecutive accepted observations, each
//    interval capped at 250 ms so a silent gap cannot look like stability;
//  - interruptions up to 600 ms pause progress without adding evidence;
//  - a candidate lives at most 10 s, then expires into an explicit recovery
//    result rather than stalling at a frozen fraction;
//  - capture timestamps must be finite and strictly increasing, so repeated or
//    replayed results never count twice.
//
// All tunables live in SETUP_MEASUREMENT_DEFAULTS and are documented by purpose
// in the plan. Adjust them only against measured results.

import {assessStanding, type Calibration, type Point, type StandingAssessment, type StandingEdge, type StandingReason} from '../../../web/dist/pose.js';

export type SetupMeasurementConfig = {
  /** Distinct accepted observations required before completion. */
  minSamples: number;
  /** Credited accepted milliseconds required before completion. */
  minAcceptedMs: number;
  /** Longest a single candidate may live before it expires into recovery. */
  maxCandidateMs: number;
  /** Gap above which a candidate is discarded instead of resumed. */
  interruptionToleranceMs: number;
  /** Largest time credited by one consecutive accepted interval. */
  intervalCreditCapMs: number;
  /** Height spread allowed across the whole candidate, relative to height. */
  heightSpreadRatio: number;
  /** Floor spread allowed across the whole candidate, absolute. */
  floorSpread: number;
  /** Horizontal centre spread allowed across the whole candidate, absolute. */
  centreSpread: number;
  /** Ring buffer size for the locked value; the only unbounded-cost guard. */
  maxStoredSamples: number;
};

export const SETUP_MEASUREMENT_DEFAULTS: SetupMeasurementConfig = {
  minSamples: 30,
  minAcceptedMs: 2500,
  maxCandidateMs: 10000,
  interruptionToleranceMs: 600,
  intervalCreditCapMs: 250,
  heightSpreadRatio: 0.04,
  floorSpread: 0.025,
  centreSpread: 0.035,
  maxStoredSamples: 64,
};

export type SetupMeasurementPhase = 'idle' | 'collecting' | 'paused' | 'done' | 'expired';

/** Structured cause of an update. Never derive behaviour from display text. */
export type SetupMeasurementReason =
  | StandingReason
  | 'not_started'
  | 'rejected_timestamp'
  | 'duplicate'
  | 'out_of_order'
  | 'interrupted'
  | 'changed'
  | 'slow'
  | 'done';

export type SetupMeasurement = {
  phase: SetupMeasurementPhase;
  reason: SetupMeasurementReason;
  /** This observation added evidence. */
  accepted: boolean;
  /** This observation discarded a prior candidate. */
  reset: boolean;
  resetReason: 'interrupted' | 'changed' | null;
  progress: number;
  samples: number;
  acceptedMs: number;
  /** Time since the candidate's first accepted observation. */
  elapsedMs: number;
  value: Calibration | null;
  scale: number | null;
  edge: StandingEdge | null;
};

type Candidate = {
  firstAt: number;
  lastAt: number;
  acceptedMs: number;
  samples: number;
  minHeight: number;
  maxHeight: number;
  minFloor: number;
  maxFloor: number;
  minCentre: number;
  maxCentre: number;
};

type Sample = { height: number; floor: number; centre: number };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export class StableHeightCalibration {
  private readonly settings: SetupMeasurementConfig;
  private candidate: Candidate | null = null;
  private recent: Sample[] = [];
  private lastObservedAt = -Infinity;
  private phase: SetupMeasurementPhase = 'idle';
  private reason: SetupMeasurementReason = 'not_started';
  private interrupted = false;
  private locked: Calibration | null = null;
  private lastAssessment: StandingAssessment | null = null;

  constructor(settings: SetupMeasurementConfig = SETUP_MEASUREMENT_DEFAULTS) {
    this.settings = {...settings};
  }

  get config(): Readonly<SetupMeasurementConfig> {
    return this.settings;
  }

  get measurement(): SetupMeasurement {
    return this.snapshot(false, this.reason, false, null);
  }

  /** Exposed for the storage bound test; the ring is the only retained evidence. */
  get storedSamples(): number {
    return this.recent.length;
  }

  get assessment(): StandingAssessment | null {
    return this.lastAssessment;
  }

  /** Begin a fresh candidate. Capture-timestamp ordering is preserved. */
  reset(): void {
    this.candidate = null;
    this.recent = [];
    this.phase = 'idle';
    this.reason = 'not_started';
    this.interrupted = false;
    this.locked = null;
    this.lastAssessment = null;
  }

  /**
   * The controller declares that observation freshness was lost. The next
   * accepted observation credits no time; the candidate survives unless the
   * gap exceeds the interruption tolerance.
   */
  markInterrupted(): void {
    this.interrupted = true;
    if (this.candidate) {
      this.phase = 'paused';
      this.reason = 'interrupted';
    }
  }

  /** Enforce the candidate age bound when observations stop arriving. */
  expireIfStale(now: number): SetupMeasurement {
    if (!this.locked && this.candidate && finite(now) && now - this.candidate.firstAt > this.settings.maxCandidateMs) {
      this.phase = 'expired';
      this.reason = 'slow';
    }
    return this.snapshot(false, this.reason, false, null);
  }

  /**
   * Feed one observation. `capturedAt` must be the monotonic capture time of the
   * frame the landmarks came from, not the time the result arrived.
   */
  observe(image: Point[] | null | undefined, world: Point[] | null | undefined, capturedAt: number): SetupMeasurement {
    if (this.locked) return this.snapshot(false, 'done', false, null);
    if (!finite(capturedAt)) return this.snapshot(false, 'rejected_timestamp', false, null);
    if (capturedAt <= this.lastObservedAt) {
      return this.snapshot(false, capturedAt === this.lastObservedAt ? 'duplicate' : 'out_of_order', false, null);
    }
    this.lastObservedAt = capturedAt;
    if (this.phase === 'expired') return this.snapshot(false, 'slow', false, null);

    const assessment = assessStanding(image, world);
    this.lastAssessment = assessment;

    if (!assessment.ok) {
      // Known invalid observation: pause. No sample, no credited time. The
      // resume decision is deferred to the next accepted observation so there
      // is exactly one place that discards a candidate.
      if (this.candidate) {
        this.phase = 'paused';
        this.reason = assessment.reason;
      } else {
        this.phase = 'idle';
        this.reason = assessment.reason;
      }
      if (this.candidate && capturedAt - this.candidate.firstAt > this.settings.maxCandidateMs) {
        this.phase = 'expired';
        this.reason = 'slow';
      }
      return this.snapshot(false, this.reason, false, null);
    }

    const wasPaused = this.phase === 'paused' || this.interrupted;
    this.interrupted = false;

    if (!this.candidate) {
      this.startCandidate(assessment, capturedAt);
      return this.snapshot(true, 'eligible', false, null);
    }

    const gap = capturedAt - this.candidate.lastAt;
    // The interruption tolerance applies to recovery from *known invalid*
    // observations, not to a slow but continuous stream. A device that only
    // delivers one observation per second is not being interrupted; it is being
    // slow, and the candidate age bound is what catches it. Treating a long
    // consecutive gap as an interruption would reset a slow stream forever and
    // recreate the stalled-progress failure this adapter exists to remove.
    if (wasPaused && gap > this.settings.interruptionToleranceMs) {
      this.startCandidate(assessment, capturedAt);
      return this.snapshot(true, 'interrupted', true, 'interrupted');
    }
    if (!this.consistent(assessment)) {
      this.startCandidate(assessment, capturedAt);
      return this.snapshot(true, 'changed', true, 'changed');
    }

    const credit = wasPaused ? 0 : Math.min(gap, this.settings.intervalCreditCapMs);
    this.accept(assessment, capturedAt, credit);

    if (this.candidate.samples >= this.settings.minSamples && this.candidate.acceptedMs >= this.settings.minAcceptedMs) {
      this.locked = {
        height: median(this.recent.map(sample => sample.height)),
        floor: median(this.recent.map(sample => sample.floor)),
        center: median(this.recent.map(sample => sample.centre)),
      };
      this.phase = 'done';
      this.reason = 'done';
      return this.snapshot(false, 'done', false, null);
    }
    if (capturedAt - this.candidate.firstAt > this.settings.maxCandidateMs) {
      this.phase = 'expired';
      this.reason = 'slow';
      return this.snapshot(false, 'slow', false, null);
    }
    return this.snapshot(true, 'eligible', false, null);
  }

  private startCandidate(assessment: Extract<StandingAssessment, {ok: true}>, capturedAt: number): void {
    const sample = {height: assessment.height, floor: assessment.floor, centre: assessment.center};
    this.candidate = {
      firstAt: capturedAt,
      lastAt: capturedAt,
      acceptedMs: 0,
      samples: 1,
      minHeight: sample.height,
      maxHeight: sample.height,
      minFloor: sample.floor,
      maxFloor: sample.floor,
      minCentre: sample.centre,
      maxCentre: sample.centre,
    };
    this.recent = [sample];
    this.phase = 'collecting';
    this.reason = 'eligible';
  }

  private accept(assessment: Extract<StandingAssessment, {ok: true}>, capturedAt: number, credit: number): void {
    const candidate = this.candidate!;
    const sample = {height: assessment.height, floor: assessment.floor, centre: assessment.center};
    candidate.lastAt = capturedAt;
    candidate.acceptedMs += credit;
    candidate.samples += 1;
    candidate.minHeight = Math.min(candidate.minHeight, sample.height);
    candidate.maxHeight = Math.max(candidate.maxHeight, sample.height);
    candidate.minFloor = Math.min(candidate.minFloor, sample.floor);
    candidate.maxFloor = Math.max(candidate.maxFloor, sample.floor);
    candidate.minCentre = Math.min(candidate.minCentre, sample.centre);
    candidate.maxCentre = Math.max(candidate.maxCentre, sample.centre);
    this.recent.push(sample);
    if (this.recent.length > this.settings.maxStoredSamples) this.recent.shift();
    this.phase = 'collecting';
    this.reason = 'eligible';
  }

  /**
   * Would this observation keep the retained candidate consistent? The original
   * estimator compared spread against the median height over a 3 s window; a
   * candidate now spans up to 10 s, so the comparison is made against the whole
   * candidate with the same tolerances.
   */
  private consistent(assessment: Extract<StandingAssessment, {ok: true}>): boolean {
    const candidate = this.candidate!;
    const minHeight = Math.min(candidate.minHeight, assessment.height);
    const maxHeight = Math.max(candidate.maxHeight, assessment.height);
    const reference = (minHeight + maxHeight) / 2;
    if (!(reference > 0)) return false;
    if (!(maxHeight - minHeight < reference * this.settings.heightSpreadRatio)) return false;
    if (!(Math.max(candidate.maxFloor, assessment.floor) - Math.min(candidate.minFloor, assessment.floor) < this.settings.floorSpread)) return false;
    if (!(Math.max(candidate.maxCentre, assessment.center) - Math.min(candidate.minCentre, assessment.center) < this.settings.centreSpread)) return false;
    return true;
  }

  private snapshot(
    accepted: boolean,
    reason: SetupMeasurementReason,
    reset: boolean,
    resetReason: 'interrupted' | 'changed' | null,
  ): SetupMeasurement {
    const candidate = this.candidate;
    const samples = candidate?.samples ?? 0;
    const acceptedMs = candidate?.acceptedMs ?? 0;
    const elapsedMs = candidate ? Math.max(0, this.lastObservedAt - candidate.firstAt) : 0;
    const progress = this.locked
      ? 1
      : Math.min(1, acceptedMs / this.settings.minAcceptedMs, samples / this.settings.minSamples);
    return {
      phase: this.phase,
      reason,
      accepted,
      reset,
      resetReason,
      progress: Number.isFinite(progress) ? progress : 0,
      samples,
      acceptedMs,
      elapsedMs,
      value: this.locked ? {...this.locked} : null,
      scale: this.lastAssessment?.scale ?? null,
      edge: this.lastAssessment?.edge ?? null,
    };
  }
}
