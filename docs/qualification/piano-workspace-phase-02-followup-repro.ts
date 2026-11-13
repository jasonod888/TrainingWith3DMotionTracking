/** Follow-up reviewer checks for a42294c. No product or service writes. */
import assert from 'node:assert/strict';
import {buildNotation, applyCommand} from '../../packages/music-notation/index.ts';
import {createWorkspaceState, workspaceReducer} from '../../apps/web/src/music/workspace/workspace-state.ts';

const note = (id: string, onset: number, pitch: number) => ({
  id, onset, pitch, duration: .4, velocity: .5, confidence: null, optional: false, string: null, fret: null,
});
const base = buildNotation([note('e', 1, 64), note('g', 1, 67), note('tail', 5, 72)], {bpm: 120, duration: 8});
const chord = base.events.find(e => e.notes.some(n => n.performance_ids.includes('e')))!;
let failed = 0;
function check(name: string, body: () => void) {
  try { body(); console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${(error as Error).message}`); }
}

check('note-only scope without a note target is rejected, not applied to the chord', () => {
  const r = applyCommand(base, {
    type: 'set-written-duration', target: {eventId: chord.id}, scope: 'note', ticks: chord.duration + 480,
  });
  assert.equal(r.status, 'rejected');
});

check('same piano pitch preserves authored enharmonic spelling and is a no-op', () => {
  const initial = buildNotation([note('flat', 1, 61)], {bpm: 120, duration: 8});
  const respelled = applyCommand(initial, {type: 'respell', occurrenceId: 'flat', spelling: 'Db4'});
  assert.equal(respelled.status, 'applied');
  if (respelled.status !== 'applied') return;
  const r = applyCommand(respelled.document, {type: 'set-occurrence-pitch', occurrenceId: 'flat', pitch: 61});
  assert.equal(r.status, 'unchanged');
  assert.equal(respelled.document.events[0].notes[0].spelling, 'Db4');
});

check('undo selected-note deletion restores both the note and pre-command selection', () => {
  let state = workspaceReducer(createWorkspaceState(base), {type: 'select', occurrenceId: 'e'});
  state = workspaceReducer(state, {type: 'command', command: {type: 'delete-occurrence', occurrenceId: 'e'}});
  assert.equal(state.selection, null);
  state = workspaceReducer(state, {type: 'undo'});
  assert.ok(state.document.performance.some(n => n.id === 'e'));
  assert.equal(state.selection?.occurrenceId, 'e');
  state = workspaceReducer(state, {type: 'redo'});
  assert.equal(state.selection, null);
});

console.log(`${failed} follow-up regression check(s) failed.`);
process.exitCode = failed ? 1 : 0;
