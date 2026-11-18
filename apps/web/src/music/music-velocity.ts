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
  return 0.03 + 0.59 * Math.pow(velocityValue(value), 1.85);
}

/** Slightly taper the highest register so melody notes do not dominate the mix. */
export function pitchRegisterGain(pitch: number): number {
  if (!Number.isFinite(pitch)) return 1;
  const midi = Math.max(0, Math.min(127, pitch));
  if (midi <= 64) return 1;
  const t = Math.max(0, Math.min(1, (midi - 64) / 24));
  return 1 - 0.42 * t;
}

/** Low-pass cutoff (Hz): louder notes are brighter, not merely louder. */
export function velocityCutoff(value: number | null | undefined): number {
  const velocity = velocityValue(value);
  return 650 + 5100 * Math.pow(velocity, 1.5);
}

/** Fundamental-aware cutoff: tames upper-treble brightness without muffling f0. */
export function pitchVelocityCutoff(pitch: number, velocity: number | null | undefined): number {
  const v = velocityValue(velocity);
  const midi = Number.isFinite(pitch) ? pitch : 60;
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  return Math.max(400, f0 * 1.4, midi < 48 ? velocityCutoff(v) : 0,
    Math.min(7200, f0 * (1.6 + 3.4 * Math.pow(v, 1.15)) + 140 + 520 * v));
}

/** Harmonic amplitudes for a piano-like additive wave. */
export function velocityPartials(value: number | null | undefined): number[] {
  const velocity = velocityValue(value);
  return [1, 0.48 + 0.28 * velocity, 0.08 + 0.30 * velocity,
          0.025 + 0.18 * velocity, 0.01 + 0.10 * velocity];
}

/**
 * Register-aware grand-piano partials. Bass gets more warm overtones, midrange stays
 * balanced, and treble keeps a strong fundamental. Profiles are interpolated between
 * register anchors so adjacent notes do not jump in timbre.
 */
export function grandPianoPartials(pitch: number, velocity: number | null | undefined): number[] {
  const value = velocityValue(velocity);
  const midi = Number.isFinite(pitch) ? Math.max(0, Math.min(127, Math.round(pitch))) : 60;
  const bass = [1, 0.58 + 0.22 * value, 0.42 + 0.20 * value, 0.30 + 0.17 * value,
    0.22 + 0.14 * value, 0.16 + 0.11 * value, 0.12 + 0.08 * value,
    0.085 + 0.06 * value, 0.06 + 0.045 * value];
  const mid = [1, 0.42 + 0.26 * value, 0.14 + 0.22 * value, 0.06 + 0.14 * value,
    0.028 + 0.08 * value, 0.012 + 0.04 * value];
  const treble = [1, 0.30 + 0.24 * value, 0.075 + 0.16 * value, 0.025 + 0.09 * value];
  const blend = (left: number[], right: number[], fraction: number) => {
    const length = Math.max(left.length, right.length);
    const partials: number[] = [];
    for (let index = 0; index < length; index += 1) {
      const a = left[index] ?? 0;
      const b = right[index] ?? 0;
      partials.push(a + (b - a) * fraction);
    }
    while (partials.length > 1 && Math.abs(partials[partials.length - 1]) < 1e-12) partials.pop();
    return partials;
  };
  if (midi <= 36) return bass;
  if (midi < 60) return blend(bass, mid, (midi - 36) / 24);
  if (midi <= 60) return mid;
  if (midi < 84) return blend(mid, treble, (midi - 60) / 24);
  return treble;
}

/** How long the initial tone rings before the release envelope takes over. */
export function velocityDecay(value: number | null | undefined): number {
  const velocity = velocityValue(value);
  return 0.55 - 0.25 * velocity;
}

/** Master gain ceiling plus a limiter keeps dense chords below clipping. */
export const MASTER_GAIN = 0.32;
