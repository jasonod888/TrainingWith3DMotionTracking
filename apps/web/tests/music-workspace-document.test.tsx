import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildNotation} from '../../../packages/music-notation/index.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  {url: 'http://localhost/', pretendToBeVisual: true});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true});
const {renderHook, act, cleanup} = await import('@testing-library/react');
const {useMusicWorkspaceDocument} = await import('../src/music/workspace/useMusicWorkspaceDocument.ts');

afterEach(cleanup);
const notation = () => buildNotation([
  {id: 'e1', onset: 0, duration: 1, pitch: 60, velocity: .8, confidence: 1,
    optional: false, string: null, fret: null, notation_duration: null},
  {id: 'e2', onset: 1, duration: 1, pitch: 64, velocity: .8, confidence: 1,
    optional: false, string: null, fret: null, notation_duration: null},
], {bpm: 120, duration: 2, subject: 'piano'});

test('document controller owns commands, rejection, undo/redo/reset and epoch', () => {
  const initial = notation();
  const {result} = renderHook(() => useMusicWorkspaceDocument(initial));
  const first = result.current.document!.performance[0].id;
  act(() => result.current.select(first));
  assert.equal(result.current.selection?.occurrenceId, first);
  act(() => result.current.command({type: 'set-occurrence-pitch', occurrenceId: first, pitch: 62}));
  assert.equal(result.current.document!.performance[0].pitch, 62);
  assert.equal(result.current.dirty, true);
  act(() => result.current.undo());
  assert.equal(result.current.document!.performance[0].pitch, 60);
  act(() => result.current.redo());
  assert.equal(result.current.document!.performance[0].pitch, 62);
  act(() => result.current.command({type: 'set-occurrence-pitch', occurrenceId: first, pitch: 999}));
  assert.equal(result.current.report?.status, 'rejected');
  act(() => result.current.reset(initial));
  assert.equal(result.current.dirty, false);
  const epoch = result.current.documentEpoch;
  act(() => result.current.replace(initial));
  assert.equal(result.current.documentEpoch, epoch + 1);
  assert.equal(result.current.selection, null);
});
