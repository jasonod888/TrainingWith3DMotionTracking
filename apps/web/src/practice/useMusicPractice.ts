import {useCallback, useEffect, useRef, useState, type RefObject} from 'react';
import type {PracticeCommand} from '../../../../packages/learning-engine/practice-commands';
import type {PracticeCapabilities} from '../../../../packages/learning-engine/practice-capabilities';
import type {PracticePlan} from '../../../../packages/learning-engine/practice-plan';
import {PracticeRuntime, type PracticeRuntimeSnapshot} from '../../../../packages/learning-engine/practice-runtime';
import {createClock, type ClockStore} from '../music/workspace/clock';
import {createMediaTransport} from './media-transport';
import type {PracticeIdentity, PracticePreferencesRecord, PracticeStore} from './practice-store';

export type MusicPracticeState = {
  runtime: PracticeRuntime | null;
  snapshot: PracticeRuntimeSnapshot | null;
  clock: ClockStore;
  restoring: boolean;
  restored: boolean;
  transportError: string;
  lastAttempt: {id: string; start: number; end: number; completed: boolean; reason: string} | null;
  dispatch: (command: PracticeCommand) => void;
  saveNow: () => Promise<void>;
};

const initialPreferences = (capabilities: PracticeCapabilities): PracticePreferencesRecord => ({
  speed: capabilities.speeds.includes(1) ? 1 : capabilities.speeds[0] ?? 1,
  mode: capabilities.progression[0] ?? 'sections',
  loop: false,
  repetitions: 0,
  countdownSeconds: capabilities.countIn.value,
  restSeconds: capabilities.rest.value,
});

/**
 * Music-side runtime binding. Media time is the only source clock; the single
 * scheduler here supplies count-in/rest deltas and observes the media.
 */
export function useMusicPractice({
  plan, mediaRef, transportKey, capabilities, store, clock: providedClock, onAttempt,
}: {
  plan: PracticePlan;
  mediaRef: RefObject<HTMLMediaElement | null>;
  transportKey: string;
  capabilities: PracticeCapabilities;
  store: PracticeStore;
  clock?: ClockStore;
  onAttempt?: (attempt: {id: string; start: number; end: number; completed: boolean; reason: string}) => void;
}): MusicPracticeState {
  const [runtime, setRuntime] = useState<PracticeRuntime | null>(null);
  const [snapshot, setSnapshot] = useState<PracticeRuntimeSnapshot | null>(null);
  const [restoring, setRestoring] = useState(Boolean(transportKey));
  const [restored, setRestored] = useState(false);
  const [transportError, setTransportError] = useState('');
  const [lastAttempt, setLastAttempt] = useState<MusicPracticeState['lastAttempt']>(null);
  const [mediaNode, setMediaNode] = useState<HTMLMediaElement | null>(null);
  // The stage may mount its media element a render or two after the plan exists.
  // Track the actual node so the transport attaches when it becomes available and
  // is re-attached if a route replaces it.
  useEffect(() => {
    if (mediaRef.current !== mediaNode) setMediaNode(mediaRef.current);
  });
  const clock = useRef<ClockStore>(providedClock ?? createClock()).current;
  const runtimeRef = useRef<PracticeRuntime | null>(null);
  const attempt = useRef(onAttempt);
  attempt.current = onAttempt;
  const identity = useRef<PracticeIdentity>({
    lessonId: plan.lessonId, revisionId: plan.revisionId, planId: plan.id, duration: plan.duration,
  });
  identity.current = {lessonId: plan.lessonId, revisionId: plan.revisionId, planId: plan.id, duration: plan.duration};
  const storeRef = useRef(store);
  storeRef.current = store;
  const userActed = useRef(false);
  const restoreGeneration = useRef(0);

  useEffect(() => {
    const media = mediaNode;
    if (!transportKey || !media) {
      setRuntime(null);
      runtimeRef.current = null;
      setRestoring(false);
      return;
    }
    const preferences = storeRef.current.loadPreferences(plan) ?? initialPreferences(capabilities);
    const effectIdentity = {...identity.current};
    const generation = ++restoreGeneration.current;
    userActed.current = false;
    const transport = createMediaTransport(mediaRef, plan.duration, message => setTransportError(message));
    const next = new PracticeRuntime({
      plan,
      transport,
      countdownSeconds: preferences.countdownSeconds,
      restSeconds: preferences.restSeconds,
      loop: preferences.loop,
      repetitions: preferences.repetitions,
      mode: preferences.mode,
      now: () => performance.now(),
    });
    next.setRate(preferences.speed);
    next.onAttempt = value => { setLastAttempt(value); attempt.current?.(value); };
    let alive = true;
    runtimeRef.current = next;
    setRuntime(next);
    setSnapshot(next.snapshot);
    setRestoring(true);
    setRestored(false);
    setTransportError('');
    void storeRef.current.load(identity.current).then(record => {
      if (!alive || generation !== restoreGeneration.current) return;
      if (!record) { setRestoring(false); return; }
      if (record.revisionId !== plan.revisionId) { setRestoring(false); return; }
      if (userActed.current) {
        // A learner action after mount wins over a late stored record.
        setRestoring(false);
        return;
      }
      next.loop = record.loop;
      next.repetitions = record.repetitions;
      next.countdownSeconds = record.countdownSeconds;
      next.restSeconds = record.restSeconds;
      next.setRate(record.speed);
      next.setMode(record.mode);
      if (record.time > 0.01 || record.unitId) {
        next.restore({unitId: record.unitId, time: record.time, planId: record.planId, revisionId: record.revisionId});
        setRestored(true);
      }
      setSnapshot(next.snapshot);
      setRestoring(false);
    }).catch(() => { if (alive && generation === restoreGeneration.current) setRestoring(false); });
    return () => {
      alive = false;
      const state = next.snapshot;
      if (state.time > 0.01 || state.attempt) {
        void storeRef.current.save(effectIdentity, {
          revisionId: effectIdentity.revisionId, planId: effectIdentity.planId,
          unitId: state.unitId || null, time: state.time, speed: state.rate, mode: state.mode,
          loop: state.loop, repetitions: state.repetitions,
          countdownSeconds: state.countdownSeconds, restSeconds: state.restSeconds,
          updatedAt: Date.now(),
        });
      }
      storeRef.current.savePreferences(effectIdentity, {
        speed: state.rate, mode: state.mode, loop: state.loop,
        repetitions: state.repetitions, countdownSeconds: state.countdownSeconds,
        restSeconds: state.restSeconds,
      });
      if (runtimeRef.current === next) runtimeRef.current = null;
      next.destroy();
      transport.destroy?.();
    };
  }, [plan.id, transportKey, mediaNode]);

  // One scheduler for count-in/rest and for observing the media position. It does
  // not advance the media; piano/guitar source time comes from the element.
  useEffect(() => {
    if (!runtime) return;
    let frame = 0;
    let last = performance.now();
    let lastRender = 0;
    const loop = (now: number) => {
      const delta = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      runtime.tick(delta);
      const next = runtime.snapshot;
      clock.set(next.time);
      if (now - lastRender >= 60) {
        lastRender = now;
        setSnapshot(next);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [runtime, clock]);

  const saveNow = useCallback(async () => {
    const active = runtimeRef.current;
    if (!active) return;
    const state = active.snapshot;
    const currentIdentity = identity.current;
    if (!currentIdentity.lessonId) return;
    if (state.time <= 0.01 && !state.attempt) return;
    await storeRef.current.save(currentIdentity, {
      revisionId: currentIdentity.revisionId,
      planId: currentIdentity.planId,
      unitId: state.unitId || null,
      time: state.time,
      speed: state.rate,
      mode: state.mode,
      loop: state.loop,
      repetitions: state.repetitions,
      countdownSeconds: state.countdownSeconds,
      restSeconds: state.restSeconds,
      updatedAt: Date.now(),
    });
  }, []);

  // Periodic checkpoint during sustained playback, independent of the 60 ms
  // snapshot cadence. A separate short save records pause/boundary states.
  useEffect(() => {
    if (!runtime) return;
    const timer = window.setInterval(() => { void saveNow(); }, 5000);
    return () => window.clearInterval(timer);
  }, [runtime, saveNow]);

  useEffect(() => {
    if (!snapshot || snapshot.status === 'playing' || snapshot.status === 'buffering') return;
    if (snapshot.status === 'idle' && snapshot.time <= 0.01) return;
    const timer = window.setTimeout(() => { void saveNow(); }, 450);
    return () => window.clearTimeout(timer);
  }, [snapshot?.status, snapshot?.unitId, saveNow]);

  useEffect(() => {
    const hidden = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        runtimeRef.current?.dispatch({type: 'action', action: 'pause'});
        void saveNow();
      }
    };
    const pagehide = () => {
      runtimeRef.current?.dispatch({type: 'action', action: 'pause'});
      void saveNow();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      void saveNow();
    };
  }, [saveNow]);

  const dispatch = useCallback((command: PracticeCommand) => {
    const active = runtimeRef.current;
    if (!active) return;
    userActed.current = true;
    active.dispatch(command);
    const state = active.snapshot;
    if (command.type === 'set-mode' || command.type === 'set-rate' || command.type === 'set-loop'
      || command.type === 'set-repetitions' || command.type === 'set-countdown' || command.type === 'set-rest') {
      storeRef.current.savePreferences(identity.current, {
        speed: state.rate, mode: state.mode, loop: state.loop,
        repetitions: state.repetitions, countdownSeconds: state.countdownSeconds,
        restSeconds: state.restSeconds,
      });
    }
    setSnapshot(state);
  }, []);

  return {runtime, snapshot, clock, restoring, restored, transportError, lastAttempt, dispatch, saveNow};
}
