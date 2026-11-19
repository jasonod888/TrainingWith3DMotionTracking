/**
 * Mounted-session access guard.
 *
 * A practice session can outlive its access. Revalidation is the authority: a
 * 401/403/404 tears down the runtime/transport and releases every resource exactly
 * once, so no camera/audio/subscription keeps running after access loss.
 */
import type {PracticeRuntime} from '../../../../packages/learning-engine/practice-runtime';
import type {PracticeTransport} from '../../../../packages/learning-engine/practice-transport';
import type {PracticeResourceBag} from '../../../../packages/learning-engine/practice-adapter';
import {loadPublicMove} from '../api';
import {revalidateLessonContext, type LessonContext} from '../app/lesson-context';

/** Single audience-aware access check. Demo never polls authenticated endpoints. */
export function createContextRevalidator(context: LessonContext | null | undefined): (() => Promise<unknown>) | null {
  if (!context || context.audience === 'demo') return null;
  if (context.audience === 'public') return () => loadPublicMove(context.lessonId);
  return () => revalidateLessonContext(context);
}

export type SessionGuard = {
  check(): Promise<boolean>;
  handleError(cause: unknown): Promise<boolean>;
  /** Focus/visibility/interval monitoring; registers its own release in the bag. */
  start(intervalMs?: number): () => void;
  isLost(): boolean;
};

export function createSessionGuard(input: {
  runtime: Pick<PracticeRuntime, 'destroy'>;
  transport?: Pick<PracticeTransport, 'destroy'>;
  resources: PracticeResourceBag;
  revalidate: () => Promise<unknown>;
  onLost?: () => void;
}): SessionGuard {
  let lost = false;
  let checking = false;
  const lose = async () => {
    if (lost) return true;
    lost = true;
    input.runtime.destroy();
    input.transport?.destroy?.();
    await input.resources.releaseAll();
    input.onLost?.();
    return true;
  };
  const handleError = async (cause: unknown) => {
    const status = (cause as {status?: number}).status;
    if (status === 401 || status === 403 || status === 404) return lose();
    return false;
  };
  return {
    isLost: () => lost,
    handleError,
    start(intervalMs = 15_000) {
      const run = () => { void (this as SessionGuard).check(); };
      const onVisibility = () => { if (document.visibilityState === 'visible') run(); };
      window.addEventListener('focus', run);
      document.addEventListener('visibilitychange', onVisibility);
      const timer = setInterval(run, intervalMs);
      const release = () => {
        window.removeEventListener('focus', run);
        document.removeEventListener('visibilitychange', onVisibility);
        clearInterval(timer);
      };
      input.resources.add({kind: 'subscription', label: 'session access revalidation', release});
      return release;
    },
    async check() {
      if (lost || checking) return lost;
      checking = true;
      try {
        await input.revalidate();
        return false;
      } catch (cause) {
        return handleError(cause);
      } finally {
        checking = false;
      }
    },
  };
}
