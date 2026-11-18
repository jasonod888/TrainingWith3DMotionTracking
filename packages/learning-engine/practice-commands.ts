/** Normalized commands dispatched by buttons, keyboard, voice and remote control. */
export type PracticeActionId =
  | 'start'
  | 'play'
  | 'resume'
  | 'pause'
  | 'toggle'
  | 'next'
  | 'previous'
  | 'repeat-section'
  | 'restart-lesson';

export type PracticeCommand =
  | {type: 'action'; action: PracticeActionId; countdownSeconds?: number}
  | {type: 'select'; index: number}
  | {type: 'seek'; time: number}
  | {type: 'set-mode'; mode: 'sections' | 'continuous'}
  | {type: 'set-rate'; rate: number}
  | {type: 'set-loop'; loop: boolean}
  | {type: 'set-repetitions'; repetitions: number}
  | {type: 'set-countdown'; seconds: number}
  | {type: 'set-rest'; seconds: number}
  | {type: 'restore'; unitId?: string | null; time: number; planId?: string | null; revisionId?: string | null}
  | {type: 'tick'; delta: number}
  | {type: 'destroy'};

/** Remote and voice channels use the same action names as the buttons. */
export const COMMAND_LABELS: Record<PracticeActionId, string> = {
  start: 'Start practice',
  play: 'Play',
  resume: 'Resume',
  pause: 'Pause',
  toggle: 'Play or pause',
  next: 'Next section',
  previous: 'Previous section',
  'repeat-section': 'Repeat section',
  'restart-lesson': 'Start over',
};
