/**
 * The only transport surface the practice runtime knows about.
 *
 * Exactly one transport owns the advancing source position for a running
 * session. A transport either advances internally (body `Playback`) or is
 * observed from a media element (piano/guitar); the runtime never creates a
 * second clock. `advance` exists only for the internal-transport case.
 */
export type PracticeTransportSnapshot = {
  time: number;
  duration: number;
  playing: boolean;
  ready: boolean;
  /** A source stall, not a learner pause and not a completed attempt. */
  buffering: boolean;
  ended: boolean;
  rate: number;
  error: string;
  mode?: 'sections' | 'continuous';
  calibrating?: boolean;
};

export type PracticeTransport = {
  snapshot(): PracticeTransportSnapshot;
  play(): Promise<void> | void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  /** Optional for media transports; body Playback exposes section/continuous mode. */
  setMode?(mode: 'sections' | 'continuous'): void;
  subscribe(listener: () => void): () => void;
  /** Present only when this transport owns an internal advancing clock. */
  advance?(deltaSeconds: number): void;
  destroy?(): void;
};

export const emptyTransportSnapshot = (duration = 0): PracticeTransportSnapshot => ({
  time: 0, duration, playing: false, ready: false, buffering: false,
  ended: false, rate: 1, error: '',
});
