/**
 * One continuous, invertible musical-x layout for the correction sheet and roll.
 *
 * The sheet width policy is the authority. Both surfaces use the same measure boxes
 * and the same scroll offset. Recorded seconds are projected through the alignment
 * and then through this tick/x map; they are never treated as written ticks.
 */
import {
  tickToSeconds, type Alignment, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {layoutMeasures} from './viewport';

export type TimelineMeasure = {
  index: number;
  startTick: number;
  endTick: number;
  x: number;
  width: number;
};

export type TimelineLayout = {
  zoom: number;
  contentWidth: number;
  totalTicks: number;
  measures: TimelineMeasure[];
  tickToX(tick: number): number;
  xToTick(x: number): number;
  /** Fractional tick through the alignment (no command rounding). */
  sourceSecondsToTick(seconds: number, alignment: Alignment, offsetSeconds: number): number;
  sourceSecondsToX(seconds: number, alignment: Alignment, offsetSeconds: number): number;
  xToSourceSeconds(x: number, alignment: Alignment, offsetSeconds: number): number;
};

const EPSILON = 1e-9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Fractional seconds->tick under the same passage rules as secondsToTick, but without
 * quantising display or gesture geometry. Held passages deliberately return their
 * earliest musical tick; the caller surfaces the non-invertible passage state.
 */
export function fractionalSecondsToTick(alignment: Alignment, seconds: number): number {
  if (!Number.isFinite(seconds) || !alignment.passages.length) return 0;
  const first = alignment.passages[0];
  const firstSeconds = first.source_seconds[0];
  if (seconds <= firstSeconds) return first.kind === 'timed' ? first.ticks[0] : first.tick;
  for (const passage of alignment.passages) {
    if (passage.kind === 'timed') {
      const [secondStart, secondEnd] = passage.source_seconds;
      const [tickStart, tickEnd] = passage.ticks;
      if (seconds >= secondStart - EPSILON && seconds <= secondEnd + EPSILON) {
        const fraction = secondEnd > secondStart ? (seconds - secondStart) / (secondEnd - secondStart) : 0;
        return tickStart + fraction * (tickEnd - tickStart);
      }
    } else {
      const [secondStart, secondEnd] = passage.source_seconds;
      if (seconds >= secondStart - EPSILON && seconds <= secondEnd + EPSILON) return passage.tick;
    }
  }
  const last = alignment.passages[alignment.passages.length - 1];
  const lastTick = last.kind === 'timed' ? last.ticks[1] : last.tick;
  if (seconds > last.source_seconds[1]) {
    // Extrapolate linearly only through a timed tail; held/unknown tails stay put.
    if (last.kind === 'timed' && last.source_seconds[1] > last.source_seconds[0] && last.ticks[1] > last.ticks[0]) {
      const rate = (last.ticks[1] - last.ticks[0]) / (last.source_seconds[1] - last.source_seconds[0]);
      return lastTick + (seconds - last.source_seconds[1]) * rate;
    }
  }
  return lastTick;
}

export function buildTimelineLayout(document: NotationDocument, zoom = 1): TimelineLayout {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const {boxes} = layoutMeasures(document, {
    minWidth: 140 * safeZoom, maxWidth: 320 * safeZoom, perNote: 18 * safeZoom,
  });
  const measures: TimelineMeasure[] = document.measures.map((measure, index) => {
    const box = boxes[index];
    return {
      index: measure.index,
      startTick: measure.start,
      endTick: measure.start + measure.duration,
      x: box ? box.x : 0,
      width: box ? box.width : 0,
    };
  });
  const contentWidth = measures.length ? measures[measures.length - 1].x + measures[measures.length - 1].width : 0;
  const totalTicks = measures.length ? measures[measures.length - 1].endTick : 0;

  const tickToX = (tick: number): number => {
    if (!measures.length) return 0;
    if (!Number.isFinite(tick) || tick <= 0) return 0;
    if (tick >= totalTicks) return contentWidth;
    let low = 0;
    let high = measures.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (measures[middle].startTick <= tick) low = middle;
      else high = middle - 1;
    }
    const measure = measures[low];
    const span = measure.endTick - measure.startTick;
    const local = span > 0 ? clamp((tick - measure.startTick) / span, 0, 1) : 0;
    return measure.x + local * measure.width;
  };

  const xToTick = (x: number): number => {
    if (!measures.length) return 0;
    if (!Number.isFinite(x) || x <= 0) return 0;
    if (x >= contentWidth) return totalTicks;
    let low = 0;
    let high = measures.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (measures[middle].x <= x) low = middle;
      else high = middle - 1;
    }
    const measure = measures[low];
    const local = measure.width > 0 ? clamp((x - measure.x) / measure.width, 0, 1) : 0;
    return measure.startTick + local * (measure.endTick - measure.startTick);
  };

  return {
    zoom: safeZoom,
    contentWidth,
    totalTicks,
    measures,
    tickToX,
    xToTick,
    sourceSecondsToTick(seconds, alignment, offsetSeconds) {
      return fractionalSecondsToTick(alignment, seconds - offsetSeconds);
    },
    sourceSecondsToX(seconds, alignment, offsetSeconds) {
      return tickToX(fractionalSecondsToTick(alignment, seconds - offsetSeconds));
    },
    xToSourceSeconds(x, alignment, offsetSeconds) {
      return tickToSeconds(alignment, xToTick(x)) + offsetSeconds;
    },
  };
}

/** True when the source second sits inside a held/explanation passage. */
export function heldPassageAt(alignment: Alignment, seconds: number): boolean {
  return alignment.passages.some(passage => passage.kind === 'held'
    && seconds >= passage.source_seconds[0] - EPSILON
    && seconds <= passage.source_seconds[1] + EPSILON);
}

export function clampScroll(scrollLeft: number, contentWidth: number, viewportWidth: number): number {
  return clamp(scrollLeft, 0, Math.max(0, contentWidth - Math.max(0, viewportWidth)));
}
