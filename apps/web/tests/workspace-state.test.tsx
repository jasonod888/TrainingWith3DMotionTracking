import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildNotation, type NotationDocument, type PerformanceNote} from '../../../packages/music-notation/index.ts';
import {
  createWorkspaceState, workspaceReducer, workspaceStatus, type WorkspaceState,
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

test('an applied command commits one history entry and reports it', () => {
  const selected = workspaceReducer(start(), {type: 'select', occurrenceId: 'n-b'});
  const edited = workspaceReducer(selected, {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-b', pitch: 62}});
  assert.equal(edited.past.length, 1);
  assert.equal(edited.future.length, 0);
  assert.equal(edited.dirty, true);
  assert.equal(edited.revision, 1);
  assert.equal(edited.lastReport?.status, 'applied');
  assert.equal(edited.document.performance.find(item => item.id === 'n-b')!.pitch, 62);
  assert.equal(edited.selection?.occurrenceId, 'n-b');
});

test('a rejected command changes nothing and creates no history', () => {
  const selected = workspaceReducer(start(), {type: 'select', occurrenceId: 'n-a'});
  const before = selected.document;
  const rejected = workspaceReducer(selected, {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-a', pitch: 999}});
  assert.equal(rejected.document, before, 'document identity must not change');
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

test('undo after a deletion never restores a dangling selection', () => {
  const selected = workspaceReducer(start(), {type: 'select', occurrenceId: 'n-a'});
  const deleted = workspaceReducer(selected, {type: 'command', command: {type: 'delete-occurrence', occurrenceId: 'n-a'}});
  assert.equal(deleted.selection, null, 'deleting the selected note clears the selection');
  const undone = workspaceReducer(deleted, {type: 'undo'});
  assert.equal(undone.document.performance.length, 3);
  assert.equal(undone.selection?.occurrenceId, 'n-a');
});

test('status text never claims a save', () => {
  assert.match(workspaceStatus(start()), /No changes/);
  const selected = workspaceReducer(start(), {type: 'select', occurrenceId: 'n-a'});
  const edited = workspaceReducer(selected, {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'n-a', pitch: 61}});
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
