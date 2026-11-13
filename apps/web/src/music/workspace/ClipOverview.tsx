/**
 * Phase 3 whole-clip overview: note density for the entire recording and a draggable
 * window showing the roll's visible seconds.
 *
 * Dragging pans the views; it never seeks playback and never edits the document.
 */
import {useRef} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {clamp, clampTimeWindow, type TimeWindow} from './viewport';
import {useElementWidth} from './useElementWidth';

const HEIGHT = 46;
const TRACK_TOP = 6;
const TRACK_HEIGHT = 30;

type Props = {
  document: NotationDocument;
  window: TimeWindow;
  playhead: number;
  onWindowChange: (window: TimeWindow) => void;
};

export function ClipOverview({document, window, playhead, onWindowChange}: Props) {
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{pointerId: number; offsetSeconds: number} | null>(null);
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

  const secondsAt = (clientX: number) => {
    const element = svgRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * document.duration, 0, document.duration);
  };

  const startDrag = (event: React.PointerEvent<SVGRectElement>) => {
    event.stopPropagation();
    const seconds = secondsAt(event.clientX);
    drag.current = {pointerId: event.pointerId, offsetSeconds: seconds - window.start};
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<SVGRectElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const start = secondsAt(event.clientX) - state.offsetSeconds;
    onWindowChange(clampTimeWindow({start, span: window.span}, document.duration));
  };

  const endDrag = (event: React.PointerEvent<SVGRectElement>) => {
    if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
  };

  const panBy = (fraction: number) => {
    const next = clampTimeWindow({start: window.start + window.span * fraction, span: window.span}, document.duration);
    if (next.start !== window.start) onWindowChange(next);
  };

  return <div className="ws-overview" ref={hostRef}>
    <svg ref={svgRef} width={trackWidth} height={HEIGHT} role="img"
      aria-label={`Whole clip overview, ${document.performance.length} notes, visible window ${window.span.toFixed(0)} seconds`}
      onPointerDown={event => {
        // Clicking the track recentres the window on that point; no seeking.
        if (event.target !== event.currentTarget && (event.target as SVGElement).dataset.window === 'true') return;
        const centre = secondsAt(event.clientX);
        onWindowChange(clampTimeWindow({start: centre - window.span / 2, span: window.span}, document.duration));
      }}>
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
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); panBy(-0.1); }
          if (event.key === 'ArrowRight') { event.preventDefault(); panBy(0.1); }
        }}/>
      {playhead >= 0 && playhead <= document.duration
        ? <line className="ws-overview-playhead" x1={(playhead / document.duration) * trackWidth} y1={TRACK_TOP - 4}
            x2={(playhead / document.duration) * trackWidth} y2={TRACK_TOP + TRACK_HEIGHT + 4}/>
        : null}
      <text className="ws-overview-label" x={4} y={TRACK_TOP + TRACK_HEIGHT + 9}>0s</text>
      <text className="ws-overview-label" x={trackWidth - 6} y={TRACK_TOP + TRACK_HEIGHT + 9} textAnchor="end">
        {document.duration.toFixed(0)}s
      </text>
    </svg>
  </div>;
}
