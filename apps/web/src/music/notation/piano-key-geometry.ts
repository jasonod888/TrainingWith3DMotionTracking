/**
 * Shared piano key/range geometry.
 *
 * This module is intentionally pure and has no DOM or notation dependencies. The
 * keyboard and the (future) waterfall consume the same lanes so a pitch always maps to
 * one x/width interval, including black-key placement.
 */
export type PianoRange = {
  firstPitch: number;
  semitones: number;
};

export type PianoKey = {
  pitch: number;
  black: boolean;
  x: number;
  width: number;
  center: number;
};

export type PianoGeometry = {
  width: number;
  height: number;
  padding: number;
  whiteWidth: number;
  blackWidth: number;
  whites: PianoKey[];
  blacks: PianoKey[];
  range: PianoRange;
};

export const PIANO_GEOMETRY_HEIGHT = 136;
export const STANDARD_PIANO_FIRST = 21;
export const STANDARD_PIANO_LAST = 108;
export const STANDARD_PIANO_SEMITONES = STANDARD_PIANO_LAST - STANDARD_PIANO_FIRST;
export const STANDARD_PIANO_RANGE: PianoRange = {
  firstPitch: STANDARD_PIANO_FIRST,
  semitones: STANDARD_PIANO_SEMITONES,
};
/** Available instrument width (~1024 viewport after shell/padding). */
export const FULL_PIANO_MIN_WIDTH = 960;
const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function isWhitePitch(pitch: number): boolean {
  return WHITE_PITCH_CLASSES.has(((pitch % 12) + 12) % 12);
}

/** Narrow visible window for the full A0–C8 instrument, without squeezing 88 keys. */
export function narrowSemitonesForWidth(width: number): number {
  if (!Number.isFinite(width) || width < 520) return 24;
  if (width < 760) return 36;
  return 48;
}

export function isStandardPianoRange(range: PianoRange): boolean {
  return range.firstPitch === STANDARD_PIANO_FIRST
    && range.firstPitch + range.semitones === STANDARD_PIANO_LAST;
}

export function clampStandardPianoWindow(firstPitch: number, semitones: number): PianoRange {
  const size = Math.max(11, Math.min(STANDARD_PIANO_SEMITONES, Math.round(semitones)));
  const first = Math.max(STANDARD_PIANO_FIRST,
    Math.min(STANDARD_PIANO_LAST - size, Math.round(firstPitch)));
  return {firstPitch: first, semitones: size};
}

/** Pan within A0–C8 only; endpoints are allowed even when not C-aligned. */
export function panStandardPianoRange(range: PianoRange, semitones: number): PianoRange {
  return clampStandardPianoWindow(range.firstPitch + Math.round(semitones), range.semitones);
}

export function isBlackPitch(pitch: number): boolean {
  return BLACK_PITCH_CLASSES.has(((pitch % 12) + 12) % 12);
}

/** Sensible visible range for available width, not a microscopic 88-key keyboard. */
export function semitonesForWidth(width: number): number {
  if (!Number.isFinite(width) || width < 520) return 24;
  if (width < 760) return 36;
  return 60;
}

export function shiftPianoRange(range: PianoRange, octaves: number): PianoRange {
  const firstPitch = Math.max(0, Math.min(127 - range.semitones,
    range.firstPitch + Math.round(octaves) * 12));
  return {...range, firstPitch};
}

/**
 * Practical initial range from the lesson's pitches. The selected note is deliberately
 * not part of this calculation so ordinary selection/playback cannot jump the range.
 */
export function resolveKeyboardRange(
  pitches: number[],
  width: number,
  octaveShift = 0,
  semitones = semitonesForWidth(width),
): PianoRange {
  const safePitches = pitches.filter(pitch => Number.isFinite(pitch));
  const center = safePitches.length
    ? (Math.min(...safePitches) + Math.max(...safePitches)) / 2
    : 60;
  const rangeSize = Math.max(12, Math.min(127, Math.round(semitones)));
  const rawFirst = Math.floor((center - rangeSize / 2) / 12) * 12;
  const firstPitch = Math.max(0, Math.min(127 - rangeSize, rawFirst + octaveShift * 12));
  return {firstPitch, semitones: rangeSize};
}

/** Exact lane geometry shared by keys and guide notes. */
export function buildPianoGeometry(range: PianoRange, width: number, padding = 6): PianoGeometry {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const safePadding = Math.max(0, Math.min(safeWidth / 4, padding));
  const whites: PianoKey[] = [];
  for (let pitch = range.firstPitch; pitch <= Math.min(127, range.firstPitch + range.semitones); pitch += 1) {
    if (isWhitePitch(pitch)) whites.push({pitch, black: false, x: 0, width: 0, center: 0});
  }
  const whiteWidth = (safeWidth - safePadding * 2) / Math.max(1, whites.length);
  const blackWidth = Math.max(6, Math.min(18, whiteWidth * 0.62));
  whites.forEach((key, index) => {
    key.x = safePadding + index * whiteWidth;
    key.width = Math.max(1, whiteWidth - 1.5);
    key.center = key.x + whiteWidth / 2;
  });
  const blacks: PianoKey[] = [];
  for (let pitch = range.firstPitch; pitch < Math.min(127, range.firstPitch + range.semitones); pitch += 1) {
    if (!isBlackPitch(pitch)) continue;
    const lowerWhite = whites.filter(key => key.pitch < pitch).length - 1;
    if (lowerWhite < 0) continue;
    const x = safePadding + (lowerWhite + 1) * whiteWidth - blackWidth * 0.55;
    blacks.push({pitch, black: true, x, width: blackWidth, center: x + blackWidth / 2});
  }
  return {
    width: safeWidth,
    height: PIANO_GEOMETRY_HEIGHT,
    padding: safePadding,
    whiteWidth,
    blackWidth,
    whites,
    blacks: blacks.sort((a, b) => a.pitch - b.pitch),
    range,
  };
}
