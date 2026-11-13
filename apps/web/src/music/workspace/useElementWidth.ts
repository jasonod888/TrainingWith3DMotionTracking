import {useCallback, useEffect, useState} from 'react';

/**
 * Width of an element, tracked through a callback ref so a host that mounts after
 * an asynchronous load is measured too. Returning a callback ref (instead of a
 * mount-only effect) means the observer is attached whenever the node exists and
 * detached when it is replaced.
 *
 * Returns `[ref, width, element]`; the element is exposed for components that also
 * need to drive its scroll position.
 */
export function useElementWidth<T extends HTMLElement>(fallback = 0): [
  (node: T | null) => void,
  number,
  T | null,
] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  const ref = useCallback((node: T | null) => { setElement(node); }, []);

  useEffect(() => {
    if (!element) {
      setWidth(fallback);
      return;
    }
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, fallback]);

  return [ref, width, element];
}
