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
const CONTEXT_WIDTH = 76;
const MIN_MEASURE = 92;
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
  return Math.max(MIN_MEASURE, Math.min(190, 34 + count * 15));
}

function yForPitch(spelling: string, staff: NotationStaff): number {
  const parsed = parseSpelling(spelling);
  // Diatonic staff position: treble bottom line E4, bass bottom line G2.
  const letterOrder: Record<string, number> = {C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6};
  const diatonic = parsed.octave * 7 + letterOrder[parsed.letter];
  const reference = staff === 'treble' ? 4 * 7 + 2 : 2 * 7 + 4;
  const bottomLine = (staff === 'treble' ? TREBLE_TOP : BASS_TOP) + 4 * LINE;
  return bottomLine - (diatonic - reference) * 4.5;
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

function ledgerLines(staff: NotationStaff, y: number) {
  const top = (staff === 'treble' ? TREBLE_TOP : BASS_TOP) - 4.5;
  const bottom = (staff === 'treble' ? TREBLE_TOP : BASS_TOP) + 4 * LINE + 4.5;
  if (y >= top && y <= bottom) return [];
  const lines: number[] = [];
  if (y < top) for (let line = top; line >= Math.max(y, top - 6 * 4.5); line -= 4.5) lines.push(line);
  else for (let line = bottom; line <= Math.min(y, bottom + 6 * 4.5); line += 4.5) lines.push(line);
  return lines;
}

function noteGlyph(segment: NotationSegment, note: NotationSegment['notes'][number], x: number, y: number,
                   staff: NotationStaff) {
  const hollow = segment.value === 'whole' || segment.value === 'half';
  const ledger = ledgerLines(staff, y);
  return <g key={note.id} data-formatted-segment={segment.id}
    data-formatted-value={segment.value} data-pitch={note.pitch} data-spelling={note.spelling}
    data-tied={note.tie_from || note.tie_to ? 'true' : 'false'}>
    {ledger.map(line => <line key={`${note.id}-ledger-${line}`} className="formatted-ledger"
      x1={x - 8} y1={line} x2={x + 8} y2={line}/>)}
    <ellipse cx={x} cy={y} rx={NOTE_RADIUS_X} ry={NOTE_RADIUS_Y}
      className={`formatted-notehead${hollow ? ' is-hollow' : ''}`}
      transform={`rotate(-18 ${x} ${y})`}/>
    {segment.value !== 'whole' && <line className="formatted-stem" x1={x + 4.2} y1={y - 1}
      x2={x + 4.2} y2={y - 24}/>}
    {segment.dotted ? <circle className="formatted-dot" cx={x + 9} cy={y} r={1.4}/> : null}
    {note.display_accidental
      ? <text className="formatted-accidental" x={x - 11} y={y + 3}>
          {note.accidental === 'flat' ? '♭' : note.accidental === 'natural' ? '♮' : '♯'}
        </text> : null}
  </g>;
}

export function FormattedScore({document, title, selectedOccurrenceId}: {
  document: NotationDocument; title: string; selectedOccurrenceId?: string | null;
}) {
  const layout = useMemo(() => layoutFormattedScore(document), [document]);
  const time = `${document.time_signature.numerator}/${document.time_signature.denominator}`;
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
            <text className="formatted-clef" x={offset - 56} y={system.y + TREBLE_TOP + 27} fontSize={36}>{CLEFS.treble}</text>
            <text className="formatted-clef" x={offset - 56} y={system.y + BASS_TOP + 27} fontSize={36}>{CLEFS.bass}</text>
            <text className="formatted-key" x={offset - 26} y={system.y + TREBLE_TOP + 8} fontSize={12}>{document.key_signature || 'C'}</text>
            <text className="formatted-time" x={offset - 26} y={system.y + TREBLE_TOP + 22} fontSize={11}>{time}</text>
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
                const glyph = noteGlyph(segment, note, position.x, position.y, segment.staff);
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
              const stub = from.system === system.index ? from.x + 6 : to.x - 6;
              return <path key={tie.id} className="formatted-tie is-broken"
                d={`M ${stub} ${(from.system === system.index ? from.y : to.y) - 1} q 8 -6 16 0`}/>;
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
