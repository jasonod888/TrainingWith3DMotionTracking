/** Operation-aware verification transaction matrix (pure). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand, buildNotation, type NotationDocument,
} from '../../../packages/music-notation/index.ts';
import {
  captureOccurrence, invertFinding, matchesBaseline, prepareFinding, validateBaseline,
} from '../src/music/workspace/verification-transaction.ts';
import type {VerificationFinding} from '../src/music/verification';

const event = (id: string, onset: number, pitch: number, duration = 0.5) =>
  ({id, onset, duration, pitch, velocity: 0.6, confidence: null, optional: false, string: null, fret: null});

function doc(): NotationDocument {
  return buildNotation([
    event('a', 2, 60), event('b', 3, 64), event('c', 5, 67),
  ], {bpm: 120, duration: 12});
}

function withSpelling(document: NotationDocument, id: string, spelling: string): NotationDocument {
  const outcome = applyCommand(document, {type: 'respell', occurrenceId: id, spelling});
  assert.equal(outcome.status, 'applied');
  return outcome.document;
}

function finding(id: string, edits: VerificationFinding['proposed_edits']): VerificationFinding {
  return {id, kind: 'test', status: 'suggested', pitch: null, time_range: [0, 12],
    explanation: 'matrix', event_ids: edits.flatMap(edit => edit.event_ids), evidence: {},
    alternatives: [], proposed_edits: edits, ambiguous: false, ambiguity_reasons: []};
}

function accepted(document: NotationDocument, f: VerificationFinding) {
  const prepared = prepareFinding(document, f, null);
  assert.equal(prepared.status, 'applied', prepared.status === 'rejected' ? prepared.reason : '');
  if (prepared.status !== 'applied') throw new Error('not applied');
  const staged = prepared.commands.reduce<NotationDocument>((current, command) => {
    const outcome = applyCommand(current, command);
    assert.equal(outcome.status, 'applied');
    return outcome.status === 'applied' ? outcome.document : current;
  }, document);
  return {...prepared, document: staged};
}

test('O1 set_pitch round trip restores pitch and authored spelling', () => {
  const base = withSpelling(doc(), 'a', 'B#3');
  const f = finding('pitch-1', [{op: 'set_pitch', event_ids: ['a'], before: {pitch: 60}, after: {pitch: 62}}]);
  const applied = accepted(base, f);
  assert.equal(applied.document.performance[0].pitch, 62);
  const inverse = invertFinding(applied.document, f, null, applied.baseline);
  assert.ok('commands' in inverse);
  const restored = inverse.commands.reduce<NotationDocument>((current, command) => {
    const outcome = applyCommand(current, command);
    return outcome.status === 'applied' ? outcome.document : current;
  }, applied.document);
  assert.equal(restored.performance[0].pitch, 60);
  assert.equal(captureOccurrence(restored, 'a').present && captureOccurrence(restored, 'a').spelling, 'B#3');
});

test('O2 set_onset keeps exact seconds and inverts', () => {
  const base = doc();
  const f = finding('onset-1', [{op: 'set_onset', event_ids: ['a'], before: {onset: 2}, after: {onset: 2.013}}]);
  const applied = accepted(base, f);
  assert.equal(applied.document.performance[0].onset, 2.013);
  const inverse = invertFinding(applied.document, f, null, applied.baseline);
  assert.ok('commands' in inverse);
  const restored = inverse.commands.reduce<NotationDocument>((current, command) => {
    const outcome = applyCommand(current, command);
    return outcome.status === 'applied' ? outcome.document : current;
  }, applied.document);
  assert.equal(restored.performance[0].onset, 2);
});

test('O3 add_note uses the vf identity and rejection removes only it', () => {
  const base = doc();
  const f = finding('add-1', [{op: 'add_note', event_ids: [], before: null,
    after: {pitch: 72, onset: 7, duration: 0.5}}]);
  const applied = accepted(base, f);
  assert.ok(applied.document.performance.some(note => note.id === 'vf-add-1-a'));
  const inverse = invertFinding(applied.document, f, null, applied.baseline);
  assert.ok('commands' in inverse);
  const restored = inverse.commands.reduce<NotationDocument>((current, command) => {
    const outcome = applyCommand(current, command);
    return outcome.status === 'applied' ? outcome.document : current;
  }, applied.document);
  assert.deepEqual(restored.performance.map(note => note.id).sort(), ['a', 'b', 'c']);
});

test('O4 delete_note absence is explicit and reversible', () => {
  const base = doc();
  const f = finding('del-1', [{op: 'delete_note', event_ids: ['b'], before: event('b', 3, 64), after: null}]);
  const applied = accepted(base, f);
  assert.equal(applied.document.performance.length, 2);
  assert.equal(applied.baseline.entries.b.present, false);
  const inverse = invertFinding(applied.document, f, null, applied.baseline);
  assert.ok('commands' in inverse);
  const restored = inverse.commands.reduce<NotationDocument>((current, command) => {
    const outcome = applyCommand(current, command);
    return outcome.status === 'applied' ? outcome.document : current;
  }, applied.document);
  assert.equal(restored.performance.length, 3);
  assert.ok(restored.performance.some(note => note.id === 'b'));
});

test('O5 merge duplicate attacks restores both occurrences and one written mapping', () => {
  const base = buildNotation([event('d1', 2, 60), event('d2', 2, 60), event('x', 4, 65)],
    {bpm: 120, duration: 12});
  assert.equal(base.performance.length, 3);
  const f = finding('merge-1', [{op: 'merge', event_ids: ['d1', 'd2'],
    before: [{pitch: 60, onset: 2, duration: 0.5}, {pitch: 60, onset: 2, duration: 0.5}],
    after: {pitch: 60, onset: 2, duration: 0.5}}]);
  const applied = accepted(base, f);
  assert.equal(applied.document.performance.length, 2);
  assert.equal(applied.baseline.entries.d1.present, false);
  assert.equal(applied.baseline.entries['vf-merge-1-m'].present, true);
  const inverse = invertFinding(applied.document, f, null, applied.baseline);
  assert.ok('commands' in inverse);
  const restored = inverse.commands.reduce<NotationDocument>((current, command) => {
    const outcome = applyCommand(current, command);
    return outcome.status === 'applied' ? outcome.document : current;
  }, applied.document);
  assert.equal(restored.performance.length, 3);
  assert.deepEqual(restored.performance.filter(note => note.pitch === 60).map(note => note.id).sort(), ['d1', 'd2']);
});

test('O6 split_note restores the original and removes the pieces', () => {
  const base = doc();
  const f = finding('split-1', [{op: 'split_note', event_ids: ['a'], before: event('a', 2, 60),
    after: [{pitch: 60, onset: 2, duration: 0.25}, {pitch: 60, onset: 2.25, duration: 0.25}]}]);
  const applied = accepted(base, f);
  assert.ok(!applied.document.performance.some(note => note.id === 'a'));
  const inverse = invertFinding(applied.document, f, null, applied.baseline);
  assert.ok('commands' in inverse);
  const restored = inverse.commands.reduce<NotationDocument>((current, command) => {
    const outcome = applyCommand(current, command);
    return outcome.status === 'applied' ? outcome.document : current;
  }, applied.document);
  assert.ok(restored.performance.some(note => note.id === 'a'));
  assert.ok(!restored.performance.some(note => note.id.startsWith('vf-split-1-')));
});

test('O7 unsupported/compound failure leaves the document untouched', () => {
  const base = doc();
  const f = finding('bad-1', [{op: 'set_pitch', event_ids: ['a'], before: {pitch: 60}, after: {pitch: 200}}]);
  const prepared = prepareFinding(base, f, null);
  assert.equal(prepared.status, 'rejected');
  assert.equal(base.performance[0].pitch, 60);
});

test('O8 repeated accept is idempotent and a second rejection refuses', () => {
  const base = doc();
  const f = finding('repeat-1', [{op: 'set_pitch', event_ids: ['a'], before: {pitch: 60}, after: {pitch: 62}}]);
  const applied = accepted(base, f);
  assert.equal(prepareFinding(applied.document, f, null).status, 'rejected');
  const inverse = invertFinding(applied.document, f, null, applied.baseline);
  assert.ok('commands' in inverse);
  const restored = inverse.commands.reduce<NotationDocument>((current, command) => {
    const outcome = applyCommand(current, command);
    return outcome.status === 'applied' ? outcome.document : current;
  }, applied.document);
  assert.equal(restored.performance[0].pitch, 60);
});

test('S2/S3 later performance or written edits block reversal', () => {
  const base = doc();
  const f = finding('later-1', [{op: 'set_pitch', event_ids: ['a'], before: {pitch: 60}, after: {pitch: 62}}]);
  const applied = accepted(base, f);
  const changed = applyCommand(applied.document, {type: 'set-occurrence-pitch', occurrenceId: 'a', pitch: 63});
  assert.equal(changed.status, 'applied');
  const inverse = invertFinding(changed.status === 'applied' ? changed.document : applied.document, f, null, applied.baseline);
  assert.ok('reason' in inverse);
  assert.equal((changed.status === 'applied' ? changed.document : applied.document).performance[0].pitch, 63);
});

test('R1 baseline survives serialization and matches the accepted document', () => {
  const base = doc();
  const f = finding('ser-1', [{op: 'set_pitch', event_ids: ['a'], before: {pitch: 60}, after: {pitch: 62}}]);
  const applied = accepted(base, f);
  const roundTrip = JSON.parse(JSON.stringify(applied.baseline));
  const checked = validateBaseline(f, roundTrip);
  assert.equal(checked.ok, true);
  if (checked.ok) assert.equal(matchesBaseline(applied.document, f, checked.baseline), true);
});

test('R2/R3 missing, empty, partial and wrong-ID baselines are refused', () => {
  const base = doc();
  const f = finding('refuse-1', [{op: 'set_pitch', event_ids: ['a'], before: {pitch: 60}, after: {pitch: 62}}]);
  const applied = accepted(base, f);
  assert.equal(validateBaseline(f, undefined).ok, false);
  assert.equal(validateBaseline(f, {}).ok, false);
  assert.equal(validateBaseline(f, {...applied.baseline, entries: {}}).ok, false);
  assert.equal(validateBaseline(f, {...applied.baseline, entries: {a: applied.baseline.entries.a}}).ok, true);
  assert.equal(validateBaseline(f, {...applied.baseline, findingId: 'other'}).ok, false);
});

test('R4 malformed entry values are refused', () => {
  const base = doc();
  const f = finding('mal-1', [{op: 'set_pitch', event_ids: ['a'], before: {pitch: 60}, after: {pitch: 62}}]);
  const applied = accepted(base, f);
  const entry = {...applied.baseline.entries.a, pitch: 999};
  const malformed = {...applied.baseline, entries: {...applied.baseline.entries, a: entry}};
  assert.equal(validateBaseline(f, malformed).ok, false);
  const badSpelling = {...applied.baseline, entries: {...applied.baseline.entries,
    a: {...applied.baseline.entries.a, spelling: ''}}};
  assert.equal(validateBaseline(f, badSpelling).ok, false);
});
