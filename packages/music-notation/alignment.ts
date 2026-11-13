/**
 * Phase 4 alignment: the continuous map between recorded seconds and score ticks.
 *
 * Seconds in this module are **stored performance seconds**, the frame used by
 * `performance.onset` and by alignment passages. The playback offset is applied once
 * at the boundary (`effective = stored + offset`), never baked into a passage.
 *
 * A passage list can hold timed stretches (linear) and held stretches (the score
 * cursor waits while time advances, e.g. a spoken explanation). Anchors are authored
 * as points inside a timed stretch and split it; anchors that would reverse time or
 * score order are rejected.
 */
import {secondsPerTick} from './correction';
import type {NotationDocument} from './types';

export type TimedPassage = { kind: 'timed'; source_seconds: [number, number]; ticks: [number, number] };
export type HeldPassage = { kind: 'held'; source_seconds: [number, number]; tick: number };
export type AlignmentPassage = TimedPassage | HeldPassage;

export type Alignment = {
  alignment_version: 1;
  mode: 'estimated' | 'anchored';
  basis: 'tempo' | 'passages';
  passages: AlignmentPassage[];
};

export type PassageSpan = { start: number; end: number; kind: 'playing' | 'explanation' };

const EPSILON = 1e-9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** The estimated map: one linear stretch over the whole clip at the document tempo. */
export function estimatedAlignment(document: NotationDocument): Alignment {
  const secondsPerBeatTick = secondsPerTick(document);
  return {
    alignment_version: 1,
    mode: 'estimated',
    basis: 'tempo',
    passages: [{kind: 'timed', source_seconds: [0, document.duration], ticks: [0, Math.round(document.duration / secondsPerBeatTick)]}],
  };
}

/**
 * Build passages from the authored playing/explanation spans. Each playing span
 * advances the score by its own duration, so an explanation (or an uncovered gap)
 * holds the cursor and the next passage resumes from the same tick instead of
 * inventing beats or jumping ahead.
 */
export function alignmentFromSpans(document: NotationDocument, spans: PassageSpan[] | null | undefined): Alignment {
  if (!spans || !spans.length) return estimatedAlignment(document);
  const secondsPerBeatTick = secondsPerTick(document);
  const ordered = [...spans].sort((left, right) => left.start - right.start);
  const passages: AlignmentPassage[] = [];
  let cursor = 0;
  let heldTick = 0;

  const push = (passage: AlignmentPassage) => {
    if (passage.source_seconds[1] - passage.source_seconds[0] <= EPSILON) return;
    passages.push(passage);
    cursor = passage.source_seconds[1];
  };

  for (const span of ordered) {
    const start = clamp(span.start, 0, document.duration);
    const end = clamp(span.end, start, document.duration);
    if (start > cursor + EPSILON) {
      // Uncovered time holds the score at the last reached tick.
      push({kind: 'held', source_seconds: [cursor, start], tick: heldTick});
    }
    if (span.kind === 'explanation') {
      push({kind: 'held', source_seconds: [start, end], tick: heldTick});
    } else {
      const advance = Math.max(1, Math.round((end - start) / secondsPerBeatTick));
      const tickStart = heldTick;
      const tickEnd = tickStart + advance;
      push({kind: 'timed', source_seconds: [start, end], ticks: [tickStart, tickEnd]});
      heldTick = tickEnd;
    }
  }
  if (cursor < document.duration - EPSILON) {
    push({kind: 'held', source_seconds: [cursor, document.duration], tick: heldTick});
  }
  if (!passages.length) return estimatedAlignment(document);
  return {alignment_version: 1, mode: 'estimated', basis: 'passages', passages};
}

/** Returns a description of the first structural problem, or null. */
export function alignmentProblem(alignment: Alignment, duration: number): string | null {
  if (!alignment || alignment.alignment_version !== 1) return 'Unsupported alignment version.';
  if (!Array.isArray(alignment.passages) || !alignment.passages.length) return 'The alignment has no passages.';
  let previousTick = -1;
  let previousSeconds = -1;
  for (const passage of alignment.passages) {
    const [start, end] = passage.source_seconds;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < -EPSILON || end > duration + EPSILON) {
      return 'An alignment passage leaves the clip.';
    }
    if (end <= start + EPSILON) return 'An alignment passage has no duration.';
    if (start < previousSeconds - EPSILON) return 'Alignment passages are out of order.';
    if (passage.kind === 'timed') {
      const [first, last] = passage.ticks;
      if (!Number.isInteger(first) || !Number.isInteger(last) || last <= first) return 'A timed passage needs increasing ticks.';
      if (first < previousTick) return 'A timed passage reverses score order.';
      previousTick = last;
    } else {
      if (!Number.isInteger(passage.tick)) return 'A held passage needs a whole tick.';
      if (passage.tick < previousTick) return 'A held passage reverses score order.';
      previousTick = passage.tick;
    }
    previousSeconds = end;
  }
  return null;
}

function locateBySeconds(alignment: Alignment, seconds: number): AlignmentPassage | null {
  for (const passage of alignment.passages) {
    if (seconds >= passage.source_seconds[0] - EPSILON && seconds <= passage.source_seconds[1] + EPSILON) return passage;
  }
  return null;
}

/** Stored seconds → tick. Inside a held passage the cursor stays at its tick. */
export function secondsToTick(alignment: Alignment, seconds: number): number {
  const first = alignment.passages[0];
  const last = alignment.passages[alignment.passages.length - 1];
  const bounded = clamp(seconds, first.source_seconds[0], last.source_seconds[1]);
  const passage = locateBySeconds(alignment, bounded);
  if (!passage) return last.kind === 'timed' ? last.ticks[1] : last.tick;
  if (passage.kind === 'held') return passage.tick;
  const [secondStart, secondEnd] = passage.source_seconds;
  const [tickStart, tickEnd] = passage.ticks;
  const fraction = secondEnd > secondStart ? (bounded - secondStart) / (secondEnd - secondStart) : 0;
  return Math.round(tickStart + fraction * (tickEnd - tickStart));
}

/**
 * Tick → stored seconds. Within a timed passage the inverse is exact. A held tick also
 * exists at the end of the preceding stretch, so the earliest matching second wins:
 * seeking a held tick lands on the start of the hold (the documented policy).
 */
export function tickToSeconds(alignment: Alignment, tick: number): number {
  for (const passage of alignment.passages) {
    if (passage.kind === 'timed') {
      const [tickStart, tickEnd] = passage.ticks;
      if (tick >= tickStart && tick <= tickEnd) {
        const [secondStart, secondEnd] = passage.source_seconds;
        const fraction = tickEnd > tickStart ? (tick - tickStart) / (tickEnd - tickStart) : 0;
        return secondStart + fraction * (secondEnd - secondStart);
      }
    } else if (tick === passage.tick) {
      return passage.source_seconds[0];
    }
  }
  const last = alignment.passages[alignment.passages.length - 1];
  if (last.kind === 'timed') {
    return tick > last.ticks[1] ? last.source_seconds[1] : last.source_seconds[0];
  }
  return tick > last.tick ? last.source_seconds[1] : last.source_seconds[0];
}

/* ------------------------------------------------------------ the offset */

export function effectiveSecondsToTick(alignment: Alignment, effectiveSeconds: number, offsetSeconds: number): number {
  return secondsToTick(alignment, effectiveSeconds - offsetSeconds);
}

export function tickToEffectiveSeconds(alignment: Alignment, tick: number, offsetSeconds: number): number {
  return tickToSeconds(alignment, tick) + offsetSeconds;
}

/* ------------------------------------------------------------- anchors */

export type AnchorResult = { ok: true; alignment: Alignment; replacedTick: number } | { ok: false; message: string };

/**
 * Author an anchor: the given score tick belongs to the given recorded second.
 * The anchor must fall strictly inside a timed passage, or it could reverse time.
 */
export function addAnchor(alignment: Alignment, document: NotationDocument, seconds: number, tick: number): AnchorResult {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > document.duration) {
    return {ok: false, message: 'The anchor time is outside the clip.'};
  }
  if (!Number.isInteger(tick) || tick < 0) return {ok: false, message: 'The anchor tick must be a whole, non-negative number.'};
  const index = alignment.passages.findIndex(passage => passage.kind === 'timed'
    && seconds > passage.source_seconds[0] + EPSILON
    && seconds < passage.source_seconds[1] - EPSILON);
  if (index < 0) {
    return {ok: false, message: 'That second is inside a held passage or outside the timed score, so it cannot be anchored.'};
  }
  const passage = alignment.passages[index] as TimedPassage;
  const [secondStart, secondEnd] = passage.source_seconds;
  const [tickStart, tickEnd] = passage.ticks;
  const fraction = (seconds - secondStart) / (secondEnd - secondStart);
  const expected = Math.round(tickStart + fraction * (tickEnd - tickStart));
  if (tick <= tickStart || tick >= tickEnd) {
    return {ok: false, message: 'That tick is outside the stretch, so the anchor would reverse score order.'};
  }
  const first: TimedPassage = {kind: 'timed', source_seconds: [secondStart, seconds], ticks: [tickStart, tick]};
  const second: TimedPassage = {kind: 'timed', source_seconds: [seconds, secondEnd], ticks: [tick, tickEnd]};
  const passages = [...alignment.passages.slice(0, index), first, second, ...alignment.passages.slice(index + 1)];
  const next: Alignment = {alignment_version: 1, mode: 'anchored', basis: 'passages', passages};
  const problem = alignmentProblem(next, document.duration);
  if (problem) return {ok: false, message: problem};
  return {ok: true, alignment: next, replacedTick: expected};
}

/* -------------------------------------------------------- active notes */

export type Interval = { id: string; pitch: number; start: number; end: number };

/** Exact effective intervals for the recorded occurrences (no quantisation). */
export function occurrenceIntervals(document: NotationDocument, offsetSeconds: number): Interval[] {
  return document.performance.map(note => ({
    id: note.id,
    pitch: note.pitch,
    start: note.onset + offsetSeconds,
    end: note.onset + offsetSeconds + (note.duration ?? 0.25),
  }));
}

/** Occurrence ids sounding at an effective source second. */
export function activeOccurrenceIds(intervals: Interval[], effectiveSeconds: number): string[] {
  return intervals
    .filter(interval => effectiveSeconds >= interval.start && effectiveSeconds < interval.end)
    .map(interval => interval.id);
}
