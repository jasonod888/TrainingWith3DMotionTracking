/**
 * Phase 5: save payloads, reopen fidelity and identity-scoped local recovery.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
Object.assign(globalThis, {window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage});

import {buildNotation, applyCommand} from '../../../packages/music-notation/index.ts';
import {
  buildSaveBody, performanceChanged, restoreFromReference, serializeAlignment,
} from '../src/music/workspace/save-payload.ts';
import {
  clearRecovery, readRecovery, writeRecovery, type RecoveryIdentity,
} from '../src/music/workspace/recovery.ts';
import {estimatedAlignment} from '../../../packages/music-notation/index.ts';

const identity: RecoveryIdentity = {
  accountId: 'account-1', lessonId: 'lesson-1', draftId: 'draft-1', sourceSha256: 'a'.repeat(64),
};

function document() {
  return buildNotation([
    {id: 'n1', onset: 0.5, duration: 0.4, pitch: 60, velocity: 0.5, confidence: null, optional: false, string: null, fret: null},
    {id: 'n2', onset: 1.0, duration: 0.4, pitch: 64, velocity: 0.5, confidence: null, optional: false, string: null, fret: null},
  ], {bpm: 120, duration: 2});
}

test('reopen restores authored spelling, written durations, anchors and offset verbatim', () => {
  const original = document();
  const occurrence = original.performance.find(note => note.pitch === 60)!.id;
  const spelled = applyCommand(original, {type: 'respell', occurrenceId: occurrence, spelling: 'B#3'});
  assert.equal(spelled.status, 'applied');
  if (spelled.status !== 'applied') return;
  const event = spelled.document.events.find(item => item.notes.some(note => note.performance_ids.includes(occurrence)))!;
  const written = applyCommand(spelled.document, {type: 'set-written-duration', target: {eventId: event.id}, ticks: 240, scope: 'event'});
  assert.equal(written.status, 'applied');
  if (written.status !== 'applied') return;
  const authored = JSON.parse(JSON.stringify(written.document));
  const resolution = {alignment: estimatedAlignment(original), offsetSeconds: 0.25, anchors: [{seconds: 1, tick: 960}]};
  const reference = {
    reference_version: 1, duration: 2, title: 'Saved title',
    events: authored.performance, spans: [{start: 0, end: 2, kind: 'playing'}],
    notation: authored,
    alignment: serializeAlignment(resolution.alignment, resolution.anchors, resolution.offsetSeconds),
  };
  // The reference must survive a JSON round trip like a stored asset.
  const restored = restoreFromReference(JSON.parse(JSON.stringify(reference)));
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.value.source, 'notation');
  const restoredOccurrence = restored.value.document.performance.find(note => note.pitch === 60)!.id;
  const restoredEvent = restored.value.document.events.find(item =>
    item.notes.some(note => note.performance_ids.includes(restoredOccurrence)))!;
  const restoredNote = restoredEvent.notes.find(note => note.performance_ids.includes(restoredOccurrence))!;
  assert.equal(restoredNote.spelling, 'B#3', 'authored spelling must not be regenerated');
  assert.equal(restoredEvent.duration, 240, 'written duration survives');
  assert.equal(restored.value.offsetSeconds, 0.25);
  assert.deepEqual(restored.value.alignment?.anchors, [{seconds: 1, tick: 960}]);
  assert.equal(restored.value.alignment?.mode, 'anchored', 'a saved anchor list makes the map anchored');
  assert.equal(restored.value.title, 'Saved title');
});

test('a legacy reference without notation is rebuilt and labelled honestly', () => {
  const original = document();
  const legacy = {reference_version: 1, duration: 2, events: original.performance, spans: []};
  const restored = restoreFromReference(legacy);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.value.source, 'performance');
  assert.equal(restored.value.alignment, null);
  assert.equal(restored.value.document.performance.length, 2);
});

test('a reference whose notation disagrees with its duration is refused', () => {
  const original = document();
  const broken = {reference_version: 1, duration: 9, events: original.performance, notation: JSON.parse(JSON.stringify(original))};
  const restored = restoreFromReference(broken);
  assert.equal(restored.ok, false);
  if (!restored.ok) assert.match(restored.message, /duration/i);
});

test('the save body carries notation, versioned alignment, anchors and offset', () => {
  const original = document();
  const body = buildSaveBody({
    title: 'Save me', document: original, spans: [{start: 0, end: 2, kind: 'playing'}],
    alignment: estimatedAlignment(original), anchors: [{seconds: 0.5, tick: 480}], offsetSeconds: -0.25,
  });
  assert.equal(body.notation, original);
  assert.equal(body.alignment?.alignment_version, 1);
  assert.deepEqual(body.alignment?.anchors, [{seconds: 0.5, tick: 480}]);
  assert.equal(body.alignment?.offset_seconds, -0.25);
  assert.equal(body.offset_seconds, -0.25);
  assert.equal(body.events.length, 2);
  assert.equal(body.confirm_reviewed, true);
  assert.equal(body.base_revision_id, undefined, 'the first save finalises a draft');
  assert.equal(buildSaveBody({
    title: 'Again', document: original, spans: [], alignment: null, anchors: [], offsetSeconds: 0,
    baseRevisionId: 'rev-1',
  }).base_revision_id, 'rev-1', 'a later save builds on the saved revision');
});

test('spelling-only edits do not change the performance identity; pitch/time edits do', () => {
  const original = document();
  const respelled = JSON.parse(JSON.stringify(original));
  respelled.events[0].notes[0].spelling = 'B#3';
  const parsed = buildNotation(original.performance, {bpm: 120, duration: 2});
  parsed.events[0].notes[0].spelling = 'B#3';
  assert.equal(performanceChanged(original, parsed), false, 'a spelling change must keep the audio valid');

  const repitched = applyCommand(original, {type: 'set-occurrence-pitch', occurrenceId: original.performance[0].id, pitch: 62});
  assert.equal(repitched.status, 'applied');
  if (repitched.status !== 'applied') return;
  assert.equal(performanceChanged(original, repitched.document), true, 'a pitch change invalidates the audio');
  const moved = applyCommand(original, {type: 'set-occurrence-onset', occurrenceId: original.performance[0].id, seconds: 0.6});
  assert.equal(moved.status, 'applied');
  if (moved.status !== 'applied') return;
  assert.equal(performanceChanged(original, moved.document), true, 'a time change invalidates the audio');
});

test('local recovery round-trips and is never reported as saved', () => {
  clearRecovery();
  const original = document();
  assert.equal(writeRecovery({
    identity, title: 'Local work', notation: original, alignment: null, offsetSeconds: 0, spans: [],
  }), true);
  const outcome = readRecovery(identity);
  assert.equal(outcome.status, 'restored');
  if (outcome.status !== 'restored') return;
  assert.equal(outcome.checkpoint.title, 'Local work');
  assert.ok(outcome.checkpoint.savedAt);
  assert.equal(outcome.checkpoint.version, 1);
  // Reading never claims a server save.
  assert.equal('serverSaved' in outcome.checkpoint, false);
});

test('recovery rejects another account, draft or source, and unsupported versions', () => {
  clearRecovery();
  writeRecovery({identity, title: 'Mine', notation: document(), alignment: null, offsetSeconds: 0, spans: []});
  for (const field of ['accountId', 'draftId', 'sourceSha256'] as const) {
    const other = {...identity, [field]: 'someone-else'};
    const outcome = readRecovery(other);
    assert.equal(outcome.status, 'rejected', `a ${field} mismatch must be rejected`);
    if (outcome.status === 'rejected') assert.match(outcome.reason, /different account, draft or source/i);
  }
  assert.equal(readRecovery({...identity, lessonId: 'elsewhere'}).status, 'rejected');

  const raw = JSON.parse(localStorage.getItem('piano-workspace-recovery-v1')!);
  localStorage.setItem('piano-workspace-recovery-v1', JSON.stringify({...raw, version: 2}));
  const unsupported = readRecovery(identity);
  assert.equal(unsupported.status, 'rejected');
  if (unsupported.status === 'rejected') assert.match(unsupported.reason, /version/i);

  clearRecovery();
  assert.equal(readRecovery(identity).status, 'none');
});
