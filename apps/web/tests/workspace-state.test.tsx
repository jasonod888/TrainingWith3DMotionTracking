import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildNotation, type NotationDocument, type PerformanceNote} from '../../../packages/music-notation/index.ts';
import {
  createWorkspaceState, workspaceReducer, workspaceStatus, HISTORY_BYTE_BUDGET,
  type WorkspaceState,
} from '../src/music/workspace/workspace-state';

const note = (id: string, onset: number, duration: number | null, pitch: number): PerformanceNote => ({
  id, onset, duration, pitch, velocity: 0.6, confidence: null, optional: false, string: null, fret: null,
});

const score: NotationDocument = buildNotation([
  note('n-a', 0, 0.5, 60), note('n-b', 1, 0.5, 60), note('n-c', 2, 0.5, 60),
], {bpm: 120, duration: 6});

function start(): WorkspaceState {
  return createWorkspaceState(score);
}

test('selection is session state: no history entry and no dirty flag', () => {
  const selected = workspaceReducer(start(), {type: 'select', occurrenceId: 'n-b'});
  assert.equal(selected.selection?.occurrenceId, 'n-b');
  const linked = selected.document.events.flatMap(event => event.notes)
    .find(item => item.performance_ids.includes('n-b'))!;
  assert.equal(selected.selection?.logicalNoteId, linked.id);
  assert.equal(selected.past.length, 0);
  assert.equal(selected.dirty, false);
  assert.equal(selected.revision, 0);
});

test('selecting something that is not in the document clears the selection honestly', () => {
  const state = workspaceReducer(workspaceReducer(start(), {type: 'select', occurrenceId: 'n-a'}), {type: 'select', occurrenceId: 'ghost'});
  assert.equal(state.selection, null);
  assert.equal(state.lastReport?.status, 'rejected');
});

test('an applied command commits one patch entry and reports it', () => {
  const selected = workspaceReducer(start(), {type: 'select', occurrenceId: 'n-b'});
  const edited = workspaceReducer(selected, {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-b', pitch: 62}});
  assert.equal(edited.past.length, 1);
  assert.equal(edited.future.length, 0);
  assert.equal(edited.dirty, true);
  assert.equal(edited.revision, 1);
  assert.equal(edited.lastReport?.status, 'applied');
  assert.equal(edited.document.performance.find(item => item.id === 'n-b')!.pitch, 62);
  assert.equal(edited.selection?.occurrenceId, 'n-b');
  assert.ok(edited.historyBytes > 0);
  assert.ok(edited.historyBytes < JSON.stringify(edited.document).length, 'a patch must be smaller than the document');
});

test('a rejected command changes nothing and creates no history', () => {
  const selected = workspaceReducer(start(), {type: 'select', occurrenceId: 'n-a'});
  const before = selected.document;
  const rejected = workspaceReducer(selected, {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-a', pitch: 999}});
  assert.equal(rejected.document, before);
  assert.equal(rejected.past.length, 0);
  assert.equal(rejected.dirty, false);
  assert.equal(rejected.lastReport?.status, 'rejected');
});

test('a no-op command does not enter history', () => {
  const selected = workspaceReducer(start(), {type: 'select', occurrenceId: 'n-a'});
  const unchanged = workspaceReducer(selected, {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-a', pitch: 60}});
  assert.equal(unchanged.past.length, 0);
  assert.equal(unchanged.dirty, false);
  assert.equal(unchanged.lastReport?.status, 'unchanged');
});

test('undo restores the document and a valid selection; redo re-applies', () => {
  const selected = workspaceReducer(start(), {type: 'select', occurrenceId: 'n-c'});
  const edited = workspaceReducer(selected, {type: 'command', command: {type: 'set-occurrence-onset', occurrenceId: 'n-c', seconds: 2.01, snapSeconds: null}});
  assert.equal(edited.document.performance.find(item => item.id === 'n-c')!.onset, 2.01);

  const undone = workspaceReducer(edited, {type: 'undo'});
  assert.equal(undone.document.performance.find(item => item.id === 'n-c')!.onset, 2);
  assert.equal(undone.selection?.occurrenceId, 'n-c');
  assert.equal(undone.future.length, 1);

  const redone = workspaceReducer(undone, {type: 'redo'});
  assert.equal(redone.document.performance.find(item => item.id === 'n-c')!.onset, 2.01);
  assert.equal(redone.selection?.occurrenceId, 'n-c');
});

test('R6: deleting a different occurrence preserves the current valid selection', () => {
  let state = workspaceReducer(createWorkspaceState(score), {type: 'select', occurrenceId: 'n-a'});
  state = workspaceReducer(state, {type: 'command', command: {type: 'delete-occurrence', occurrenceId: 'n-c'}});
  assert.equal(state.selection?.occurrenceId, 'n-a');
  assert.equal(state.document.performance.length, 2);
});

test('R6: deleting the selected occurrence clears the selection', () => {
  let state = workspaceReducer(createWorkspaceState(score), {type: 'select', occurrenceId: 'n-a'});
  state = workspaceReducer(state, {type: 'command', command: {type: 'delete-occurrence', occurrenceId: 'n-a'}});
  assert.equal(state.selection, null);
  assert.equal(state.document.performance.length, 2);
});

test('R6: undo back to the loaded document clears the unsaved-change indicator', () => {
  let state = workspaceReducer(createWorkspaceState(score), {
    type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-a', pitch: 61},
  });
  assert.equal(state.dirty, true);
  state = workspaceReducer(state, {type: 'undo'});
  assert.equal(state.document, score, 'undo must restore the loaded document object');
  assert.equal(state.dirty, false);
  assert.match(workspaceStatus(state), /No changes/);
  state = workspaceReducer(state, {type: 'redo'});
  assert.equal(state.dirty, true);
});

test('R6: partial undo still reports unsaved changes', () => {
  let state = createWorkspaceState(score);
  state = workspaceReducer(state, {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-a', pitch: 61}});
  state = workspaceReducer(state, {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-b', pitch: 62}});
  state = workspaceReducer(state, {type: 'undo'});
  assert.equal(state.dirty, true);
});

test('status text never claims a save', () => {
  assert.match(workspaceStatus(start()), /No changes/);
  const edited = workspaceReducer(start(), {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-a', pitch: 61}});
  assert.match(workspaceStatus(edited), /not saved/i);
  assert.doesNotMatch(workspaceStatus(edited), /^Saved/);
});

test('reset replaces the document and clears history', () => {
  const edited = workspaceReducer(start(), {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-a', pitch: 61}});
  const fresh = workspaceReducer(edited, {type: 'reset', document: score});
  assert.equal(fresh.past.length, 0);
  assert.equal(fresh.dirty, false);
  assert.equal(fresh.document.performance.find(item => item.id === 'n-a')!.pitch, 60);
});

test('R5: history keeps patches, not documents, on a real-size score', () => {
  // 1,338 notes over 209.6 s, deterministic: the same shape as the real example.
  const large: PerformanceNote[] = [];
  for (let index = 0; index < 1338; index += 1) {
    const onset = 0.9 + (index % 970) * 0.2 + Math.floor(index / 970) * 0.01;
    large.push(note(`big-${index}`, Number(onset.toFixed(4)), 0.4, 48 + (index * 7) % 36));
  }
  const document = buildNotation(large, {bpm: 145, duration: 209.594});
  const documentBytes = JSON.stringify(document).length;
  assert.ok(document.performance.length === 1338);

  let state = createWorkspaceState(document);
  const started = Date.now();
  for (let index = 0; index < 20; index += 1) {
    const current = document.performance[index].pitch;
    state = workspaceReducer(state, {
      type: 'command',
      command: {type: 'set-occurrence-pitch', occurrenceId: `big-${index}`, pitch: Math.min(127, current + 1)},
    });
  }
  const elapsed = Date.now() - started;
  assert.equal(state.past.length, 20);
  const retained = state.historyBytes;
  assert.ok(retained < HISTORY_BYTE_BUDGET, 'history must stay inside its byte budget');
  assert.ok(retained < documentBytes, 'twenty patches must cost less than one document');
  assert.ok(retained / 20 < 2048, `each patch should be small, got ${Math.round(retained / 20)} bytes`);

  // Full undo returns the exact loaded document and clears the dirty flag.
  for (let index = 0; index < 20; index += 1) state = workspaceReducer(state, {type: 'undo'});
  assert.equal(state.past.length, 0);
  assert.equal(state.document, document);
  assert.equal(state.dirty, false);
  console.log(`# history benchmark: 20 edits in ${elapsed} ms, ${retained} bytes of patches retained (document ${documentBytes} bytes)`);
});
