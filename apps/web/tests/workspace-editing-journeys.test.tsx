/**
 * Phase 6 correction journeys: timing-map insertion, insertion controls, truthful
 * modes, tie/occurrence scope, shortcuts and the written position control.
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
const {insertionPlacement} = await import('../src/music/workspace/save-payload.ts');
const {buildNotation, alignmentFromSpans, estimatedAlignment} = await import('../../../packages/music-notation/index.ts');

afterEach(() => cleanup());

async function open(url = '?demo=frames') {
  window.history.replaceState(null, '', `/workspace-harness.html${url}`);
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  return view;
}

const total = (view: any) => Number(view.container.querySelector('.ws-roll-svg')?.getAttribute('data-total-notes'));

test('insertion maps source seconds through the offset and the explanation-aware score time', () => {
  const events = [
    {id: 'a', onset: 2, duration: 0.5, pitch: 60},
    {id: 'b', onset: 8, duration: 0.5, pitch: 72},
  ].map(event => ({...event, velocity: 0.5, confidence: null, optional: false, string: null, fret: null}));
  const spans = [{start: 0, end: 4, kind: 'playing' as const},
    {start: 4, end: 7, kind: 'explanation' as const},
    {start: 7, end: 12, kind: 'playing' as const}];
  const document = buildNotation(events, {bpm: 120, duration: 12});
  const map = alignmentFromSpans(document, spans);
  const atEight = insertionPlacement(map, document, 8, 0);
  assert.equal(atEight.ok, true);
  if (atEight.ok) assert.equal(atEight.tick, 4800, '8 s after a 3 s explanation is score tick 4800');
  const offset = insertionPlacement(estimatedAlignment(document), document, 2.5, 0.5);
  assert.equal(offset.ok, true);
  if (offset.ok) {
    assert.equal(offset.performed, 2, 'the displayed second minus the offset is the stored onset');
    assert.equal(offset.tick, 1920);
  }
  const held = insertionPlacement(map, document, 5.5, 0);
  assert.equal(held.ok, false, 'a spoken explanation has no score time');
  if (!held.ok) assert.match(held.problem, /explanation/i);
  assert.equal(insertionPlacement(map, document, -0.5, 0).ok, false);
});

test('the add ghost shows and commits the chosen recorded length and written value', async () => {
  const view = await open();
  const start = total(view);
  fireEvent.click(view.container.querySelector('[data-add="toggle"]')!);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-add-layer')));
  fireEvent.change(view.container.querySelector('[data-add="length"]')!, {target: {value: '0.25'}});
  fireEvent.change(view.container.querySelector('[data-add="written"]')!, {target: {value: '960'}});
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-add-layer')!, {clientX: 300, clientY: 120});
  await waitFor(() => assert.ok(view.container.querySelector('[data-ghost="true"]')));
  const ghostWidth = Number(view.container.querySelector('[data-ghost="true"]')!.getAttribute('width'));
  assert.ok(ghostWidth >= 13 && ghostWidth <= 17, `ghost should be 0.25 s wide, got ${ghostWidth}`);
  fireEvent.click(view.getByRole('button', {name: 'Insert'}));
  await waitFor(() => assert.equal(total(view), start + 1));
  const inserted = [...view.container.querySelectorAll('.ws-roll-note')]
    .find(node => Number(node.getAttribute('x')) > 295 && Number(node.getAttribute('x')) < 305)!;
  fireEvent.pointerDown(inserted, {clientX: 300, clientY: 120, pointerId: 9, button: 0});
  fireEvent.pointerUp(inserted, {pointerId: 9});
  await waitFor(() => assert.equal((view.getByLabelText('Recorded length (s)') as HTMLInputElement).value, '0.25'));
  assert.match(view.getByText(/written 960 ticks/).textContent ?? '', /960/,
    'the chosen written value must be independent of the 0.25 s recorded length');
});

test('Replace reports a rejected command and stays in mode', async () => {
  const view = await open('?demo=double');
  const first = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(first, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(first, {pointerId: 1});
  await waitFor(() => assert.ok(view.container.querySelector('[data-tie-scope="segments"], [data-recorded-attacks="true"]')));
  // The two attacks are distinct occurrences, so a replacement is valid; a same-pitch
  // replacement must be a truthful no-op with no history entry.
  const before = first.getAttribute('data-pitch');
  view.getByRole('button', {name: 'Replace pitch'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-replace="active"]')));
  const key = view.container.querySelector(`.keyboard-white[data-pitch="${before}"], .keyboard-black[data-pitch="${before}"]`)!;
  fireEvent.click(key);
  await waitFor(() => assert.match(view.getByText(/same pitch, no change/i).textContent ?? '', /same pitch/));
  assert.equal(view.container.querySelector('[data-replace="active"]'), null);
  assert.equal(view.getByRole('button', {name: 'Undo', exact: true}).hasAttribute('disabled'), true,
    'a no-op replacement must not create history');
});

test('tie segments and recorded attacks are labelled separately', async () => {
  const view = await open('?demo=double');
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(view.container.querySelector('.ws-roll-note')!, {pointerId: 1});
  await waitFor(() => assert.match(view.getByText(/Recorded attacks mapped to this written note: 2/i).textContent ?? '', /2/));
  assert.ok(view.container.querySelector('[data-occurrence-scope="multiple"]'), 'multiple attacks need their own scope note');
  assert.equal(view.container.querySelector('[data-tie-scope="segments"]'), null,
    'two attacks are not two tied segments');
});

test('Delete and undo/redo shortcuts work outside text fields only', async () => {
  const view = await open();
  const start = total(view);
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(view.container.querySelector('.ws-roll-note')!, {pointerId: 1});
  await waitFor(() => assert.ok(view.container.querySelector('.ws-facts')));
  fireEvent.keyDown(view.container.querySelector('.ws-roll-svg')!, {key: 'Delete'});
  await waitFor(() => assert.equal(total(view), start - 1));
  fireEvent.keyDown(view.container.querySelector('.ws-roll-svg')!, {key: 'z', ctrlKey: true});
  await waitFor(() => assert.equal(total(view), start));
  fireEvent.keyDown(view.container.querySelector('.ws-roll-svg')!, {key: 'y', ctrlKey: true});
  await waitFor(() => assert.equal(total(view), start - 1));

  const offset = view.getByLabelText('Sync offset in seconds') as HTMLInputElement;
  offset.focus();
  const after = total(view);
  fireEvent.keyDown(offset, {key: 'Delete'});
  await waitFor(() => assert.equal(total(view), after, 'typing fields must not trigger delete'));
});

test('the written beat position moves written time without touching the recorded onset', async () => {
  const view = await open();
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(view.container.querySelector('.ws-roll-note')!, {pointerId: 1});
  const facts = () => view.container.querySelector('.ws-facts')?.textContent ?? '';
  const onsetBefore = facts().match(/recorded ([0-9.]+) s/)?.[1];
  fireEvent.click(view.container.querySelector('[data-written-scope="event"]')!);
  const field = view.container.querySelector('[data-written-start]') as HTMLInputElement;
  const next = Number(field.value) + 240;
  fireEvent.change(field, {target: {value: String(next)}});
  fireEvent.click(view.container.querySelector('[data-written-start-apply]')!);
  await waitFor(() => assert.match(view.getByText(/recorded onset unchanged/i).textContent ?? '', /unchanged/));
  assert.equal((view.container.querySelector('[data-written-start]') as HTMLInputElement).value, String(next));
  assert.equal(facts().match(/recorded ([0-9.]+) s/)?.[1], onsetBefore, 'recorded onset must not move');
  assert.equal(view.getByRole('button', {name: 'Undo', exact: true}).hasAttribute('disabled'), false);
});

test('a foreign pointer cannot finish or cancel the original drag', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  const before = note.getAttribute('data-pitch');
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 31, button: 0});
  fireEvent.pointerMove(note, {clientX: 100, clientY: 78, pointerId: 31});
  fireEvent.pointerUp(note, {clientX: 100, clientY: 78, pointerId: 99});
  assert.equal(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'), before,
    'a foreign release must not commit the preview');
  fireEvent.pointerCancel(window, {pointerId: 31});
  assert.equal(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'), before);
  assert.equal(view.getByRole('button', {name: 'Undo', exact: true}).hasAttribute('disabled'), true);
});

test('an unapplied written-position draft does not leak to another selection', async () => {
  const view = await open('?demo=explanation');
  const first = view.container.querySelector('.ws-roll-note[data-occurrence="d-1"]') as SVGRectElement;
  fireEvent.pointerDown(first, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(first, {pointerId: 1});
  const field = view.container.querySelector('[data-written-start]') as HTMLInputElement;
  const previous = field.value;
  fireEvent.change(field, {target: {value: String(Number(previous) + 240)}});
  const typed = field.value;
  const second = view.container.querySelector('.ws-roll-note[data-occurrence="d-2"]') as SVGRectElement;
  fireEvent.pointerDown(second, {clientX: 120, clientY: 100, pointerId: 2, button: 0});
  fireEvent.pointerUp(second, {pointerId: 2});
  await waitFor(() => assert.equal((view.container.querySelector('[data-written-start]') as HTMLInputElement).value, '1920'));
  assert.notEqual('1920', typed, 'the sibling keeps its own written position');
});

test('exclusive modes block keyboard history as well as the toolbar', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(note, {pointerId: 1});
  view.getByRole('button', {name: '+ semitone'}).click();
  await waitFor(() => assert.equal(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'), '61'));
  const raised = view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch');
  view.getByRole('button', {name: 'Replace pitch'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-replace="active"]')));
  fireEvent.keyDown(window, {key: 'z', ctrlKey: true});
  await waitFor(() => assert.equal(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'), raised,
    'Ctrl+Z must not edit while replacing'));
  assert.ok(view.container.querySelector('[data-replace="active"]'));
  fireEvent.keyDown(window, {key: 'Escape'});

  fireEvent.click(view.container.querySelector('[data-add="toggle"]')!);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-add-layer')));
  fireEvent.keyDown(window, {key: 'z', ctrlKey: true});
  await waitFor(() => assert.equal(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'), raised,
    'Ctrl+Z must not edit while adding'));
  assert.equal(view.getByRole('button', {name: 'Undo', exact: true}).hasAttribute('disabled'), true);
});
test('dirty state is clean after undo, dirty after redo and after branching', async () => {
  const view = await open();
  const dirty = () => view.container.querySelector('[data-workspace-dirty]')?.getAttribute('data-workspace-dirty');
  assert.equal(dirty(), 'false');
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(note, {pointerId: 1});
  await waitFor(() => assert.ok(view.container.querySelector('.ws-facts')));
  view.getByRole('button', {name: '+ semitone'}).click();
  await waitFor(() => assert.equal(dirty(), 'true'));
  view.getByRole('button', {name: 'Undo', exact: true}).click();
  await waitFor(() => assert.equal(dirty(), 'false', 'undo back to the saved content must be clean'));
  view.getByRole('button', {name: 'Redo', exact: true}).click();
  await waitFor(() => assert.equal(dirty(), 'true', 'redo must be dirty'));
  view.getByRole('button', {name: 'Undo', exact: true}).click();
  await waitFor(() => assert.equal(dirty(), 'false'));
  const again = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(again, {clientX: 100, clientY: 100, pointerId: 2, button: 0});
  fireEvent.pointerUp(again, {pointerId: 2});
  await waitFor(() => assert.ok(view.container.querySelector('.ws-facts')));
  view.getByRole('button', {name: '+ semitone'}).click();
  await waitFor(() => assert.equal(dirty(), 'true', 'branching after undo must be dirty'));
});

test('formatted mode is read-only and return keeps editing and selection', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 7, button: 0});
  fireEvent.pointerUp(note, {pointerId: 7});
  await waitFor(() => assert.ok(view.container.querySelector('.ws-facts')));
  view.getByRole('button', {name: '+ semitone'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-workspace-dirty="true"]')));
  const snapshot = () => (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  const before = snapshot();
  view.getByRole('button', {name: 'Formatted score', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-formatted-page="1"]')));
  for (const [key, options] of [['Delete', {}], ['Backspace', {}], ['z', {ctrlKey: true}],
    ['z', {ctrlKey: true, shiftKey: true}], ['a', {}]] as const) {
    fireEvent.keyDown(window, {key, ...options});
  }
  await waitFor(() => {
    const after = snapshot();
    assert.deepEqual(after.document, before.document, 'formatted mode must not edit');
    assert.equal(after.past, before.past);
    assert.equal(after.future, before.future);
    assert.deepEqual(after.selection, before.selection);
  });
  view.getByRole('button', {name: 'Return to correction', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  const returned = snapshot();
  assert.deepEqual(returned.selection, before.selection);
  fireEvent.keyDown(window, {key: 'Delete'});
  await waitFor(() => assert.equal(snapshot().past, before.past + 1, 'correction Delete must work again'));
  fireEvent.keyDown(window, {key: 'z', ctrlKey: true});
  await waitFor(() => assert.equal(snapshot().past, before.past, 'correction Ctrl+Z must work again'));
});

test('repeated formatted switches preserve correction scroll positions and selection', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 9, button: 0});
  fireEvent.pointerUp(note, {pointerId: 9});
  const roll = view.container.querySelector('.ws-roll-viewport') as HTMLElement;
  const score = view.container.querySelector('.ws-score-viewport') as HTMLElement;
  roll.scrollTop = 25; roll.scrollLeft = 72;
  if (score) score.scrollLeft = 117;
  const snapshot = () => (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  const selected = snapshot().selection;
  for (let round = 0; round < 3; round += 1) {
    view.getByRole('button', {name: 'Formatted score', exact: true}).click();
    await waitFor(() => assert.ok(view.container.querySelector('[data-formatted-page="1"]')));
    view.getByRole('button', {name: 'Return to correction', exact: true}).click();
    await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
    assert.equal((view.container.querySelector('.ws-roll-viewport') as HTMLElement).scrollTop, 25);
    assert.equal((view.container.querySelector('.ws-roll-viewport') as HTMLElement).scrollLeft, 72);
    if (score) assert.equal((view.container.querySelector('.ws-score-viewport') as HTMLElement).scrollLeft, 117);
    assert.deepEqual(snapshot().selection, selected);
  }
});

test('switching to formatted cancels active add/replace modes', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 11, button: 0});
  fireEvent.pointerUp(note, {pointerId: 11});
  view.getByRole('button', {name: 'Replace pitch'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-replace="active"]')));
  view.getByRole('button', {name: 'Formatted score', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-formatted-page="1"]')));
  view.getByRole('button', {name: 'Return to correction', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  assert.equal(view.container.querySelector('[data-replace="active"]'), null);

  fireEvent.click(view.container.querySelector('[data-add="toggle"]')!);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-add-layer')));
  view.getByRole('button', {name: 'Formatted score', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-formatted-page="1"]')));
  view.getByRole('button', {name: 'Return to correction', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  assert.equal(view.container.querySelector('.ws-roll-add-layer'), null);
});

test('switching to formatted cancels an in-flight pointer drag and late release', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  const box = note.getBoundingClientRect();
  const snapshot = () => (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  const before = snapshot();
  fireEvent.pointerDown(note, {clientX: box.x + 4, clientY: box.y + box.height / 2, pointerId: 12, button: 0});
  fireEvent.pointerMove(window, {clientX: box.x + 4, clientY: box.y + box.height / 2 - 8, pointerId: 12, buttons: 1});
  view.getByRole('button', {name: 'Formatted score', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-formatted-page="1"]')));
  fireEvent.pointerUp(window, {clientX: box.x + 4, clientY: box.y + box.height / 2 - 8, pointerId: 12});
  await waitFor(() => {
    const after = snapshot();
    assert.deepEqual(after.document, before.document, 'late drag release must not commit');
    assert.equal(after.past, before.past);
    assert.equal(after.future, before.future);
  });
  view.getByRole('button', {name: 'Return to correction', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  const again = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  const nextBox = again.getBoundingClientRect();
  fireEvent.pointerDown(again, {clientX: nextBox.x + 4, clientY: nextBox.y + nextBox.height / 2, pointerId: 13, button: 0});
  fireEvent.pointerMove(window, {clientX: nextBox.x + 4, clientY: nextBox.y + nextBox.height / 2 - 8, pointerId: 13, buttons: 1});
  fireEvent.pointerUp(window, {clientX: nextBox.x + 4, clientY: nextBox.y + nextBox.height / 2 - 8, pointerId: 13});
  await waitFor(() => assert.equal(snapshot().past, before.past + 1, 'normal editing resumes after return'));
});
