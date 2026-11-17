/**
 * Shared JSDOM/React setup for the workspace journey test files.
 *
 * The original single file hit an out-of-memory abort in the final shared-scrollbar
 * scenario because that scenario used `assert.equal(domNode, null)` inside `waitFor`:
 * when the condition was briefly false, Node inspected the whole JSDOM element and
 * allocated for tens of seconds. The assertions now use boolean checks. The journeys
 * are also grouped into independently scoped files so one process does not carry every
 * workspace scenario; all 17 scenarios and assertions are preserved. Each test file
 * imports this module once.
 */
import {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

export const dom = new JSDOM('<!doctype html><html><body></body></html>', {
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
Object.defineProperty(globalThis, 'localStorage', {value: window.localStorage, configurable: true});
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 600; }, configurable: true});

const testingLibrary = await import('@testing-library/react');
export const {render, fireEvent, cleanup, waitFor} = testingLibrary;
const harness = await import('../src/music/workspace/PianoWorkspaceHarness.tsx');
export const {PianoWorkspaceHarness} = harness;

afterEach(() => cleanup());

export async function open(url = '?demo=frames') {
  window.history.replaceState(null, '', `/workspace-harness.html${url}`);
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.container.querySelector('[data-roll-toggle]')));
  const toggle = view.container.querySelector('[data-roll-toggle]') as HTMLButtonElement;
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
  return view;
}

export const total = (view: any) => Number(view.container.querySelector('.ws-roll-svg')?.getAttribute('data-total-notes'));

export function openSettings(view: ReturnType<typeof render>, tab?: string) {
  const toggle = view.container.querySelector('[data-settings-toggle]') as HTMLButtonElement | null;
  if (!toggle) throw new Error('Settings toggle is missing');
  fireEvent.click(toggle);
  if (tab) {
    const button = [...view.container.querySelectorAll<HTMLButtonElement>('.ws-drawer-tabs button')]
      .find(candidate => candidate.textContent?.trim() === tab);
    if (!button) throw new Error(`Settings tab is missing: ${tab}`);
    fireEvent.click(button);
  }
}

export function openMore(view: ReturnType<typeof render>) {
  const toggle = view.container.querySelector('[data-more-toggle]') as HTMLButtonElement | null;
  if (!toggle) throw new Error('More toggle is missing');
  fireEvent.click(toggle);
}

export function expandNoteTiming(view: ReturnType<typeof render>) {
  const toggle = view.container.querySelector('.ws-note-more-toggle') as HTMLButtonElement | null;
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

export function closeHarness() {
  dom.window.close();
}
