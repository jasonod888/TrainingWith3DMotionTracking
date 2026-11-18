/**
 * Pure gesture arithmetic shared by the roll, the score strip and their tests.
 *
 * A gesture locks to its first dominant axis after a small threshold, never mixes pitch
 * and time, and reports exact recorded values unless an explicit snap is enabled.
 */
import {keyAlter, parseSpelling, spellPitch} from '../../../../../packages/music-notation/index.ts';

export const DRAG_THRESHOLD = 5;
export const MIN_RECORDED_SECONDS = 0.02;

export type GestureAxis = 'pitch' | 'time' | 'resize';

export function resolveAxis(dx: number, dy: number, threshold = DRAG_THRESHOLD, forced: GestureAxis | null = null): GestureAxis | null {
  if (forced) return forced;
  if (Math.hypot(dx, dy) < threshold) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'time' : 'pitch';
}

export function snapSecondsValue(value: number, snap: number | null): number {
  if (!snap || snap <= 0) return value;
  return Math.round(value / snap) * snap;
}

export function pitchFromDrag(startPitch: number, dy: number, rowHeight: number): number {
  if (rowHeight <= 0) return startPitch;
  return Math.max(0, Math.min(127, startPitch - Math.round(dy / rowHeight)));
}

export function onsetFromDrag(startOnset: number, dx: number, pxPerSecond: number, snap: number | null, duration: number): number {
  const delta = pxPerSecond > 0 ? dx / pxPerSecond : 0;
  const value = snapSecondsValue(startOnset + delta, snap);
  return Math.max(0, Math.min(duration, Math.round(value * 1e6) / 1e6));
}

export function durationFromDrag(startDuration: number, dx: number, pxPerSecond: number, snap: number | null): number {
  const delta = pxPerSecond > 0 ? dx / pxPerSecond : 0;
  const value = snapSecondsValue(startDuration + delta, snap);
  return Math.max(MIN_RECORDED_SECONDS, Math.round(value * 1e6) / 1e6);
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONES: Record<string, number> = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};

/** Moves a written note by diatonic steps while respecting the key signature. */
export function diatonicStep(spelling: string, steps: number, key: string): {pitch: number; spelling: string} {
  const parsed = parseSpelling(spelling);
  const index = LETTERS.indexOf(parsed.letter) + parsed.octave * 7 + steps;
  const octave = Math.floor(index / 7);
  const letter = LETTERS[((index % 7) + 7) % 7];
  const alter = keyAlter(letter, key);
  const pitch = Math.max(0, Math.min(127, (octave + 1) * 12 + SEMITONES[letter] + alter));
  return {pitch, spelling: spellPitch(pitch, key).spelling};
}

export function pitchNameFor(pitch: number, key: string): string {
  return spellPitch(pitch, key).spelling;
}

export type GestureEdit =
  | { kind: 'pitch'; occurrenceId: string; pitch: number; spelling?: string }
  | { kind: 'time'; occurrenceId: string; seconds: number }
  | { kind: 'resize'; occurrenceId: string; durationSeconds: number }
  /** Guitar 6-string roll: a vertical drag commits a playable string/fret position. */
  | { kind: 'position'; occurrenceId: string; string: number; fret: number };
