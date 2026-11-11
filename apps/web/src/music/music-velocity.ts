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

/** Harmonic amplitudes for a piano-like additive wave. */
export function velocityPartials(value: number | null | undefined): number[] {
  const velocity = velocityValue(value);
  return [1, 0.48 + 0.28 * velocity, 0.08 + 0.30 * velocity,
          0.025 + 0.18 * velocity, 0.01 + 0.10 * velocity];
}

/** How long the initial tone rings before the release envelope takes over. */
export function velocityDecay(value: number | null | undefined): number {
  const velocity = velocityValue(value);
  return 0.55 - 0.25 * velocity;
}

/** Master gain ceiling plus a limiter keeps dense chords below clipping. */
export const MASTER_GAIN = 0.32;
