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

export type ScoreClock = {
  /** Source seconds → notated score seconds (explanation time contributes nothing). */
  toScore: (seconds: number) => number;
  /** Length of the notated score in score seconds. */
  scoreDuration: number;
  /** Set when the authored spans are unusable; the clock then follows the source. */
  problem: string | null;
};

/**
 * The single score-time domain shared by the builder, the alignment and the engraved
 * geometry: playing passages advance score time, explanation passages and uncovered
 * gaps hold it. Recorded seconds are never changed.
 */
export function scoreClock(spans: PassageSpan[] | null | undefined, duration: number): ScoreClock {
  const problem = spansProblem(spans, duration);
  if (!spans || !spans.length || problem) {
    return {toScore: (seconds: number) => seconds, scoreDuration: duration, problem};
  }
  const ordered = [...spans].sort((left, right) => left.start - right.start);
  const segments: {start: number; end: number; playing: boolean; scoreStart: number}[] = [];
  let scoreElapsed = 0;
  let cursor = 0;
  for (const span of ordered) {
    const start = clamp(Math.max(span.start, cursor), 0, duration);
    const end = clamp(span.end, start, duration);
    if (start > cursor + EPSILON) segments.push({start: cursor, end: start, playing: false, scoreStart: scoreElapsed});
    segments.push({start, end, playing: span.kind === 'playing', scoreStart: scoreElapsed});
    if (span.kind === 'playing') scoreElapsed += Math.max(0, end - start);
    cursor = Math.max(cursor, end);
  }
  if (cursor < duration - EPSILON) segments.push({start: cursor, end: duration, playing: false, scoreStart: scoreElapsed});
  const total = scoreElapsed > 0 ? scoreElapsed : duration;
  const toScore = (seconds: number): number => {
    const bounded = clamp(seconds, 0, duration);
    for (const segment of segments) {
      if (bounded >= segment.start - EPSILON && bounded <= segment.end + EPSILON) {
        return segment.playing
          ? clamp(segment.scoreStart + (bounded - segment.start), 0, total)
          : clamp(segment.scoreStart, 0, total);
      }
    }
    return total;
  };
  return {toScore, scoreDuration: total, problem: null};
}

/**
 * Build passages from the authored playing/explanation spans. Each playing span
 * advances the score by its own duration, so an explanation (or an uncovered gap)
 * holds the cursor and the next passage resumes from the same tick instead of
 * inventing beats or jumping ahead. Boundaries come from `scoreClock`, so the map
 * and the engraved score describe the same timeline.
 */
export function alignmentFromSpans(document: NotationDocument, spans: PassageSpan[] | null | undefined): Alignment {
  if (!spans || !spans.length) return estimatedAlignment(document);
  if (spansProblem(spans, document.duration)) return estimatedAlignment(document);
  const secondsPerBeatTick = secondsPerTick(document);
  const clock = scoreClock(spans, document.duration);
  const ordered = [...spans].sort((left, right) => left.start - right.start);
  const passages: AlignmentPassage[] = [];
  let cursor = 0;

  const push = (passage: AlignmentPassage) => {
    if (passage.source_seconds[1] - passage.source_seconds[0] <= EPSILON) return;
    passages.push(passage);
    cursor = passage.source_seconds[1];
  };
  const tickAt = (seconds: number) => Math.round(clock.toScore(seconds) / secondsPerBeatTick);

  for (const span of ordered) {
    const start = clamp(Math.max(span.start, cursor), 0, document.duration);
    const end = clamp(span.end, start, document.duration);
    if (start > cursor + EPSILON) {
      push({kind: 'held', source_seconds: [cursor, start], tick: tickAt(cursor)});
    }
    if (span.kind === 'explanation') {
      push({kind: 'held', source_seconds: [start, end], tick: tickAt(start)});
    } else {
      const tickStart = tickAt(start);
      const tickEnd = Math.max(tickStart + 1, tickAt(end));
      push({kind: 'timed', source_seconds: [start, end], ticks: [tickStart, tickEnd]});
    }
  }
  if (cursor < document.duration - EPSILON) {
    push({kind: 'held', source_seconds: [cursor, document.duration], tick: tickAt(cursor)});
  }
  if (!passages.length) return estimatedAlignment(document);
  const alignment: Alignment = {alignment_version: 1, mode: 'estimated', basis: 'passages', passages};
  return alignmentProblem(alignment, document.duration) ? estimatedAlignment(document) : alignment;
}

/** Reports malformed authored spans: reversed, out of clip, or overlapping. */
export function spansProblem(spans: PassageSpan[] | null | undefined, duration: number): string | null {
  if (!spans || !spans.length) return null;
  let previousEnd = 0;
  for (const span of [...spans].sort((left, right) => left.start - right.start)) {
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end)) return 'A passage has a non-finite boundary.';
    if (span.start < -EPSILON || span.end > duration + EPSILON) return 'A passage leaves the clip.';
    if (span.end <= span.start + EPSILON) return 'A passage has no duration.';
    if (span.start < previousEnd - EPSILON) return 'Authored passages overlap.';
    if (span.kind !== 'playing' && span.kind !== 'explanation') return 'A passage has an unsupported kind.';
    previousEnd = span.end;
  }
  return null;
}

/**
 * Returns a description of the first structural problem, or null.
 *
 * The map must tile the clip exactly (no missing head or tail, no holes, no overlaps)
 * and the score side must be continuous across joins: a timed passage starts where the
 * previous one ended, and a held passage neither advances nor reverses the tick. A jump
 * would make the cursor skip silently, so it is reported rather than accepted.
 */
export function alignmentProblem(alignment: Alignment, duration: number): string | null {
  if (!alignment || alignment.alignment_version !== 1) return 'Unsupported alignment version.';
  if (alignment.mode !== 'estimated' && alignment.mode !== 'anchored') return 'Unsupported alignment mode.';
  if (alignment.basis !== 'tempo' && alignment.basis !== 'passages') return 'Unsupported alignment basis.';
  if (!Array.isArray(alignment.passages) || !alignment.passages.length) return 'The alignment has no passages.';
  let expectedStart = 0;
  let previousTick = 0;
  let first = true;
  for (const passage of alignment.passages) {
    if (passage.kind !== 'timed' && passage.kind !== 'held') return 'An alignment passage has an unsupported kind.';
    const [start, end] = passage.source_seconds;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'An alignment passage has a non-finite boundary.';
    if (start < -EPSILON || end > duration + EPSILON) return 'An alignment passage leaves the clip.';
    if (end <= start + EPSILON) return 'An alignment passage has no duration.';
    if (Math.abs(start - expectedStart) > EPSILON) {
      return start > expectedStart ? 'The alignment leaves a gap in the recording.' : 'Alignment passages overlap.';
    }
    if (first) {
      if (Math.abs(start) > EPSILON) return 'The alignment does not start at the beginning of the clip.';
      first = false;
    }
    if (passage.kind === 'timed') {
      const [tickStart, tickEnd] = passage.ticks;
      if (!Number.isInteger(tickStart) || !Number.isInteger(tickEnd)) return 'A timed passage needs whole ticks.';
      if (tickEnd <= tickStart) return 'A timed passage needs increasing ticks.';
      if (tickStart !== previousTick) return 'The alignment jumps in score time at a join.';
      previousTick = tickEnd;
    } else {
      if (!Number.isInteger(passage.tick)) return 'A held passage needs a whole tick.';
      if (passage.tick !== previousTick) return 'A held passage jumps in score time.';
    }
    expectedStart = end;
  }
  if (Math.abs(expectedStart - duration) > EPSILON) return 'The alignment does not reach the end of the clip.';
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
  const first = alignment.passages[0];
  const last = alignment.passages[alignment.passages.length - 1];
  const firstTick = first.kind === 'timed' ? first.ticks[0] : first.tick;
  if (!Number.isFinite(tick) || tick <= firstTick) return first.source_seconds[0];

  // Scan in order so the earliest owner of a tick wins. A held tick also exists at the
  // end of the preceding stretch, and a trailing hold keeps it at the hold's start.
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

  const lastTick = last.kind === 'timed' ? last.ticks[1] : last.tick;
  if (tick > lastTick) return last.source_seconds[1];
  return last.source_seconds[1];
}

/* ------------------------------------------------------------ the offset */

export function effectiveSecondsToTick(alignment: Alignment, effectiveSeconds: number, offsetSeconds: number): number {
  return secondsToTick(alignment, effectiveSeconds - offsetSeconds);
}

export function tickToEffectiveSeconds(alignment: Alignment, tick: number, offsetSeconds: number): number {
  return tickToSeconds(alignment, tick) + offsetSeconds;
}

/* ------------------------------------------------------------- anchors */

export type AnchorPoint = { seconds: number; tick: number };

/**
 * Apply an authored anchor list to a base map. Anchors are applied in order; the first
 * one that cannot be placed leaves the last valid map in place and reports why, so a
 * mistaken point never silently distorts the rest.
 */
export function applyAnchors(
  base: Alignment, document: NotationDocument, anchors: AnchorPoint[],
): { alignment: Alignment; problem: string | null } {
  let current = base;
  for (const anchor of anchors) {
    const result = addAnchor(current, document, anchor.seconds, anchor.tick);
    if (!result.ok) return {alignment: current, problem: result.message};
    current = result.alignment;
  }
  return {alignment: current, problem: null};
}

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
