/** Musical duration arithmetic. Ticks are fixed at 480 per quarter note. */
import { GRID, PPQ, type NotationValue, type TimeSignature } from './types';

export type ValueSpec = {
  value: NotationValue;
  ticks: number;
  dotted: boolean;
};

/** Values we can engrave without tuplets. Dotted values are used to avoid unnecessary ties. */
export const VALUE_SPECS: ValueSpec[] = [
  { value: 'whole', ticks: 1920, dotted: false },
  { value: 'half', ticks: 1440, dotted: true },
  { value: 'half', ticks: 960, dotted: false },
  { value: 'quarter', ticks: 720, dotted: true },
  { value: 'quarter', ticks: 480, dotted: false },
  { value: 'eighth', ticks: 360, dotted: true },
  { value: 'eighth', ticks: 240, dotted: false },
  { value: 'sixteenth', ticks: 180, dotted: true },
  { value: 'sixteenth', ticks: 120, dotted: false },
  { value: 'thirtysecond', ticks: 90, dotted: true },
  { value: 'thirtysecond', ticks: 60, dotted: false },
  { value: 'sixtyfourth', ticks: 30, dotted: false },
];

const BY_TICKS = new Map<number, ValueSpec>(VALUE_SPECS.map(spec => [spec.ticks, spec]));
const DECOMPOSE_TICKS = [1920, 1440, 960, 720, 480, 360, 240, 180, 120];

export function valueForTicks(ticks: number): ValueSpec {
  const exact = BY_TICKS.get(ticks);
  if (exact) return exact;
  // The fallback is only for imported documents outside the editor grid.
  if (ticks >= 1920) return VALUE_SPECS[0];
  if (ticks >= 960) return VALUE_SPECS[2];
  if (ticks >= 480) return VALUE_SPECS[4];
  if (ticks >= 240) return VALUE_SPECS[6];
  if (ticks >= 120) return VALUE_SPECS[8];
  if (ticks >= 60) return VALUE_SPECS[10];
  return VALUE_SPECS[11];
}

export function durationName(spec: ValueSpec): string {
  return spec.dotted ? `dotted ${spec.value}` : spec.value;
}

/** Greedy decomposition into engraveable values; every result is tied to the next. */
export function decomposeTicks(ticks: number): ValueSpec[] {
  if (!Number.isInteger(ticks) || ticks <= 0) throw new Error('A duration must be a positive whole number of ticks.');
  const result: ValueSpec[] = [];
  let remaining = ticks;
  for (const candidate of DECOMPOSE_TICKS) {
    while (remaining >= candidate) {
      result.push(valueForTicks(candidate));
      remaining -= candidate;
    }
  }
  if (remaining > 0) {
    // Sub-grid durations are rounded up to the smallest editable value rather than dropped.
    result.push(valueForTicks(GRID));
  }
  return result;
}

export function measureTicks(time: TimeSignature): number {
  if (!Number.isInteger(time.numerator) || time.numerator < 1 || time.numerator > 32) {
    throw new Error('The time-signature numerator is out of range.');
  }
  if (![1, 2, 4, 8, 16].includes(time.denominator)) throw new Error('The time-signature denominator is unsupported.');
  return Math.round(PPQ * 4 * time.numerator / time.denominator);
}

export function measureCount(durationSeconds: number, bpm: number, time: TimeSignature): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('The lesson has no duration.');
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('The tempo must be positive.');
  const secondsPerTick = 60 / (bpm * PPQ);
  const ticks = durationSeconds / secondsPerTick;
  return Math.max(1, Math.ceil(ticks / measureTicks(time) - 1e-9));
}

export type SpanSlice = { start: number; duration: number; measure_index: number };

/** Split a global span at measure boundaries. */
export function splitAtMeasures(start: number, duration: number, measures: { start: number; duration: number; index: number }[]): SpanSlice[] {
  if (duration <= 0) return [];
  const slices: SpanSlice[] = [];
  let cursor = start;
  const end = start + duration;
  for (const measure of measures) {
    const measureEnd = measure.start + measure.duration;
    if (cursor >= end) break;
    if (cursor < measure.start || cursor >= measureEnd) continue;
    const sliceEnd = Math.min(end, measureEnd);
    slices.push({ start: cursor, duration: sliceEnd - cursor, measure_index: measure.index });
    cursor = sliceEnd;
  }
  // A span beyond the final measure is retained; the editor never silently drops it.
  if (cursor < end) {
    slices.push({ start: cursor, duration: end - cursor, measure_index: Math.max(0, measures.length - 1) });
  }
  return slices;
}

/** The beat position within a measure, in ticks. */
export function localTick(start: number, measure: { start: number }): number {
  return Math.max(0, start - measure.start);
}

/** Snap a tick to the editor grid, never below zero. */
export function snapTick(ticks: number, grid = GRID): number {
  if (!Number.isFinite(ticks)) throw new Error('Invalid tick position.');
  return Math.max(0, Math.round(ticks / grid) * grid);
}

/** Human-readable duration for buttons and the inspector. */
export const DURATION_BUTTONS: { value: NotationValue; label: string; ticks: number; dotted?: boolean }[] = [
  { value: 'whole', label: 'Whole', ticks: 1920 },
  { value: 'half', label: 'Half', ticks: 960 },
  { value: 'half', label: 'Dotted half', ticks: 1440, dotted: true },
  { value: 'quarter', label: 'Quarter', ticks: 480 },
  { value: 'quarter', label: 'Dotted quarter', ticks: 720, dotted: true },
  { value: 'eighth', label: 'Eighth', ticks: 240 },
  { value: 'sixteenth', label: '16th', ticks: 120 },
];
