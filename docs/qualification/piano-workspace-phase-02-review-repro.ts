/** Reviewer regression checks for submission 35b27e2. Expected to pass after fixes.
 * Run from repository root with the installed app tsx loader (see review note).
 * No product writes, media access or API calls.
 */
import assert from 'node:assert/strict';
import {buildNotation, refreshNotation, applyCommand} from '../../packages/music-notation/index.ts';
import {createWorkspaceState, workspaceReducer} from '../../apps/web/src/music/workspace/workspace-state.ts';

const occurrence = (id: string, onset: number, pitch: number) => ({
  id, onset, pitch, duration: .4, velocity: .5, confidence: null, optional: false, string: null, fret: null,
});
const base = buildNotation([
  occurrence('e', 1, 64), occurrence('g', 1, 67), occurrence('tail', 5, 72),
], {bpm: 120, duration: 8});
const event = base.events.find(e => e.notes.some(n => n.performance_ids.includes('e')))!;
const target = event.notes.find(n => n.performance_ids.includes('e'))!;
const multi = structuredClone(base);
multi.performance.push(occurrence('e-repeat', 3, 64));
multi.events.find(e => e.id === event.id)!.notes.find(n => n.id === target.id)!.performance_ids.push('e-repeat');
refreshNotation(multi);

let failures = 0;
function check(name: string, body: () => void) {
  try { body(); console.log(`PASS: ${name}`); }
  catch (error) { failures++; console.log(`FAIL: ${name}: ${(error as Error).message}`); }
}

check('single chord member written-duration split is applied', () => {
  const r = applyCommand(base, {type: 'set-written-duration', target: {logicalNoteId: target.id}, ticks: event.duration + 480, scope: 'note'});
  assert.equal(r.status, 'applied');
  if (r.status !== 'applied') return;
  const selected = r.document.events.find(e => e.notes.some(n => n.performance_ids.includes('e')))!;
  const other = r.document.events.find(e => e.notes.some(n => n.performance_ids.includes('g')))!;
  assert.equal(selected.duration, event.duration + 480);
  assert.equal(other.duration, event.duration);
});

check('same explicit pitch and spelling are a no-op', () => {
  assert.equal(applyCommand(base, {type: 'set-occurrence-pitch', occurrenceId: 'e', pitch: 64, spelling: 'E4'}).status, 'unchanged');
});

check('same pitch on a multi-mapped note does not split or throw', () => {
  assert.equal(applyCommand(multi, {type: 'set-occurrence-pitch', occurrenceId: 'e-repeat', pitch: 64}).status, 'unchanged');
});

check('applying an accidental cannot silently edit the first occurrence instead of the selected second', () => {
  let state = workspaceReducer(createWorkspaceState(multi), {type: 'select', occurrenceId: 'e-repeat'});
  state = workspaceReducer(state, {type: 'command', command: {type: 'apply-accidental', logicalNoteId: target.id, accidental: 'sharp'}});
  // Until this command accepts an occurrence target, it must reject ambiguity.
  const first = state.document.performance.find(n => n.id === 'e')!;
  assert.equal(first.pitch, 64);
});

check('invalid insertion grid is rejected through the command outcome', () => {
  const r = applyCommand(base, {type: 'insert-note', pitch: 74, onsetSeconds: 6, durationSeconds: .4, startTicks: 130, durationTicks: 480});
  assert.equal(r.status, 'rejected');
});

check('non-finite snap is rejected without storing NaN', () => {
  const r = applyCommand(base, {type: 'set-occurrence-onset', occurrenceId: 'e', seconds: 1.3, snapSeconds: Infinity});
  assert.equal(r.status, 'rejected');
});

check('deleting a different occurrence preserves the current valid selection', () => {
  let state = workspaceReducer(createWorkspaceState(base), {type: 'select', occurrenceId: 'g'});
  state = workspaceReducer(state, {type: 'command', command: {type: 'delete-occurrence', occurrenceId: 'tail'}});
  assert.equal(state.selection?.occurrenceId, 'g');
});

check('undo to the loaded document clears the unsaved-change indicator', () => {
  let state = workspaceReducer(createWorkspaceState(base), {type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: 'e', pitch: 65}});
  state = workspaceReducer(state, {type: 'undo'});
  assert.equal(state.document, base);
  assert.equal(state.dirty, false);
});

console.log(`${failures} reviewer regression check(s) failed.`);
process.exitCode = failures ? 1 : 0;
