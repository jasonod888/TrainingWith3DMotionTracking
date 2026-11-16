/**
 * Phase 3 viewport geometry.
 *
 * Pure functions so the scroll/zoom/culling behaviour can be tested without a DOM.
 * The roll maps seconds to pixels; the score maps engraved measures to pixels. Both
 * keep independent scroll containers and share a time window for the overview and
 * for revealing a selection. Linking by musical position is Phase 4.
 */
import {secondsPerTick} from '../../../../../packages/music-notation/index.ts';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';

export const MIN_SPAN_SECONDS = 2;
export const MAX_SPAN_SECONDS = 60;
export const DEFAULT_SPAN_SECONDS = 10;

export type TimeWindow = { start: number; span: number };

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Allowed window span for a clip. A short clip cannot be shown wider than itself, so
 * the minimum collapses to the clip duration instead of claiming a 2 s minimum.
 */
export function spanBounds(duration: number): {min: number; max: number} {
  const max = Math.max(0.25, Math.min(duration, MAX_SPAN_SECONDS));
  return {min: Math.min(MIN_SPAN_SECONDS, max), max};
}

export function maxSpanFor(duration: number): number {
  return spanBounds(duration).max;
}

/** Keep the window inside the clip and inside the permitted zoom range. */
export function clampTimeWindow(window: TimeWindow, duration: number): TimeWindow {
  const bounds = spanBounds(duration);
  const span = clamp(Number.isFinite(window.span) ? window.span : DEFAULT_SPAN_SECONDS, bounds.min, bounds.max);
  const start = clamp(Number.isFinite(window.start) ? window.start : 0, 0, Math.max(0, duration - span));
  return { start, span };
}

export function windowCentre(window: TimeWindow): number {
  return window.start + window.span / 2;
}

/**
 * Zoom by `factor` (>1 shows more) keeping `anchor` at the same fraction of the
 * viewport. The caller decides the anchor (playhead when visible, else the centre).
 */
export function zoomAround(window: TimeWindow, duration: number, factor: number, anchor: number | null): TimeWindow {
  const bounds = spanBounds(duration);
  const nextSpan = clamp(window.span * factor, bounds.min, bounds.max);
  const safeAnchor = anchor === null || !Number.isFinite(anchor) ? windowCentre(window) : clamp(anchor, 0, duration);
  const fraction = window.span > 0 ? clamp((safeAnchor - window.start) / window.span, 0, 1) : 0.5;
  return clampTimeWindow({ start: safeAnchor - fraction * nextSpan, span: nextSpan }, duration);
}

/**
 * Move the window just enough to reveal `seconds`, preserving context with a margin.
 * Returns the same window when the target is already comfortably visible.
 */
export function revealWindow(window: TimeWindow, duration: number, seconds: number, marginFraction = 0.2): TimeWindow {
  const margin = window.span * marginFraction;
  if (seconds >= window.start + margin && seconds <= window.start + window.span - margin) return window;
  const start = seconds - window.span / 2;
  const next = clampTimeWindow({ start, span: window.span }, duration);
  return next.start === window.start ? window : next;
}

/** Range of seconds the roll must draw, including a buffer either side. */
export function visibleTimeRange(window: TimeWindow, bufferFraction = 0.3): { from: number; to: number } {
  const buffer = window.span * bufferFraction;
  return { from: window.start - buffer, to: window.start + window.span + buffer };
}

export function pixelsPerSecond(viewportWidth: number, window: TimeWindow): number {
  return viewportWidth > 0 && window.span > 0 ? viewportWidth / window.span : 1;
}

export function secondsToX(seconds: number, window: TimeWindow, viewportWidth: number): number {
  return (seconds - window.start) * pixelsPerSecond(viewportWidth, window);
}

export function xToSeconds(x: number, window: TimeWindow, viewportWidth: number): number {
  return window.start + (viewportWidth > 0 ? x / viewportWidth : 0) * window.span;
}

/** Ruler spacing that keeps labels readable across the zoom range. */
export function rulerStep(span: number): number {
  const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30];
  for (const step of candidates) {
    if (span / step <= 8) return step;
  }
  return 60;
}

export function rulerTicks(window: TimeWindow, duration: number, step = rulerStep(window.span)): number[] {
  const ticks: number[] = [];
  const first = Math.ceil(window.start / step) * step;
  for (let value = first; value <= Math.min(duration, window.start + window.span) + 1e-9; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
}

export type MeasureBox = { index: number; x: number; width: number; ticks: number };

/** Engraved widths: denser measures get more room, within readable bounds. */
export function layoutMeasures(
  document: NotationDocument,
  options: { minWidth?: number; maxWidth?: number; perNote?: number } = {},
): { boxes: MeasureBox[]; totalWidth: number } {
  const minWidth = options.minWidth ?? 140;
  const maxWidth = options.maxWidth ?? 320;
  const perNote = options.perNote ?? 18;
  const counts = new Map<number, number>();
  for (const segment of document.segments) {
    if (segment.rest) continue;
    counts.set(segment.measure_index, (counts.get(segment.measure_index) ?? 0) + Math.max(1, segment.notes.length));
  }
  const boxes: MeasureBox[] = [];
  let x = 0;
  for (const measure of document.measures) {
    const width = clamp(minWidth + (counts.get(measure.index) ?? 0) * perNote, minWidth, maxWidth);
    boxes.push({ index: measure.index, x, width, ticks: measure.duration });
    x += width;
  }
  return { boxes, totalWidth: x };
}

/** Index range of measures intersecting the viewport plus a buffer, for virtualisation. */
export function visibleMeasureIndexes(
  boxes: MeasureBox[], scrollLeft: number, viewportWidth: number, bufferPx = 280,
): [number, number] {
  if (!boxes.length) return [0, -1];
  const from = scrollLeft - bufferPx;
  const to = scrollLeft + Math.max(0, viewportWidth) + bufferPx;
  let first = -1;
  let last = -1;
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    if (box.x + box.width < from) continue;
    if (box.x > to) break;
    if (first < 0) first = index;
    last = index;
  }
  if (first < 0) return [0, -1];
  return [first, last];
}

/** Scroll position that brings a measure into view without moving when already visible. */
export function scrollForMeasure(
  boxes: MeasureBox[], index: number, viewportWidth: number, scrollLeft = Number.NaN, margin = 60,
): number {
  const box = boxes[clamp(index, 0, boxes.length - 1)];
  if (!box) return 0;
  if (Number.isFinite(scrollLeft)) {
    const visibleFrom = scrollLeft + margin;
    const visibleTo = scrollLeft + viewportWidth - margin;
    if (box.x >= visibleFrom && box.x + box.width <= visibleTo) return scrollLeft;
  }
  return Math.max(0, box.x - margin);
}

/** Tick position of a source second under the estimated tempo map (Phase 3 only). */
export function secondsToTick(document: NotationDocument, seconds: number): number {
  return Math.round(seconds / secondsPerTick(document));
}

/**
 * Scroll offset that brings a pitch row into view. Returns the current offset when the
 * row is already inside the visible band, so revealing never jitters.
 */
export function pitchScrollTop(
  pitchY: number, scrollTop: number, rulerHeight: number, plotHeight: number,
): number {
  const visibleFrom = scrollTop + rulerHeight;
  const visibleTo = scrollTop + rulerHeight + plotHeight;
  if (pitchY >= visibleFrom && pitchY <= visibleTo) return scrollTop;
  return Math.max(0, pitchY - rulerHeight - plotHeight / 2);
}

export function tickToSeconds(document: NotationDocument, tick: number): number {
  return tick * secondsPerTick(document);
}

/** Measure index containing a tick. */
export function measureAtTick(boxes: MeasureBox[], document: NotationDocument, tick: number): number {
  const measure = document.measures.find(item => tick >= item.start && tick < item.start + item.duration);
  if (!measure) return Math.max(0, boxes.length - 1);
  return clamp(measure.index, 0, Math.max(0, boxes.length - 1));
}

export const SCORE_CONTEXT_WIDTH = 116;
const SCORE_MEASURE_PAD = 14;

/** Horizontal position of a score tick inside the strip (content coordinates). */
export function xForTick(
  boxes: MeasureBox[], document: NotationDocument, tick: number, contextWidth = SCORE_CONTEXT_WIDTH,
): number {
  if (!boxes.length) return contextWidth;
  const index = measureAtTick(boxes, document, tick);
  const box = boxes[index];
  const measure = document.measures[box.index];
  const local = measure.duration > 0 ? clamp((tick - measure.start) / measure.duration, 0, 1) : 0;
  return contextWidth + box.x + SCORE_MEASURE_PAD + local * (box.width - SCORE_MEASURE_PAD * 2);
}

/** Inverse: which score tick sits at a content x position (used by the ruler). */
export function tickAtX(
  boxes: MeasureBox[], document: NotationDocument, x: number, contextWidth = SCORE_CONTEXT_WIDTH,
): number {
  if (!boxes.length) return 0;
  const local = x - contextWidth;
  const firstBox = boxes[0];
  if (local < firstBox.x) return document.measures[firstBox.index].start;
  const lastBox = boxes[boxes.length - 1];
  if (local >= lastBox.x + lastBox.width) {
    const measure = document.measures[lastBox.index];
    return measure.start + measure.duration;
  }
  const box = boxes.find(item => local >= item.x && local < item.x + item.width) ?? lastBox;
  const measure = document.measures[box.index];
  const within = clamp((local - box.x - SCORE_MEASURE_PAD) / Math.max(1, box.width - SCORE_MEASURE_PAD * 2), 0, 1);
  return Math.round(measure.start + within * measure.duration);
}
