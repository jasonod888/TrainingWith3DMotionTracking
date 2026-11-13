import {useMemo, useRef, useState} from 'react';
import type {EditorSelection, NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';

const WIDTH = 760;
const HEIGHT = 246;
const LEFT = 42;
const TOP = 12;
const PLOT_W = WIDTH - LEFT - 16;
const PLOT_H = HEIGHT - TOP - 30;
const ROW = 7;

type DragState = {
  noteId: string;
  eventId: string;
  pitch: number;
  onset: number;
  duration: number;
  startX: number;
  startY: number;
  mode: 'move' | 'resize' | 'pitch';
  deltaSeconds: number;
  deltaPitch: number;
  deltaDuration: number;
};

export function PianoRoll({document: score, selection, selectedOccurrenceId = null, playhead, onSelect, onSelectOccurrence, onPitchChange, onMove, onResize, onSeek}: {
  document: NotationDocument;
  selection: EditorSelection | null;
  /** Occurrence-level selection used by the correction workspace. */
  selectedOccurrenceId?: string | null;
  playhead: number;
  onSelect: (noteId: string) => void;
  /** When present, clicking a note selects its performance occurrence instead of its logical note. */
  onSelectOccurrence?: (occurrenceId: string) => void;
  onPitchChange: (noteId: string, pitch: number) => void;
  onMove: (eventId: string, startTicks: number) => void;
  onResize: (eventId: string, durationTicks: number) => void;
  onSeek: (seconds: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const pitches = score.performance.map(note => note.pitch);
  const low = Math.max(0, Math.min(60, ...pitches) - 3);
  const high = Math.min(127, Math.max(72, ...pitches) + 3);
  const rows = Math.max(1, high - low + 1);
  const rowHeight = Math.min(14, Math.max(4, PLOT_H / rows));
  const x = (seconds: number) => LEFT + Math.min(1, Math.max(0, seconds / score.duration)) * PLOT_W;
  const y = (pitch: number) => TOP + (high - pitch) / Math.max(1, rows - 1) * (PLOT_H - rowHeight);
  const secondsPerTick = 60 / (score.tempo.bpm * score.ppq);
  const noteLength = (note: {duration: number | null}) => Math.max(secondsPerTick * 120, note.duration && note.duration > 0 ? note.duration : 0.25);
  const selectedLogical = selection?.note_id ?? null;
  const measures = useMemo(() => score.measures.map(measure => ({...measure, seconds: measure.start * secondsPerTick})), [score.measures, secondsPerTick]);

  const localPoint = (event: React.PointerEvent): {seconds: number; pitch: number} => {
    const element = svg.current;
    if (!element) return {seconds: 0, pitch: 60};
    const rect = element.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * WIDTH;
    const py = (event.clientY - rect.top) / rect.height * HEIGHT;
    return {
      seconds: Math.max(0, Math.min(score.duration, (px - LEFT) / PLOT_W * score.duration)),
      pitch: Math.round(high - (py - TOP) / Math.max(1, PLOT_H - rowHeight) * (rows - 1)),
    };
  };

  const down = (event: React.PointerEvent<SVGRectElement>, noteId: string, eventId: string, occurrenceId: string, pitch: number, onset: number, duration: number | null, mode: 'move' | 'resize') => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event);
    setDrag({noteId, eventId, pitch, onset, duration: duration ?? 0.25, startX: point.seconds, startY: pitch, mode, deltaSeconds: 0, deltaPitch: 0, deltaDuration: 0});
    if (onSelectOccurrence) onSelectOccurrence(occurrenceId);
    else onSelect(noteId);
  };
  const move = (event: React.PointerEvent<SVGRectElement>) => {
    if (!drag) return;
    const point = localPoint(event);
    if (drag.mode === 'resize') {
      const target = Math.max(secondsPerTick * 120, drag.duration + (point.seconds - drag.startX));
      const snapped = Math.max(120, Math.round(target / secondsPerTick / 120) * 120);
      setDrag({...drag, deltaDuration: snapped * secondsPerTick - drag.duration});
    } else {
      const deltaPitch = point.pitch - drag.startY;
      const deltaSeconds = point.seconds - drag.startX;
      setDrag({...drag, deltaPitch, deltaSeconds});
    }
  };
  const up = (event: React.PointerEvent<SVGRectElement>) => {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.mode === 'resize') {
      if (drag.deltaDuration !== 0) onResize(drag.eventId, Math.max(120, Math.round((drag.duration + drag.deltaDuration) / secondsPerTick / 120) * 120));
    } else if (Math.abs(drag.deltaPitch) >= 1) {
      onPitchChange(drag.noteId, Math.max(0, Math.min(127, drag.pitch + drag.deltaPitch)));
    } else if (Math.abs(drag.deltaSeconds) >= secondsPerTick * 60) {
      const target = drag.onset + drag.deltaSeconds;
      onMove(drag.eventId, Math.round(target / secondsPerTick / 120) * 120);
    }
    setDrag(null);
  };

  return <div className="piano-roll-wrap">
    <svg ref={svg} className="piano-roll" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img"
      aria-label={`Editable piano roll, ${score.performance.length} performance notes, ${score.duration.toFixed(1)} seconds`}>
      <rect x={LEFT} y={TOP} width={PLOT_W} height={PLOT_H} className="roll-bg"
        onClick={event => { const point = localPoint(event as unknown as React.PointerEvent); onSeek(point.seconds); }}/>
      {measures.map(measure => <g key={measure.id}>
        <line x1={x(measure.seconds)} y1={TOP} x2={x(measure.seconds)} y2={TOP + PLOT_H} className="roll-measure"/>
        <text x={x(measure.seconds) + 3} y={TOP + 10} className="roll-measure-label">{measure.index + 1}</text>
      </g>)}
      {[0, 1, 2, 3].map(beat => {
        const step = score.measures[0].duration / Math.max(1, score.time_signature.numerator);
        return <line key={beat} x1={x((beat) * step * secondsPerTick)} y1={TOP} x2={x((beat) * step * secondsPerTick)} y2={TOP + PLOT_H} className="roll-beat"/>;
      })}
      {Array.from({length: rows}, (_, index) => high - index).filter(pitch => pitch % 12 === 0).map(pitch =>
        <g key={pitch}><line x1={LEFT} y1={y(pitch)} x2={LEFT + PLOT_W} y2={y(pitch)} className="roll-octave"/>
          <text x={LEFT - 5} y={y(pitch) + 3} className="roll-label">{pitchName(pitch)}</text></g>)}
      {score.performance.map(note => {
        const logical = score.performance_map[note.id] ?? null;
        const selected = (selectedOccurrenceId !== null && selectedOccurrenceId === note.id)
          || (selectedOccurrenceId === null && logical !== null && logical === selectedLogical);
        const dragging = drag?.noteId === logical;
        const left = x(note.onset);
        const width = Math.max(3, x(note.onset + noteLength(note)) - left);
        const top = y(note.pitch) - rowHeight / 2;
        const displayLeft = dragging && drag?.mode !== 'resize' ? x(Math.max(0, Math.min(score.duration, note.onset + drag!.deltaSeconds))) : left;
        const displayTop = dragging && drag?.mode === 'move' ? y(Math.max(0, Math.min(127, note.pitch + drag!.deltaPitch))) - rowHeight / 2 : top;
        const displayWidth = dragging && drag?.mode === 'resize' ? Math.max(3, x(note.onset + Math.max(secondsPerTick * 120, noteLength(note) + drag!.deltaDuration)) - left) : width;
        return <g key={note.id}>
          <rect x={displayLeft} y={displayTop} width={displayWidth} height={Math.max(4, rowHeight - 1)} rx={2}
            className={`roll-note${selected ? ' is-selected' : ''}${note.pitch !== (dragging ? drag!.pitch : note.pitch) ? ' is-dragging' : ''}`}
            style={{opacity: 0.55 + (note.velocity ?? 0.5) * 0.45}}
            onPointerDown={event => down(event, logical ?? note.id, logical ? score.events.find(eventItem => eventItem.notes.some(item => item.id === logical))?.id ?? '' : '', note.id, note.pitch, note.onset, note.duration, 'move')}
            onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
            <title>{`${pitchName(note.pitch)} at ${note.onset.toFixed(2)}s, ${noteLength(note).toFixed(2)}s`}</title>
          </rect>
          <rect x={left + width - 4} y={top} width={7} height={Math.max(4, rowHeight - 1)} rx={2} className="roll-resize"
            onPointerDown={event => down(event, logical ?? note.id, logical ? score.events.find(eventItem => eventItem.notes.some(item => item.id === logical))?.id ?? '' : '', note.id, note.pitch, note.onset, note.duration, 'resize')}
            onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}/>
        </g>;
      })}
      <line x1={x(playhead)} y1={TOP} x2={x(playhead)} y2={TOP + PLOT_H} className="roll-playhead"/>
    </svg>
    {drag && (drag.deltaPitch !== 0 || Math.abs(drag.deltaSeconds) > 0.01 || drag.deltaDuration !== 0) && <p className="roll-drag-status" role="status">
      {drag.mode === 'resize' ? `Length ${(drag.duration + drag.deltaDuration).toFixed(2)}s` : drag.deltaPitch !== 0 ? `Pitch → ${pitchName(Math.max(0, Math.min(127, drag.pitch + drag.deltaPitch)))}` : `Start → ${Math.max(0, drag.onset + drag.deltaSeconds).toFixed(2)}s`}
    </p>}
  </div>;
}
