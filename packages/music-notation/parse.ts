/**
 * Runtime reader for a saved notation document. It validates the editable model
 * and recomputes derived segments/ties so a tampered or stale `segments` array
 * can never change what is displayed or exported.
 */
import {
  GRID, MAX_EVENTS, MAX_MEASURES, MAX_NOTATION_NOTES, PPQ,
  type Measure, type NotationDocument, type NotationEvent, type NotationNote,
  type PerformanceNote,
} from './types';
import { refreshNotation } from './build';
import { measureTicks } from './rhythm';
import { keySignature, parseSpelling } from './spelling';

const STAFFS = ['treble', 'bass'] as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The notation is not a document.');
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 80): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error(`The notation has an invalid ${name}.`);
  return value;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`The notation has an invalid ${name}.`);
  }
  return value as number;
}

function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`The notation has an invalid ${name}.`);
  return value;
}

function parsePerformance(value: unknown): PerformanceNote[] {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) throw new Error('The notation has no valid performance events.');
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const item = record(raw);
    const id = text(item.id, `performance id ${index + 1}`);
    if (ids.has(id)) throw new Error('The notation repeats a performance id.');
    ids.add(id);
    const onset = number(item.onset, `performance onset ${index + 1}`);
    if (onset < 0) throw new Error('A performance onset is negative.');
    const pitch = integer(item.pitch, `performance pitch ${index + 1}`, 0, 127);
    const duration = item.duration == null ? null : number(item.duration, `performance duration ${index + 1}`);
    if (duration !== null && duration <= 0) throw new Error('A performance duration is not positive.');
    const notationDuration = item.notation_duration == null ? null
      : number(item.notation_duration, `performance written duration ${index + 1}`);
    if (notationDuration !== null && notationDuration <= 0) throw new Error('A performance written duration is not positive.');
    const velocity = item.velocity == null ? null : number(item.velocity, `performance velocity ${index + 1}`);
    if (velocity !== null && (velocity < 0 || velocity > 1)) throw new Error('A performance velocity is out of range.');
    const confidence = item.confidence == null ? null : number(item.confidence, `performance confidence ${index + 1}`);
    if (confidence !== null && (confidence < 0 || confidence > 1)) throw new Error('A performance confidence is out of range.');
    if (item.optional != null && typeof item.optional !== 'boolean') throw new Error('A performance optional flag is invalid.');
    const string = item.string == null ? null : number(item.string, `performance string ${index + 1}`);
    const fret = item.fret == null ? null : number(item.fret, `performance fret ${index + 1}`);
    if ((string === null) !== (fret === null)) throw new Error('A performance position needs both string and fret.');
    if (string !== null && (!Number.isInteger(string) || string < 1 || string > 6 || fret === null || !Number.isInteger(fret) || fret < 0 || fret > 12)) {
      throw new Error('A performance position is invalid.');
    }
    return { id, onset, duration, ...(notationDuration != null ? {notation_duration: notationDuration} : {}), pitch, velocity, confidence, optional: item.optional === true, string, fret };
  });
}

function parseNotes(value: unknown, eventIndex: number): NotationNote[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`Notation event ${eventIndex + 1} has no notes.`);
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const item = record(raw);
    const id = text(item.id, `note id in event ${eventIndex + 1}`);
    if (ids.has(id)) throw new Error('A notation chord repeats a note id.');
    ids.add(id);
    const pitch = integer(item.pitch, `note pitch in event ${eventIndex + 1}`, 0, 127);
    const spelling = text(item.spelling, `note spelling in event ${eventIndex + 1}`, 12);
    if (parseSpelling(spelling).pitch !== pitch) throw new Error('A notation spelling does not match its pitch.');
    const accidental = item.accidental ?? null;
    if (accidental !== null && accidental !== 'sharp' && accidental !== 'flat' && accidental !== 'natural') {
      throw new Error('A notation accidental is invalid.');
    }
    if (!Array.isArray(item.performance_ids) || item.performance_ids.length > 64) throw new Error('A notation note has invalid performance links.');
    const performanceIds = item.performance_ids.map(value => text(value, 'performance link'));
    return { id, pitch, spelling, accidental, performance_ids: performanceIds };
  });
}

function parseMeasures(value: unknown, time: { numerator: number; denominator: 1 | 2 | 4 | 8 | 16 }): Measure[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_MEASURES) throw new Error('The notation has no valid measures.');
  const ticks = measureTicks(time);
  return value.map((raw, index) => {
    const item = record(raw);
    const measure: Measure = {
      id: text(item.id, `measure ${index + 1} id`, 40),
      index: integer(item.index, `measure ${index + 1} index`, 0, MAX_MEASURES - 1),
      start: integer(item.start, `measure ${index + 1} start`, 0, 10_000_000),
      duration: integer(item.duration, `measure ${index + 1} duration`, 1, 100_000),
    };
    if (measure.index !== index) throw new Error('Measures must be ordered from zero.');
    if (measure.start !== index * ticks) throw new Error('Measures must be contiguous from the start of the score.');
    if (measure.duration !== ticks) throw new Error('Every measure must have the current time signature length.');
    return measure;
  });
}

/** Validate a saved notation document and rebuild its derived segments and ties. */
export function parseNotationDocument(value: unknown): NotationDocument {
  const document = record(value);
  if (document.notation_version !== 1) throw new Error('This notation document has an unsupported version.');
  if (document.subject !== 'piano') throw new Error('Notation editing is only available for piano lessons.');
  const duration = number(document.duration, 'duration');
  if (duration <= 0) throw new Error('The notation has no duration.');
  if (document.ppq !== PPQ) throw new Error('The notation uses an unsupported tick resolution.');
  const tempo = record(document.tempo);
  const bpm = number(tempo.bpm, 'tempo');
  if (bpm < 20 || bpm > 300) throw new Error('The notation tempo is out of range.');
  if (tempo.beat_unit !== 4 || tempo.mode !== 'notation') throw new Error('The notation tempo mode is unsupported.');
  if (tempo.source !== 'estimated' && tempo.source !== 'instructor') throw new Error('The notation tempo source is invalid.');
  const time = record(document.time_signature);
  const numerator = integer(time.numerator, 'time signature numerator', 1, 32);
  const denominator = integer(time.denominator, 'time signature denominator', 1, 16);
  if (![1, 2, 4, 8, 16].includes(denominator)) throw new Error('The notation time signature is unsupported.');
  const signature = { numerator, denominator: denominator as 1 | 2 | 4 | 8 | 16 };
  const key = text(document.key_signature, 'key signature', 4);
  keySignature(key);
  const performance = parsePerformance(document.performance);
  for (const note of performance) {
    if (note.duration != null && note.onset + note.duration > duration + 1e-6) {
      throw new Error('A notation performance note ends outside the clip.');
    }
  }
  if (!Array.isArray(document.events) || document.events.length > MAX_EVENTS) throw new Error('The notation has no valid events.');
  const eventIds = new Set<string>();
  const noteIds = new Set<string>();
  let noteCount = 0;
  const events: NotationEvent[] = document.events.map((raw, index) => {
    const item = record(raw);
    const id = text(item.id, `event ${index + 1} id`, 80);
    if (eventIds.has(id)) throw new Error('The notation repeats an event id.');
    eventIds.add(id);
    const staff = item.staff;
    if (staff !== 'treble' && staff !== 'bass') throw new Error('A notation event has an invalid staff.');
    const voice = item.voice;
    if (voice !== 1 && voice !== 2) throw new Error('A notation event has an invalid voice.');
    const start = integer(item.start, `event ${index + 1} start`, 0, 10_000_000);
    const length = integer(item.duration, `event ${index + 1} duration`, GRID, 1_000_000);
    if (start % GRID !== 0 || length % GRID !== 0) throw new Error('Notation events must sit on the sixteenth-note grid.');
    const rest = item.rest;
    if (typeof rest !== 'boolean') throw new Error('A notation event has an invalid rest flag.');
    const notes = rest ? [] : parseNotes(item.notes, index);
    if (!rest && !notes.length) throw new Error('A note event needs at least one pitch.');
    if (rest && item.notes != null && (!Array.isArray(item.notes) || item.notes.length)) throw new Error('A rest cannot contain notes.');
    if (new Set(notes.map(note => note.pitch)).size !== notes.length) throw new Error('A chord repeats a pitch.');
    for (const note of notes) {
      if (noteIds.has(note.id)) throw new Error('The notation repeats a note id.');
      noteIds.add(note.id);
      noteCount += 1;
      for (const performanceId of note.performance_ids) {
        if (!performance.some(item => item.id === performanceId)) throw new Error('A notation note links to a missing performance event.');
      }
    }
    if (noteCount > MAX_NOTATION_NOTES) throw new Error('The notation has too many notes.');
    const source = item.source;
    if (source !== 'performance' && source !== 'inserted' && source !== 'rest') throw new Error('A notation event has an invalid source.');
    return { id, staff, voice, start, duration: length, notes, rest, source };
  });
  const byVoice = new Map<string, { start: number; end: number; id: string }[]>();
  for (const event of events) {
    const keyValue = `${event.staff}:${event.voice}`;
    const list = byVoice.get(keyValue) ?? [];
    list.push({ start: event.start, end: event.start + event.duration, id: event.id });
    byVoice.set(keyValue, list);
  }
  for (const list of byVoice.values()) {
    list.sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
    for (let index = 1; index < list.length; index += 1) {
      if (list[index].start < list[index - 1].end) throw new Error('Notation events overlap in the same voice.');
    }
  }
  const measures = parseMeasures(document.measures, signature);
  const split = integer(document.staff_split_pitch, 'staff split', 0, 127);
  const notation: NotationDocument = {
    notation_version: 1,
    subject: 'piano',
    duration,
    ppq: PPQ,
    tempo: { bpm, beat_unit: 4, mode: 'notation', source: tempo.source },
    time_signature: signature,
    key_signature: key,
    staff_split_pitch: split,
    measures,
    events,
    segments: [],
    ties: [],
    performance,
    performance_map: {},
    created_from: document.created_from === 'saved' ? 'saved' : 'performance',
  };
  return refreshNotation(notation);
}

export function isNotationDocument(value: unknown): boolean {
  try { parseNotationDocument(value); return true; } catch { return false; }
}

export const NOTATION_STAFFS = STAFFS;
