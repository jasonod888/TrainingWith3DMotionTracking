/**
 * Small, deterministic guitar chord naming/detection helpers for the shared editor.
 * These are suggestions for the instructor, never inferred fingering: every detected
 * shape still requires review before it is saved.
 */
import {OPEN_STRING} from '../../../../../packages/music-notation/guitar.ts';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const QUALITIES: {suffix: string; intervals: number[]}[] = [
  {suffix: '', intervals: [0, 4, 7]},
  {suffix: 'm', intervals: [0, 3, 7]},
  {suffix: '7', intervals: [0, 4, 7, 10]},
  {suffix: 'm7', intervals: [0, 3, 7, 10]},
  {suffix: 'maj7', intervals: [0, 4, 7, 11]},
  {suffix: 'dim', intervals: [0, 3, 6]},
  {suffix: 'aug', intervals: [0, 4, 8]},
  {suffix: 'sus4', intervals: [0, 5, 7]},
  {suffix: 'sus2', intervals: [0, 2, 7]},
  {suffix: '5', intervals: [0, 7]},
];

export function nameChord(pitches: number[]): string {
  const pitchClasses = [...new Set(pitches.map(pitch => ((Math.round(pitch) % 12) + 12) % 12))].sort((a, b) => a - b);
  if (pitchClasses.length < 2) return pitchClasses.length ? NOTE_NAMES[pitchClasses[0]] : '';
  for (let root = 0; root < 12; root += 1) {
    if (!pitchClasses.includes(root)) continue;
    const intervals = pitchClasses.map(pitch => (pitch - root + 12) % 12).sort((a, b) => a - b);
    for (const quality of QUALITIES) {
      if (intervals.length === quality.intervals.length
        && intervals.every((value, index) => value === quality.intervals[index])) {
        return `${NOTE_NAMES[root]}${quality.suffix}`;
      }
    }
  }
  return `${NOTE_NAMES[pitchClasses[0]]}?`;
}

export type DetectedChord = {id: string; name: string; start: number; frets: number[]; position: number};

/**
 * Detect strummed chord clusters from performance notes: 3+ distinct strings whose
 * attacks fall inside a 55 ms window. Unplayable clusters (wider than four frets) are
 * skipped because they cannot be rendered as a reviewed shape.
 */
export function detectGuitarChords(
  notes: ReadonlyArray<{id: string; onset: number; pitch: number; string: number | null; fret: number | null}>,
): DetectedChord[] {
  const ordered = [...notes].sort((left, right) => left.onset - right.onset || left.pitch - right.pitch);
  const clusters: Array<typeof ordered> = [];
  for (const note of ordered) {
    const current = clusters[clusters.length - 1];
    if (current && note.onset - current[0].onset <= 0.055) current.push(note);
    else clusters.push([note]);
  }
  const chords: DetectedChord[] = [];
  let index = 0;
  for (const cluster of clusters) {
    if (chords.length >= 100) break;
    if (cluster.length < 3) continue;
    const frets = [-1, -1, -1, -1, -1, -1];
    for (const note of cluster) {
      if (note.string == null || note.fret == null) continue;
      if (note.string < 1 || note.string > 6 || note.fret < 0 || note.fret > 24) continue;
      // GuitarChord.frets is ordered low E to high E, while strings number high to low.
      frets[6 - note.string] = note.fret;
    }
    if (frets.filter(fret => fret >= 0).length < 3) continue;
    const positive = frets.filter(fret => fret > 0);
    const minFret = positive.length ? Math.min(...positive) : 1;
    const maxFret = positive.length ? Math.max(...positive) : 1;
    if (maxFret - minFret > 3) continue;
    index += 1;
    chords.push({
      id: `detected-${index}`,
      name: nameChord(cluster.map(note => note.pitch)),
      start: cluster[0].onset,
      frets,
      position: Math.max(1, Math.min(24, minFret)),
    });
  }
  return chords;
}

/** Frets for an open-position chord voicing from its sounding strings. */
export function fretsForPosition(positions: ReadonlyArray<{string: number; fret: number}>): number[] {
  const frets = [-1, -1, -1, -1, -1, -1];
  for (const position of positions) {
    if (position.string >= 1 && position.string <= 6) frets[6 - position.string] = position.fret;
  }
  return frets;
}

export function pitchOnString(string: number, fret: number): number | null {
  const open = OPEN_STRING[string];
  return open === undefined ? null : open + fret;
}
