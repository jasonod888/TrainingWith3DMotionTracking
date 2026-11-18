/**
 * Phase 3 continuous score strip: one horizontally scrollable grand staff that renders
 * only the visible measures (plus a buffer), keeps clef/key/time context pinned, and
 * draws each written value distinctly (hollow vs filled heads, stems, flag counts,
 * augmentation dots and duration-specific rests).
 *
 * Scrolling moves the strip only; it never seeks or mutates the document. Clicking a
 * notehead selects its occurrence, refusing to guess when a written note maps several.
 * The score playhead and beat-linked scrolling belong to Phase 4.
 */
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {TimelineLayout} from './timeline-layout';
import {displayAccidental, keySignature as sharedKeySignature, parseSpelling, type NotationDocument, type NotationSegment, type NotationValue}
  from '../../../../../packages/music-notation/index.ts';
import {
  SCORE_CONTEXT_WIDTH as CONTEXT_WIDTH, measureAtTick, scrollForMeasure, tickAtX,
  visibleMeasureIndexes, xForTick, type MeasureBox,
} from './viewport';
import {useElementWidth} from './useElementWidth';
import {useClockTime, type ClockStore} from './clock';
import type {Alignment} from '../../../../../packages/music-notation/index.ts';
import {diatonicStep, type GestureEdit} from './gestures';
import {
  GUITAR_TUNINGS, normalizeGuitarSetup, openStringPitch, resolveGuitarPosition,
  type GuitarTuningId,
} from '../../../../../packages/music-notation/guitar.ts';
import {strumPatternFor} from './GuitarChordStrumHud';

const RULER_HEIGHT = 22;
const LINE = 10;
const TREBLE_TOP = 34;
const TREBLE_BOTTOM = 74;
const BASS_TOP = 116;
const BASS_BOTTOM = 156;
const HEIGHT = RULER_HEIGHT + 162;

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const REST_GLYPHS: Record<NotationValue, string> = {
  whole: '𝄻', half: '𝄼', quarter: '𝄽', eighth: '𝄾', sixteenth: '𝄿',
  thirtysecond: '𝄿', sixtyfourth: '𝄿',
};
const FLAGS: Partial<Record<NotationValue, number>> = {
  eighth: 1, sixteenth: 2, thirtysecond: 3, sixtyfourth: 4,
};

function yForNote(staff: 'treble' | 'bass', spelling: string): number {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(spelling);
  if (!match) return staff === 'treble' ? TREBLE_BOTTOM : BASS_BOTTOM;
  const index = Number(match[3]) * 7 + LETTERS.indexOf(match[1]);
  if (staff === 'treble') return TREBLE_BOTTOM - (index - 30) * (LINE / 2);
  return BASS_BOTTOM - (index - 18) * (LINE / 2);
}

function ledgerLines(y: number, top: number, bottom: number): number[] {
  const lines: number[] = [];
  for (let value = top - LINE; value >= y - 0.5; value -= LINE) lines.push(value);
  for (let value = bottom + LINE; value <= y + 0.5; value += LINE) lines.push(value);
  return lines;
}

export type ScoreReveal = { tick: number; token: number };
export type ScoreScrollTarget = { tick: number; token: number };

type Props = {
  document: NotationDocument;
  boxes: MeasureBox[];
  selectedOccurrenceId: string | null;
  /** A navigation request performed once per token. */
  reveal: ScoreReveal | null;
  /** Score cursor position from the shared source clock (Phase 4). */
  playheadTick?: number | null;
  /** Frame-rate visual clock and the map used to place the cursor. */
  clock?: ClockStore | null;
  alignment?: Alignment | null;
  offsetSeconds?: number;
  intervals?: { id: string; start: number; end: number }[];
  /** Occurrences sounding at the current source time. */
  activeOccurrenceIds?: string[];
  /** Shared correction timeline geometry; suppresses independent scroll/cursor. */
  layout?: TimelineLayout;
  sharedScrollLeft?: number;
  cursorX?: number | null;
  /** Frame-driven fallback seconds for the internal cursor leaf. */
  cursorFallbackSeconds?: number | null;
  /** Linked-navigation target from the roll or playback, performed once per token. */
  scrollTarget?: ScoreScrollTarget | null;
  onSelect: (occurrenceId: string) => void;
  /** Called instead of guessing when one written note maps several occurrences. */
  onAmbiguous?: (logicalNoteId: string, occurrenceIds: string[]) => void;
  /** A ruler click maps back to source time; scrolling never does. */
  onSeekTick?: (tick: number) => void;
  /** Reports the tick at the left edge when the user scrolls the strip. */
  onUserScroll?: (tickAtLeft: number) => void;
  /** One committed drag becomes one edit. */
  onGestureCommit?: (edit: GestureEdit) => void;
  onAuditionPitch?: (pitch: number) => void;
  /** Replace/Add modes disable direct manipulation in this surface. */
  editingEnabled?: boolean;
  /** Guitar renders a 6-line TAB staff instead of (or beside) the grand staff. */
  staffMode?: 'grand' | 'guitar-tab' | 'guitar-both';
  /** Reviewed chord shapes drawn above the measure with their strum arrows. */
  guitarChords?: {id: string; name: string; start: number}[];
  tuning?: GuitarTuningId;
  capo?: number;
};

function ScoreCursorLine({clock, fallback, cursorX, playheadTick, layout, alignment}: {
  clock?: ClockStore | null;
  fallback: number | null;
  cursorX: number | null;
  playheadTick: number | null;
  layout?: TimelineLayout;
  alignment?: Alignment | null;
}) {
  const time = useClockTime(clock, fallback ?? 0);
  const x = cursorX !== null ? cursorX
    : layout && alignment ? 116 + layout.sourceSecondsToX(time, alignment, 0) : 0;
  return <line className="ws-shared-surface-cursor ws-score-playhead" data-shared-cursor
    data-playhead-tick={playheadTick ?? ''} x1={x} y1={RULER_HEIGHT} x2={x} y2={HEIGHT - 10}/>;
}

const SHARP_ORDER = [
  {letter: 'F', treble: 5, bass: 3}, {letter: 'C', treble: 5, bass: 3},
  {letter: 'G', treble: 5, bass: 3}, {letter: 'D', treble: 5, bass: 3},
  {letter: 'A', treble: 4, bass: 2}, {letter: 'E', treble: 5, bass: 3},
  {letter: 'B', treble: 4, bass: 2},
];
const FLAT_ORDER = [
  {letter: 'B', treble: 4, bass: 2}, {letter: 'E', treble: 5, bass: 3},
  {letter: 'A', treble: 4, bass: 2}, {letter: 'D', treble: 5, bass: 3},
  {letter: 'G', treble: 4, bass: 2}, {letter: 'C', treble: 5, bass: 3},
  {letter: 'F', treble: 4, bass: 2},
];

function renderedKeySignature(key: string) {
  const signature = sharedKeySignature(key || 'C');
  const count = Math.abs(signature.fifths);
  return {
    glyph: signature.fifths > 0 ? '♯' : signature.fifths < 0 ? '♭' : '',
    entries: signature.fifths > 0 ? SHARP_ORDER.slice(0, count)
      : signature.fifths < 0 ? FLAT_ORDER.slice(0, count) : [],
  };
}

export function ContinuousScore({
  document, boxes, selectedOccurrenceId, reveal, playheadTick = null, activeOccurrenceIds = [],
  scrollTarget = null, onSelect, onAmbiguous, onSeekTick, onUserScroll,
  clock = null, alignment = null, offsetSeconds = 0, intervals,
  onGestureCommit, onAuditionPitch, editingEnabled = true, layout, sharedScrollLeft = 0, cursorX = null,
  cursorFallbackSeconds = null, staffMode = 'grand', guitarChords = [], tuning, capo = 0,
}: Props) {
  const setup = normalizeGuitarSetup({tuning, capo});
  const stringLabels = GUITAR_TUNINGS[setup.tuning].stringLabels;
  const tab = staffMode !== 'grand';
  const tabOnly = staffMode === 'guitar-tab';
  // Guitar-both keeps the treble staff and fits a compact TAB below it; TAB-only
  // centres the six lines in the same measure boxes.
  const tabTop = tabOnly ? 62 : 104;
  const tabSpacing = tabOnly ? 16 : 8;
  const tabBottom = tabTop + 5 * tabSpacing;
  const staffTopFor = (segment: NotationSegment) => tab
    ? tabTop
    : segment.staff === 'treble' ? TREBLE_TOP : BASS_TOP;
  const staffBottomFor = (segment: NotationSegment) => tab
    ? tabBottom
    : segment.staff === 'treble' ? TREBLE_BOTTOM : BASS_BOTTOM;
  const tabY = (string: number) => tabTop + (string - 1) * tabSpacing;
  const secondsPerTick = document.tempo.bpm > 0 ? 60 / (document.tempo.bpm * document.ppq) : 0.0625;
  const stringFor = (pitch: number, occurrenceIds: string[]): {string: number; fret: number} | null => {
    let storedString: number | null = null;
    let storedFret: number | null = null;
    for (const id of occurrenceIds) {
      const occurrence = document.performance.find(note => note.id === id);
      if (occurrence && occurrence.string != null && occurrence.fret != null
        && (openStringPitch(occurrence.string, setup) ?? Number.NaN) + occurrence.fret === pitch) {
        storedString = occurrence.string;
        storedFret = occurrence.fret;
        break;
      }
    }
    return resolveGuitarPosition(pitch, storedString, storedFret, setup);
  };
  const liveTick = playheadTick;
  const liveActive = activeOccurrenceIds;
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const programmatic = useRef(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [first, last] = visibleMeasureIndexes(boxes, scrollLeft, width);
  const totalWidth = boxes.length ? boxes[boxes.length - 1].x + boxes[boxes.length - 1].width : 0;
  const shared = Boolean(layout);
  const sharedBoxes = layout ? layout.measures.map(measure => ({index: measure.index, x: measure.x,
    width: measure.width, ticks: measure.endTick - measure.startTick})) : boxes;
  const activeTotalWidth = layout ? layout.contentWidth : totalWidth;
  const canvasWidth = CONTEXT_WIDTH + activeTotalWidth + 24;
  const xForSharedTick = (tick: number) => layout ? CONTEXT_WIDTH + layout.tickToX(tick) : xForTick(sharedBoxes, document, tick);
  const xForSegment = (segment: NotationSegment) => layout
    ? CONTEXT_WIDTH + layout.tickToX(segment.start) + 14
    : CONTEXT_WIDTH + (sharedBoxes[segment.measure_index]?.x ?? 0) + 14
      + ((segment.start - document.measures[segment.measure_index].start) / document.measures[segment.measure_index].duration)
        * ((sharedBoxes[segment.measure_index]?.width ?? 0) - 28);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      // Shared mode writes this viewport directly at 60 fps for follow-scroll.
      // Its local scroll state is only used by independent virtualization.
      if (!layout) setScrollLeft(element.scrollLeft);
      if (programmatic.current || !onUserScroll) return;
      onUserScroll(tickAtX(boxes, document, element.scrollLeft + CONTEXT_WIDTH + 4));
    };
    if (!layout) setScrollLeft(element.scrollLeft);
    element.addEventListener('scroll', update, {passive: true});
    return () => element.removeEventListener('scroll', update);
  }, [width, boxes, document, onUserScroll, layout]);

  // Reveal once per token: panning or editing must not pull the strip back.
  useEffect(() => {
    if (!reveal) return;
    const element = scrollRef.current;
    if (!element) return;
    const index = measureAtTick(boxes, document, reveal.tick);
    const target = scrollForMeasure(boxes, index, Math.max(120, width), element.scrollLeft);
    if (Math.abs(target - element.scrollLeft) > 1) {
      programmatic.current = true;
      element.scrollLeft = target;
      requestAnimationFrame(() => { programmatic.current = false; });
    }
    // Keyed on the token only.
  }, [reveal?.token]);

  // Linked navigation: roll scrolling or playback moves the strip once per token.
  useEffect(() => {
    if (!scrollTarget) return;
    const element = scrollRef.current;
    if (!element) return;
    const target = Math.max(0, xForTick(boxes, document, scrollTarget.tick) - CONTEXT_WIDTH - 24);
    if (Math.abs(target - element.scrollLeft) <= 1) return;
    programmatic.current = true;
    element.scrollLeft = target;
    requestAnimationFrame(() => { programmatic.current = false; });
    // Keyed on the token only.
  }, [scrollTarget?.token]);

  const sheetDrag = useRef<{occurrence: string; startY: number; spelling: string; pitch: number; steps: number;
    pointerId: number; capture: Element | null} | null>(null);
  const sheetCleanup = useRef<(() => void) | null>(null);
  const sheetAudition = useRef(0);
  const [sheetPreview, setSheetPreview] = useState<{occurrence: string; spelling: string; pitch: number; steps: number} | null>(null);

  const beginSheetDrag = (note: {logical_note_id: string; performance_ids: string[]; spelling: string}, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // A second pointer must not replace an active transaction.
    if (sheetDrag.current && sheetDrag.current.pointerId !== event.pointerId) return;
    const occurrence = occurrenceFor(note);
    if (!occurrence) { choose(note); return; }
    if (event.pointerType === 'touch' && selectedOccurrenceId !== occurrence) { choose(note); return; }
    event.preventDefault();
    if (!editingEnabled) { choose(note); return; }
    const capture = event.currentTarget as Element;
    try { capture.setPointerCapture?.(event.pointerId); } catch { /* jsdom */ }
    const pitch = document.performance.find(item => item.id === occurrence)?.pitch ?? 60;
    sheetDrag.current = {occurrence, startY: event.clientY, spelling: note.spelling, pitch, steps: 0,
      pointerId: event.pointerId, capture};
    choose(note);
    sheetCleanup.current?.();
    const owns = (incoming: PointerEvent) => sheetDrag.current?.pointerId === incoming.pointerId;
    const onMove = (moveEvent: PointerEvent) => { if (owns(moveEvent)) moveSheetDrag(moveEvent as unknown as React.PointerEvent); };
    const onUp = (upEvent: PointerEvent) => { if (owns(upEvent)) commitSheetDrag(upEvent as unknown as React.PointerEvent); };
    const onCancel = (cancelEvent: PointerEvent) => { if (owns(cancelEvent)) cancelSheetDrag(); };
    const onLost = (lostEvent: PointerEvent) => { if (owns(lostEvent) || !lostEvent.pointerId) cancelSheetDrag(); };
    globalThis.window.addEventListener('pointermove', onMove);
    globalThis.window.addEventListener('pointerup', onUp);
    globalThis.window.addEventListener('pointercancel', onCancel);
    capture.addEventListener('lostpointercapture', onLost as EventListener);
    sheetCleanup.current = () => {
      globalThis.window.removeEventListener('pointermove', onMove);
      globalThis.window.removeEventListener('pointerup', onUp);
      globalThis.window.removeEventListener('pointercancel', onCancel);
      capture.removeEventListener('lostpointercapture', onLost as EventListener);
    };
  };

  const moveSheetDrag = (event: React.PointerEvent) => {
    const drag = sheetDrag.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    // Pointer pixels → SVG units, then one diatonic step per line or space.
    const svg = (drag.capture as SVGElement | null)?.ownerSVGElement;
    const rect = svg?.getBoundingClientRect();
    const scale = rect && rect.height > 0 ? HEIGHT / rect.height : 1;
    const dy = (event.clientY - drag.startY) * scale;
    const steps = -Math.round(dy / (LINE / 2));
    if (steps === 0) {
      drag.steps = 0;
      setSheetPreview(null);
      return;
    }
    if (steps === drag.steps) return;
    drag.steps = steps;
    const next = diatonicStep(drag.spelling, steps, document.key_signature);
    const now = Date.now();
    if (now - sheetAudition.current > 120) { sheetAudition.current = now; onAuditionPitch?.(next.pitch); }
    setSheetPreview({occurrence: drag.occurrence, spelling: next.spelling, pitch: next.pitch, steps});
  };

  const commitSheetDrag = (event: React.PointerEvent) => {
    if (!editingEnabled) { cancelSheetDrag(event); return; }
    const drag = sheetDrag.current;
    // A foreign pointer cannot finish (or cancel) someone else's drag.
    if (drag && event.pointerId !== drag.pointerId) return;
    sheetDrag.current = null;
    sheetCleanup.current?.();
    sheetCleanup.current = null;
    setSheetPreview(null);
    try { drag?.capture?.releasePointerCapture?.(event.pointerId); } catch { /* jsdom */ }
    if (!drag || drag.steps === 0) return;
    const next = diatonicStep(drag.spelling, drag.steps, document.key_signature);
    onGestureCommit?.({kind: 'pitch', occurrenceId: drag.occurrence, pitch: next.pitch, spelling: next.spelling});
  };

  const cancelSheetDrag = (event?: React.PointerEvent) => {
    if (event && sheetDrag.current && event.pointerId !== sheetDrag.current.pointerId) return;
    const drag = sheetDrag.current;
    try { drag?.capture?.releasePointerCapture?.(drag.pointerId); } catch { /* jsdom */ }
    sheetDrag.current = null;
    sheetCleanup.current?.();
    sheetCleanup.current = null;
    setSheetPreview(null);
  };

  // Unmounting disposes the transaction; nothing can commit afterwards.
  useEffect(() => () => { cancelSheetDrag(); }, []);
  useEffect(() => { if (!editingEnabled) cancelSheetDrag(); }, [editingEnabled]);

  useEffect(() => {
    if (!sheetPreview) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelSheetDrag(); };
    globalThis.window.addEventListener('keydown', onKey);
    return () => globalThis.window.removeEventListener('keydown', onKey);
  }, [sheetPreview]);

  const visibleSegments = useMemo(() => {
    if (layout) return document.segments;
    if (last < first) return [] as NotationSegment[];
    return document.segments.filter(segment => segment.measure_index >= first && segment.measure_index <= last);
  }, [document.segments, first, last, layout]);

  // Positions of the rendered noteheads, so ties are drawn only when both ends exist.
  const positions = useMemo(() => {
    const map = new Map<string, {x: number; y: number}>();
    for (const segment of visibleSegments) {
      if (segment.rest) continue;
      const x = xForSegment(segment);
      for (const note of segment.notes) {
        const preview = sheetPreview && note.performance_ids.includes(sheetPreview.occurrence) ? sheetPreview : null;
        map.set(note.id, {x, y: yForNote(segment.staff, preview ? preview.spelling : note.spelling)});
      }
    }
    return map;
  }, [visibleSegments, boxes, document.measures, sheetPreview, layout]);

  const occurrenceFor = (note: {logical_note_id: string; performance_ids: string[]}): string | null => {
    if (note.performance_ids.length === 1) return note.performance_ids[0];
    if (selectedOccurrenceId && note.performance_ids.includes(selectedOccurrenceId)) return selectedOccurrenceId;
    return null;
  };

  const choose = (note: {logical_note_id: string; performance_ids: string[]}) => {
    const occurrence = occurrenceFor(note);
    if (occurrence) { onSelect(occurrence); return; }
    if (note.performance_ids.length > 1) onAmbiguous?.(note.logical_note_id, note.performance_ids);
  };

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !layout) return;
    if (Math.abs(node.scrollLeft - sharedScrollLeft) > 0.5) node.scrollLeft = sharedScrollLeft;
  }, [layout, sharedScrollLeft]);
  const signature = renderedKeySignature(document.key_signature);
  return <div className="ws-score" ref={hostRef} style={{maxWidth: '100%', overflow: 'hidden', minWidth: 0}}>
    <div className="ws-score-viewport" ref={scrollRef} style={{maxWidth: '100%', width: '100%', overflowX: 'auto', minWidth: 0}}>
      <svg className="ws-score-svg" width={canvasWidth} height={HEIGHT} role="img"
        data-staff-mode={staffMode} data-tuning={setup.tuning} data-capo={setup.capo}
        aria-label={`Continuous ${tab ? 'guitar TAB' : 'grand'} staff, ${document.measures.length} measures, showing measures ${first + 1}-${Math.max(first + 1, last + 1)}`}
        data-rendered-measures={last >= first ? last - first + 1 : 0} data-total-measures={document.measures.length}
        data-rendered-notes={visibleSegments.reduce((total, segment) => total + segment.notes.length, 0)}
        data-rendered-values={JSON.stringify([...new Set(visibleSegments.map(segment => segment.value))])}>
        <rect className="ws-score-paper" x={0} y={0} width={canvasWidth} height={HEIGHT}/>
        <rect className="ws-score-ruler" x={CONTEXT_WIDTH} y={0} width={activeTotalWidth} height={RULER_HEIGHT}
          onClick={event => {
            if (!onSeekTick) return;
            const element = scrollRef.current;
            if (!element) return;
            const rect = element.getBoundingClientRect();
            const x = element.scrollLeft + (event.clientX - rect.left);
            onSeekTick(layout ? layout.xToTick(Math.max(0, x - CONTEXT_WIDTH)) : tickAtX(boxes, document, x));
          }}/>
        {cursorX !== null || cursorFallbackSeconds !== null ? <ScoreCursorLine
          clock={clock} fallback={cursorFallbackSeconds} cursorX={cursorX}
          playheadTick={playheadTick} layout={layout} alignment={alignment}/> : null}
        {liveTick !== null && !layout ? <line className="ws-score-playhead" data-playhead-tick={liveTick}
          x1={xForSharedTick(liveTick)} y1={RULER_HEIGHT}
          x2={xForSharedTick(liveTick)} y2={HEIGHT - 10}/> : null}
        {tab ? <>
          {!tabOnly && [0, 1, 2, 3, 4].map(line => <line key={`treble-${line}`} className="ws-score-staff"
            x1={CONTEXT_WIDTH} y1={TREBLE_TOP + line * LINE} x2={CONTEXT_WIDTH + activeTotalWidth} y2={TREBLE_TOP + line * LINE}/>)}
          {stringLabels.map((_, index) => <line key={`tab-${index + 1}`} className="ws-score-staff ws-score-tab-line"
            data-tab-string={index + 1} x1={CONTEXT_WIDTH} y1={tabY(index + 1)} x2={CONTEXT_WIDTH + activeTotalWidth} y2={tabY(index + 1)}/>)}
        </> : [0, 1, 2, 3, 4].map(line => <g key={`staff-${line}`}>
          <line className="ws-score-staff" x1={CONTEXT_WIDTH} y1={TREBLE_TOP + line * LINE} x2={CONTEXT_WIDTH + activeTotalWidth} y2={TREBLE_TOP + line * LINE}/>
          <line className="ws-score-staff" x1={CONTEXT_WIDTH} y1={BASS_TOP + line * LINE} x2={CONTEXT_WIDTH + activeTotalWidth} y2={BASS_TOP + line * LINE}/>
        </g>)}
        {(layout ? sharedBoxes : boxes.slice(first, last + 1)).map(box => <g key={`measure-${box.index}`} data-measure={box.index} className="ws-score-measure">
          <line className="ws-score-barline" x1={CONTEXT_WIDTH + box.x} y1={tab ? tabTop : TREBLE_TOP}
            x2={CONTEXT_WIDTH + box.x} y2={tab ? tabBottom : BASS_BOTTOM}/>
          <text className="ws-score-measure-number" x={CONTEXT_WIDTH + box.x + 6} y={RULER_HEIGHT - 6}>{box.index + 1}</text>
          {tab ? (() => {
            const measure = document.measures[box.index];
            const from = measure.start * secondsPerTick;
            const to = (measure.start + measure.duration) * secondsPerTick;
            const chords = guitarChords.filter(chord => chord.start >= from - 1e-6 && chord.start < to);
            const slots = strumPatternFor(document.performance.map(note => ({
              onset: note.onset, pitch: note.pitch, string: note.string,
            })), from, to, document.time_signature.numerator);
            const arrows = slots.map(slot => slot.direction === 'down' ? '↓' : slot.direction === 'up' ? '↑' : '').join(' ');
            return <>
              {chords.length ? <text className="ws-score-chord" x={CONTEXT_WIDTH + box.x + 6} y={Math.max(14, tabTop - 26)}>
                {chords.map(chord => chord.name).join(' · ')}
              </text> : null}
              <text className="ws-score-strum" x={CONTEXT_WIDTH + box.x + 6} y={Math.max(24, tabTop - 12)} data-strum={arrows}>{arrows}</text>
            </>;
          })() : null}
        </g>)}
        <line className="ws-score-barline" x1={CONTEXT_WIDTH + totalWidth} y1={tab ? tabTop : TREBLE_TOP}
          x2={CONTEXT_WIDTH + activeTotalWidth} y2={tab ? tabBottom : BASS_BOTTOM}/>
        {visibleSegments.map(segment => {
          const box = boxes[segment.measure_index];
          if (!box) return null;
          const measure = document.measures[segment.measure_index];
          const local = (segment.start - measure.start) / measure.duration;
          const x = xForSegment(segment);
          const staffTop = staffTopFor(segment);
          const staffBottom = staffBottomFor(segment);
          if (segment.rest) {
            const center = staffTop + LINE * 2;
            return <g key={segment.id} className="ws-score-rest" data-rest-value={segment.value}>
              <text className="ws-score-rest-glyph" x={x} y={center + 5} textAnchor="middle">{REST_GLYPHS[segment.value] ?? '𝄽'}</text>
              {segment.dotted ? <circle className="ws-score-dot" cx={x + 10} cy={center - 1} r={1.8}/> : null}
            </g>;
          }
          if (tab) {
            // TAB keeps the same segment x coordinates and selection semantics; only the
            // vertical mapping changes from pitch spelling to string/fret.
            return <g key={segment.id} className="ws-score-event" data-value={segment.value} data-tab-event="true">
              {segment.notes.map(note => {
                const occurrence = occurrenceFor(note);
                const position = stringFor(note.pitch, note.performance_ids);
                const selected = selectedOccurrenceId !== null && note.performance_ids.includes(selectedOccurrenceId);
                const active = liveActive.some(id => note.performance_ids.includes(id));
                const className = `ws-score-tab-fret${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`;
                const handlers = {
                  onPointerDown: (event: React.PointerEvent) => beginSheetDrag(note, event),
                  onPointerMove: moveSheetDrag,
                  onPointerUp: commitSheetDrag,
                  onPointerCancel: cancelSheetDrag,
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(note); }
                  },
                };
                if (!position) {
                  // Unplayable under this tuning/capo: never fake an open first string.
                  return <text key={note.id} className={`${className} is-unplayable`}
                    x={x} y={tabY(6) + 4} textAnchor="middle"
                    data-string={6} data-unplayable="true"
                    data-occurrence={occurrence ?? ''} data-occurrences={note.performance_ids.join(',')}
                    role="button" tabIndex={0}
                    aria-label={`Unplayable ${note.spelling} under this tuning and capo`}
                    {...handlers}>✕</text>;
                }
                return <text key={note.id} className={className}
                  x={x} y={tabY(position.string) + 4} textAnchor="middle"
                  data-string={position.string} data-fret={position.fret}
                  data-occurrence={occurrence ?? ''} data-occurrences={note.performance_ids.join(',')}
                  role="button" tabIndex={0}
                  aria-label={`String ${position.string}, fret ${position.fret}, ${segment.value}${selected ? ', selected' : ''}`}
                  {...handlers}>
                  {position.fret}
                </text>;
              })}
            </g>;
          }
          const ys = segment.notes.map(note => {
            const preview = sheetPreview && note.performance_ids.includes(sheetPreview.occurrence) ? sheetPreview : null;
            return yForNote(segment.staff, preview ? preview.spelling : note.spelling);
          });
          const top = Math.min(...ys);
          const bottom = Math.max(...ys);
          const stemDown = (top + bottom) / 2 < (staffTop + staffBottom) / 2;
          const stemX = x + (stemDown ? -4 : 4);
          const stemEnd = stemDown ? bottom + 30 : top - 30;
          const flags = FLAGS[segment.value] ?? 0;
          const hollow = segment.value === 'whole' || segment.value === 'half';
          const hasStem = segment.value !== 'whole';
          return <g key={segment.id} className="ws-score-event" data-value={segment.value} data-dotted={segment.dotted ? 'true' : 'false'}>
            {segment.notes.map(note => {
              const occurrence = occurrenceFor(note);
              const preview = sheetPreview?.occurrence === occurrence ? sheetPreview : null;
              const cy = yForNote(segment.staff, preview ? preview.spelling : note.spelling);
              const selected = selectedOccurrenceId !== null && note.performance_ids.includes(selectedOccurrenceId);
              const active = liveActive.some(id => note.performance_ids.includes(id));
              const ambiguous = occurrence === null;
              return <g key={note.id}>
                {ledgerLines(cy, staffTop, staffBottom)
                  .map(line => <line key={line} className="ws-score-ledger" x1={x - 9} y1={line} x2={x + 9} y2={line}/>)}
                <ellipse className={`ws-score-notehead${hollow ? ' is-hollow' : ''}${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
                  cx={x} cy={cy} rx={4.8} ry={3.6} transform={`rotate(-20 ${x} ${cy})`}
                  data-occurrence={occurrence ?? ''} data-occurrences={note.performance_ids.join(',')} data-ambiguous={ambiguous ? 'true' : 'false'}
                  role="button" tabIndex={0}
                  aria-label={`${note.spelling}, ${segment.value}${segment.dotted ? ' dotted' : ''}${selected ? ', selected' : ''}`}
                  data-sheet-preview={sheetPreview?.occurrence === occurrence ? sheetPreview.steps : undefined}
                  onPointerDown={event => beginSheetDrag(note, event)}
                  onPointerMove={moveSheetDrag}
                  onPointerUp={commitSheetDrag}
                  onPointerCancel={cancelSheetDrag}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(note); } }}/>
                {(() => {
                  const parsed = parseSpelling(preview ? preview.spelling : note.spelling);
                  const show = parsed.alter !== 0
                    ? displayAccidental(parsed.letter, parsed.alter, document.key_signature)
                    : note.display_accidental && note.accidental;
                  if (!show) return null;
                  return <text className="ws-score-accidental" x={x - 13} y={cy + 4}>
                    {parsed.alter > 0 ? '♯' : parsed.alter < 0 ? '♭' : '♮'}
                  </text>;
                })()}
                {preview ? <text className="ws-score-drag-label"
                  data-sheet-drag-label={preview.spelling}
                  x={x + 12} y={cy - 9}>{preview.spelling}</text> : null}
                {segment.dotted ? <circle className="ws-score-dot" cx={x + 8} cy={cy - 1} r={1.8}/> : null}
              </g>;
            })}
            {hasStem ? <>
              <line className="ws-score-stem" x1={stemX} y1={stemDown ? top : bottom} x2={stemX} y2={stemEnd} data-stem="true"/>
              {Array.from({length: flags}, (_, index) => <line key={`flag-${index}`} className="ws-score-flag"
                data-flags={flags}
                x1={stemX} y1={stemEnd + (stemDown ? -index * 7 : index * 7)}
                x2={stemX + (stemDown ? 9 : -9)} y2={stemEnd + (stemDown ? -index * 7 - 5 : index * 7 + 5)}/>)}
            </> : null}
          </g>;
        })}
        {!tab && document.ties.map(tie => {
          const from = positions.get(tie.from_segment_note_id);
          const to = positions.get(tie.to_segment_note_id);
          if (!from || !to) return null;
          return <path key={tie.id} className="ws-score-tie"
            d={`M ${from.x + 5} ${from.y - 6} Q ${(from.x + to.x) / 2} ${Math.min(from.y, to.y) - 14}, ${to.x - 5} ${to.y - 6}`}/>;
        })}
      </svg>
    </div>
    <div className="ws-score-context" aria-hidden="true" style={{height: HEIGHT}}>
      <svg width={CONTEXT_WIDTH} height={HEIGHT}>
        {tab ? <>
          <text className="ws-score-tab-label" x={10} y={tabTop + 4}>TAB</text>
          <text className="ws-score-capo-badge" data-capo-badge={setup.capo} x={CONTEXT_WIDTH - 8} y={10}
            textAnchor="end">
            {setup.capo > 0 ? `Capo ${setup.capo}` : 'Standard'} · {setup.tuning.replaceAll('_', ' ')}
          </text>
          {stringLabels.map((label, index) => <text key={index + 1} className="ws-score-tab-string"
            x={CONTEXT_WIDTH - 16} y={tabY(index + 1) + 4} textAnchor="end">{label}</text>)}
        </> : <>
        {[0, 1, 2, 3, 4].map(line => <g key={`ctx-${line}`}>
          <line className="ws-score-staff" x1={0} y1={TREBLE_TOP + line * LINE} x2={CONTEXT_WIDTH} y2={TREBLE_TOP + line * LINE}/>
          <line className="ws-score-staff" x1={0} y1={BASS_TOP + line * LINE} x2={CONTEXT_WIDTH} y2={BASS_TOP + line * LINE}/>
        </g>)}
        <path className="ws-score-brace" d={`M 8 ${TREBLE_TOP} C -4 ${(TREBLE_TOP + BASS_BOTTOM) / 2}, -4 ${(TREBLE_TOP + BASS_BOTTOM) / 2}, 8 ${BASS_BOTTOM}`}/>
        <text className="ws-score-clef" x={8} y={TREBLE_TOP + 33}>{'\u{1D11E}'}</text>
        <text className="ws-score-clef" x={8} y={BASS_TOP + 33}>{'\u{1D122}'}</text>
        {signature.entries.map((entry, index) => <g key={`key-${index}`}>
          <text className="ws-score-key" x={42 + index * 7} y={yForNote('treble', `${entry.letter}${entry.treble}`) + 4}>{signature.glyph}</text>
          <text className="ws-score-key" x={42 + index * 7} y={yForNote('bass', `${entry.letter}${entry.bass}`) + 4}>{signature.glyph}</text>
        </g>)}
        <text className="ws-score-time" x={CONTEXT_WIDTH - 14} y={TREBLE_TOP + 14}>{document.time_signature.numerator}</text>
        <text className="ws-score-time" x={CONTEXT_WIDTH - 14} y={TREBLE_TOP + 30}>{document.time_signature.denominator}</text>
        <text className="ws-score-time" x={CONTEXT_WIDTH - 14} y={BASS_TOP + 14}>{document.time_signature.numerator}</text>
        <text className="ws-score-time" x={CONTEXT_WIDTH - 14} y={BASS_TOP + 30}>{document.time_signature.denominator}</text>
        </>}
      </svg>
    </div>
  </div>;
}
