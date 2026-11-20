import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {
  addAnchor, alignmentFromSpans, buildNotation, secondsToTick,
} from '../../../packages/music-notation/index.ts';
import {zoomAround, revealWindow} from '../src/music/workspace/viewport.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  {url: 'http://localhost/', pretendToBeVisual: true});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true});
const {renderHook, act, cleanup} = await import('@testing-library/react');
const {useMusicAlignmentEditor} = await import('../src/music/workspace/useMusicAlignmentEditor.ts');
afterEach(cleanup);

const document = () => buildNotation([
  {id: 'e1', onset: 0, duration: 2, pitch: 60, velocity: .8, confidence: 1,
    optional: false, string: null, fret: null, notation_duration: null},
], {bpm: 120, duration: 2, subject: 'piano'});
const spans = [{start: 0, end: 2, kind: 'playing' as const}];

test('alignment anchors, offset and anchor undo/redo are owned by the hook', () => {
  const score = document();
  const {result} = renderHook(() => useMusicAlignmentEditor({document: score, spans}));
  assert.ok(result.current.alignment);
  const tick = secondsToTick(result.current.alignment, 1);
  act(() => assert.equal(result.current.applyAnchor(1, tick), true));
  assert.equal(result.current.anchors.length, 1);
  const saved = JSON.stringify(result.current.savedAlignment);
  act(() => result.current.setOffsetSeconds(.25));
  assert.notEqual(JSON.stringify(result.current.savedAlignment), saved);
  act(() => result.current.undo());
  assert.equal(result.current.anchors.length, 0);
  act(() => result.current.redo());
  assert.equal(result.current.anchors.length, 1);
  act(() => assert.equal(result.current.removeAnchor(0), true));
  assert.equal(result.current.anchors.length, 0);
});

test('invalid anchors are refused with a notice', () => {
  const score = document();
  const {result} = renderHook(() => useMusicAlignmentEditor({document: score, spans}));
  act(() => assert.equal(result.current.applyAnchor(0, -1), false));
  assert.match(result.current.notice, /whole tick/);
});

test('hydrate installs one saved map and clears anchor history', () => {
  const score = document();
  const {result} = renderHook(() => useMusicAlignmentEditor({document: score, spans}));
  const initial = result.current.alignment;
  assert.ok(initial);
  act(() => assert.equal(result.current.applyAnchor(1, secondsToTick(initial, 1)), true));
  assert.equal(result.current.canUndo, true);

  const base = alignmentFromSpans(score, spans);
  const saved = addAnchor(base, score, 1, 960);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  act(() => result.current.hydrate({
    spans, offsetSeconds: 0.5,
    alignment: {alignment_version: 1, mode: 'anchored', basis: 'passages',
      offset_seconds: 0.5, anchors: [{seconds: 1, tick: 960}],
      passages: saved.alignment.passages},
    anchors: [{seconds: 1, tick: 960}],
  }));

  assert.equal(result.current.offsetSeconds, 0.5);
  assert.deepEqual(result.current.anchors, [{seconds: 1, tick: 960}]);
  assert.equal(result.current.alignment?.mode, 'anchored');
  assert.equal(result.current.canUndo, false, 'loading is not an anchor edit');
});

test('viewport zoom/reveal never mutates saved alignment', () => {
  const score = document();
  const {result} = renderHook(() => useMusicAlignmentEditor({document: score, spans}));
  const saved = JSON.stringify(result.current.savedAlignment);
  const zoomed = zoomAround({start: 0, span: 2}, 2, 2, null);
  revealWindow(zoomed, 2, 1);
  assert.equal(JSON.stringify(result.current.savedAlignment), saved);
});
