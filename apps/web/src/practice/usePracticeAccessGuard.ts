/** One mounted-practice access guard: bag, revalidation, monitoring and teardown. */
import {useEffect, useRef} from 'react';
import type {PracticeRuntime} from '../../../../packages/learning-engine/practice-runtime';
import type {PracticeTransport} from '../../../../packages/learning-engine/practice-transport';
import type {PracticeResourceBag} from '../../../../packages/learning-engine/practice-adapter';
import {createResourceBag} from '../../../../packages/learning-engine/practice-adapter';
import type {LessonContext} from '../app/lesson-context';
import {createContextRevalidator, createSessionGuard, type SessionGuard} from './session-guard';

export function usePracticeAccessGuard({runtime, transport, context, onLost, register, revalidate}: {
  runtime: PracticeRuntime | null | undefined;
  transport?: PracticeTransport | null;
  context?: LessonContext | null;
  onLost?: () => void;
  register?: (bag: PracticeResourceBag) => void;
  /** Explicit fallback used when a validated context is unavailable. */
  revalidate?: () => Promise<unknown>;
}) {
  const bag = useRef(createResourceBag()).current;
  const guard = useRef<SessionGuard | null>(null);
  const lost = useRef(onLost);
  lost.current = onLost;
  const registerRef = useRef(register);
  registerRef.current = register;

  useEffect(() => {
    const revalidator = revalidate ?? createContextRevalidator(context);
    if (!runtime || !revalidator) {
      guard.current = null;
      return;
    }
    const value = createSessionGuard({
      runtime, transport: transport ?? undefined, resources: bag, revalidate: revalidator,
      onLost: () => lost.current?.(),
    });
    guard.current = value;
    const stop = value.start();
    registerRef.current?.(bag);
    return () => {
      stop();
      guard.current = null;
      void bag.releaseAll();
    };
  }, [runtime, transport, context, bag, revalidate]);

  return {bag, guardRef: guard};
}
