/**
 * Phase 6 gesture editing in the isolated workspace.
 */
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/workspace-harness.html?demo=frames', pretendToBeVisual: true,
});
const {window} = dom;
Object.assign(globalThis, {
  window: window as unknown as Window & typeof globalThis,
  document: window.document,
  location: window.location,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
});
Object.defineProperty(globalThis, 'navigator', {value: window.navigator, configurable: true});
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 600; }, configurable: true});

const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {PianoWorkspaceHarness} = await import('../src/music/workspace/PianoWorkspaceHarness.tsx');
const gestures = await import('../src/music/workspace/gestures.ts');

afterEach(() => cleanup());

async function open() {
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-svg')));
  return view;
}

function note(view: any) {
  return view.container.querySelector('.ws-roll-note') as SVGRectElement;
}

test('gesture arithmetic locks an axis, keeps exact seconds and respects snap', () => {
  assert.equal(gestures.resolveAxis(2, 2), null, 'below the threshold nothing moves');
  assert.equal(gestures.resolveAxis(12, 3), 'time');
  assert.equal(gestures.resolveAxis(3, 12), 'pitch');
  assert.equal(gestures.resolveAxis(1, 1, 5, 'resize'), 'resize');
  assert.equal(gestures.pitchFromDrag(60, -20, 10), 62);
  assert.equal(gestures.onsetFromDrag(12.347, 6, 60, null, 20), 12.447, 'no snap keeps the 100 ms');
  assert.equal(gestures.onsetFromDrag(12.347, 6, 60, 0.25, 20), 12.5, 'snap rounds explicitly');
  assert.equal(gestures.durationFromDrag(0.5, -600, 60, null), 0.02, 'recorded length cannot go below the floor');
  assert.equal(gestures.diatonicStep('C4', 1, 'C').pitch, 62, 'one staff step is D');
  assert.equal(gestures.diatonicStep('B4', 1, 'C').pitch, 72, 'B up a step is C5');
});

test('roll pitch drag commits one edit, keeps the onset and one undo step', async () => {
  const view = await open();
  const rect = note(view);
  const before = {pitch: Number(rect.getAttribute('data-pitch')), x: Number(rect.getAttribute('x')),
    width: Number(rect.getAttribute('width'))};
  fireEvent.pointerDown(rect, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerMove(rect, {clientX: 102, clientY: 70, pointerId: 1});
  fireEvent.pointerUp(rect, {clientX: 102, clientY: 70, pointerId: 1});
  const after = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  assert.ok(Number(after.getAttribute('data-pitch')) > before.pitch, 'dragging up raises the pitch');
  assert.equal(Number(after.getAttribute('x')), before.x, 'a pitch drag never moves the onset');
  assert.equal(Number(after.getAttribute('width')), before.width, 'a pitch drag never resizes');
  assert.equal(view.getByRole('button', {name: 'Undo'}).hasAttribute('disabled'), false);
  assert.match(view.getByText(/1 undo step/i).textContent ?? '', /1 undo step/);
});

test('Escape cancels a drag and leaves no history entry', async () => {
  const view = await open();
  const rect = note(view);
  const pitch = rect.getAttribute('data-pitch');
  fireEvent.pointerDown(rect, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerMove(rect, {clientX: 100, clientY: 60, pointerId: 1});
  fireEvent.keyDown(window, {key: 'Escape'});
  fireEvent.pointerUp(rect, {clientX: 100, clientY: 60, pointerId: 1});
  assert.equal(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'), pitch);
  assert.equal(view.getByRole('button', {name: 'Undo'}).hasAttribute('disabled'), true);
});

test('horizontal drag moves the exact recorded start when Snap is off', async () => {
  const view = await open();
  const rect = note(view);
  const onset = Number(rect.getAttribute('aria-label')?.match(/at ([0-9.]+) seconds/)?.[1]);
  fireEvent.pointerDown(rect, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerMove(rect, {clientX: 160, clientY: 101, pointerId: 1});
  fireEvent.pointerUp(rect, {clientX: 160, clientY: 101, pointerId: 1});
  await waitFor(() => {
    const moved = Number(view.container.querySelector('.ws-roll-note')?.getAttribute('aria-label')?.match(/at ([0-9.]+) seconds/)?.[1]);
    assert.ok(Math.abs(moved - (onset + 1)) < 0.01, `expected ${onset + 1} s, got ${moved}`);
  });
});

test('the selected note exposes touch handles and the resize handle changes recorded length only', async () => {
  const view = await open();
  fireEvent.pointerDown(note(view), {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(note(view), {clientX: 100, clientY: 100, pointerId: 1});
  const handle = view.container.querySelector('[data-handle="resize"]') as SVGRectElement;
  assert.ok(handle, 'a selected note needs a resize handle');
  const beforePitch = view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch');
  fireEvent.pointerDown(handle, {clientX: 100, clientY: 100, pointerId: 2, button: 0});
  fireEvent.pointerMove(handle, {clientX: 160, clientY: 100, pointerId: 2});
  console.log('RESIZE-MID', view.container.querySelector('.ws-roll-svg')?.getAttribute('data-drag-axis'),
    (view.container.querySelector('.ws-roll-note') as SVGRectElement)?.getAttribute('data-drag-axis'),
    view.container.querySelector('[data-handle="resize"]') ? 'handle' : 'no-handle');
  fireEvent.pointerUp(handle, {clientX: 160, clientY: 100, pointerId: 2});
  console.log('RESIZE-POST', view.container.querySelector('.ws-report')?.textContent,
    (view.getByLabelText('Recorded length (s)') as HTMLInputElement).value);
  await waitFor(() => assert.equal((view.getByLabelText('Recorded length (s)') as HTMLInputElement).value, '1.5'));
  assert.equal(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'), beforePitch,
    'resizing never changes the pitch');
});

test('sheet drag moves by diatonic steps and shows the candidate spelling', async () => {
  const view = await open();
  const head = view.container.querySelector('.ws-score-notehead') as SVGEllipseElement;
  const before = head.getAttribute('aria-label');
  fireEvent.pointerDown(head, {clientX: 200, clientY: 200, pointerId: 3, button: 0});
  fireEvent.pointerMove(head, {clientX: 200, clientY: 188, pointerId: 3});
  await waitFor(() => assert.ok(view.container.querySelector('[data-sheet-drag-label]'), 'no candidate label during the drag'));
  fireEvent.pointerUp(head, {clientX: 200, clientY: 188, pointerId: 3});
  await waitFor(() => assert.notEqual(view.container.querySelector('.ws-score-notehead')?.getAttribute('aria-label'), before));
});

test('Replace pitch commits once, Escape changes nothing and the same key is a no-op', async () => {
  const view = await open();
  fireEvent.pointerDown(note(view), {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(note(view), {clientX: 100, clientY: 100, pointerId: 1});
  const target = Number(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'));
  view.getByRole('button', {name: 'Replace pitch'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-replace="active"]')));
  fireEvent.keyDown(window, {key: 'Escape'});
  await waitFor(() => assert.equal(view.container.querySelector('[data-replace="active"]'), null));

  view.getByRole('button', {name: 'Replace pitch'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-replace="active"]')));
  const newPitch = target + 2;
  const key = view.container.querySelector(`.keyboard-white[data-pitch="${newPitch}"], .keyboard-black[data-pitch="${newPitch}"]`);
  assert.ok(key, `keyboard key for ${newPitch} is missing`);
  fireEvent.click(key!);
  await waitFor(() => assert.equal(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'), String(newPitch)));
  assert.equal(view.container.querySelector('[data-replace="active"]'), null, 'replacement mode exits');

  view.getByRole('button', {name: 'Replace pitch'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-replace="active"]')));
  const sameKey = view.container.querySelector(`.keyboard-white[data-pitch="${newPitch}"], .keyboard-black[data-pitch="${newPitch}"]`);
  assert.ok(sameKey);
  fireEvent.click(sameKey!);
  await waitFor(() => assert.match(view.getByText(/same pitch, no change/i).textContent ?? '', /same pitch/));
});

test('Add note places a ghost, commits with Insert, cancels with Escape and warns on duplicates', async () => {
  const view = await open();
  const total = () => Number(view.container.querySelector('.ws-roll-svg')?.getAttribute('data-total-notes'));
  const start = total();
  const toggle = () => view.container.querySelector('[data-add="toggle"]') as HTMLButtonElement;

  fireEvent.click(toggle());
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-add-layer')));
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-add-layer')!, {clientX: 300, clientY: 120});
  await waitFor(() => assert.ok(view.container.querySelector('[data-ghost="true"]')));
  fireEvent.click(view.getByRole('button', {name: 'Insert'}));
  await waitFor(() => assert.equal(total(), start + 1, 'Insert should add exactly one note'));
  await waitFor(() => assert.equal(toggle().getAttribute('aria-pressed'), 'false'));

  fireEvent.click(toggle());
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-add-layer')));
  fireEvent.keyDown(window, {key: 'Escape'});
  await waitFor(() => assert.equal(view.container.querySelector('[data-ghost="true"]'), null));
  await waitFor(() => assert.equal(toggle().getAttribute('aria-pressed'), 'false'));
  assert.equal(total(), start + 1, 'Escape must not insert');

  fireEvent.click(toggle());
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-add-layer')));
  const first = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  const fx = Number(first.getAttribute('x'));
  const fy = Number(first.getAttribute('y')) + (Number(first.getAttribute('height')) + 1) / 2;
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-add-layer')!, {clientX: fx, clientY: fy});
  await waitFor(() => assert.ok(view.container.querySelector('[data-ghost="true"]')));
  fireEvent.click(view.getByRole('button', {name: 'Insert'}));
  await waitFor(() => assert.ok(view.getByText(/already starts here/i), 'duplicate placement must warn'));
  assert.ok(view.getByRole('button', {name: 'Select existing'}));
});
