/** Approximate dynamic response for the reviewed-note audition.
 *
 * Basic Pitch velocity is an estimated note amplitude, not key pressure or calibrated
 * MIDI velocity. These curves preserve relative dynamics, add brightness with intensity,
 * and keep a fixed ceiling so a dense chord cannot clip the output.
 */
export const DEFAULT_VELOCITY = 0.5;

export function velocityValue(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return DEFAULT_VELOCITY;
  return Math.min(1, Math.max(0, value));
}

export function intensityPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/** Per-note gain before the shared compressor/master stage. */
export function velocityGain(value: number | null | undefined): number {
  const velocity = velocityValue(value);
  return 0.035 + 0.33 * Math.pow(velocity, 1.65);
}

/** Low-pass cutoff (Hz): louder notes are brighter, not merely louder. */
export function velocityCutoff(value: number | null | undefined): number {
  const velocity = velocityValue(value);
  return 650 + 5100 * Math.pow(velocity, 1.5);
}

/** Fundamental-aware cutoff: soft treble notes must never be muffled below f0. */
export function pitchVelocityCutoff(pitch: number, velocity: number | null | undefined): number {
  const value = velocityValue(velocity);
  const midi = Number.isFinite(pitch) ? Math.max(0, Math.min(127, Math.round(pitch))) : 60;
  const fundamental = 440 * Math.pow(2, (midi - 69) / 12);
  const brightness = 0.35 + 0.65 * Math.pow(value, 1.2);
  return Math.min(18000, Math.max(velocityCutoff(value), fundamental * (1.7 + 2.8 * brightness)));
}

/** Harmonic amplitudes for a piano-like additive wave. */
export function velocityPartials(value: number | null | undefined): number[] {
  const velocity = velocityValue(value);
  return [1, 0.48 + 0.28 * velocity, 0.08 + 0.30 * velocity,
          0.025 + 0.18 * velocity, 0.01 + 0.10 * velocity];
}

/**
 * Register-aware grand-piano partials. Bass gets more warm overtones, midrange stays
 * balanced, and treble keeps a strong fundamental to avoid harsh digital buzz.
 */
export function grandPianoPartials(pitch: number, velocity: number | null | undefined): number[] {
  const value = velocityValue(velocity);
  const midi = Number.isFinite(pitch) ? Math.max(0, Math.min(127, Math.round(pitch))) : 60;
  if (midi < 48) {
    return [1, 0.58 + 0.22 * value, 0.42 + 0.20 * value, 0.30 + 0.17 * value,
            0.22 + 0.14 * value, 0.16 + 0.11 * value, 0.12 + 0.08 * value,
            0.085 + 0.06 * value, 0.06 + 0.045 * value];
  }
  if (midi > 76) {
    return [1, 0.30 + 0.24 * value, 0.075 + 0.16 * value, 0.025 + 0.09 * value];
  }
  return [1, 0.42 + 0.26 * value, 0.14 + 0.22 * value, 0.06 + 0.14 * value,
          0.028 + 0.08 * value, 0.012 + 0.04 * value];
}

/** How long the initial tone rings before the release envelope takes over. */
export function velocityDecay(value: number | null | undefined): number {
  const velocity = velocityValue(value);
  return 0.55 - 0.25 * velocity;
}

/** Master gain ceiling plus a limiter keeps dense chords below clipping. */
export const MASTER_GAIN = 0.32;
