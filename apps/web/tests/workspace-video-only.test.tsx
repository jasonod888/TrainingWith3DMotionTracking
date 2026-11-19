import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/practice.html', pretendToBeVisual: true});
const {window} = dom;
Object.assign(globalThis, {
  window: window as unknown as Window & typeof globalThis,
  document: window.document,
  location: window.location,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
if (!window.matchMedia) window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 4)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;

const {render, cleanup} = await import('@testing-library/react');
const {InstructorVideo} = await import('../src/InstructorVideo.tsx');
const {MotionStage} = await import('../src/MotionStage.tsx');

after(() => { cleanup(); dom.window.close(); });

const ASSET = (key: string, mime: string) => ({key, mime, bytes: 10, sha256: 'a'.repeat(64)});

/** A video-only movement: no GLB, only the normalised clip. */
function videoOnlyLesson(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1, lesson_id: 'video', revision_id: 'r1', title: 'Video only',
    duration: 2, source_start: 0, standing_time: 0, frame_rate: 29.97,
    engine: 'mediapipe', engine_version: 'mediapipe-pose-heavy-v1',
    units: 'metres', landmark_axes: 'x-right/y-down/z-forward', root_motion: 'hip-relative',
    confidence: 'unmeasured',
    animation: null,
    landmarks: ASSET('lessons/video/reference.json', 'application/json'),
    source_video: ASSET('lessons/video/preview.mp4', 'video/mp4'),
    thumbnail: null, focused_video: null, focused_video_alpha: null,
    section_set: {id: 's', revision: 1, duration: 2,
                  sections: [{id: 'whole', label: 'Full movement', start: 0, end: 2}]},
    warnings: [], feedback_enabled: true,
    ...overrides,
  } as any;
}

const player = {
  state: {playing: false, time: 0, speed: 1, calibrating: false, index: 0, mode: 'sections'},
} as any;

test('a video-only lesson shows the real instructor instead of a 3D pane', () => {
  const view = render(<InstructorVideo lesson={videoOnlyLesson()} player={player}/>);
  const video = view.container.querySelector('video');
  assert.ok(video, 'the source video is rendered');
  assert.equal(video!.getAttribute('aria-label'), 'Original instructor video');
  view.unmount();
});

test('a missing video on a video-only lesson never offers a 3D fallback', () => {
  const lesson = videoOnlyLesson({source_video: null});
  const view = render(<InstructorVideo lesson={lesson} player={player}/>);
  const text = view.container.textContent ?? '';
  assert.match(text, /video only/i);
  assert.doesNotMatch(text, /3D instructor/i);
  view.unmount();
});

test('MotionStage does not initialise Three.js without an animation', () => {
  const view = render(<MotionStage lesson={videoOnlyLesson({source_video: null})} player={player} source={false}/>);
  assert.equal(view.container.querySelector('canvas'), null, 'no WebGL canvas is created');
  assert.equal(view.container.querySelector('video'), null, 'no video is invented either');
  assert.match(view.container.textContent ?? '', /video only/i);
  assert.doesNotMatch(view.container.textContent ?? '', /Loading your reference/);
  view.unmount();
});

test('MotionStage renders the wide video for a video-only lesson', () => {
  const view = render(<MotionStage lesson={videoOnlyLesson()} player={player} source/>);
  assert.ok(view.container.querySelector('video'));
  assert.equal(view.container.querySelector('canvas'), null);
  view.unmount();
});
