/**
 * The shared visual clock.
 *
 * The source video remains the only clock; this store is just a frame-rate mirror that
 * cursor layers and activation highlights subscribe to, so they can repaint every frame
 * without re-rendering the inspector and controls around them.
 */
import {useSyncExternalStore} from 'react';

export type ClockStore = {
  set: (seconds: number) => void;
  get: () => number;
  subscribe: (listener: () => void) => () => void;
};

export function createClock(initial = 0): ClockStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    set(seconds: number) {
      if (!Number.isFinite(seconds) || Math.abs(seconds - value) < 1e-6) return;
      value = seconds;
      for (const listener of listeners) listener();
    },
    get: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** Subscribes a component to the visual clock; falls back to the given time. */
export function useClockTime(clock: ClockStore | null | undefined, fallback = 0): number {
  return useSyncExternalStore(
    clock ? clock.subscribe : () => () => {},
    clock ? clock.get : () => fallback,
    () => fallback,
  );
}
