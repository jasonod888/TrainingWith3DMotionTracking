/**
 * Phase 1 focused-shell acceptance: header, dock, settings/More drawer lifecycle,
 * on-demand video access and roll disclosure.
 */
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {
  closeHarness, fireEvent, open, openMore, openSettings, PianoWorkspaceHarness, render, waitFor,
} from './workspace-journeys-setup';
import {pitchName} from '../src/music/music-reference.ts';

after(closeHarness);

async function openCollapsed() {
  window.history.replaceState(null, '', '/workspace-harness.html?demo=frames');
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.container.querySelector('[data-roll-toggle]')));
  return view;
}

test('default review shell exposes focused actions and no legacy toolbar or sidebar', async () => {
  const view = await openCollapsed();
  for (const name of ['Undo', 'Redo', 'Settings', 'More', 'Play']) {
    assert.ok(view.getByRole('button', {name, exact: true}), `${name} action is missing`);
  }
  assert.ok(view.getByRole('button', {name: 'Review and save'}));
  assert.ok(view.container.querySelector('[data-roll-toggle]'));
  assert.equal(view.container.querySelector('[data-roll-toggle]')?.getAttribute('aria-expanded'), 'false');
  assert.ok(view.container.querySelector('.ws-toolbar') === null, 'legacy toolbar is removed');
  assert.equal(view.container.querySelector('[data-settings-drawer]')?.hasAttribute('hidden'), true,
    'settings drawer starts closed');
  assert.ok(view.container.querySelector('.ws-keyboard-surface'));
  assert.ok(view.container.querySelector('.ws-score-surface'));
  assert.ok(view.container.querySelector('.ws-dock'));
  assert.ok(view.container.querySelector('.ws-overview-window'));
});

test('default stage exposes instrument-roll-sheet modules with the live guide above keys', async () => {
  const view = await openCollapsed();
  const stage = view.container.querySelector('.ws-stage') as HTMLElement;
  assert.equal(stage.getAttribute('data-stage-layout'), 'instrument-roll-sheet');
  const modules = [...view.container.querySelectorAll<HTMLElement>('[data-stage-module]')]
    .map(module => module.getAttribute('data-stage-module'));
  assert.deepEqual(modules, ['instrument', 'roll', 'sheet']);
  const instrument = view.container.querySelector('[data-stage-module="instrument"]') as HTMLElement;
  const waterfall = instrument.querySelector('[data-waterfall-slot="true"]') as HTMLElement;
  assert.ok(waterfall && !waterfall.hasAttribute('hidden'));
  const keyboard = instrument.querySelector('.ws-keyboard-surface') as HTMLElement;
  assert.ok(Boolean(waterfall.compareDocumentPosition(keyboard) & 4),
    'waterfall precedes the keyboard inside the instrument');
  await waitFor(() => assert.ok(instrument.querySelector('.ws-waterfall-svg')), {timeout: 1200});
  assert.ok(view.container.querySelector('#piano-roll') && view.container.querySelector('#piano-score'));
  const svg = instrument.querySelector('.keyboard-svg') as SVGElement;
  await waitFor(() => assert.ok(Number(svg.getAttribute('data-semitones')) > 0));
  assert.ok(Number(svg.getAttribute('data-first-pitch')) >= 0);
  assert.ok(view.container.querySelector('.ws-piano-range')?.textContent?.includes(
    pitchName(Number(svg.getAttribute('data-first-pitch')))),
    'dock range badge uses the same musical name as the visible key range');
});

test('wide instrument uses the fixed A0–C8 range with 88 keys', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')!;
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    get() { return 1200; }, configurable: true,
  });
  try {
    const view = await openCollapsed();
    const svg = await waitFor(() => {
      const node = view.container.querySelector('.keyboard-svg') as SVGElement | null;
      assert.ok(node);
      return node;
    });
    await waitFor(() => assert.equal(svg.getAttribute('data-first-pitch'), '21'));
    assert.equal(svg.getAttribute('data-semitones'), '87');
    assert.equal(svg.getAttribute('data-key-count'), '88');
    assert.equal(view.container.querySelector('.keyboard-toolbar button'), null,
      'fixed full range hides range/octave controls');
    assert.match(view.container.querySelector('.ws-piano-range')?.textContent ?? '', /A0–C8 · 88 keys/,
      'full range label is in the dock, not over keys');
  } finally {
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', descriptor);
  }
});

test('an embedded review exposes a Back action', async () => {
  window.history.replaceState(null, '', '/workspace-harness.html?demo=frames');
  const view = render(<PianoWorkspaceHarness onBack={() => {}}/>);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-svg')));
  assert.ok(view.getByRole('button', {name: 'Back', exact: true}));
});

test('settings and More share one drawer; Escape closes it', async () => {
  const view = await open();
  view.getByRole('button', {name: 'Video', exact: true}).click();
  await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.hasAttribute('hidden'), false));
  assert.match(view.container.querySelector('[data-settings-drawer]')?.textContent ?? '', /Source video|Video/);
  view.container.querySelector<HTMLButtonElement>('[data-settings-drawer] [aria-label="Close settings"]')!.click();
  await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.hasAttribute('hidden'), true));
  openSettings(view);
  await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.hasAttribute('hidden'), false));
  fireEvent.keyDown(window, {key: 'Escape'});
  await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.hasAttribute('hidden'), true));
  openMore(view);
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Reopen saved'})));
});

test('roll disclosure reallocates inside the workspace without removing the score', async () => {
  const view = await openCollapsed();
  const toggle = view.container.querySelector('[data-roll-toggle]') as HTMLButtonElement;
  const body = view.container.querySelector('#piano-roll-body') as HTMLElement;
  assert.equal(body.hidden, true);
  fireEvent.click(toggle);
  assert.equal(body.hidden, false);
  assert.ok(view.container.querySelector('.ws-roll-svg'));
  assert.ok(view.container.querySelector('.ws-score-svg'), 'score remains mounted while the roll is open');
  fireEvent.click(toggle);
  assert.equal(body.hidden, true);
  assert.ok(view.container.querySelector('.ws-score-svg'));
});

test('keyboard stays inside the compact height budget', async () => {
  const view = await openCollapsed();
  const svg = view.container.querySelector('.ws-keyboard-surface .keyboard-svg') as SVGElement;
  assert.ok(svg, 'keyboard SVG is present');
  const height = Number.parseFloat((svg as unknown as {style: CSSStyleDeclaration}).style.height);
  assert.ok(Number.isFinite(height) && height > 0 && height <= 140,
    `compact keyboard height must stay <=140px, got ${height}`);
});
