/**
 * Phase 3 time roll: a seconds-based viewport over the performance, with a ruler,
 * fixed pitch labels and a scrollable pitch canvas so wide ranges stay reachable.
 * Only the notes inside the window (plus a buffer) are mounted.
 *
 * Scrolling and zooming move the window; they never mutate the document or seek.
 * Revealing is an explicit request (a changed selection or an explicit Reveal), not
 * a reaction to the viewport, so manual panning is never reversed.
 */
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import {
  GUITAR_FINGER_PALETTE, GUITAR_TUNINGS, assignGuitarFingers, guitarStringForPitch,
  normalizeGuitarSetup, openStringPitch, resolveGuitarPosition, type GuitarFinger, type GuitarTuningId,
} from '../../../../../packages/music-notation/guitar.ts';
import {
  clampTimeWindow, clamp, pixelsPerSecond, pitchScrollTop, revealWindow, rulerTicks, visibleTimeRange,
  type TimeWindow,
} from './viewport';
import {useElementWidth} from './useElementWidth';
import {useClockTime, type ClockStore} from './clock';
import {pitchFromDrag, resolveAxis, type GestureAxis, type GestureEdit} from './gestures';
import {heldPassageAt, type TimelineLayout} from './timeline-layout';

const RULER_HEIGHT = 24;
const PLOT_HEIGHT = 168;
const LABEL_WIDTH = 46;
const FIT_ROW_MIN = 6;
const SCROLL_ROW = 7;

export type RevealRequest = {occurrenceId: string; token: number};

type Props = {
  document: NotationDocument;
  /** Shared correction timeline geometry. When present the roll no longer owns x scale. */
  layout?: TimelineLayout;
  alignment?: import('../../../../../packages/music-notation/index.ts').Alignment;
  sharedScrollLeft?: number;
  sharedViewportWidth?: number;
  gutter?: number;
  cursorX?: number | null;
  /** Frame-driven fallback seconds for the internal cursor leaf. */
  cursorFallbackSeconds?: number | null;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  window: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
  selectedOccurrenceId: string | null;
  /** A navigation request: performed once per token, never on viewport updates. */
  reveal: RevealRequest | null;
  playhead: number;
  /** Applied once: notes are drawn at their effective (video) time. */
  offsetSeconds?: number;
  /** Occurrences sounding at the current source time. */
  activeOccurrenceIds?: string[];
  onSelect: (occurrenceId: string) => void;
  onSeek: (seconds: number) => void;
  /** Frame-rate visual clock; when present the cursor follows it per frame. */
  clock?: ClockStore | null;
  /** Offset-aware intervals used to light sounding notes inside this surface. */
  intervals?: { id: string; start: number; end: number }[];
  /** Distinguishes a user scroll from a reveal or playback pan. */
  onWindowChangeOrigin?: (window: TimeWindow, origin: 'user' | 'reveal' | 'playback') => void;
  /** Commits one completed drag as a single edit. */
  onGestureCommit?: (edit: GestureEdit) => void;
  /** Bounded pitch audition while dragging. */
  onAuditionPitch?: (pitch: number) => void;
  /** Explicit snap in seconds; null keeps the exact recorded value. */
  snapSeconds?: number | null;
  /** Add-note mode places a ghost instead of selecting. */
  addMode?: boolean;
  ghost?: {seconds: number; pitch: number; durationSeconds?: number; invalid?: boolean} | null;
  /** Replace/Add modes disable direct manipulation in this surface. */
  editingEnabled?: boolean;
  onGhostPlace?: (seconds: number, pitch: number) => void;
  /** `strings` draws six guitar lanes and commits string/fret edits on vertical drags. */
  rowMode?: 'pitch' | 'strings';
  tuning?: GuitarTuningId;
  capo?: number;
};

function RollCursorLine({clock, fallback, cursorX, layout, alignment, gutter, pitchHeight}: {
  clock?: ClockStore | null;
  fallback: number | null;
  cursorX: number | null;
  layout?: TimelineLayout;
  alignment?: Props['alignment'];
  gutter: number;
  pitchHeight: number;
}) {
  const time = useClockTime(clock, fallback ?? 0);
  const x = cursorX !== null ? cursorX
    : layout && alignment ? gutter + layout.sourceSecondsToX(time, alignment, 0) : 0;
  return <line className="ws-shared-surface-cursor ws-roll-playhead" data-shared-cursor
    data-playhead-seconds={time} x1={x} y1={0} x2={x} y2={pitchHeight}/>;
}

export function TimeRoll({
  document, window, onWindowChange, selectedOccurrenceId, reveal, playhead, offsetSeconds = 0,
  layout, alignment, sharedScrollLeft = 0, sharedViewportWidth = 0, gutter = 0, onGestureStart, onGestureEnd, cursorX = null,
  cursorFallbackSeconds = null,
  activeOccurrenceIds = [], onSelect, onSeek, onWindowChangeOrigin, clock = null, intervals,
  onGestureCommit, onAuditionPitch, snapSeconds = null, addMode = false, ghost = null, onGhostPlace,
  editingEnabled = true, rowMode = 'pitch', tuning, capo = 0,
}: Props) {
  const setup = normalizeGuitarSetup({tuning, capo});
  const tuningConfig = GUITAR_TUNINGS[setup.tuning];
  const stringLabels = tuningConfig.stringLabels;
  const liveActive = activeOccurrenceIds;
  const [viewportRef, measuredWidth, element] = useElementWidth<HTMLDivElement>();
  const [labelOffset, setLabelOffset] = useState(0);
  const syncing = useRef(false);
  const windowRef = useRef(window);
  const changeRef = useRef(onWindowChange);
  windowRef.current = window;
  changeRef.current = onWindowChange;
  const originRef = useRef(onWindowChangeOrigin);
  originRef.current = onWindowChangeOrigin;
  const effectiveOffset = offsetSeconds;
  const shared = Boolean(layout && alignment);
  const xAtEffective = (seconds: number) => layout && alignment
    ? gutter + layout.sourceSecondsToX(seconds, alignment, 0) : 0;

  const width = Math.max(120, measuredWidth);
  const pps = pixelsPerSecond(width, window);

  const stringsMode = rowMode === 'strings';
  const STRING_ROW = PLOT_HEIGHT / 6;
  const pitches = document.performance.map(note => note.pitch);
  const low = Math.max(0, (pitches.length ? Math.min(...pitches) : 48) - 2);
  const high = Math.min(127, (pitches.length ? Math.max(...pitches) : 72) + 2);
  const rows = stringsMode ? 6 : Math.max(1, high - low + 1);
  // Fit the clip's usual range when it stays readable; wider ranges scroll instead
  // of shrinking rows into unreadable slivers.
  const rowHeight = stringsMode ? STRING_ROW : rows * FIT_ROW_MIN <= PLOT_HEIGHT ? PLOT_HEIGHT / rows : SCROLL_ROW;
  const pitchHeight = stringsMode ? PLOT_HEIGHT : rows * rowHeight;
  const scrollable = stringsMode ? false : pitchHeight > PLOT_HEIGHT + 0.5;

  /** Canonical contract string (1 = highest); falls back to the active setup. */
  const stringOf = (note: {pitch: number; string?: number | null}): number => {
    if (note.string != null && Number.isInteger(note.string) && note.string >= 1 && note.string <= 6) return note.string;
    const fallback = guitarStringForPitch(note.pitch, setup);
    return fallback ? fallback.string : 1;
  };
  const fingerMap = useMemo(() => assignGuitarFingers(document.performance, setup),
    [document.performance, setup.tuning, setup.capo]);
  const yString = (string: number) => (string - 1) * rowHeight + rowHeight / 2;
  const y = (pitch: number) => stringsMode
    ? yString(stringOf({pitch}))
    : (high - pitch) * rowHeight + rowHeight / 2;
  const totalWidth = shared && layout ? gutter + layout.contentWidth
    : Math.max(width, Math.ceil(document.duration * pps));
  const ticks = shared && layout && alignment
    ? Array.from(new Set(layout.measures.map(measure => measure.startTick)))
    : rulerTicks(window, document.duration);
  const xForTick = (tick: number) => shared && layout ? gutter + layout.tickToX(tick) : tick * pps;
  const range = visibleTimeRange(window);
  const visibleNotes = document.performance.filter(note => {
    if (shared && layout && alignment) {
      const from = gutter + layout.sourceSecondsToX(note.onset + effectiveOffset, alignment, 0);
      const to = gutter + layout.sourceSecondsToX(note.onset + effectiveOffset + (note.duration ?? 0.25), alignment, 0);
      return to >= sharedScrollLeft - 200 && from <= sharedScrollLeft + Math.max(200, sharedViewportWidth) + 200;
    }
    const onset = note.onset + effectiveOffset;
    const end = onset + (note.duration ?? 0.25);
    return onset <= range.to && end >= range.from;
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

  // Shared mode: the harness writes the canonical offset to both clipped
  // viewports directly. Only the legacy independent mode owns this element.
  useLayoutEffect(() => {
    const node = element;
    if (!node || shared) return;
    const target = Math.round(window.start * pps);
    if (Math.abs(node.scrollLeft - target) <= 0.5) return;
    syncing.current = true;
    node.scrollLeft = target;
    const frame = requestAnimationFrame(() => { syncing.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [window.start, pps, element, shared]);

  // Reveal once per request token: time and pitch, without reacting to later pans.
  useEffect(() => {
    if (!reveal) return;
    const note = document.performance.find(item => item.id === reveal.occurrenceId);
    if (!note) return;
    const current = windowRef.current;
    const next = revealWindow(current, document.duration, note.onset + effectiveOffset);
    if (next.start !== current.start || next.span !== current.span) {
      if (originRef.current) originRef.current(next, 'reveal');
      else changeRef.current(next);
    }
    const node = element;
    if (!node) return;
    const targetY = stringsMode ? yString(stringOf(note)) : (high - note.pitch) * rowHeight + rowHeight / 2;
    node.scrollTop = pitchScrollTop(targetY, node.scrollTop, RULER_HEIGHT, PLOT_HEIGHT);
    // Deliberately keyed on the token only: panning must not re-run this.
  }, [reveal?.token]);

  type DragState = {
    note: NotationDocument['performance'][number];
    startX: number; startY: number; forced: GestureAxis | null; pointerId: number;
    capture: Element | null; axis: GestureAxis | null; pitch: number; onset: number; duration: number;
    string: number;
  };
  const dragRef = useRef<DragState | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const auditionAt = useRef(0);
  const [dragPreview, setDragPreview] = useState<{id: string; pitch: number; onset: number; duration: number; axis: GestureAxis; string: number} | null>(null);

  const teardownDrag = () => {
    dragCleanup.current?.();
    dragCleanup.current = null;
  };

  const cancelDrag = (event?: React.PointerEvent) => {
    if (event && dragRef.current && event.pointerId !== dragRef.current.pointerId) return;
    // Distinct from commit: nothing reaches the document or history.
    const drag = dragRef.current;
    try { drag?.capture?.releasePointerCapture?.(drag.pointerId); } catch { /* jsdom */ }
    dragRef.current = null;
    teardownDrag();
    setDragPreview(null);
    onGestureEnd?.();
  };

  // An unmount during a drag must dispose the transaction, never commit later.
  useEffect(() => () => { cancelDrag(); }, []);
  useEffect(() => { if (!editingEnabled) cancelDrag(); }, [editingEnabled]);

  const beginDrag = (note: NotationDocument['performance'][number], event: React.PointerEvent, forced: GestureAxis | null) => {
    if (addMode) { onGhostPlace?.(note.onset + effectiveOffset, note.pitch); return; }
    if (event.button !== 0) return;
    if (dragRef.current && dragRef.current.pointerId !== event.pointerId) return;
    // On touch, the first contact selects; a drag starts only on the selected note,
    // so a pan or an exploratory tap cannot alter a note.
    if (event.pointerType === 'touch' && selectedOccurrenceId !== note.id) { onSelect(note.id); return; }
    if (!editingEnabled) { onSelect(note.id); return; }
    event.preventDefault();
    teardownDrag();
    const capture = event.currentTarget as Element;
    try { capture.setPointerCapture?.(event.pointerId); } catch { /* jsdom */ }
    onGestureStart?.();
    dragRef.current = {
      note, startX: event.clientX, startY: event.clientY, forced, pointerId: event.pointerId,
      capture, axis: null, pitch: note.pitch, onset: note.onset, duration: note.duration ?? 0.25,
      string: stringOf(note),
    };
    onSelect(note.id);

    const owns = (incoming: PointerEvent) => dragRef.current?.pointerId === incoming.pointerId;
    const onMove = (moveEvent: PointerEvent) => { if (owns(moveEvent)) moveDrag(moveEvent as unknown as React.PointerEvent); };
    const onUp = (upEvent: PointerEvent) => { if (owns(upEvent)) commitDrag(upEvent as unknown as React.PointerEvent); };
    const onCancel = (cancelEvent: PointerEvent) => { if (owns(cancelEvent)) cancelDrag(); };
    const onLost = (lostEvent: PointerEvent) => { if (owns(lostEvent) || !lostEvent.pointerId) cancelDrag(); };
    globalThis.window.addEventListener('pointermove', onMove);
    globalThis.window.addEventListener('pointerup', onUp);
    globalThis.window.addEventListener('pointercancel', onCancel);
    capture.addEventListener('lostpointercapture', onLost as EventListener);
    dragCleanup.current = () => {
      globalThis.window.removeEventListener('pointermove', onMove);
      globalThis.window.removeEventListener('pointerup', onUp);
      globalThis.window.removeEventListener('pointercancel', onCancel);
      capture.removeEventListener('lostpointercapture', onLost as EventListener);
    };
  };

  const moveDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const axis = drag.axis ?? resolveAxis(dx, dy, 5, drag.forced);
    if (!axis) return;
    drag.axis = axis;
    if (axis === 'pitch') {
      if (stringsMode) {
        // Vertical motion between the six lanes reassigns the string, keeping pitch.
        const nextString = Math.max(1, Math.min(6, drag.string + Math.round(dy / rowHeight)));
        if (nextString !== drag.string) {
          drag.string = nextString;
          const fret = drag.note.pitch - (openStringPitch(nextString, setup) ?? drag.note.pitch);
          const now = Date.now();
          if (fret >= 0 && fret <= 24 && now - auditionAt.current > 120) {
            auditionAt.current = now;
            onAuditionPitch?.(drag.note.pitch);
          }
        }
      } else {
        const pitch = pitchFromDrag(drag.note.pitch, dy, rowHeight);
        if (pitch !== drag.pitch) {
          drag.pitch = pitch;
          const now = Date.now();
          if (now - auditionAt.current > 120) { auditionAt.current = now; onAuditionPitch?.(pitch); }
        }
      }
    } else if (axis === 'time' && layout && alignment) {
      const originalX = xAtEffective(drag.note.onset + effectiveOffset);
      const candidateEffective = layout.xToSourceSeconds(originalX + dx - gutter, alignment, 0);
      if (heldPassageAt(alignment, candidateEffective)) return;
      const candidate = candidateEffective - effectiveOffset;
      const snapped = snapSeconds ? Math.round(candidate / snapSeconds) * snapSeconds : candidate;
      drag.onset = Math.max(0, Math.min(document.duration, snapped));
    } else if (axis === 'resize' && layout && alignment) {
      const onsetX = xAtEffective(drag.note.onset + effectiveOffset);
      const endX = xAtEffective(drag.note.onset + effectiveOffset + (drag.note.duration ?? 0.25));
      const end = layout.xToSourceSeconds(endX + dx - gutter, alignment, 0);
      const onset = layout.xToSourceSeconds(onsetX - gutter, alignment, 0);
      if (heldPassageAt(alignment, end)) return;
      const candidate = Math.max(0.02, end - onset);
      drag.duration = snapSeconds ? Math.max(snapSeconds, Math.round(candidate / snapSeconds) * snapSeconds) : candidate;
    } else if (axis === 'time') {
      drag.onset = Math.max(0, document.performance.find(item => item.id === drag.note.id)!.onset + dx / pps);
    } else {
      drag.duration = Math.max(0.02, (drag.note.duration ?? 0.25) + dx / pps);
    }
    setDragPreview({id: drag.note.id, pitch: drag.pitch, onset: drag.onset, duration: drag.duration, axis, string: drag.string});
  };

  const commitDrag = (event: React.PointerEvent) => {
    if (!editingEnabled) { cancelDrag(event); return; }
    const drag = dragRef.current;
    if (drag && event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    teardownDrag();
    setDragPreview(null);
    try { drag?.capture?.releasePointerCapture?.(event.pointerId); } catch { /* jsdom */ }
    onGestureEnd?.();
    if (!drag || !drag.axis) return;
    if (stringsMode && drag.axis === 'pitch') {
      if (drag.string === stringOf(drag.note)) return;
      const fret = drag.note.pitch - (openStringPitch(drag.string, setup) ?? drag.note.pitch);
      if (fret < 0 || fret > 24) return;
      onGestureCommit?.({kind: 'position', occurrenceId: drag.note.id, string: drag.string, fret});
    } else if (drag.axis === 'pitch' && drag.pitch !== drag.note.pitch) {
      onGestureCommit?.({kind: 'pitch', occurrenceId: drag.note.id, pitch: drag.pitch});
    } else if (drag.axis === 'time' && Math.abs(drag.onset - drag.note.onset) > 1e-9) {
      onGestureCommit?.({kind: 'time', occurrenceId: drag.note.id, seconds: drag.onset});
    } else if (drag.axis === 'resize' && Math.abs(drag.duration - (drag.note.duration ?? 0.25)) > 1e-9) {
      onGestureCommit?.({kind: 'resize', occurrenceId: drag.note.id, durationSeconds: drag.duration});
    }
  };

  useEffect(() => {
    if (!dragPreview) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelDrag(); };
    globalThis.window.addEventListener('keydown', onKey);
    return () => globalThis.window.removeEventListener('keydown', onKey);
  }, [dragPreview]);

  const placeGhost = (event: React.PointerEvent<Element>) => {
    if (!addMode) return;
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const seconds = shared && layout && alignment
      ? Math.max(0, Math.min(document.duration,
        layout.xToSourceSeconds(Math.max(0, x - gutter), alignment, 0) - effectiveOffset))
      : Math.max(0, Math.min(document.duration, x / pps));
    const pitch = stringsMode
      ? (openStringPitch(Math.max(1, Math.min(6, 1 + Math.floor(py / rowHeight))), setup) ?? 60)
      : Math.max(0, Math.min(127, high - Math.floor(py / rowHeight)));
    onGhostPlace?.(Math.round(seconds * 1e3) / 1e3, pitch);
  };

  const handleScroll = () => {
    const node = element;
    if (!node) return;
    setLabelOffset(node.scrollTop);
  };

  const seekFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const node = element;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = node.scrollLeft + event.clientX - rect.left;
    if (layout && alignment) onSeek(layout.xToSourceSeconds(x - gutter, alignment, 0));
    else onSeek(clamp(x / pps, 0, document.duration));
  };

  return <div className="ws-roll">
    <div className="ws-roll-gutter" style={{width: LABEL_WIDTH}}>
      <div className="ws-roll-corner" style={{height: RULER_HEIGHT}}>
        {stringsMode && <span className="ws-roll-capo-badge" data-capo-badge={setup.capo}>
          {setup.capo > 0 ? `Capo ${setup.capo}` : 'No capo'}
        </span>}
      </div>
      <div className="ws-roll-label-viewport" style={{height: PLOT_HEIGHT}}>
        <div className="ws-roll-label-canvas" style={{height: pitchHeight, transform: `translateY(${-labelOffset}px)`}}>
          {stringsMode
            ? stringLabels.map((label, index) => <span key={index + 1} style={{top: yString(index + 1) - 7}}
                data-string-lane={index + 1}>{index + 1}: {label}</span>)
            : Array.from({length: rows}, (_, index) => high - index)
              .filter(pitch => pitch % 12 === 0)
              .map(pitch => <span key={pitch} style={{top: y(pitch) - 7}}>{pitchName(pitch)}</span>)}
        </div>
      </div>
    </div>
    <div className="ws-roll-viewport" ref={viewportRef} onScroll={handleScroll}
      style={{height: RULER_HEIGHT + PLOT_HEIGHT}} tabIndex={0}
      data-row-mode={rowMode} data-tuning={setup.tuning} data-capo={setup.capo}
      aria-label={`${stringsMode ? 'Guitar 6-string roll' : 'Piano roll'}, ${window.span.toFixed(0)} seconds from ${window.start.toFixed(1)} seconds${scrollable ? ', scrollable pitch range' : ''}`}>
      <div className="ws-roll-content" style={{width: totalWidth}}>
        <div className="ws-roll-ruler" style={{height: RULER_HEIGHT}} onClick={seekFromEvent}>
          {ticks.map(tick => <span key={tick} className="ws-roll-tick-label" style={{left: xForTick(tick) + 4}}>{shared && layout && alignment ? formatSeconds(layout.xToSourceSeconds(xForTick(tick) - gutter, alignment, 0)) : formatSeconds(tick)}</span>)}
        </div>
        <svg className="ws-roll-svg" width={totalWidth} height={pitchHeight} role="img"
          data-roll-window-start={window.start} data-roll-window-span={window.span}
          aria-label={`Piano roll, ${visibleNotes.length} notes visible`}
          data-culled-notes={visibleNotes.length} data-total-notes={document.performance.length}
          data-pitch-height={Math.round(pitchHeight)} data-plot-height={PLOT_HEIGHT}>
          {addMode ? <rect className="ws-roll-add-layer" x={0} y={0} width={totalWidth} height={pitchHeight}
            onPointerDown={placeGhost} aria-label="Add note position"/> : null}
          {ticks.map(tick => <line key={tick} className="ws-roll-grid" x1={xForTick(tick)} y1={0} x2={xForTick(tick)} y2={pitchHeight}/>)}
          {stringsMode
            ? stringLabels.map((_, index) => <line key={`string-${index + 1}`} className="ws-roll-string"
                data-string-line={index + 1} x1={0} y1={yString(index + 1)} x2={totalWidth} y2={yString(index + 1)}/>)
            : Array.from({length: rows}, (_, index) => high - index).filter(pitch => pitch % 12 === 0).map(pitch =>
              <line key={`row-${pitch}`} className="ws-roll-octave" x1={0} y1={y(pitch)} x2={totalWidth} y2={y(pitch)}/>)}
          {visibleNotes.map(note => {
            const preview = dragPreview?.id === note.id ? dragPreview : null;
            const pitch = preview?.pitch ?? note.pitch;
            const onset = preview?.onset ?? note.onset;
            const seconds = preview?.duration ?? (note.duration ?? 0.25);
            const left = shared && layout && alignment
              ? gutter + layout.sourceSecondsToX(onset + effectiveOffset, alignment, 0)
              : (onset + effectiveOffset) * pps;
            const right = shared && layout && alignment
              ? gutter + layout.sourceSecondsToX(onset + effectiveOffset + seconds, alignment, 0)
              : (onset + effectiveOffset + seconds) * pps;
            const noteWidth = Math.max(2, right - left - 1);
            const selected = selectedOccurrenceId === note.id;
            const active = liveActive.includes(note.id);
            const dragging = preview !== null;
            const invalid = dragging && (preview!.axis === 'resize' && seconds < 0.02 || pitch < 0 || pitch > 127);
            const previewString = preview?.string ?? null;
            const storedString = previewString ?? note.string;
            const storedFret = previewString !== null
              ? pitch - (openStringPitch(previewString, setup) ?? pitch)
              : note.fret;
            const position = stringsMode
              ? resolveGuitarPosition(pitch, storedString ?? null, storedFret ?? null, setup)
              : null;
            const unplayable = stringsMode && position === null;
            const noteString = position?.string ?? 6;
            const fret = position?.fret ?? null;
            const top = stringsMode ? yString(noteString) - rowHeight / 2 : y(pitch) - rowHeight / 2;
            const finger: GuitarFinger = position ? (fingerMap[note.id] ?? 0) : 0;
            const fingerColor = GUITAR_FINGER_PALETTE[finger].color;
            const fingerLabel = GUITAR_FINGER_PALETTE[finger].label;
            const fingerText = finger === 0 ? 'Open' : `F${finger}`;
            return <g key={note.id}>
              <rect className={`ws-roll-note${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}${invalid ? ' is-invalid' : ''}${stringsMode ? ` ws-roll-bar-finger-${finger}` : ''}${unplayable ? ' ws-roll-bar-unplayable' : ''}`}
                x={left} y={top} width={noteWidth} height={Math.max(3, rowHeight - 1)} rx={2}
                data-occurrence={note.id} data-pitch={note.pitch} data-preview-pitch={preview?.pitch ?? undefined}
                data-guitar-string={stringsMode ? noteString : undefined}
                data-finger={stringsMode && position ? String(finger) : undefined}
                data-finger-color={stringsMode && position ? fingerColor : undefined}
                data-unplayable={unplayable ? 'true' : undefined}
                style={stringsMode ? {fill: unplayable ? '#94a3b8' : fingerColor} : undefined}
                data-fret={stringsMode && position ? position.fret : undefined}
                data-drag-axis={preview?.axis ?? undefined} role="button" tabIndex={0}
                aria-label={stringsMode
                  ? (unplayable
                    ? `Unplayable ${pitchName(pitch)} under this tuning and capo, at ${onset.toFixed(2)} seconds`
                    : `String ${noteString}, fret ${fret}, finger ${finger} (${fingerLabel}), at ${onset.toFixed(2)} seconds${selected ? ', selected' : ''}`)
                  : `${pitchName(pitch)} at ${onset.toFixed(2)} seconds${selected ? ', selected' : ''}`}
                onPointerDown={event => beginDrag(note, event, null)}
                onPointerMove={moveDrag}
                onPointerUp={commitDrag}
                onPointerCancel={cancelDrag}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(note.id); } }}>
                <title>{stringsMode
                  ? (unplayable
                    ? `${pitchName(pitch)} · unplayable under this tuning/capo · ${onset.toFixed(2)} s`
                    : `${pitchName(pitch)} · string ${noteString}, fret ${fret} · finger ${finger} (${fingerLabel}) · ${onset.toFixed(2)} s`)
                  : `${pitchName(pitch)} · ${onset.toFixed(2)} s · ${seconds.toFixed(2)} s`}</title>
              </rect>
              {stringsMode && position
                ? <text className="ws-roll-fret" data-fret-label={position.fret}
                    data-finger-label={`${finger}:${fingerLabel}`}
                    x={left + 4} y={top + rowHeight / 2 + 4} pointerEvents="none">
                    {position.fret} · {fingerText}
                  </text>
                : null}
              {stringsMode && unplayable
                ? <text className="ws-roll-fret is-unplayable" data-unplayable-label="true"
                    x={left + 4} y={top + rowHeight / 2 + 4} pointerEvents="none">✕</text>
                : null}
              {selected ? <>
                <rect className="ws-roll-handle" data-handle="time" x={left - 3} y={top} width={6}
                  height={Math.max(3, rowHeight - 1)} rx={1}
                  aria-label="Move start"
                  onPointerDown={event => { event.stopPropagation(); beginDrag(note, event, 'time'); }}
                  onPointerMove={moveDrag} onPointerUp={commitDrag} onPointerCancel={cancelDrag}/>
                <rect className="ws-roll-handle" data-handle="resize" x={left + noteWidth - 3} y={top} width={6}
                  height={Math.max(3, rowHeight - 1)} rx={1}
                  aria-label="Resize recorded length"
                  onPointerDown={event => { event.stopPropagation(); beginDrag(note, event, 'resize'); }}
                  onPointerMove={moveDrag} onPointerUp={commitDrag} onPointerCancel={cancelDrag}/>
              </> : null}
            </g>;
          })}
          {ghost ? (() => {
            const ghostLeft = shared && layout && alignment
              ? gutter + layout.sourceSecondsToX(ghost.seconds + effectiveOffset, alignment, 0)
              : (ghost.seconds + effectiveOffset) * pps;
            const clash = document.performance.some(note => note.pitch === ghost.pitch && Math.abs(note.onset - ghost.seconds) < 0.001);
            const invalid = Boolean(ghost.invalid) || clash;
            return <rect className={`ws-roll-ghost${invalid ? ' is-invalid' : ''}`} data-ghost="true"
              data-ghost-invalid={invalid ? 'true' : 'false'}
              x={ghostLeft} y={y(ghost.pitch) - rowHeight / 2}
              width={Math.max(4, shared && layout && alignment
                ? gutter + layout.sourceSecondsToX(ghost.seconds + effectiveOffset + (ghost.durationSeconds ?? 0.25), alignment, 0) - ghostLeft
                : (ghost.durationSeconds ?? 0.25) * pps)} height={Math.max(3, rowHeight - 1)} rx={2}
              aria-label={`New note ${pitchName(ghost.pitch)} at ${ghost.seconds.toFixed(2)} seconds`}/>;
          })() : null}
          {cursorX !== null || cursorFallbackSeconds !== null ? <RollCursorLine
            clock={clock} fallback={cursorFallbackSeconds} cursorX={cursorX}
            layout={layout} alignment={alignment} gutter={gutter} pitchHeight={pitchHeight}/> : null}
        </svg>
      </div>
    </div>
  </div>;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? `${value}s` : `${value.toFixed(2)}s`;
}
