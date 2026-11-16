/**
 * Phase 8 read-only formatted score.
 *
 * The score is derived entirely from the same working NotationDocument used by
 * correction mode: no second note dataset, no transcription pass and no mutation
 * API. Layout is pure so pagination/system packing can be tested.
 */
import React, {useMemo} from 'react';
import {measureTicks, parseSpelling, type NotationDocument, type NotationSegment, type NotationStaff} from '../../../../../packages/music-notation/index.ts';

const PAGE_WIDTH = 900;
const PAGE_HEIGHT = 1160;
const MARGIN_X = 58;
const MARGIN_TOP = 92;
const MARGIN_BOTTOM = 64;
const SYSTEM_HEIGHT = 176;
const TREBLE_TOP = 38;
const BASS_TOP = 112;
const LINE = 8;
const STAFF_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const CONTEXT_WIDTH = 112;
const MIN_MEASURE = 120;
const NOTE_RADIUS_X = 4.6;
const NOTE_RADIUS_Y = 3.4;

export type FormattedNotePosition = {x: number; y: number; page: number; system: number; staff: NotationStaff};
export type FormattedSystem = {
  page: number;
  index: number;
  measures: number[];
  x: number;
  y: number;
  width: number;
  segments: NotationSegment[];
};
export type FormattedPage = {
  index: number;
  systems: FormattedSystem[];
  notePositions: Map<string, FormattedNotePosition>;
};
export type FormattedLayout = {
  pages: FormattedPage[];
  systems: FormattedSystem[];
  measureWidths: Map<number, number>;
  notePositions: Map<string, FormattedNotePosition>;
  droppedSegments: number;
};

function measureWidth(segments: NotationSegment[]): number {
  const count = segments.reduce((total, segment) => total + Math.max(1, segment.notes.length), 0);
  return Math.max(MIN_MEASURE, Math.min(320, 44 + count * 18));
}

function yForPitch(spelling: string, staff: NotationStaff): number {
  const parsed = parseSpelling(spelling);
  // Diatonic staff position: treble bottom line E4, bass bottom line G2.
  const letterOrder: Record<string, number> = {C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6};
  const diatonic = parsed.octave * 7 + letterOrder[parsed.letter];
  const reference = staff === 'treble' ? 4 * 7 + 2 : 2 * 7 + 4;
  const bottomLine = (staff === 'treble' ? TREBLE_TOP : BASS_TOP) + 4 * LINE;
  return bottomLine - (diatonic - reference) * (LINE / 2);
}

export function layoutFormattedScore(document: NotationDocument): FormattedLayout {
  const segmentsByMeasure = new Map<number, NotationSegment[]>();
  for (const segment of document.segments) {
    const list = segmentsByMeasure.get(segment.measure_index);
    if (list) list.push(segment);
    else segmentsByMeasure.set(segment.measure_index, [segment]);
  }

  const measureWidths = new Map<number, number>();
  for (const measure of document.measures) {
    measureWidths.set(measure.index, measureWidth(segmentsByMeasure.get(measure.index) ?? []));
  }

  const systems: FormattedSystem[] = [];
  let current: {measures: number[]; width: number} = {measures: [], width: 0};
  const flush = () => {
    if (!current.measures.length) return;
    const page = 0; // assigned after pagination
    const index = systems.length;
    systems.push({page, index, measures: current.measures, x: 0, y: 0,
      width: Math.min(STAFF_WIDTH, current.width), segments: []});
    current = {measures: [], width: 0};
  };
  for (const measure of document.measures) {
    const width = measureWidths.get(measure.index) ?? MIN_MEASURE;
    if (current.measures.length && current.width + width > STAFF_WIDTH - CONTEXT_WIDTH) flush();
    current.measures.push(measure.index);
    current.width += width;
  }
  flush();

  const perPage = Math.max(1, Math.floor((PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM) / SYSTEM_HEIGHT));
  const pages: FormattedPage[] = [];
  const notePositions = new Map<string, FormattedNotePosition>();
  let systemTop = 0;
  for (let index = 0; index < systems.length; index += 1) {
    const system = systems[index];
    const pageIndex = Math.floor(index / perPage);
    if (!pages[pageIndex]) pages.push({index: pageIndex, systems: [], notePositions: new Map()});
    const withinPage = index % perPage;
    system.page = pageIndex;
    system.y = MARGIN_TOP + withinPage * SYSTEM_HEIGHT;
    system.x = MARGIN_X + CONTEXT_WIDTH;
    let offset = 0;
    system.segments = [];
    for (const measureIndex of system.measures) {
      const segments = segmentsByMeasure.get(measureIndex) ?? [];
      system.segments.push(...segments);
      const width = measureWidths.get(measureIndex) ?? MIN_MEASURE;
      for (const segment of segments) {
        const measure = document.measures[measureIndex];
        const local = (segment.start - measure.start) / Math.max(1, measure.duration);
        const x = system.x + offset + 16 + local * Math.max(8, width - 28);
        for (const note of segment.notes) {
          const position = {x, y: system.y + yForPitch(note.spelling, segment.staff),
            page: pageIndex, system: index, staff: segment.staff};
          notePositions.set(note.id, position);
          pages[pageIndex].notePositions.set(note.id, position);
        }
      }
      offset += width;
    }
    pages[pageIndex].systems.push(system);
    systemTop = system.y;
  }
  void systemTop;

  const droppedSegments = document.segments.length
    - systems.reduce((total, system) => total + system.segments.length, 0);
  return {pages, systems, measureWidths, notePositions, droppedSegments};
}

const CLEFS: Record<NotationStaff, string> = {treble: '𝄞', bass: '𝄢'};
const REST_GLYPHS: Record<string, string> = {
  whole: '𝄻', half: '𝄼', quarter: '𝄽', eighth: '𝄾', sixteenth: '𝄿',
  thirtysecond: '𝅀', sixtyfourth: '𝅁',
};

function ledgerLines(staff: NotationStaff, localY: number) {
  const top = staff === 'treble' ? TREBLE_TOP : BASS_TOP;
  const bottom = top + 4 * LINE;
  if (localY >= top && localY <= bottom) return [];
  const lines: number[] = [];
  if (localY < top) {
    for (let line = top - LINE; line >= Math.max(localY - 0.1, top - 5 * LINE); line -= LINE) lines.push(line);
  } else {
    for (let line = bottom + LINE; line <= Math.min(localY + 0.1, bottom + 5 * LINE); line += LINE) lines.push(line);
  }
  return lines;
}

function noteGlyph(segment: NotationSegment, note: NotationSegment['notes'][number], x: number, y: number,
                   staff: NotationStaff, systemY: number) {
  const hollow = segment.value === 'whole' || segment.value === 'half';
  const ledger = ledgerLines(staff, y - systemY);
  return <g key={note.id} data-formatted-segment={segment.id}
    data-formatted-value={segment.value} data-pitch={note.pitch} data-spelling={note.spelling}
    data-tied={note.tie_from || note.tie_to ? 'true' : 'false'}>
    {ledger.map(line => <line key={`${note.id}-ledger-${line}`} className="formatted-ledger"
      x1={x - 8} y1={systemY + line} x2={x + 8} y2={systemY + line}/>)}
    <ellipse cx={x} cy={y} rx={NOTE_RADIUS_X} ry={NOTE_RADIUS_Y}
      className={`formatted-notehead${hollow ? ' is-hollow' : ''}`}
      transform={`rotate(-18 ${x} ${y})`}/>
    {segment.value !== 'whole' && <line className="formatted-stem" x1={x + 4.2} y1={y - 1}
      x2={x + 4.2} y2={y - 24}/>}
    {Array.from({length: ({eighth: 1, sixteenth: 2, thirtysecond: 3, sixtyfourth: 4} as Record<string, number>)[segment.value] ?? 0},
      (_, flag) => <path key={`${note.id}-flag-${flag}`} className="formatted-flag"
        d={`M ${x + 4.2} ${y - 24 + flag * 5} q 7 3 5 9`}/>)}
    {segment.dotted ? <circle className="formatted-dot" cx={x + 9} cy={y} r={1.4}/> : null}
    {note.display_accidental
      ? <text className="formatted-accidental" x={x - 11} y={y + 3}>
          {note.accidental === 'flat' ? '♭' : note.accidental === 'natural' ? '♮' : '♯'}
        </text> : null}
  </g>;
}

const SHARP_ORDER: {letter: string; treble: number; bass: number}[] = [
  {letter: 'F', treble: 5, bass: 3}, {letter: 'C', treble: 5, bass: 3},
  {letter: 'G', treble: 5, bass: 3}, {letter: 'D', treble: 5, bass: 3},
  {letter: 'A', treble: 4, bass: 2}, {letter: 'E', treble: 5, bass: 3},
  {letter: 'B', treble: 4, bass: 2},
];
const FLAT_ORDER: {letter: string; treble: number; bass: number}[] = [
  {letter: 'B', treble: 4, bass: 2}, {letter: 'E', treble: 5, bass: 3},
  {letter: 'A', treble: 4, bass: 2}, {letter: 'D', treble: 5, bass: 3},
  {letter: 'G', treble: 4, bass: 2}, {letter: 'C', treble: 5, bass: 3},
  {letter: 'F', treble: 4, bass: 2},
];
const SHARP_KEYS: Record<string, number> = {G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7};
const FLAT_KEYS: Record<string, number> = {F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7};

function keySignature(key: string): {glyph: string; entries: {letter: string; treble: number; bass: number}[]} {
  const name = (key || 'C').split(/[\s(]/)[0];
  if (SHARP_KEYS[name]) return {glyph: '♯', entries: SHARP_ORDER.slice(0, SHARP_KEYS[name])};
  if (FLAT_KEYS[name]) return {glyph: '♭', entries: FLAT_ORDER.slice(0, FLAT_KEYS[name])};
  return {glyph: '', entries: []};
}

export function FormattedScore({document, title, selectedOccurrenceId}: {
  document: NotationDocument; title: string; selectedOccurrenceId?: string | null;
}) {
  const layout = useMemo(() => layoutFormattedScore(document), [document]);
  const signature = keySignature(document.key_signature);
  return <section className="ws-formatted" aria-label="Formatted final score">
    <div className="ws-formatted-toolbar">
      <strong>Formatted score</strong>
      <span className="ws-hint">Read-only · {document.measures.length} measures · {document.performance.length} occurrences</span>
      <span className="ws-hint" data-formatted-pages={layout.pages.length}>
        {layout.pages.length} page{layout.pages.length === 1 ? '' : 's'} · {layout.systems.length} systems
      </span>
    </div>
    {layout.pages.map(page => <div className="ws-formatted-page" key={`page-${page.index}`}
      data-formatted-page={page.index + 1}>
      <div className="ws-formatted-page-head">
        <span>{title || 'Piano score'}</span>
        <span>Page {page.index + 1} / {layout.pages.length}</span>
      </div>
      <svg width={PAGE_WIDTH} height={PAGE_HEIGHT} viewBox={`0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`}
        role="img" aria-label={`${title || 'Piano score'}, page ${page.index + 1} of ${layout.pages.length}`}>
        <rect className="ws-formatted-paper" x={0} y={0} width={PAGE_WIDTH} height={PAGE_HEIGHT}/>
        {page.systems.map(system => {
          const offset = system.x;
          const width = Math.min(STAFF_WIDTH, system.width);
          return <g key={`system-${system.index}`} data-formatted-system={system.index}>
            <text className="formatted-brace" x={offset - 22} y={system.y + (TREBLE_TOP + BASS_TOP) / 2 + 26}
              fontSize={66} textAnchor="middle">{'{'}</text>
            <text className="formatted-clef" x={offset - 92} y={system.y + TREBLE_TOP + 27} fontSize={36}>{CLEFS.treble}</text>
            <text className="formatted-clef" x={offset - 92} y={system.y + BASS_TOP + 27} fontSize={36}>{CLEFS.bass}</text>
            {signature.entries.map((entry, index) => <g key={`key-${system.index}-${index}`}>
              <text className="formatted-key" x={offset - 72 + index * 8}
                y={system.y + yForPitch(`${entry.letter}${entry.treble}`, 'treble') + 4} fontSize={14}>{signature.glyph}</text>
              <text className="formatted-key" x={offset - 72 + index * 8}
                y={system.y + yForPitch(`${entry.letter}${entry.bass}`, 'bass') + 4} fontSize={14}>{signature.glyph}</text>
            </g>)}
            <text className="formatted-time" x={offset - 18} y={system.y + TREBLE_TOP + 14} fontSize={12}>{document.time_signature.numerator}</text>
            <text className="formatted-time" x={offset - 18} y={system.y + TREBLE_TOP + 30} fontSize={12}>{document.time_signature.denominator}</text>
            <text className="formatted-time" x={offset - 18} y={system.y + BASS_TOP + 14} fontSize={12}>{document.time_signature.numerator}</text>
            <text className="formatted-time" x={offset - 18} y={system.y + BASS_TOP + 30} fontSize={12}>{document.time_signature.denominator}</text>
            {[0, 1, 2, 3, 4].map(line => <g key={`staff-${system.index}-${line}`}>
              <line className="formatted-staff" x1={offset} y1={system.y + TREBLE_TOP + line * LINE}
                x2={offset + width} y2={system.y + TREBLE_TOP + line * LINE}/>
              <line className="formatted-staff" x1={offset} y1={system.y + BASS_TOP + line * LINE}
                x2={offset + width} y2={system.y + BASS_TOP + line * LINE}/>
            </g>)}
            {system.measures.map((measureIndex, position) => {
              const measure = document.measures[measureIndex];
              let x = offset;
              for (let prior = 0; prior < position; prior += 1) {
                x += layout.measureWidths.get(system.measures[prior]) ?? MIN_MEASURE;
              }
              return <g key={`m-${measureIndex}`} data-formatted-measure={measureIndex + 1}>
                <line className="formatted-bar" x1={x} y1={system.y + TREBLE_TOP}
                  x2={x} y2={system.y + BASS_TOP + 4 * LINE}/>
                <text className="formatted-measure-number" x={x + 4} y={system.y + TREBLE_TOP - 16}>{measure.index + 1}</text>
              </g>;
            })}
            <line className="formatted-bar" x1={offset + width} y1={system.y + TREBLE_TOP}
              x2={offset + width} y2={system.y + BASS_TOP + 4 * LINE}/>
            {system.segments.map(segment => {
              if (segment.rest) {
                const measure = document.measures[segment.measure_index];
                let measureX = offset;
                for (const measureIndex of system.measures) {
                  if (measureIndex === segment.measure_index) break;
                  measureX += layout.measureWidths.get(measureIndex) ?? MIN_MEASURE;
                }
                const local = (segment.start - measure.start) / Math.max(1, measure.duration);
                const x = measureX + 16 + local * Math.max(8, (layout.measureWidths.get(segment.measure_index) ?? MIN_MEASURE) - 28);
                const y = system.y + (segment.staff === 'treble' ? TREBLE_TOP : BASS_TOP) + 2 * LINE + 5;
                return <text key={segment.id} className="formatted-rest" x={x} y={y} fontSize={20}>{REST_GLYPHS[segment.value] ?? '𝄽'}</text>;
              }
              return segment.notes.map(note => {
                const position = layout.notePositions.get(note.id);
                if (!position) return null;
                const glyph = noteGlyph(segment, note, position.x, position.y, segment.staff, system.y);
                return <g key={note.id} className={selectedOccurrenceId && note.performance_ids.includes(selectedOccurrenceId)
                  ? 'is-selected' : undefined}>{glyph}</g>;
              });
            })}
            {document.ties.map(tie => {
              const from = layout.notePositions.get(tie.from_segment_note_id);
              const to = layout.notePositions.get(tie.to_segment_note_id);
              if (!from || !to) return null;
              if (from.system !== system.index && to.system !== system.index) return null;
              if (from.system === to.system) {
                return <path key={tie.id} className="formatted-tie"
                  d={`M ${from.x + 5} ${from.y - 1} Q ${(from.x + to.x) / 2} ${from.y - 12} ${to.x - 5} ${to.y - 1}`}/>;
              }
              if (from.system === system.index) {
                return <path key={tie.id} className="formatted-tie is-broken"
                  d={`M ${from.x + 5} ${from.y - 1} q 8 -6 14 0`}/>;
              }
              return <path key={tie.id} className="formatted-tie is-broken"
                d={`M ${to.x - 16} ${to.y - 1} q 8 -6 11 0`}/>;
            })}
          </g>;
        })}
        <text className="formatted-footer" x={PAGE_WIDTH - MARGIN_X} y={PAGE_HEIGHT - 24} textAnchor="end">
          {title || 'Piano score'}
        </text>
      </svg>
    </div>)}
  </section>;
}
