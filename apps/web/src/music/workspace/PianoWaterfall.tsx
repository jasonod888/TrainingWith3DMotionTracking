import {useEffect, useMemo, useState} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import {buildPianoGeometry, type PianoRange} from '../notation/piano-key-geometry';
import {useClockTime, type ClockStore} from './clock';
import {useElementWidth} from './useElementWidth';

const VIEW_HEIGHT = 220;
const DEFAULT_WINDOW_SECONDS = 5;

type Interval = {id: string; pitch: number; start: number; end: number};

export function PianoWaterfall({
  document, clock, intervals, range, selectedOccurrenceId, onSelect,
}: {
  document: NotationDocument;
  clock: ClockStore | null;
  intervals: Interval[];
  range: PianoRange | null;
  selectedOccurrenceId: string | null;
  onSelect: (occurrenceId: string) => void;
}) {
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  const live = useClockTime(clock, 0);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof globalThis.window?.matchMedia !== 'function') return;
    const query = globalThis.window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  const now = live;
  const guideNow = reducedMotion ? Math.floor(live * 2) / 2 : live;
  const windowSeconds = width > 0 && width < 520 ? 3.5 : DEFAULT_WINDOW_SECONDS;
  const geometry = useMemo(() => range ? buildPianoGeometry(range, Math.max(1, width)) : null,
    [range, width]);
  const keyByPitch = useMemo(() => {
    const map = new Map<number, {x: number; width: number}>();
    if (!geometry) return map;
    for (const key of [...geometry.whites, ...geometry.blacks]) map.set(key.pitch, key);
    return map;
  }, [geometry]);
  const pixelsPerSecond = VIEW_HEIGHT / windowSeconds;
  const visible = useMemo(() => {
    if (!geometry) return [];
    const result: {id: string; pitch: number; x: number; width: number; y: number; height: number;
      selected: boolean; active: boolean}[] = [];
    for (const interval of intervals) {
      if (interval.end <= now || interval.start >= now + windowSeconds) continue;
      const key = keyByPitch.get(interval.pitch);
      if (!key) continue;
      const bottom = VIEW_HEIGHT - Math.max(0, (interval.start - guideNow) * pixelsPerSecond);
      const top = VIEW_HEIGHT - Math.max(0, (interval.end - guideNow) * pixelsPerSecond);
      const clippedTop = Math.max(0, top);
      const clippedBottom = Math.min(VIEW_HEIGHT, bottom);
      if (clippedBottom <= 0 || clippedTop >= VIEW_HEIGHT) continue;
      result.push({
        id: interval.id, pitch: interval.pitch,
        x: key.x + 1.5, width: Math.max(3, key.width - 3),
        y: clippedTop, height: Math.max(2, clippedBottom - clippedTop),
        selected: interval.id === selectedOccurrenceId,
        active: now >= interval.start && now < interval.end,
      });
    }
    return result;
  }, [geometry, intervals, keyByPitch, guideNow, now, pixelsPerSecond, selectedOccurrenceId, windowSeconds]);
  const outOfRange = useMemo(() => {
    if (!range) return {low: 0, high: 0};
    let low = 0;
    let high = 0;
    for (const interval of intervals) {
      if (interval.end <= now || interval.start >= now + windowSeconds) continue;
      if (interval.pitch < range.firstPitch) low += 1;
      else if (interval.pitch > range.firstPitch + range.semitones) high += 1;
    }
    return {low, high};
  }, [intervals, now, range, windowSeconds]);

  return <div className="ws-waterfall" ref={hostRef} data-live-now={now.toFixed(3)}
    data-guide-now={guideNow.toFixed(3)} data-window-seconds={windowSeconds}
    data-duration={document.duration}
    data-first-pitch={range?.firstPitch ?? ''}
    data-last-pitch={range ? range.firstPitch + range.semitones : ''}>
    {geometry && width > 0
      ? <svg className="ws-waterfall-svg" viewBox={`0 0 ${Math.max(1, width)} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none" role="img"
          aria-label={`Falling piano guide for ${pitchName(range!.firstPitch)} to ${pitchName(range!.firstPitch + range!.semitones)}`}>
          {geometry.whites.map(key => <rect key={`lane-${key.pitch}`} className="ws-waterfall-lane"
            x={key.x} y={0} width={key.width} height={VIEW_HEIGHT}/>)}
          {visible.map(block => <rect key={block.id} className={`ws-waterfall-note${block.selected ? ' is-selected' : ''}${block.active ? ' is-active' : ''}`}
            data-occurrence={block.id} data-pitch={block.pitch}
            x={block.x} y={block.y} width={block.width} height={block.height} rx={Math.min(4, block.width / 3)}
            role="button" tabIndex={-1} aria-label={`${pitchName(block.pitch)} guide note`}
            onPointerDown={event => { event.preventDefault(); onSelect(block.id); }}>
            <title>{pitchName(block.pitch)}</title>
          </rect>)}
          <line className="ws-waterfall-strike" x1={0} y1={VIEW_HEIGHT - 1}
            x2={Math.max(1, width)} y2={VIEW_HEIGHT - 1}/>
        </svg>
      : <p className="ws-waterfall-empty">Preparing the guide…</p>}
    {(outOfRange.low > 0 || outOfRange.high > 0) &&
      <span className="ws-waterfall-range-cue" data-out-of-range={`${outOfRange.low}:${outOfRange.high}`}>
        {outOfRange.low > 0 ? `← ${outOfRange.low}` : ''}
        {outOfRange.low > 0 && outOfRange.high > 0 ? ' · ' : ''}
        {outOfRange.high > 0 ? `${outOfRange.high} →` : ''}
        {' '}outside range
      </span>}
    <span className="ws-sr-only">Upcoming performance notes fall toward the piano keys. Use the roll or score to select notes.</span>
  </div>;
}
