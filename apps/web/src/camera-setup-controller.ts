// Guided camera setup: the single owner of setup stage, intent and eligibility.
//
// Pure and framework-free: no React, no DOM, no timers, no audio. Every time
// value is passed in on one monotonic clock, so tests drive it with synthetic
// timestamped pose sequences and the app drives it with the same
// `performance.now()` values that stamp captured frames.
//
// Responsibilities:
//  - represent stage, intent, complete source identity, issue, progress and
//    handoff status explicitly (never inferred from strings or camera state);
//  - admit observations (source match, freshness, ordering) and reject the rest
//    with a structured reason;
//  - accumulate positioning dwell and delegate measurement continuity to
//    StableHeightCalibration;
//  - recheck readiness, then hand off exactly once through a consumed token.
//
// Audio, presentation and session playback belong to other modules. See
// docs/guided-camera-setup-implementation-plan.md.

import {assessStanding, type Calibration, type Point, type StandingAssessment} from '../../../web/dist/pose.js';
import {FRAMING_DEFAULTS, observeBody, type BodyObservation} from './camera-framing.ts';
import {
  SETUP_MEASUREMENT_DEFAULTS,
  StableHeightCalibration,
  type SetupMeasurement,
  type SetupMeasurementConfig,
} from './camera-setup-estimator.ts';

/** A complete source identity. `epoch` alone is not enough: dimensions change without it. */
export type SetupSourceIdentity = {
  generation: number;
  deviceId: string;
  width: number;
  height: number;
};

export type SetupIntent = 'start_practice' | 'start_compete' | 'setup_only';

export type SetupRequirements = {
  facing: 'user' | 'environment';
  pairedDisplay: boolean;
  controlsConfirmed: boolean;
};

export type SetupStage =
  | 'prepare'
  | 'starting'
  | 'positioning'
  | 'measuring'
  | 'ready'
  | 'handoff'
  | 'help'
  | 'error'
  | 'cancelled';

export type SetupIssue =
  | 'person_missing'
  | 'invalid_evidence'
  | 'tracking_lost'
  | 'too_large'
  | 'head_missing'
  | 'feet_missing'
  | 'too_small'
  | 'hands_missing'
  | 'edge_risk'
  | 'standing_required'
  | 'off_center'
  | 'unstable';

export type SetupFailure =
  | 'permission_denied'
  | 'no_camera'
  | 'insecure_context'
  | 'tracker_failed'
  | 'camera_ended'
  | 'unknown';

export type SetupHelpReason = 'slow_measurement' | 'controls_unconfirmed' | 'positioning_difficult';

export type SetupRejection = 'non_finite' | 'duplicate' | 'out_of_order' | 'stale' | 'source_mismatch' | 'wrong_stage';

export type SetupControllerConfig = {
  /** Setup positioning/measurement eligibility threshold (auto-framing keeps 0.60). */
  visibilityThreshold: number;
  evidenceFreshnessMs: number;
  trackingLossMs: number;
  eligibilityHoldMs: number;
  dwellIntervalCapMs: number;
  readyMinimumMs: number;
  readyAnnouncementTimeoutMs: number;
  centreTolerance: number;
  centreExitTolerance: number;
  helpAfterMs: number;
  stuckAfterMs: number;
  measurement: SetupMeasurementConfig;
};

export const SETUP_DEFAULTS: SetupControllerConfig = {
  visibilityThreshold: 0.65,
  evidenceFreshnessMs: 500,
  trackingLossMs: 900,
  eligibilityHoldMs: 500,
  dwellIntervalCapMs: 250,
  readyMinimumMs: 1000,
  readyAnnouncementTimeoutMs: 1500,
  centreTolerance: 0.15,
  centreExitTolerance: 0.2,
  helpAfterMs: 20000,
  stuckAfterMs: 45000,
  measurement: SETUP_MEASUREMENT_DEFAULTS,
};

/** Primary issue order: one clear next action, most actionable first. */
const ISSUE_PRIORITY: readonly SetupIssue[] = [
  'person_missing',
  'invalid_evidence',
  'tracking_lost',
  'too_large',
  'head_missing',
  'feet_missing',
  'too_small',
  'hands_missing',
  'edge_risk',
  'standing_required',
  'off_center',
  'unstable',
];

export const GUIDED_HANDOFF_SECONDS = 5;

export type SetupSnapshot = {
  stage: SetupStage | null;
  intent: SetupIntent | null;
  source: SetupSourceIdentity | null;
  issue: SetupIssue | null;
  issues: readonly SetupIssue[];
  regions: {head: boolean; feet: boolean; hands: boolean; body: boolean};
  /** Body bounds frozen at the moment positioning was accepted. */
  outline: {left: number; top: number; right: number; bottom: number} | null;
  progress: number;
  dwellMs: number;
  samples: number;
  acceptedMs: number;
  measurement: {phase: SetupMeasurement['phase']; reason: SetupMeasurement['reason']};
  calibration: Calibration | null;
  positionFound: boolean;
  trackingLost: boolean;
  resetReason: 'interrupted' | 'changed' | 'source_changed' | null;
  requirementBlocked: boolean;
  requirements: SetupRequirements | null;
  help: {reason: SetupHelpReason | null; suggested: boolean; stuck: boolean};
  failure: SetupFailure | null;
  elapsedMs: number;
  ready: {announcement: 'pending' | 'finished' | 'timed_out'; elapsedMs: number};
  handoff: {pending: boolean; consumed: boolean; intent: SetupIntent | null};
  rejection: SetupRejection | null;
  /** True while setup owns the workspace; every playback/navigation action is blocked. */
  blocksSessionActions: boolean;
};

export type SetupHandoff = {
  intent: SetupIntent;
  calibration: Calibration;
  source: SetupSourceIdentity;
  countdownSeconds: number;
  consumedAt: number;
};

export type SetupEvent =
  | {type: 'prepare'; intent: SetupIntent; now: number}
  | {type: 'begin'; intent: SetupIntent; source: SetupSourceIdentity; requirements: SetupRequirements; now: number}
  | {type: 'source_resolved'; source: SetupSourceIdentity; now: number}
  | {type: 'camera_starting'; now: number}
  | {type: 'camera_ready'; now: number}
  | {type: 'camera_failed'; failure: SetupFailure; now: number}
  | {type: 'source_changed'; source: SetupSourceIdentity; now: number}
  | {type: 'requirements'; requirements: SetupRequirements}
  | {type: 'confirm_controls'}
  | {type: 'observation'; image: Point[] | null; world: Point[] | null; source: SetupSourceIdentity; capturedAt: number; receivedAt: number}
  | {type: 'tick'; now: number}
  | {type: 'announcement_finished'; now: number}
  | {type: 'show_help'; reason: SetupHelpReason; now: number}
  | {type: 'retry_setup'; now: number}
  | {type: 'retry_camera'; now: number}
  | {type: 'cancel'; now: number};

export function sourceKey(source: SetupSourceIdentity): string {
  return `${source.generation}|${source.deviceId}|${source.width}x${source.height}`;
}

export function sourceMatches(a: SetupSourceIdentity | null, b: SetupSourceIdentity | null): boolean {
  return !!a && !!b && a.generation === b.generation && a.deviceId === b.deviceId && a.width === b.width && a.height === b.height;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const LIVE_STAGES: readonly SetupStage[] = ['positioning', 'measuring', 'ready', 'handoff'];

export class CameraSetupController {
  readonly config: SetupControllerConfig;
  private readonly estimator: StableHeightCalibration;

  private stage: SetupStage | null = null;
  private intent: SetupIntent | null = null;
  private source: SetupSourceIdentity | null = null;
  private requirements: SetupRequirements | null = null;

  private startedAt = 0;
  private stageAt = 0;
  private lastCapturedAt = -Infinity;
  private lastAdmittedAt = -Infinity;
  private lastValidAt = -Infinity;

  private holdMs = 0;
  private lastEligibleAt: number | null = null;
  private offCentre = false;
  private issues: SetupIssue[] = [];
  private body: BodyObservation | null = null;
  private assessment: StandingAssessment | null = null;
  private measurement: SetupMeasurement | null = null;
  private calibration: Calibration | null = null;
  private lockedSourceKey: string | null = null;
  private resetReason: 'interrupted' | 'changed' | 'source_changed' | null = null;
  private rejection: SetupRejection | null = null;
  private trackingLost = false;

  private readyAt = 0;
  private announcement: 'pending' | 'finished' | 'timed_out' = 'pending';
  private handoffPending = false;
  private handoffConsumed = false;
  private handoffAt = 0;

  private failure: SetupFailure | null = null;
  private helpReason: SetupHelpReason | null = null;
  private outline: {left: number; top: number; right: number; bottom: number} | null = null;
  private readonly listeners = new Set<() => void>();
  private lastNotifiedKey = '';
  private now = 0;

  constructor(config: SetupControllerConfig = SETUP_DEFAULTS) {
    this.config = {...config, measurement: {...config.measurement}};
    this.estimator = new StableHeightCalibration(this.config.measurement);
  }

  // ---------------------------------------------------------------- snapshot

  get snapshot(): SetupSnapshot {
    const measurement = this.measurement ?? this.estimator.measurement;
    const elapsed = this.stage ? Math.max(0, this.now - this.startedAt) : 0;
    const issues = this.issues;
    return {
      stage: this.stage,
      intent: this.intent,
      source: this.source ? {...this.source} : null,
      issue: issues.length ? issues[0] : null,
      issues,
      regions: {
        head: this.body?.headVisible ?? false,
        feet: this.body?.feetVisible ?? false,
        hands: this.body?.handsVisible ?? false,
        body: this.body?.reliable ?? false,
      },
      outline: this.outline ? {...this.outline} : null,
      progress: this.stage === 'measuring' || this.stage === 'ready' || this.stage === 'handoff' ? measurement.progress : 0,
      dwellMs: Math.min(this.holdMs, this.config.eligibilityHoldMs),
      samples: measurement.samples,
      acceptedMs: measurement.acceptedMs,
      measurement: {phase: measurement.phase, reason: measurement.reason},
      calibration: this.calibration ? {...this.calibration} : null,
      positionFound: this.stage === 'measuring' || this.stage === 'ready' || this.stage === 'handoff',
      trackingLost: this.trackingLost,
      resetReason: this.resetReason,
      requirementBlocked: !this.requirementsMet(),
      requirements: this.requirements ? {...this.requirements} : null,
      help: {
        reason: this.helpReason,
        suggested: this.helpReason !== null || (this.stage === 'positioning' && elapsed >= this.config.helpAfterMs),
        stuck: this.stage === 'positioning' && elapsed >= this.config.stuckAfterMs,
      },
      failure: this.failure,
      elapsedMs: elapsed,
      ready: {announcement: this.announcement, elapsedMs: this.stage === 'ready' || this.stage === 'handoff' ? Math.max(0, this.now - this.readyAt) : 0},
      handoff: {pending: this.handoffPending, consumed: this.handoffConsumed, intent: this.handoffConsumed || this.handoffPending ? this.intent : null},
      rejection: this.rejection,
      blocksSessionActions: this.blocksSessionActions,
    };
  }

  /** Setup owns the workspace until a handoff is consumed, or setup is cancelled. */
  get blocksSessionActions(): boolean {
    if (this.stage === null || this.stage === 'cancelled') return false;
    if (this.stage === 'handoff') return !this.handoffConsumed;
    return true;
  }

  // ------------------------------------------------------------------ events

  /** Coarse change notification for React; geometry stays in the render loop. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispatch(event: SetupEvent): void {
    this.apply(event);
    this.notify();
  }

  private apply(event: SetupEvent): void {
    if (this.stage === 'cancelled' && event.type !== 'prepare' && event.type !== 'begin') return;
    switch (event.type) {
      case 'prepare':
        this.beginAt('prepare', event.intent, event.now);
        return;
      case 'begin':
        this.beginAt('starting', event.intent, event.now);
        this.source = {...event.source};
        this.requirements = {...event.requirements};
        return;
      case 'source_resolved':
        // Dimensions are only known once the video element has them. Resolving
        // them is not a configuration change: it must not clear confirmation or
        // invalidate a candidate that cannot exist yet.
        if (this.stage === 'starting' || this.stage === 'positioning') this.source = {...event.source};
        return;
      case 'camera_starting':
        this.enter('starting', event.now);
        this.failure = null;
        this.helpReason = null;
        return;
      case 'camera_ready':
        this.enter('positioning', event.now);
        this.startedAt = event.now;
        this.failure = null;
        this.helpReason = null;
        this.resetDwell();
        this.estimator.reset();
        this.measurement = null;
        this.lastAdmittedAt = event.now;
        this.lastValidAt = -Infinity;
        return;
      case 'camera_failed':
        this.enter('error', event.now);
        this.failure = event.failure;
        this.calibration = null;
        this.lockedSourceKey = null;
        this.clearHandoff();
        this.estimator.reset();
        return;
      case 'source_changed':
        this.onSourceChanged(event.source, event.now);
        return;
      case 'requirements':
        this.requirements = {...event.requirements};
        return;
      case 'confirm_controls':
        if (this.requirements) this.requirements = {...this.requirements, controlsConfirmed: true};
        return;
      case 'observation':
        this.onObservation(event);
        return;
      case 'tick':
        this.onTick(event.now);
        return;
      case 'announcement_finished':
        this.onAnnouncementFinished(event.now);
        return;
      case 'show_help':
        this.helpReason = event.reason;
        this.enter('help', event.now);
        this.clearHandoff();
        return;
      case 'retry_setup':
        if (this.stage !== 'help' && this.stage !== 'error') return;
        this.failure = null;
        this.helpReason = null;
        this.enter('positioning', event.now);
        this.resetDwell();
        this.clearMeasurementCandidate();
        return;
      case 'retry_camera':
        this.failure = null;
        this.helpReason = null;
        this.enter('starting', event.now);
        this.clearMeasurementCandidate();
        return;
      case 'cancel':
        this.enter('cancelled', event.now);
        this.clearHandoff();
        this.estimator.reset();
        this.measurement = null;
        this.calibration = null;
        this.lockedSourceKey = null;
        this.issues = [];
        this.body = null;
        this.assessment = null;
        this.resetDwell();
        return;
    }
  }

  /**
   * Single-use handoff token. Repeated completion events, re-renders and
   * duplicate `done` observations cannot mint a second token.
   */
  consumeHandoff(): SetupHandoff | null {
    if (this.stage !== 'handoff' || !this.handoffPending || this.handoffConsumed || !this.intent || !this.calibration || !this.source) return null;
    this.handoffPending = false;
    this.handoffConsumed = true;
    this.handoffAt = this.now;
    this.notify();
    return {
      intent: this.intent,
      calibration: {...this.calibration},
      source: {...this.source},
      countdownSeconds: GUIDED_HANDOFF_SECONDS,
      consumedAt: this.handoffAt,
    };
  }

  private notify(): void {
    const key = this.renderKey();
    if (key === this.lastNotifiedKey) return;
    this.lastNotifiedKey = key;
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Coarse fingerprint. Continuous values (progress, dwell) are bucketed so the
   * overlay's geometry can stay in the animation loop instead of React state.
   */
  private renderKey(): string {
    const measurement = this.measurement;
    const progress = measurement && (this.stage === 'measuring' || this.stage === 'ready' || this.stage === 'handoff') ? measurement.progress : 0;
    return [
      this.stage,
      this.intent,
      this.issues.join(','),
      this.holdMs >= this.config.eligibilityHoldMs ? 'held' : 'dwell',
      measurement?.phase ?? '',
      measurement?.reason ?? '',
      Math.round(progress * 20),
      this.trackingLost ? 'lost' : '',
      this.resetReason ?? '',
      this.handoffPending ? 'pending' : '',
      this.handoffConsumed ? 'consumed' : '',
      this.helpReason ?? '',
      this.failure ?? '',
      this.rejection ?? '',
      this.requirementsMet() ? 'ready' : 'blocked',
      this.outline ? 'outline' : '',
      this.announcement,
      this.pausedByTracking(),
    ].join('|');
  }

  private pausedByTracking(): string {
    if (this.stage !== 'positioning' && this.stage !== 'measuring') return '';
    return this.holdMs > 0 ? 'moving' : 'still';
  }

  // ----------------------------------------------------------------- helpers

  private beginAt(stage: SetupStage, intent: SetupIntent, now: number): void {
    this.stage = stage;
    this.intent = intent;
    this.startedAt = now;
    this.stageAt = now;
    this.now = now;
    this.lastCapturedAt = -Infinity;
    this.lastAdmittedAt = -Infinity;
    this.lastValidAt = -Infinity;
    this.calibration = null;
    this.lockedSourceKey = null;
    this.measurement = null;
    this.assessment = null;
    this.body = null;
    this.issues = [];
    this.failure = null;
    this.helpReason = null;
    this.resetReason = null;
    this.rejection = null;
    this.trackingLost = false;
    this.announcement = 'pending';
    this.clearHandoff();
    this.estimator.reset();
    this.resetDwell();
  }

  private enter(stage: SetupStage, now: number): void {
    this.stage = stage;
    this.stageAt = now;
    this.now = now;
  }

  private resetDwell(): void {
    this.holdMs = 0;
    this.lastEligibleAt = null;
  }

  private clearHandoff(): void {
    this.handoffPending = false;
    this.handoffConsumed = false;
    this.handoffAt = 0;
  }

  private clearMeasurementCandidate(): void {
    this.estimator.reset();
    this.measurement = null;
    this.outline = null;
    this.resetDwell();
  }

  private requirementsMet(): boolean {
    const requirements = this.requirements;
    if (!requirements) return false;
    if (requirements.facing !== 'environment') return true;
    return requirements.pairedDisplay || requirements.controlsConfirmed;
  }

  private onSourceChanged(source: SetupSourceIdentity, now: number): void {
    const changed = !sourceMatches(this.source, source);
    this.source = {...source};
    if (!changed) return;
    this.calibration = null;
    this.lockedSourceKey = null;
    this.requirements = this.requirements ? {...this.requirements, controlsConfirmed: false} : null;
    this.clearHandoff();
    this.clearMeasurementCandidate();
    this.resetReason = 'source_changed';
    this.issues = [];
    this.body = null;
    this.assessment = null;
    if (this.stage && LIVE_STAGES.includes(this.stage)) this.enter('positioning', now);
    else this.now = now;
  }

  private onObservation(event: Extract<SetupEvent, {type: 'observation'}>): void {
    if (!this.stage || !LIVE_STAGES.includes(this.stage)) {
      this.rejection = 'wrong_stage';
      return;
    }
    if (!sourceMatches(this.source, event.source)) {
      this.rejection = 'source_mismatch';
      return;
    }
    if (!finite(event.capturedAt) || !finite(event.receivedAt)) {
      this.rejection = 'non_finite';
      return;
    }
    if (event.capturedAt <= this.lastCapturedAt) {
      this.rejection = event.capturedAt === this.lastCapturedAt ? 'duplicate' : 'out_of_order';
      return;
    }
    if (event.receivedAt - event.capturedAt > this.config.evidenceFreshnessMs) {
      this.rejection = 'stale';
      return;
    }
    this.rejection = null;
    this.lastCapturedAt = event.capturedAt;
    this.lastAdmittedAt = event.receivedAt;
    this.now = event.receivedAt;

    const assessment = assessStanding(event.image, event.world);
    const body = observeBody(event.image, {
      ...FRAMING_DEFAULTS,
      visibilityThreshold: this.config.visibilityThreshold,
    });
    this.assessment = assessment;
    this.body = body;
    this.issues = this.deriveIssues(assessment, body);

    if (this.stage === 'ready' || this.stage === 'handoff') {
      if (assessment.ok) this.lastValidAt = event.capturedAt;
      return;
    }

    if (this.stage === 'positioning') {
      this.trackingLost = false;
      const eligible = this.eligible(assessment, body);
      if (!eligible) {
        this.holdMs = 0;
        this.lastEligibleAt = event.capturedAt;
        return;
      }
      const gap = this.lastEligibleAt === null ? 0 : event.capturedAt - this.lastEligibleAt;
      this.holdMs = gap > this.config.measurement.interruptionToleranceMs ? 0 : this.holdMs + Math.min(gap, this.config.dwellIntervalCapMs);
      this.lastEligibleAt = event.capturedAt;
      if (this.holdMs < this.config.eligibilityHoldMs) return;
      if (!this.requirementsMet()) {
        this.helpReason = 'controls_unconfirmed';
        this.enter('help', event.receivedAt);
        this.clearHandoff();
        return;
      }
      this.enter('measuring', event.receivedAt);
      this.resetReason = null;
      this.clearMeasurementCandidate();
      // Freeze the accepted proportions once. The overlay draws this outline for
      // the whole measurement stage; it is never re-derived from live landmarks.
      this.outline = body.bounds ? {...body.bounds} : null;
      this.lastEligibleAt = event.capturedAt;
      this.holdMs = this.config.eligibilityHoldMs;
      this.feedMeasurement(event, assessment);
      return;
    }

    // measuring
    this.feedMeasurement(event, assessment);
  }

  private eligible(assessment: StandingAssessment, body: BodyObservation): boolean {
    if (!assessment.ok) return false;
    if (!body.reliable || !body.headVisible || !body.feetVisible || !body.handsVisible) return false;
    if (body.outsideSource || body.edgeRisk) return false;
    if (!body.center) return false;
    const offset = Math.abs(body.center.x - 0.5);
    if (this.offCentre) {
      if (offset <= this.config.centreExitTolerance) this.offCentre = false;
    } else if (offset > this.config.centreTolerance) {
      this.offCentre = true;
    }
    return !this.offCentre;
  }

  private feedMeasurement(event: Extract<SetupEvent, {type: 'observation'}>, assessment: StandingAssessment): void {
    if (assessment.ok) this.lastValidAt = event.capturedAt;
    const measurement = this.estimator.observe(event.image, event.world, event.capturedAt);
    this.measurement = measurement;
    this.trackingLost = false;
    if (measurement.phase === 'done' && measurement.value) {
      this.calibration = {...measurement.value};
      this.lockedSourceKey = this.source ? sourceKey(this.source) : null;
      this.issues = [];
      this.enter('ready', event.receivedAt);
      this.readyAt = event.receivedAt;
      this.announcement = 'pending';
      return;
    }
    if (measurement.phase === 'expired') {
      this.helpReason = 'slow_measurement';
      this.enter('help', event.receivedAt);
      this.clearHandoff();
      return;
    }
    if (measurement.reset) {
      this.resetReason = measurement.resetReason;
      this.clearMeasurementCandidate();
      this.enter('positioning', event.receivedAt);
    }
  }

  private deriveIssues(assessment: StandingAssessment, body: BodyObservation): SetupIssue[] {
    const issues = new Set<SetupIssue>();
    if (!assessment.ok) {
      switch (assessment.reason) {
        case 'no_person':
          issues.add('person_missing');
          break;
        case 'invalid':
          issues.add('invalid_evidence');
          break;
        case 'occluded':
          if (!body.headVisible) issues.add('head_missing');
          else if (!body.feetVisible) issues.add('feet_missing');
          else issues.add('standing_required');
          break;
        case 'out_of_frame':
          issues.add('edge_risk');
          if (assessment.edge?.top) issues.add('head_missing');
          break;
        case 'not_standing':
          issues.add('standing_required');
          break;
        case 'too_small':
          issues.add('too_small');
          break;
        case 'too_large':
          issues.add('too_large');
          break;
      }
    }
    if (!body.headVisible) issues.add('head_missing');
    if (!body.feetVisible) issues.add('feet_missing');
    if (!body.handsVisible) issues.add('hands_missing');
    if (body.outsideSource || body.edgeRisk) issues.add('edge_risk');
    if (body.center && Math.abs(body.center.x - 0.5) > this.config.centreTolerance) issues.add('off_center');
    if (this.resetReason === 'changed' || this.resetReason === 'interrupted') issues.add('unstable');
    if (this.trackingLost) issues.add('tracking_lost');
    return ISSUE_PRIORITY.filter(issue => issues.has(issue));
  }

  private onTick(now: number): void {
    if (!this.stage || this.stage === 'cancelled' || this.stage === 'prepare' || this.stage === 'starting' || this.stage === 'error' || this.stage === 'help') {
      this.now = now;
      return;
    }
    this.now = now;

    if (this.stage === 'positioning' || this.stage === 'measuring') {
      if (now - this.lastAdmittedAt > this.config.trackingLossMs) {
        this.trackingLost = true;
        this.estimator.markInterrupted();
        if (this.stage === 'measuring') {
          this.enter('positioning', now);
          this.clearMeasurementCandidate();
          this.resetReason = 'interrupted';
        }
        this.resetDwell();
        this.issues = this.deriveIssues(
          this.assessment ?? {ok: false, reason: 'invalid', detail: 'tracking_lost', message: '', scale: null, edge: null},
          this.body ?? emptyObservation(),
        );
        if (!this.issues.includes('tracking_lost')) this.issues = ['tracking_lost', ...this.issues];
      }
      return;
    }

    if (this.stage === 'ready') {
      if (now - this.lastValidAt > this.config.trackingLossMs) {
        this.revertToPositioning(now);
        return;
      }
      const elapsed = now - this.readyAt;
      if (this.announcement === 'pending' && elapsed >= this.config.readyAnnouncementTimeoutMs) this.announcement = 'timed_out';
      if (elapsed >= this.config.readyMinimumMs && this.announcement !== 'pending') this.finalise(now);
      return;
    }

    if (this.stage === 'handoff' && this.handoffPending) {
      if (now - this.lastValidAt > this.config.trackingLossMs) this.revertToPositioning(now);
    }
  }

  private onAnnouncementFinished(now: number): void {
    this.now = now;
    if (this.stage !== 'ready') return;
    if (this.announcement === 'pending') this.announcement = 'finished';
    if (now - this.readyAt >= this.config.readyMinimumMs) this.finalise(now);
  }

  private finalise(now: number): void {
    this.now = now;
    if (this.stage !== 'ready' || !this.calibration || !this.source || !this.intent) {
      this.revertToPositioning(now);
      return;
    }
    if (this.lockedSourceKey !== sourceKey(this.source) || now - this.lastValidAt > this.config.trackingLossMs) {
      this.revertToPositioning(now);
      return;
    }
    if (!this.requirementsMet()) {
      this.helpReason = 'controls_unconfirmed';
      this.enter('help', now);
      return;
    }
    this.enter('handoff', now);
    this.handoffPending = true;
    this.handoffConsumed = false;
  }

  private revertToPositioning(now: number): void {
    this.calibration = null;
    this.lockedSourceKey = null;
    this.clearHandoff();
    this.clearMeasurementCandidate();
    this.resetReason = 'interrupted';
    this.enter('positioning', now);
    this.issues = this.issues.filter(issue => issue === 'tracking_lost');
    if (!this.issues.includes('tracking_lost')) this.issues = ['tracking_lost', ...this.issues];
  }
}

function emptyObservation(): BodyObservation {
  return {
    finite: false,
    reliable: false,
    bounds: null,
    padded: null,
    center: null,
    bodyWidth: 0,
    bodyHeight: 0,
    feetVisible: false,
    handsVisible: false,
    headVisible: false,
    edgeRisk: false,
    outsideSource: false,
    reason: 'invalid',
  };
}
