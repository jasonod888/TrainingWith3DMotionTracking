/** Focused behavior evidence for the editor playback/audio binding. */
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildNotation} from '../../../packages/music-notation/index.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  {url: 'http://localhost/', pretendToBeVisual: true});
const {window} = dom;
Object.assign(globalThis, {
  window: window as unknown as Window & typeof globalThis,
  document: window.document,
  HTMLElement: window.HTMLElement,
  HTMLMediaElement: window.HTMLMediaElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
});
Object.defineProperty(globalThis, 'navigator', {value: window.navigator, configurable: true});
globalThis.fetch = (async () => new Response('not found', {status: 404})) as typeof fetch;

const {renderHook, act, cleanup} = await import('@testing-library/react');
const {useMusicEditorPlayback} = await import('../src/music/workspace/useMusicEditorPlayback.ts');

afterEach(cleanup);

const score = buildNotation([{
  id: 'e1', onset: 0.5, duration: 0.5, pitch: 60, velocity: 0.6,
  confidence: null, optional: false, string: null, fret: null,
}], {bpm: 120, duration: 12});
const asset = {key: 'lessons/lesson-1/piano.wav', mime: 'audio/wav', bytes: 4,
  sha256: 'a'.repeat(64)} as never;

type FakeMedia = HTMLMediaElement & {plays: number};

function mediaElement(tag: 'video' | 'audio'): FakeMedia {
  const media = window.document.createElement(tag) as unknown as FakeMedia;
  media.plays = 0;
  Object.defineProperties(media, {
    currentTime: {value: 0, writable: true, configurable: true},
    paused: {value: true, writable: true, configurable: true},
    ended: {value: false, writable: true, configurable: true},
    seeking: {value: false, writable: true, configurable: true},
    readyState: {value: 4, writable: true, configurable: true},
    volume: {value: 1, writable: true, configurable: true},
    playbackRate: {value: 1, writable: true, configurable: true},
    muted: {value: false, writable: true, configurable: true},
  });
  const setPaused = (value: boolean) => {
    Object.defineProperty(media, 'paused', {value, writable: true, configurable: true});
  };
  media.play = function () {
    media.plays += 1;
    setPaused(false);
    media.dispatchEvent(new window.Event('play'));
    return Promise.resolve();
  };
  media.pause = function () {
    setPaused(true);
    media.dispatchEvent(new window.Event('pause'));
  };
  return media;
}

function event(name: string): Event {
  return new window.Event(name);
}

test('the source media mirrors its time into the one visual clock', () => {
  const {result} = renderHook(() => useMusicEditorPlayback({document: score, offsetSeconds: 0}));
  const clock = result.current.clock;
  const video = mediaElement('video');
  act(() => result.current.attachVideo(video));
  assert.equal(clock.get(), 0);

  video.currentTime = 3;
  act(() => video.dispatchEvent(event('timeupdate')));
  assert.equal(clock.get(), 3, 'the media element is authoritative');
  assert.equal(result.current.playhead, 3);

  act(() => result.current.seek(5));
  assert.equal(video.currentTime, 5);
  assert.equal(clock.get(), 5);
  assert.equal(result.current.playhead, 5);
  assert.equal(result.current.seekToken, 1, 'a seek requests one follow reveal');

  act(() => result.current.seek(99));
  assert.equal(video.currentTime, 12, 'seeks clamp to the document duration');
});

test('play, pause, rate and volume drive the media element', async () => {
  const {result} = renderHook(() => useMusicEditorPlayback({document: score, offsetSeconds: 0}));
  const video = mediaElement('video');
  act(() => result.current.attachVideo(video));

  act(() => result.current.play());
  await act(async () => { await Promise.resolve(); });
  assert.equal(video.plays, 1);
  assert.equal(result.current.playing, true);

  act(() => result.current.changeRate(0.5));
  assert.equal(result.current.rate, 0.5);
  assert.equal(video.playbackRate, 0.5);

  act(() => result.current.setVolume(0.25));
  assert.equal(result.current.volume, 0.25);
  assert.equal(video.volume, 0.25);

  act(() => result.current.pause());
  assert.equal(result.current.playing, false);
  act(() => result.current.toggleTransport());
  await act(async () => { await Promise.resolve(); });
  assert.equal(video.plays, 2, 'toggleTransport starts a paused source');
});

test('an unverified preview keeps Original audio and never exposes a fake URL', () => {
  // Keep the preview acquisition pending so this test observes the verifying state.
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
  const {result} = renderHook(() => useMusicEditorPlayback({document: score, offsetSeconds: 0}));
  act(() => result.current.restorePreview(asset, 'identity', score));
  assert.equal(result.current.preview.url, '');
  assert.equal(result.current.verifyingPreview, true);
  assert.equal(result.current.pianoDisabled, true);

  act(() => result.current.setAudioMode('piano'));
  assert.equal(result.current.audioMode, 'original', 'Piano falls back while the preview is unverified');
});

test('unmount removes the media subscription and cleanup is idempotent on rebind', () => {
  const {result} = renderHook(() => useMusicEditorPlayback({document: score, offsetSeconds: 0}));
  const clock = result.current.clock;
  const first = mediaElement('video');
  const second = mediaElement('video');

  act(() => result.current.attachVideo(first));
  first.currentTime = 2;
  act(() => first.dispatchEvent(event('timeupdate')));
  assert.equal(clock.get(), 2);

  second.currentTime = 4;
  act(() => result.current.attachVideo(second));
  assert.equal(clock.get(), 4, 'the new media node becomes the clock source');
  first.currentTime = 7;
  act(() => first.dispatchEvent(event('timeupdate')));
  assert.equal(clock.get(), 4, 'the replaced media element no longer advances the clock');

  second.currentTime = 5;
  act(() => second.dispatchEvent(event('timeupdate')));
  assert.equal(clock.get(), 5);

  // Re-entering the same node must not duplicate listeners or destroy the new owner.
  act(() => result.current.attachVideo(null));
  second.currentTime = 9;
  act(() => second.dispatchEvent(event('timeupdate')));
  assert.equal(clock.get(), 5);
});
