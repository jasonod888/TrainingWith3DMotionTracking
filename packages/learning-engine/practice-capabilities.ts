/**
 * Capability and availability model shared by body and music practice.
 *
 * "Unsupported" features are hidden. Supported-but-currently-unavailable
 * features stay visible with a reason, so off (the learner chose off) and
 * unavailable (this device, lesson or state cannot provide it) never collapse.
 */
export type CapabilitySupport = 'supported' | 'unsupported';

export type ControlState = {
  supported: boolean;
  /** The feature can be used in this state. */
  enabled: boolean;
  /** The learner turned it off (distinct from unavailable). */
  off?: boolean;
  reason?: string;
  status?: string;
};

export type CountInOption = {
  seconds: number;
  label: string;
  /** Tempo conversion used to produce the seconds, when the subject counts beats. */
  beats?: number;
  bpm?: number;
};

export type PracticeCapabilities = {
  challenge: CapabilitySupport;
  camera: CapabilitySupport;
  recording: CapabilitySupport;
  scoring: CapabilitySupport;
  /** Voice lifecycle availability; provider details live in the voice layer. */
  voice: ControlState;
  /** Where restored position/preferences can live for this lesson. */
  progress: 'server' | 'local' | 'none';
  history: CapabilitySupport;
  seek: CapabilitySupport;
  sections: CapabilitySupport;
  repeat: CapabilitySupport;
  restartLesson: CapabilitySupport;
  progression: ('sections' | 'continuous')[];
  speeds: number[];
  countIn: {supported: boolean; options: CountInOption[]; value: number};
  rest: {supported: boolean; options: number[]; value: number};
  repetitions: {supported: boolean; options: number[]; value: number};
  /** Subject wording for a unit; body uses "section", piano "section", guitar "section". */
  unitNoun: string;
  /** Optional start wording for a subject that must prepare a source first. */
  startLabel?: string;
  /** Body uses camera-conditioned primary labels without changing the command. */
  cameraRequired?: boolean;
};

export const control = (input: Partial<ControlState> & {supported?: boolean} = {}): ControlState => ({
  supported: input.supported !== false,
  enabled: input.enabled !== false && input.supported !== false && !input.reason,
  ...(input.off ? {off: true} : {}),
  ...(input.reason ? {reason: input.reason} : {}),
  ...(input.status ? {status: input.status} : {}),
});

export const supported = (): CapabilitySupport => 'supported';
export const unsupported = (): CapabilitySupport => 'unsupported';

export const BODY_CAPABILITIES: PracticeCapabilities = {
  challenge: 'supported',
  camera: 'supported',
  recording: 'supported',
  scoring: 'supported',
  voice: control({supported: true, enabled: false, off: true, status: 'Off'}),
  progress: 'server',
  history: 'supported',
  seek: 'supported',
  sections: 'supported',
  repeat: 'supported',
  restartLesson: 'supported',
  progression: ['sections', 'continuous'],
  speeds: [0.25, 0.5, 0.75, 1],
  countIn: {supported: true, value: 3, options: [0, 3, 5, 10].map(seconds => ({seconds, label: seconds ? `${seconds}s` : 'Off'}))},
  rest: {supported: true, value: 2, options: [0, 2, 5, 10]},
  repetitions: {supported: true, value: 0, options: [0, 2, 3, 5, 10]},
  unitNoun: 'section',
  cameraRequired: true,
};

export const MUSIC_CAPABILITIES: PracticeCapabilities = {
  challenge: 'unsupported',
  camera: 'unsupported',
  recording: 'unsupported',
  scoring: 'unsupported',
  voice: control({supported: true, enabled: false, off: true, status: 'Off'}),
  progress: 'local',
  history: 'unsupported',
  seek: 'supported',
  sections: 'supported',
  repeat: 'supported',
  restartLesson: 'supported',
  progression: ['sections'],
  speeds: [0.25, 0.5, 0.75, 1],
  countIn: {supported: true, value: 0, options: [0, 3, 5, 10].map(seconds => ({seconds, label: seconds ? `${seconds}s` : 'Off'}))},
  rest: {supported: true, value: 1.5, options: [0, 1.5, 3, 5]},
  repetitions: {supported: true, value: 0, options: [0, 2, 3, 5, 10]},
  unitNoun: 'section',
};

/** Converts explicit beat counts at a subject tempo into scheduler seconds. */
export function countInFromBeats(beats: number, bpm: number): number {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  return Math.max(0, beats) * 60 / safeBpm;
}

export function countInOptionsFromBeats(beats: readonly number[], bpm: number): CountInOption[] {
  const seen = new Set<number>();
  return beats.filter(value => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  }).map(value => ({
    seconds: countInFromBeats(value, bpm),
    beats: value,
    bpm,
    label: value ? `${value} beat${value === 1 ? '' : 's'}` : 'Off',
  }));
}

/** A voice control is only "on" after recognition observes `started`. */
export function voiceControl(status: string, error = '', supported = true): ControlState {
  if (!supported) return control({supported: false, enabled: false, reason: 'Voice recognition is unavailable in this browser.'});
  if (error) return control({supported: true, enabled: false, reason: error, status: 'Unavailable'});
  if (status === 'listening') return control({supported: true, enabled: true, status: 'On'});
  if (status === 'starting' || status === 'reconnecting') return control({supported: true, enabled: false, status: status === 'reconnecting' ? 'Reconnecting' : 'Starting'});
  return control({supported: true, enabled: true, off: true, status: 'Off'});
}
