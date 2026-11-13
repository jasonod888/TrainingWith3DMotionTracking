import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand, buildNotation, refreshNotation, selectionForOccurrence,
  type NotationDocument, type PerformanceNote,
} from '../../packages/music-notation/index';

const note = (id: string, onset: number, duration: number | null, pitch: number, velocity = 0.6): PerformanceNote => ({
  id, onset, duration, pitch, velocity, confidence: null, optional: false, string: null, fret: null,
});

/** Four C4 attacks, one chord, one arpeggio, plenty of room. */
const performance: PerformanceNote[] = [
  note('c4-a', 0.0, 0.4, 60),
  note('c4-b', 1.0, 0.4, 60),
  note('c4-c', 2.0, 0.4, 60),
  note('chord-c', 3.0, 1.0, 48),
  note('chord-e', 3.0, 1.0, 64),
  note('chord-g', 3.0, 1.0, 67),
  note('arp-1', 5.0, 0.4, 62),
  note('arp-2', 5.045, 0.4, 66),
  note('arp-3', 5.09, 0.4, 69),
  note('tail', 8.0, 0.4, 72),
];

function document(): NotationDocument {
  return buildNotation(performance, {bpm: 120, duration: 12, key_signature: 'C'});
}

function outcomeDoc(result: ReturnType<typeof applyCommand>) {
  assert.equal(result.status, 'applied', `expected an applied command, got ${JSON.stringify(result)}`);
  return result.status === 'applied' ? result.document : document();
}

function performanceOf(score: NotationDocument, id: string) {
  const found = score.performance.find(item => item.id === id);
  assert.ok(found, `missing performance note ${id}`);
  return found!;
}

test('editing one of many repeated pitches changes only that occurrence', () => {
  const before = document();
  const edited = outcomeDoc(applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'c4-b', pitch: 62}));

  assert.equal(performanceOf(edited, 'c4-b').pitch, 62);
  assert.equal(performanceOf(edited, 'c4-a').pitch, 60);
  assert.equal(performanceOf(edited, 'c4-c').pitch, 60);
  assert.equal(performanceOf(edited, 'c4-a').onset, 0);
  assert.equal(performanceOf(edited, 'c4-b').onset, 1);
  // The other two C4 notes keep their logical notes and their mapping.
  const remaining = edited.events.flatMap(event => event.notes).filter(item => item.pitch === 60);
  assert.equal(remaining.length, 2);
  for (const item of remaining) assert.notEqual(item.performance_ids[0], 'c4-b');
});

test('editing one chord member leaves the other members untouched', () => {
  const before = document();
  const edited = outcomeDoc(applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'chord-e', pitch: 65}));

  assert.equal(performanceOf(edited, 'chord-e').pitch, 65);
  for (const id of ['chord-c', 'chord-g']) {
    assert.equal(performanceOf(edited, id).pitch, performanceOf(before, id).pitch);
    assert.equal(performanceOf(edited, id).onset, performanceOf(before, id).onset);
    assert.equal(performanceOf(edited, id).duration, performanceOf(before, id).duration);
  }
  const chord = edited.events.find(event => event.notes.some(item => item.performance_ids.includes('chord-e')))!;
  // MIDI 48 sits on the bass staff, so the treble chord is E4+G4; only E4 changed.
  assert.deepEqual(chord.notes.map(item => item.pitch), [65, 67]);
  assert.equal(performanceOf(edited, 'chord-c').pitch, 48);
});

test('a 10 ms recorded-onset change survives when Snap is off', () => {
  const before = document();
  const target = performanceOf(before, 'c4-a').onset + 0.01;
  const edited = outcomeDoc(applyCommand(before, {type: 'set-occurrence-onset', occurrenceId: 'c4-a', seconds: target, snapSeconds: null}));
  assert.ok(Math.abs(performanceOf(edited, 'c4-a').onset - target) < 1e-9, 'the 10 ms adjustment must be preserved');
});

test('Snap rounds only when a snap value is requested', () => {
  const before = document();
  const edited = outcomeDoc(applyCommand(before, {type: 'set-occurrence-onset', occurrenceId: 'c4-a', seconds: 0.31, snapSeconds: 0.25}));
  assert.equal(performanceOf(edited, 'c4-a').onset, 0.25);
});

test('written value and recorded length stay independent', () => {
  const before = document();
  const event = before.events.find(item => item.notes.some(noteItem => noteItem.performance_ids.includes('tail')))!;
  const recorded = performanceOf(before, 'tail').duration;

  const written = outcomeDoc(applyCommand(before, {type: 'set-written-duration', target: {eventId: event.id}, ticks: 960, scope: 'event'}));
  assert.equal(written.events.find(item => item.id === event.id)!.duration, 960);
  assert.equal(performanceOf(written, 'tail').duration, recorded, 'written change must not touch recorded length');

  const long = outcomeDoc(applyCommand(written, {type: 'set-occurrence-duration', occurrenceId: 'tail', seconds: 1.5}));
  assert.equal(performanceOf(long, 'tail').duration, 1.5);
  assert.equal(long.events.find(item => item.id === event.id)!.duration, 960, 'recorded change must not rewrite the written value');
});

test('a written change that would collide is rejected without mutation', () => {
  const before = document();
  const event = before.events.find(item => item.notes.some(noteItem => noteItem.performance_ids.includes('c4-a')))!;
  // c4-b starts one beat later, so a dotted half note would run into it in the same voice.
  const result = applyCommand(before, {type: 'set-written-duration', target: {eventId: event.id}, ticks: 1440, scope: 'event'});
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') assert.equal(result.code, 'written-overlap');
  assert.equal(before.performance.length, performance.length, 'the source document must not be mutated');
});

test('no-op commands report unchanged and return the same document', () => {
  const before = document();
  const result = applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'c4-a', pitch: 60});
  assert.equal(result.status, 'unchanged');
  const moved = applyCommand(before, {type: 'set-written-duration', target: {eventId: before.events[0].id}, ticks: before.events[0].duration, scope: 'event'});
  assert.equal(moved.status, 'unchanged');
});

test('a logical note with several occurrences splits instead of editing them all', () => {
  const base = buildNotation([note('m-a', 1, 0.5, 60), note('m-b', 4, 0.5, 60)], {bpm: 120, duration: 8});
  const constructed: NotationDocument = structuredClone(base);
  // One logical note owning both occurrences, as a merge feature would produce.
  constructed.events = [constructed.events[0]];
  constructed.events[0].notes = [{...constructed.events[0].notes[0], performance_ids: ['m-a', 'm-b']}];
  const linked = refreshNotation(constructed);
  assert.equal(Object.keys(linked.performance_map).length, 2);

  const result = applyCommand(linked, {type: 'set-occurrence-pitch', occurrenceId: 'm-b', pitch: 62});
  const edited = outcomeDoc(result);
  assert.equal(edited.performance.find(item => item.id === 'm-b')!.pitch, 62);
  assert.equal(edited.performance.find(item => item.id === 'm-a')!.pitch, 60, 'the other occurrence must keep its pitch');
  const noteIds = new Set(edited.events.flatMap(event => event.notes).map(item => item.id));
  assert.equal(noteIds.size, 2, 'the edit should have split the logical note');
  assert.equal(Object.keys(edited.performance_map).length, 2);
});

test('invalid values are rejected and never mutate the document', () => {
  const before = document();
  const cases = [
    {type: 'set-occurrence-pitch', occurrenceId: 'c4-a', pitch: 200},
    {type: 'set-occurrence-velocity', occurrenceId: 'c4-a', velocity: 2},
    {type: 'set-occurrence-onset', occurrenceId: 'c4-a', seconds: -1},
    {type: 'set-occurrence-duration', occurrenceId: 'c4-a', seconds: 0},
    {type: 'set-written-duration', target: {eventId: before.events[0].id}, ticks: 130, scope: 'event'},
    {type: 'delete-occurrence', occurrenceId: 'nope'},
  ] as const;
  for (const command of cases) {
    const result = applyCommand(before, command as never);
    assert.equal(result.status, 'rejected', `expected rejection for ${command.type}`);
  }
});

test('an onset that would end past the clip is rejected', () => {
  const before = document();
  const result = applyCommand(before, {type: 'set-occurrence-onset', occurrenceId: 'tail', seconds: 11.9, snapSeconds: null});
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') assert.equal(result.code, 'out-of-bounds');
});

test('insertion rejects a collision and adds to a chord only when asked', () => {
  const before = document();
  const event = before.events.find(item => item.notes.some(noteItem => noteItem.performance_ids.includes('c4-a')))!;
  const collision = applyCommand(before, {
    type: 'insert-note', pitch: 61, onsetSeconds: 0, durationSeconds: 0.4,
    startTicks: event.start, durationTicks: event.duration,
  });
  assert.equal(collision.status, 'rejected');
  if (collision.status === 'rejected') assert.equal(collision.code, 'ambiguous-insert');

  const chorded = outcomeDoc(applyCommand(before, {
    type: 'insert-note', pitch: 61, onsetSeconds: 0, durationSeconds: 0.4,
    startTicks: event.start, durationTicks: event.duration, addToChord: true,
  }));
  const chord = chorded.events.find(item => item.id === event.id)!;
  assert.deepEqual(chord.notes.map(item => item.pitch), [60, 61]);
});

test('deletion removes exactly the selected occurrence', () => {
  const before = document();
  const edited = outcomeDoc(applyCommand(before, {type: 'delete-occurrence', occurrenceId: 'c4-b'}));
  assert.equal(edited.performance.length, before.performance.length - 1);
  assert.ok(!edited.performance.some(item => item.id === 'c4-b'));
  assert.ok(edited.performance.some(item => item.id === 'c4-a'));
  assert.ok(edited.performance.some(item => item.id === 'c4-c'));

  const whole = outcomeDoc(applyCommand(before, {type: 'delete-logical-note', logicalNoteId: before.events.find(item => item.notes.some(noteItem => noteItem.performance_ids.includes('chord-e')))!.notes.find(noteItem => noteItem.performance_ids.includes('chord-e'))!.id}));
  assert.ok(!whole.performance.some(item => item.id === 'chord-e'));
  assert.ok(whole.performance.some(item => item.id === 'chord-c'));
});

test('accidentals change the sounding pitch; respelling does not', () => {
  const before = document();
  const sharpened = outcomeDoc(applyCommand(before, {type: 'apply-accidental', logicalNoteId: before.events[0].notes[0].id, accidental: 'sharp'}));
  assert.equal(performanceOf(sharpened, 'c4-a').pitch, 61);

  const respelled = outcomeDoc(applyCommand(sharpened, {type: 'respell', logicalNoteId: sharpened.events[0].notes[0].id, spelling: 'Db4'}));
  assert.equal(performanceOf(respelled, 'c4-a').pitch, 61, 'respell must preserve the sounding pitch');

  const natural = outcomeDoc(applyCommand(sharpened, {type: 'apply-accidental', logicalNoteId: sharpened.events[0].notes[0].id, accidental: 'natural'}));
  assert.equal(performanceOf(natural, 'c4-a').pitch, 60);
});

test('a written change keeps a valid selection on the edited event', () => {
  const before = document();
  const event = before.events.find(item => item.notes.some(noteItem => noteItem.performance_ids.includes('tail')))!;
  const result = applyCommand(before, {type: 'set-written-duration', target: {eventId: event.id}, ticks: 960, scope: 'event'});
  assert.equal(result.status, 'applied');
  if (result.status !== 'applied') return;
  assert.equal(result.selection?.occurrenceId, 'tail', 'the harness must not lose the selection when the written value changes');
  assert.ok(selectionForOccurrence(result.document, 'tail'));
});

test('selection follows the edited occurrence and survives unrelated edits', () => {
  const before = document();
  const result = applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'c4-b', pitch: 62});
  assert.equal(result.status, 'applied');
  if (result.status !== 'applied') return;
  assert.equal(result.selection?.occurrenceId, 'c4-b');
  assert.equal(selectionForOccurrence(result.document, 'c4-b')?.occurrenceId, 'c4-b');
});

test('unknown recorded length can be set but is never treated as zero', () => {
  const base = buildNotation([note('unknown', 0.5, null, 60)], {bpm: 120, duration: 4});
  const occurrence = base.performance[0];
  assert.equal(occurrence.duration, null);

  const set = outcomeDoc(applyCommand(base, {type: 'set-occurrence-duration', occurrenceId: 'unknown', seconds: 0.75}));
  assert.equal(set.performance[0].duration, 0.75);

  const moved = applyCommand(base, {type: 'set-occurrence-onset', occurrenceId: 'unknown', seconds: 1, snapSeconds: null});
  assert.equal(moved.status, 'applied', 'moving a note of unknown length must stay legal');
});
