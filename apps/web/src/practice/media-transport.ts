import type {PracticeTransport, PracticeTransportSnapshot} from '../../../../packages/learning-engine/practice-transport';
import type {RefObject} from 'react';

/**
 * Observed media transport for piano/guitar. The media element is the only
 * source position; this adapter never advances it from a timer. `waiting` and
 * `stalled` are exposed as a distinct buffering condition, not a user pause.
 */
export function createMediaTransport(
  element: RefObject<HTMLMediaElement | null>,
  fallbackDuration: number,
  onError?: (message: string) => void,
): PracticeTransport {
  const listeners = new Set<() => void>();
  let stalled = false;
  let error = '';
  let lastTime = 0;
  let seekTarget: number | null = null;
  let dead = false;
  const notify = () => {
    if (dead) return;
    for (const listener of [...listeners]) listener();
  };
  const media = () => element.current;

  const on = (name: string, handler: () => void) => {
    const node = media();
    node?.addEventListener(name, handler);
    return () => node?.removeEventListener(name, handler);
  };
  const cleanups: (() => void)[] = [];
  const attach = (node: HTMLMediaElement) => {
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
    cleanups.push(
      add(node, 'loadedmetadata', () => { stalled = false; notify(); }),
      add(node, 'play', () => { stalled = node.readyState < 3; error = ''; notify(); }),
      add(node, 'playing', () => { stalled = false; error = ''; notify(); }),
      add(node, 'canplay', () => { stalled = false; notify(); }),
      add(node, 'waiting', () => { stalled = true; notify(); }),
      add(node, 'stalled', () => { if (node.readyState < 3) stalled = true; notify(); }),
      add(node, 'seeking', () => notify()),
      add(node, 'seeked', () => { if (seekTarget !== null) seekTarget = null; notify(); }),
      add(node, 'pause', () => { stalled = false; notify(); }),
      add(node, 'timeupdate', () => {
        if (seekTarget !== null && Math.abs(node.currentTime - seekTarget) <= 0.35) seekTarget = null;
        lastTime = node.currentTime;
        notify();
      }),
      add(node, 'ended', () => { stalled = false; notify(); }),
      add(node, 'ratechange', () => notify()),
      add(node, 'error', () => {
        error = node.error?.message || 'The media source could not play.';
        onError?.(error);
        notify();
      }),
    );
  };
  function add(node: HTMLMediaElement, name: string, handler: () => void) {
    node.addEventListener(name, handler);
    return () => node.removeEventListener(name, handler);
  }
  const initial = media();
  if (initial) attach(initial);

  return {
    snapshot(): PracticeTransportSnapshot {
      const node = media();
      if (!node) {
        return {
          time: lastTime, duration: fallbackDuration, playing: false, ready: false,
          buffering: false, ended: false, rate: 1, error: error || 'The media source is unavailable.',
        };
      }
      const duration = Number.isFinite(node.duration) && node.duration > 0 ? node.duration : fallbackDuration;
      const time = Number.isFinite(node.currentTime) ? node.currentTime : lastTime;
      lastTime = time;
      return {
        time,
        duration,
        playing: !node.paused && !node.ended,
        ready: node.readyState >= 2 && !node.error,
        buffering: stalled || node.readyState < 2 && !node.paused,
        ended: node.ended,
        rate: node.playbackRate || 1,
        error: error || node.error?.message || '',
      };
    },
    play() {
      const node = media();
      if (!node) return Promise.reject(new Error('The media source is unavailable.'));
      error = '';
      stalled = false;
      const result = node.play();
      return result ?? Promise.resolve();
    },
    pause() {
      const node = media();
      stalled = false;
      node?.pause();
      notify();
    },
    seek(seconds) {
      const node = media();
      if (!node || !Number.isFinite(seconds)) return;
      seekTarget = seconds;
      lastTime = seconds;
      try { node.currentTime = seconds; } catch { seekTarget = null; }
      notify();
    },
    setRate(rate) {
      const node = media();
      if (!node || !Number.isFinite(rate) || rate <= 0) return;
      try { node.playbackRate = rate; } catch { /* rate is optional on some media */ }
      notify();
    },
    setMode() { /* media practice has one continuous source */ },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    destroy() {
      dead = true;
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      listeners.clear();
    },
  };
}
