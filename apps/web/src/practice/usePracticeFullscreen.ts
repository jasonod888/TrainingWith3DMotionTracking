import {useCallback, useEffect, useRef, useState, type RefObject} from 'react';

export type PracticeFullscreenController = {
  active: boolean;
  available: boolean;
  error: string;
  enter: () => Promise<boolean>;
  exit: () => Promise<void>;
  toggle: () => Promise<void>;
};

/**
 * One browser-fullscreen lifecycle for the complete practice surface.
 *
 * The hook owns only the root passed to it, never another element's fullscreen.
 * It syncs with fullscreenchange (including Escape/browser exit), reports unsupported
 * and rejected requests honestly, and exits an owned fullscreen on unmount. This is
 * separate from an in-app focus fallback so callers never claim browser fullscreen.
 */
export function usePracticeFullscreen(
  rootRef: RefObject<HTMLElement | null>,
  options: {onExit?: () => void} = {},
): PracticeFullscreenController {
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const owned = useRef<HTMLElement | null>(null);
  const onExit = useRef(options.onExit);
  onExit.current = options.onExit;
  const available = typeof document !== 'undefined'
    && typeof document.exitFullscreen === 'function'
    && typeof HTMLElement !== 'undefined'
    && typeof HTMLElement.prototype.requestFullscreen === 'function'
    && document.fullscreenEnabled !== false;

  const enter = useCallback(async () => {
    const root = rootRef.current;
    if (!root || !available || typeof root.requestFullscreen !== 'function') {
      setError('Fullscreen is unavailable in this browser.');
      return false;
    }
    try {
      await root.requestFullscreen();
      if (document.fullscreenElement !== root) {
        setError('The browser did not enter fullscreen.');
        return false;
      }
      owned.current = root;
      setActive(true);
      setError('');
      return true;
    } catch {
      setError('Fullscreen was blocked. Allow it in the browser, or continue in the normal view.');
      return false;
    }
  }, [available, rootRef]);

  const exit = useCallback(async () => {
    const root = rootRef.current;
    if (!root || document.fullscreenElement !== root) return;
    try {
      await document.exitFullscreen();
      setError('');
    } catch {
      setError('Could not exit fullscreen. Use Escape or the browser control.');
    }
  }, [rootRef]);

  const toggle = useCallback(async () => {
    if (active || (rootRef.current && document.fullscreenElement === rootRef.current)) await exit();
    else await enter();
  }, [active, enter, exit, rootRef]);

  useEffect(() => {
    const sync = () => {
      const element = document.fullscreenElement;
      const current = rootRef.current;
      setActive(Boolean(current && element === current));
      if (current && element === current) owned.current = current;
      else if (!element) {
        owned.current = null;
        onExit.current?.();
      }
    };
    const rejected = () => setError('Fullscreen was blocked. Allow it in the browser, or continue in the normal view.');
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('fullscreenerror', rejected);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('fullscreenerror', rejected);
      const current = rootRef.current;
      if (current && document.fullscreenElement === current) {
        owned.current = null;
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [rootRef]);

  return {active, available, error, enter, exit, toggle};
}
