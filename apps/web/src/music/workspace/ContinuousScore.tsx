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
import {useEffect, useMemo, useRef, useState} from 'react';
import type {NotationDocument, NotationSegment, NotationValue} from '../../../../../packages/music-notation/index.ts';
import {
  measureAtTick, scrollForMeasure, tickAtX, visibleMeasureIndexes, xForTick, type MeasureBox,
} from './viewport';
import {useElementWidth} from './useElementWidth';
import {useClockTime, type ClockStore} from './clock';
import {effectiveSecondsToTick, type Alignment} from '../../../../../packages/music-notation/index.ts';

const RULER_HEIGHT = 22;
const LINE = 10;
const TREBLE_TOP = 34;
const TREBLE_BOTTOM = 74;
const BASS_TOP = 116;
const BASS_BOTTOM = 156;
const HEIGHT = RULER_HEIGHT + 162;
const CONTEXT_WIDTH = 62;

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
  /** Linked-navigation target from the roll or playback, performed once per token. */
  scrollTarget?: ScoreScrollTarget | null;
  onSelect: (occurrenceId: string) => void;
  /** Called instead of guessing when one written note maps several occurrences. */
  onAmbiguous?: (logicalNoteId: string, occurrenceIds: string[]) => void;
  /** A ruler click maps back to source time; scrolling never does. */
  onSeekTick?: (tick: number) => void;
  /** Reports the tick at the left edge when the user scrolls the strip. */
  onUserScroll?: (tickAtLeft: number) => void;
};

export function ContinuousScore({
  document, boxes, selectedOccurrenceId, reveal, playheadTick = null, activeOccurrenceIds = [],
  scrollTarget = null, onSelect, onAmbiguous, onSeekTick, onUserScroll,
  clock = null, alignment = null, offsetSeconds = 0, intervals,
}: Props) {
  const liveSeconds = useClockTime(clock, Number.NaN);
  const liveTick = clock && alignment ? effectiveSecondsToTick(alignment, liveSeconds, offsetSeconds) : playheadTick;
  const liveActive = intervals
    ? intervals.filter(interval => liveSeconds >= interval.start && liveSeconds < interval.end).map(interval => interval.id)
    : activeOccurrenceIds;
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const programmatic = useRef(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [first, last] = visibleMeasureIndexes(boxes, scrollLeft, width);
  const totalWidth = boxes.length ? boxes[boxes.length - 1].x + boxes[boxes.length - 1].width : 0;
  const canvasWidth = CONTEXT_WIDTH + totalWidth + 24;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      setScrollLeft(element.scrollLeft);
      if (programmatic.current || !onUserScroll) return;
      onUserScroll(tickAtX(boxes, document, element.scrollLeft + CONTEXT_WIDTH + 4));
    };
    setScrollLeft(element.scrollLeft);
    element.addEventListener('scroll', update, {passive: true});
    return () => element.removeEventListener('scroll', update);
  }, [width, boxes, document, onUserScroll]);

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

  const visibleSegments = useMemo(() => {
    if (last < first) return [] as NotationSegment[];
    return document.segments.filter(segment => segment.measure_index >= first && segment.measure_index <= last);
  }, [document.segments, first, last]);

  // Positions of the rendered noteheads, so ties are drawn only when both ends exist.
  const positions = useMemo(() => {
    const map = new Map<string, {x: number; y: number}>();
    for (const segment of visibleSegments) {
      if (segment.rest) continue;
      const box = boxes[segment.measure_index];
      if (!box) continue;
      const measure = document.measures[segment.measure_index];
      const local = (segment.start - measure.start) / measure.duration;
      const x = CONTEXT_WIDTH + box.x + 14 + local * (box.width - 28);
      for (const note of segment.notes) map.set(note.id, {x, y: yForNote(segment.staff, note.spelling)});
    }
    return map;
  }, [visibleSegments, boxes, document.measures]);

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

  return <div className="ws-score" ref={hostRef}>
    <div className="ws-score-viewport" ref={scrollRef}>
      <svg className="ws-score-svg" width={canvasWidth} height={HEIGHT} role="img"
        aria-label={`Continuous grand staff, ${document.measures.length} measures, showing measures ${first + 1}-${Math.max(first + 1, last + 1)}`}
        data-rendered-measures={last >= first ? last - first + 1 : 0} data-total-measures={document.measures.length}
        data-rendered-notes={visibleSegments.reduce((total, segment) => total + segment.notes.length, 0)}
        data-rendered-values={JSON.stringify([...new Set(visibleSegments.map(segment => segment.value))])}>
        <rect className="ws-score-paper" x={0} y={0} width={canvasWidth} height={HEIGHT}/>
        <rect className="ws-score-ruler" x={CONTEXT_WIDTH} y={0} width={totalWidth} height={RULER_HEIGHT}
          onClick={event => {
            if (!onSeekTick) return;
            const element = scrollRef.current;
            if (!element) return;
            const rect = element.getBoundingClientRect();
            const x = element.scrollLeft + (event.clientX - rect.left);
            onSeekTick(tickAtX(boxes, document, x));
          }}/>
        {liveTick !== null ? <line className="ws-score-playhead" data-playhead-tick={liveTick}
          x1={xForTick(boxes, document, liveTick)} y1={RULER_HEIGHT}
          x2={xForTick(boxes, document, liveTick)} y2={HEIGHT - 10}/> : null}
        {[0, 1, 2, 3, 4].map(line => <g key={`staff-${line}`}>
          <line className="ws-score-staff" x1={CONTEXT_WIDTH} y1={TREBLE_TOP + line * LINE} x2={CONTEXT_WIDTH + totalWidth} y2={TREBLE_TOP + line * LINE}/>
          <line className="ws-score-staff" x1={CONTEXT_WIDTH} y1={BASS_TOP + line * LINE} x2={CONTEXT_WIDTH + totalWidth} y2={BASS_TOP + line * LINE}/>
        </g>)}
        {boxes.slice(first, last + 1).map(box => <g key={`measure-${box.index}`} data-measure={box.index} className="ws-score-measure">
          <line className="ws-score-barline" x1={CONTEXT_WIDTH + box.x} y1={TREBLE_TOP} x2={CONTEXT_WIDTH + box.x} y2={BASS_BOTTOM}/>
          <text className="ws-score-measure-number" x={CONTEXT_WIDTH + box.x + 6} y={RULER_HEIGHT - 6}>{box.index + 1}</text>
        </g>)}
        <line className="ws-score-barline" x1={CONTEXT_WIDTH + totalWidth} y1={TREBLE_TOP} x2={CONTEXT_WIDTH + totalWidth} y2={BASS_BOTTOM}/>
        {visibleSegments.map(segment => {
          const box = boxes[segment.measure_index];
          if (!box) return null;
          const measure = document.measures[segment.measure_index];
          const local = (segment.start - measure.start) / measure.duration;
          const x = CONTEXT_WIDTH + box.x + 14 + local * (box.width - 28);
          const staffTop = segment.staff === 'treble' ? TREBLE_TOP : BASS_TOP;
          const staffBottom = segment.staff === 'treble' ? TREBLE_BOTTOM : BASS_BOTTOM;
          if (segment.rest) {
            const center = staffTop + LINE * 2;
            return <g key={segment.id} className="ws-score-rest" data-rest-value={segment.value}>
              <text className="ws-score-rest-glyph" x={x} y={center + 5} textAnchor="middle">{REST_GLYPHS[segment.value] ?? '𝄽'}</text>
              {segment.dotted ? <circle className="ws-score-dot" cx={x + 10} cy={center - 1} r={1.8}/> : null}
            </g>;
          }
          const ys = segment.notes.map(note => yForNote(segment.staff, note.spelling));
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
              const cy = yForNote(segment.staff, note.spelling);
              const selected = selectedOccurrenceId !== null && note.performance_ids.includes(selectedOccurrenceId);
              const active = liveActive.some(id => note.performance_ids.includes(id));
              const occurrence = occurrenceFor(note);
              const ambiguous = occurrence === null;
              return <g key={note.id}>
                {ledgerLines(cy, staffTop, staffBottom)
                  .map(line => <line key={line} className="ws-score-ledger" x1={x - 9} y1={line} x2={x + 9} y2={line}/>)}
                <ellipse className={`ws-score-notehead${hollow ? ' is-hollow' : ''}${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
                  cx={x} cy={cy} rx={4.8} ry={3.6} transform={`rotate(-20 ${x} ${cy})`}
                  data-occurrence={occurrence ?? ''} data-ambiguous={ambiguous ? 'true' : 'false'}
                  role="button" tabIndex={0}
                  aria-label={`${note.spelling}, ${segment.value}${segment.dotted ? ' dotted' : ''}${selected ? ', selected' : ''}`}
                  onPointerDown={() => choose(note)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(note); } }}/>
                {note.display_accidental && note.accidental
                  ? <text className="ws-score-accidental" x={x - 13} y={cy + 4}>
                      {note.accidental === 'sharp' ? '♯' : note.accidental === 'flat' ? '♭' : '♮'}
                    </text>
                  : null}
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
        {document.ties.map(tie => {
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
        {[0, 1, 2, 3, 4].map(line => <g key={`ctx-${line}`}>
          <line className="ws-score-staff" x1={0} y1={TREBLE_TOP + line * LINE} x2={CONTEXT_WIDTH} y2={TREBLE_TOP + line * LINE}/>
          <line className="ws-score-staff" x1={0} y1={BASS_TOP + line * LINE} x2={CONTEXT_WIDTH} y2={BASS_TOP + line * LINE}/>
        </g>)}
        <path className="ws-score-brace" d={`M 8 ${TREBLE_TOP} C -4 ${(TREBLE_TOP + BASS_BOTTOM) / 2}, -4 ${(TREBLE_TOP + BASS_BOTTOM) / 2}, 8 ${BASS_BOTTOM}`}/>
        <text className="ws-score-clef" x={6} y={TREBLE_TOP + 34}>{'\u{1D11E}'}</text>
        <text className="ws-score-clef" x={6} y={BASS_TOP + 34}>{'\u{1D122}'}</text>
        <text className="ws-score-key" x={40} y={TREBLE_TOP + 14}>{document.key_signature}</text>
        <text className="ws-score-time" x={40} y={TREBLE_TOP + 34}>{document.time_signature.numerator}</text>
        <text className="ws-score-time" x={40} y={TREBLE_TOP + 48}>{document.time_signature.denominator}</text>
      </svg>
    </div>
  </div>;
}
