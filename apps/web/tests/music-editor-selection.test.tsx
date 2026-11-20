import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildNotation} from '../../../packages/music-notation/index.ts';
import {JSDOM} from 'jsdom';
import {createWorkspaceState, workspaceReducer} from '../src/music/workspace/workspace-state.ts';
import {selectedNoteFacts} from '../src/music/workspace/useMusicEditorSelection.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  {url: 'http://localhost/', pretendToBeVisual: true});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true});
const {renderHook, act, cleanup} = await import('@testing-library/react');
const {useMusicEditorSelection} = await import('../src/music/workspace/useMusicEditorSelection.ts');

const document = () => buildNotation([
  {id: 'e1', onset: 0, duration: 1, pitch: 64, velocity: .8, confidence: 1,
    optional: false, string: 1, fret: 0, notation_duration: null},
], {bpm: 120, duration: 1, subject: 'guitar'});

test('selected facts derive from the committed occurrence selection', () => {
  const score = document();
  const state = workspaceReducer(createWorkspaceState(score),
    {type: 'select', occurrenceId: score.performance[0].id});
  const facts = selectedNoteFacts(score, state.selection!);
  assert.equal(facts?.pitch, 64);
  assert.equal(facts?.onset, 0);
  assert.equal(typeof facts?.spelling, 'string');
});

test('deleting the selected occurrence reconciles selection to null', () => {
  const score = document();
  let state = workspaceReducer(createWorkspaceState(score),
    {type: 'select', occurrenceId: score.performance[0].id});
  state = workspaceReducer(state, {type: 'command',
    command: {type: 'delete-occurrence', occurrenceId: score.performance[0].id}});
  assert.equal(state.selection, null);
});

test('inspector drafts stay transient until commit and modes/focus are preserved', () => {
  const score = document();
  const selectedState = workspaceReducer(createWorkspaceState(score),
    {type: 'select', occurrenceId: score.performance[0].id});
  const commands: unknown[] = [];
  const {result} = renderHook(() => useMusicEditorSelection({state: selectedState,
    document: score, dispatch: action => {
      if (action.type === 'command') commands.push(action.command);
    }}));
  act(() => result.current.setInspectorDraft('C#4'));
  assert.equal(commands.length, 0, 'typing is not a history entry');
  act(() => { assert.equal(result.current.commitInspectorDraft(), true); });
  assert.deepEqual(commands[0], {type: 'respell', occurrenceId: score.performance[0].id,
    spelling: 'C#4'});
  const trigger = dom.window.document.createElement('button');
  result.current.modeReturnFocus.current = trigger;
  act(() => result.current.setReplaceMode({occurrenceId: score.performance[0].id, pitch: 64}));
  act(() => result.current.commitPitch(65));
  assert.deepEqual(commands[1], {type: 'set-occurrence-pitch',
    occurrenceId: score.performance[0].id, pitch: 65});
  act(() => result.current.commitGuitarPosition(2, 1));
  assert.deepEqual(commands[2], {type: 'set-guitar-position',
    occurrenceId: score.performance[0].id, string: 2, fret: 1});
  assert.equal(result.current.modeReturnFocus.current, trigger);
});

test('gesture translation, reveal and transient mode ownership stay in the selection hook', () => {
  const score = document();
  const occurrenceId = score.performance[0].id;
  const selectedState = workspaceReducer(createWorkspaceState(score),
    {type: 'select', occurrenceId});
  const commands: unknown[] = [];
  const {result, unmount} = renderHook(() => useMusicEditorSelection({state: selectedState,
    document: score, dispatch: action => {
      if (action.type === 'command') commands.push(action.command);
    }}));
  act(() => result.current.applyGesture({kind: 'pitch', occurrenceId, pitch: 65, spelling: 'F4'}));
  assert.deepEqual(commands[0], {type: 'set-occurrence-pitch', occurrenceId, pitch: 65,
    spelling: 'F4'}, 'score spelling must survive the shared gesture translation');
  act(() => result.current.applyGesture({kind: 'resize', occurrenceId, durationSeconds: 0.75}));
  assert.deepEqual(commands[1], {type: 'set-occurrence-duration', occurrenceId, seconds: 0.75});

  act(() => result.current.requestReveal(occurrenceId));
  const firstToken = result.current.reveal?.token ?? 0;
  assert.equal(result.current.reveal?.occurrenceId, occurrenceId);
  act(() => result.current.requestReveal(occurrenceId));
  assert.ok((result.current.reveal?.token ?? 0) > firstToken,
    'each explicit reveal must advance its own token');

  act(() => result.current.setFretPickMode(occurrenceId));
  act(() => result.current.setReplaceMode({occurrenceId, pitch: 64}));
  act(() => result.current.cancelModes());
  assert.equal(result.current.fretPickMode, null);
  assert.equal(result.current.replaceMode, null);
  unmount();
});

