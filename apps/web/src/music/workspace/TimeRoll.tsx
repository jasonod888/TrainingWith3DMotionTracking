/**
 * Phase 3 time roll: a seconds-based viewport over the performance, with a ruler,
 * fixed pitch labels and a scrollable pitch canvas so wide ranges stay reachable.
 * Only the notes inside the window (plus a buffer) are mounted.
 *
 * Scrolling and zooming move the window; they never mutate the document or seek.
 * Revealing is an explicit request (a changed selection or an explicit Reveal), not
 * a reaction to the viewport, so manual panning is never reversed.
 */
import {useEffect, useRef, useState} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import {
  clampTimeWindow, clamp, pixelsPerSecond, pitchScrollTop, revealWindow, rulerTicks, visibleTimeRange,
  type TimeWindow,
} from './viewport';
import {useElementWidth} from './useElementWidth';

const RULER_HEIGHT = 24;
const PLOT_HEIGHT = 168;
const LABEL_WIDTH = 46;
const FIT_ROW_MIN = 6;
const SCROLL_ROW = 7;

export type RevealRequest = {occurrenceId: string; token: number};

type Props = {
  document: NotationDocument;
  window: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
  selectedOccurrenceId: string | null;
  /** A navigation request: performed once per token, never on viewport updates. */
  reveal: RevealRequest | null;
  playhead: number;
  onSelect: (occurrenceId: string) => void;
  onSeek: (seconds: number) => void;
};

export function TimeRoll({
  document, window, onWindowChange, selectedOccurrenceId, reveal, playhead, onSelect, onSeek,
}: Props) {
  const [viewportRef, measuredWidth, element] = useElementWidth<HTMLDivElement>();
  const [labelOffset, setLabelOffset] = useState(0);
  const syncing = useRef(false);
  const windowRef = useRef(window);
  const changeRef = useRef(onWindowChange);
  windowRef.current = window;
  changeRef.current = onWindowChange;

  const width = Math.max(120, measuredWidth);
  const pps = pixelsPerSecond(width, window);

  const pitches = document.performance.map(note => note.pitch);
  const low = Math.max(0, (pitches.length ? Math.min(...pitches) : 48) - 2);
  const high = Math.min(127, (pitches.length ? Math.max(...pitches) : 72) + 2);
  const rows = Math.max(1, high - low + 1);
  // Fit the clip's usual range when it stays readable; wider ranges scroll instead
  // of shrinking rows into unreadable slivers.
  const rowHeight = rows * FIT_ROW_MIN <= PLOT_HEIGHT ? PLOT_HEIGHT / rows : SCROLL_ROW;
  const pitchHeight = rows * rowHeight;
  const scrollable = pitchHeight > PLOT_HEIGHT + 0.5;

  const y = (pitch: number) => (high - pitch) * rowHeight + rowHeight / 2;
  const totalWidth = Math.max(width, Math.ceil(document.duration * pps));
  const ticks = rulerTicks(window, document.duration);
  const range = visibleTimeRange(window);
  const visibleNotes = document.performance.filter(note => {
    const end = note.onset + (note.duration ?? 0.25);
    return note.onset <= range.to && end >= range.from;
  });

  // A scrollable pitch canvas opens around the music, not at the highest row.
  useEffect(() => {
    const node = element;
    if (!node || !scrollable) return;
    const pitches = document.performance.map(note => note.pitch).sort((left, right) => left - right);
    const median = pitches.length ? pitches[Math.floor(pitches.length / 2)] : Math.round((low + high) / 2);
    const target = (high - median) * rowHeight + rowHeight / 2;
    node.scrollTop = clamp(target - RULER_HEIGHT - PLOT_HEIGHT / 2, 0, Math.max(0, pitchHeight - PLOT_HEIGHT));
    // Only when the rendered pitch range changes; edits keep the user's scroll.
  }, [element, scrollable, low, high, rowHeight, pitchHeight]);

  // Keep the scroll position in step with the window controlled by the harness.
  useEffect(() => {
    const node = element;
    if (!node) return;
    const target = Math.round(window.start * pps);
    if (Math.abs(node.scrollLeft - target) <= 1) return;
    syncing.current = true;
    node.scrollLeft = target;
    const frame = requestAnimationFrame(() => { syncing.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [window.start, pps, element]);

  // Reveal once per request token: time and pitch, without reacting to later pans.
  useEffect(() => {
    if (!reveal) return;
    const note = document.performance.find(item => item.id === reveal.occurrenceId);
    if (!note) return;
    const current = windowRef.current;
    const next = revealWindow(current, document.duration, note.onset);
    if (next.start !== current.start || next.span !== current.span) changeRef.current(next);
    const node = element;
    if (!node) return;
    const targetY = (high - note.pitch) * rowHeight + rowHeight / 2;
    node.scrollTop = pitchScrollTop(targetY, node.scrollTop, RULER_HEIGHT, PLOT_HEIGHT);
    // Deliberately keyed on the token only: panning must not re-run this.
  }, [reveal?.token]);

  const handleScroll = () => {
    const node = element;
    if (!node || syncing.current) return;
    setLabelOffset(node.scrollTop);
    const start = node.scrollLeft / pps;
    const next = clampTimeWindow({start, span: window.span}, document.duration);
    if (Math.abs(next.start - window.start) > 1e-4) onWindowChange(next);
  };

  const seekFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const node = element;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = event.clientX - rect.left;
    onSeek(clamp((node.scrollLeft + x) / pps, 0, document.duration));
  };

  return <div className="ws-roll">
    <div className="ws-roll-gutter" style={{width: LABEL_WIDTH}}>
      <div className="ws-roll-corner" style={{height: RULER_HEIGHT}}/>
      <div className="ws-roll-label-viewport" style={{height: PLOT_HEIGHT}}>
        <div className="ws-roll-label-canvas" style={{height: pitchHeight, transform: `translateY(${-labelOffset}px)`}}>
          {Array.from({length: rows}, (_, index) => high - index)
            .filter(pitch => pitch % 12 === 0)
            .map(pitch => <span key={pitch} style={{top: y(pitch) - 7}}>{pitchName(pitch)}</span>)}
        </div>
      </div>
    </div>
    <div className="ws-roll-viewport" ref={viewportRef} onScroll={handleScroll}
      style={{height: RULER_HEIGHT + PLOT_HEIGHT}} tabIndex={0}
      aria-label={`Piano roll, ${window.span.toFixed(0)} seconds from ${window.start.toFixed(1)} seconds${scrollable ? ', scrollable pitch range' : ''}`}>
      <div className="ws-roll-content" style={{width: totalWidth}}>
        <div className="ws-roll-ruler" style={{height: RULER_HEIGHT}} onClick={seekFromEvent}>
          {ticks.map(tick => <span key={tick} className="ws-roll-tick-label" style={{left: tick * pps + 4}}>{formatSeconds(tick)}</span>)}
        </div>
        <svg className="ws-roll-svg" width={totalWidth} height={pitchHeight} role="img"
          aria-label={`Piano roll, ${visibleNotes.length} notes visible`}
          data-culled-notes={visibleNotes.length} data-total-notes={document.performance.length}
          data-pitch-height={Math.round(pitchHeight)} data-plot-height={PLOT_HEIGHT}>
          {ticks.map(tick => <line key={tick} className="ws-roll-grid" x1={tick * pps} y1={0} x2={tick * pps} y2={pitchHeight}/>)}
          {Array.from({length: rows}, (_, index) => high - index).filter(pitch => pitch % 12 === 0).map(pitch =>
            <line key={`row-${pitch}`} className="ws-roll-octave" x1={0} y1={y(pitch)} x2={totalWidth} y2={y(pitch)}/>)}
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
            ? <line className="ws-roll-playhead" x1={playhead * pps} y1={0} x2={playhead * pps} y2={pitchHeight}/>
            : null}
        </svg>
      </div>
    </div>
  </div>;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? `${value}s` : `${value.toFixed(2)}s`;
}
