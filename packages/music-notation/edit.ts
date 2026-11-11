/**
 * Intentional edits on the shared notation document.
 *
 * Timing policy:
 * - pitch changes update the linked performance pitch and every tied notation segment;
 * - duration changes preserve the performance onset, overwrite following material in
 *   the same voice, and update the linked performance length;
 * - staff, spelling, tie and formatting edits never change performance seconds;
 * - tempo changes notation playback speed only; the source video still uses the
 *   reviewed performance seconds.
 */
import {
  GRID, type NotationDocument, type NotationEvent, type NotationNote,
  type NotationStaff, type NotationVoice, type PerformanceNote, type Tie,
} from './types';
import { refreshNotation } from './build';
import { snapTick } from './rhythm';
import { accidentalName, keySignature, parseSpelling, spellPitch } from './spelling';

export type InsertNoteInput = {
  pitch: number;
  start: number;
  duration: number;
  staff?: NotationStaff;
  voice?: NotationVoice;
};

export type InsertRestInput = {
  start: number;
  duration: number;
  staff: NotationStaff;
  voice: NotationVoice;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function noteIds(event: NotationEvent): string[] {
  return event.notes.map(note => note.id);
}

export function findEventByNote(document: NotationDocument, noteId: string): NotationEvent | null {
  return document.events.find(event => event.notes.some(note => note.id === noteId)) ?? null;
}

export function findEvent(document: NotationDocument, eventId: string): NotationEvent | null {
  return document.events.find(event => event.id === eventId) ?? null;
}

function linkedPerformance(document: NotationDocument, note: NotationNote): PerformanceNote[] {
  return note.performance_ids.map(id => document.performance.find(item => item.id === id)).filter((item): item is PerformanceNote => Boolean(item));
}

function updatePerformancePitch(document: NotationDocument, note: NotationNote, pitch: number): void {
  for (const performance of linkedPerformance(document, note)) performance.pitch = pitch;
}

function updatePerformanceDuration(document: NotationDocument, event: NotationEvent, seconds: number): void {
  const ids = new Set(event.notes.flatMap(note => note.performance_ids));
  for (const performance of document.performance) {
    if (!ids.has(performance.id)) continue;
    // The written score may extend past the clip; the source performance cannot.
    performance.duration = Math.min(seconds, Math.max(0.01, document.duration - performance.onset));
  }
}

function removePerformanceFor(document: NotationDocument, event: NotationEvent): void {
  const ids = new Set(event.notes.flatMap(note => note.performance_ids));
  if (ids.size) document.performance = document.performance.filter(item => !ids.has(item.id));
}

function respellNote(document: NotationDocument, note: NotationNote, pitch: number): void {
  const spelling = spellPitch(pitch, document.key_signature);
  note.pitch = pitch;
  note.spelling = spelling.spelling;
  note.accidental = accidentalName(spelling.alter);
}

function removeOverlap(document: NotationDocument, event: NotationEvent, start: number, duration: number): void {
  const end = start + duration;
  const keep: NotationEvent[] = [];
  for (const candidate of document.events) {
    if (candidate.id === event.id) { keep.push(candidate); continue; }
    if (candidate.staff !== event.staff || candidate.voice !== event.voice) { keep.push(candidate); continue; }
    const candidateEnd = candidate.start + candidate.duration;
    if (candidateEnd <= start) { keep.push(candidate); continue; }
    if (candidate.start >= end) { keep.push(candidate); continue; }
    if (candidate.start < start) {
      // Keep the earlier part, ending exactly where the edited event starts.
      candidate.duration = start - candidate.start;
      if (candidate.duration >= GRID) {
        updatePerformanceDuration(document, candidate, candidate.duration * secondsPerTick(document));
        keep.push(candidate);
      } else {
        removePerformanceFor(document, candidate);
      }
      continue;
    }
    // A later event inside the new span is overwritten, including its performance link.
    removePerformanceFor(document, candidate);
  }
  document.events = keep;
}

/** Change one note's sounding pitch; tied segments and the linked performance follow. */
export function changePitch(document: NotationDocument, noteId: string, pitch: number): NotationDocument {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new Error('Pitch must be between 0 and 127.');
  const next = clone(document);
  const event = findEventByNote(next, noteId);
  if (!event) throw new Error('That note is no longer in the score.');
  const note = event.notes.find(item => item.id === noteId)!;
  if (note.pitch === pitch) return document;
  respellNote(next, note, pitch);
  updatePerformancePitch(next, note, pitch);
  return refreshNotation(next);
}

/** Respell without changing the sounding pitch (sharp/flat/natural). */
export function respellAccidental(document: NotationDocument, noteId: string, accidental: 'sharp' | 'flat' | 'natural'): NotationDocument {
  const next = clone(document);
  const event = findEventByNote(next, noteId);
  if (!event) throw new Error('That note is no longer in the score.');
  const note = event.notes.find(item => item.id === noteId)!;
  const parsed = parseSpelling(note.spelling);
  if (accidental === 'natural') {
    if (parsed.alter === 0) return next;
    // A natural spelling only exists for white keys; black keys cannot be
    // respelled as naturals without changing their sounding pitch.
    const natural = spellPitch(note.pitch, 'C');
    if (natural.alter !== 0) throw new Error('That pitch cannot be written as a natural.');
    note.spelling = natural.spelling;
    note.accidental = null;
    return refreshNotation(next);
  }
  const spelling = spellPitch(note.pitch, accidental === 'flat' ? 'F' : 'C');
  if (spelling.alter !== (accidental === 'flat' ? -1 : 1)) {
    throw new Error(`That pitch cannot be written as a ${accidental} without changing its sound.`);
  }
  note.spelling = spelling.spelling;
  note.accidental = accidental;
  return refreshNotation(next);
}

function eventForNewNote(next: NotationDocument, start: number, duration: number, staff: NotationStaff, voice: NotationVoice): NotationEvent | null {
  return next.events.find(event => event.staff === staff && event.voice === voice && event.start === start
    && event.duration === duration && !event.rest) ?? null;
}

function removeRestsInSpan(document: NotationDocument, staff: NotationStaff, voice: NotationVoice, start: number, duration: number): void {
  const end = start + duration;
  document.events = document.events.filter(event => !(event.rest && event.staff === staff && event.voice === voice
    && event.start < end && event.start + event.duration > start));
}

/** Insert a pitch as a new event, or add it to an identical rhythmic event to form a chord. */
export function insertNote(document: NotationDocument, input: InsertNoteInput): NotationDocument {
  if (!Number.isInteger(input.pitch) || input.pitch < 0 || input.pitch > 127) throw new Error('Pitch must be between 0 and 127.');
  const start = snapTick(input.start);
  const duration = Math.max(GRID, snapTick(input.duration));
  const staff = input.staff ?? (input.pitch >= document.staff_split_pitch ? 'treble' : 'bass');
  const voice = input.voice ?? 1;
  const next = clone(document);
  const existing = eventForNewNote(next, start, duration, staff, voice);
  const id = `n-add-${cryptoId()}`;
  const spelling = spellPitch(input.pitch, next.key_signature);
  const performanceId = `authored-${id}`;
  const performance: PerformanceNote = {
    id: performanceId, onset: start * secondsPerTick(next),
    duration: Math.min(duration * secondsPerTick(next), Math.max(0.01, next.duration - start * secondsPerTick(next))),
    pitch: input.pitch, velocity: 0.7, confidence: null, optional: false, string: null, fret: null,
  };
  if (existing) {
    if (existing.notes.some(note => note.pitch === input.pitch)) return document;
    removeRestsInSpan(next, staff, voice, start, duration);
    existing.notes.push({ id, pitch: input.pitch, spelling: spelling.spelling,
      accidental: accidentalName(spelling.alter), performance_ids: [performanceId] });
    existing.notes.sort((left, right) => left.pitch - right.pitch);
    next.performance.push(performance);
    return refreshNotation(next);
  }
  const event: NotationEvent = {
    id: `ev-add-${cryptoId()}`,
    staff,
    voice,
    start,
    duration,
    notes: [{ id, pitch: input.pitch, spelling: spelling.spelling, accidental: accidentalName(spelling.alter), performance_ids: [performanceId] }],
    rest: false,
    source: 'inserted',
  };
  // The new event owns its span; anything it covers in the same voice is overwritten.
  removeOverlap(next, event, start, duration);
  next.events.push(event);
  next.events.sort((left, right) => left.start - right.start || left.staff.localeCompare(right.staff) || left.voice - right.voice);
  // Keep an authored performance note so the piano roll and playback have a concrete event.
  next.performance.push(performance);
  return refreshNotation(next);
}

function secondsPerTick(document: NotationDocument): number {
  return 60 / (document.tempo.bpm * document.ppq);
}

/** Silence a span. Notes in the same voice are overwritten and the gap renders as rests. */
export function insertRest(document: NotationDocument, input: InsertRestInput): NotationDocument {
  const start = snapTick(input.start);
  const duration = Math.max(GRID, snapTick(input.duration));
  const next = clone(document);
  const rest: NotationEvent = {
    id: `ev-rest-${cryptoId()}`,
    staff: input.staff,
    voice: input.voice,
    start,
    duration,
    notes: [],
    rest: true,
    source: 'rest',
  };
  removeOverlap(next, rest, start, duration);
  next.events.push(rest);
  return refreshNotation(next);
}

/** Move an event and its linked performance notes to a new tick position. */
export function moveEvent(document: NotationDocument, eventId: string, start: number): NotationDocument {
  const ticks = Math.max(0, snapTick(start));
  const next = clone(document);
  const event = findEvent(next, eventId);
  if (!event) throw new Error('That note is no longer in the score.');
  const seconds = ticks * secondsPerTick(next);
  const ids = new Set(event.notes.flatMap(note => note.performance_ids));
  const linked = next.performance.filter(performance => ids.has(performance.id));
  if (linked.some(performance => seconds + (performance.duration ?? 0) > next.duration + 1e-6)) {
    throw new Error('That start would put the note past the end of the clip.');
  }
  removeOverlap(next, event, ticks, event.duration);
  event.start = ticks;
  for (const performance of linked) performance.onset = seconds;
  return refreshNotation(next);
}

/** Change the written rhythm of an event. The performance onset is preserved. */
export function changeDuration(document: NotationDocument, eventId: string, duration: number): NotationDocument {
  const ticks = Math.max(GRID, snapTick(duration));
  const next = clone(document);
  const event = findEvent(next, eventId);
  if (!event) throw new Error('That rhythm is no longer in the score.');
  if (event.duration === ticks) return document;
  removeOverlap(next, event, event.start, ticks);
  event.duration = ticks;
  updatePerformanceDuration(next, event, ticks * secondsPerTick(next));
  return refreshNotation(next);
}

/** Move a whole event to the other staff, keeping its rhythm and pitch. */
export function changeStaff(document: NotationDocument, eventId: string, staff: NotationStaff): NotationDocument {
  const next = clone(document);
  const event = findEvent(next, eventId);
  if (!event) throw new Error('That note is no longer in the score.');
  if (event.staff === staff) return next;
  const voiceEnds = (voice: NotationVoice) => Math.max(-1, ...next.events
    .filter(item => item.id !== event.id && item.staff === staff && item.voice === voice)
    .map(item => item.start + item.duration));
  const voice: NotationVoice = voiceEnds(1) <= event.start ? 1 : voiceEnds(2) <= event.start ? 2 : 1;
  event.staff = staff;
  event.voice = voice;
  // The old voice may now have a gap; the new voice may need trimming.
  const clashing = next.events.filter(item => item.id !== event.id && item.staff === staff && item.voice === voice
    && item.start < event.start + event.duration && item.start + item.duration > event.start);
  for (const item of clashing) {
    if (item.start >= event.start && item.start < event.start + event.duration) {
      removePerformanceFor(next, item);
      next.events = next.events.filter(candidate => candidate.id !== item.id);
    } else if (item.start < event.start) {
      item.duration = Math.max(GRID, event.start - item.start);
      updatePerformanceDuration(next, item, item.duration * secondsPerTick(next));
    }
  }
  return refreshNotation(next);
}

/** Move one note of a chord to the other staff without moving the rest of the chord. */
export function changeNoteStaff(document: NotationDocument, noteId: string, staff: NotationStaff): NotationDocument {
  const next = clone(document);
  const event = findEventByNote(next, noteId);
  if (!event) throw new Error('That note is no longer in the score.');
  if (event.staff === staff) return next;
  if (event.notes.length === 1) return changeStaff(next, event.id, staff);
  const note = event.notes.find(item => item.id === noteId)!;
  event.notes = event.notes.filter(item => item.id !== noteId);
  const voiceEnds = (voice: NotationVoice) => Math.max(-1, ...next.events
    .filter(item => item.id !== event.id && item.staff === staff && item.voice === voice)
    .map(item => item.start + item.duration));
  const voice: NotationVoice = voiceEnds(1) <= event.start ? 1 : voiceEnds(2) <= event.start ? 2 : 1;
  const split: NotationEvent = {
    id: `ev-split-${noteId}`.slice(0, 80),
    staff,
    voice,
    start: event.start,
    duration: event.duration,
    notes: [note],
    rest: false,
    source: 'inserted',
  };
  next.events.push(split);
  return refreshNotation(next);
}

/** Remove an explicit rest and close its gap by pulling later events in the voice earlier. */
export function deleteRest(document: NotationDocument, restId: string): NotationDocument {
  const next = clone(document);
  const rest = findEvent(next, restId);
  if (!rest || !rest.rest) return next;
  const delta = rest.duration;
  const end = rest.start + rest.duration;
  next.events = next.events.filter(event => event.id !== restId);
  for (const event of next.events) {
    if (event.staff !== rest.staff || event.voice !== rest.voice || event.start < end) continue;
    event.start = Math.max(0, event.start - delta);
    const seconds = event.start * secondsPerTick(next);
    const ids = new Set(event.notes.flatMap(note => note.performance_ids));
    for (const performance of next.performance) if (ids.has(performance.id)) performance.onset = seconds;
  }
  return refreshNotation(next);
}

export function deleteNote(document: NotationDocument, noteId: string): NotationDocument {
  const next = clone(document);
  const event = findEventByNote(next, noteId);
  if (!event) return next;
  const note = event.notes.find(item => item.id === noteId)!;
  const removed = new Set(note.performance_ids);
  next.performance = next.performance.filter(item => !removed.has(item.id));
  event.notes = event.notes.filter(item => item.id !== noteId);
  if (!event.notes.length) next.events = next.events.filter(item => item.id !== event.id);
  return refreshNotation(next);
}

export function deleteEvent(document: NotationDocument, eventId: string): NotationDocument {
  const next = clone(document);
  const event = findEvent(next, eventId);
  if (!event) return next;
  const removed = new Set(event.notes.flatMap(note => note.performance_ids));
  next.performance = next.performance.filter(item => !removed.has(item.id));
  next.events = next.events.filter(item => item.id !== eventId);
  return refreshNotation(next);
}

export function setTempo(document: NotationDocument, bpm: number, source: 'estimated' | 'instructor' = 'instructor'): NotationDocument {
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) throw new Error('Tempo must be between 20 and 300 BPM.');
  if (document.tempo.bpm === bpm && document.tempo.source === source) return document;
  const next = clone(document);
  next.tempo = { ...next.tempo, bpm, source };
  return refreshNotation(next);
}

export function setTimeSignature(document: NotationDocument, numerator: number, denominator: 1 | 2 | 4 | 8 | 16): NotationDocument {
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) throw new Error('The time signature is out of range.');
  const next = clone(document);
  next.time_signature = { numerator, denominator };
  const ticks = Math.round(next.ppq * 4 * numerator / denominator);
  next.measures = next.measures.map((measure, index) => ({ ...measure, id: `measure-${index + 1}`, index, start: index * ticks, duration: ticks }));
  return refreshNotation(next);
}

export function setKeySignature(document: NotationDocument, key: string): NotationDocument {
  keySignature(key);
  const next = clone(document);
  next.key_signature = key;
  for (const event of next.events) for (const note of event.notes) respellNote(next, note, note.pitch);
  return refreshNotation(next);
}

/**
 * Extend a note into the immediately following same-pitch note in its voice,
 * producing a tie across the beat or barline. This is a merge, so undo restores
 * the two source notes exactly.
 */
export function tieToNext(document: NotationDocument, noteId: string): NotationDocument {
  const next = clone(document);
  const event = findEventByNote(next, noteId);
  if (!event) throw new Error('That note is no longer in the score.');
  const note = event.notes.find(item => item.id === noteId)!;
  const end = event.start + event.duration;
  const following = next.events.find(item => item.staff === event.staff && item.voice === event.voice
    && item.start === end && !item.rest && item.notes.some(candidate => candidate.pitch === note.pitch));
  if (!following) throw new Error('There is no adjacent note of the same pitch to tie.');
  const followingNote = following.notes.find(candidate => candidate.pitch === note.pitch)!;
  event.duration += following.duration;
  // A tie means one sounding note: the second attack is absorbed, not duplicated.
  const absorbed = new Set(followingNote.performance_ids);
  next.performance = next.performance.filter(item => !absorbed.has(item.id));
  following.notes = following.notes.filter(candidate => candidate.id !== followingNote.id);
  if (!following.notes.length) next.events = next.events.filter(item => item.id !== following.id);
  // Tied performance events keep the summed written length for playback.
  updatePerformanceDuration(next, event, event.duration * secondsPerTick(next));
  return refreshNotation(next);
}

/** Remove a tie by splitting the last written value off a merged note. */
export function untieLast(document: NotationDocument, eventId: string): NotationDocument {
  const next = clone(document);
  const event = findEvent(next, eventId);
  if (!event) return next;
  const segments = next.segments.filter(segment => segment.event_id === eventId);
  if (segments.length < 2) return next;
  const last = segments[segments.length - 1];
  const duration = last.duration;
  if (event.duration - duration < GRID) throw new Error('The note cannot be split again.');
  event.duration -= duration;
  updatePerformanceDuration(next, event, event.duration * secondsPerTick(next));
  return refreshNotation(next);
}

/** Change the approximate performance velocity only; notation and timing are untouched. */
export function setVelocity(document: NotationDocument, noteId: string, velocity: number | null): NotationDocument {
  if (velocity !== null && (!Number.isFinite(velocity) || velocity < 0 || velocity > 1)) throw new Error('Velocity must be between 0 and 1.');
  const next = clone(document);
  const found = noteById(next, noteId);
  if (!found) throw new Error('That note is no longer in the score.');
  const linked = linkedPerformance(next, found.note);
  if (!linked.length || linked.every(performance => performance.velocity === velocity)) return document;
  for (const performance of linked) performance.velocity = velocity;
  return refreshNotation(next);
}

/**
 * Change the sustained performance length without changing the written value.
 * This is the escape hatch for pedal/sustain detail that the score does not encode;
 * the roll reflects it, while the staff keeps its musical duration.
 */
export function setPerformanceDuration(document: NotationDocument, noteId: string, seconds: number): NotationDocument {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Performance length must be positive.');
  const next = clone(document);
  const found = noteById(next, noteId);
  if (!found) throw new Error('That note is no longer in the score.');
  const linked = linkedPerformance(next, found.note);
  if (!linked.length) throw new Error('That authored note has no performance event.');
  if (linked.every(performance => performance.duration === seconds)) return document;
  if (linked.some(performance => performance.onset + seconds > next.duration + 1e-6)) {
    throw new Error('The performance length would end outside the clip.');
  }
  for (const performance of linked) performance.duration = seconds;
  return refreshNotation(next);
}

export function noteById(document: NotationDocument, noteId: string): {event: NotationEvent; note: NotationNote} | null {
  for (const event of document.events) {
    const note = event.notes.find(item => item.id === noteId);
    if (note) return { event, note };
  }
  return null;
}

export function eventStartSeconds(document: NotationDocument, event: NotationEvent): number {
  return event.start * secondsPerTick(document);
}

export function eventDurationSeconds(document: NotationDocument, event: NotationEvent): number {
  return event.duration * secondsPerTick(document);
}

export function selectionForNote(document: NotationDocument, noteId: string): { event: NotationEvent; note: NotationNote; measureIndex: number; performanceIds: string[] } | null {
  const found = noteById(document, noteId);
  if (!found) return null;
  const measureIndex = document.measures.find(measure => found.event.start >= measure.start && found.event.start < measure.start + measure.duration)?.index ?? 0;
  return { ...found, measureIndex, performanceIds: [...found.note.performance_ids] };
}

/** Stable-enough id for authored objects; crypto is available in browsers and Node 22. */
function cryptoId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID().replaceAll('-', '').slice(0, 16);
  return Math.random().toString(36).slice(2, 18);
}

export function tieSummary(document: NotationDocument): Tie[] {
  return document.ties;
}
