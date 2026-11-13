import {useEffect, useRef, useState} from 'react';

/** Width of an element, tracked with ResizeObserver so the surfaces can lay out. */
export function useElementWidth<T extends HTMLElement>(fallback = 0): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
