/**
 * Phase 6 workspace mode journeys: pointer ownership, draft scoping, exclusive modes,
 * dirty history and formatted read-only behavior.
 */
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {closeHarness, expandNoteTiming, fireEvent, open, openMore, openSettings, waitFor} from './workspace-journeys-setup';

after(closeHarness);

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
  openSettings(view);
  const first = view.container.querySelector('.ws-roll-note[data-occurrence="d-1"]') as SVGRectElement;
  fireEvent.pointerDown(first, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(first, {pointerId: 1});
  expandNoteTiming(view);
  const field = view.container.querySelector('[data-written-start]') as HTMLInputElement;
  const previous = field.value;
  fireEvent.change(field, {target: {value: String(Number(previous) + 240)}});
  const typed = field.value;
  const second = view.container.querySelector('.ws-roll-note[data-occurrence="d-2"]') as SVGRectElement;
  fireEvent.pointerDown(second, {clientX: 120, clientY: 100, pointerId: 2, button: 0});
  fireEvent.pointerUp(second, {pointerId: 2});
  expandNoteTiming(view);
  await waitFor(() => assert.equal((view.container.querySelector('[data-written-start]') as HTMLInputElement).value, '1920'));
  assert.notEqual('1920', typed, 'the sibling keeps its own written position');
});

test('exclusive modes block keyboard history as well as the toolbar', async () => {
  const view = await open();
  openSettings(view, 'Editing');
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(note, {pointerId: 1});
  view.getByRole('button', {name: '+ semitone'}).click();
  await waitFor(() => assert.equal(view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch'), '61'));
  const raised = view.container.querySelector('.ws-roll-note')?.getAttribute('data-pitch');
  expandNoteTiming(view);
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
  openSettings(view);
  const dirty = () => view.container.querySelector('[data-workspace-dirty]')?.getAttribute('data-workspace-dirty');
  assert.equal(dirty(), 'false');
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(note, {pointerId: 1});
  await waitFor(() => assert.equal(
    view.container.querySelector('[data-settings-drawer]')?.getAttribute('data-mode'), 'note'));
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
  await waitFor(() => assert.equal(
    view.container.querySelector('[data-settings-drawer]')?.getAttribute('data-mode'), 'note'));
  view.getByRole('button', {name: '+ semitone'}).click();
  await waitFor(() => assert.equal(dirty(), 'true', 'branching after undo must be dirty'));
});

test('formatted mode is read-only and return keeps editing and selection', async () => {
  const view = await open();
  openSettings(view);
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 7, button: 0});
  fireEvent.pointerUp(note, {pointerId: 7});
  expandNoteTiming(view);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-facts')));
  view.getByRole('button', {name: '+ semitone'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-workspace-dirty="true"]')));
  const snapshot = () => (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  const before = snapshot();
  openMore(view);
  fireEvent.click(view.container.querySelector('[data-formatted-toggle]')!);
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
