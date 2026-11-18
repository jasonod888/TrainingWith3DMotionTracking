import type {PracticePlan} from './practice-plan';
import {practiceUnitAt, reconcilePracticePlan} from './practice-plan';
import type {PracticeCommand} from './practice-commands';
import type {PracticeTransport, PracticeTransportSnapshot} from './practice-transport';
import {emptyTransportSnapshot} from './practice-transport';

export type Attempt = {id: string; start: number; end: number; completed: boolean; reason: string};
export type PracticeMode = 'sections' | 'continuous';
export type PracticePhase = 'idle' | 'countdown' | 'playing' | 'resting' | 'paused';
export type PracticeStatus =
  | 'idle'
  | 'countdown'
  | 'playing'
  | 'resting'
  | 'paused'
  | 'section-complete'
  | 'lesson-complete'
  | 'buffering'
  | 'error';
export type PracticeIntent = 'initial' | 'restored' | 'selected' | 'position' | 'started';
export type PracticePauseReason = string;

export type PracticeRuntimeSnapshot = {
  status: PracticeStatus;
  phase: PracticePhase;
  mode: PracticeMode;
  unitIndex: number;
  unitId: string;
  unitLabel: string;
  time: number;
  duration: number;
  remaining: number;
  restRemaining: number;
  playing: boolean;
  ready: boolean;
  buffering: boolean;
  ended: boolean;
  error: string;
  rate: number;
  loop: boolean;
  repetitions: number;
  restSeconds: number;
  countdownSeconds: number;
  run: number;
  completed: number;
  countdownSound: boolean;
  range: {start: number; end: number} | null;
  intent: PracticeIntent;
  pauseReason: PracticePauseReason;
  attempt: Attempt | null;
  hasProgress: boolean;
  atUnitEnd: boolean;
  sectionComplete: boolean;
  lessonComplete: boolean;
  canNext: boolean;
};

export type PracticeRuntimeOptions = {
  plan: PracticePlan;
  transport: PracticeTransport;
  /** Media transports are observed; internal transports are advanced by tick. */
  countdownSeconds?: number;
  restSeconds?: number;
  loop?: boolean;
  /** Zero means repeat until stopped. */
  repetitions?: number;
  mode?: PracticeMode;
  now?: () => number;
  id?: () => string;
};

const EPSILON = 1e-6;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function isPromise(value: unknown): value is Promise<void> {
  return Boolean(value && typeof (value as Promise<void>).then === 'function');
}

/**
 * One practice session authority for every subject.
 *
 * It owns countdown, repetitions, rest, unit boundaries, transitions, attempts
 * and interruption reasons. It never starts a timer and never advances media by
 * itself: callers drive `tick(delta)` from the one scheduler, and source time is
 * read from the transport. A media buffer is a distinct condition; it neither
 * completes the attempt nor silently advances time.
 */
export class PracticeRuntime {
  plan: PracticePlan;
  readonly transport: PracticeTransport;
  status: PracticeStatus = 'idle';
  phase: PracticePhase = 'idle';
  mode: PracticeMode;
  unitIndex = 0;
  time = 0;
  remaining = 0;
  restRemaining = 0;
  loop: boolean;
  repetitions: number;
  restSeconds: number;
  countdownSeconds: number;
  countdownSound = false;
  run = 0;
  completed = 0;
  range: {start: number; end: number} | null = null;
  intent: PracticeIntent = 'initial';
  pauseReason = '';
  error = '';
  playing = false;
  buffering = false;
  ready = false;
  ended = false;
  rate = 1;
  calibrating = false;
  attempt: Attempt | null = null;
  onAttempt?: (attempt: Attempt) => void;
  onPause?: (reason: string) => void;
  onAttemptStart?: (time: number, unitIndex: number) => void;
  onStatus?: (status: PracticeStatus) => void;
  private hasBegun = false;
  private playGeneration = 0;
  private seekTarget: number | null = null;
  private restContinuation: (() => void) | null = null;
  private destroyed = false;
  private lastAttemptStartedAt = 0;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private unsubscribeTransport: (() => void) | null = null;

  constructor(options: PracticeRuntimeOptions) {
    this.plan = options.plan;
    this.transport = options.transport;
    this.mode = options.mode ?? 'sections';
    this.loop = options.loop ?? false;
    this.repetitions = Math.max(0, Math.floor(options.repetitions ?? 0));
    this.restSeconds = Math.max(0, options.restSeconds ?? 0);
    this.countdownSeconds = Math.max(0, options.countdownSeconds ?? 0);
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.makeId = options.id ?? (() => (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `attempt-${Math.random().toString(36).slice(2)}`));
    this.readTransport(true);
    const initialUnit = practiceUnitAt(this.plan, this.time);
    if (initialUnit >= 0) this.unitIndex = initialUnit;
    if (!(this.time > 0)) this.time = this.unit.start;
    this.unsubscribeTransport = this.transport.subscribe(() => this.observe());
  }

  get unit() {
    const unit = this.plan.units[Math.min(this.unitIndex, this.plan.units.length - 1)];
    return unit ?? {id: '', label: '', start: 0, end: this.plan.duration};
  }

  get bounds(): {start: number; end: number} {
    return this.range ?? {start: this.unit.start, end: this.unit.end};
  }

  get snapshot(): PracticeRuntimeSnapshot {
    const atUnitEnd = this.range
      ? this.time >= this.bounds.end - EPSILON
      : this.time >= this.unit.end - EPSILON;
    const lessonComplete = this.status === 'lesson-complete';
    const sectionComplete = this.status === 'section-complete';
    return {
      status: this.status,
      phase: this.phase,
      mode: this.mode,
      unitIndex: this.unitIndex,
      unitId: this.unit.id,
      unitLabel: this.unit.label,
      time: this.time,
      duration: this.plan.duration,
      remaining: this.remaining,
      restRemaining: this.restRemaining,
      playing: this.playing,
      ready: this.ready,
      buffering: this.buffering,
      ended: this.ended,
      error: this.error,
      rate: this.rate,
      loop: this.loop,
      repetitions: this.repetitions,
      restSeconds: this.restSeconds,
      countdownSeconds: this.countdownSeconds,
      run: this.run,
      completed: this.completed,
      countdownSound: this.countdownSound,
      range: this.range ? {...this.range} : null,
      intent: this.intent,
      pauseReason: this.pauseReason,
      attempt: this.attempt ? {...this.attempt} : null,
      hasProgress: this.time > this.bounds.start + 0.05 || this.completed > 0 || this.intent === 'started',
      atUnitEnd,
      sectionComplete,
      lessonComplete,
      canNext: this.range ? false : this.unitIndex < this.plan.units.length - 1,
    };
  }

  private setStatus(status: PracticeStatus) {
    this.status = status;
    this.onStatus?.(status);
  }

  private readTransport(force = false): PracticeTransportSnapshot {
    const snapshot = this.transport.snapshot() ?? emptyTransportSnapshot(this.plan.duration);
    const freezeForBuffer = this.phase === 'playing' && snapshot.buffering;
    if ((force || this.phase !== 'countdown' && this.phase !== 'resting') && !freezeForBuffer) {
      if (this.seekTarget !== null && Math.abs(snapshot.time - this.seekTarget) > 0.35 && snapshot.playing) {
        // A media element can report its old position for a frame after a seek.
        // Do not use that stale time for a boundary decision.
      } else {
        if (this.seekTarget !== null && Math.abs(snapshot.time - this.seekTarget) <= 0.35) this.seekTarget = null;
        if (this.range) this.time = clamp(snapshot.time, this.range.start, this.range.end);
        else this.time = clamp(snapshot.time, 0, this.plan.duration);
      }
    }
    this.playing = snapshot.playing;
    this.ready = snapshot.ready;
    this.buffering = snapshot.buffering;
    this.ended = snapshot.ended;
    this.error = snapshot.error;
    this.rate = snapshot.rate;
    this.calibrating = Boolean(snapshot.calibrating);
    if (this.mode === 'continuous' && !this.range) {
      const index = practiceUnitAt(this.plan, this.time);
      if (index >= 0) this.unitIndex = index;
    }
    return snapshot;
  }

  /** Reads transport state without advancing anything; safe from media events. */
  observe(): PracticeRuntimeSnapshot {
    if (this.destroyed) return this.snapshot;
    this.readTransport();
    return this.snapshot;
  }

  /**
   * The single scheduler entry point. Count-in/rest use the monotonic delta;
   * source position only comes from the transport (or its internal advance).
   */
  tick(delta: number): PracticeRuntimeSnapshot {
    if (this.destroyed || !Number.isFinite(delta) || delta <= 0) return this.snapshot;
    let snapshot = this.readTransport();
    if (this.calibrating) {
      if (this.phase !== 'paused') this.pause('calibration');
      return this.snapshot;
    }
    if (this.phase === 'countdown' || this.phase === 'resting') {
      this.remaining = Math.max(0, this.remaining - delta);
      this.restRemaining = this.phase === 'resting' ? this.remaining : 0;
      if (!this.remaining) {
        if (this.phase === 'countdown') {
          this.beginAttempt();
        } else {
          const next = this.restContinuation;
          this.restContinuation = null;
          this.phase = 'playing';
          this.setStatus('playing');
          if (next) next();
          else this.beginAttempt();
        }
      }
      return this.snapshot;
    }
    if (this.status === 'buffering') {
      if (this.buffering) return this.snapshot;
      if (this.error) { this.failTransport(this.error); return this.snapshot; }
      if (!this.playing) { this.pause('interrupted'); return this.snapshot; }
      this.setStatus('playing');
      this.remaining = 0;
    }
    if (this.phase !== 'playing') return this.snapshot;
    if (this.playing && this.buffering) {
      // A stalled source freezes practice time and keeps the attempt open.
      this.setStatus('buffering');
      return this.snapshot;
    }
    if (this.error) { this.failTransport(this.error); return this.snapshot; }
    if (!this.playing && !this.ended) { this.pause('interrupted'); return this.snapshot; }
    if (this.transport.advance) {
      this.transport.advance(delta);
      snapshot = this.readTransport();
    }
    this.time = this.readTransport().time;
    if (this.ended) { this.completeUnit(); return this.snapshot; }
    const end = this.range ? this.bounds.end : this.mode === 'continuous' ? this.plan.duration : this.unit.end;
    if (this.time >= end - EPSILON) this.completeUnit();
    return this.snapshot;
  }

  dispatch(command: PracticeCommand): PracticeRuntimeSnapshot {
    if (this.destroyed) return this.snapshot;
    switch (command.type) {
      case 'action': return this.action(command.action, command.countdownSeconds);
      case 'select': return this.select(command.index);
      case 'seek': return this.seek(command.time);
      case 'set-mode': return this.setMode(command.mode);
      case 'set-rate': return this.setRate(command.rate);
      case 'set-loop': this.loop = command.loop; if (!this.loop) this.repetitions = 0; return this.snapshot;
      case 'set-repetitions': this.repetitions = Math.max(0, Math.floor(command.repetitions)); this.completed = 0; return this.snapshot;
      case 'set-countdown': this.countdownSeconds = Math.max(0, Math.round(command.seconds)); return this.snapshot;
      case 'set-rest': this.restSeconds = Math.max(0, command.seconds); return this.snapshot;
      case 'restore': return this.restore(command);
      case 'tick': return this.tick(command.delta);
      case 'destroy': this.destroy(); return this.snapshot;
    }
  }

  action(action: string, countdownSeconds?: number): PracticeRuntimeSnapshot {
    switch (action) {
      case 'start': return this.start(countdownSeconds);
      case 'play': return this.play();
      case 'resume': return this.resume();
      case 'pause': return this.pause('user');
      case 'toggle': return this.toggle();
      case 'next': return this.next();
      case 'previous': return this.previous();
      case 'repeat-section': return this.repeatSection();
      case 'restart-lesson': return this.restartLesson();
      default: return this.snapshot;
    }
  }

  /** Starts practice, applying the first-start count-in once. */
  start(secondsOverride?: number): PracticeRuntimeSnapshot {
    if (this.calibrating) return this.snapshot;
    if (this.status === 'countdown' || this.status === 'playing' || this.status === 'resting' || this.status === 'buffering') return this.snapshot;
    if (this.plan.units.length === 0) return this.snapshot;
    if (this.status === 'section-complete' || this.status === 'lesson-complete' || this.time >= this.bounds.end - EPSILON) {
      this.transport.pause();
      this.transport.seek(this.bounds.start);
      this.time = this.bounds.start;
    }
    this.error = '';
    this.intent = 'started';
    this.pauseReason = '';
    this.remaining = secondsOverride !== undefined && Number.isFinite(secondsOverride)
      ? Math.max(0, secondsOverride)
      : this.hasBegun ? 0 : this.countdownSeconds;
    this.phase = this.remaining > 0 ? 'countdown' : 'playing';
    this.setStatus(this.remaining > 0 ? 'countdown' : 'playing');
    if (this.remaining > 0) return this.snapshot;
    this.beginAttempt();
    return this.snapshot;
  }

  /** Idempotent: a second play while playing or counting in does nothing. */
  play(): PracticeRuntimeSnapshot {
    if (this.status === 'countdown' || this.status === 'playing' || this.status === 'resting' || this.status === 'buffering') return this.snapshot;
    // The initial play/toggle path must honor the same first-start count-in as the
    // primary button; paused resumes use start()'s hasBegun branch.
    return this.start();
  }

  /** Resumes a paused position immediately; a first-ever start still counts in. */
  resume(): PracticeRuntimeSnapshot {
    if (this.status === 'countdown' || this.status === 'playing' || this.status === 'resting' || this.status === 'buffering') return this.snapshot;
    if (this.intent === 'restored') return this.start(0);
    return this.start();
  }

  toggle(): PracticeRuntimeSnapshot {
    if (this.phase === 'countdown' || this.phase === 'playing' || this.phase === 'resting' || this.status === 'buffering') {
      return this.pause('user');
    }
    return this.play();
  }

  pause(reason: PracticePauseReason = 'user', finishAttempt = true): PracticeRuntimeSnapshot {
    if (this.phase === 'countdown' || this.phase === 'resting') {
      this.playGeneration += 1;
      this.remaining = 0;
      this.restContinuation = null;
      this.phase = 'paused';
      this.setStatus('paused');
      this.pauseReason = reason;
      this.onPause?.(reason);
      return this.snapshot;
    }
    if (this.phase !== 'playing' && this.status !== 'buffering') {
      return this.snapshot;
    }
    this.playGeneration += 1;
    try { this.transport.pause(); } catch { /* Transport teardown must not block the session. */ }
    this.playing = false;
    this.phase = 'paused';
    this.setStatus('paused');
    this.pauseReason = reason;
    if (finishAttempt) this.finishAttempt(false, reason);
    this.onPause?.(reason);
    return this.snapshot;
  }

  private abandonAttempt(reason: string) {
    this.finishAttempt(false, reason);
  }

  private beginAttempt() {
    this.phase = 'playing';
    this.setStatus('playing');
    this.remaining = 0;
    this.restRemaining = 0;
    this.error = '';
    this.pauseReason = '';
    const bounds = this.bounds;
    if (this.time < bounds.start || this.time >= bounds.end - EPSILON) {
      this.transport.seek(bounds.start);
      this.seekTarget = bounds.start;
      this.time = bounds.start;
    }
    const generation = ++this.playGeneration;
    const start = this.now();
    this.lastAttemptStartedAt = start;
    const pending = (): void => {
      if (this.destroyed || generation !== this.playGeneration) return;
      this.attempt = {id: this.makeId(), start: this.time, end: this.time, completed: false, reason: ''};
      this.hasBegun = true;
      this.run = Math.max(0, this.run);
      this.onAttemptStart?.(this.time, this.unitIndex);
    };
    let result: Promise<void> | void;
    try { result = this.transport.play(); }
    catch (error) {
      this.failPlay(error);
      return;
    }
    if (isPromise(result)) {
      void result.then(() => {
        if (this.destroyed || generation !== this.playGeneration) return;
        if (this.status === 'paused' || this.status === 'error') return;
        pending();
        if (this.buffering) this.setStatus('buffering');
      }).catch((error: unknown) => {
        if (this.destroyed || generation !== this.playGeneration) return;
        this.failPlay(error);
      });
    } else {
      pending();
    }
    if (start > 0) this.hasBegun = true;
  }

  private failPlay(error: unknown) {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Playback could not start.';
    this.error = message;
    this.phase = 'paused';
    this.playing = false;
    this.setStatus('error');
    this.pauseReason = 'play-failed';
    this.attempt = null;
    this.onPause?.('play-failed');
  }

  private failTransport(message: string) {
    this.error = message;
    this.phase = 'paused';
    this.setStatus('error');
    this.pauseReason = 'transport-error';
    try { this.transport.pause(); } catch { /* ignore */ }
    this.finishAttempt(false, 'transport-error');
    this.onPause?.('transport-error');
  }

  private finishAttempt(completed: boolean, reason: string) {
    if (!this.attempt) return;
    const attempt = {...this.attempt, end: this.time, completed, reason};
    this.attempt = null;
    this.onAttempt?.(attempt);
  }

  private completeUnit() {
    if (!this.attempt && this.phase !== 'playing') return;
    const end = this.range
      ? this.bounds.end
      : this.mode === 'continuous' ? this.plan.duration : this.unit.end;
    try { this.transport.pause(); } catch { /* ignore */ }
    this.transport.seek(end);
    this.seekTarget = end;
    this.time = end;
    this.playing = false;
    this.finishAttempt(true, 'completed');
    this.completed += 1;
    this.run += 1;

    if (this.range) {
      if (this.loop && (this.repetitions === 0 || this.run < this.repetitions)) {
        this.enterRest(() => this.startRepeatFromRange());
      } else {
        this.phase = 'paused';
        this.setStatus('paused');
      }
      return;
    }

    const lastUnit = this.unitIndex >= this.plan.units.length - 1;
    if (this.mode === 'continuous') {
      if (this.time >= this.plan.duration - EPSILON) {
        if (this.loop && (this.repetitions === 0 || this.run < this.repetitions)) {
          this.unitIndex = 0;
          this.enterRest(() => { this.transport.seek(0); this.time = 0; this.unitIndex = 0; this.beginAttempt(); }, 0);
        } else {
          this.phase = 'paused';
          this.setStatus('lesson-complete');
        }
      }
      return;
    }

    if (this.loop && (this.repetitions === 0 || this.run < this.repetitions)) {
      this.enterRest(() => this.repeatCurrentUnit());
      return;
    }
    this.phase = 'paused';
    this.setStatus(lastUnit ? 'lesson-complete' : 'section-complete');
  }

  private enterRest(next: () => void, start = this.bounds.start) {
    this.transport.seek(start);
    this.seekTarget = start;
    this.time = start;
    this.phase = 'resting';
    this.remaining = this.restSeconds;
    this.restRemaining = this.restSeconds;
    this.setStatus('resting');
    this.restContinuation = next;
    if (!this.remaining) {
      const action = this.restContinuation;
      this.restContinuation = null;
      this.phase = 'playing';
      this.setStatus('playing');
      action?.();
    }
  }

  private startRepeatFromRange() {
    this.transport.seek(this.bounds.start);
    this.seekTarget = this.bounds.start;
    this.time = this.bounds.start;
    this.beginAttempt();
  }

  private repeatCurrentUnit() {
    this.transport.seek(this.unit.start);
    this.seekTarget = this.unit.start;
    this.time = this.unit.start;
    this.beginAttempt();
  }

  /** Repeat the current unit from its start; a new attempt begins immediately. */
  repeatSection(): PracticeRuntimeSnapshot {
    if (this.calibrating) return this.snapshot;
    this.pause('section changed', false);
    this.abandonAttempt('section changed');
    this.transport.seek(this.bounds.start);
    this.seekTarget = this.bounds.start;
    this.time = this.bounds.start;
    this.run = 0;
    this.remaining = 0;
    this.start(0);
    return this.snapshot;
  }

  /** Restart lesson from unit one; distinct from repeating the current section. */
  restartLesson(): PracticeRuntimeSnapshot {
    if (this.calibrating) return this.snapshot;
    this.pause('lesson restarted', false);
    this.abandonAttempt('lesson restarted');
    this.unitIndex = 0;
    this.range = null;
    this.run = 0;
    this.completed = 0;
    this.time = this.plan.units[0]?.start ?? 0;
    this.transport.seek(this.time);
    this.seekTarget = this.time;
    this.remaining = 0;
    this.start(0);
    return this.snapshot;
  }

  select(index: number): PracticeRuntimeSnapshot {
    if (index < 0 || index >= this.plan.units.length) return this.snapshot;
    this.pause('section changed');
    this.abandonAttempt('section changed');
    this.range = null;
    this.unitIndex = index;
    this.run = 0;
    this.completed = 0;
    this.time = this.unit.start;
    this.transport.seek(this.time);
    this.seekTarget = this.time;
    this.intent = 'selected';
    this.phase = 'paused';
    this.setStatus('paused');
    return this.snapshot;
  }

  seek(time: number): PracticeRuntimeSnapshot {
    if (!Number.isFinite(time)) return this.snapshot;
    this.pause('position changed');
    this.abandonAttempt('position changed');
    const next = this.range
      ? clamp(time, this.range.start, this.range.end)
      : clamp(time, 0, this.plan.duration);
    if (!this.range) {
      const index = practiceUnitAt(this.plan, next);
      if (index >= 0) this.unitIndex = index;
    }
    this.time = next;
    this.transport.seek(next);
    this.seekTarget = next;
    this.intent = 'position';
    this.phase = 'paused';
    this.setStatus('paused');
    return this.snapshot;
  }

  next(): PracticeRuntimeSnapshot {
    if (this.calibrating) return this.snapshot;
    if (this.range) { this.range = null; }
    const next = this.unitIndex + 1;
    if (next >= this.plan.units.length) {
      this.pause('lesson completed');
      this.transport.seek(this.plan.duration);
      this.time = this.plan.duration;
      this.unitIndex = this.plan.units.length - 1;
      this.setStatus('lesson-complete');
      return this.snapshot;
    }
    this.pause('navigation');
    this.unitIndex = next;
    this.run = 0;
    this.completed = 0;
    this.time = this.unit.start;
    this.transport.seek(this.time);
    this.seekTarget = this.time;
    this.start(0);
    return this.snapshot;
  }

  previous(): PracticeRuntimeSnapshot {
    if (this.calibrating) return this.snapshot;
    this.pause('navigation');
    this.unitIndex = Math.max(0, this.unitIndex - 1);
    this.run = 0;
    this.completed = 0;
    this.time = this.unit.start;
    this.transport.seek(this.time);
    this.seekTarget = this.time;
    this.start(0);
    return this.snapshot;
  }

  setMode(mode: PracticeMode): PracticeRuntimeSnapshot {
    if (this.mode === mode) return this.snapshot;
    // A mode change is one atomic interruption: cancel a countdown/rest or finish
    // an active attempt exactly once, then stop the transport and expose paused.
    this.pause('mode changed');
    this.playGeneration += 1;
    this.mode = mode;
    try { this.transport.setMode?.(mode); } catch { /* transport teardown */ }
    this.transport.pause();
    this.remaining = 0;
    this.restContinuation = null;
    this.phase = 'paused';
    this.setStatus('paused');
    this.pauseReason = 'mode changed';
    return this.snapshot;
  }

  setRate(rate: number): PracticeRuntimeSnapshot {
    if (!Number.isFinite(rate) || rate <= 0) return this.snapshot;
    this.rate = rate;
    this.transport.setRate(rate);
    return this.snapshot;
  }

  restore(position: {unitId?: string | null; time: number; planId?: string | null; revisionId?: string | null}): PracticeRuntimeSnapshot {
    const reconciled = reconcilePracticePlan(this.plan, position);
    if (reconciled.revisionMismatch) return this.snapshot;
    this.pause('restore', false);
    this.abandonAttempt('restore');
    this.unitIndex = reconciled.unitIndex;
    this.time = reconciled.time;
    this.transport.seek(this.time);
    this.seekTarget = this.time;
    this.phase = 'paused';
    this.intent = 'restored';
    this.hasBegun = true;
    this.pauseReason = 'restored';
    this.remaining = 0;
    this.setStatus('paused');
    return this.snapshot;
  }

  replacePlan(plan: PracticePlan): PracticeRuntimeSnapshot {
    const position = this.snapshot;
    this.pause('plan changed');
    this.abandonAttempt('plan changed');
    const reconciled = reconcilePracticePlan(plan, {unitId: position.unitId, time: position.time,
      planId: this.plan.id, revisionId: this.plan.revisionId});
    if (reconciled.revisionMismatch) return this.snapshot;
    this.plan = plan;
    this.unitIndex = reconciled.unitIndex;
    this.time = reconciled.time;
    this.range = null;
    this.transport.seek(this.time);
    this.seekTarget = this.time;
    this.intent = 'restored';
    this.phase = 'paused';
    this.setStatus('paused');
    return this.snapshot;
  }

  destroy() {
    if (this.destroyed) return;
    this.pause('exit');
    this.destroyed = true;
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = null;
    try { this.transport.destroy?.(); } catch { /* best effort */ }
  }
}

/** Display snapshot for a subject shell while its transport is not mounted yet. */
export function emptyPracticeSnapshot(plan: PracticePlan, error = ''): PracticeRuntimeSnapshot {
  const unit = plan.units[0];
  return {
    status: 'error', phase: 'paused', mode: 'sections', unitIndex: 0,
    unitId: unit?.id ?? '', unitLabel: unit?.label ?? '', time: unit?.start ?? 0,
    duration: plan.duration, remaining: 0, restRemaining: 0, playing: false,
    ready: false, buffering: false, ended: false, error, rate: 1, loop: false,
    repetitions: 0, restSeconds: 0, countdownSeconds: 0, run: 0, completed: 0,
    countdownSound: false, range: null, intent: 'initial', pauseReason: '',
    attempt: null, hasProgress: false, atUnitEnd: false, sectionComplete: false,
    lessonComplete: false, canNext: plan.units.length > 1,
  };
}

/** Compatibility alias for callers that used a tick-based session. */
export const advancePracticeRuntime = (runtime: PracticeRuntime, delta: number) => runtime.tick(delta);
