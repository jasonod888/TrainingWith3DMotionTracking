/**
 * Phase 6 formatted-mode lifecycle and shared-surface journeys: viewport preservation,
 * mode cancellation, roll accordion state, sheet preview cancellation and the shared
 * scrollbar/zoom controls.
 */
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {
  closeHarness, expandNoteTiming, fireEvent, open, openMore, openSettings, PianoWorkspaceHarness, render, waitFor,
} from './workspace-journeys-setup';

after(closeHarness);

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
    openMore(view);
    fireEvent.click(view.container.querySelector('[data-formatted-toggle]')!);
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
  openSettings(view);
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 11, button: 0});
  fireEvent.pointerUp(note, {pointerId: 11});
  expandNoteTiming(view);
  view.getByRole('button', {name: 'Replace pitch'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-replace="active"]')));
  openMore(view);
  fireEvent.click(view.container.querySelector('[data-formatted-toggle]')!);
  await waitFor(() => assert.ok(view.container.querySelector('[data-formatted-page="1"]')));
  view.getByRole('button', {name: 'Return to correction', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  assert.ok(view.container.querySelector('[data-replace="active"]') === null);

  openSettings(view, 'Editing');
  fireEvent.click(view.container.querySelector('[data-add="toggle"]')!);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-add-layer')));
  openMore(view);
  fireEvent.click(view.container.querySelector('[data-formatted-toggle]')!);
  await waitFor(() => assert.ok(view.container.querySelector('[data-formatted-page="1"]')));
  view.getByRole('button', {name: 'Return to correction', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  assert.ok(view.container.querySelector('.ws-roll-add-layer') === null);
});

test('switching to formatted cancels an in-flight pointer drag and late release', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  const box = note.getBoundingClientRect();
  const snapshot = () => (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  const before = snapshot();
  fireEvent.pointerDown(note, {clientX: box.x + 4, clientY: box.y + box.height / 2, pointerId: 12, button: 0});
  fireEvent.pointerMove(window, {clientX: box.x + 4, clientY: box.y + box.height / 2 - 8, pointerId: 12, buttons: 1});
  openMore(view);
  fireEvent.click(view.container.querySelector('[data-formatted-toggle]')!);
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
});

test('piano roll accordion defaults collapsed and preserves roll state', async () => {
  window.history.replaceState(null, '', '/workspace-harness.html?demo=frames');
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.container.querySelector('[data-roll-toggle]')));
  const toggle = view.container.querySelector('[data-roll-toggle]') as HTMLButtonElement;
  assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'roll starts collapsed');
  assert.equal(view.container.querySelector('#piano-roll-body')?.hasAttribute('hidden'), true);
  fireEvent.click(toggle);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  const roll = view.container.querySelector('.ws-roll-viewport') as HTMLElement;
  roll.scrollTop = 31; roll.scrollLeft = 77;
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 21, button: 0});
  fireEvent.pointerUp(note, {pointerId: 21});
  const snapshot = () => (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  const selected = snapshot().selection;
  fireEvent.click(toggle);
  await waitFor(() => assert.equal(toggle.getAttribute('aria-expanded'), 'false'));
  fireEvent.click(toggle);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  assert.equal((view.container.querySelector('.ws-roll-viewport') as HTMLElement).scrollTop, 31);
  assert.equal((view.container.querySelector('.ws-roll-viewport') as HTMLElement).scrollLeft, 77);
  assert.deepEqual(snapshot().selection, selected);
});

test('sheet drag preview moves head, stem, flags and accidental together and cancels cleanly', async () => {
  const view = await open();
  const head = view.container.querySelector('.ws-score-notehead[data-occurrence]') as SVGEllipseElement;
  const occurrence = head.getAttribute('data-occurrence')!;
  const eventGroup = head.closest('.ws-score-event') as SVGGElement;
  const stem = eventGroup.querySelector('.ws-score-stem') as SVGLineElement | null;
  const before = (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  const beforeCy = Number(head.getAttribute('cy'));
  const beforeStem = stem ? [Number(stem.getAttribute('y1')), Number(stem.getAttribute('y2'))] : null;
  fireEvent.pointerDown(head, {clientX: 100, clientY: 100, pointerId: 31, button: 0});
  fireEvent.pointerMove(head, {clientX: 100, clientY: 92, pointerId: 31, buttons: 1});
  await waitFor(() => assert.ok(view.container.querySelector(`[data-occurrence="${occurrence}"][data-sheet-preview]`)));
  const previewHead = view.container.querySelector(`[data-occurrence="${occurrence}"][data-sheet-preview]`) as SVGEllipseElement;
  assert.notEqual(Number(previewHead.getAttribute('cy')), beforeCy, 'preview notehead must move');
  if (stem && beforeStem) {
    assert.notDeepEqual([Number(stem.getAttribute('y1')), Number(stem.getAttribute('y2'))], beforeStem,
      'shared stem must move with the preview');
  }
  fireEvent.keyDown(window, {key: 'Escape'});
  fireEvent.pointerUp(head, {clientX: 100, clientY: 92, pointerId: 31});
  await waitFor(() => {
    const after = (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
    assert.deepEqual(after.document, before.document, 'cancelled drag must not change the document');
    assert.equal(after.past, before.past);
  });
});

test('one shared scrollbar suspends and resumes follow and shares zoom', async () => {
  const view = await open();
  openSettings(view);
  const bars = view.container.querySelectorAll('[data-shared-scrollbar]');
  assert.equal(bars.length, 1, 'only one horizontal scrollbar exists');
  const bar = bars[0] as HTMLDivElement;
  bar.scrollLeft = 120;
  fireEvent.scroll(bar);
  await waitFor(() => assert.ok(view.container.querySelector('[data-follow-suspended="true"]')));
  view.getByRole('button', {name: 'Resume follow', exact: true}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-follow-suspended="true"]') === null));
  const zoomBefore = view.container.querySelector('[data-shared-zoom]')?.getAttribute('data-shared-zoom');
  view.getByRole('button', {name: 'Zoom in'}).click();
  await waitFor(() => assert.notEqual(view.container.querySelector('[data-shared-zoom]')?.getAttribute('data-shared-zoom'), zoomBefore));
});
