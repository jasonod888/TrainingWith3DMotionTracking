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
 * - `selection` is `undefined` when the caller's current selection should be
 *   kept (the reducer revalidates it); a value or `null` overrides it.
 */
import {
  GRID, MAX_EVENTS, MAX_MEASURES,
  type NotationDocument, type NotationEvent, type NotationNote, type NotationStaff,
  type NotationVoice, type PerformanceNote,
} from './types';
import { refreshNotation } from './build';
import { snapTick, measureTicks } from './rhythm';
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
  | 'invalid-ticks' | 'invalid-scope' | 'out-of-bounds' | 'written-overlap'
  | 'needs-third-voice' | 'duplicate-chord-pitch' | 'duplicate-occurrence'
  | 'ambiguous-insert' | 'unsupported-spelling' | 'too-many-occurrences'
  | 'document-invalid';

export type CommandOutcome =
  | {
      status: 'applied';
      document: NotationDocument;
      label: string;
      /** `undefined` keeps the caller's selection; `null` clears it explicitly. */
      selection: CorrectionSelection | null | undefined;
    }
  | { status: 'unchanged'; label: string }
  | { status: 'rejected'; code: RejectionCode; message: string };

type Applied = Extract<CommandOutcome, {status: 'applied'}>;

export type WrittenTarget = { eventId: string } | { logicalNoteId: string };

export type CorrectionCommand =
  | { type: 'set-occurrence-pitch'; occurrenceId: string; pitch: number; spelling?: string }
  | { type: 'set-occurrence-onset'; occurrenceId: string; seconds: number; snapSeconds?: number | null }
  | { type: 'set-occurrence-duration'; occurrenceId: string; seconds: number }
  | { type: 'set-occurrence-velocity'; occurrenceId: string; velocity: number | null }
  // Scope and target must agree: a whole-event change names an event, a note change
  // names a logical note. The pairing is enforced by the type and re-checked at runtime.
  | { type: 'set-written-duration'; target: { eventId: string }; ticks: number; scope: 'event' }
  | { type: 'set-written-duration'; target: { logicalNoteId: string }; ticks: number; scope: 'note' }
  | { type: 'move-written-start'; eventId: string; ticks: number }
  | { type: 'apply-accidental'; occurrenceId: string; accidental: 'sharp' | 'flat' | 'natural' }
  | { type: 'respell'; occurrenceId: string; spelling: string }
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
      /** Verification decisions carry deterministic occurrence ids. */
      id?: string;
      velocity?: number;
      /** Restoring equal-pitch attacks maps them onto the existing written note. */
      allowDuplicate?: boolean;
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

function applied(document: NotationDocument, label: string, selection?: CorrectionSelection | null): Applied {
  return { status: 'applied', document, label, selection };
}

/* ------------------------------------------------------------- validation */

/**
 * Structural check run after every command. A command whose result cannot be
 * represented is rejected rather than allowed to escape as an exception or a
 * malformed document.
 */
export function documentProblem(document: NotationDocument): string | null {
  const occurrences = new Set<string>();
  for (const item of document.performance) {
    if (!item.id || item.id.length > 80) return 'An occurrence has no valid id.';
    if (occurrences.has(item.id)) return 'The document repeats an occurrence id.';
    occurrences.add(item.id);
    if (!Number.isFinite(item.onset) || item.onset < 0) return 'An occurrence has an invalid start.';
    if (item.duration !== null && (!Number.isFinite(item.duration) || item.duration <= 0)) return 'An occurrence has an invalid recorded length.';
  }

  const owned = new Map<string, string>();
  const spans = new Map<string, { start: number; end: number; id: string }[]>();
  for (const event of document.events) {
    if (!Number.isInteger(event.start) || event.start < 0 || event.start % GRID !== 0) return 'An event is off the sixteenth grid.';
    if (!Number.isInteger(event.duration) || event.duration < GRID || event.duration % GRID !== 0) return 'An event duration is off the sixteenth grid.';
    if (event.rest && event.notes.length) return 'A rest carries notes.';
    if (!event.rest && !event.notes.length) return 'A sounding event carries no notes.';
    const pitches = new Set<number>();
    for (const note of event.notes) {
      if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) return 'A note has an invalid pitch.';
      if (pitches.has(note.pitch)) return 'A chord repeats a pitch.';
      pitches.add(note.pitch);
      if (!note.performance_ids.length) return 'A sounding note has no occurrence.';
      for (const id of note.performance_ids) {
        if (!occurrences.has(id)) return 'A note links to a missing occurrence.';
        const owner = owned.get(id);
        if (owner && owner !== note.id) return 'An occurrence is owned by two logical notes.';
        owned.set(id, note.id);
      }
    }
    const key = `${event.staff}:${event.voice}`;
    const list = spans.get(key) ?? [];
    list.push({ start: event.start, end: event.start + event.duration, id: event.id });
    spans.set(key, list);
  }
  for (const list of spans.values()) {
    list.sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
    for (let index = 1; index < list.length; index += 1) {
      if (list[index].start < list[index - 1].end) return 'Two events overlap in one voice.';
    }
  }
  for (const id of occurrences) {
    if (!owned.has(id)) return 'An occurrence is missing from every logical note.';
    if (document.performance_map[id] !== owned.get(id)) return 'The performance map disagrees with the notes.';
  }
  return null;
}

/** Refresh derived geometry, then refuse to hand back an invalid document. */
function finalise(next: NotationDocument, label: string, selection?: CorrectionSelection | null): CommandOutcome {
  let refreshed: NotationDocument;
  try {
    refreshed = refreshNotation(next);
  } catch (error) {
    return rejection('document-invalid', error instanceof Error ? error.message : 'The edit could not be represented.');
  }
  const problem = documentProblem(refreshed);
  if (problem) return rejection('document-invalid', `${problem} Nothing was changed.`);
  return applied(refreshed, label, selection);
}

/* ---------------------------------------------------------------- helpers */

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

/**
 * Give one occurrence its own logical note so a divergent edit cannot change the
 * note it shares with other occurrences. Reuses the event when the pitch is free
 * there; otherwise moves the note to an available voice; otherwise rejects.
 */
function detachOccurrence(
  document: NotationDocument, event: NotationEvent, note: NotationNote, occurrenceId: string,
  pitch: number, spelling: string, accidental: NotationNote['accidental'],
): { ok: true; event: NotationEvent; note: NotationNote } | { ok: false; outcome: CommandOutcome } {
  note.performance_ids = note.performance_ids.filter(id => id !== occurrenceId);
  const empty = note.performance_ids.length === 0;
  if (empty) {
    event.notes = event.notes.filter(item => item.id !== note.id);
    if (!event.notes.length) document.events = document.events.filter(item => item.id !== event.id);
  }

  const detached: NotationNote = { id: newId('n'), pitch, spelling, accidental, performance_ids: [occurrenceId] };
  if (!event.notes.some(item => item.pitch === pitch)) {
    event.notes.push(detached);
    event.notes.sort((left, right) => left.pitch - right.pitch);
    return { ok: true, event, note: detached };
  }
  if (empty) {
    // The whole event disappeared; rebuild the note in its place.
    const voice = freeVoice(document, event.staff, event.start, event.duration);
    if (voice === null) return { ok: false, outcome: rejection('needs-third-voice', 'That note needs another voice, which this score does not have. Nothing was changed.') };
    const rebuilt: NotationEvent = { id: event.id, staff: event.staff, voice, start: event.start, duration: event.duration, notes: [detached], rest: false, source: event.source };
    document.events.push(rebuilt);
    return { ok: true, event: rebuilt, note: detached };
  }
  const voice = freeVoice(document, event.staff, event.start, event.duration);
  if (voice === null) {
    return { ok: false, outcome: rejection('needs-third-voice', 'That change needs another voice, which this score does not have. Nothing was changed.') };
  }
  const split: NotationEvent = {
    id: newId('ev'), staff: event.staff, voice, start: event.start, duration: event.duration,
    notes: [detached], rest: false, source: 'inserted',
  };
  document.events.push(split);
  return { ok: true, event: split, note: detached };
}

/* --------------------------------------------------------------- commands */

function setPitch(document: NotationDocument, occurrenceId: string, pitch: number, spelling?: string): CommandOutcome {
  const found = noteForOccurrence(document, occurrenceId);
  if (!found) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
    return rejection('invalid-pitch', 'A pitch must be a whole MIDI note between 0 and 127.');
  }

  let requestedSpelling: string | null = spelling ?? null;
  if (requestedSpelling !== null) {
    let parsed: {pitch: number};
    try {
      parsed = parseSpelling(requestedSpelling);
    } catch {
      return rejection('unsupported-spelling', `“${requestedSpelling}” is not a valid pitch spelling.`);
    }
    if (parsed.pitch !== pitch) {
      return rejection('unsupported-spelling', 'That spelling does not match the sounding pitch.');
    }
  }
  // An unchanged sounding pitch with no explicit spelling keeps the authored spelling:
  // pressing the key the note already has must never respell corrected notation.
  if (found.note.pitch === pitch && requestedSpelling === null) {
    return { status: 'unchanged', label: 'Pitch unchanged' };
  }
  const finalSpelling = requestedSpelling ?? spellPitch(pitch, document.key_signature).spelling;

  // Complete semantic equality: same sounding pitch and same written spelling.
  if (found.note.pitch === pitch && found.note.spelling === finalSpelling) {
    return { status: 'unchanged', label: 'Pitch unchanged' };
  }

  const next = clone(document);
  const target = noteForOccurrence(next, occurrenceId);
  if (!target) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  const { event, note } = target;
  const finalAccidental = accidentalName(parseSpelling(finalSpelling).alter);

  if (note.performance_ids.length > 1) {
    const detached = detachOccurrence(next, event, note, occurrenceId, pitch, finalSpelling, finalAccidental);
    if (!detached.ok) return detached.outcome;
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

  return finalise(next, `Pitch → ${finalSpelling}`);
}

function setOnset(document: NotationDocument, occurrenceId: string, seconds: number, snapSeconds?: number | null): CommandOutcome {
  const occurrence = occurrenceById(document, occurrenceId);
  if (!occurrence) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  if (!Number.isFinite(seconds) || seconds < 0) {
    return rejection('invalid-onset', 'A start time must be a finite number of seconds at or after zero.');
  }
  let onset = seconds;
  if (snapSeconds !== null && snapSeconds !== undefined) {
    if (!Number.isFinite(snapSeconds) || snapSeconds <= 0) {
      return rejection('invalid-onset', 'A snap interval must be a positive, finite number of seconds. Nothing was changed.');
    }
    onset = Number((Math.round(seconds / snapSeconds) * snapSeconds).toFixed(9));
    if (!Number.isFinite(onset)) return rejection('invalid-onset', 'That snap interval produced an invalid start time.');
  }
  const length = occurrence.duration ?? 0;
  if (onset + length > document.duration + EPSILON) {
    return rejection('out-of-bounds', 'That start would put the end of the note past the clip.');
  }
  if (Math.abs(occurrence.onset - onset) < 1e-9) return { status: 'unchanged', label: 'Start unchanged' };
  const next = clone(document);
  next.performance.find(item => item.id === occurrenceId)!.onset = onset;
  return finalise(next, `Start → ${onset.toFixed(3)} s`);
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
  return finalise(next, `Recorded length → ${seconds.toFixed(3)} s`);
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
  return finalise(next, velocity === null ? 'Velocity cleared' : `Velocity → ${Math.round(velocity * 100)}%`);
}

function resolveEvent(document: NotationDocument, target: WrittenTarget): NotationEvent | null {
  if ('eventId' in target) return document.events.find(event => event.id === target.eventId) ?? null;
  return eventForNote(document, target.logicalNoteId)?.event ?? null;
}

function setWrittenDuration(
  document: NotationDocument,
  target: WrittenTarget,
  ticks: number,
  scope: 'event' | 'note',
): CommandOutcome {
  if (!Number.isInteger(ticks) || ticks < GRID || ticks % GRID !== 0) {
    return rejection('invalid-ticks', 'A written duration must be a positive whole number of sixteenth notes.');
  }
  if (scope !== 'event' && scope !== 'note') return rejection('invalid-scope', 'Unknown written-duration scope.');
  const namesNote = 'logicalNoteId' in target;
  if (scope === 'note' && !namesNote) {
    return rejection('invalid-scope', 'A note-scoped written change must name a logical note, not an event. Nothing was changed.');
  }
  if (scope === 'event' && namesNote) {
    return rejection('invalid-scope', 'A whole-event written change must name an event, not a single note. Nothing was changed.');
  }
  const event = resolveEvent(document, target);
  if (!event) return rejection('unknown-event', 'That rhythm is no longer in the score.');
  const focus = 'logicalNoteId' in target ? event.notes.find(note => note.id === target.logicalNoteId) ?? null : null;
  if ('logicalNoteId' in target && !focus) return rejection('unknown-note', 'That note is no longer in the score.');

  // No-op detection happens before any split: asking for the value already shown
  // must never be turned into a voice failure.
  if (event.duration === ticks) return { status: 'unchanged', label: 'Written duration unchanged' };

  const mustSplit = focus !== null && scope === 'note' && event.notes.length > 1;
  const next = clone(document);
  const working = next.events.find(item => item.id === event.id)!;

  if (!mustSplit) {
    const clash = overlapInVoice(next, working.staff, working.voice, working.start, ticks, working.id);
    if (clash.length) {
      return rejection('written-overlap', 'That written value would overlap another event in the same voice. Nothing was changed.');
    }
    working.duration = ticks;
    return finalise(next, `Written value → ${ticks / GRID} sixteenths`);
  }

  const note = working.notes.find(item => item.id === focus!.id)!;
  const voice = freeVoice(next, working.staff, working.start, ticks);
  if (voice === null) {
    return rejection('needs-third-voice', 'This change needs another voice, which this score does not have. Nothing was changed.');
  }
  working.notes = working.notes.filter(item => item.id !== note.id);
  if (!working.notes.length) next.events = next.events.filter(item => item.id !== working.id);
  const split: NotationEvent = {
    id: newId('ev'), staff: working.staff, voice, start: working.start, duration: ticks,
    notes: [note], rest: false, source: 'inserted',
  };
  next.events.push(split);
  return finalise(next, `Written value → ${ticks / GRID} sixteenths`);
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
  return finalise(next, `Written position → ${ticks / GRID} sixteenths`);
}

function applyAccidental(document: NotationDocument, occurrenceId: string, accidental: 'sharp' | 'flat' | 'natural'): CommandOutcome {
  const found = noteForOccurrence(document, occurrenceId);
  if (!found) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  const parsed = parseSpelling(found.note.spelling);
  const natural = parseSpelling(`${parsed.letter}${parsed.octave}`).pitch;
  const pitch = accidental === 'sharp' ? natural + 1 : accidental === 'flat' ? natural - 1 : natural;
  if (pitch < 0 || pitch > 127) return rejection('invalid-pitch', 'That accidental would leave the MIDI range.');
  const spelling = `${parsed.letter}${accidental === 'sharp' ? '#' : accidental === 'flat' ? 'b' : ''}${parsed.octave}`;
  return setPitch(document, occurrenceId, pitch, spelling);
}

function respellNote(document: NotationDocument, occurrenceId: string, spelling: string): CommandOutcome {
  const found = noteForOccurrence(document, occurrenceId);
  if (!found) return rejection('unknown-occurrence', 'That note is no longer in the document.');
  let parsed: ReturnType<typeof parseSpelling>;
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
  const target = noteForOccurrence(next, occurrenceId)!;
  const finalAccidental = accidentalName(parsed.alter);
  if (target.note.performance_ids.length > 1) {
    const detached = detachOccurrence(next, target.event, target.note, occurrenceId, target.note.pitch, spelling, finalAccidental);
    if (!detached.ok) return detached.outcome;
  } else if (target.event.notes.some(item => item.id !== target.note.id && item.pitch === target.note.pitch)) {
    return rejection('duplicate-chord-pitch', 'That chord already has a note at this pitch.');
  } else {
    target.note.spelling = spelling;
    target.note.accidental = finalAccidental;
  }
  return finalise(next, `Respelled ${spelling}`);
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
  if (command.staff !== undefined && command.staff !== 'treble' && command.staff !== 'bass') {
    return rejection('invalid-scope', 'Unknown staff.');
  }
  if (command.voice !== undefined && command.voice !== 1 && command.voice !== 2) {
    return rejection('invalid-scope', 'Unknown voice.');
  }
  if (command.id !== undefined && (typeof command.id !== 'string' || !command.id
    || command.id.length > 120 || document.performance.some(note => note.id === command.id))) {
    return rejection('invalid-scope', 'That verification note identity is not available.');
  }
  if (command.velocity !== undefined && (!Number.isFinite(command.velocity)
    || command.velocity < 0 || command.velocity > 1)) {
    return rejection('invalid-velocity', 'A velocity must be between zero and one.');
  }

  const spb = secondsPerTick(document);
  const startTicks = command.startTicks;
  const durationTicks = command.durationTicks;
  if (startTicks !== undefined && (!Number.isInteger(startTicks) || startTicks < 0 || startTicks % GRID !== 0)) {
    return rejection('invalid-ticks', 'A written position must be a whole, non-negative number of sixteenth notes.');
  }
  if (durationTicks !== undefined && (!Number.isInteger(durationTicks) || durationTicks < GRID || durationTicks % GRID !== 0)) {
    return rejection('invalid-ticks', 'A written duration must be a positive whole number of sixteenth notes.');
  }
  const start = startTicks ?? snapTick(onsetSeconds / spb);
  const duration = durationTicks ?? Math.max(GRID, snapTick(durationSeconds / spb));
  const staff = command.staff ?? (pitch >= document.staff_split_pitch ? 'treble' : 'bass');
  const voice = command.voice ?? 1;
  const lastMeasure = document.measures[document.measures.length - 1];
  const lastEnd = lastMeasure ? lastMeasure.start + lastMeasure.duration : 0;
  const wouldGrow = start + duration > lastEnd;
  if (wouldGrow && document.measures.length >= MAX_MEASURES) {
    return rejection('out-of-bounds', 'The score already has the maximum number of measures. Nothing was changed.');
  }

  const duplicate = document.performance.find(item => item.pitch === pitch
    && Math.abs(item.onset - onsetSeconds) < 1e-6);
  if (duplicate && !command.allowDuplicate) {
    return rejection('duplicate-occurrence', 'A note of that pitch already starts at this time.');
  }

  const next = clone(document);
  const occurrenceId = command.id ?? newId('authored');
  const spelling = spellPitch(pitch, next.key_signature);
  const same = next.events.find(event => !event.rest && event.staff === staff && event.voice === voice
    && event.start === start && event.duration === duration);

  if (same) {
    const existing = same.notes.find(note => note.pitch === pitch);
    if (existing) {
      if (command.allowDuplicate) {
        existing.performance_ids.push(occurrenceId);
        next.performance.push({
          id: occurrenceId, onset: onsetSeconds, duration: durationSeconds, notation_duration: null,
          pitch, velocity: command.velocity ?? 0.7, confidence: null, optional: false, string: null, fret: null,
        });
        const mergedOutcome = finalise(next, `Restored ${spelling.spelling}`);
        if (mergedOutcome.status !== 'applied') return mergedOutcome;
        return applied(mergedOutcome.document, mergedOutcome.label, selectionForOccurrence(mergedOutcome.document, occurrenceId));
      }
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
    pitch, velocity: command.velocity ?? 0.7, confidence: null, optional: false, string: null, fret: null,
  });
  const outcome = finalise(next, `Inserted ${spelling.spelling}`);
  if (outcome.status !== 'applied') return outcome;
  return applied(outcome.document, outcome.label, selectionForOccurrence(outcome.document, occurrenceId));
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
  return finalise(next, 'Note removed');
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
  return finalise(next, 'Note and all its occurrences removed');
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
      return applyAccidental(document, command.occurrenceId, command.accidental);
    case 'respell':
      return respellNote(document, command.occurrenceId, command.spelling);
    case 'insert-note':
      return insertNote(document, command);
    case 'delete-occurrence':
      return removeOccurrence(document, command.occurrenceId);
    case 'delete-logical-note':
      return removeLogicalNote(document, command.logicalNoteId);
    default:
      return rejection('invalid-scope', 'That edit is not available yet.');
  }
}

/** Never called by commands; exported so callers can measure the notated grid. */
export const sixteenthTicks = GRID;
export const measureSpan = measureTicks;
