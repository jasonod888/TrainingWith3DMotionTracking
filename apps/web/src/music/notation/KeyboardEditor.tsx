import {useMemo, useState, type ReactNode} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const BLACK = new Set([1, 3, 6, 8, 10]);
const WIDTH = 640;
const HEIGHT = 148;

export function KeyboardEditor({document: score, selectedPitch, activePitches, onKey, onSelectKey, hint, toolbarHint}: {
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
}) {
  const [octaveShift, setOctaveShift] = useState(0);
  const pitchRange = score.performance.map(note => note.pitch);
  const base = selectedPitch ?? (pitchRange.length ? Math.round(pitchRange.reduce((total, pitch) => total + pitch, 0) / pitchRange.length) : 60);
  const startOctave = Math.max(0, Math.min(7, Math.floor(base / 12) - 1 + octaveShift));
  const first = Math.max(0, startOctave * 12);
  const whites = useMemo(() => {
    const result: number[] = [];
    for (let pitch = first; pitch <= Math.min(127, first + 36); pitch += 1) if (WHITE.has(pitch % 12)) result.push(pitch);
    return result;
  }, [first]);
  const whiteWidth = (WIDTH - 12) / Math.max(1, whites.length);
  const blackKeys = useMemo(() => {
    const result: {pitch: number; x: number}[] = [];
    for (let pitch = first; pitch < Math.min(127, first + 36); pitch += 1) {
      if (!BLACK.has(pitch % 12)) continue;
      const lowerWhite = whites.filter(value => value < pitch).length - 1;
      if (lowerWhite < 0) continue;
      result.push({pitch, x: 6 + (lowerWhite + 1) * whiteWidth - whiteWidth * 0.3});
    }
    return result;
  }, [first, whites, whiteWidth]);

  return <div className="keyboard-editor">
    <div className="keyboard-toolbar">
      <span className="small muted">Piano keyboard</span>
      <button type="button" onClick={() => setOctaveShift(value => Math.max(-2, value - 1))} aria-label="Keyboard octave down">− oct</button>
      <span className="keyboard-octave">C{startOctave}</span>
      <button type="button" onClick={() => setOctaveShift(value => Math.min(2, value + 1))} aria-label="Keyboard octave up">+ oct</button>
      <span className="small muted">{toolbarHint ?? 'Tap to audition; with a note selected, tap to set its pitch.'}</span>
    </div>
    <svg className="keyboard-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Piano keyboard from ${pitchName(first)}`}>
      <rect x="0" y="0" width={WIDTH} height={HEIGHT} className="keyboard-bg"/>
      {whites.map((pitch, index) => {
        const x = 6 + index * whiteWidth;
        const selected = selectedPitch === pitch;
        const active = activePitches.includes(pitch);
        return <g key={pitch}>
          <rect x={x} y="8" width={whiteWidth - 1.5} height="124" rx="3"
            className={`keyboard-white${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
            onClick={() => { onKey(pitch, false); onSelectKey?.(pitch); }} role="button" tabIndex={0}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onKey(pitch, false); onSelectKey?.(pitch); } }}
            aria-label={`${pitchName(pitch)}${selected ? ', selected' : ''}`}/>
          {pitch % 12 === 0 && <text x={x + whiteWidth / 2} y="144" textAnchor="middle" className="keyboard-label">{pitchName(pitch)}</text>}
        </g>;
      })}
      {blackKeys.map(({pitch, x}) => {
        const selected = selectedPitch === pitch;
        const active = activePitches.includes(pitch);
        return <rect key={pitch} x={x} y="8" width="13" height="78" rx="3"
          className={`keyboard-black${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
          onClick={() => { onKey(pitch, false); onSelectKey?.(pitch); }} role="button" tabIndex={0}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onKey(pitch, false); onSelectKey?.(pitch); } }}
          aria-label={`${pitchName(pitch)}${selected ? ', selected' : ''}`}/>;
      })}
    </svg>
    <div className="keyboard-hint small muted">
      {hint ?? <>With no note selected, a key adds a note at the playhead using the chosen duration.</>}{' '}
      <button type="button" onClick={() => onKey(base, true)}>Audition {pitchName(base)}</button>
    </div>
  </div>;
}
