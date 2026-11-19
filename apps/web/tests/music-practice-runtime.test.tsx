import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import type {MusicLessonManifest} from '../../../packages/lesson-schema/index';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/music-practice.html', pretendToBeVisual: true,
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
Object.defineProperty(globalThis, 'localStorage', {value: window.localStorage, configurable: true});
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 4)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}
const mediaState = new WeakMap<object, {paused: boolean; time: number}>();
const stateFor = (node: object) => {
  let state = mediaState.get(node);
  if (!state) { state = {paused: true, time: 0}; mediaState.set(node, state); }
  return state;
};
let videoPauseCalls = 0;
let playCalls = 0;
Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
  configurable: true, get(this: object) { return stateFor(this).paused; },
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
  configurable: true,
  get(this: object) { return stateFor(this).time; },
  set(this: object, value: number) { stateFor(this).time = value; },
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', {
  configurable: true, get() { return 3; },
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
  configurable: true, get() { return 4; },
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'ended', {
  configurable: true, get() { return false; },
});
(window.HTMLMediaElement.prototype as unknown as {play: () => Promise<void>}).play = function () {
  stateFor(this).paused = false;
  playCalls += 1;
  this.dispatchEvent(new window.Event('play'));
  return Promise.resolve();
};
(window.HTMLMediaElement.prototype as unknown as {pause: () => void}).pause = function () {
  stateFor(this).paused = true;
  if ((this as unknown as HTMLElement).tagName === 'VIDEO') videoPauseCalls += 1;
  this.dispatchEvent(new window.Event('pause'));
};

const reference = {
  reference_version: 1, subject: 'guitar', instrument: {instrument: 'guitar'}, duration: 4,
  spans: [{start: 0, end: 4, kind: 'playing'}],
  events: [{id: 'n1', onset: 0, duration: 1, pitch: 64, velocity: 0.5, confidence: 1, optional: false, string: 1, fret: 0}],
  guitar_chords: [],
  review: {reviewer_id: 'fixture', reviewed_at: '2026-01-01T00:00:00Z', draft_id: 'draft',
    source_reference_sha256: '0'.repeat(64)},
};
const bytes = new TextEncoder().encode(JSON.stringify(reference));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const lesson: MusicLessonManifest = {
  schema_version: 2, experience_family: 'music', lesson_id: 'guitar-fixture', revision_id: 'rev-1',
  title: 'Shared guitar practice', subject: 'guitar', duration: 4, instrument: {instrument: 'guitar'},
  section_set: {id: 'sections', revision: 1, duration: 4, sections: [
    {id: 'verse', label: 'Verse', start: 0, end: 2},
    {id: 'chorus', label: 'Chorus', start: 2, end: 4},
  ]},
  reference: {key: 'lessons/guitar-fixture/reference.json', mime: 'application/json', bytes: bytes.length, sha256},
  reference_reviewed: true,
  assessment: {rubric_version: 'guitar-notes-v1', assessment: 'notes', input_modes: ['midi', 'microphone'], dimensions: ['pitch', 'timing']},
  source_video: {key: 'lessons/guitar-fixture/video.mp4', mime: 'video/mp4', bytes: 1, sha256: '1'.repeat(64)},
  warnings: [],
};
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('reference.json')) return new Response(bytes, {headers: {'Content-Type': 'application/json'}});
  return new Response('not found', {status: 404});
}) as typeof fetch;

const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {MusicLessonHome} = await import('../src/music/MusicLessonHome.tsx');
after(() => { cleanup(); dom.window.close(); });

test('guitar practice mounts the shared shell, plan and action model', async () => {
  const view = render(<MusicLessonHome lesson={lesson} onBack={() => {}}/>);
  await waitFor(() => assert.ok(view.container.querySelector('.practice-runtime-shell')));
  await waitFor(() => assert.ok(view.container.querySelector('#practice-runtime-player')));
  assert.equal(view.getByText('Shared guitar practice') !== null, true);
  assert.equal(view.container.querySelector('video')?.hasAttribute('controls'), false,
    'practice transport is owned by the runtime, not native video controls');
  const primary = () => view.container.querySelector('.practice-player-primary') as HTMLButtonElement;
  await waitFor(() => assert.match(primary().textContent ?? '', /Start practice/));
  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Cancel count-in/),
    'the guitar plan converts its 4-beat count-in to scheduler seconds');
  const status = view.container.querySelector('.practice-runtime-state')?.textContent ?? '';
  assert.match(status, /Get ready/);
  view.unmount();
});

test('guitar practice pauses and checkpoints when the page is backgrounded', async () => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const view = render(<MusicLessonHome lesson={lesson} onBack={() => {}}/>);
  await waitFor(() => assert.ok(view.container.querySelector('.practice-runtime-shell')));
  const primary = () => view.container.querySelector('.practice-player-primary') as HTMLButtonElement;
  const video = () => view.container.querySelector('video') as HTMLVideoElement;
  await waitFor(() => assert.match(primary().textContent ?? '', /Start practice/));
  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Cancel count-in/));
  await wait(2300);
  await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
  Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
  document.dispatchEvent(new window.Event('visibilitychange'));
  await waitFor(() => assert.match(primary().textContent ?? '', /Resume section|Resume practice/));
  assert.equal(video().paused, true, 'backgrounding pauses the authoritative media transport');
  Object.defineProperty(document, 'hidden', {configurable: true, get: () => false});
  view.unmount();
});
test('guitar playback survives renders, resumes in place, navigates, repeats and restarts the lesson', async () => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const view = render(<MusicLessonHome lesson={lesson} onBack={() => {}}/>);
  await waitFor(() => assert.ok(view.container.querySelector('.practice-runtime-shell')));
  const primary = () => view.container.querySelector('.practice-player-primary') as HTMLButtonElement;
  const video = () => view.container.querySelector('video') as HTMLVideoElement;
  await waitFor(() => assert.match(primary().textContent ?? '', /Start practice/));
  videoPauseCalls = 0;
  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Cancel count-in/));
  await wait(2300);
  await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
  assert.equal(video().paused, false, `playCalls=${playCalls} videoPauseCalls=${videoPauseCalls}`);
  assert.equal(videoPauseCalls, 0, 'count-in completion and snapshot renders must not pause playback');

  const advance = async (time) => {
    video().currentTime = time;
    video().dispatchEvent(new window.Event('timeupdate'));
    await wait(80);
  };
  await advance(0.5);
  await advance(0.8);
  assert.equal(videoPauseCalls, 0, 'repeated snapshot renders must not pause playback');
  assert.match(primary().textContent ?? '', /Pause practice/);

  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Resume section|Resume practice/));
  const pausedAt = video().currentTime;
  await wait(300);
  assert.equal(video().paused, true);
  assert.equal(video().currentTime, pausedAt, 'pause holds the source position');

  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
  assert.ok(Math.abs(video().currentTime - pausedAt) < 0.05, 'resume continues from the paused position');

  fireEvent.click(view.container.querySelector('.practice-runtime-header-actions [aria-label="Practice settings"]')!);
  const speedChoice = [...document.querySelectorAll<HTMLButtonElement>('.settings-choices button')]
    .find(button => button.textContent?.trim() === '1.25×');
  assert.ok(speedChoice, 'the shared settings panel exposes the declared 1.25× capability');
  fireEvent.click(speedChoice!);
  await waitFor(() => assert.equal(JSON.parse(window.localStorage.getItem('form-practice-v2:preferences:guitar-fixture:rev-1') ?? '{}').speed, 1.25));

  fireEvent.keyDown(document.body, {key: 'ArrowRight'});
  await waitFor(() => assert.ok(Math.abs(video().currentTime - 2) < 0.05),
    'ArrowRight advances to the next section through the shared dispatcher');
  await advance(2.4);
  fireEvent.keyDown(document.body, {key: 'r'});
  await waitFor(() => assert.ok(Math.abs(video().currentTime - 2) < 0.05),
    'R repeats the current section from its start');

  await advance(4);
  await waitFor(() => assert.match(primary().textContent ?? '', /Practise again/));
  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
  assert.ok(video().currentTime < 0.1, 'Practise again restarts the lesson at zero');
  view.unmount();
});
