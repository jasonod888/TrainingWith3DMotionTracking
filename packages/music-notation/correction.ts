/**
 * Occurrence-scoped correction commands for the shared piano document.
 *
 * Phase 2 foundation. These commands replace the event-wide, destructive edit
 * helpers for correction work: every sound/timing edit targets one performance
 * occurrence, written edits reject instead of deleting neighbours, and no command
 * derives recorded seconds from score ticks.
 *
 * Conventions:
 * - `performance.onset`/`duration` stay in exact seconds and are canonical.
 * - `events`/`segments` stay in ticks and are interpretation only.
 * - A command returns the SAME document identity when it is a no-op or is
 *   rejected; callers can therefore treat identity as "nothing happened".
 */
import {
  GRID, MAX_EVENTS,
  type NotationDocument, type NotationEvent, type NotationNote, type NotationStaff,
  type NotationVoice, type PerformanceNote,
} from './types';
import { refreshNotation } from './build';
import { snapTick } from './rhythm';
import { accidentalName, parseSpelling, spellPitch } from './spelling';

export type CorrectionSelection = {
  occurrenceId: string;
  logicalNoteId: string;
  eventId: string;
  staff: NotationStaff;
  voice: NotationVoice;
  measureIndex: number;
};

export type RejectionCode =
  | 'unknown-occurrence' | 'unknown-note' | 'unknown-event'
  | 'invalid-pitch' | 'invalid-velocity' | 'invalid-onset' | 'invalid-duration'
  | 'invalid-ticks' | 'out-of-bounds' | 'written-overlap' | 'needs-third-voice'
  | 'duplicate-chord-pitch' | 'duplicate-occurrence' | 'ambiguous-insert'
  | 'unsupported-spelling' | 'too-many-occurrences';

export type CommandOutcome =
  | { status: 'applied'; document: NotationDocument; label: string; selection: CorrectionSelection | null }
  | { status: 'unchanged'; label: string }
  | { status: 'rejected'; code: RejectionCode; message: string };

export type WrittenTarget = { eventId: string } | { logicalNoteId: string };

export type CorrectionCommand =
  | { type: 'set-occurrence-pitch'; occurrenceId: string; pitch: number; spelling?: string }
  | { type: 'set-occurrence-onset'; occurrenceId: string; seconds: number; snapSeconds?: number | null }
  | { type: 'set-occurrence-duration'; occurrenceId: string; seconds: number }
  | { type: 'set-occurrence-velocity'; occurrenceId: string; velocity: number | null }
  | { type: 'set-written-duration'; target: WrittenTarget; ticks: number; scope: 'event' | 'note' }
  | { type: 'move-written-start'; eventId: string; ticks: number }
  | { type: 'apply-accidental'; logicalNoteId: string; accidental: 'sharp' | 'flat' | 'natural' }
  | { type: 'respell'; logicalNoteId: string; spelling: string }
  | {
      type: 'insert-note';
      pitch: number;
      onsetSeconds: number;
      durationSeconds: number;
      startTicks?: number;
      durationTicks?: number;
      staff?: NotationStaff;
      voice?: NotationVoice;
      addToChord?: boolean;
    }
  | { type: 'delete-occurrence'; occurrenceId: string }
  | { type: 'delete-logical-note'; logicalNoteId: string };

const EPSILON = 1e-6;

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function secondsPerTick(document: NotationDocument): number {
  return 60 / (document.tempo.bpm * document.ppq);
}

let counter = 0;
function newId(prefix: string): string {
  const cryptoApi = globalThis.crypto as {randomUUID?: () => string} | undefined;
  const token = cryptoApi?.randomUUID
    ? cryptoApi.randomUUID().replaceAll('-', '').slice(0, 16)
    : `${Date.now().toString(36)}${(counter += 1).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${token}`;
}

export function occurrenceById(document: NotationDocument, occurrenceId: string): PerformanceNote | null {
  return document.performance.find(item => item.id === occurrenceId) ?? null;
}

export function noteForOccurrence(document: NotationDocument, occurrenceId: string): { event: NotationEvent; note: NotationNote } | null {
  for (const event of document.events) {
    for (const note of event.notes) {
      if (note.performance_ids.includes(occurrenceId)) return { event, note };
    }
  }
  return null;
}

export function eventForNote(document: NotationDocument, logicalNoteId: string): { event: NotationEvent; note: NotationNote } | null {
  for (const event of document.events) {
    const note = event.notes.find(item => item.id === logicalNoteId);
    if (note) return { event, note };
  }
  return null;
}

function measureIndexOf(document: NotationDocument, tick: number): number {
  return document.measures.find(measure => tick >= measure.start && tick < measure.start + measure.duration)?.index ?? 0;
}

export function selectionForOccurrence(document: NotationDocument, occurrenceId: string): CorrectionSelection | null {
  const found = noteForOccurrence(document, occurrenceId);
  const occurrence = occurrenceById(document, occurrenceId);
  if (!found || !occurrence) return null;
  return {
    occurrenceId,
    logicalNoteId: found.note.id,
    eventId: found.event.id,
    staff: found.event.staff,
    voice: found.event.voice,
    measureIndex: measureIndexOf(document, found.event.start),
  };
}

export function isValidSelection(document: NotationDocument, selection: CorrectionSelection | null): CorrectionSelection | null {
  if (!selection) return null;
  return selectionForOccurrence(document, selection.occurrenceId);
}

function rejection(code: RejectionCode, message: string): CommandOutcome {
  return { status: 'rejected', code, message };
}

function applied(document: NotationDocument, label: string, selection: CorrectionSelection | null): CommandOutcome {
  return { status: 'applied', document, label, selection };
}

function overlapInVoice(
  document: NotationDocument, staff: NotationStaff, voice: NotationVoice,
  start: number, duration: number, ignoreEventId?: string,
): NotationEvent[] {
  const end = start + duration;
  return document.events.filter(event => event.id !== ignoreEventId
    && event.staff === staff && event.voice === voice
    && event.start < end && event.start + event.duration > start);
}

/** First voice on this staff that can hold the span without touching another event. */
function freeVoice(document: NotationDocument, staff: NotationStaff, start: number, duration: number): NotationVoice | null {
  for (const voice of [1, 2] as const) {
    if (!overlapInVoice(document, staff, voice, start, duration).length) return voice;
  }
  return null;
}

/* -------------------------------------------------------------- commands */

function setPitch(document: NotationDocument, occurrenceId: string, pitch: number, spelling?: string): CommandOutcome {
  const found = noteForOccurrence(document, occurrenceId);
  if (!found) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  const occurrence = occurrenceById(document, occurrenceId);
  if (!occurrence) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
    return rejection('invalid-pitch', 'A pitch must be a whole MIDI note between 0 and 127.');
  }

  let targetSpelling: string | null = spelling ?? null;
  if (targetSpelling !== null) {
    let parsed: {pitch: number};
    try {
      parsed = parseSpelling(targetSpelling);
    } catch {
      return rejection('unsupported-spelling', `“${targetSpelling}” is not a valid pitch spelling.`);
    }
    if (parsed.pitch !== pitch) {
      return rejection('unsupported-spelling', 'That spelling does not match the sounding pitch.');
    }
  }

  if (found.note.pitch === pitch && targetSpelling === null && found.note.performance_ids.length === 1) {
    return { status: 'unchanged', label: 'Pitch unchanged' };
  }

  const next = clone(document);
  const target = noteForOccurrence(next, occurrenceId);
  if (!target) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  const { event, note } = target;

  const derived = targetSpelling === null ? spellPitch(pitch, next.key_signature) : null;
  const finalSpelling = targetSpelling ?? derived!.spelling;
  const finalAccidental = accidentalName(parseSpelling(finalSpelling).alter);

  if (note.performance_ids.length > 1) {
    if (event.notes.some(item => item.id !== note.id && item.pitch === pitch)) {
      return rejection('duplicate-chord-pitch', 'That chord already has a note at this pitch.');
    }
    note.performance_ids = note.performance_ids.filter(id => id !== occurrenceId);
    event.notes = event.notes.filter(item => item.id !== note.id || item.performance_ids.length > 0);
    event.notes.push({ id: newId('n'), pitch, spelling: finalSpelling, accidental: finalAccidental, performance_ids: [occurrenceId] });
    event.notes.sort((left, right) => left.pitch - right.pitch);
  } else {
    if (event.notes.some(item => item.id !== note.id && item.pitch === pitch)) {
      return rejection('duplicate-chord-pitch', 'That chord already has a note at this pitch.');
    }
    note.pitch = pitch;
    note.spelling = finalSpelling;
    note.accidental = finalAccidental;
  }

  const linked = next.performance.find(item => item.id === occurrenceId);
  if (!linked) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  linked.pitch = pitch;

  const refreshed = refreshNotation(next);
  return applied(refreshed, `Pitch → ${finalSpelling}`, selectionForOccurrence(refreshed, occurrenceId));
}

function setOnset(document: NotationDocument, occurrenceId: string, seconds: number, snapSeconds?: number | null): CommandOutcome {
  const occurrence = occurrenceById(document, occurrenceId);
  if (!occurrence) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  if (!Number.isFinite(seconds) || seconds < 0) {
    return rejection('invalid-onset', 'A start time must be a finite number of seconds at or after zero.');
  }
  let onset = seconds;
  if (snapSeconds && snapSeconds > 0) {
    const tick = Math.round(seconds / snapSeconds) * snapSeconds;
    onset = Number(tick.toFixed(9));
  }
  const length = occurrence.duration ?? 0;
  if (onset + length > document.duration + EPSILON) {
    return rejection('out-of-bounds', 'That start would put the end of the note past the clip.');
  }
  if (Math.abs(occurrence.onset - onset) < 1e-9) return { status: 'unchanged', label: 'Start unchanged' };
  const next = clone(document);
  const linked = next.performance.find(item => item.id === occurrenceId)!;
  linked.onset = onset;
  const refreshed = refreshNotation(next);
  return applied(refreshed, `Start → ${onset.toFixed(3)} s`, selectionForOccurrence(refreshed, occurrenceId));
}

function setRecordedDuration(document: NotationDocument, occurrenceId: string, seconds: number): CommandOutcome {
  const occurrence = occurrenceById(document, occurrenceId);
  if (!occurrence) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return rejection('invalid-duration', 'A recorded length must be greater than zero.');
  }
  if (occurrence.onset + seconds > document.duration + EPSILON) {
    return rejection('out-of-bounds', 'That length would end past the clip.');
  }
  if (occurrence.duration !== null && Math.abs(occurrence.duration - seconds) < 1e-9) {
    return { status: 'unchanged', label: 'Recorded length unchanged' };
  }
  const next = clone(document);
  next.performance.find(item => item.id === occurrenceId)!.duration = seconds;
  const refreshed = refreshNotation(next);
  return applied(refreshed, `Recorded length → ${seconds.toFixed(3)} s`, selectionForOccurrence(refreshed, occurrenceId));
}

function setVelocity(document: NotationDocument, occurrenceId: string, velocity: number | null): CommandOutcome {
  const occurrence = occurrenceById(document, occurrenceId);
  if (!occurrence) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  if (velocity !== null && (!Number.isFinite(velocity) || velocity < 0 || velocity > 1)) {
    return rejection('invalid-velocity', 'Velocity must be between 0 and 1, or unknown.');
  }
  if (occurrence.velocity === velocity) return { status: 'unchanged', label: 'Velocity unchanged' };
  const next = clone(document);
  next.performance.find(item => item.id === occurrenceId)!.velocity = velocity;
  const refreshed = refreshNotation(next);
  return applied(refreshed, velocity === null ? 'Velocity cleared' : `Velocity → ${Math.round(velocity * 100)}%`,
    selectionForOccurrence(refreshed, occurrenceId));
}

function resolveEvent(document: NotationDocument, target: WrittenTarget): NotationEvent | null {
  if ('eventId' in target) return document.events.find(event => event.id === target.eventId) ?? null;
  return eventForNote(document, target.logicalNoteId)?.event ?? null;
}

function setWrittenDuration(
  document: NotationDocument, target: WrittenTarget, ticks: number, scope: 'event' | 'note',
): CommandOutcome {
  if (!Number.isInteger(ticks) || ticks < GRID || ticks % GRID !== 0) {
    return rejection('invalid-ticks', 'A written duration must be a positive whole number of sixteenth notes.');
  }
  const event = resolveEvent(document, target);
  if (!event) return rejection('unknown-event', 'That rhythm is no longer in the score.');

  const focus = 'logicalNoteId' in target ? event.notes.find(note => note.id === target.logicalNoteId) ?? null : null;
  if ('logicalNoteId' in target && !focus) return rejection('unknown-note', 'That note is no longer in the score.');

  const mustSplit = focus !== null && scope === 'note' && event.notes.length > 1;
  const next = clone(document);
  const working = next.events.find(item => item.id === event.id)!;
  let selection: CorrectionSelection | null = null;
  let workingStart = working.start;
  let workingId = working.id;

  if (mustSplit) {
    const note = working.notes.find(item => item.id === focus.id)!;
    const voice = freeVoice(next, working.staff, working.start, ticks);
    if (voice === null) {
      return rejection('needs-third-voice', 'This change needs another voice, which this score does not have. Nothing was changed.');
    }
    working.notes = working.notes.filter(item => item.id !== note.id);
    const split: NotationEvent = {
      id: newId('ev'), staff: working.staff, voice, start: working.start, duration: ticks,
      notes: [note], rest: false, source: 'inserted',
    };
    next.events.push(split);
    if (!working.notes.length) next.events = next.events.filter(item => item.id !== working.id);
    workingId = split.id;
    selection = note.performance_ids.length
      ? selectionForOccurrence(next, note.performance_ids[0])
      : null;
  } else {
    const clash = overlapInVoice(next, working.staff, working.voice, workingStart, ticks, working.id);
    if (clash.length) {
      return rejection('written-overlap', 'That written value would overlap another event in the same voice. Nothing was changed.');
    }
  }

  const edited = next.events.find(item => item.id === workingId)!;
  if (mustSplit) {
    const clash = overlapInVoice(next, edited.staff, edited.voice, edited.start, ticks, edited.id);
    if (clash.length) {
      return rejection('written-overlap', 'That written value would overlap another event in the same voice. Nothing was changed.');
    }
  }
  if (edited.duration === ticks) return { status: 'unchanged', label: 'Written duration unchanged' };
  edited.duration = ticks;
  const refreshed = refreshNotation(next);
  const anchorOccurrence = selection?.occurrenceId
    ?? refreshed.events.find(item => item.id === workingId)?.notes[0]?.performance_ids[0];
  return applied(
    refreshed,
    `Written value → ${ticks / GRID} sixteenths`,
    anchorOccurrence ? selectionForOccurrence(refreshed, anchorOccurrence) : null,
  );
}

function moveWrittenStart(document: NotationDocument, eventId: string, ticks: number): CommandOutcome {
  if (!Number.isInteger(ticks) || ticks < 0 || ticks % GRID !== 0) {
    return rejection('invalid-ticks', 'A written position must be a whole number of sixteenth notes at or after zero.');
  }
  const event = document.events.find(item => item.id === eventId);
  if (!event) return rejection('unknown-event', 'That rhythm is no longer in the score.');
  if (event.start === ticks) return { status: 'unchanged', label: 'Written position unchanged' };
  const next = clone(document);
  const working = next.events.find(item => item.id === eventId)!;
  const clash = overlapInVoice(next, working.staff, working.voice, ticks, working.duration, working.id);
  if (clash.length) {
    return rejection('written-overlap', 'That position would overlap another event in the same voice. Nothing was changed.');
  }
  working.start = ticks;
  const refreshed = refreshNotation(next);
  const first = working.notes[0]?.performance_ids[0];
  return applied(refreshed, `Written position → ${ticks / GRID} sixteenths`, first ? selectionForOccurrence(refreshed, first) : null);
}

function applyAccidental(document: NotationDocument, logicalNoteId: string, accidental: 'sharp' | 'flat' | 'natural'): CommandOutcome {
  const found = eventForNote(document, logicalNoteId);
  if (!found) return rejection('unknown-note', 'That note is no longer in the score.');
  const parsed = parseSpelling(found.note.spelling);
  const natural = parseSpelling(`${parsed.letter}${parsed.octave}`).pitch;
  const pitch = accidental === 'sharp' ? natural + 1 : accidental === 'flat' ? natural - 1 : natural;
  if (pitch < 0 || pitch > 127) return rejection('invalid-pitch', 'That accidental would leave the MIDI range.');
  const spelling = `${parsed.letter}${accidental === 'sharp' ? '#' : accidental === 'flat' ? 'b' : ''}${parsed.octave}`;
  const occurrence = found.note.performance_ids[0];
  if (!occurrence) return rejection('unknown-occurrence', 'That note has no performance occurrence.');
  return setPitch(document, occurrence, pitch, spelling);
}

function respellNote(document: NotationDocument, logicalNoteId: string, spelling: string): CommandOutcome {
  const found = eventForNote(document, logicalNoteId);
  if (!found) return rejection('unknown-note', 'That note is no longer in the score.');
  let parsed: {pitch: number};
  try {
    parsed = parseSpelling(spelling);
  } catch {
    return rejection('unsupported-spelling', `“${spelling}” is not a valid pitch spelling.`);
  }
  if (parsed.pitch !== found.note.pitch) {
    return rejection('unsupported-spelling', 'Respell keeps the sounding pitch; use the accidental buttons to change it.');
  }
  if (found.note.spelling === spelling) return { status: 'unchanged', label: 'Spelling unchanged' };
  const next = clone(document);
  const target = eventForNote(next, logicalNoteId)!.note;
  target.spelling = spelling;
  target.accidental = accidentalName(parseSpelling(spelling).alter);
  const refreshed = refreshNotation(next);
  const occurrence = target.performance_ids[0];
  return applied(refreshed, `Respelled ${spelling}`, occurrence ? selectionForOccurrence(refreshed, occurrence) : null);
}

function insertNote(document: NotationDocument, command: Extract<CorrectionCommand, {type: 'insert-note'}>): CommandOutcome {
  const { pitch, onsetSeconds, durationSeconds } = command;
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
    return rejection('invalid-pitch', 'A pitch must be a whole MIDI note between 0 and 127.');
  }
  if (!Number.isFinite(onsetSeconds) || onsetSeconds < 0) {
    return rejection('invalid-onset', 'A start time must be a finite number of seconds at or after zero.');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return rejection('invalid-duration', 'A recorded length must be greater than zero.');
  }
  if (onsetSeconds + durationSeconds > document.duration + EPSILON) {
    return rejection('out-of-bounds', 'That note would end past the clip.');
  }
  if (document.performance.length >= MAX_EVENTS) {
    return rejection('too-many-occurrences', 'This lesson already has the maximum number of notes.');
  }
  const spb = secondsPerTick(document);
  const start = command.startTicks ?? snapTick(onsetSeconds / spb);
  const duration = command.durationTicks ?? Math.max(GRID, snapTick(durationSeconds / spb));
  const staff = command.staff ?? (pitch >= document.staff_split_pitch ? 'treble' : 'bass');
  const voice = command.voice ?? 1;

  const duplicate = document.performance.find(item => item.pitch === pitch
    && Math.abs(item.onset - onsetSeconds) < 1e-6);
  if (duplicate) return rejection('duplicate-occurrence', 'A note of that pitch already starts at this time.');

  const next = clone(document);
  const occurrenceId = newId('authored');
  const spelling = spellPitch(pitch, next.key_signature);
  const same = next.events.find(event => !event.rest && event.staff === staff && event.voice === voice
    && event.start === start && event.duration === duration);

  if (same) {
    if (same.notes.some(note => note.pitch === pitch)) {
      return rejection('duplicate-chord-pitch', 'That chord already has a note at this pitch.');
    }
    if (!command.addToChord) {
      return rejection('ambiguous-insert', 'A note already occupies this position. Choose “add to chord” or move the insertion point.');
    }
    same.notes.push({ id: newId('n'), pitch, spelling: spelling.spelling, accidental: accidentalName(spelling.alter), performance_ids: [occurrenceId] });
    same.notes.sort((left, right) => left.pitch - right.pitch);
  } else {
    const clash = overlapInVoice(next, staff, voice, start, duration);
    if (clash.length) {
      return rejection('written-overlap', 'Another note already occupies this position in the score. Nothing was changed.');
    }
    next.events.push({
      id: newId('ev'), staff, voice, start, duration,
      notes: [{ id: newId('n'), pitch, spelling: spelling.spelling, accidental: accidentalName(spelling.alter), performance_ids: [occurrenceId] }],
      rest: false, source: 'inserted',
    });
  }
  next.performance.push({
    id: occurrenceId, onset: onsetSeconds, duration: durationSeconds, notation_duration: null,
    pitch, velocity: 0.7, confidence: null, optional: false, string: null, fret: null,
  });
  const refreshed = refreshNotation(next);
  return applied(refreshed, `Inserted ${spelling.spelling}`, selectionForOccurrence(refreshed, occurrenceId));
}

function removeOccurrence(document: NotationDocument, occurrenceId: string): CommandOutcome {
  const found = noteForOccurrence(document, occurrenceId);
  if (!found) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  const next = clone(document);
  next.performance = next.performance.filter(item => item.id !== occurrenceId);
  const target = noteForOccurrence(next, occurrenceId);
  if (target) {
    target.note.performance_ids = target.note.performance_ids.filter(id => id !== occurrenceId);
    if (!target.note.performance_ids.length) {
      target.event.notes = target.event.notes.filter(note => note.id !== target.note.id);
      if (!target.event.notes.length) next.events = next.events.filter(event => event.id !== target.event.id);
    }
  }
  const refreshed = refreshNotation(next);
  return applied(refreshed, 'Note removed', null);
}

function removeLogicalNote(document: NotationDocument, logicalNoteId: string): CommandOutcome {
  const found = eventForNote(document, logicalNoteId);
  if (!found) return rejection('unknown-note', 'That note is no longer in the score.');
  const next = clone(document);
  const killed = new Set(found.note.performance_ids);
  next.performance = next.performance.filter(item => !killed.has(item.id));
  const target = eventForNote(next, logicalNoteId);
  if (target) {
    target.event.notes = target.event.notes.filter(note => note.id !== logicalNoteId);
    if (!target.event.notes.length) next.events = next.events.filter(event => event.id !== target.event.id);
  }
  const refreshed = refreshNotation(next);
  return applied(refreshed, 'Note and all its occurrences removed', null);
}

/* ---------------------------------------------------------------- dispatch */

export function applyCommand(document: NotationDocument, command: CorrectionCommand): CommandOutcome {
  switch (command.type) {
    case 'set-occurrence-pitch':
      return setPitch(document, command.occurrenceId, command.pitch, command.spelling);
    case 'set-occurrence-onset':
      return setOnset(document, command.occurrenceId, command.seconds, command.snapSeconds);
    case 'set-occurrence-duration':
      return setRecordedDuration(document, command.occurrenceId, command.seconds);
    case 'set-occurrence-velocity':
      return setVelocity(document, command.occurrenceId, command.velocity);
    case 'set-written-duration':
      return setWrittenDuration(document, command.target, command.ticks, command.scope);
    case 'move-written-start':
      return moveWrittenStart(document, command.eventId, command.ticks);
    case 'apply-accidental':
      return applyAccidental(document, command.logicalNoteId, command.accidental);
    case 'respell':
      return respellNote(document, command.logicalNoteId, command.spelling);
    case 'insert-note':
      return insertNote(document, command);
    case 'delete-occurrence':
      return removeOccurrence(document, command.occurrenceId);
    case 'delete-logical-note':
      return removeLogicalNote(document, command.logicalNoteId);
    default:
      return rejection('unknown-note', 'That edit is not available yet.');
  }
}
