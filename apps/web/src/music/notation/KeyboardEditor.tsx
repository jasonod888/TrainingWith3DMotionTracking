import {useMemo, useState, type ReactNode} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import {
  buildPianoGeometry, isStandardPianoRange, panStandardPianoRange, PIANO_GEOMETRY_HEIGHT,
  resolveKeyboardRange, semitonesForWidth, shiftPianoRange, STANDARD_PIANO_LAST,
  STANDARD_PIANO_FIRST, type PianoRange,
} from './piano-key-geometry';

const DEFAULT_WIDTH = 640;

export function KeyboardEditor({
  document: score, selectedPitch, activePitches, onKey, onSelectKey, hint, toolbarHint,
  width = DEFAULT_WIDTH, semitones, height, range, onRangeChange,
}: {
  document: NotationDocument;
  selectedPitch: number | null;
  activePitches: number[];
  onKey: (pitch: number, auditionOnly: boolean) => void;
  /** Optional occurrence-level selection hook used by the correction workspace. */
  onSelectKey?: (pitch: number) => void;
  /** Replaces the default editing hint; hosts that only audition should say so. */
  hint?: ReactNode;
  /** Replaces the default toolbar hint. */
  toolbarHint?: ReactNode;
  /** Virtual keybed width in viewBox units; wider hosts show more keys. */
  width?: number;
  /** Keyboard range in semitones (default three octaves). */
  semitones?: number;
  /** Optional rendered height for a compact host surface. */
  height?: number;
  /** Controlled range; the parent instrument owns it when supplied. */
  range?: PianoRange;
  onRangeChange?: (range: PianoRange) => void;
}) {
  const [octaveShift, setOctaveShift] = useState(0);
  const pitches = useMemo(() => score.performance.map(note => note.pitch), [score]);
  const basePitch = pitches.length
    ? Math.round(pitches.reduce((total, pitch) => total + pitch, 0) / pitches.length)
    : 60;
  const effectiveRange = useMemo(() => range ?? resolveKeyboardRange(
    pitches, width, octaveShift, semitones ?? semitonesForWidth(width),
  ), [range, pitches, width, octaveShift, semitones]);
  const geometry = useMemo(() => buildPianoGeometry(effectiveRange, width), [effectiveRange, width]);
  const {firstPitch, semitones: visibleSemitones} = effectiveRange;
  const fullRange = Boolean(range && isStandardPianoRange(range));
  const controlledRange = Boolean(range && onRangeChange);
  const rangeLabel = range
    ? fullRange
      ? 'A0–C8 · 88 keys'
      : `A0–C8 · ${pitchName(firstPitch)}–${pitchName(firstPitch + visibleSemitones)}`
    : pitchName(firstPitch);
  const shiftRange = (octaves: number) => {
    if (range && onRangeChange) {
      onRangeChange(isStandardPianoRange(range)
        ? panStandardPianoRange(range, octaves * 12)
        : shiftPianoRange(range, octaves));
      return;
    }
    setOctaveShift(value => Math.max(-7, Math.min(7, value + octaves)));
  };
  const atRangeStart = controlledRange && (range?.firstPitch ?? 0) <= STANDARD_PIANO_FIRST;
  const atRangeEnd = controlledRange
    && (range?.firstPitch ?? 0) + (range?.semitones ?? 0) >= STANDARD_PIANO_LAST;

  return <div className="keyboard-editor">
    <div className="keyboard-toolbar">
      <span className="small muted">Piano keyboard</span>
      {!fullRange && <button type="button" onClick={() => shiftRange(-1)}
        disabled={atRangeStart}
        aria-label={controlledRange ? 'Previous keyboard range' : 'Keyboard octave down'}>{controlledRange ? '− range' : '− oct'}</button>}
      <span className="keyboard-octave" title={rangeLabel}>{rangeLabel}</span>
      {!fullRange && <button type="button" onClick={() => shiftRange(1)}
        disabled={atRangeEnd}
        aria-label={controlledRange ? 'Next keyboard range' : 'Keyboard octave up'}>{controlledRange ? '+ range' : '+ oct'}</button>}
      <span className="small muted">{toolbarHint ?? 'Tap to audition; with a note selected, tap to set its pitch.'}</span>
    </div>
    <div className="keyboard-keybed">
      <svg className="keyboard-svg" viewBox={`0 0 ${width} ${PIANO_GEOMETRY_HEIGHT}`} role="img"
        aria-label={`Piano keyboard from ${pitchName(firstPitch)}, ${visibleSemitones + 1} semitones`}
        data-first-pitch={firstPitch} data-semitones={visibleSemitones}
        data-key-count={geometry.whites.length + geometry.blacks.length}
        preserveAspectRatio={height ? 'none' : undefined}
        style={height ? {height: `${height}px`, width: '100%'} : undefined}>
        <rect x="0" y="0" width={width} height={PIANO_GEOMETRY_HEIGHT} className="keyboard-bg"/>
        {geometry.whites.map(key => {
          const selected = selectedPitch === key.pitch;
          const active = activePitches.includes(key.pitch);
          return <rect key={key.pitch} x={key.x} y="0" width={key.width} height="130" rx="3"
            data-pitch={key.pitch}
            className={`keyboard-white${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
            onClick={() => { onKey(key.pitch, false); onSelectKey?.(key.pitch); }} role="button" tabIndex={0}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onKey(key.pitch, false); onSelectKey?.(key.pitch); } }}
            aria-label={`${pitchName(key.pitch)}${selected ? ', selected' : ''}`}/>;
        })}
        {geometry.blacks.map(key => {
          const selected = selectedPitch === key.pitch;
          const active = activePitches.includes(key.pitch);
          return <rect key={key.pitch} x={key.x} y="0" width={key.width} height="82" rx="3"
            data-pitch={key.pitch}
            className={`keyboard-black${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
            onClick={() => { onKey(key.pitch, false); onSelectKey?.(key.pitch); }} role="button" tabIndex={0}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onKey(key.pitch, false); onSelectKey?.(key.pitch); } }}
            aria-label={`${pitchName(key.pitch)}${selected ? ', selected' : ''}`}/>;
        })}
      </svg>
      <div className="keyboard-labels" aria-hidden="true">
        {geometry.whites.filter(key => key.pitch % 12 === 0
          || key.pitch === STANDARD_PIANO_FIRST || key.pitch === STANDARD_PIANO_LAST).map(key =>
          <span key={key.pitch}
            className={`keyboard-overlay-label${selectedPitch === key.pitch ? ' is-selected' : ''}${key.pitch === 60 ? ' is-middle-c' : ''}`}
            style={{left: `${((key.x + key.width / 2) / width) * 100}%`}}>{pitchName(key.pitch)}</span>)}
      </div>
    </div>
    <div className="keyboard-hint small muted">
      {hint ?? <>With no note selected, a key adds a note at the playhead using the chosen duration.</>}{' '}
      <button type="button" onClick={() => onKey(basePitch, true)}>Audition {pitchName(basePitch)}</button>
    </div>
  </div>;
}
