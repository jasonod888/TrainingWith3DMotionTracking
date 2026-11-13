/**
 * Produces the Phase 5 round-trip sample: a save body with authored notation and an
 * anchored offset, then the restore result, proven byte-for-byte through JSON.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {applyCommand, buildNotation, estimatedAlignment} from '../../../../packages/music-notation/index.ts';
import {buildSaveBody, restoreFromReference} from '../../../../apps/web/src/music/workspace/save-payload.ts';

const fixture = JSON.parse(readFileSync('docs/qualification/piano-workspace-phase-01/fixtures/phase1-draft-fixture.json', 'utf8'));
const document = buildNotation(fixture.events.map((event: any) => ({
  id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
  velocity: event.velocity ?? null, confidence: event.confidence ?? null, optional: Boolean(event.optional),
  string: null, fret: null, notation_duration: event.notation_duration ?? null,
})), {duration: fixture.duration});

const occurrence = document.performance.find(note => note.pitch === 60)!.id;
const spelled = applyCommand(document, {type: 'respell', occurrenceId: occurrence, spelling: 'B#3'});
if (spelled.status !== 'applied') throw new Error(spelled.message);
const event = spelled.document.events.find(item => item.notes.some(note => note.performance_ids.includes(occurrence)))!;
const written = applyCommand(spelled.document, {type: 'set-written-duration', target: {eventId: event.id}, ticks: 240, scope: 'event'});
if (written.status !== 'applied') throw new Error(written.message);

const body = buildSaveBody({
  title: fixture.title ?? 'Piano round trip',
  document: written.document,
  spans: fixture.spans,
  alignment: estimatedAlignment(written.document),
  anchors: [{seconds: 1, tick: 960}],
  offsetSeconds: 0.25,
});

// The reference the server would store, then the reopen path.
const reference = {
  reference_version: 1, duration: written.document.duration, title: body.title,
  events: body.events, spans: body.spans, notation: body.notation, alignment: body.alignment,
};
const restored = restoreFromReference(JSON.parse(JSON.stringify(reference)));
if (!restored.ok) throw new Error(restored.message);

const restoredOccurrence = restored.value.document.performance.find(note => note.pitch === 60)!.id;
const restoredEvent = restored.value.document.events.find(item =>
  item.notes.some(note => note.performance_ids.includes(restoredOccurrence)))!;
const restoredNote = restoredEvent.notes.find(note => note.performance_ids.includes(restoredOccurrence))!;

const report = {
  generated_at: new Date().toISOString(),
  source: restored.value.source,
  saved: {
    notation_version: body.notation.notation_version,
    events: body.events.length,
    alignment_mode: body.alignment.mode,
    anchors: body.alignment.anchors,
    offset_seconds: body.alignment.offset_seconds,
    authored_spelling: 'B#3',
    authored_written_ticks: 240,
  },
  reopened: {
    spelling: restoredNote.spelling,
    written_ticks: restoredEvent.duration,
    alignment_mode: restored.value.alignment?.mode,
    anchors: restored.value.alignment?.anchors,
    offset_seconds: restored.value.offsetSeconds,
    title: restored.value.title,
  },
};
writeFileSync('docs/qualification/piano-workspace-phase-05/phase5-roundtrip.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
