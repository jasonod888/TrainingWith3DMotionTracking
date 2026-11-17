/**
 * Phase 3 whole-clip overview: note density for the entire recording and a draggable
 * window showing the roll's visible seconds.
 *
 * Dragging the window pans the views and moves the source playback with them, keeping
 * the playhead at the same relative position inside the window. Clicking elsewhere
 * seeks exactly to that source time (and recentres the visible range); keyboard
 * navigation of the visible-range slider behaves like a drag. It never edits the
 * document.
 */
import {useEffect, useRef} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {clamp, type TimeWindow} from './viewport';
import {useElementWidth} from './useElementWidth';

const HEIGHT = 40;
const TRACK_TOP = 6;
const TRACK_HEIGHT = 30;
/** Keep the playhead visibly inside the window, even when it started outside. */
const ANCHOR_MIN = 0.02;
const ANCHOR_MAX = 0.98;

type Props = {
  document: NotationDocument;
  window: TimeWindow;
  playhead: number;
  /** Move the visible range; `seekSeconds` also seeks the one source clock. */
  onNavigate: (window: TimeWindow, seekSeconds?: number) => void;
};

type DragState = {
  pointerId: number;
  startClientX: number;
  secondsPerPixel: number;
  start: number;
  span: number;
  anchor: number;
  duration: number;
  lastStart: number;
  lastSeek: number;
};

export function ClipOverview({document, window, playhead, onNavigate}: Props) {
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const pending = useRef<{window: TimeWindow; seek: number} | null>(null);
  const frame = useRef<number | null>(null);
  // The scheduled frame reads the latest callback rather than a stale render closure.
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const trackWidth = Math.max(120, width);
  const buckets = Math.min(320, Math.max(40, Math.round(trackWidth / 4)));

  const counts = new Array<number>(buckets).fill(0);
  for (const note of document.performance) {
    const bucket = clamp(Math.floor((note.onset / document.duration) * buckets), 0, buckets - 1);
    counts[bucket] += 1;
  }
  const peak = Math.max(1, ...counts);

  const windowX = (window.start / document.duration) * trackWidth;
  const windowWidth = Math.max(8, (window.span / document.duration) * trackWidth);

  const cancelPending = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    pending.current = null;
  };

  const applyPending = () => {
    const next = pending.current;
    pending.current = null;
    if (next) navigateRef.current(next.window, next.seek);
  };

  /**
   * Apply the first movement immediately and coalesce later pointer moves into one
   * seek per frame; pointer-up flushes the pending position so release is exact.
   */
  const queueNavigation = (nextWindow: TimeWindow, seekSeconds: number) => {
    pending.current = {window: nextWindow, seek: seekSeconds};
    if (frame.current === null) {
      applyPending();
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        applyPending();
      });
    }
  };

  useEffect(() => () => {
    cancelPending();
  }, []);

  const trackGeometry = () => {
    const element = svgRef.current;
    if (!element) return {left: 0, width: trackWidth};
    const rect = element.getBoundingClientRect();
    return rect.width > 0 ? {left: rect.left, width: rect.width} : {left: 0, width: trackWidth};
  };

  const secondsAt = (clientX: number) => {
    const geometry = trackGeometry();
    return clamp(((clientX - geometry.left) / geometry.width) * document.duration, 0, document.duration);
  };

  const startDrag = (event: React.PointerEvent<SVGRectElement>) => {
    event.stopPropagation();
    if (drag.current && drag.current.pointerId !== event.pointerId) return;
    const geometry = trackGeometry();
    const span = window.span;
    const anchor = span > 0 ? clamp((playhead - window.start) / span, ANCHOR_MIN, ANCHOR_MAX) : 0.5;
    drag.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      // Freeze the pixels/seconds map: clock and view updates during the drag must
      // not feed back into the geometry under the pointer.
      secondsPerPixel: geometry.width > 0 ? document.duration / geometry.width : 0,
      start: window.start,
      span,
      anchor,
      duration: document.duration,
      lastStart: window.start,
      lastSeek: clamp(window.start + anchor * span, 0, document.duration),
    };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* jsdom */ }
  };

  const moveDrag = (event: React.PointerEvent<SVGRectElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const maxStart = Math.max(0, state.duration - state.span);
    const start = clamp(state.start + (event.clientX - state.startClientX) * state.secondsPerPixel, 0, maxStart);
    const seek = clamp(start + state.anchor * state.span, 0, state.duration);
    if (Math.abs(start - state.lastStart) < 1e-9 && Math.abs(seek - state.lastSeek) < 1e-9) return;
    state.lastStart = start;
    state.lastSeek = seek;
    queueNavigation({start, span: state.span}, seek);
  };

  const finishDrag = (event: React.PointerEvent<SVGRectElement>, commit: boolean) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (commit) {
      // A release always applies the final coalesced position, never a dropped frame.
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      applyPending();
    } else {
      cancelPending();
    }
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch { /* jsdom */ }
    drag.current = null;
  };

  const panBy = (fraction: number) => {
    const span = window.span;
    const anchor = span > 0 ? clamp((playhead - window.start) / span, ANCHOR_MIN, ANCHOR_MAX) : 0.5;
    const start = clamp(window.start + span * fraction, 0, Math.max(0, document.duration - span));
    // At a clip boundary there is nowhere to pan; do not turn a no-op key into a seek.
    if (Math.abs(start - window.start) < 1e-9) return;
    onNavigate({start, span}, clamp(start + anchor * span, 0, document.duration));
  };

  const seekClick = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget && (event.target as SVGElement).dataset.window === 'true') return;
    const seconds = secondsAt(event.clientX);
    const span = window.span;
    const start = clamp(seconds - span / 2, 0, Math.max(0, document.duration - span));
    onNavigate({start, span}, seconds);
  };

  return <div className="ws-overview" ref={hostRef}>
    <svg ref={svgRef} width={trackWidth} height={HEIGHT} role="img"
      aria-label={`Whole clip overview, ${document.performance.length} notes, visible window ${window.span.toFixed(0)} seconds`}
      onPointerDown={seekClick}>
      <rect className="ws-overview-track" x={0} y={TRACK_TOP} width={trackWidth} height={TRACK_HEIGHT} rx={4}/>
      {counts.map((count, index) => {
        if (!count) return null;
        const bucketWidth = trackWidth / buckets;
        const height = Math.max(1, (count / peak) * (TRACK_HEIGHT - 4));
        return <rect key={index} className="ws-overview-density" x={index * bucketWidth}
          y={TRACK_TOP + TRACK_HEIGHT - height} width={Math.max(0.6, bucketWidth - 0.6)} height={height}/>;
      })}
      <rect className="ws-overview-window" data-window="true" x={windowX} y={TRACK_TOP - 2} width={windowWidth}
        height={TRACK_HEIGHT + 4} rx={3} tabIndex={0} role="slider" aria-label="Visible range"
        aria-valuemin={0} aria-valuemax={Math.round(document.duration)} aria-valuenow={Math.round(window.start)}
        aria-valuetext={`Visible ${window.start.toFixed(1)} to ${(window.start + window.span).toFixed(1)} seconds`}
        onPointerDown={startDrag} onPointerMove={moveDrag}
        onPointerUp={event => finishDrag(event, true)} onPointerCancel={event => finishDrag(event, false)}
        onLostPointerCapture={event => finishDrag(event, false)}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); panBy(-0.1); }
          if (event.key === 'ArrowRight') { event.preventDefault(); panBy(0.1); }
        }}/>
      {playhead >= 0 && playhead <= document.duration
        ? <line className="ws-overview-playhead" x1={(playhead / document.duration) * trackWidth} y1={TRACK_TOP - 4}
            x2={(playhead / document.duration) * trackWidth} y2={TRACK_TOP + TRACK_HEIGHT + 4}/>
        : null}
    </svg>
  </div>;
}
