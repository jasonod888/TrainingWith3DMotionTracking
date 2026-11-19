import {test, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/mediapipe.html', pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, location: dom.window.location,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
});
const matchMediaStub = () => ({matches: false, media: '',
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
dom.window.matchMedia = matchMediaStub;
(globalThis as unknown as {matchMedia: typeof matchMediaStub}).matchMedia = matchMediaStub;
Object.defineProperty(dom.window.document, 'visibilityState', {value: 'visible', configurable: true});
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
};
dom.window.HTMLMediaElement.prototype.play = async function () {};
dom.window.HTMLMediaElement.prototype.pause = function () {};
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 16)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
(globalThis as unknown as {innerWidth: number}).innerWidth = 1280;
(globalThis as unknown as {innerHeight: number}).innerHeight = 800;
(globalThis as unknown as {screen: Screen}).screen = dom.window.screen;
(globalThis as unknown as {addEventListener: typeof window.addEventListener}).addEventListener =
  dom.window.addEventListener.bind(dom.window);
(globalThis as unknown as {removeEventListener: typeof window.removeEventListener}).removeEventListener =
  dom.window.removeEventListener.bind(dom.window);

const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {LessonWorkspace} = await import('../src/LessonWorkspace.tsx');
const {sliceReference} = await import('../src/reference-window.ts');
const {buildLessonContext} = await import('../src/app/lesson-context.ts');
import type {LessonManifest, Section} from '../../../packages/lesson-schema/index';

const fixture = JSON.parse(readFileSync(new URL('../../../packages/lesson-schema/fixture.json',
  import.meta.url), 'utf8')) as LessonManifest;
const asset = (key: string, mime: string) => ({key, mime, bytes: 4, sha256: '0'.repeat(64)});
const focused = asset('lessons/mp/instructor.mp4', 'video/mp4');
const source = asset('lessons/mp/preview.mp4', 'video/mp4');
const videoOnly = {
  ...fixture, animation: null, engine: 'mediapipe' as const,
  engine_version: 'mediapipe-pose-heavy-v1', source_video: source,
  focused_video: focused, frame_rate: 29.97, root_motion: 'hip-relative' as const,
} as LessonManifest;

after(() => { cleanup(); dom.window.close(); });
afterEach(() => { cleanup(); });

test('video-only MediaPipe hides 3D switches and falls back focused → source', async () => {
  const view = render(<LessonWorkspace lesson={videoOnly} sections={videoOnly.section_set.sections}
    review persistent={false} onBack={() => {}} onEdit={() => {}} onSave={() => {}}
    notice="" editable={false}/>);
  assert.equal(view.queryByLabelText('Reference display'), null);
  await waitFor(() => assert.match(
    view.container.querySelector('video')?.getAttribute('src') ?? '', /instructor\.mp4/));
  view.unmount();

  const fallback = render(<LessonWorkspace
    lesson={{...videoOnly, focused_video: null}} sections={videoOnly.section_set.sections}
    review persistent={false} onBack={() => {}} onEdit={() => {}} onSave={() => {}}
    notice="" editable={false}/>);
  await waitFor(() => assert.match(
    fallback.container.querySelector('video')?.getAttribute('src') ?? '', /preview\.mp4/));
});

test('per-frame confidence survives slicing with times, keypoints and calibration state', () => {
  const reference = {
    duration: 0.3, times: [0, .1, .2],
    keypoints: [[[1, 2]], [[3, 4]], [[5, 6]]],
    visibility: [[.11], [.61], [.99]],
    landmarkFormat: 'mediapipe-33' as const, standingCalibrationAvailable: false,
  };
  const sliced = sliceReference(reference, [1, 2], {duration: .2});
  assert.deepEqual(sliced.times, [.1, .2]);
  assert.deepEqual(sliced.keypoints, [[[3, 4]], [[5, 6]]]);
  assert.deepEqual(sliced.visibility, [[.61], [.99]]);
  assert.equal(sliced.landmarkFormat, 'mediapipe-33');
  assert.equal(sliced.standingCalibrationAvailable, false);
});

test('mounted video-only practice stops and releases on visibility 403', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({detail: 'gone'}), {status: 403,
      headers: {'Content-Type': 'application/json'}});
  }) as typeof fetch;
  const context = buildLessonContext({document: {kind: 'body', value: videoOnly},
    audience: 'owner', accountScope: 'acct-1'});
  try {
    const view = render(<LessonWorkspace lesson={videoOnly}
      sections={videoOnly.section_set.sections} review={false} persistent={false}
      onBack={() => {}} onEdit={() => {}} onSave={() => {}} notice="" editable={false}
      context={context}/>);
    await waitFor(() => assert.ok(view.container.querySelector('[data-ui-surface="practice"]')));
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await waitFor(() => assert.ok(view.container.querySelector('[data-access-lost]')));
    assert.ok(calls > 0);
    view.unmount();
    const before = calls;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, before, 'unmount stops revalidation polling');
  } finally {
    globalThis.fetch = original;
  }
});
