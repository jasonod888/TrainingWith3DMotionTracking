import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import type {MusicLessonManifest} from '../../../packages/lesson-schema/index';
import {parseLessonDocument} from '../../../packages/lesson-schema/parse';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/guitar-practice.html', pretendToBeVisual: true,
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
Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
  configurable: true, get(this: object) { return stateFor(this).paused; },
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
  configurable: true,
  get(this: object) { return stateFor(this).time; },
  set(this: object, value: number) { stateFor(this).time = value; },
});
Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', {configurable: true, get() { return 3; }});
Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {configurable: true, get() { return 4; }});
Object.defineProperty(window.HTMLMediaElement.prototype, 'ended', {configurable: true, get() { return false; }});
(window.HTMLMediaElement.prototype as unknown as {play: () => Promise<void>}).play = function () {
  stateFor(this).paused = false;
  this.dispatchEvent(new window.Event('play'));
  return Promise.resolve();
};
(window.HTMLMediaElement.prototype as unknown as {pause: () => void}).pause = function () {
  stateFor(this).paused = true;
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
const referenceBytes = new TextEncoder().encode(JSON.stringify(reference));
const sha256 = createHash('sha256').update(referenceBytes).digest('hex');
const lesson: MusicLessonManifest = {
  schema_version: 2, experience_family: 'music', lesson_id: 'guitar-fixture', revision_id: 'rev-1',
  title: 'Guitar practice from context', subject: 'guitar', duration: 4, instrument: {instrument: 'guitar'},
  section_set: {id: 'sections', revision: 1, duration: 4, sections: [
    {id: 'verse', label: 'Verse', start: 0, end: 2},
    {id: 'chorus', label: 'Chorus', start: 2, end: 4},
  ]},
  reference: {key: 'lessons/guitar-fixture/reference.json', mime: 'application/json',
    bytes: referenceBytes.length, sha256},
  reference_reviewed: true,
  assessment: {rubric_version: 'guitar-notes-v1', assessment: 'notes', input_modes: ['midi', 'microphone'], dimensions: ['pitch', 'timing']},
  source_video: {key: 'lessons/guitar-fixture/video.mp4', mime: 'video/mp4', bytes: 1, sha256: '1'.repeat(64)},
  warnings: [],
};

const parsed = parseLessonDocument(lesson);
assert.ok(parsed.ok, parsed.ok ? '' : parsed.message);

const requests: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  requests.push(url);
  if (url.includes('reference.json')) {
    return new Response(referenceBytes, {headers: {'Content-Type': 'application/json'}});
  }
  return new Response('not found', {status: 404});
}) as typeof fetch;

const {render, cleanup, waitFor} = await import('@testing-library/react');
const {buildLessonContext, clearLessonContextCache} = await import('../src/app/lesson-context.ts');
const {MusicPracticeEntry} = await import('../src/acts/music/PracticeEntry.tsx');
after(() => { cleanup(); dom.window.close(); clearLessonContextCache(); });

test('guitar practice mounts from a passed LessonContext without refetching the manifest', async () => {
  clearLessonContextCache();
  requests.length = 0;
  const context = buildLessonContext({
    document: parsed.value, audience: 'owner', accountScope: 'acct-1', challengeEnabled: true,
  });
  assert.equal(context.actId, 'guitar');

  const view = render(<MusicPracticeEntry context={context} lessonId={lesson.lesson_id}
                                          lessonTitle={lesson.title}/>);
  await waitFor(() => assert.ok(view.container.querySelector('.practice-runtime-shell')));
  await waitFor(() => assert.ok(view.getByText('Guitar practice from context')));
  // The only request is the immutable reference; the manifest was passed in.
  const manifestRequests = requests.filter(url => /\/api\/lessons\/guitar-fixture$/.test(url));
  assert.deepEqual(manifestRequests, []);
  assert.ok(requests.some(url => url.includes('/assets/reference.json')));
});
