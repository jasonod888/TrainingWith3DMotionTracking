/**
 * Phase 4 follow-up: actual-harness audio integration (no services, no writes).
 * F1 — Piano is enabled only after the preview bytes are verified.
 * F2 — source playback stops audition with or without a Piano preview.
 */
import {test, afterEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import React from 'react';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
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
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number,
  cancelAnimationFrame: () => {},
});
Object.defineProperty(globalThis, 'navigator', {value: window.navigator, configurable: true});
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 600; }, configurable: true});

// jsdom dispatches volumechange from its own muted setter; keep it inert so the
// source player cannot recurse through the virtual console.
Object.defineProperty(window.HTMLMediaElement.prototype, 'muted', {get() { return true; }, set() {}, configurable: true});
Object.defineProperty(window.HTMLMediaElement.prototype, 'volume', {get() { return 1; }, set() {}, configurable: true});

const paused = new WeakMap<object, boolean>();
const proto = window.HTMLMediaElement.prototype as unknown as Record<string, unknown>;
Object.defineProperty(proto, 'paused', {get(this: object) { return paused.get(this) ?? true; }, configurable: true});
(proto as {pause: () => void}).pause = function(this: object) {
  paused.set(this, true);
  (this as unknown as EventTarget).dispatchEvent(new window.Event('pause'));
};
(proto as {play: () => Promise<void>}).play = function(this: object) {
  paused.set(this, false);
  (this as unknown as EventTarget).dispatchEvent(new window.Event('play'));
  return Promise.resolve();
};

const fixture = JSON.parse(readFileSync(
  resolve('..', '..', 'docs', 'qualification', 'piano-workspace-phase-01', 'fixtures', 'phase1-draft-fixture.json'), 'utf8'));
Object.assign(fixture, {
  draft_id: 'fixture', lesson_id: 'fixture', title: 'Reviewer audio fixture', status: 'draft',
  source_video: {key: 'lessons/fixture/video.mp4', mime: 'video/mp4', bytes: 3, sha256: '0'.repeat(64)},
});

const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {NotationAudio} = await import('../src/music/notation/notation-audio.ts');
const {PianoWorkspaceHarness} = await import('../src/music/workspace/PianoWorkspaceHarness.tsx');

let stops = 0;
NotationAudio.prototype.play = () => {};
NotationAudio.prototype.stop = () => { stops += 1; };
NotationAudio.prototype.dispose = () => {};

afterEach(() => cleanup());

// The probe renders real media elements; jsdom keeps handles open, so exit explicitly.
after(() => { cleanup(); setTimeout(() => process.exit(process.exitCode ?? 0), 50); });

function jsonResponse() {
  return new Response(JSON.stringify(fixture), {headers: {'Content-Type': 'application/json'}});
}

test('F2: Original-only playback stops audition without a Piano preview', async () => {
  globalThis.fetch = (async () => jsonResponse()) as typeof fetch;
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.queryByRole('button', {name: 'Piano', exact: true})));
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!);
  fireEvent.click(view.getByRole('button', {name: 'Audition', exact: true}));
  const before = stops;
  await view.container.querySelector('video')!.play();
  await waitFor(() => assert.ok(stops > before, `stop calls stayed at ${stops}`));
});

test('F1: a preview with mismatched bytes stays disabled and never loads audio', async () => {
  const mismatch = {...fixture,
    piano_preview: {key: 'lessons/fixture/preview.wav', mime: 'audio/wav', bytes: 3, sha256: '0'.repeat(64)},
    preview_identity: '1'.repeat(64)};
  let previewFetches = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('preview.wav')) { previewFetches += 1; return new Response(new Uint8Array([1, 2, 3])); }
    return new Response(JSON.stringify(mismatch), {headers: {'Content-Type': 'application/json'}});
  }) as typeof fetch;
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.queryByRole('button', {name: 'Piano', exact: true})));
  await waitFor(() => assert.ok(previewFetches > 0, 'the preview bytes were never fetched'));
  const piano = view.getByRole('button', {name: 'Piano', exact: true}) as HTMLButtonElement;
  assert.equal(piano.disabled, true, 'Piano must stay disabled for an unverified asset');
  assert.equal(view.container.querySelector('audio')?.getAttribute('src'), null, 'no audio src may be exposed');
  assert.match(view.getByText(/Piano unavailable/i).textContent ?? '', /match|unavailable/i);
});
