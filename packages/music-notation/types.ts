/**
 * Shared piano-notation document.
 *
 * This module deliberately sits beside the performance transcription instead of
 * replacing it. `performance` keeps the exact Basic Pitch seconds and velocity;
 * `events`/`segments` add musical interpretation on top, with every notation note
 * pointing back at the performance event(s) that produced it.
 *
 * The document is browser- and server-neutral so the same reader can validate a
 * saved reference, the editor can mutate it, and the MusicXML adapter can export it.
 */

export const PPQ = 480;
export const GRID = 120; // 16th note, the smallest edited duration in this prototype.
export const MAX_EVENTS = 20000;
export const MAX_MEASURES = 512;
export const MAX_NOTATION_NOTES = 40000;

export type NotationStaff = 'treble' | 'bass';
export type NotationVoice = 1 | 2;
export type NotationAccidental = 'sharp' | 'flat' | 'natural' | null;
export type TieState = 'none' | 'start' | 'stop' | 'both';

export type PerformanceNote = {
  id: string;
  onset: number;
  duration: number | null;
  notation_duration?: number | null;
  pitch: number;
  velocity: number | null;
  confidence: number | null;
  optional: boolean;
  string: number | null;
  fret: number | null;
};

export type Tempo = {
  bpm: number;
  /** Beat unit used by the displayed metronome mark. 4 = quarter-note beat. */
  beat_unit: 4;
  /**
   * `notation` playback follows the written score. It never changes the video
   * alignment: the video clock still uses the original performance seconds.
   */
  mode: 'notation';
  source: 'estimated' | 'instructor';
};

export type TimeSignature = {
  numerator: number;
  denominator: 1 | 2 | 4 | 8 | 16;
};

export type Measure = {
  id: string;
  index: number;
  /** Global tick at the start of the measure. */
  start: number;
  /** Nominal measure length in ticks. */
  duration: number;
};

export type NotationNote = {
  /** Logical note id. One id can own several tied segments. */
  id: string;
  pitch: number;
  /** Scientific pitch notation, e.g. C#4. */
  spelling: string;
  accidental: NotationAccidental;
  performance_ids: string[];
};

/**
 * A logical rhythmic event. Notes sharing an event sound together as a chord.
 * `duration` is written duration in ticks, not the source recording length.
 */
export type NotationEvent = {
  id: string;
  staff: NotationStaff;
  voice: NotationVoice;
  start: number;
  duration: number;
  notes: NotationNote[];
  rest: boolean;
  /** `performance` events are generated from the transcription; `inserted` ones are authored. */
  source: 'performance' | 'inserted' | 'rest';
};

/**
 * A rendered/exportable slice of a logical event. A note longer than a measure or
 * not expressible as one note value becomes several tied segments.
 */
export type NotationSegmentNote = {
  id: string;
  logical_note_id: string;
  pitch: number;
  spelling: string;
  accidental: NotationAccidental;
  /** Whether the glyph itself needs an accidental in the current key. */
  display_accidental: boolean;
  tie_from: boolean;
  tie_to: boolean;
  performance_ids: string[];
};

export type NotationSegment = {
  id: string;
  event_id: string;
  measure_id: string;
  measure_index: number;
  staff: NotationStaff;
  voice: NotationVoice;
  /** Global tick. */
  start: number;
  duration: number;
  /** Note-value name used by the renderer and MusicXML. */
  value: NotationValue;
  dotted: boolean;
  rest: boolean;
  generated_rest: boolean;
  notes: NotationSegmentNote[];
};

export type NotationValue =
  | 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirtysecond' | 'sixtyfourth';

export type Tie = {
  id: string;
  from_segment_note_id: string;
  to_segment_note_id: string;
  pitch: number;
};

export type NotationDocument = {
  notation_version: 1;
  subject: 'piano';
  /** Original video length in seconds. */
  duration: number;
  ppq: 480;
  tempo: Tempo;
  time_signature: TimeSignature;
  key_signature: string;
  /** Notes at or above this MIDI pitch default to the treble staff. Editable per event. */
  staff_split_pitch: number;
  measures: Measure[];
  events: NotationEvent[];
  segments: NotationSegment[];
  ties: Tie[];
  performance: PerformanceNote[];
  /** Performance event id -> logical notation note id. */
  performance_map: Record<string, string>;
  created_from: 'performance' | 'saved';
};

export type BuildOptions = {
  bpm?: number;
  time_signature?: TimeSignature;
  key_signature?: string;
  staff_split_pitch?: number;
  ppq?: 480;
  grid?: number;
  /** Use the reviewed source duration even when the last event ends earlier. */
  duration?: number;
};

export type EditorSelection = {
  event_id: string;
  note_id: string | null;
  segment_note_id: string | null;
  staff: NotationStaff;
  voice: NotationVoice;
  measure_index: number;
  performance_ids: string[];
  /** Present when the selection is a rest or a generated gap. */
  start?: number;
  duration?: number;
};
