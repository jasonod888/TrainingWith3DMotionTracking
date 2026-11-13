/**
 * Phase 3 time roll: a seconds-based viewport over the performance, with a ruler,
 * fixed pitch labels and only the notes inside the window (plus a buffer) mounted.
 *
 * Scroll and zoom only move the window; they never mutate the document or seek.
 * Selecting a note selects its occurrence and reveals it in the window.
 */
import {useEffect, useRef} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import {
  clampTimeWindow, clamp, pixelsPerSecond, revealWindow, rulerTicks, visibleTimeRange,
  type TimeWindow,
} from './viewport';
import {useElementWidth} from './useElementWidth';

const RULER_HEIGHT = 24;
const PLOT_HEIGHT = 150;
const LABEL_WIDTH = 46;
const MIN_ROW = 5;

type Props = {
  document: NotationDocument;
  window: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
  selectedOccurrenceId: string | null;
  revealOccurrenceId: string | null;
  playhead: number;
  onSelect: (occurrenceId: string) => void;
  onSeek: (seconds: number) => void;
};

export function TimeRoll({
  document, window, onWindowChange, selectedOccurrenceId, revealOccurrenceId, playhead, onSelect, onSeek,
}: Props) {
  const [viewportRef, viewportWidth] = useElementWidth<HTMLDivElement>();
  const syncing = useRef(false);
  const width = Math.max(120, viewportWidth);
  const pps = pixelsPerSecond(width, window);

  const pitches = document.performance.map(note => note.pitch);
  const low = Math.max(0, (pitches.length ? Math.min(...pitches) : 48) - 2);
  const high = Math.min(127, (pitches.length ? Math.max(...pitches) : 72) + 2);
  const rows = Math.max(1, high - low + 1);
  const rowHeight = clamp(PLOT_HEIGHT / rows, MIN_ROW, 12);
  const plotTop = RULER_HEIGHT;

  const y = (pitch: number) => plotTop + (high - pitch) * rowHeight;
  const totalWidth = Math.max(width, Math.ceil(document.duration * pps));
  const ticks = rulerTicks(window, document.duration);
  const range = visibleTimeRange(window);
  const visibleNotes = document.performance.filter(note => {
    const end = note.onset + (note.duration ?? 0.25);
    return note.onset <= range.to && end >= range.from;
  });

  // Keep the scroll position in step with the window controlled by the harness.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const target = Math.round(window.start * pps);
    if (Math.abs(element.scrollLeft - target) <= 1) return;
    syncing.current = true;
    element.scrollLeft = target;
    const frame = requestAnimationFrame(() => { syncing.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [window.start, pps, viewportRef]);

  // Revealing a selection moves the window, never the playhead.
  useEffect(() => {
    if (!revealOccurrenceId) return;
    const note = document.performance.find(item => item.id === revealOccurrenceId);
    if (!note) return;
    const next = revealWindow(window, document.duration, note.onset);
    if (next !== window) onWindowChange(next);
    // The window object identity changes only when the reveal moves it.
  }, [revealOccurrenceId, document, window, onWindowChange]);

  const handleScroll = () => {
    const element = viewportRef.current;
    if (!element || syncing.current) return;
    const start = element.scrollLeft / pps;
    const next = clampTimeWindow({start, span: window.span}, document.duration);
    if (Math.abs(next.start - window.start) > 1e-4) onWindowChange(next);
  };

  const seekFromEvent = (event: React.MouseEvent<SVGRectElement>) => {
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    onSeek(clamp((element.scrollLeft + x) / pps, 0, document.duration));
  };

  return <div className="ws-roll" style={{gridTemplateColumns: `${LABEL_WIDTH}px minmax(0, 1fr)`}}>
    <div className="ws-roll-labels" style={{paddingTop: RULER_HEIGHT}} aria-hidden="true">
      {Array.from({length: rows}, (_, index) => high - index)
        .filter(pitch => pitch % 12 === 0)
        .map(pitch => <span key={pitch} style={{top: y(pitch) - 6}}>{pitchName(pitch)}</span>)}
    </div>
    <div className="ws-roll-viewport" ref={viewportRef} onScroll={handleScroll}>
      <div className="ws-roll-content">
        <svg className="ws-roll-svg" width={totalWidth} height={plotTop + PLOT_HEIGHT} role="img"
          aria-label={`Piano roll showing ${window.span.toFixed(0)} seconds from ${window.start.toFixed(1)} seconds, ${visibleNotes.length} notes visible`}
          data-culled-notes={visibleNotes.length} data-total-notes={document.performance.length}>
          <rect className="ws-roll-ruler" x={0} y={0} width={totalWidth} height={RULER_HEIGHT}
            onClick={seekFromEvent}/>
          {ticks.map(tick => {
            const x = tick * pps;
            return <g key={tick}>
              <line className="ws-roll-tick" x1={x} y1={RULER_HEIGHT - 6} x2={x} y2={RULER_HEIGHT}/>
              <text className="ws-roll-tick-label" x={x + 4} y={RULER_HEIGHT - 8}>{formatSeconds(tick)}</text>
              <line className="ws-roll-grid" x1={x} y1={RULER_HEIGHT} x2={x} y2={plotTop + PLOT_HEIGHT}/>
            </g>;
          })}
          {Array.from({length: rows}, (_, index) => high - index).filter(pitch => pitch % 12 === 0).map(pitch => <g key={`row-${pitch}`}>
            <line className="ws-roll-octave" x1={0} y1={y(pitch)} x2={totalWidth} y2={y(pitch)}/>
          </g>)}
          {visibleNotes.map(note => {
            const left = note.onset * pps;
            const noteWidth = Math.max(2, (note.duration ?? 0.25) * pps - 1);
            const selected = selectedOccurrenceId === note.id;
            return <rect key={note.id} className={`ws-roll-note${selected ? ' is-selected' : ''}`}
              x={left} y={y(note.pitch) - rowHeight / 2} width={noteWidth} height={Math.max(3, rowHeight - 1)} rx={2}
              data-occurrence={note.id} role="button" tabIndex={0}
              aria-label={`${pitchName(note.pitch)} at ${note.onset.toFixed(2)} seconds${selected ? ', selected' : ''}`}
              onPointerDown={() => onSelect(note.id)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(note.id); } }}>
              <title>{`${pitchName(note.pitch)} · ${note.onset.toFixed(2)} s · ${(note.duration ?? 0).toFixed(2)} s`}</title>
            </rect>;
          })}
          {playhead >= window.start && playhead <= window.start + window.span
            ? <line className="ws-roll-playhead" x1={playhead * pps} y1={RULER_HEIGHT}
                x2={playhead * pps} y2={plotTop + PLOT_HEIGHT}/>
            : null}
        </svg>
      </div>
    </div>
  </div>;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? `${value}s` : `${value.toFixed(2)}s`;
}

