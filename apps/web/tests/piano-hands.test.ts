import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand, baselineHandEstimates, buildNotation, handPerformanceFingerprint,
  parseNotationDocument, resolveHandAssignments, withHandAssignments, type HandAssignment,
  type NotationDocument, type PerformanceNote,
} from '../../../packages/music-notation/index.ts';
import {buildSaveBody, restoreFromReference} from '../src/music/workspace/save-payload.ts';
import {readRecovery, writeRecovery} from '../src/music/workspace/recovery.ts';
import {createWorkspaceState, workspaceReducer} from '../src/music/workspace/workspace-state.ts';
import {sha256Hex} from '../../../packages/music-notation/sha256.ts';

function note(id: string, pitch: number, onset = 1, duration = 0.5): PerformanceNote {
  return {id, pitch, onset, duration, velocity: 0.5, confidence: null, optional: false, string: null, fret: null};
}

function documentWith(notes: PerformanceNote[]): NotationDocument {
  return buildNotation(notes, {duration: 12, bpm: 120});
}

function estimate(notes: PerformanceNote[], id: string) {
  return baselineHandEstimates(notes)[id];
}

test('fingerprint uses only stable performance identity fields and ignores input order', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb924'
    + '27ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223'
    + 'b00361a396177a9cb410ff61f20015ad');
  const first = [note('b', 64, 1, 0.5), note('a', 60, 0.5, 1)];
  const second = [note('a', 60, 0.5, 1), note('b', 64, 1, 0.5)];
  const fingerprint = handPerformanceFingerprint(first);
  assert.match(fingerprint, /^ph1:[0-9a-f]{64}$/);
  assert.equal(fingerprint.length, 68);
  assert.equal(fingerprint, handPerformanceFingerprint(second));
  const changed = [note('a', 60, 0.5, 1), note('b', 65, 1, 0.5)];
  assert.notEqual(fingerprint, handPerformanceFingerprint(changed));
  const writtenOnly = structuredClone(first);
  writtenOnly[0].notation_duration = 2;
  writtenOnly[1].confidence = 0.1;
  writtenOnly[1].velocity = 0.9;
  assert.equal(fingerprint, handPerformanceFingerprint(writtenOnly));
  assert.notEqual(handPerformanceFingerprint([note('a:1', 60)]),
    handPerformanceFingerprint([note('a', 60), note('1', 60)]),
    'id boundaries cannot collide through concatenation');
});

test('persisted automatic metadata stays linear for a 1338-note performance', () => {
  const notes = Array.from({length: 1338}, (_, index) =>
    note(`long-${index}`, 21 + (index % 88), index * 0.05, 0.5));
  const document = documentWith([note('seed', 36)]);
  document.performance = notes;
  const resolved = resolveHandAssignments(document);
  assert.equal(Object.keys(resolved).length, 1338);
  const fingerprints = new Set(Object.values(resolved).map(item => item.fingerprint));
  assert.equal(fingerprints.size, 1, 'one compact identity is reused, not repeated full JSON');
  assert.match([...fingerprints][0] ?? '', /^ph1:[0-9a-f]{64}$/);
  const serialized = JSON.stringify(resolved);
  assert.ok(serialized.length < 1_500_000,
    `serialized hand metadata should stay linear/reasonable, got ${serialized.length} bytes`);
});

test('baseline handles empty, single, middle, extreme and chord-span cases honestly', () => {
  assert.deepEqual(baselineHandEstimates([]), {});
  assert.equal(estimate([note('low', 36)], 'low').hand, 'left');
  assert.equal(estimate([note('high', 84)], 'high').hand, 'right');
  const middle = estimate([note('middle', 60)], 'middle');
  assert.equal(middle.hand, 'unassigned');
  assert.equal(middle.confidence, 'ambiguous');
  const outside = estimate([note('outside', 5)], 'outside');
  assert.equal(outside.hand, 'unassigned');
  assert.equal(outside.reason, 'outside-standard-piano');

  const split = baselineHandEstimates([
    note('low', 40), note('mid', 50), note('high', 60, 1.01),
  ]);
  assert.equal(split.low.hand, 'left');
  assert.equal(split.mid.hand, 'left');
  assert.equal(split.high.hand, 'right');
  assert.equal(split.low.reason, 'chord-split-span');

  const leftChord = baselineHandEstimates([note('a', 40), note('b', 45), note('c', 50)]);
  assert.ok(Object.values(leftChord).every(value => value.hand === 'left'));
  const rightChord = baselineHandEstimates([note('d', 74), note('e', 78)]);
  assert.ok(Object.values(rightChord).every(value => value.hand === 'right'));

  const arpeggio = baselineHandEstimates([note('arp-low', 40, 1), note('arp-mid', 48, 1.2),
    note('arp-high', 72, 1.4)]);
  assert.equal(arpeggio['arp-low'].hand, 'left');
  assert.equal(arpeggio['arp-mid'].hand, 'left');
  assert.equal(arpeggio['arp-high'].hand, 'right');
  assert.deepEqual(baselineHandEstimates([{...note('bad', 60), onset: Number.NaN}]), {});

  const splitPlausibility = baselineHandEstimates([
    note('split-low', 40), note('split-high', 60),
  ]);
  assert.equal(splitPlausibility['split-low'].plausible.right, true,
    'pitch order does not hard-reject the opposite hand');
  assert.equal(splitPlausibility['split-high'].plausible.left, true);

  const sustained = baselineHandEstimates([
    note('pedal', 36, 1, 10), note('after-pedal', 84, 1.5),
  ]);
  assert.equal(sustained['pedal'].hand, 'left');
  assert.equal(sustained['after-pedal'].hand, 'right',
    'a pedal-inflated overlap is a soft cost, not an anatomical veto');
});

test('baseline is deterministic for scrambled input, overlaps, repeats and independent ids', () => {
  const ordered = [note('a', 72, 1), note('b', 72, 1.01), note('c', 72, 2), note('d', 76, 2)];
  const scrambled = [ordered[3], ordered[1], ordered[0], ordered[2]];
  assert.deepEqual(baselineHandEstimates(ordered), baselineHandEstimates(scrambled));
  const result = baselineHandEstimates(ordered);
  assert.equal(new Set(Object.keys(result)).size, 4);
  assert.ok(Object.values(result).every(value => value.hand === 'right'));
});

test('manual override including unassigned wins and reset removes it', () => {
  const document = documentWith([note('low', 36), note('high', 84, 2)]);
  const set = applyCommand(document, {type: 'set-occurrence-hand', occurrenceId: 'low', hand: 'left'});
  assert.equal(set.status, 'applied');
  if (set.status !== 'applied') return;
  assert.deepEqual(set.document.hand_assignments?.low, {
    hand: 'left', source: 'manual', confidence: 'clear', manual: true, reason: 'Manual override',
  });
  assert.equal(resolveHandAssignments(set.document, {low: {hand: 'right', confidence: 'clear',
    model: {name: 'midi2hands', version: 'test'}}}).low.hand, 'left');
  assert.equal(applyCommand(set.document, {type: 'set-occurrence-hand', occurrenceId: 'low', hand: 'left'}).status,
    'unchanged');
  const unassigned = applyCommand(set.document, {type: 'set-occurrence-hand', occurrenceId: 'low', hand: 'unassigned'});
  assert.equal(unassigned.status, 'applied');
  if (unassigned.status !== 'applied') return;
  assert.equal(resolveHandAssignments(unassigned.document, {low: {hand: 'right',
    model: {name: 'midi2hands', version: 'test'}}}).low.hand, 'unassigned');
  const reset = applyCommand(unassigned.document, {type: 'reset-occurrence-hand', occurrenceId: 'low'});
  assert.equal(reset.status, 'applied');
  if (reset.status !== 'applied') return;
  assert.ok(reset.document.hand_assignments?.low === undefined);
  assert.equal(resolveHandAssignments(reset.document, {low: {hand: 'right',
    model: {name: 'midi2hands', version: 'test'}}}).low.hand, 'left',
    'reset returns to the clear contextual baseline, not a bad model');
});

test('reviewed-save materialisation persists applied estimates without mutating the open document', () => {
  const document = documentWith([note('a', 36)]);
  const resolved = resolveHandAssignments(document, {a: {hand: 'left', confidence: 'clear',
    model: {name: 'midi2hands', version: 'test'}}});
  const materialised = withHandAssignments(document, resolved);
  assert.equal(document.hand_assignments, undefined);
  assert.equal(materialised.hand_assignment_version, 1);
  assert.equal(materialised.hand_assignments?.a.source, 'hybrid');
  assert.equal(materialised.hand_assignments?.a.manual, false);
  const parsed = parseNotationDocument(JSON.parse(JSON.stringify(materialised)));
  assert.equal(parsed.hand_assignments?.a.hand, 'left');
});

test('workspace undo/redo restores manual assignment changes', () => {
  const document = documentWith([note('a', 36)]);
  let state = createWorkspaceState(document);
  state = workspaceReducer(state, {type: 'command',
    command: {type: 'set-occurrence-hand', occurrenceId: 'a', hand: 'right'}});
  assert.equal(state.document.hand_assignments?.a.hand, 'right');
  state = workspaceReducer(state, {type: 'undo'});
  assert.ok(state.document.hand_assignments?.a === undefined);
  state = workspaceReducer(state, {type: 'redo'});
  assert.equal(state.document.hand_assignments?.a.hand, 'right');
});

test('hybrid resolver preserves manual, consensus, fallback, conflict and implausibility reasons', () => {
  const agreement = resolveHandAssignments(documentWith([note('low', 36)]),
    {low: {hand: 'left', confidence: 'clear', model: {name: 'midi2hands', version: 'test'}}});
  assert.equal(agreement.low.source, 'hybrid');
  assert.equal(agreement.low.confidence, 'clear');
  assert.equal(agreement.low.model?.name, 'midi2hands');
  assert.match(agreement.low.fingerprint ?? '', /^ph1:[0-9a-f]{64}$/);

  const ambiguous = resolveHandAssignments(documentWith([note('mid', 60)]),
    {mid: {hand: 'right', confidence: 'ambiguous', model: {name: 'midi2hands', version: 'test'}}});
  assert.equal(ambiguous.mid.hand, 'right');
  assert.equal(ambiguous.mid.source, 'midi2hands');
  assert.equal(ambiguous.mid.reason, 'baseline-ambiguous-model');

  const conflict = resolveHandAssignments(documentWith([note('low', 36)]),
    {low: {hand: 'right', confidence: 'clear', score: 0.95,
      model: {name: 'midi2hands', version: 'test'}}});
  assert.equal(conflict.low.hand, 'left');
  assert.equal(conflict.low.source, 'baseline');
  assert.equal(conflict.low.reason, 'baseline-over-inconsistent-model',
    'a clear feasible baseline must not blindly accept a contextually bad model');

  const weak = resolveHandAssignments(documentWith([note('cross-low', 40), note('cross-high', 60)]),
    {'cross-low': {hand: 'right', confidence: 'ambiguous', score: 0.55,
      model: {name: 'midi2hands', version: 'test'}}});
  assert.equal(weak['cross-low'].hand, 'left');
  assert.equal(weak['cross-low'].reason, 'baseline-over-weak-model',
    'a weak raw-score margin cannot overturn a clear baseline');

  const implausible = resolveHandAssignments(documentWith([note('low', 36)]),
    {low: {hand: 'right', plausible: false, model: {name: 'midi2hands', version: 'test'}}});
  assert.equal(implausible.low.hand, 'left');
  assert.equal(implausible.low.reason, 'model-implausible');

  const crossing = resolveHandAssignments(documentWith([note('cross-low', 48), note('cross-high', 61)]),
    {'cross-low': {hand: 'right', confidence: 'clear', model: {name: 'midi2hands', version: 'test'}}});
  assert.equal(crossing['cross-low'].hand, 'right');
  assert.equal(crossing['cross-low'].confidence, 'conflict',
    'a pitch-order split cannot suppress a plausible model as anatomically impossible');
  assert.equal(crossing['cross-low'].reason, 'baseline-model-conflict');

  const outside = resolveHandAssignments(documentWith([note('outside', 10)]),
    {outside: {hand: 'right', model: {name: 'midi2hands', version: 'test'}}});
  assert.equal(outside.outside.hand, 'unassigned');
  assert.equal(outside.outside.reason, 'outside-standard-piano');
});

test('cached model metadata is used only while the performance fingerprint matches', () => {
  const current = documentWith([note('mid', 60)]);
  const fingerprint = handPerformanceFingerprint(current.performance);
  const stored: HandAssignment = {
    hand: 'right', source: 'midi2hands', confidence: 'clear', manual: false,
    reason: 'cached', fingerprint, model: {name: 'midi2hands', version: '1'},
  };
  current.hand_assignment_version = 1;
  current.hand_assignments = {mid: stored};
  assert.equal(resolveHandAssignments(current).mid.hand, 'right', 'matching cache is the model candidate');
  const edited = applyCommand(current, {type: 'set-occurrence-pitch', occurrenceId: 'mid', pitch: 64});
  assert.equal(edited.status, 'applied');
  if (edited.status !== 'applied') return;
  assert.notEqual(handPerformanceFingerprint(edited.document.performance), fingerprint);
  assert.ok(edited.document.hand_assignments?.mid === undefined,
    'stale automatic metadata is removed by the edit lifecycle');
  const refreshed = resolveHandAssignments(edited.document);
  assert.equal(refreshed.mid.source, 'baseline', 'stale automatic metadata is ignored');
});

test('manual assignment survives note edits, new notes and written-only changes; deletes prune metadata', () => {
  const document = documentWith([note('a', 36), note('b', 60)]);
  const manual = applyCommand(document, {type: 'set-occurrence-hand', occurrenceId: 'a', hand: 'left'});
  assert.equal(manual.status, 'applied');
  if (manual.status !== 'applied') return;
  const pitched = applyCommand(manual.document, {type: 'set-occurrence-pitch', occurrenceId: 'a', pitch: 40});
  assert.equal(pitched.status, 'applied');
  if (pitched.status !== 'applied') return;
  assert.equal(pitched.document.hand_assignments?.a.hand, 'left');
  pitched.document.hand_assignment_version = 1;
  pitched.document.hand_assignments = {...pitched.document.hand_assignments, b: {
    hand: 'right', source: 'baseline', confidence: 'clear', manual: false,
    fingerprint: handPerformanceFingerprint(pitched.document.performance),
  }};
  const respelled = applyCommand(pitched.document, {type: 'respell', occurrenceId: 'b', spelling: 'B#3'});
  assert.equal(respelled.status, 'applied');
  if (respelled.status !== 'applied') return;
  assert.equal(respelled.document.hand_assignments?.b.source, 'baseline',
    'written-only changes keep automatic context');
  assert.equal(handPerformanceFingerprint(respelled.document.performance),
    handPerformanceFingerprint(pitched.document.performance), 'written spelling does not invalidate hands');
  const inserted = applyCommand(respelled.document, {type: 'insert-note', pitch: 64,
    onsetSeconds: 5, durationSeconds: 0.5});
  assert.equal(inserted.status, 'applied');
  if (inserted.status !== 'applied') return;
  assert.equal(inserted.document.hand_assignments?.a.hand, 'left');
  assert.ok(inserted.document.hand_assignments?.b === undefined,
    'new performance context invalidates automatic assignments');
  const deleted = applyCommand(inserted.document, {type: 'delete-occurrence', occurrenceId: 'a'});
  assert.equal(deleted.status, 'applied');
  if (deleted.status !== 'applied') return;
  assert.ok(deleted.document.hand_assignments?.a === undefined, 'deleted occurrence cannot keep orphan metadata');
});

test('save and recovery parse paths round-trip versioned assignment metadata', () => {
  const document = documentWith([note('a', 36), note('b', 84)]);
  const manual = applyCommand(document, {type: 'set-occurrence-hand', occurrenceId: 'a', hand: 'right'});
  assert.equal(manual.status, 'applied');
  if (manual.status !== 'applied') return;
  manual.document.hand_assignment_version = 1;
  manual.document.hand_assignments = {...manual.document.hand_assignments, b: {
    hand: 'right', source: 'baseline', confidence: 'clear', manual: false,
    reason: 'register-continuity', fingerprint: handPerformanceFingerprint(manual.document.performance),
  }};
  const parsed = parseNotationDocument(JSON.parse(JSON.stringify(manual.document)));
  assert.equal(parsed.hand_assignment_version, 1);
  assert.equal(parsed.hand_assignments?.a.hand, 'right');
  assert.equal(parsed.hand_assignments?.b.source, 'baseline');
  const body = buildSaveBody({title: 'Hands', document: manual.document, spans: [], alignment: null,
    anchors: [], offsetSeconds: 0});
  const restored = restoreFromReference(body);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.value.document.hand_assignments?.a.hand, 'right');
  assert.equal(restored.value.document.hand_assignments?.b.source, 'baseline');

  const plain = parseNotationDocument(document);
  assert.equal(plain.hand_assignment_version, undefined);
  assert.equal(plain.hand_assignments, undefined, 'older documents open without fabricated metadata');

  const identity = {accountId: 'account', lessonId: 'lesson', draftId: 'draft', sourceSha256: 'source'};
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  }});
  try {
    assert.equal(writeRecovery({identity, title: 'Hands', notation: manual.document,
      alignment: null, offsetSeconds: 0, spans: []}), true);
    const recovery = readRecovery(identity);
    assert.equal(recovery.status, 'restored');
    if (recovery.status !== 'restored') return;
    const recovered = parseNotationDocument(recovery.checkpoint.notation);
    assert.equal(recovered.hand_assignments?.a.hand, 'right');
    assert.equal(recovered.hand_assignments?.b.source, 'baseline');
  } finally {
    delete (globalThis as unknown as {localStorage?: unknown}).localStorage;
  }
});

test('invalid or orphaned metadata is rejected by the parser', () => {
  const document = documentWith([note('a', 36)]);
  document.hand_assignment_version = 1;
  document.hand_assignments = {missing: {
    hand: 'left', source: 'manual', confidence: 'clear', manual: true,
  }};
  assert.throws(() => parseNotationDocument(document), /missing performance note/i);
  const invalid = documentWith([note('a', 36)]);
  invalid.hand_assignment_version = 1;
  invalid.hand_assignments = {a: {
    hand: 'left', source: 'midi2hands', confidence: 'clear', manual: false,
  }};
  assert.throws(() => parseNotationDocument(invalid), /fingerprint/i);
  const missingModel = documentWith([note('a', 36)]);
  missingModel.hand_assignment_version = 1;
  missingModel.hand_assignments = {a: {
    hand: 'left', source: 'midi2hands', confidence: 'clear', manual: false,
    fingerprint: handPerformanceFingerprint(missingModel.performance),
  }};
  assert.throws(() => parseNotationDocument(missingModel), /model identity/i);
});
