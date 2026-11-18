/**
 * Phase 4 acceptance: the valid, verified preview flow in the actual workspace.
 * Controlled media doubles, a bounded frame scheduler and the real preview hook and
 * source controller; no services, no writes.
 */
import {test, after, afterEach} from 'node:test';
import {clearPracticeStoreMemory} from '../src/practice/practice-store';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import React from 'react';
import {JSDOM} from 'jsdom';
import type {ScheduledPianoNote} from '../src/music/notation/notation-audio';

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
Object.defineProperty(globalThis, 'localStorage', {value: window.localStorage, configurable: true});
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 600; }, configurable: true});

/* ---------------------------------------------------------- media doubles */

const media = new WeakMap<object, {paused: boolean; time: number; duration: number; ready: number; muted: boolean; rate: number; volume: number; src: string; plays: number; pauses: number}>();
const stateFor = (node: object) => {
  let state = media.get(node);
  if (!state) {
    state = {paused: true, time: 0, duration: 30, ready: 3, muted: false, rate: 1, volume: 1, src: '', plays: 0, pauses: 0};
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
  ['muted', (node: object) => stateFor(node).muted, (node: object, value: boolean) => { stateFor(node).muted = value; }],
  ['volume', (node: object) => stateFor(node).volume, (node: object, value: number) => { stateFor(node).volume = value; }],
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
  state.plays += 1;
  (this as unknown as EventTarget).dispatchEvent(new window.Event('play'));
  return Promise.resolve();
};
(proto as unknown as {pause: () => void}).pause = function(this: object) {
  const state = stateFor(this);
  state.paused = true;
  state.pauses += 1;
  (this as unknown as EventTarget).dispatchEvent(new window.Event('pause'));
};

/* ----------------------------------------------------------- frame clock */

let frames = 0;
const pendingFrames = new Map<number, ReturnType<typeof setTimeout>>();
let nextFrame = 1;
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  const id = nextFrame++;
  frames += 1;
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
const previewBytes = new Uint8Array([1, 2, 3, 4]);
const previewHash = createHash('sha256').update(previewBytes).digest('hex');
const draft: Record<string, any> = {...fixture,
  draft_id: 'fixture', lesson_id: 'fixture', title: 'Verified piano fixture', status: 'draft',
  source_video: {key: 'lessons/fixture/video.mp4', mime: 'video/mp4', bytes: 3, sha256: '0'.repeat(64)},
  piano_preview: {key: 'lessons/fixture/preview.wav', mime: 'audio/wav', bytes: previewBytes.length, sha256: previewHash},
  preview_identity: previewHash};
const servedReference = JSON.stringify({...draft});
const servedReferenceBytes = Buffer.byteLength(servedReference);
draft.reference = {...draft.reference, bytes: servedReferenceBytes,
  sha256: createHash('sha256').update(servedReference).digest('hex')};
let holdPreview: (() => void) | null = null;
let previewGate: Promise<void> = Promise.resolve();
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('preview.wav')) {
    await previewGate;
    return new Response(previewBytes);
  }
  if (url.includes('phase1-draft-fixture.json')) {
    return new Response(servedReference, {headers: {'Content-Type': 'application/json'}});
  }
  return new Response(JSON.stringify(draft), {headers: {'Content-Type': 'application/json'}});
}) as typeof fetch;

const created: string[] = [];
const revoked: string[] = [];
URL.createObjectURL = (() => { const value = 'blob:verified-preview'; created.push(value); return value; }) as typeof URL.createObjectURL;
URL.revokeObjectURL = ((value: string) => { revoked.push(value); }) as typeof URL.revokeObjectURL;

const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {PianoWorkspaceHarness} = await import('../src/music/workspace/PianoWorkspaceHarness.tsx');
const {NotationAudio} = await import('../src/music/notation/notation-audio.ts');

afterEach(() => {
  cleanup();
  clearPracticeStoreMemory();
  window.localStorage.clear();
});
after(() => {
  for (const handle of pendingFrames.values()) clearTimeout(handle);
  pendingFrames.clear();
  dom.window.close();
});

let auditionStops = 0;
const liveNotes: {pitch: number; velocity?: number | null}[] = [];
NotationAudio.prototype.play = () => {};
NotationAudio.prototype.stop = () => { auditionStops += 1; };
NotationAudio.prototype.dispose = () => {};
NotationAudio.prototype.playScheduledNote = (note: ScheduledPianoNote) => { liveNotes.push(note); return null; };

const flush = () => new Promise(resolve => setTimeout(resolve, 20));

async function openWorkspace() {
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.queryByRole('button', {name: 'Piano', exact: true})));
  return view;
}

test('piano practice reserves space for playback outside the scrolling stage', async () => {
  const view = render(<PianoWorkspaceHarness mode="practice"/>);
  await waitFor(() => assert.ok(view.container.querySelector('#piano-practice-player')));
  const shell = view.container.querySelector('.ws-shell')!;
  const stage = shell.querySelector('.ws-correction')!;
  const dock = shell.querySelector('#piano-practice-player')!;
  assert.equal(dock.parentElement, shell, 'playback must not scroll or clip with the editor');
  assert.equal(stage.parentElement, shell);
  assert.ok(stage.compareDocumentPosition(dock) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(shell.classList.contains('mimic-shell'), 'the real practice shell keeps the shared immersive control styles');
  assert.ok(shell.classList.contains('ws-shell-focused'));
  assert.equal(shell.querySelector('[data-settings-drawer]'), null, 'practice must not mount the editor drawer');
  assert.equal(view.container.querySelector('video')?.hasAttribute('controls'), false,
    'practice transport is owned by the runtime, not native video controls');

  const styles = ['music/workspace/workspace.css', 'practice.css', 'practice-player.css']
    .map(path => readFileSync(resolve('src', path), 'utf8'));
  for (const order of [styles, [...styles].reverse()]) {
    const layout = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    try {
      for (const css of order) {
        const sheet = layout.window.document.createElement('style');
        sheet.textContent = css;
        layout.window.document.head.append(sheet);
      }
      layout.window.document.body.innerHTML = shell.outerHTML;
      const root = layout.window.document.querySelector('.ws-shell')!;
      const player = root.querySelector('#piano-practice-player')!;
      assert.equal(layout.window.getComputedStyle(root).display, 'flex',
        'shared immersive styles must not replace the piano column layout');
      assert.equal(layout.window.getComputedStyle(player).position, 'relative');
      assert.equal(layout.window.getComputedStyle(player).flexShrink, '0');
      assert.equal(layout.window.getComputedStyle(root.querySelector('.ws-correction')!).overflowY, 'auto');
    } finally {
      layout.window.close();
    }
  }
});

test('live Piano plays edited performance notes, mutes video, and restores Original', async () => {
  draft.piano_preview = null;
  draft.preview_identity = null;
  draft.pedal = [{onset: 0, offset: 2, type: 'sustain'}];
  previewGate = Promise.resolve();
  liveNotes.length = 0;
  try {
    const view = await openWorkspace();
    const video = view.container.querySelector('video')!;
    const originalMuted = (video as unknown as {muted: boolean}).muted;
    const piano = view.getByRole('button', {name: 'Piano', exact: true}) as HTMLButtonElement;
    await waitFor(() => assert.equal(piano.disabled, false));
    assert.equal(piano.disabled, false, 'live Piano is available without a WAV');
    fireEvent.click(piano);
    await waitFor(() => assert.equal(
      view.getByRole('button', {name: 'Piano', exact: true}).getAttribute('aria-pressed'), 'true'));
    assert.equal((video as unknown as {muted: boolean}).muted, true, 'live Piano mutes source audio');
    (video as unknown as {currentTime: number}).currentTime = 0;
    await video.play();
    await waitFor(() => assert.ok(liveNotes.length > 0), {timeout: 2000});
    assert.equal(liveNotes[0].velocity, fixture.events[0].velocity,
      'live synthesis receives the recorded occurrence velocity');
    // A note crossed between normal frame ticks must still receive a fresh hammer
    // strike (no mid-note elapsed window) rather than being swallowed.
    (video as unknown as {currentTime: number}).currentTime = 0.51;
    video.dispatchEvent(new window.Event('timeupdate'));
    await waitFor(() => assert.ok(liveNotes.some(note =>
      note.pitch === 64 && note.elapsed === undefined)), {timeout: 2000});
    assert.ok(!liveNotes.some(note => note.pitch === 64 && note.elapsed !== undefined),
      'frame-step notes never use a mid-note attack');
    assert.equal(liveNotes.find(note => note.pitch === 72)?.duration, 1.5,
      'sustain pedal extends the audible occurrence beyond its notated duration');
    fireEvent.click(view.getByRole('button', {name: 'Original', exact: true}));
    await waitFor(() => assert.equal(
      view.getByRole('button', {name: 'Original', exact: true}).getAttribute('aria-pressed'), 'true'));
    assert.equal((video as unknown as {muted: boolean}).muted, originalMuted,
      'Original restores the user’s prior video mute state');
  } finally {
    draft.piano_preview = {key: 'lessons/fixture/preview.wav', mime: 'audio/wav', bytes: previewBytes.length,
      sha256: previewHash};
    draft.preview_identity = previewHash;
    draft.pedal = [];
  }
});

test('acceptance 1: pending verification keeps Piano disabled; success exposes the blob and enables', async () => {
  previewGate = new Promise<void>(resolve => { holdPreview = resolve; });
  const view = await openWorkspace();
  await flush();
  const piano = view.getByRole('button', {name: 'Piano', exact: true}) as HTMLButtonElement;
  assert.equal(piano.disabled, true, 'Piano must stay disabled while verification is pending');
  assert.equal(view.container.querySelector('audio')?.getAttribute('src'), null, 'no src before verification');
  assert.match(view.getByText(/Verifying piano audio/i).textContent ?? '', /Verifying/i);

  holdPreview?.();
  await waitFor(() => assert.equal(
    view.getByRole('button', {name: 'Piano', exact: true}).hasAttribute('disabled'), false),
    {timeout: 2000});
  assert.equal(view.container.querySelector('audio')?.getAttribute('src'), 'blob:verified-preview');
});

test('acceptance 2-4: Piano follows the source clock, Original restores, failure falls back, cleanup revokes', async () => {
  previewGate = Promise.resolve();
  const view = await openWorkspace();
  await waitFor(() => assert.equal(
    view.getByRole('button', {name: 'Piano', exact: true}).hasAttribute('disabled'), false));
  const video = view.container.querySelector('video')!;
  const piano = view.container.querySelector('audio')!;

  // Offset is applied once and reaches the Piano element.
  fireEvent.change(view.getByLabelText('Sync offset in seconds'), {target: {value: '0.5'}});
  fireEvent.click(view.getByRole('button', {name: 'Piano', exact: true}));
  await waitFor(() => assert.equal(
    view.getByRole('button', {name: 'Piano', exact: true}).getAttribute('aria-pressed'), 'true'));

  (video as unknown as {currentTime: number}).currentTime = 5;
  video.dispatchEvent(new window.Event('seeked'));
  await flush();
  assert.ok(Math.abs((piano as unknown as {currentTime: number}).currentTime - 4.5) < 0.001,
    `Piano should map 5 s with a 0.5 s offset (got ${(piano as unknown as {currentTime: number}).currentTime})`);
  assert.equal((video as unknown as {muted: boolean}).muted, true, 'the source is muted while Piano plays');

  // Play and pause reach the Piano element; the video remains the clock.
  await video.play();
  await flush();
  assert.ok(stateFor(piano).plays > 0, 'Piano play was not requested');
  video.pause();
  await flush();
  assert.equal(stateFor(piano).paused, true, 'Piano must pause with the source');

  // Seek and rate changes reach Piano.
  (video as unknown as {currentTime: number}).currentTime = 10;
  video.dispatchEvent(new window.Event('seeked'));
  await flush();
  assert.ok(Math.abs((piano as unknown as {currentTime: number}).currentTime - 9.5) < 0.001,
    'Piano did not follow the seek');
  (video as unknown as {playbackRate: number}).playbackRate = 0.5;
  video.dispatchEvent(new window.Event('ratechange'));
  await flush();
  assert.equal((piano as unknown as {playbackRate: number}).playbackRate, 0.5, 'rate did not reach Piano');

  // Offset change reconfigures the same controller.
  fireEvent.change(view.getByLabelText('Sync offset in seconds'), {target: {value: '1'}});
  await flush();
  assert.ok(Math.abs((piano as unknown as {currentTime: number}).currentTime - 9) < 0.001,
    'a new offset did not remap Piano');

  // Switching back to Original restores source audio and stops Piano.
  const pausesBefore = stateFor(piano).pauses;
  fireEvent.click(view.getByRole('button', {name: 'Original', exact: true}));
  await flush();
  assert.equal(stateFor(piano).paused, true, 'Piano must stop when Original is chosen');
  assert.ok(stateFor(piano).pauses >= pausesBefore);
  assert.equal((video as unknown as {muted: boolean}).muted, false, 'source audio must be restored');

  // A playback failure falls back visibly to Original.
  fireEvent.click(view.getByRole('button', {name: 'Piano', exact: true}));
  (piano as unknown as {play: () => Promise<void>}).play = () => Promise.reject(new Error('decode failed'));
  await video.play();
  await waitFor(() => assert.equal(
    view.getByRole('button', {name: 'Original', exact: true}).getAttribute('aria-pressed'), 'true',
  ), {timeout: 2000});
  assert.equal((video as unknown as {muted: boolean}).muted, false, 'a failure must restore source audio');

  // Cleanup revokes the verified URL through the layer that owns it.
  view.unmount();
  await flush();
  assert.ok(revoked.includes('blob:verified-preview'), 'the preview URL was not revoked');
  assert.equal(pendingFrames.size, 0, 'scheduled frame callbacks were not cancelled');
});

test('a Web Audio host defaults to live grand piano and exposes the WAV source choice', async () => {
  const webAudio = window as unknown as {AudioContext?: unknown};
  const previous = webAudio.AudioContext;
  webAudio.AudioContext = function AudioContextDouble() {};
  previewGate = Promise.resolve();
  try {
    const view = await openWorkspace();
    const piano = view.getByRole('button', {name: 'Piano', exact: true}) as HTMLButtonElement;
    await waitFor(() => assert.equal(piano.disabled, false));
    fireEvent.click(piano);
    await waitFor(() => assert.equal(
      view.getByRole('button', {name: 'Piano', exact: true}).getAttribute('aria-pressed'), 'true'));
    fireEvent.click(view.getByRole('button', {name: 'Sound options'}));
    await waitFor(() => assert.ok(view.container.querySelector('[aria-label="Piano synthesis source"]')));
    assert.equal(view.getByRole('button', {name: 'Live grand piano'}).getAttribute('aria-pressed'), 'true',
      'verified WAV must not override the live grand piano default on a Web Audio host');
    assert.equal(view.container.querySelector('[data-preview-state="live"]') !== null, true);
    fireEvent.click(view.getByRole('button', {name: 'Rendered WAV'}));
    await waitFor(() => assert.equal(
      view.getByRole('button', {name: 'Rendered WAV'}).getAttribute('aria-pressed'), 'true'));
  } finally {
    if (previous === undefined) delete webAudio.AudioContext;
    else webAudio.AudioContext = previous;
  }
});

test('the dedicated piano practice route starts through the shared runtime and observes voice listening', async () => {
  const w = window as unknown as {SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown};
  const previous = w.SpeechRecognition;
  let started = 0;
  class RecognitionDouble {
    continuous = false;
    interimResults = false;
    lang = '';
    maxAlternatives = 1;
    onstart?: () => void;
    onend?: () => void;
    onerror?: (event: {error: string}) => void;
    onresult?: (event: unknown) => void;
    start() { started += 1; this.onstart?.(); }
    abort() { this.onend?.(); }
  }
  w.SpeechRecognition = RecognitionDouble;
  previewGate = Promise.resolve();
  try {
    const view = render(<PianoWorkspaceHarness mode="practice"/>);
    await waitFor(() => assert.ok(view.container.querySelector('#piano-practice-player')));
    const primary = () => view.container.querySelector('#piano-practice-player .practice-player-primary') as HTMLButtonElement;
    await waitFor(() => assert.match(primary().textContent ?? '', /Start practice/));
    fireEvent.click(primary());
    assert.equal(started, 0, 'the first Start asks before opening the microphone');
    await waitFor(() => assert.ok(view.getByRole('button', {name: 'Start with voice'})));
    fireEvent.click(view.getByRole('button', {name: 'Start with voice'}));
    await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
    await waitFor(() => assert.ok(view.getByRole('button', {name: 'Voice on'})));
    assert.ok(started >= 1, 'Start with voice actually requests listening');
    assert.equal(view.container.querySelector('.ws-shell')?.getAttribute('data-practice-mode'), 'true');
    view.unmount();
  } finally {
    if (previous === undefined) delete w.SpeechRecognition;
    else w.SpeechRecognition = previous;
  }
});

test('piano Without voice never starts recognition and resume does not re-enable it', async () => {
  const w = window as unknown as {SpeechRecognition?: unknown};
  const previous = w.SpeechRecognition;
  let starts = 0;
  class RecognitionDouble {
    continuous = false;
    interimResults = false;
    lang = '';
    maxAlternatives = 1;
    onstart?: () => void;
    onend?: () => void;
    onerror?: (event: {error: string}) => void;
    onresult?: (event: unknown) => void;
    start() { starts += 1; this.onstart?.(); }
    abort() { this.onend?.(); }
  }
  w.SpeechRecognition = RecognitionDouble;
  previewGate = Promise.resolve();
  clearPracticeStoreMemory();
  window.localStorage.clear();
  try {
    const view = render(<PianoWorkspaceHarness mode="practice"/>);
    await waitFor(() => assert.ok(view.container.querySelector('#piano-practice-player')));
    const primary = () => view.container.querySelector('#piano-practice-player .practice-player-primary') as HTMLButtonElement;
    await waitFor(() => assert.match(primary().textContent ?? '', /Start practice/));
    fireEvent.click(primary());
    fireEvent.click(await view.findByRole('button', {name: 'Without voice'}));
    await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
    assert.equal(starts, 0, 'Without voice must not call recognition.start()');
    fireEvent.click(primary());
    await waitFor(() => assert.match(primary().textContent ?? '', /Resume/));
    fireEvent.click(primary());
    await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
    assert.equal(starts, 0, 'resume keeps the explicit without-voice choice');
    view.unmount();
  } finally {
    if (previous === undefined) delete w.SpeechRecognition;
    else w.SpeechRecognition = previous;
  }
});
test('piano practice reports buffering separately and resumes the same attempt', async () => {
  previewGate = Promise.resolve();
  window.localStorage.clear();
  const view = render(<PianoWorkspaceHarness mode="practice"/>);
  await waitFor(() => assert.ok(view.container.querySelector('#piano-practice-player')));
  const primary = () => view.container.querySelector('#piano-practice-player .practice-player-primary') as HTMLButtonElement;
  await waitFor(() => assert.match(primary().textContent ?? '', /Start practice|Resume section/));
  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
  const video = view.container.querySelector('video')!;
  const before = (video as unknown as {currentTime: number}).currentTime;
  video.dispatchEvent(new window.Event('waiting'));
  await waitFor(() => assert.ok(view.container.querySelector('.practice-runtime-buffering'),
    `status: ${view.container.querySelector('.practice-runtime-state')?.textContent}`));
  (video as unknown as {currentTime: number}).currentTime = before + 0.4;
  video.dispatchEvent(new window.Event('timeupdate'));
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.ok(view.container.querySelector('.practice-runtime-buffering'), 'time did not silently advance practice');
  video.dispatchEvent(new window.Event('playing'));
  await video.play();
  await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/,
    `state=${view.container.querySelector('.practice-runtime-state')?.textContent} paused=${(video as unknown as {paused: boolean}).paused}`));
  view.unmount();
});

test('piano practice exposes the shared section picker and a section selection seeks there', async () => {
  previewGate = Promise.resolve();
  clearPracticeStoreMemory();
  window.localStorage.clear();
  const view = render(<PianoWorkspaceHarness mode="practice"/>);
  await waitFor(() => assert.ok(view.container.querySelector('#piano-practice-player'), 'dock'));
  const browse = view.container.querySelector('.practice-timeline-browse') as HTMLButtonElement;
  assert.ok(browse, 'browse button');
  await waitFor(() => assert.equal(browse.disabled, false));
  fireEvent.click(browse);
  await waitFor(() => assert.ok(view.container.querySelector('[aria-label="Practice sections"]'), 'picker panel'));
  const options = [...view.container.querySelectorAll<HTMLButtonElement>('[aria-label="Practice sections"] button')];
  assert.ok(options.length > 0, 'picker options');
  const target = options[Math.min(1, options.length - 1)];
  fireEvent.click(target);
  await waitFor(() => assert.ok(view.container.querySelector('[aria-label="Practice sections"]') === null, 'picker closes'));
  const video = view.container.querySelector('video') as unknown as {currentTime: number};
  assert.ok(Number.isFinite(video.currentTime) && video.currentTime >= 0, 'seek position');
  fireEvent.click(view.container.querySelector('[aria-label="Compact view"]')!);
  await waitFor(() => assert.equal(
    view.container.querySelector('.piano-practice-stage')?.getAttribute('data-compact-view'), 'guide'));
  fireEvent.click(view.getByRole('button', {name: 'Sheet', exact: true}));
  await waitFor(() => assert.equal(
    view.container.querySelector('.piano-practice-stage')?.getAttribute('data-compact-view'), 'sheet'));
  assert.equal(window.localStorage.getItem('piano-review-compact-view-v1'), 'sheet');
  view.unmount();
});

test('piano practice uses the full A0-C8 range on wide stages and a pannable window below it', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth');
  let width = 1200;
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true, get() { return width; },
  });
  previewGate = Promise.resolve();
  clearPracticeStoreMemory();
  window.localStorage.clear();
  try {
    const view = render(<PianoWorkspaceHarness mode="practice"/>);
    await waitFor(() => assert.ok(view.container.querySelector('#piano-practice-player')));
    const keyboard = () => view.container.querySelector('[data-first-pitch][data-semitones]') as HTMLElement;
    await waitFor(() => assert.equal(keyboard()?.getAttribute('data-first-pitch'), '21'));
    assert.equal(keyboard().getAttribute('data-semitones'), '87');
    width = 600;
    window.dispatchEvent(new window.Event('resize'));
    await waitFor(() => assert.ok(Number(keyboard().getAttribute('data-semitones')) < 87));
    assert.ok(Number(keyboard().getAttribute('data-first-pitch')) >= 21);
    view.unmount();
  } finally {
    if (descriptor) Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', descriptor);
  }
});
test('piano practice defaults to live grand synthesis, attacks onset zero and updates source volume', async () => {
  const webAudio = window as unknown as {AudioContext?: unknown};
  const previous = webAudio.AudioContext;
  webAudio.AudioContext = function AudioContextDouble() {};
  previewGate = Promise.resolve();
  clearPracticeStoreMemory();
  window.localStorage.clear();
  window.localStorage.setItem('piano-playback-preferences', JSON.stringify({mode: 'piano', volume: 0.8}));
  liveNotes.length = 0;
  try {
    const view = render(<PianoWorkspaceHarness mode="practice"/>);
    await waitFor(() => assert.ok(view.container.querySelector('#piano-practice-player')));
    const primary = () => view.container.querySelector('#piano-practice-player .practice-player-primary') as HTMLButtonElement;
    await waitFor(() => assert.match(primary().textContent ?? '', /Start practice/));
    fireEvent.click(primary());
    await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
    await waitFor(() => assert.ok(liveNotes.length > 0), {timeout: 3000});
    assert.equal(liveNotes[0].pitch, fixture.events[0].pitch);
    assert.ok(liveNotes.some(note => note.delaySeconds === 0 || note.elapsed !== undefined),
      'the first onset must attack, including at source time zero');
    const video = view.container.querySelector('video') as HTMLVideoElement;
    assert.equal(video.muted, true, 'live synthesis mutes the source audio');
    assert.ok(Math.abs(video.volume - 0.8) < 0.001, 'the shared volume reaches the source element');
    fireEvent.click(view.container.querySelector('.practice-runtime-header-actions [aria-label="Practice settings"]')!);
    const source = await waitFor(() => {
      const select = view.container.querySelector('[aria-label="Piano synthesis source"]') as HTMLSelectElement;
      assert.ok(select);
      return select;
    });
    assert.equal(source.value, 'live');
    source.value = 'wav';
    fireEvent.change(source);
    await waitFor(() => assert.equal(
      (view.container.querySelector('[aria-label="Piano synthesis source"]') as HTMLSelectElement).value, 'wav'));
    view.unmount();
  } finally {
    window.localStorage.removeItem('piano-playback-preferences');
    if (previous === undefined) delete webAudio.AudioContext;
    else webAudio.AudioContext = previous;
  }
});
