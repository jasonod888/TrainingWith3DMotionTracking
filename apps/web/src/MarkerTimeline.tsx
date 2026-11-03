import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { Section } from '../../../packages/lesson-schema/index';
import { markerBounds } from './section-markers';
import { sectionPreviewRange } from './section-preview';
import { timeLabel } from './timeline';

export function MarkerTimeline({ sections, duration, time, fps, selected, disabled, onSeek, onSelect, onMove }: { sections: Section[]; duration: number; time: number; fps: number; selected: number; disabled: boolean; onSeek: (time: number) => void; onSelect: (index: number) => void; onMove: (index: number, time: number) => void }) {
  const rail = useRef<HTMLDivElement>(null), drag = useRef<{ index: number | null; offset: number } | null>(null);
  const [zoom, setZoom] = useState(1), [start, setStart] = useState(0), [railWidth, setRailWidth] = useState(600), span = duration / zoom;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setRailWidth(entry.contentRect.width));
    observer.observe(rail.current!);
    return () => observer.disconnect();
  }, []);
  const maxZoom = Math.max(1, Math.min(16, 2 ** Math.floor(Math.log2(duration * fps / 10))));
  const origin = (value: number, size = span) => Math.max(0, Math.min(duration - size, value));
  useEffect(() => { const value = sections[selected].start; setStart(old => value < old || value > old + span ? origin(value - span / 2) : old); }, [selected, sections[selected].id, span]);
  useEffect(() => { if (drag.current) return; setStart(old => time < old || time > old + span ? origin(time - span * .2) : old); }, [time, span]);
  const setZoomLevel = (next: number) => { setZoom(next); setStart(origin(time - duration / next / 2, duration / next)); };
  const at = (e: PointerEvent) => { const box = rail.current!.getBoundingClientRect(); return Math.max(0, Math.min(duration, start + Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * span)); };
  const snap = (value: number) => Math.min(duration, Math.max(0, Math.round(value * fps) / fps));
  const percent = (value: number) => `${Math.max(0, Math.min(100, (value - start) / span * 100))}%`;
  const begin = (event: PointerEvent, index: number | null) => {
    if (disabled || event.button !== 0) return; event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const value = index === null ? time : sections[index].start;
    drag.current = { index, offset: value - at(event) };
    if (index !== null) onSelect(index - 1);
  };
  const move = (event: PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    event.stopPropagation();
    const value = snap(at(event) + current.offset);
    if (current.index === null) onSeek(value); else onMove(current.index, value);
  };
  const finish = () => { drag.current = null; };
  const key = (event: KeyboardEvent, index: number | null) => {
    const value = index === null ? time : sections[index].start, bounds = index === null ? { min: section.start, max: section.end } : markerBounds(sections, index, fps);
    const step = (event.shiftKey ? 10 : 1) / fps;
    const keys: Record<string, number> = { ArrowLeft: value - step, ArrowRight: value + step, ArrowDown: value - step, ArrowUp: value + step, Home: bounds.min, End: bounds.max };
    if (!(event.key in keys) || disabled) return; event.preventDefault(); event.stopPropagation();
    const next = snap(Math.max(bounds.min, Math.min(bounds.max, keys[event.key])));
    if (index === null) onSeek(next); else onMove(index, next);
  };
  const section = sectionPreviewRange(sections, selected);
  const seekFromRuler = (event: PointerEvent) => {
    if (disabled || event.button !== 0) return;
    const position = snap(at(event));
    if (position < section.start || position > section.end) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(position);
    drag.current = { index: null, offset: 0 };
  };
  return <div className="marker-timeline" role="group" aria-label="Movement marker timeline">
    <div className="marker-time-heading">
      <div className="marker-heading-tools">
        <span>MARKERS <b>{sections.length - 1}</b>
        </span>
        <div className="marker-zoom" role="group" aria-label="Timeline zoom">
          <button aria-label="Zoom timeline out" title="Show more of the timeline" disabled={disabled || zoom === 1} onClick={() => setZoomLevel(Math.max(1, zoom / 2))}>
            <ZoomOut size={14} />
          </button>
          <span>{zoom}×</span>
          <button aria-label="Zoom timeline in" title="Separate closely spaced markers" disabled={disabled || zoom >= maxZoom} onClick={() => setZoomLevel(Math.min(maxZoom, zoom * 2))}>
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
      <output aria-label="Current preview time">{timeLabel(time)} <span>/ {timeLabel(duration)}</span>
      </output>
    </div>
    <div ref={rail} className="marker-track" onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <div className="marker-clip-lane" aria-label="Video sections">{sections.map((s, i) =>
        <button type="button" aria-label={`Select timeline section ${i + 1}`} aria-pressed={i === selected} disabled={disabled} onClick={() => onSelect(i)} key={s.id} hidden={s.end <= start || s.start >= start + span} className={`marker-clip-section ${i === section.index ? 'is-active' : ''}`} data-start={s.start} data-end={s.end} data-section={i + 1} style={{ left: percent(s.start), width: `${Math.max(0, Math.min(start + span, s.end) - Math.max(start, s.start)) / span * 100}%` }}>
          <span>{String(i + 1).padStart(2, '0')}</span>
        </button>)}</div>
      {sections.map((s, i) => {
        if (i === 0) return null;
        const bounds = markerBounds(sections, i, fps);
        const crowded = i !== selected + 1 && [i > 1 ? sections[i - 1] : undefined, sections[i + 1]].some(other => other && Math.abs(other.start - s.start) / span * railWidth < 30);
        return <button key={s.id} hidden={s.start < start - 1e-6 || s.start > start + span + 1e-6} type="button" role="slider" aria-label={`Marker ${i} position`} aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={s.start} aria-valuetext={timeLabel(s.start)} aria-disabled={disabled} disabled={disabled} title={`Marker ${i} · ${timeLabel(s.start)}`} className={`marker-pin ${i === selected + 1 ? 'is-selected' : ''} ${crowded ? 'is-crowded' : ''}`} style={{ left: percent(s.start) }} onPointerDown={e => begin(e, i)} onClick={() => onSelect(i - 1)} onKeyDown={e => key(e, i)}>
          <span>{i}</span>
        </button>;
      })}
      <button type="button" role="slider" aria-label="Preview position" aria-valuemin={section.start} aria-valuemax={section.end} aria-valuenow={time} aria-valuetext={timeLabel(time)} disabled={disabled} className="marker-playhead" title="Playback start · drag to preview a different frame" style={{ left: percent(time) }} onPointerDown={e => begin(e, null)} onKeyDown={e => key(e, null)}>
        <span />
      </button>
      <button type="button" aria-label="Seek within selected section" title="Click above the selected section to set playback position" disabled={disabled} className="marker-seek-surface" onPointerDown={seekFromRuler} onKeyDown={e => key(e, null)} />

    </div>
    <div className="marker-track-caption">
      <span>{`Section ${section.index + 1}`} <b>{timeLabel(section.start)} – {timeLabel(section.end)}</b>
      </span>
      <span className="playhead-legend">Playback line</span>
    </div>
    <div className="marker-time-ruler" aria-hidden="true">{[0, .25, .5, .75, 1].map(p =>
      <span key={p}>{timeLabel(start + span * p)}</span>)}</div>
  </div>;
}
