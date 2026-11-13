import {useMemo, useRef, useState} from 'react';
import type {NotationDocument, NotationSegment, NotationSegmentNote, EditorSelection} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';

const LINE = 10;
const STAFF_TOP = 58;
const STAFF_BOTTOM = 98;
const BASS_TOP = 168;
const BASS_BOTTOM = 208;
const MEASURE_LEFT = 78;
const MEASURE_WIDTH = 300;
const STAFF_LEFT_PAD = 34;
const STAFF_RIGHT_PAD = 18;
const HEIGHT = 286;

const REST_GLYPHS: Record<string, string> = {
  whole: '𝄻', half: '𝄼', quarter: '𝄽', eighth: '𝄾', sixteenth: '𝄿',
  thirtysecond: '𝄿', sixtyfourth: '𝄿',
};

function yForNote(staff: 'treble' | 'bass', spelling: string): number {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(spelling);
  if (!match) return staff === 'treble' ? STAFF_BOTTOM : BASS_BOTTOM;
  const letterIndex = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(match[1]);
  const octave = Number(match[3]);
  const index = octave * 7 + letterIndex;
  if (staff === 'treble') return STAFF_BOTTOM - (index - 30) * (LINE / 2);
  return BASS_BOTTOM - (index - 18) * (LINE / 2);
}

function ledgerYs(y: number, top: number, bottom: number): number[] {
  const lines: number[] = [];
  for (let value = top - LINE; value >= y - 0.5; value -= LINE) lines.push(value);
  for (let value = bottom + LINE; value <= y + 0.5; value += LINE) lines.push(value);
  return lines;
}

function noteX(document: NotationDocument, segment: NotationSegment, displayIndex: number): number {
  const measure = document.measures[segment.measure_index];
  const local = segment.start - measure.start;
  const start = MEASURE_LEFT + displayIndex * MEASURE_WIDTH + STAFF_LEFT_PAD;
  return start + (local / measure.duration) * (MEASURE_WIDTH - STAFF_LEFT_PAD - STAFF_RIGHT_PAD);
}

function flagPath(x: number, y: number, direction: 'up' | 'down', count: number): string {
  const sign = direction === 'up' ? 1 : -1;
  let path = '';
  for (let index = 0; index < count; index += 1) {
    const offset = index * 7;
    path += `M ${x} ${y + sign * offset} C ${x + 12} ${y + sign * (offset + 2)}, ${x + 14} ${y + sign * (offset + 10)}, ${x + 4} ${y + sign * (offset + 16)} `;
  }
  return path;
}

function chordOffsets(notes: NotationSegmentNote[]): Map<string, number> {
  const sorted = [...notes].sort((left, right) => left.pitch - right.pitch);
  const offsets = new Map<string, number>();
  for (let index = 0; index < sorted.length; index += 1) {
    let offset = 0;
    if (index > 0 && Math.abs(sorted[index].pitch - sorted[index - 1].pitch) <= 2) offset = 7;
    offsets.set(sorted[index].id, offset);
  }
  return offsets;
}

export function SheetMusic({document: score, selection, selectedOccurrenceId = null, compact, focusMeasure, zoom = 1, onSelect, onSelectOccurrence, onSelectRest, onPitchChange}: {
  document: NotationDocument;
  selection: EditorSelection | null;
  /** Occurrence-level selection used by the correction workspace. */
  selectedOccurrenceId?: string | null;
  compact: boolean;
  focusMeasure: number;
  zoom?: number;
  onSelect: (playable: {eventId: string; noteId: string; staff: 'treble' | 'bass'; measureIndex: number}) => void;
  /** When present, an unambiguous notehead selects its performance occurrence. */
  onSelectOccurrence?: (occurrenceId: string) => void;
  onSelectRest: (rest: NotationSegment) => void;
  onPitchChange: (noteId: string, pitch: number) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{noteId: string; startY: number; semitones: number; pitch: number} | null>(null);
  const measures = compact ? score.measures.filter(measure => measure.index === focusMeasure) : score.measures;
  const displayOffset = compact ? focusMeasure : 0;
  const width = MEASURE_LEFT + measures.length * MEASURE_WIDTH + 40;
  const segments = useMemo(() => score.segments.filter(segment => measures.some(measure => measure.index === segment.measure_index)), [score.segments, measures]);
  const positions = useMemo(() => {
    const map = new Map<string, {x: number; y: number}>();
    for (const segment of segments) {
      if (segment.rest) continue;
      const displayIndex = segment.measure_index - displayOffset;
      const offsets = chordOffsets(segment.notes);
      for (const note of segment.notes) {
        map.set(note.id, {x: noteX(score, segment, displayIndex) + (offsets.get(note.id) ?? 0), y: yForNote(segment.staff, note.spelling)});
      }
    }
    return map;
  }, [segments, score, displayOffset]);

  const selectedLogical = selection?.note_id ?? null;
  const selectedEvent = selection?.event_id ?? null;

  const pointerDown = (event: React.PointerEvent<SVGRectElement>, note: NotationSegmentNote, segment: NotationSegment, pitch: number) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({noteId: note.logical_note_id, startY: event.clientY, semitones: 0, pitch});
    if (onSelectOccurrence && note.performance_ids.length === 1) onSelectOccurrence(note.performance_ids[0]);
    else onSelect({eventId: segment.event_id, noteId: note.logical_note_id, staff: segment.staff, measureIndex: segment.measure_index});
  };
  const pointerMove = (event: React.PointerEvent<SVGRectElement>) => {
    if (!drag) return;
    const semitones = Math.round((drag.startY - event.clientY) / 10);
    if (semitones !== drag.semitones) setDrag({...drag, semitones});
  };
  const pointerUp = (event: React.PointerEvent<SVGRectElement>) => {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.semitones !== 0) onPitchChange(drag.noteId, Math.max(0, Math.min(127, drag.pitch + drag.semitones)));
    setDrag(null);
  };

  return <div className="notation-sheet-scroll" ref={scroll}>
    <svg className="notation-sheet" viewBox={`0 0 ${width} ${HEIGHT}`} style={{width: `${width * zoom}px`, minWidth: compact ? '100%' : undefined}} role="img"
      aria-label={`Grand staff, ${score.measures.length} measures, ${score.events.reduce((total, event) => total + event.notes.length, 0)} notes, ${score.ties.length} ties`}>
      <rect x="0" y="0" width={width} height={HEIGHT} className="notation-paper"/>
      {/* Brace and system start */}
      <path d={`M ${MEASURE_LEFT - 26} ${STAFF_TOP} C ${MEASURE_LEFT - 44} ${(STAFF_TOP + BASS_BOTTOM) / 2}, ${MEASURE_LEFT - 44} ${(STAFF_TOP + BASS_BOTTOM) / 2}, ${MEASURE_LEFT - 26} ${BASS_BOTTOM}`} className="notation-brace"/>
      <line x1={MEASURE_LEFT - 20} y1={STAFF_TOP} x2={MEASURE_LEFT - 20} y2={BASS_BOTTOM} className="notation-system-line"/>
      {[0, 1, 2, 3, 4].map(line => <g key={line}>
        <line x1={MEASURE_LEFT - 18} y1={STAFF_TOP + line * LINE} x2={width - 30} y2={STAFF_TOP + line * LINE} className="notation-staff-line"/>
        <line x1={MEASURE_LEFT - 18} y1={BASS_TOP + line * LINE} x2={width - 30} y2={BASS_TOP + line * LINE} className="notation-staff-line"/>
      </g>)}
      <text x={MEASURE_LEFT - 14} y={STAFF_TOP + 38} className="notation-clef">𝄞</text>
      <text x={MEASURE_LEFT - 14} y={BASS_TOP + 38} className="notation-clef">𝄢</text>
      <text x={MEASURE_LEFT + 4} y={STAFF_TOP + 26} className="notation-time">{score.time_signature.numerator}</text>
      <text x={MEASURE_LEFT + 4} y={STAFF_TOP + 46} className="notation-time">{score.time_signature.denominator}</text>
      <text x={MEASURE_LEFT + 4} y={BASS_TOP + 26} className="notation-time">{score.time_signature.numerator}</text>
      <text x={MEASURE_LEFT + 4} y={BASS_TOP + 46} className="notation-time">{score.time_signature.denominator}</text>
      <text x={MEASURE_LEFT - 4} y={STAFF_TOP - 18} className="notation-key">{score.key_signature}</text>
      <text x={MEASURE_LEFT - 4} y={BASS_BOTTOM + 26} className="notation-tempo">♩ = {score.tempo.bpm}</text>

      {measures.map(measure => {
        const displayIndex = measure.index - displayOffset;
        const left = MEASURE_LEFT + displayIndex * MEASURE_WIDTH;
        return <g key={measure.id}>
          <line x1={left + MEASURE_WIDTH} y1={STAFF_TOP} x2={left + MEASURE_WIDTH} y2={BASS_BOTTOM} className="notation-barline"/>
          <text x={left + 8} y={STAFF_TOP - 8} className="notation-measure-number">{measure.index + 1}</text>
        </g>;
      })}
      {segments.map(segment => {
        const displayIndex = segment.measure_index - displayOffset;
        const x = noteX(score, segment, displayIndex);
        if (segment.rest) {
          const selected = selectedEvent === segment.event_id && segment.event_id;
          return <g key={segment.id} className="notation-rest" role="button" tabIndex={segment.event_id ? 0 : -1}
            aria-label={`${segment.value} rest, measure ${segment.measure_index + 1}, ${segment.staff} voice ${segment.voice}`}
            onClick={() => onSelectRest(segment)}>
            <rect x={x - 14} y={(segment.staff === 'treble' ? STAFF_TOP : BASS_TOP) + 2} width={28} height={44} fill="transparent"/>
            <text x={x} y={(segment.staff === 'treble' ? STAFF_TOP + 26 : BASS_TOP + 26) + (segment.voice === 2 ? 16 : 0)}
              className={`notation-rest-glyph${selected ? ' is-selected' : ''}`}>{REST_GLYPHS[segment.value] ?? '𝄽'}</text>
          </g>;
        }
        const offsets = chordOffsets(segment.notes);
        const ys = segment.notes.map(note => yForNote(segment.staff, note.spelling));
        const average = ys.reduce((total, value) => total + value, 0) / Math.max(1, ys.length);
        const stemDown = segment.staff === 'treble' ? average < (STAFF_TOP + STAFF_BOTTOM) / 2 : average < (BASS_TOP + BASS_BOTTOM) / 2;
        const stemX = x + (stemDown ? -5 : 5);
        const stemEnd = stemDown ? Math.max(...ys) + 34 : Math.min(...ys) - 34;
        const flags = segment.value === 'eighth' ? 1 : segment.value === 'sixteenth' ? 2 : segment.value === 'thirtysecond' ? 3 : 0;
        return <g key={segment.id} className="notation-event">
          {segment.notes.map(note => {
            const cx = x + (offsets.get(note.id) ?? 0);
            const cy = yForNote(segment.staff, note.spelling);
            const selected = (selectedOccurrenceId !== null && note.performance_ids.includes(selectedOccurrenceId))
              || (selectedOccurrenceId === null && selectedLogical === note.logical_note_id);
            const dragged = drag?.noteId === note.logical_note_id;
            // Chord hit areas are split at the midpoint between noteheads so a
            // third or second never steals its neighbour's tap.
            const ordered = [...segment.notes].sort((left, right) => yForNote(segment.staff, left.spelling) - yForNote(segment.staff, right.spelling));
            const position = ordered.findIndex(item => item.id === note.id);
            const previousY = position > 0 ? yForNote(segment.staff, ordered[position - 1].spelling) : null;
            const nextY = position < ordered.length - 1 ? yForNote(segment.staff, ordered[position + 1].spelling) : null;
            const hitTop = previousY === null ? cy - 16 : (cy + previousY) / 2;
            const hitBottom = nextY === null ? cy + 16 : (cy + nextY) / 2;
            return <g key={note.id}>
              {ledgerYs(cy, segment.staff === 'treble' ? STAFF_TOP : BASS_TOP, segment.staff === 'treble' ? STAFF_BOTTOM : BASS_BOTTOM)
                .map(ledger => <line key={ledger} x1={cx - 10} y1={ledger} x2={cx + 10} y2={ledger} className="notation-ledger"/>)}
              <ellipse cx={cx} cy={cy} rx={5.4} ry={4.1} transform={`rotate(-20 ${cx} ${cy})`}
                className={`notation-notehead${selected ? ' is-selected' : ''}${note.tie_from ? ' is-tied' : ''}`}/>
              {note.display_accidental && note.accidental && note.accidental !== 'natural'
                ? <text x={cx - 15} y={cy + 4} className="notation-accidental">{note.accidental === 'sharp' ? '♯' : '♭'}</text>
                : note.display_accidental && note.accidental === 'natural'
                  ? <text x={cx - 15} y={cy + 4} className="notation-accidental">♮</text> : null}
              {note.tie_from ? <text x={cx + 8} y={cy - 6} className="notation-tie-continuation">⌒</text> : null}
              <rect x={cx - 16} y={hitTop} width={32} height={Math.max(12, hitBottom - hitTop)} fill="transparent" className="notation-note-hit" tabIndex={0}
                role="button" aria-label={`${pitchName(note.pitch)}, measure ${segment.measure_index + 1}, ${segment.staff} voice ${segment.voice}${selected ? ', selected' : ''}`}
                onPointerDown={event => pointerDown(event, note, segment, note.pitch)}
                onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => setDrag(null)}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (onSelectOccurrence && note.performance_ids.length === 1) onSelectOccurrence(note.performance_ids[0]); else onSelect({eventId: segment.event_id, noteId: note.logical_note_id, staff: segment.staff, measureIndex: segment.measure_index}); } }}/>
              {dragged && drag && drag.semitones !== 0
                ? <text x={cx + 12} y={cy - 18} className="notation-drag-label">{pitchName(Math.max(0, Math.min(127, drag.pitch + drag.semitones)))}</text>
                : null}
            </g>;
          })}
          {!segment.rest && <>
            <line x1={stemX} y1={stemDown ? Math.min(...ys) : Math.max(...ys)} x2={stemX} y2={stemEnd} className="notation-stem"/>
            {flags > 0 && <path d={flagPath(stemX, stemEnd, stemDown ? 'down' : 'up', flags)} className="notation-flag"/>}
          </>}
        </g>;
      })}
      {score.ties.map(tie => {
        const from = positions.get(tie.from_segment_note_id);
        const to = positions.get(tie.to_segment_note_id);
        if (!from || !to) return null;
        const lift = 8;
        return <path key={tie.id} d={`M ${from.x + 6} ${from.y - 7} Q ${(from.x + to.x) / 2} ${Math.min(from.y, to.y) - 7 - lift}, ${to.x - 6} ${to.y - 7}`} className="notation-tie"/>;
      })}
    </svg>
  </div>;
}
