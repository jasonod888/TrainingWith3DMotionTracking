import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {
  closeHarness, fireEvent, openSettings, PianoWorkspaceHarness, render, waitFor,
} from './workspace-journeys-setup';

after(closeHarness);

const COMPACT_KEY = 'piano-review-compact-view-v1';

function limitedMedia() {
  return (query: string) => ({
    matches: query.includes('max-height: 560px') || query.includes('max-width: 760px'),
    media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  });
}

async function renderCompact() {
  window.history.replaceState(null, '', '/workspace-harness.html?demo=frames');
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-compact-switch')));
  await waitFor(() => assert.ok(view.container.querySelector('.ws-waterfall-svg')));
  return view;
}

test('compact Guide/Sheet switch preserves selection, undo, roll preference and single media', async () => {
  const original = window.matchMedia;
  window.matchMedia = limitedMedia() as typeof window.matchMedia;
  localStorage.removeItem(COMPACT_KEY);
  try {
    const view = await renderCompact();
    const stage = () => view.container.querySelector('.ws-stage') as HTMLElement;
    assert.equal(stage().getAttribute('data-compact-view'), 'guide');
    assert.equal(localStorage.getItem(COMPACT_KEY), null);
    const score = view.container.querySelector('.ws-score-notehead[data-occurrence]') as SVGEllipseElement;
    fireEvent.pointerDown(score, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
    fireEvent.pointerUp(score, {pointerId: 1});
    await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.getAttribute('data-mode'), 'note'));
    assert.equal(stage().getAttribute('data-compact-view'), 'guide',
      'selection does not leave compact mode');
    const snapshot = () => (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
    const before = snapshot();
    const media = [...view.container.querySelectorAll('video')];
    fireEvent.click([...view.container.querySelectorAll<HTMLButtonElement>('.ws-compact-switch button')]
      .find(button => button.textContent?.trim() === 'Sheet')!);
    await waitFor(() => assert.equal(stage().getAttribute('data-compact-view'), 'sheet'));
    assert.equal(localStorage.getItem(COMPACT_KEY), 'sheet');
    assert.equal(snapshot().selection.occurrenceId, before.selection.occurrenceId);
    assert.equal(snapshot().past, before.past);
    assert.equal(stage().getAttribute('data-roll-open'), 'false');
    assert.equal(view.container.querySelectorAll('video').length, media.length);
    if (media.length) assert.ok(media[0] === view.container.querySelector('video'));

    fireEvent.click(view.getByRole('button', {name: 'Guide', exact: true}));
    await waitFor(() => assert.equal(stage().getAttribute('data-compact-view'), 'guide'));
    assert.equal(localStorage.getItem(COMPACT_KEY), 'guide');
    assert.deepEqual(snapshot().selection, before.selection);
  } finally {
    window.matchMedia = original;
  }
});

test('Place in compact mode temporarily exposes the editing roll and returns to the chosen view', async () => {
  const original = window.matchMedia;
  window.matchMedia = limitedMedia() as typeof window.matchMedia;
  localStorage.setItem(COMPACT_KEY, 'guide');
  try {
    const view = await renderCompact();
    openSettings(view, 'Editing');
    fireEvent.click(view.container.querySelector('[data-add="toggle"]')!);
    await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-add-layer')));
    const stage = view.container.querySelector('.ws-stage') as HTMLElement;
    assert.equal(stage.getAttribute('data-compact-view'), 'place',
      'placement deliberately enters a dedicated temporary edit layout');
    assert.ok(view.container.querySelector('.ws-add-place-panel'),
      'Insert/Cancel live in the bounded inline placement panel');
    assert.equal(view.container.querySelector('#piano-roll-body')?.hasAttribute('hidden'), false,
      'placement exposes the real roll without changing roll preference');
    assert.equal(stage.getAttribute('data-roll-open'), 'false');
    assert.equal(view.container.querySelector('.ws-compact-switch'), null);
    assert.ok(view.container.querySelector('[data-add-mode-active="true"]'));
    fireEvent.click(view.container.querySelector('[data-add="cancel"]')!);
    await waitFor(() => assert.equal(stage.getAttribute('data-compact-view'), 'guide'));
    assert.equal(view.container.querySelector('#piano-roll-body')?.hasAttribute('hidden'), true);
    assert.equal(localStorage.getItem(COMPACT_KEY), 'guide');
  } finally {
    window.matchMedia = original;
  }
});

test('switching Guide/Sheet during keyboard pitch choice preserves the active mode and editor context', async () => {
  const original = window.matchMedia;
  window.matchMedia = limitedMedia() as typeof window.matchMedia;
  localStorage.removeItem(COMPACT_KEY);
  try {
    const view = await renderCompact();
    const score = view.container.querySelector('.ws-score-notehead[data-occurrence]') as SVGEllipseElement;
    fireEvent.pointerDown(score, {clientX: 100, clientY: 100, pointerId: 2, button: 0});
    fireEvent.pointerUp(score, {pointerId: 2});
    await waitFor(() => assert.ok(view.getByRole('button', {name: 'Edit note'})));
    fireEvent.click(view.getByRole('button', {name: 'Edit note'}));
    fireEvent.click(view.getByRole('button', {name: 'Choose on keyboard'}));
    await waitFor(() => assert.ok(view.container.querySelector('[data-pitch-pick-active="true"]')));
    fireEvent.click(view.getByRole('button', {name: 'Sheet', exact: true}));
    await waitFor(() => assert.equal(
      view.container.querySelector('.ws-stage')?.getAttribute('data-compact-view'), 'sheet'));
    assert.ok(view.container.querySelector('[data-pitch-pick-active="true"]'),
      'changing the compact view must not cancel keyboard pitch choice');
    assert.equal(view.container.querySelector('[data-settings-drawer]')?.getAttribute('data-suppressed'), 'true');
    const key = view.container.querySelector('.keyboard-white[data-pitch="60"], .keyboard-black[data-pitch="60"]') as SVGRectElement;
    assert.ok(key, 'visible keyboard is still available');
    fireEvent.click(key);
    await waitFor(() => assert.ok(
      view.container.querySelector('[data-pitch-pick-active="true"]') === null));
    assert.equal(view.container.querySelector('[data-settings-drawer]')?.getAttribute('data-suppressed'), 'false');
    assert.equal(view.container.querySelector('.ws-stage')?.getAttribute('data-compact-view'), 'sheet');
  } finally {
    window.matchMedia = original;
  }
});
