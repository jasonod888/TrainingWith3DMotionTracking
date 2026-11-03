import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { Section } from '../../../packages/lesson-schema/index';
import { markerBounds } from './section-markers';
import { timeLabel } from './timeline';

const displayedTime = (value: number) => String(Number(value.toFixed(4)));

function SectionTimeInput({ value, min, max, fps, disabled, onCommit }: { value: number; min: number; max: number; fps: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [text, setText] = useState(() => displayedTime(value));
  useEffect(() => setText(displayedTime(value)), [value]);
  const commit = () => {
    const parsed = Number(text);
    if (!text.trim() || !Number.isFinite(parsed)) { setText(displayedTime(value)); return; }
    const next = Math.max(min, Math.min(max, Math.round(parsed * fps) / fps));
    onCommit(next); setText(displayedTime(next));
  };
  return <input aria-label="Section end time" type="number" step={1 / fps} min={min} max={max} value={text} disabled={disabled}
    onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.preventDefault(); setText(displayedTime(value)); } }} />;
}

type Props = { sections: Section[]; selected: number; fps: number; saving: boolean; onSelect: (index: number) => void; onName: (name: string) => void; onMove: (boundary: number, time: number) => void; onRemove: () => void };

/** Inspector data only changes on selection or edits, never on playback ticks. */
export const SectionInspector = memo(function SectionInspector({ sections, selected, fps, saving, onSelect, onName, onMove, onRemove }: Props) {
  const list = useRef<HTMLDivElement>(null), current = sections[selected], last = selected === sections.length - 1;
  const bounds = last ? { min: current.end, max: current.end } : markerBounds(sections, selected + 1, fps);
  useEffect(() => { list.current?.querySelector(`[data-marker-index="${selected}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected, sections.length]);
  const navigate = (event: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: selected + 1, ArrowDown: selected + 1, ArrowLeft: selected - 1, ArrowUp: selected - 1, Home: 0, End: sections.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault(); const next = Math.max(0, Math.min(sections.length - 1, keys[event.key]));
    onSelect(next); list.current?.querySelector<HTMLButtonElement>(`[data-marker-index="${next}"]`)?.focus();
  };
  return <aside className="marker-inspector" aria-label="Selected section controls">
    <div className="marker-panel-heading"><h2>Sections <span>{sections.length}</span></h2><p>Select a section to preview or refine it.</p></div>
    <div className="marker-list" ref={list} role="group" aria-label="Lesson sections">
      {sections.map((section, index) => <button key={section.id} data-marker-index={index} tabIndex={index === selected ? 0 : -1}
        aria-label={`Select section ${index + 1}`} aria-pressed={index === selected} onClick={() => onSelect(index)} onKeyDown={navigate}>
        <span className="marker-number">{index + 1}</span><span className="marker-list-copy">
          <strong>{/^\d+$/.test(section.label) ? `Section ${index + 1}` : section.label}</strong>
          <small>{timeLabel(section.start)} – {timeLabel(section.end)}</small>
        </span>
      </button>)}
    </div>
    <div className="marker-properties">
      <div className="marker-properties-heading"><strong>Section {selected + 1}</strong>
        <button className="marker-delete" aria-label="Remove section boundary" title="Remove the boundary and join the adjacent sections" disabled={sections.length === 1 || saving} onClick={onRemove}><Trash2 size={16} /></button>
      </div>
      <div className="marker-property-fields">
        <label>Name <span>optional</span><input aria-label="Section name" maxLength={80} value={current.label} disabled={saving}
          onChange={e => onName(e.target.value)} onBlur={() => { if (!current.label.trim()) onName(String(selected + 1)); }} /></label>
        <label>End <span>seconds</span><SectionTimeInput key={current.id} value={current.end} min={bounds.min} max={bounds.max} fps={fps} disabled={last || saving}
          onCommit={value => { if (Math.abs(value - current.end) > 1e-6) onMove(selected + 1, value); }} /></label>
      </div>
      <p className="marker-property-hint">{sections.length === 1 ? 'Add a marker to split this into two sections.' : last ? 'Final section · ends at the end of the video.' : 'Drag the ending boundary to adjust this section.'}</p>
    </div>
  </aside>;
});
