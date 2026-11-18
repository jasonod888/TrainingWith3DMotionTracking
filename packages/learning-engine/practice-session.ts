import type {Playback} from './playback';
import {createPlaybackTransport} from './playback-transport';
import type {PracticeRuntimeSnapshot} from './practice-runtime';
import {PracticeRuntime, type Attempt} from './practice-runtime';
import {definePracticePlan, type PracticePlan} from './practice-plan';

export type PracticeAction = 'next' | 'back' | 'again' | 'pause' | 'play' | 'resume' | 'slower' | 'faster' | 'loop' | 'restart-lesson';
export type {Attempt};

const SPEEDS = [.25, .5, .75, 1];

/**
 * Compatibility facade over `PracticeRuntime` for the body controller and the
 * existing engine/competition tests. It owns no rules of its own: every field
 * and command forwards to the one runtime authority.
 */
export class PracticeSession {
  readonly player: Playback;
  readonly runtime: PracticeRuntime;
  private startCallback: ((time: number) => void) | null = null;

  constructor(player: Playback, plan?: PracticePlan) {
    this.player = player;
    const initialTime = player.state.time;
    const initialIndex = player.state.index;
    const resolved = plan ?? definePracticePlan({
      lessonId: 'compatibility',
      revisionId: `sections-${player.duration}`,
      duration: player.duration,
      units: player.sections.map(section => ({id: section.id, label: section.label, start: section.start, end: section.end})),
    });
    this.runtime = new PracticeRuntime({
      plan: resolved,
      transport: createPlaybackTransport(player),
      mode: player.state.mode,
      countdownSeconds: 3,
      restSeconds: 2,
    });
    this.runtime.onAttemptStart = (time) => this.startCallback?.(time);
    // The body may mount already seeked to a chosen section (LibraryApp session
    // navigation). Align the runtime unit before the route restores a saved time.
    if (initialIndex >= 0 && player.sections[initialIndex]) {
      this.runtime.select(initialIndex);
      if (initialTime > player.sections[initialIndex].start) {
        this.runtime.restore({time: initialTime});
      }
    }
  }

  get phase(): 'paused' | 'countdown' | 'playing' | 'rest' {
    if (this.runtime.status === 'countdown') return 'countdown';
    if (this.runtime.status === 'playing' || this.runtime.status === 'buffering') return 'playing';
    if (this.runtime.status === 'resting') return 'rest';
    return 'paused';
  }

  get status() { return this.runtime.status; }
  get remaining() { return this.runtime.remaining; }
  get restRemaining() { return this.runtime.restRemaining; }
  get countdownSeconds() { return this.runtime.countdownSeconds; }
  set countdownSeconds(value: number) { this.runtime.countdownSeconds = Math.max(0, value); }
  get loop() { return this.runtime.loop; }
  set loop(value: boolean) { this.runtime.loop = value; }
  get repetitions() { return this.runtime.repetitions; }
  set repetitions(value: number) { this.runtime.repetitions = Math.max(0, Math.floor(value)); }
  get restSeconds() { return this.runtime.restSeconds; }
  set restSeconds(value: number) { this.runtime.restSeconds = Math.max(0, value); }
  get completed() { return this.runtime.completed; }
  set completed(value: number) { this.runtime.completed = Math.max(0, value); }
  get range() { return this.runtime.range; }
  set range(value: {start: number; end: number} | null) { this.runtime.range = value ? {...value} : null; }
  get bounds() { return this.runtime.bounds; }
  get intent() { return this.runtime.intent; }
  get snapshot(): PracticeRuntimeSnapshot { return this.runtime.snapshot; }
  get onAttempt() { return this.runtime.onAttempt; }
  set onAttempt(value: ((attempt: Attempt) => void) | undefined) { this.runtime.onAttempt = value; }
  get onPause() { return this.runtime.onPause; }
  set onPause(value: ((reason: string) => void) | undefined) { this.runtime.onPause = value; }
  get onAttemptStart(): ((time: number) => void) | undefined { return this.startCallback ?? undefined; }
  set onAttemptStart(value: ((time: number) => void) | undefined) {
    this.startCallback = value ?? null;
    this.runtime.onAttemptStart = (time) => this.startCallback?.(time);
  }

  pause(reason = 'paused') { this.runtime.pause(reason); }

  setRange(start: number, end: number) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > this.player.duration || end - start < .05) {
      throw new Error('Choose a range inside this lesson, at least 0.05 seconds long.');
    }
    this.runtime.pause('range changed');
    this.runtime.range = {start, end};
    this.runtime.setMode('continuous');
    this.player.seek(start);
    this.runtime.completed = 0;
  }

  seek(time: number) { this.runtime.seek(time); }

  select(index: number) {
    if (!this.player.sections[index]) return;
    this.runtime.setMode('sections');
    this.runtime.select(index);
    this.runtime.completed = 0;
  }

  start(secondsOverride?: number) { this.runtime.start(secondsOverride); }

  action(action: PracticeAction) {
    if (action === 'restart-lesson') { this.runtime.restartLesson(); return; }
    if (action === 'pause') { this.runtime.pause('paused'); return; }
    if (action === 'slower' || action === 'faster') {
      const index = SPEEDS.indexOf(this.player.state.speed);
      const next = SPEEDS[Math.max(0, Math.min(3, index + (action === 'slower' ? -1 : 1)))];
      this.runtime.setRate(next);
      return;
    }
    if (action === 'loop') { this.runtime.loop = !this.runtime.loop; return; }
    if (action === 'play') {
      if (this.phase === 'playing' || this.phase === 'countdown' || this.phase === 'rest') { this.runtime.pause('user'); return; }
      this.runtime.completed = 0;
      this.runtime.start();
      return;
    }
    if (action === 'resume') {
      if (this.phase !== 'paused') return;
      this.runtime.resume();
      return;
    }
    if (this.phase === 'paused') this.runtime.completed = 0;
    if (action === 'next') { this.runtime.next(); return; }
    if (action === 'back') { this.runtime.previous(); return; }
    this.runtime.repeatSection();
  }

  tick(delta: number) { this.runtime.tick(delta); }

  destroy() { this.runtime.destroy(); }
}
