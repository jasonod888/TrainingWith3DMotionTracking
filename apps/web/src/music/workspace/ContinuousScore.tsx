/**
 * Phase 3 continuous score strip: one horizontally scrollable grand staff that renders
 * only the visible measures (plus a buffer) and keeps clef/key/time context pinned.
 *
 * Scrolling moves the strip only; it never seeks or mutates the document. Clicking a
 * notehead selects its occurrence. Beat-linked scrolling and the score playhead belong
 * to Phase 4.
 */
import {useEffect, useMemo, useRef, useState} from 'react';
import type {NotationDocument, NotationSegment} from '../../../../../packages/music-notation/index.ts';
import {measureAtTick, scrollForMeasure, secondsToTick, visibleMeasureIndexes, type MeasureBox} from './viewport';
import {useElementWidth} from './useElementWidth';

const RULER_HEIGHT = 22;
const LINE = 10;
const TREBLE_TOP = 34;
const TREBLE_BOTTOM = 74;
const BASS_TOP = 116;
const BASS_BOTTOM = 156;
const HEIGHT = RULER_HEIGHT + 162;
const CONTEXT_WIDTH = 62;

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

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

type Props = {
  document: NotationDocument;
  boxes: MeasureBox[];
  selectedOccurrenceId: string | null;
  revealTick: number | null;
  onSelect: (occurrenceId: string) => void;
};

export function ContinuousScore({document, boxes, selectedOccurrenceId, revealTick, onSelect}: Props) {
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const totalWidth = boxes.length ? boxes[boxes.length - 1].x + boxes[boxes.length - 1].width : 0;
  const canvasWidth = CONTEXT_WIDTH + totalWidth + 24;

  const [scrollLeft, setScrollLeft] = useState(0);
  const [first, last] = visibleMeasureIndexes(boxes, scrollLeft, width);

  // Track the scroll offset so rendering can be culled to the visible measures.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setScrollLeft(element.scrollLeft);
    update();
    element.addEventListener('scroll', update, {passive: true});
    return () => element.removeEventListener('scroll', update);
  }, [width]);

  // Revealing a selection scrolls to its measure without seeking.
  useEffect(() => {
    if (revealTick === null) return;
    const element = scrollRef.current;
    if (!element) return;
    const index = measureAtTick(boxes, document, revealTick);
    const target = scrollForMeasure(boxes, index, Math.max(120, width), element.scrollLeft);
    if (Math.abs(target - element.scrollLeft) > 1) element.scrollLeft = target;
  }, [revealTick, boxes, document, width]);

  const visibleSegments = useMemo(() => {
    if (last < first) return [] as NotationSegment[];
    return document.segments.filter(segment => segment.measure_index >= first && segment.measure_index <= last);
  }, [document.segments, first, last]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const segment of visibleSegments) {
      if (segment.rest) continue;
      const box = boxes[segment.measure_index];
      if (!box) continue;
      const local = (segment.start - document.measures[segment.measure_index].start) / document.measures[segment.measure_index].duration;
      const x = CONTEXT_WIDTH + box.x + 14 + local * (box.width - 28);
      for (const note of segment.notes) {
        map.set(note.id, {x, y: yForNote(segment.staff, note.spelling)});
      }
    }
    return map;
  }, [visibleSegments, boxes, document.measures]);

  return <div className="ws-score" ref={hostRef}>
    <div className="ws-score-viewport" ref={scrollRef}>
      <svg className="ws-score-svg" width={canvasWidth} height={HEIGHT} role="img"
        aria-label={`Continuous grand staff, ${document.measures.length} measures, showing measures ${first + 1}-${Math.max(first + 1, last + 1)}`}
        data-rendered-measures={last >= first ? last - first + 1 : 0} data-total-measures={document.measures.length}
        data-rendered-notes={visibleSegments.reduce((total, segment) => total + segment.notes.length, 0)}>
        <rect className="ws-score-paper" x={0} y={0} width={canvasWidth} height={HEIGHT}/>
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
          if (segment.rest) {
            return <g key={segment.id} className="ws-score-rest" data-rest={segment.id}>
              <rect x={x - 6} y={(segment.staff === 'treble' ? TREBLE_TOP : BASS_TOP) + 14} width={12} height={12} rx={2}/>
            </g>;
          }
          const ys = segment.notes.map(note => yForNote(segment.staff, note.spelling));
          const top = Math.min(...ys);
          const bottom = Math.max(...ys);
          const stemDown = (segment.staff === 'treble' ? top : top) < (segment.staff === 'treble' ? (TREBLE_TOP + TREBLE_BOTTOM) / 2 : (BASS_TOP + BASS_BOTTOM) / 2);
          return <g key={segment.id} className="ws-score-event">
            {segment.notes.map(note => {
              const cx = x;
              const cy = yForNote(segment.staff, note.spelling);
              const selected = selectedOccurrenceId !== null && note.performance_ids.includes(selectedOccurrenceId);
              const occurrence = note.performance_ids[0];
              return <g key={note.id}>
                {ledgerLines(cy, segment.staff === 'treble' ? TREBLE_TOP : BASS_TOP, segment.staff === 'treble' ? TREBLE_BOTTOM : BASS_BOTTOM)
                  .map(line => <line key={line} className="ws-score-ledger" x1={cx - 9} y1={line} x2={cx + 9} y2={line}/>)}
                <ellipse className={`ws-score-notehead${selected ? ' is-selected' : ''}`} cx={cx} cy={cy} rx={4.8} ry={3.6}
                  transform={`rotate(-20 ${cx} ${cy})`}
                  data-occurrence={occurrence ?? ''} role="button" tabIndex={0}
                  aria-label={`${note.spelling}${selected ? ', selected' : ''}`}
                  onPointerDown={() => { if (occurrence) onSelect(occurrence); }}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (occurrence) onSelect(occurrence); } }}/>
                {note.display_accidental && note.accidental
                  ? <text className="ws-score-accidental" x={cx - 13} y={cy + 4}>
                      {note.accidental === 'sharp' ? '\u266F' : note.accidental === 'flat' ? '\u266D' : '\u266E'}
                    </text>
                  : null}
              </g>;
            })}
            <line className="ws-score-stem" x1={x + (stemDown ? -4 : 4)} y1={stemDown ? top : bottom}
              x2={x + (stemDown ? -4 : 4)} y2={stemDown ? bottom + 30 : top - 30}/>
            {segment.value === 'eighth' || segment.value === 'sixteenth'
              ? <line className="ws-score-flag" x1={x + (stemDown ? -4 : 4)} y1={stemDown ? bottom + 30 : top - 30}
                  x2={x + (stemDown ? 4 : 12)} y2={stemDown ? bottom + 22 : top - 22}/>
              : null}
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

