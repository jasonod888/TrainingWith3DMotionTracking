/**
 * Phase 6 correction journeys: timing-map insertion, insertion controls, tie and
 * occurrence scope, shortcuts and the written position control.
 */
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {
  closeHarness, expandNoteTiming, fireEvent, open, openSettings, total, waitFor,
} from './workspace-journeys-setup';
import {insertionPlacement} from '../src/music/workspace/save-payload.ts';
import {
  alignmentFromSpans, buildNotation, estimatedAlignment,
} from '../../../packages/music-notation/index.ts';

after(closeHarness);

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
  openSettings(view, 'Editing');
  const start = total(view);
  fireEvent.click(view.container.querySelector('[data-add="toggle"]')!);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-add-layer')));
  fireEvent.change(view.container.querySelector('[data-add="length"]')!, {target: {value: '0.25'}});
  fireEvent.change(view.container.querySelector('[data-add="written"]')!, {target: {value: '960'}});
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-add-layer')!, {clientX: 300, clientY: 120});
  await waitFor(() => assert.ok(view.container.querySelector('[data-ghost="true"]')));
  const ghostWidth = Number(view.container.querySelector('[data-ghost="true"]')!.getAttribute('width'));
  assert.ok(ghostWidth >= 8 && ghostWidth <= 40, `ghost should follow the shared measure layout, got ${ghostWidth}`);
  fireEvent.click(view.getByRole('button', {name: 'Insert'}));
  await waitFor(() => assert.equal(total(view), start + 1));
  const inserted = [...view.container.querySelectorAll('.ws-roll-note')].at(-1) as SVGRectElement;
  fireEvent.pointerDown(inserted, {clientX: 300, clientY: 120, pointerId: 9, button: 0});
  fireEvent.pointerUp(inserted, {pointerId: 9});
  expandNoteTiming(view);
  await waitFor(() => assert.equal((view.getByLabelText('Recorded length (s)') as HTMLInputElement).value, '0.25'));
  assert.match(view.getByText(/written 960 ticks/).textContent ?? '', /960/,
    'the chosen written value must be independent of the 0.25 s recorded length');
});

test('Replace reports a rejected command and stays in mode', async () => {
  const view = await open('?demo=double');
  openSettings(view);
  const first = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(first, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(first, {pointerId: 1});
  expandNoteTiming(view);
  await waitFor(() => assert.ok(view.container.querySelector('[data-tie-scope="segments"], [data-recorded-attacks="true"]')));
  // The two attacks are distinct occurrences, so a replacement is valid; a same-pitch
  // replacement must be a truthful no-op with no history entry.
  const before = first.getAttribute('data-pitch');
  view.getByRole('button', {name: 'Replace pitch'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-replace="active"]')));
  const key = view.container.querySelector(`.keyboard-white[data-pitch="${before}"], .keyboard-black[data-pitch="${before}"]`)!;
  fireEvent.click(key);
  await waitFor(() => assert.match(view.getByText(/same pitch, no change/i).textContent ?? '', /same pitch/));
  assert.ok(view.container.querySelector('[data-replace="active"]') === null);
  assert.equal(view.getByRole('button', {name: 'Undo', exact: true}).hasAttribute('disabled'), true,
    'a no-op replacement must not create history');
});

test('tie segments and recorded attacks are labelled separately', async () => {
  const view = await open('?demo=double');
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(view.container.querySelector('.ws-roll-note')!, {pointerId: 1});
  expandNoteTiming(view);
  await waitFor(() => assert.match(view.getByText(/Recorded attacks mapped to this written note: 2/i).textContent ?? '', /2/));
  assert.ok(view.container.querySelector('[data-occurrence-scope="multiple"]'), 'multiple attacks need their own scope note');
  assert.ok(view.container.querySelector('[data-tie-scope="segments"]') === null,
    'two attacks are not two tied segments');
});

test('Delete and undo/redo shortcuts work outside text fields only', async () => {
  const view = await open();
  openSettings(view);
  const start = total(view);  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(view.container.querySelector('.ws-roll-note')!, {pointerId: 1});
  expandNoteTiming(view);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-facts')));
  fireEvent.keyDown(view.container.querySelector('.ws-roll-svg')!, {key: 'Delete'});
  await waitFor(() => assert.equal(total(view), start - 1));
  fireEvent.keyDown(view.container.querySelector('.ws-roll-svg')!, {key: 'z', ctrlKey: true});
  await waitFor(() => assert.equal(total(view), start));
  fireEvent.keyDown(view.container.querySelector('.ws-roll-svg')!, {key: 'y', ctrlKey: true});
  await waitFor(() => assert.equal(total(view), start - 1));

  openSettings(view, 'Editing');
  const offset = view.getByLabelText('Sync offset in seconds') as HTMLInputElement;
  offset.focus();
  const after = total(view);
  fireEvent.keyDown(offset, {key: 'Delete'});
  await waitFor(() => assert.equal(total(view), after, 'typing fields must not trigger delete'));
});

test('the written beat position moves written time without touching the recorded onset', async () => {
  const view = await open();
  openSettings(view);
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(view.container.querySelector('.ws-roll-note')!, {pointerId: 1});
  expandNoteTiming(view);
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
