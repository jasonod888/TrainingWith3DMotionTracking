/**
 * Minimal history patches.
 *
 * A command clones the whole document, so reference comparison cannot find what
 * changed. Instead each history entry stores only the occurrences and events whose
 * content differs, in both directions, and the derived segments/ties are rebuilt
 * when the patch is applied. That keeps a history entry proportional to the edit
 * rather than to the 1.5 MB score.
 */
import {
  refreshNotation,
  type NotationDocument, type NotationEvent, type PerformanceNote,
} from '../../../../../packages/music-notation/index.ts';

export type PerformanceChange = { id: string; before: PerformanceNote; after: PerformanceNote };
export type EventChange = { id: string; before: NotationEvent; after: NotationEvent };

export type DocumentPatch = {
  performance: { added: PerformanceNote[]; removed: PerformanceNote[]; changed: PerformanceChange[] };
  events: { added: NotationEvent[]; removed: NotationEvent[]; changed: EventChange[] };
};

const NOTE_FIELDS: (keyof PerformanceNote)[] = ['pitch', 'onset', 'duration', 'velocity', 'notation_duration', 'optional'];

function noteKey(note: PerformanceNote): string {
  return NOTE_FIELDS.map(field => String(note[field] ?? '')).join('|');
}

function eventKey(event: NotationEvent): string {
  const notes = event.notes
    .map(note => `${note.id}:${note.pitch}:${note.spelling}:${note.accidental ?? ''}:${note.performance_ids.join(',')}`)
    .join(';');
  return `${event.staff}:${event.voice}:${event.start}:${event.duration}:${event.rest}:${event.source}:${notes}`;
}

export function diffDocuments(before: NotationDocument, after: NotationDocument): DocumentPatch {
  const patch: DocumentPatch = {
    performance: { added: [], removed: [], changed: [] },
    events: { added: [], removed: [], changed: [] },
  };

  const beforeNotes = new Map(before.performance.map(note => [note.id, note]));
  const afterNotes = new Map(after.performance.map(note => [note.id, note]));
  for (const [id, note] of afterNotes) {
    const previous = beforeNotes.get(id);
    if (!previous) patch.performance.added.push(note);
    else if (noteKey(previous) !== noteKey(note)) patch.performance.changed.push({ id, before: previous, after: note });
  }
  for (const [id, note] of beforeNotes) if (!afterNotes.has(id)) patch.performance.removed.push(note);

  const beforeEvents = new Map(before.events.map(event => [event.id, event]));
  const afterEvents = new Map(after.events.map(event => [event.id, event]));
  for (const [id, event] of afterEvents) {
    const previous = beforeEvents.get(id);
    if (!previous) patch.events.added.push(event);
    else if (eventKey(previous) !== eventKey(event)) patch.events.changed.push({ id, before: previous, after: event });
  }
  for (const [id, event] of beforeEvents) if (!afterEvents.has(id)) patch.events.removed.push(event);

  return patch;
}

export function patchBytes(patch: DocumentPatch): number {
  return JSON.stringify(patch).length;
}

export function isEmptyPatch(patch: DocumentPatch): boolean {
  return patch.performance.added.length === 0 && patch.performance.removed.length === 0
    && patch.performance.changed.length === 0 && patch.events.added.length === 0
    && patch.events.removed.length === 0 && patch.events.changed.length === 0;
}

export function applyPatch(
  document: NotationDocument, patch: DocumentPatch, direction: 'before' | 'after',
): NotationDocument {
  const next = structuredClone(document);
  const restore = direction === 'before' ? 'before' : 'after';

  for (const change of patch.performance.changed) {
    const value = structuredClone(change[restore]);
    const index = next.performance.findIndex(note => note.id === change.id);
    if (index >= 0) next.performance[index] = value;
    else next.performance.push(value);
  }
  const removeNotes = direction === 'before' ? patch.performance.added : patch.performance.removed;
  const addNotes = direction === 'before' ? patch.performance.removed : patch.performance.added;
  if (removeNotes.length) {
    const ids = new Set(removeNotes.map(note => note.id));
    next.performance = next.performance.filter(note => !ids.has(note.id));
  }
  for (const note of addNotes) {
    if (!next.performance.some(item => item.id === note.id)) next.performance.push(structuredClone(note));
  }

  for (const change of patch.events.changed) {
    const value = structuredClone(change[restore]);
    const index = next.events.findIndex(event => event.id === change.id);
    if (index >= 0) next.events[index] = value;
    else next.events.push(value);
  }
  const removeEvents = direction === 'before' ? patch.events.added : patch.events.removed;
  const addEvents = direction === 'before' ? patch.events.removed : patch.events.added;
  if (removeEvents.length) {
    const ids = new Set(removeEvents.map(event => event.id));
    next.events = next.events.filter(event => !ids.has(event.id));
  }
  for (const event of addEvents) {
    if (!next.events.some(item => item.id === event.id)) next.events.push(structuredClone(event));
  }

  return refreshNotation(next);
}
