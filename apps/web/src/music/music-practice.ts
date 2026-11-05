/** Pure timed-practice controller for reviewed music lessons. No scoring or persistence. */
export const PRACTICE_SPEEDS = [0.5, 0.75, 1, 1.25] as const;
export type PracticeSpeed = (typeof PRACTICE_SPEEDS)[number];
export const BEAT_SECONDS = 0.5;
export const REST_SECONDS = 1.5;

export type PracticeOptions = {
  sectionId: string;
  start: number;
  end: number;
  repeats: number;
  countInBeats: number;
  speed: PracticeSpeed;
};
export type PracticePhase = 'count-in' | 'playing' | 'rest' | 'done';
export type PracticeState = {phase: PracticePhase; run: number; elapsed: number; beat: number};

export function startPractice(options: PracticeOptions): PracticeState {
  return options.countInBeats > 0
    ? {phase: 'count-in', run: 0, elapsed: 0, beat: options.countInBeats}
    : {phase: 'playing', run: 0, elapsed: 0, beat: 0};
}

/** Advance wall-clock seconds; playing progress is scaled by the speed preset. */
export function advancePractice(state: PracticeState, seconds: number, options: PracticeOptions): PracticeState {
  if (state.phase === 'done') return state;
  const elapsed = state.elapsed + Math.max(0, seconds);
  if (state.phase === 'count-in') {
    const total = options.countInBeats * BEAT_SECONDS;
    if (elapsed >= total) return {phase: 'playing', run: 0, elapsed: 0, beat: 0};
    return {...state, elapsed, beat: Math.max(1, Math.ceil((total - elapsed) / BEAT_SECONDS))};
  }
  if (state.phase === 'playing') {
    const duration = Math.max(0.05, options.end - options.start);
    if (elapsed * options.speed < duration) return {...state, elapsed};
    return state.run + 1 >= Math.max(1, options.repeats)
      ? {phase: 'done', run: state.run, elapsed: 0, beat: 0}
      : {phase: 'rest', run: state.run, elapsed: 0, beat: 0};
  }
  if (elapsed >= REST_SECONDS) return {phase: 'playing', run: state.run + 1, elapsed: 0, beat: 0};
  return {...state, elapsed};
}

/** Absolute reviewed time for the current moment; count-in and rest hold at the section start. */
export function practiceSourceTime(state: PracticeState, options: PracticeOptions): number {
  if (state.phase !== 'playing') return options.start;
  const duration = Math.max(0.05, options.end - options.start);
  return options.start + Math.min(duration, state.elapsed * options.speed);
}

export function practiceProgress(state: PracticeState, options: PracticeOptions): number {
  const duration = Math.max(0.05, options.end - options.start);
  return Math.min(1, Math.max(0, (practiceSourceTime(state, options) - options.start) / duration));
}

export function practiceLabel(state: PracticeState, options: PracticeOptions): string {
  if (state.phase === 'count-in') return `Count-in ${state.beat}`;
  if (state.phase === 'playing') return `Run ${state.run + 1} of ${Math.max(1, options.repeats)}`;
  if (state.phase === 'rest') return `Rest · next run in ${Math.max(1, Math.ceil(REST_SECONDS - state.elapsed))}`;
  return 'Practice complete';
}
