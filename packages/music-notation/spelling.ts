/** Pitch spelling and key-signature helpers shared by the notation reader, editor and exporter. */
import type { NotationAccidental } from './types';

export type KeySignature = {
  name: string;
  fifths: number;
  mode: 'major' | 'minor';
};

/** Major keys, plus the common minor keys, with MusicXML fifths and display spelling. */
const KEYS: KeySignature[] = [
  { name: 'Cb', fifths: -7, mode: 'major' },
  { name: 'Gb', fifths: -6, mode: 'major' },
  { name: 'Db', fifths: -5, mode: 'major' },
  { name: 'Ab', fifths: -4, mode: 'major' },
  { name: 'Eb', fifths: -3, mode: 'major' },
  { name: 'Bb', fifths: -2, mode: 'major' },
  { name: 'F', fifths: -1, mode: 'major' },
  { name: 'C', fifths: 0, mode: 'major' },
  { name: 'G', fifths: 1, mode: 'major' },
  { name: 'D', fifths: 2, mode: 'major' },
  { name: 'A', fifths: 3, mode: 'major' },
  { name: 'E', fifths: 4, mode: 'major' },
  { name: 'B', fifths: 5, mode: 'major' },
  { name: 'F#', fifths: 6, mode: 'major' },
  { name: 'C#', fifths: 7, mode: 'major' },
  { name: 'Abm', fifths: -7, mode: 'minor' },
  { name: 'Ebm', fifths: -6, mode: 'minor' },
  { name: 'Bbm', fifths: -5, mode: 'minor' },
  { name: 'Fm', fifths: -4, mode: 'minor' },
  { name: 'Cm', fifths: -3, mode: 'minor' },
  { name: 'Gm', fifths: -2, mode: 'minor' },
  { name: 'Dm', fifths: -1, mode: 'minor' },
  { name: 'Am', fifths: 0, mode: 'minor' },
  { name: 'Em', fifths: 1, mode: 'minor' },
  { name: 'Bm', fifths: 2, mode: 'minor' },
  { name: 'F#m', fifths: 3, mode: 'minor' },
  { name: 'C#m', fifths: 4, mode: 'minor' },
  { name: 'G#m', fifths: 5, mode: 'minor' },
  { name: 'D#m', fifths: 6, mode: 'minor' },
  { name: 'A#m', fifths: 7, mode: 'minor' },
];

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const NATURAL_PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const SHARP_SPELL = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_SPELL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LONG_NAMES: Record<string, string> = {
  C: 'C major', 'C#': 'C-sharp major', Db: 'D-flat major', D: 'D major', 'D#': 'D-sharp major',
  Eb: 'E-flat major', E: 'E major', F: 'F major', 'F#': 'F-sharp major', Gb: 'G-flat major',
  G: 'G major', 'G#': 'G-sharp major', Ab: 'A-flat major', A: 'A major', 'A#': 'A-sharp major',
  Bb: 'B-flat major', B: 'B major', Cb: 'C-flat major',
  Am: 'A minor', 'A#m': 'A-sharp minor', Bbm: 'B-flat minor', Bm: 'B minor', Cm: 'C minor',
  'C#m': 'C-sharp minor', Dm: 'D minor', 'D#m': 'D-sharp minor', Ebm: 'E-flat minor',
  Em: 'E minor', Fm: 'F minor', 'F#m': 'F-sharp minor', Gm: 'G minor', 'G#m': 'G-sharp minor',
  Abm: 'A-flat minor',
};

export function keySignature(name: string): KeySignature {
  const found = KEYS.find(key => key.name === name);
  if (!found) throw new Error(`Unknown key signature ${name}.`);
  return found;
}

export function keyName(fifths: number, mode: 'major' | 'minor' = 'major'): string {
  const found = KEYS.find(key => key.fifths === fifths && key.mode === mode);
  return found?.name ?? 'C';
}

/** Long display name used in the editor inspector. */
export function keyLabel(name: string): string {
  return LONG_NAMES[name] ?? keySignature(name).name;
}

/** Alteration the key signature applies to a letter (F in G major -> +1). */
export function keyAlter(letter: string, name: string): number {
  const key = keySignature(name);
  if (key.fifths > 0 && SHARP_ORDER.slice(0, key.fifths).includes(letter)) return 1;
  if (key.fifths < 0 && FLAT_ORDER.slice(0, -key.fifths).includes(letter)) return -1;
  return 0;
}

export type Spelling = { spelling: string; letter: string; alter: number; octave: number };

/** Spell a MIDI pitch in the key's prevailing accidental direction. */
export function spellPitch(pitch: number, key = 'C'): Spelling {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new Error('Invalid MIDI pitch.');
  const keySignatureValue = keySignature(key);
  const flat = keySignatureValue.fifths < 0;
  const pitchClass = ((pitch % 12) + 12) % 12;
  const octave = Math.floor(pitch / 12) - 1;
  const table = flat ? FLAT_SPELL : SHARP_SPELL;
  const spelling = `${table[pitchClass]}${octave}`;
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(spelling);
  if (!match) throw new Error('Could not spell the pitch.');
  return {
    spelling,
    letter: match[1],
    alter: match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0,
    octave: Number(match[3]),
  };
}

export function parseSpelling(spelling: string): { letter: string; alter: number; octave: number; pitch: number } {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(spelling);
  if (!match) throw new Error(`Invalid pitch spelling ${spelling}.`);
  const letter = match[1];
  const alter = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  const octave = Number(match[3]);
  if (octave < -1 || octave > 9) throw new Error('Pitch octave is out of range.');
  const pitch = (octave + 1) * 12 + NATURAL_PITCH[letter] + alter;
  if (pitch < 0 || pitch > 127) throw new Error('Pitch is outside MIDI range.');
  return { letter, alter, octave, pitch };
}

/**
 * Whether the notation should print an accidental. This intentionally prints a
 * cancellation when the key signature already alters the letter. It does not try
 * to suppress repeated accidentals inside a measure (a harmless courtesy mark).
 */
export function displayAccidental(letter: string, alter: number, key: string): boolean {
  return alter !== keyAlter(letter, key);
}

export function accidentalName(alter: number): NotationAccidental {
  if (alter > 0) return 'sharp';
  if (alter < 0) return 'flat';
  return 'natural';
}

/** Choose the enharmonic spelling with the fewest accidentals for a score key. */
export function respell(pitch: number, key: string): Spelling {
  return spellPitch(pitch, key);
}

/** Diatonic index used by the staff geometry. C4 -> 28, D4 -> 29, ... */
export function diatonicIndex(letter: string, octave: number): number {
  return octave * 7 + LETTERS.indexOf(letter as (typeof LETTERS)[number]);
}

export const KEY_OPTIONS = KEYS.filter(key => key.mode === 'major').map(key => ({
  value: key.name,
  label: LONG_NAMES[key.name] ?? key.name,
}));
