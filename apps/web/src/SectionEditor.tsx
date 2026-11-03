import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Box, Check, ChevronLeft, ChevronRight, Pause, Play, Plus, Video } from 'lucide-react';
import type { LessonManifest, Section } from '../../../packages/lesson-schema/index';
import { validateSections } from '../../../packages/lesson-schema/index';
import { Playback } from '../../../packages/learning-engine/playback';
import { MotionStage } from './MotionStage';
import { clampSectionPreview, sectionPreviewRange, playSectionPreview } from './section-preview';
import { SectionInspector } from './SectionInspector';
import { useSectionPlayback } from './useSectionPlayback';
import { MarkerTimeline } from './MarkerTimeline';
import { addMarker, initialMarkers, newMarkerTime, moveMarker, removeMarker } from './section-markers';
import { lessonFrameTime } from './lesson-clock';
import { timeLabel } from './timeline';
import './section-editor.css';

export function SectionEditor({ lesson, onBack, onPractice, onSave, onDirty, persistent }: { lesson: LessonManifest; onBack: () => void; onPractice: () => void; onSave: (sections: Section[], title: string) => Promise<void> | void; onDirty?: (dirty: boolean) => void; persistent: boolean }) {
  const [player] = useState(() => {
    const value = new Playback(lesson.section_set.sections, lesson.duration);
    value.mode('continuous');
    return value;
  });
  const [draft, setDraft] = useState(() => initialMarkers(lesson.section_set.sections));
  const [selected, setSelected] = useState(0);
  const [title, setTitle] = useState(lesson.title);
  const { state, refresh } = useSectionPlayback(player);
  const [source, setSource] = useState(Boolean(lesson.focused_video || lesson.source_video));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const fps = lesson.frame_rate ?? 15;
  const time = lessonFrameTime(lesson, state.time);
  const preview = sectionPreviewRange(draft, selected);
  const boundary = selected < draft.length - 1 ? selected + 1 : selected;
  useEffect(() => {
    document.body.classList.add('editing-markers');
    return () => document.body.classList.remove('editing-markers');
  }, []);
  useEffect(() => {
    onDirty?.(dirty);
    const before = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', before);
    return () => { window.removeEventListener('beforeunload', before); onDirty?.(false); };
  }, [dirty, onDirty]);

  const seek = useCallback((value: number) => {
    player.seek(clampSectionPreview(draft, selected, Math.round(value * fps) / fps));
    refresh();
  }, [player, fps, draft, selected, refresh]);
  const play = useCallback(() => {
    playSectionPreview(player, selected);
    refresh();
  }, [player, selected, refresh]);
  const select = useCallback((index: number) => {
    player.seek(clampSectionPreview(draft, index, player.state.time));
    setSelected(index);
    refresh();
  }, [draft, player, refresh]);
  // Every structural edit updates the player and React together, once.
  const commit = useCallback((sections: Section[], index: number, position: number) => {
    player.replace(sections);
    player.mode('continuous');
    player.seek(clampSectionPreview(sections, index, position));
    setDraft(sections);
    setSelected(index);
    setDirty(true);
    setMessage('');
    refresh();
  }, [player, refresh]);
  const add = useCallback(() => {
    try {
      const position = lessonFrameTime(lesson, player.state.time);
      const result = addMarker(draft, lesson.duration, position, crypto.randomUUID(), fps);
      commit(result.sections, result.selected - 1, result.time);
    } catch (error) { setMessage((error as Error).message); }
  }, [draft, lesson, player, fps, commit]);
  const move = useCallback((index: number, value: number) => {
    const sections = moveMarker(draft, lesson.duration, index, value, fps);
    commit(sections, index - 1, sections[index].start);
  }, [draft, lesson.duration, fps, commit]);
  const remove = useCallback(() => {
    if (draft.length === 1) return;
    const sections = removeMarker(draft, lesson.duration, boundary);
    commit(sections, Math.min(selected, sections.length - 1), player.state.time);
  }, [draft, lesson.duration, boundary, selected, player, commit]);
  const rename = useCallback((label: string) => {
    setDraft(previous => previous.map((section, index) => index === selected ? { ...section, label } : section));
    setDirty(true); setMessage('');
  }, [selected]);
  const save = async () => {
    setSaving(true); setMessage(''); player.command('pause');
    try {
      if (!title.trim()) throw new Error('Give your move a name.');
      const sections = draft.map((section, index) => ({ ...section, label: section.label.trim() || String(index + 1) }));
      await onSave(validateSections(sections, lesson.duration), title.trim());
      setDraft(sections); setDirty(false); onDirty?.(false);
      setMessage(persistent ? 'All changes saved.' : 'Draft kept in this session.');
    } catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || saving || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,select,textarea')) return;
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); add(); return; }
      if (target.closest('button,[role=slider]')) return;
      if (event.code === 'Space') { event.preventDefault(); play(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        seek(player.state.time + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / fps);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [add, play, seek, player, fps, saving]);
  useEffect(() => {
    if (message !== 'All changes saved.' && message !== 'Draft kept in this session.') return;
    const timer = window.setTimeout(() => setMessage(''), 3500);
    return () => clearTimeout(timer);
  }, [message]);
  const canAdd = newMarkerTime(draft, time, fps) !== null;
  const toggle = (video: boolean) => { seek(time); setSource(video); };
  return <section className="section-studio" aria-label="Section marker editor">
    <header className="section-studio-header">
      <button className="studio-icon" aria-label="Back to my moves" disabled={saving} onClick={onBack}>
        <ArrowLeft size={20} />
      </button>
      <div className="section-title">
        <span>SECTION EDITOR</span>
        <input aria-label="Move name" value={title} maxLength={200} disabled={saving} onChange={e => { setTitle(e.target.value); setDirty(true); setMessage(''); }} />
      </div>
      <span className="section-save-state">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <button className="studio-practice" disabled={dirty || saving} onClick={onPractice}>
        <Play size={15} />
        <span>Practise</span>
      </button>
      <button className="studio-save" disabled={!dirty || saving} onClick={() => void save()}>
        <Check size={17} />
        <span>{saving ? 'Saving…' : 'Save'}</span>
      </button>
    </header>
    <div className="section-studio-main">
      <div className="section-preview motion-stage">
        <MotionStage lesson={lesson} player={player} source={source} fit="envelope" />
        <div className="section-preview-top">
          <span className="section-preview-label">{source ? lesson.focused_video ? 'Segmented instructor' : 'Original wide video' : '3D instructor'}</span>
          <div className="section-preview-toggle" role="group" aria-label="Preview display">
            <button aria-label="Show segmented video" disabled={!(lesson.focused_video || lesson.source_video) || saving} aria-pressed={source} onClick={() => toggle(true)}>
              <Video size={16} />
              <span>Video</span>
            </button>
            <button aria-label="Show 3D animation" disabled={saving} aria-pressed={!source} onClick={() => toggle(false)}>
              <Box size={16} />
              <span>3D</span>
            </button>
          </div>
        </div>
        <label className="section-speed">Speed<select aria-label="Preview speed" value={state.speed} onChange={e => { player.speed(Number(e.target.value)); refresh(); }}>{[.25, .5, .75, 1].map(speed =>
          <option key={speed} value={speed}>{speed}×</option>)}</select>
        </label>
      </div>
      <SectionInspector sections={draft} selected={selected} fps={fps} saving={saving} onSelect={select} onName={rename} onMove={move} onRemove={remove} />
      <footer className="section-edit-dock">
        <MarkerTimeline sections={draft} duration={lesson.duration} time={time} fps={fps} selected={selected} disabled={saving} onSeek={seek} onSelect={select} onMove={move} />
        <div className="section-transport">
          <p className={`section-editor-message ${message ? 'has-message' : ''}`} role="status">{message || `Section ${preview.index + 1} · ${timeLabel(preview.start)} – ${timeLabel(preview.end)}`}</p>
          <div className="section-play-controls">
            <button className="studio-icon" aria-label="Previous frame" disabled={saving} onClick={() => seek(time - 1 / fps)}>
              <ChevronLeft size={19} />
            </button>
            <button className="section-play-button" title="Play the highlighted section from the blue playhead" aria-label={state.playing ? 'Pause preview' : 'Play preview'} disabled={saving} onClick={play}>{state.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
            <button className="studio-icon" aria-label="Next frame" disabled={saving} onClick={() => seek(time + 1 / fps)}>
              <ChevronRight size={19} />
            </button>
          </div>
          <button className="section-add-marker" disabled={saving || !canAdd} onClick={add} title={canAdd ? 'Add marker at the blue playback line · M' : 'Move the blue line inside a section to add a marker'}>
            <Plus size={18} />Add marker<span className="marker-shortcut">M</span>
          </button>
        </div>
      </footer>
    </div>
  </section>;
}
