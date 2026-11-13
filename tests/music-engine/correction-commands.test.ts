import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand, buildNotation, documentProblem, refreshNotation, selectionForOccurrence,
  type NotationDocument, type PerformanceNote,
} from '../../packages/music-notation/index';

const note = (id: string, onset: number, duration: number | null, pitch: number, velocity = 0.6): PerformanceNote => ({
  id, onset, duration, pitch, velocity, confidence: null, optional: false, string: null, fret: null,
});

/** Four C4 attacks, one chord, one arpeggio, one tail note. */
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

/** E4 at 1 s and a second occurrence at 3 s sharing one logical note. */
function multiDocument(): NotationDocument {
  const base = buildNotation([
    note('e', 1, 0.4, 64), note('g', 1, 0.4, 67), note('tail', 5, 0.4, 72),
  ], {bpm: 120, duration: 8});
  const copy: NotationDocument = structuredClone(base);
  copy.performance.push(note('e-repeat', 3, 0.4, 64));
  const event = copy.events.find(item => item.notes.some(n => n.performance_ids.includes('e')))!;
  event.notes.find(n => n.performance_ids.includes('e'))!.performance_ids.push('e-repeat');
  return refreshNotation(copy);
}

function applied(result: ReturnType<typeof applyCommand>) {
  assert.equal(result.status, 'applied', `expected an applied command, got ${JSON.stringify(result)}`);
  return result.status === 'applied' ? result.document : document();
}

function performanceOf(score: NotationDocument, id: string) {
  const found = score.performance.find(item => item.id === id);
  assert.ok(found, `missing performance note ${id}`);
  return found!;
}

function eventOf(score: NotationDocument, occurrenceId: string) {
  return score.events.find(event => event.notes.some(noteItem => noteItem.performance_ids.includes(occurrenceId)))!;
}

/* --------------------------------------------------------------- core scope */

test('editing one of many repeated pitches changes only that occurrence', () => {
  const before = document();
  const edited = applied(applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'c4-b', pitch: 62}));

  assert.equal(performanceOf(edited, 'c4-b').pitch, 62);
  assert.equal(performanceOf(edited, 'c4-a').pitch, 60);
  assert.equal(performanceOf(edited, 'c4-c').pitch, 60);
  assert.equal(edited.events.flatMap(event => event.notes).filter(item => item.pitch === 60).length, 2);
});

test('editing one chord member leaves the other members untouched', () => {
  const before = document();
  const edited = applied(applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'chord-e', pitch: 65}));
  assert.equal(performanceOf(edited, 'chord-e').pitch, 65);
  for (const id of ['chord-c', 'chord-g']) {
    assert.equal(performanceOf(edited, id).pitch, performanceOf(before, id).pitch);
    assert.equal(performanceOf(edited, id).onset, performanceOf(before, id).onset);
    assert.equal(performanceOf(edited, id).duration, performanceOf(before, id).duration);
  }
  assert.deepEqual(eventOf(edited, 'chord-e').notes.map(item => item.pitch), [65, 67]);
  assert.equal(performanceOf(edited, 'chord-c').pitch, 48);
});

test('a 10 ms recorded-onset change survives when Snap is off', () => {
  const before = document();
  const target = performanceOf(before, 'c4-a').onset + 0.01;
  const edited = applied(applyCommand(before, {type: 'set-occurrence-onset', occurrenceId: 'c4-a', seconds: target, snapSeconds: null}));
  assert.ok(Math.abs(performanceOf(edited, 'c4-a').onset - target) < 1e-9);
});

test('Snap rounds only when a snap value is requested', () => {
  const before = document();
  const edited = applied(applyCommand(before, {type: 'set-occurrence-onset', occurrenceId: 'c4-a', seconds: 0.31, snapSeconds: 0.25}));
  assert.equal(performanceOf(edited, 'c4-a').onset, 0.25);
});

test('written value and recorded length stay independent', () => {
  const before = document();
  const event = eventOf(before, 'tail');
  const recorded = performanceOf(before, 'tail').duration;

  const written = applied(applyCommand(before, {type: 'set-written-duration', target: {eventId: event.id}, ticks: 960, scope: 'event'}));
  assert.equal(written.events.find(item => item.id === event.id)!.duration, 960);
  assert.equal(performanceOf(written, 'tail').duration, recorded);

  const long = applied(applyCommand(written, {type: 'set-occurrence-duration', occurrenceId: 'tail', seconds: 1.5}));
  assert.equal(performanceOf(long, 'tail').duration, 1.5);
  assert.equal(long.events.find(item => item.id === event.id)!.duration, 960);
});

/* ------------------------------------------------------------------- F1 */

test('F1: note scope with an event target is rejected and changes nothing', () => {
  const before = document();
  const chord = eventOf(before, 'chord-e');
  const result = applyCommand(before, {
    // Runtime callers can still build this shape; the command must refuse it.
    type: 'set-written-duration', target: {eventId: chord.id}, ticks: chord.duration + 480, scope: 'note',
  } as never);
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') assert.equal(result.code, 'invalid-scope');
  assert.equal(eventOf(before, 'chord-e').duration, chord.duration);
  assert.equal(eventOf(before, 'chord-g').duration, chord.duration);
});

test('F1: event scope with a note target is rejected and changes nothing', () => {
  const before = document();
  const chord = eventOf(before, 'chord-e');
  const noteId = chord.notes.find(n => n.performance_ids.includes('chord-e'))!.id;
  const result = applyCommand(before, {
    type: 'set-written-duration', target: {logicalNoteId: noteId}, ticks: chord.duration + 480, scope: 'event',
  } as never);
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') assert.equal(result.code, 'invalid-scope');
  assert.equal(eventOf(before, 'chord-e').duration, chord.duration);
});

/* ------------------------------------------------------------------- F2 */

test('F2: the same piano pitch keeps authored enharmonic spelling', () => {
  const base = buildNotation([note('flat', 1, 0.4, 61)], {bpm: 120, duration: 4});
  const respelled = applied(applyCommand(base, {type: 'respell', occurrenceId: 'flat', spelling: 'Db4'}));
  const result = applyCommand(respelled, {type: 'set-occurrence-pitch', occurrenceId: 'flat', pitch: 61});
  assert.equal(result.status, 'unchanged');
  assert.equal(eventOf(respelled, 'flat').notes[0].spelling, 'Db4');
});

test('F2: the same piano pitch on a multi-mapped note is a no-op and keeps spelling', () => {
  const before = multiDocument();
  const respelled = applied(applyCommand(before, {type: 'respell', occurrenceId: 'e-repeat', spelling: 'Fb4'}));
  const result = applyCommand(respelled, {type: 'set-occurrence-pitch', occurrenceId: 'e-repeat', pitch: 64});
  assert.equal(result.status, 'unchanged');
  assert.equal(eventOf(respelled, 'e-repeat').notes[0].spelling, 'Fb4');
});

/* ------------------------------------------------------------------- R1 */

test('R1: a single chord member gets its own written duration', () => {
  const before = document();
  const chord = eventOf(before, 'chord-e');
  const noteId = chord.notes.find(n => n.performance_ids.includes('chord-e'))!.id;
  const result = applyCommand(before, {type: 'set-written-duration', target: {logicalNoteId: noteId}, ticks: chord.duration + 480, scope: 'note'});
  const edited = applied(result);

  const eEvent = eventOf(edited, 'chord-e');
  const gEvent = eventOf(edited, 'chord-g');
  assert.notEqual(eEvent.id, gEvent.id, 'the edited member must leave the chord');
  assert.equal(eEvent.duration, chord.duration + 480);
  assert.equal(gEvent.duration, chord.duration);
  assert.equal(performanceOf(edited, 'chord-g').duration, 1.0);
  assert.equal(documentProblem(edited), null);
});

test('R1: asking for the written value already shown is a no-op even when both voices are busy', () => {
  const base = document();
  const chord = eventOf(base, 'chord-e');
  const busy: NotationDocument = structuredClone(base);
  const voiceTwo = busy.events.find(event => event.id === chord.id)!;
  // Occupy the second voice across the same span so a split would fail.
  busy.events.push({
    id: 'voice-two-blocker', staff: voiceTwo.staff, voice: 2, start: voiceTwo.start, duration: voiceTwo.duration,
    notes: [{id: 'blocker-note', pitch: 55, spelling: 'G3', accidental: null, performance_ids: ['blocker']}],
    rest: false, source: 'inserted',
  });
  busy.performance.push(note('blocker', 4, 1, 55));
  const ready = refreshNotation(busy);
  assert.equal(documentProblem(ready), null);
  const noteId = eventOf(ready, 'chord-e').notes.find(n => n.performance_ids.includes('chord-e'))!.id;

  const result = applyCommand(ready, {type: 'set-written-duration', target: {logicalNoteId: noteId}, ticks: eventOf(ready, 'chord-e').duration, scope: 'note'});
  assert.equal(result.status, 'unchanged', 'a no-op must not become a voice rejection');
});

/* ------------------------------------------------------------------- R2 */

test('R2: an accidental edits the selected occurrence, not the first linked one', () => {
  const before = multiDocument();
  const linked = before.events.flatMap(event => event.notes).find(n => n.performance_ids.length === 2)!;
  assert.equal(linked.performance_ids.length, 2);

  const edited = applied(applyCommand(before, {type: 'apply-accidental', occurrenceId: 'e-repeat', accidental: 'sharp'}));
  assert.equal(performanceOf(edited, 'e').pitch, 64, 'the first occurrence must not move');
  assert.equal(performanceOf(edited, 'e-repeat').pitch, 65);
  assert.equal(performanceOf(edited, 'e-repeat').onset, 3);
  assert.equal(documentProblem(edited), null);
});

test('R2: respelling a second occurrence keeps its sounding pitch and leaves the first alone', () => {
  const before = multiDocument();
  const edited = applied(applyCommand(before, {type: 'respell', occurrenceId: 'e-repeat', spelling: 'Fb4'}));
  assert.equal(performanceOf(edited, 'e-repeat').pitch, 64);
  assert.equal(performanceOf(edited, 'e').pitch, 64);
  const respelled = edited.events.flatMap(event => event.notes).find(n => n.performance_ids.includes('e-repeat'))!;
  assert.equal(respelled.spelling, 'Fb4');
  const first = edited.events.flatMap(event => event.notes).find(n => n.performance_ids.includes('e'))!;
  assert.equal(first.spelling, 'E4');
});

test('R2: onset and recorded-length edits keep every mapping intact', () => {
  const before = multiDocument();
  const moved = applied(applyCommand(before, {type: 'set-occurrence-onset', occurrenceId: 'e-repeat', seconds: 3.25, snapSeconds: null}));
  assert.equal(performanceOf(moved, 'e-repeat').onset, 3.25);
  assert.equal(performanceOf(moved, 'e').onset, 1);
  assert.equal(moved.events.flatMap(event => event.notes).find(n => n.performance_ids.includes('e'))!.performance_ids.length, 2);
  assert.equal(documentProblem(moved), null);

  const lengthened = applied(applyCommand(before, {type: 'set-occurrence-duration', occurrenceId: 'e-repeat', seconds: 0.9}));
  assert.equal(performanceOf(lengthened, 'e-repeat').duration, 0.9);
  assert.equal(performanceOf(lengthened, 'e').duration, 0.4);
  assert.equal(documentProblem(lengthened), null);
});

/* ------------------------------------------------------------------- R3 */

test('R3: same pitch with the same explicit spelling is a no-op', () => {
  const before = document();
  const result = applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'c4-a', pitch: 60, spelling: 'C4'});
  assert.equal(result.status, 'unchanged');
});

test('R3: setting a multi-mapped occurrence to its own pitch is a no-op, not a throw', () => {
  const before = multiDocument();
  const result = applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'e-repeat', pitch: 64});
  assert.equal(result.status, 'unchanged');
  assert.equal(before.events.flatMap(event => event.notes).filter(n => n.pitch === 64).length, 1);
});

test('R3: a spelling-only change on a multi-mapped note splits or rejects, never throws', () => {
  const before = multiDocument();
  const result = applyCommand(before, {type: 'respell', occurrenceId: 'e-repeat', spelling: 'Fb4'});
  assert.ok(result.status === 'applied' || result.status === 'rejected');
  if (result.status === 'rejected') assert.ok(['needs-third-voice', 'duplicate-chord-pitch'].includes(result.code));
  if (result.status === 'applied') assert.equal(documentProblem(result.document), null);
});

/* ------------------------------------------------------------------- R4 */

test('R4: an off-grid written position is rejected through the outcome', () => {
  const result = applyCommand(document(), {
    type: 'insert-note', pitch: 74, onsetSeconds: 6, durationSeconds: 0.4, startTicks: 130, durationTicks: 480,
  });
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') assert.equal(result.code, 'invalid-ticks');
});

test('R4: a non-finite or non-positive snap is rejected without storing NaN', () => {
  const before = document();
  for (const snapSeconds of [Infinity, -Infinity, NaN, 0, -0.5]) {
    const result = applyCommand(before, {type: 'set-occurrence-onset', occurrenceId: 'c4-a', seconds: 1.3, snapSeconds});
    assert.equal(result.status, 'rejected', `snap ${String(snapSeconds)} must be rejected`);
    if (result.status === 'rejected') assert.equal(result.code, 'invalid-onset');
  }
  assert.ok(Number.isFinite(performanceOf(before, 'c4-a').onset));
});

test('R4: an insertion beyond the measure limit is rejected, not thrown', () => {
  const big = buildNotation([note('only', 0, 1, 60)], {bpm: 120, duration: 1024});
  assert.equal(big.measures.length, 512, 'fixture must sit at the measure limit');
  const result = applyCommand(big, {
    type: 'insert-note', pitch: 61, onsetSeconds: 1023.99, durationSeconds: 0.01,
  });
  assert.equal(result.status, 'rejected');
});

test('R4: every applied command leaves a structurally valid document', () => {
  const before = document();
  const commands = [
    {type: 'set-occurrence-pitch', occurrenceId: 'c4-a', pitch: 67},
    {type: 'set-occurrence-onset', occurrenceId: 'c4-a', seconds: 0.5},
    {type: 'set-occurrence-duration', occurrenceId: 'c4-a', seconds: 0.8},
    {type: 'insert-note', pitch: 70, onsetSeconds: 10.5, durationSeconds: 0.4},
  ] as const;
  for (const command of commands) {
    const result = applyCommand(before, command as never);
    if (result.status === 'applied') assert.equal(documentProblem(result.document), null, command.type);
  }
});

/* --------------------------------------------------------------- remaining */

test('no-op commands report unchanged and return the same document', () => {
  const before = document();
  assert.equal(applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'c4-a', pitch: 60}).status, 'unchanged');
  assert.equal(applyCommand(before, {type: 'set-written-duration', target: {eventId: before.events[0].id}, ticks: before.events[0].duration, scope: 'event'}).status, 'unchanged');
});

test('a logical note with several occurrences splits instead of editing them all', () => {
  const before = multiDocument();
  const edited = applied(applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'e-repeat', pitch: 62}));
  assert.equal(performanceOf(edited, 'e-repeat').pitch, 62);
  assert.equal(performanceOf(edited, 'e').pitch, 64);
  assert.equal(Object.keys(edited.performance_map).length, edited.performance.length);
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
    assert.equal(applyCommand(before, command as never).status, 'rejected', command.type);
  }
  assert.equal(documentProblem(before), null);
});

test('an onset that would end past the clip is rejected', () => {
  const before = document();
  const result = applyCommand(before, {type: 'set-occurrence-onset', occurrenceId: 'tail', seconds: 11.9, snapSeconds: null});
  assert.equal(result.status, 'rejected');
});

test('insertion rejects a collision and adds to a chord only when asked', () => {
  const before = document();
  const event = eventOf(before, 'c4-a');
  const collision = applyCommand(before, {
    type: 'insert-note', pitch: 61, onsetSeconds: 0, durationSeconds: 0.4,
    startTicks: event.start, durationTicks: event.duration,
  });
  assert.equal(collision.status, 'rejected');
  if (collision.status === 'rejected') assert.equal(collision.code, 'ambiguous-insert');

  const chorded = applied(applyCommand(before, {
    type: 'insert-note', pitch: 61, onsetSeconds: 0, durationSeconds: 0.4,
    startTicks: event.start, durationTicks: event.duration, addToChord: true,
  }));
  assert.deepEqual(eventOf(chorded, 'c4-a').notes.map(item => item.pitch), [60, 61]);
  assert.equal(documentProblem(chorded), null);
});

test('deletion removes exactly the selected occurrence', () => {
  const before = document();
  const edited = applied(applyCommand(before, {type: 'delete-occurrence', occurrenceId: 'c4-b'}));
  assert.equal(edited.performance.length, before.performance.length - 1);
  assert.ok(edited.performance.some(item => item.id === 'c4-a'));
  assert.ok(!edited.performance.some(item => item.id === 'c4-b'));
});

test('accidentals change the sounding pitch; respelling does not', () => {
  const before = document();
  const sharpened = applied(applyCommand(before, {type: 'apply-accidental', occurrenceId: 'c4-a', accidental: 'sharp'}));
  assert.equal(performanceOf(sharpened, 'c4-a').pitch, 61);
  const respelled = applied(applyCommand(sharpened, {type: 'respell', occurrenceId: 'c4-a', spelling: 'Db4'}));
  assert.equal(performanceOf(respelled, 'c4-a').pitch, 61);
  const natural = applied(applyCommand(sharpened, {type: 'apply-accidental', occurrenceId: 'c4-a', accidental: 'natural'}));
  assert.equal(performanceOf(natural, 'c4-a').pitch, 60);
});

test('selection follows the edited occurrence and survives unrelated edits', () => {
  const before = document();
  const result = applyCommand(before, {type: 'set-occurrence-pitch', occurrenceId: 'c4-b', pitch: 62});
  assert.equal(result.status, 'applied');
  if (result.status !== 'applied') return;
  assert.equal(result.selection, undefined, 'commands leave selection movement to the reducer');
  assert.equal(selectionForOccurrence(result.document, 'c4-b')?.occurrenceId, 'c4-b');
});

test('unknown recorded length can be set but is never treated as zero', () => {
  const base = buildNotation([note('unknown', 0.5, null, 60)], {bpm: 120, duration: 4});
  assert.equal(base.performance[0].duration, null);
  const set = applied(applyCommand(base, {type: 'set-occurrence-duration', occurrenceId: 'unknown', seconds: 0.75}));
  assert.equal(set.performance[0].duration, 0.75);
  const moved = applyCommand(base, {type: 'set-occurrence-onset', occurrenceId: 'unknown', seconds: 1, snapSeconds: null});
  assert.equal(moved.status, 'applied');
});
