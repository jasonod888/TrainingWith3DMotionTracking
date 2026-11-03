import { useCallback, useEffect, useState } from 'react';
import type { Playback } from '../../../packages/learning-engine/playback';

/** Playback owns the clock; React only needs snapshots while it is advancing. */
export function useSectionPlayback(player: Playback) {
  const [state, setState] = useState(() => player.snapshot());
  const refresh = useCallback(() => setState(player.snapshot()), [player]);

  useEffect(() => {
    if (!state.playing) return;
    let frame = 0, last = performance.now(), draw = last;
    const tick = (now: number) => {
      player.tick(Math.min(.25, (now - last) / 1000)); last = now;
      if (now - draw >= 60 || !player.state.playing) { refresh(); draw = now; }
      if (player.state.playing) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [player, state.playing, refresh]);

  useEffect(() => {
    const hide = () => { if (document.hidden) { player.command('pause'); refresh(); } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [player, refresh]);

  return { state, refresh };
}
