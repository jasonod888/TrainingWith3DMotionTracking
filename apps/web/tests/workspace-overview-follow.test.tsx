/**
 * Overview seeking and playback-start follow behaviour.
 *
 * These are focused journeys against the real harness with the existing phase-1
 * draft fixture and controlled media doubles: no services and no writes.
 */
import {test, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/workspace-harness.html?id=fixture', pretendToBeVisual: true,
});
const {window} = dom;
Object.assign(globalThis, {
  window: window as unknown as Window & typeof globalThis,
  document: window.document,
  location: window.location,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', {value: window.navigator, configurable: true});
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 600; }, configurable: true});

/* ---------------------------------------------------------- media doubles */

const media = new WeakMap<object, {paused: boolean; time: number; duration: number; ready: number; rate: number; src: string}>();
const stateFor = (node: object) => {
  let state = media.get(node);
  if (!state) {
    state = {paused: true, time: 0, duration: 30, ready: 3, rate: 1, src: ''};
    media.set(node, state);
  }
  return state;
};
const proto = window.HTMLMediaElement.prototype;
for (const [name, get, set] of [
  ['paused', (node: object) => stateFor(node).paused, null],
  ['ended', () => false, null],
  ['currentTime', (node: object) => stateFor(node).time, (node: object, value: number) => { stateFor(node).time = value; }],
  ['duration', (node: object) => stateFor(node).duration, null],
  ['readyState', (node: object) => stateFor(node).ready, null],
  ['playbackRate', (node: object) => stateFor(node).rate, (node: object, value: number) => { stateFor(node).rate = value; }],
  ['src', (node: object) => stateFor(node).src, (node: object, value: string) => { stateFor(node).src = value; }],
] as const) {
  Object.defineProperty(proto, name, {
    configurable: true,
    get(this: object) { return (get as (node: object) => unknown)(this); },
    ...(set ? {set(this: object, value: never) { (set as (node: object, value: never) => void)(this, value); }} : {}),
  });
}
(proto as unknown as {load: () => void}).load = function() {};
(proto as unknown as {play: () => Promise<void>}).play = function(this: object) {
  const state = stateFor(this);
  state.paused = false;
  // Native controls and keyboard play activation produce this same event.
  (this as unknown as EventTarget).dispatchEvent(new window.Event('play'));
  return Promise.resolve();
};
(proto as unknown as {pause: () => void}).pause = function(this: object) {
  stateFor(this).paused = true;
  (this as unknown as EventTarget).dispatchEvent(new window.Event('pause'));
};

/* ----------------------------------------------------------- frame clock */

let nextFrame = 1;
const pendingFrames = new Map<number, ReturnType<typeof setTimeout>>();
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  const id = nextFrame++;
  pendingFrames.set(id, setTimeout(() => { pendingFrames.delete(id); callback(Date.now()); }, 4));
  return id as unknown as number;
}) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => {
  const handle = pendingFrames.get(id);
  if (handle) { clearTimeout(handle); pendingFrames.delete(id); }
}) as typeof cancelAnimationFrame;

/* ------------------------------------------------------------- the draft */

const fixture = JSON.parse(readFileSync(
  resolve('..', '..', 'docs', 'qualification', 'piano-workspace-phase-01', 'fixtures', 'phase1-draft-fixture.json'), 'utf8'));
const draft = {...fixture, draft_id: 'fixture', lesson_id: 'fixture', title: 'Overview follow fixture', status: 'draft',
  source_video: {key: 'lessons/fixture/video.mp4', mime: 'video/mp4', bytes: 3, sha256: '0'.repeat(64)},
  piano_preview: null, preview_identity: null};
globalThis.fetch = (async () => new Response(JSON.stringify(draft), {
  headers: {'Content-Type': 'application/json'},
})) as typeof fetch;

const {render, fireEvent, cleanup, waitFor, act} = await import('@testing-library/react');
const {PianoWorkspaceHarness} = await import('../src/music/workspace/PianoWorkspaceHarness.tsx');

afterEach(() => cleanup());
after(() => {
  // Release the frame scheduler and the shared JSDOM window even if a test left
  // media playing; this test file owns one window for all of its tests.
  for (const handle of pendingFrames.values()) clearTimeout(handle);
  pendingFrames.clear();
  dom.window.close();
});

async function open() {
  window.history.replaceState(null, '', '/workspace-harness.html?id=fixture');
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => {
    assert.ok(view.container.querySelector('.ws-overview-window'));
    assert.ok(view.container.querySelector('video'));
    assert.equal(view.container.querySelector('.ws-overview svg')?.getAttribute('width'), '600');
  });
  return view;
}

const overview = (view: ReturnType<typeof render>) => ({
  svg: view.container.querySelector('.ws-overview svg') as SVGSVGElement,
  rect: view.container.querySelector('.ws-overview-window') as SVGRectElement,
  line: view.container.querySelector('.ws-overview-playhead') as SVGLineElement,
  bar: view.container.querySelector('[data-shared-scrollbar]') as HTMLDivElement,
});
const x1 = (line: SVGLineElement) => Number(line.getAttribute('x1'));
const box = (rect: SVGRectElement) => ({
  x: Number(rect.getAttribute('x')), width: Number(rect.getAttribute('width')),
});

function setTime(video: HTMLVideoElement, seconds: number) {
  video.currentTime = seconds;
  video.dispatchEvent(new window.Event('seeked'));
}

const suspended = (view: ReturnType<typeof render>) =>
  view.container.querySelector('[data-follow-suspended="true"]');

const openSettings = (view: ReturnType<typeof render>) => {
  fireEvent.click(view.container.querySelector('[data-settings-toggle]')!);
};

/* ------------------------------------------------------------------ tests */

test('overview click seeks exactly to the clicked source time and reveals it', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const {svg, rect, line} = overview(view);
  setTime(video, 1);
  await waitFor(() => assert.ok(Math.abs(x1(line) - (1 / 12) * 600) < 0.5));

  fireEvent.pointerDown(svg, {clientX: 250, clientY: 20, pointerId: 1, button: 0});
  // 250 / 600 of a 12 s clip is 5 s exactly; no note or alignment snapping.
  await waitFor(() => assert.ok(Math.abs(video.currentTime - 5) < 1e-6,
    `clicked seek was ${video.currentTime}`));
  await waitFor(() => {
    const {x, width} = box(rect);
    const playhead = x1(line);
    assert.ok(playhead >= x - 1e-6 && playhead <= x + width + 1e-6,
      `playhead ${playhead} is outside visible window ${x}..${x + width}`);
  });
});

test('overview drag moves playback with the window and keeps the relative playhead', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const {svg, rect, line} = overview(view);
  setTime(video, 1);
  // Centring click at 5 s makes playback follow the newly revealed window.
  fireEvent.pointerDown(svg, {clientX: 250, clientY: 20, pointerId: 1, button: 0});
  await waitFor(() => assert.ok(Math.abs(video.currentTime - 5) < 1e-6));

  const before = box(rect);
  const beforeAnchor = (x1(line) - before.x) / before.width;
  assert.ok(beforeAnchor > 0 && beforeAnchor < 1, 'clicked playhead must be visible in the window');
  const beforeSeconds = (before.x / 600) * 12;
  const spanSeconds = (before.width / 600) * 12;
  const pausedBefore = video.paused;

  fireEvent.pointerDown(rect, {clientX: 300, pointerId: 7, button: 0});
  // The first move is applied immediately; the second is coalesced and the release
  // must still land on the final pointer position.
  fireEvent.pointerMove(rect, {clientX: 320, pointerId: 7, buttons: 1});
  fireEvent.pointerMove(rect, {clientX: 360, pointerId: 7, buttons: 1});
  fireEvent.pointerUp(rect, {clientX: 360, pointerId: 7});

  const movedStart = Math.min(12 - spanSeconds, beforeSeconds + 1.2);
  const expectedSeek = movedStart + beforeAnchor * spanSeconds;
  await waitFor(() => assert.ok(Math.abs(video.currentTime - expectedSeek) < 0.02,
    `expected release seek ${expectedSeek}, got ${video.currentTime}`));
  await waitFor(() => {
    const after = box(rect);
    const afterAnchor = (x1(line) - after.x) / after.width;
    assert.ok(Math.abs(afterAnchor - beforeAnchor) < 0.02,
      `playhead fraction drifted from ${beforeAnchor} to ${afterAnchor}`);
    assert.ok(Math.abs((after.x / 600) * 12 - movedStart) < 0.02, 'window did not move with the drag');
  });
  assert.equal(video.paused, pausedBefore, 'dragging must preserve the playing/paused state');
});

test('overview slider keyboard pans and seeks with the same visible anchor', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const {rect, line} = overview(view);
  setTime(video, 4);
  fireEvent.pointerDown(overview(view).svg, {clientX: 200, clientY: 20, pointerId: 1, button: 0});
  await waitFor(() => assert.ok(Math.abs(video.currentTime - 4) < 1e-6));

  const before = box(rect);
  const beforeStart = (before.x / 600) * 12;
  const spanSeconds = (before.width / 600) * 12;
  const beforeAnchor = (x1(line) - before.x) / before.width;
  const expectedStart = Math.min(12 - spanSeconds, Math.max(0, beforeStart + spanSeconds * 0.1));
  const expectedSeek = expectedStart + beforeAnchor * spanSeconds;

  fireEvent.keyDown(rect, {key: 'ArrowRight'});
  await waitFor(() => assert.ok(Math.abs(video.currentTime - expectedSeek) < 0.02,
    `keyboard seek was ${video.currentTime}, expected ${expectedSeek}`));
  await waitFor(() => {
    const after = box(rect);
    const afterAnchor = (x1(line) - after.x) / after.width;
    assert.ok(Math.abs(afterAnchor - beforeAnchor) < 0.02, 'keyboard pan must keep the playhead anchored');
  });
});

test('overview dragging keeps the playhead inside the window when it started outside', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const {svg, rect, line} = overview(view);
  // Put the playhead near the end while the visible window is near the start.
  setTime(video, 11);
  await waitFor(() => assert.ok(Math.abs(x1(line) - (11 / 12) * 600) < 0.5));
  const outside = box(rect);
  assert.ok(x1(line) > outside.x + outside.width, 'fixture must start with the playhead outside the window');

  fireEvent.pointerDown(rect, {clientX: 300, pointerId: 9, button: 0});
  fireEvent.pointerMove(rect, {clientX: 360, pointerId: 9, buttons: 1});
  fireEvent.pointerUp(rect, {clientX: 360, pointerId: 9});
  await waitFor(() => {
    const after = box(rect);
    const playhead = x1(line);
    assert.ok(playhead >= after.x - 1e-6 && playhead <= after.x + after.width + 1e-6,
      `playhead ${playhead} was not brought inside ${after.x}..${after.x + after.width}`);
  });
});

test('pointer cancellation cleans up and later movement never seeks', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const {svg, rect, line} = overview(view);
  fireEvent.pointerDown(svg, {clientX: 250, clientY: 20, pointerId: 1, button: 0});
  await waitFor(() => assert.ok(Math.abs(video.currentTime - 5) < 1e-6));

  const before = box(rect);
  const beforeStart = (before.x / 600) * 12;
  const spanSeconds = (before.width / 600) * 12;
  const beforeAnchor = (x1(line) - before.x) / before.width;
  const expected = Math.min(12 - spanSeconds, beforeStart + 0.8) + beforeAnchor * spanSeconds;

  fireEvent.pointerDown(rect, {clientX: 300, pointerId: 11, button: 0});
  fireEvent.pointerMove(rect, {clientX: 340, pointerId: 11, buttons: 1});
  await waitFor(() => assert.ok(Math.abs(video.currentTime - expected) < 0.02,
    `first drag seek was ${video.currentTime}, expected ${expected}`));
  fireEvent.pointerCancel(rect, {pointerId: 11});
  const afterCancel = video.currentTime;
  fireEvent.pointerMove(rect, {clientX: 500, pointerId: 11, buttons: 1});
  fireEvent.pointerUp(rect, {clientX: 500, pointerId: 11});
  assert.ok(Math.abs(video.currentTime - afterCancel) < 1e-9, 'cancelled drag must not seek later');
});

test('native playback clears temporary suspension and reveals the offscreen playhead', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const {bar, rect, line} = overview(view);
  setTime(video, 11);
  await waitFor(() => assert.ok(Math.abs(x1(line) - (11 / 12) * 600) < 0.5));
  bar.scrollLeft = 200;
  fireEvent.scroll(bar);
  await waitFor(() => assert.ok(suspended(view)));
  const before = bar.scrollLeft;

  // Native controls and their keyboard activation dispatch this event.
  await video.play();
  await waitFor(() => assert.ok(suspended(view) === null));
  await waitFor(() => assert.ok(bar.scrollLeft > before,
    `reveal did not move the shared viewport (${before} -> ${bar.scrollLeft})`));
  const after = box(rect);
  const playhead = x1(line);
  assert.ok(playhead >= after.x - 1e-6 && playhead <= after.x + after.width + 1e-6,
    `revealed playhead ${playhead} is outside ${after.x}..${after.x + after.width}`);
});

test('playback start clears temporary suspension and reveals, but explicit off stays off', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const {svg, bar} = overview(view);
  openSettings(view);
  const follow = view.getByRole('checkbox', {name: /Follow playback/}) as HTMLInputElement;
  assert.equal(follow.checked, true, 'fixture starts with Follow enabled');

  // A temporary manual suspension from the ordinary shared scrollbar.
  bar.scrollLeft = 150;
  fireEvent.scroll(bar);
  await waitFor(() => assert.ok(suspended(view)));

  // Native controls / native keyboard activation dispatch this same `play` event.
  await video.play();
  await waitFor(() => assert.ok(suspended(view) === null, 'play must clear temporary suspension'));
  assert.equal(follow.checked, true, 'play must not change the Follow preference');

  video.pause();
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Play', exact: true})
    .getAttribute('aria-label') === 'Play'));

  // Explicitly off: pause/play and seeking must never silently re-enable it.
  fireEvent.click(follow);
  assert.equal(follow.checked, false);
  bar.scrollLeft = 200;
  fireEvent.scroll(bar);
  await waitFor(() => assert.ok(suspended(view)));
  const offScroll = bar.scrollLeft;
  await video.play();
  await waitFor(() => assert.ok(suspended(view) === null));
  assert.equal(follow.checked, false, 'explicit off must survive play');
  assert.equal(bar.scrollLeft, offScroll, 'explicit off must not reveal on play');

  fireEvent.pointerDown(svg, {clientX: 400, clientY: 20, pointerId: 2, button: 0});
  await waitFor(() => assert.ok(Math.abs(video.currentTime - 8) < 1e-6));
  assert.equal(follow.checked, false, 'seeking must not silently enable Follow');
});

test('workspace transport starts playback and clears temporary suspension', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const {bar} = overview(view);
  bar.scrollLeft = 120;
  fireEvent.scroll(bar);
  await waitFor(() => assert.ok(suspended(view)));

  fireEvent.click(view.getByRole('button', {name: 'Play', exact: true}));
  await waitFor(() => assert.ok(suspended(view) === null));
  await waitFor(() => assert.ok(view.getByRole('button', {name: 'Pause', exact: true})
    .getAttribute('aria-label') === 'Pause'));
  assert.equal(video.paused, false);
});

test('video access opens the drawer without remounting the source element', async () => {
  const view = await open();
  const video = view.container.querySelector('video');
  assert.ok(video, 'source media exists for this fixture');
  view.getByRole('button', {name: 'Video', exact: true}).click();
  await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.hasAttribute('hidden'), false));
  assert.equal(view.container.querySelector('video'), video);
  view.container.querySelector<HTMLButtonElement>('[data-settings-drawer] [aria-label="Close settings"]')!.click();
  await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.hasAttribute('hidden'), true));
  view.getByRole('button', {name: 'Video', exact: true}).click();
  await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.hasAttribute('hidden'), false));
  assert.equal(view.container.querySelector('video'), video, 'one media element across presentation changes');
});

test('ordinary scrollbar and wheel never seek', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const {bar} = overview(view);
  setTime(video, 3);
  await waitFor(() => assert.ok(suspended(view) === null));

  bar.scrollLeft = 140;
  fireEvent.scroll(bar);
  await waitFor(() => assert.ok(suspended(view)));
  assert.ok(Math.abs(video.currentTime - 3) < 1e-9, 'scrollbar inspection must not seek');

  const stage = view.container.querySelector('.ws-shared-stage') as HTMLElement;
  fireEvent.wheel(stage, {deltaX: 40, deltaY: 0});
  assert.ok(Math.abs(video.currentTime - 3) < 1e-9, 'wheel inspection must not seek');
});

test('narrow range pan and wide resize preserve edits, selection, media and current time', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth')!;
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const keyboard = view.container.querySelector('.ws-keyboard-svg') ?? view.container.querySelector('.keyboard-svg');
  assert.ok(keyboard);
  const firstBefore = (keyboard as SVGElement).getAttribute('data-first-pitch');
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!, {clientX: 100, clientY: 100, pointerId: 55, button: 0});
  fireEvent.pointerUp(view.container.querySelector('.ws-roll-note')!, {pointerId: 55});
  await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.getAttribute('data-mode'), 'note'));
  fireEvent.click(view.getByRole('button', {name: '+ semitone'}));
  await waitFor(() => assert.ok(view.container.querySelector('[data-workspace-dirty="true"]')));
  view.container.querySelector<HTMLButtonElement>('[data-settings-drawer] [aria-label="Close note editor"]')!.click();
  await waitFor(() => assert.equal(view.container.querySelector('[data-settings-drawer]')?.hasAttribute('hidden'), true));
  const snapshot = () => (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  const before = snapshot();
  const time = video.currentTime;
  const paused = stateFor(video).paused;
  const media = [...view.container.querySelectorAll('video')];

  fireEvent.click(view.getByRole('button', {name: 'Next keyboard range'}));
  await waitFor(() => assert.notEqual(
    (view.container.querySelector('.keyboard-svg') as SVGElement).getAttribute('data-first-pitch'), firstBefore));
  const pannedFirst = Number((view.container.querySelector('.keyboard-svg') as SVGElement).getAttribute('data-first-pitch'));
  assert.equal(Number(view.container.querySelector('.ws-waterfall')?.getAttribute('data-first-pitch')), pannedFirst,
    'keyboard and waterfall share the panned range');
  assert.equal(snapshot().selection.occurrenceId, before.selection.occurrenceId);
  assert.equal(snapshot().past, before.past);
  assert.equal(video.currentTime, time);
  assert.equal(stateFor(video).paused, paused);
  assert.equal(view.container.querySelectorAll('video').length, media.length);
  assert.ok(media[0] === view.container.querySelector('video'));

  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    get() { return 1200; }, configurable: true,
  });
  try {
    fireEvent(window, new window.Event('resize'));
    await waitFor(() => assert.equal(
      (view.container.querySelector('.keyboard-svg') as SVGElement).getAttribute('data-semitones'), '87'));
    assert.equal((view.container.querySelector('.keyboard-svg') as SVGElement).getAttribute('data-first-pitch'), '21');
    assert.equal(view.container.querySelector('.ws-waterfall')?.getAttribute('data-last-pitch'), '108');
    assert.equal(view.container.querySelector('.keyboard-toolbar button'), null);
    assert.equal(snapshot().selection.occurrenceId, before.selection.occurrenceId);
    assert.equal(snapshot().past, before.past);
    assert.ok(media[0] === view.container.querySelector('video'));
  } finally {
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', descriptor);
  }
  fireEvent(window, new window.Event('resize'));
  await waitFor(() => assert.equal(
    Number((view.container.querySelector('.keyboard-svg') as SVGElement).getAttribute('data-first-pitch')), pannedFirst));
});

test('Space plays and pauses once from workspace background and ignores repeats/modifiers', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const press = (init: Record<string, unknown> = {}) =>
    fireEvent.keyDown(document.body, {code: 'Space', key: ' ', ...init});
  assert.equal(stateFor(video).paused, true);
  press();
  await waitFor(() => assert.equal(stateFor(video).paused, false));
  press();
  await waitFor(() => assert.equal(stateFor(video).paused, true));

  press({repeat: true});
  press({ctrlKey: true});
  press({metaKey: true});
  press({altKey: true});
  press({shiftKey: true});
  press({isComposing: true});
  press({keyCode: 229});
  assert.equal(stateFor(video).paused, true, 'repeat/modifier/composing Space must be ignored');

  const prevented = new window.KeyboardEvent('keydown', {code: 'Space', key: ' ', bubbles: true, cancelable: true});
  prevented.preventDefault();
  await act(async () => { document.body.dispatchEvent(prevented); });
  assert.equal(stateFor(video).paused, true, 'already-prevented Space must be ignored');

  const roll = view.container.querySelector('.ws-roll-svg') as SVGElement;
  fireEvent.pointerDown(roll, {clientX: 120, clientY: 100, pointerId: 8});
  fireEvent.pointerUp(roll, {clientX: 120, clientY: 100, pointerId: 8});
  const shortcut = new window.KeyboardEvent('keydown', {code: 'Space', key: ' ', bubbles: true, cancelable: true});
  await act(async () => { document.body.dispatchEvent(shortcut); });
  assert.equal(shortcut.defaultPrevented, true, 'Space must prevent page scroll');
  await waitFor(() => assert.equal(stateFor(video).paused, false));
});

test('Space ignores outside focus/targets and a hidden workspace', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const outsideButton = document.createElement('button');
  outsideButton.textContent = 'Outside';
  const outsideSurface = document.createElement('div');
  outsideSurface.tabIndex = -1;
  document.body.append(outsideButton, outsideSurface);
  try {
    outsideButton.focus();
    fireEvent.keyDown(outsideButton, {code: 'Space', key: ' '});
    assert.equal(stateFor(video).paused, true, 'outside native button keeps Space');
    outsideSurface.focus();
    fireEvent.keyDown(outsideSurface, {code: 'Space', key: ' '});
    assert.equal(stateFor(video).paused, true, 'outside noninteractive target is out of scope');
    fireEvent.keyDown(document.body, {code: 'Space', key: ' '});
    assert.equal(stateFor(video).paused, true, 'outside focused element blocks body-target Space');

    outsideSurface.remove();
    (document.activeElement as HTMLElement | null)?.blur?.();
    const shell = view.container.querySelector('.ws-shell') as HTMLElement;
    shell.hidden = true;
    fireEvent.keyDown(document.body, {code: 'Space', key: ' '});
    assert.equal(stateFor(video).paused, true, 'hidden workspace does not own transport');
    shell.hidden = false;
    fireEvent.keyDown(document.body, {code: 'Space', key: ' '});
    await waitFor(() => assert.equal(stateFor(video).paused, false, 'visible background Space works again'));
  } finally {
    outsideButton.remove();
    outsideSurface.remove();
  }
});

test('Space keeps native meaning for controls, piano keys and modal review', async () => {
  const view = await open();
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const play = view.getByRole('button', {name: 'Play', exact: true});
  assert.equal(play.getAttribute('aria-keyshortcuts'), 'Space');
  assert.match(play.getAttribute('title') ?? '', /Space/);
  play.focus();
  fireEvent.keyDown(play, {code: 'Space', key: ' '});
  assert.equal(stateFor(video).paused, true, 'focused Play must not get a global extra toggle');
  fireEvent.click(play);
  await waitFor(() => assert.equal(stateFor(video).paused, false));
  fireEvent.click(play);
  await waitFor(() => assert.equal(stateFor(video).paused, true));

  const key = view.container.querySelector('.keyboard-white') as SVGRectElement;
  key.focus();
  fireEvent.keyDown(key, {code: 'Space', key: ' '});
  assert.equal(stateFor(video).paused, true, 'piano key Space remains audition/choose');
  const slider = view.container.querySelector('[role="slider"]') as Element;
  slider.focus();
  fireEvent.keyDown(slider, {code: 'Space', key: ' '});
  assert.equal(stateFor(video).paused, true, 'slider Space remains native');
  const offset = view.container.querySelector('[aria-label="Sync offset in seconds"]') as HTMLInputElement;
  offset.focus();
  fireEvent.keyDown(offset, {code: 'Space', key: ' '});
  assert.equal(stateFor(video).paused, true, 'text/number input Space remains typing');

  fireEvent.click(view.container.querySelector('[data-review-save]')!);
  await waitFor(() => assert.ok(view.queryByRole('dialog', {name: 'Review and save'}) !== null));
  fireEvent.keyDown(document.body, {code: 'Space', key: ' '});
  assert.equal(stateFor(video).paused, true, 'modal review blocks background transport');
  fireEvent.keyDown(window, {key: 'Escape'});
  await waitFor(() => assert.ok(view.queryByRole('dialog', {name: 'Review and save'}) === null));

  const before = stateFor(video).paused;
  view.unmount();
  fireEvent.keyDown(document.body, {code: 'Space', key: ' '});
  assert.equal(stateFor(video).paused, before, 'Space listener is removed with the workspace');
});
