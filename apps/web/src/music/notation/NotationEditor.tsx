import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Download, Minus, Plus, Redo2, Trash2, Undo2} from 'lucide-react';
import {
  DURATION_BUTTONS, buildNotation, changeDuration, changeNoteStaff, changePitch, deleteEvent,
  deleteNote, deleteRest, findEvent, insertNote, insertRest, measureLabel, moveEvent, noteById,
  refreshNotation, respellAccidental, setKeySignature, setPerformanceDuration, setTempo, setTimeSignature, setVelocity,
  tieToNext, toMusicXML, untieLast, type EditorSelection, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {pitchName, type MusicReferenceEvent} from '../music-reference';
import {NotationAudio} from './notation-audio';
import {SheetMusic} from './SheetMusic';
import {PianoRoll} from './PianoRoll';
import {KeyboardEditor} from './KeyboardEditor';

type Props = {
  title: string;
  document: NotationDocument;
  onChange: (next: NotationDocument) => void;
  sourceVideoUrl?: string;
  disabled?: boolean;
  onNotice?: (message: string) => void;
};

type Snapshot = {document: NotationDocument; selection: EditorSelection | null};

const KEY_OPTIONS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];

function secondsPerTick(document: NotationDocument): number {
  return 60 / (document.tempo.bpm * document.ppq);
}

function NumberField({label, value, min, max, step, disabled, onCommit}: {
  label: string; value: number | null; min: number; max: number; step: number; disabled?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(Number(value.toFixed(4))));
  useEffect(() => { setDraft(value === null ? '' : String(Number(value.toFixed(4)))); }, [value]);
  const commit = () => {
    if (draft.trim() === '') { onCommit(null); return; }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) { setDraft(value === null ? '' : String(value)); return; }
    onCommit(Math.max(min, Math.min(max, parsed)));
  };
  return <label className="notation-field">
    <span>{label}</span>
    <input type="number" step={step} min={min} max={max} value={draft} disabled={disabled}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); } }}/>
  </label>;
}

function VelocityField({value, disabled, onCommit}: {value: number | null; disabled?: boolean; onCommit: (value: number | null) => void}) {
  const [draft, setDraft] = useState(value ?? 0.7);
  useEffect(() => { setDraft(value ?? 0.7); }, [value]);
  return <label className="notation-field">
    <span>Velocity <small>{Math.round(draft * 100)}%</small></span>
    <input type="range" min={0} max={1} step={0.01} value={draft} disabled={disabled}
      onChange={event => setDraft(Number(event.target.value))}
      onPointerUp={() => onCommit(draft)} onKeyUp={() => onCommit(draft)} onBlur={() => onCommit(draft)}/>
  </label>;
}

export function NotationEditor({title, document, onChange, sourceVideoUrl, disabled = false, onNotice}: Props) {
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [message, setMessage] = useState('');
  const [focusMeasure, setFocusMeasure] = useState(0);
  const [compact, setCompact] = useState(false);
  const [phonePreview, setPhonePreview] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [entryDuration, setEntryDuration] = useState(480);
  const [tab, setTab] = useState<'score' | 'roll' | 'keys'>('score');
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const documentRef = useRef(document);
  const audioRef = useRef<NotationAudio | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { documentRef.current = document; }, [document]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => () => { audioRef.current?.dispose(); }, []);
  useEffect(() => {
    if (!selection) return;
    const missingNote = selection.note_id !== null && !noteById(document, selection.note_id);
    const missingEvent = selection.event_id !== '' && !findEvent(document, selection.event_id);
    if (missingNote || missingEvent) setSelection(null);
  }, [document, selection]);

  const isCompact = compact || phonePreview;
  const selectedEvent = selection?.event_id ? findEvent(document, selection.event_id) : null;
  const selectedNote = selection?.note_id ? noteById(document, selection.note_id)?.note ?? null : null;
  const selectedPitch = selectedNote?.pitch ?? null;
  const selectedPitches = selectedEvent?.notes.map(note => note.pitch) ?? [];
  const activePitches = useMemo(() => document.performance
    .filter(note => playhead >= note.onset && playhead < note.onset + (note.duration && note.duration > 0 ? note.duration : 0.25))
    .map(note => note.pitch), [document.performance, playhead]);
  const selectedPerformance = selectedEvent
    ? selectedEvent.notes.flatMap(note => note.performance_ids)
      .map(id => document.performance.find(note => note.id === id))
      .filter((note): note is NonNullable<typeof note> => Boolean(note))
    : [];
  const performanceStart = selectedPerformance.length ? Math.min(...selectedPerformance.map(note => note.onset)) : null;
  const performanceLength = selectedPerformance.length
    ? Math.max(...selectedPerformance.map(note => note.duration ?? 0)) : null;
  const selectedVelocity = selectedNote
    ? selectedPerformance.find(note => selectedNote.performance_ids.includes(note.id))?.velocity ?? null
    : null;
  const spb = secondsPerTick(document);

  const audition = useCallback((pitches: number[], seconds = 0.6) => {
    if (!pitches.length) return;
    audioRef.current ??= new NotationAudio();
    audioRef.current.play(pitches, Math.max(0.12, Math.min(2, seconds)), 0.7);
  }, []);

  const commit = useCallback((next: NotationDocument, nextSelection: EditorSelection | null | undefined = undefined) => {
    if (next === documentRef.current) return;
    const previousDocument = documentRef.current;
    setPast(previous => [...previous.slice(-79), { document: previousDocument, selection }]);
    setFuture([]);
    documentRef.current = next;
    onChange(next);
    if (nextSelection !== undefined) setSelection(nextSelection);
  }, [onChange, selection]);

  const apply = useCallback((action: (current: NotationDocument) => NotationDocument, after?: (next: NotationDocument) => void) => {
    if (disabled) return;
    try {
      const next = action(documentRef.current);
      commit(next);
      setMessage('');
      after?.(next);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'That edit could not be applied.');
    }
  }, [commit, disabled]);

  const notice = (value: string) => { setMessage(value); onNotice?.(value); };

  const selectPlayable = useCallback((playable: {eventId: string; noteId: string; staff: 'treble' | 'bass'; measureIndex: number}) => {
    const event = playable.eventId ? findEvent(document, playable.eventId) : null;
    if (event) {
      const note = event.notes.find(item => item.id === playable.noteId) ?? null;
      setSelection({
        event_id: event.id, note_id: note?.id ?? null, segment_note_id: null, staff: event.staff,
        voice: event.voice, measure_index: playable.measureIndex, performance_ids: note ? [...note.performance_ids] : [],
        start: event.start, duration: event.duration,
      });
      setFocusMeasure(playable.measureIndex);
    }
  }, [document]);

  const selectRest = useCallback((rest: {event_id: string; staff: 'treble' | 'bass'; voice: 1 | 2; measure_index: number; start: number; duration: number}) => {
    setSelection({
      event_id: rest.event_id || '', note_id: null, segment_note_id: null, staff: rest.staff, voice: rest.voice,
      measure_index: rest.measure_index, performance_ids: [], start: rest.start, duration: rest.duration,
    });
    setFocusMeasure(rest.measure_index);
  }, []);

  const selectFromDocument = useCallback((score: NotationDocument, logicalNoteId: string): EditorSelection | null => {
    const found = noteById(score, logicalNoteId);
    if (!found) return null;
    const measure = score.measures.find(item => found.event.start >= item.start && found.event.start < item.start + item.duration);
    const next: EditorSelection = {
      event_id: found.event.id, note_id: found.note.id, segment_note_id: null, staff: found.event.staff,
      voice: found.event.voice, measure_index: measure?.index ?? 0, performance_ids: [...found.note.performance_ids],
      start: found.event.start, duration: found.event.duration,
    };
    setSelection(next);
    if (measure) setFocusMeasure(measure.index);
    return next;
  }, []);

  const selectRollNote = useCallback((logicalNoteId: string) => {
    selectFromDocument(document, logicalNoteId);
  }, [document, selectFromDocument]);

  const undo = useCallback(() => {
    if (!past.length || disabled) return;
    const currentDocument = documentRef.current;
    const snapshot = past[past.length - 1];
    setPast(previous => previous.slice(0, -1));
    setFuture(previous => [{ document: currentDocument, selection }, ...previous].slice(0, 80));
    documentRef.current = snapshot.document;
    onChange(snapshot.document);
    setSelection(snapshot.selection);
    setMessage('Undone.');
  }, [past, future, selection, disabled, onChange]);
  const redo = useCallback(() => {
    if (!future.length || disabled) return;
    const currentDocument = documentRef.current;
    const snapshot = future[0];
    setFuture(previous => previous.slice(1));
    setPast(previous => [...previous.slice(-79), { document: currentDocument, selection }]);
    documentRef.current = snapshot.document;
    onChange(snapshot.document);
    setSelection(snapshot.selection);
    setMessage('Redone.');
  }, [future, selection, disabled, onChange]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  const seek = useCallback((seconds: number) => {
    const next = Math.max(0, Math.min(document.duration, seconds));
    setPlayhead(next);
    if (videoRef.current) videoRef.current.currentTime = next;
  }, [document.duration]);

  const playFromSelection = useCallback(() => {
    const linked = (selection?.performance_ids ?? [])
      .map(id => document.performance.find(note => note.id === id))
      .filter((note): note is NonNullable<typeof note> => Boolean(note));
    const start = linked.length ? Math.min(...linked.map(note => note.onset)) : (selectedEvent ? selectedEvent.start * spb : playhead);
    seek(start);
    if (videoRef.current && sourceVideoUrl) {
      void videoRef.current.play().catch(() => setMessage('The video could not start. Press play again.'));
    } else {
      audition(selectedPitches.length ? selectedPitches : selectedPitch !== null ? [selectedPitch] : []);
      setMessage(`Auditioning from ${start.toFixed(2)}s.`);
    }
  }, [selection, document.performance, selectedEvent, spb, playhead, seek, sourceVideoUrl, audition, selectedPitches, selectedPitch]);

  const togglePlay = () => {
    if (!videoRef.current || !sourceVideoUrl) { playFromSelection(); return; }
    if (videoRef.current.paused) void videoRef.current.play().catch(() => setMessage('The video could not start.')); else videoRef.current.pause();
  };

  const setDuration = (ticks: number) => {
    setEntryDuration(ticks);
    if (selection?.event_id && selectedEvent) {
      apply(current => changeDuration(current, selectedEvent.id, ticks), () => audition(selectedPitches, Math.min(2, ticks * spb)));
    } else if (selection && !selection.event_id && selection.start !== undefined) {
      apply(current => insertRest(current, { start: selection.start!, duration: ticks, staff: selection.staff, voice: selection.voice }));
    }
  };

  const addNoteAtPlayhead = () => {
    const pitch = selectedPitch ?? 60;
    const start = Math.round(playhead / spb / 120) * 120;
    apply(current => insertNote(current, {pitch, start, duration: entryDuration, staff: pitch >= current.staff_split_pitch ? 'treble' : 'bass', voice: 1}), next => {
      const note = next.events.flatMap(event => event.notes)
        .find(item => item.performance_ids.some(id => id.startsWith('authored-')));
      if (note) selectFromDocument(next, note.id);
      audition([pitch], entryDuration * spb);
    });
  };

  const deleteSelection = () => {
    if (!selection) return;
    if (selectedNote) apply(current => deleteNote(current, selectedNote.id), () => setSelection(null));
    else if (selectedEvent?.rest) apply(current => deleteRest(current, selectedEvent.id), () => setSelection(null));
    else if (selectedEvent) apply(current => deleteEvent(current, selectedEvent.id), () => setSelection(null));
    else if (selection.start !== undefined) apply(current => insertRest(current, {start: selection.start!, duration: selection.duration ?? entryDuration, staff: selection.staff, voice: selection.voice}));
  };

  const changeSelectedPitch = (pitch: number) => {
    if (!selectedNote) { addNoteAtPlayhead(); return; }
    apply(current => changePitch(current, selectedNote.id, pitch), () => audition([pitch], 0.5));
  };

  const accidentalStep = (direction: 1 | -1) => {
    if (!selectedNote) return;
    const pitch = Math.max(0, Math.min(127, selectedNote.pitch + direction));
    if (pitch === selectedNote.pitch) return;
    apply(current => changePitch(current, selectedNote.id, pitch), () => audition([pitch], 0.5));
  };

  const onKeyboard = (pitch: number, auditionOnly: boolean) => {
    audition([pitch], 0.45);
    if (auditionOnly || !selectedNote) {
      if (!auditionOnly && !selectedNote) {
        const start = Math.round(playhead / spb / 120) * 120;
        apply(current => insertNote(current, {pitch, start, duration: entryDuration, staff: pitch >= current.staff_split_pitch ? 'treble' : 'bass', voice: 1}), next => {
          const note = next.events.flatMap(event => event.notes)
            .find(item => item.performance_ids.some(id => id.startsWith('authored-')));
          if (note) selectFromDocument(next, note.id);
        });
      }
      return;
    }
    changeSelectedPitch(pitch);
  };

  const exportXml = () => {
    try {
      const xml = toMusicXML(document, { title });
      const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `${(title || 'piano-lesson').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 60)}.musicxml`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      notice('MusicXML exported. Open it in another notation editor to check the result.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'MusicXML export failed.');
    }
  };

  const measureCount = document.measures.length;
  const noteCount = document.events.reduce((total, event) => total + event.notes.length, 0);
  const restCount = document.segments.filter(segment => segment.rest).length;
  const source = sourceVideoUrl ?? '';

  return <section className="notation-editor" aria-label="Editable sheet music">
    <header className="notation-head">
      <div>
        <h2>Sheet music</h2>
        <p className="small muted">{measureCount} measures · {noteCount} notes · {restCount} rests · {document.ties.length} ties.
          Notes keep their exact transcription seconds; notation is an interpretation you can correct.</p>
      </div>
      <div className="notation-head-actions">
        <button type="button" className="secondary" onClick={() => { setPhonePreview(value => !value); }} aria-pressed={phonePreview}>
          {phonePreview ? 'Exit phone view' : 'Phone view'}
        </button>
        <button type="button" className="secondary" onClick={exportXml}><Download size={14}/>MusicXML</button>
      </div>
    </header>
    {message && <p className="inline-notice" role="status">{message}</p>}
    <div className="notation-video">
      {source
        ? <video ref={videoRef} src={source} controls playsInline preload="metadata"
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onTimeUpdate={event => setPlayhead(event.currentTarget.currentTime)}/>
        : <p className="small muted">The instructor video is unavailable. Use the audition controls to hear edits.</p>}
      <div className="notation-video-actions">
        <button type="button" className="secondary" onClick={togglePlay}>{playing ? 'Pause' : 'Play video'}</button>
        <button type="button" className="secondary" onClick={playFromSelection} disabled={!selection}>Play from selected note</button>
        <span className="small muted">Source time {playhead.toFixed(2)}s / {document.duration.toFixed(2)}s</span>
      </div>
    </div>

    <div className="notation-toolbar" role="toolbar" aria-label="Score editing controls">
      <div className="notation-tool-group">
        <span className="notation-tool-label">Duration</span>
        {DURATION_BUTTONS.map(item => <button type="button" key={`${item.value}-${item.ticks}`}
          className={entryDuration === item.ticks ? 'is-active' : ''} disabled={disabled}
          aria-pressed={entryDuration === item.ticks} onClick={() => setDuration(item.ticks)}>{item.label}</button>)}
      </div>
      <div className="notation-tool-group">
        <span className="notation-tool-label">Accidental</span>
        <button type="button" disabled={disabled || !selectedNote} onClick={() => accidentalStep(1)} aria-label="Sharp, raise one semitone">♯</button>
        <button type="button" disabled={disabled || !selectedNote} onClick={() => accidentalStep(-1)} aria-label="Flat, lower one semitone">♭</button>
        <button type="button" disabled={disabled || !selectedNote} onClick={() => apply(current => respellAccidental(current, selectedNote!.id, 'natural'))} aria-label="Natural spelling">♮</button>
      </div>
      <div className="notation-tool-group">
        <span className="notation-tool-label">Edit</span>
        <button type="button" disabled={disabled} onClick={addNoteAtPlayhead}>Add note</button>
        <button type="button" disabled={disabled} onClick={() => apply(current => insertRest(current, {
          start: Math.round(playhead / spb / 120) * 120, duration: entryDuration,
          staff: (selectedPitch ?? 60) >= document.staff_split_pitch ? 'treble' : 'bass', voice: 1,
        }))}>Add rest</button>
        <button type="button" disabled={disabled || !selectedNote} onClick={() => apply(current => tieToNext(current, selectedNote!.id))}>Tie</button>
        <button type="button" disabled={disabled || !selectedEvent} onClick={() => apply(current => untieLast(current, selectedEvent!.id))}>Untie</button>
        <button type="button" disabled={disabled || !selection} onClick={deleteSelection} aria-label="Delete selected note or rest"><Trash2 size={14}/>Delete</button>
        <button type="button" disabled={disabled || !selectedNote || !selectedEvent}
          onClick={() => apply(current => changeNoteStaff(current, selectedNote!.id, selectedEvent?.staff === 'treble' ? 'bass' : 'treble'))}>
          {selectedEvent?.staff === 'treble' ? 'To bass' : 'To treble'}
        </button>
      </div>
      <div className="notation-tool-group">
        <span className="notation-tool-label">History</span>
        <button type="button" disabled={disabled || !past.length} onClick={undo} aria-label="Undo"><Undo2 size={14}/>Undo</button>
        <button type="button" disabled={disabled || !future.length} onClick={redo} aria-label="Redo"><Redo2 size={14}/>Redo</button>
      </div>
      <div className="notation-tool-group">
        <span className="notation-tool-label">View</span>
        <button type="button" onClick={() => setZoom(value => Math.max(0.7, value - 0.1))} aria-label="Zoom out"><Minus size={14}/></button>
        <span className="notation-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(value => Math.min(1.6, value + 0.1))} aria-label="Zoom in"><Plus size={14}/></button>
      </div>
    </div>

    {isCompact && <div className="notation-tabs" role="tablist" aria-label="Editor view">
      {(['score', 'roll', 'keys'] as const).map(item => <button key={item} type="button" role="tab" aria-selected={tab === item}
        className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item === 'score' ? 'Score' : item === 'roll' ? 'Piano roll' : 'Keyboard'}</button>)}
    </div>}

    {isCompact && <div className="notation-measure-nav">
      <button type="button" disabled={focusMeasure <= 0} onClick={() => setFocusMeasure(value => Math.max(0, value - 1))}>Previous measure</button>
      <span>{measureLabel(document, Math.min(focusMeasure, measureCount - 1))}</span>
      <button type="button" disabled={focusMeasure >= measureCount - 1} onClick={() => setFocusMeasure(value => Math.min(measureCount - 1, value + 1))}>Next measure</button>
    </div>}

    <div className="notation-workspace">
      <div className="notation-main">
        {(!isCompact || tab === 'score') && <SheetMusic document={document} selection={selection} compact={isCompact}
          focusMeasure={Math.min(focusMeasure, measureCount - 1)} zoom={zoom}
          onSelect={selectPlayable} onSelectRest={selectRest}
          onPitchChange={(noteId, pitch) => apply(current => changePitch(current, noteId, pitch), () => audition([pitch], 0.45))}/>}
        <div className="notation-lower">
          {(!isCompact || tab === 'roll') && <PianoRoll document={document} selection={selection} playhead={playhead}
            onSelect={selectRollNote} onPitchChange={(noteId, pitch) => apply(current => changePitch(current, noteId, pitch), () => audition([pitch], 0.45))}
            onMove={(eventId, start) => apply(current => moveEvent(current, eventId, start))}
            onResize={(eventId, duration) => apply(current => changeDuration(current, eventId, duration))}
            onSeek={seek}/>}
          {(!isCompact || tab === 'keys') && <KeyboardEditor document={document} selectedPitch={selectedPitch} activePitches={activePitches} onKey={onKeyboard}/>}
        </div>
      </div>
      <aside className="notation-inspector" aria-label="Selected note details">
        <h3>{selectedNote ? selectedNote.spelling : selectedEvent?.rest ? 'Rest' : selection ? 'Rest / gap' : 'Nothing selected'}</h3>
        {!selection && <p className="small muted">Tap a notehead in the score, a note in the piano roll or a piano key. A selected note shows its exact performance values and notation controls here.</p>}
        {selection && <>
          {selectedEvent && selectedEvent.notes.length > 1 && <div className="notation-chord-list" role="group" aria-label="Notes in this chord">
            <span className="small muted">Chord notes</span>
            {selectedEvent.notes.map(note => <button key={note.id} type="button" className={selectedNote?.id === note.id ? 'is-active' : ''}
              onClick={() => selectRollNote(note.id)}>{note.spelling}</button>)}
          </div>}
          <dl className="notation-selection-facts">
            <div><dt>Measure</dt><dd>{(selection.measure_index ?? 0) + 1} / {measureCount}</dd></div>
            <div><dt>Staff</dt><dd>{selection.staff}</dd></div>
            <div><dt>Voice</dt><dd>{selection.voice}</dd></div>
            <div><dt>Written</dt><dd>{selectedEvent ? `${(selectedEvent.duration / document.ppq).toFixed(2)} beats` : 'rest'}</dd></div>
            <div><dt>Ties</dt><dd>{selectedNote ? document.ties.filter(tie => tie.pitch === selectedNote.pitch).length : 0}</dd></div>
          </dl>
          {selectedNote && <div className="notation-step-buttons" role="group" aria-label="Pitch step controls">
            <button type="button" disabled={disabled || selectedPitch === null || selectedPitch <= 0}
              onClick={() => changeSelectedPitch(Math.max(0, (selectedPitch ?? 0) - 1))}>− semitone</button>
            <button type="button" disabled={disabled || selectedPitch === null || selectedPitch >= 127}
              onClick={() => changeSelectedPitch(Math.min(127, (selectedPitch ?? 0) + 1))}>+ semitone</button>
            <button type="button" disabled={disabled || selectedPitch === null || selectedPitch < 12}
              onClick={() => changeSelectedPitch(Math.max(0, (selectedPitch ?? 0) - 12))}>− octave</button>
            <button type="button" disabled={disabled || selectedPitch === null || selectedPitch > 115}
              onClick={() => changeSelectedPitch(Math.min(127, (selectedPitch ?? 0) + 12))}>+ octave</button>
          </div>}
          {selectedNote && <>
            <NumberField label="Performance start (s)" value={selectedEvent ? performanceStart : null} min={0} max={document.duration} step={0.01}
              disabled={disabled} onCommit={value => { if (value !== null && selectedEvent) apply(current => moveEvent(current, selectedEvent.id, Math.round(value / spb / 120) * 120)); }}/>
            <NumberField label="Performance length (s)" value={performanceLength} min={0.01} max={Math.max(0.01, document.duration - (performanceStart ?? 0))} step={0.01}
              disabled={disabled} onCommit={value => { if (value !== null && selectedNote) apply(current => setPerformanceDuration(current, selectedNote.id, value)); }}/>
            <VelocityField value={selectedVelocity}
              disabled={disabled} onCommit={value => apply(current => setVelocity(current, selectedNote.id, value))}/>
            <p className="small muted">Start is the video-relative performance time. Changing it moves the note in the piano roll and score while keeping the source video unchanged.</p>
          </>}
          <div className="notation-inspector-actions">
            <button type="button" className="primary" onClick={playFromSelection}>Play from this note</button>
            <button type="button" className="secondary" disabled={disabled || !selectedNote} onClick={() => apply(current => deleteNote(current, selectedNote!.id), () => setSelection(null))}>Delete note</button>
            <button type="button" className="secondary" disabled={disabled || !selectedEvent}
              onClick={() => apply(current => selectedEvent!.rest ? deleteRest(current, selectedEvent!.id) : deleteEvent(current, selectedEvent!.id), () => setSelection(null))}>
              {selectedEvent?.rest ? 'Delete rest (close gap)' : 'Delete chord'}
            </button>
          </div>
        </>}
        <details className="notation-settings">
          <summary>Score settings</summary>
          <label className="notation-field"><span>Tempo (BPM)</span>
            <input type="number" min={20} max={300} value={document.tempo.bpm} disabled={disabled}
              onChange={event => { const bpm = Number(event.target.value); if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 300) apply(current => setTempo(current, bpm)); }}/>
          </label>
          <label className="notation-field"><span>Time signature</span>
            <select value={`${document.time_signature.numerator}/${document.time_signature.denominator}`} disabled={disabled}
              onChange={event => { const [numerator, denominator] = event.target.value.split('/').map(Number); apply(current => setTimeSignature(current, numerator, denominator as 1 | 2 | 4 | 8 | 16)); }}>
              {['4/4', '3/4', '2/4', '6/8', '2/2'].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="notation-field"><span>Key signature</span>
            <select value={document.key_signature} disabled={disabled} onChange={event => apply(current => setKeySignature(current, event.target.value))}>
              {KEY_OPTIONS.map(key => <option key={key} value={key}>{key}</option>)}
            </select>
          </label>
          <label className="notation-field"><span>Treble/bass default split</span>
            <input type="number" min={0} max={127} value={document.staff_split_pitch} disabled={disabled}
              onChange={event => { const pitch = Number(event.target.value); if (Number.isInteger(pitch) && pitch >= 0 && pitch <= 127) apply(current => { const next = structuredClone(current); next.staff_split_pitch = pitch; return refreshNotation(next); }); }}/>
          </label>
          <p className="small muted">Tempo changes score playback and the editable grid. It does not move the source video: “Play from this note” always uses the reviewed performance seconds. Staff split affects new notes; use To treble/To bass to move existing ones.</p>
        </details>
      </aside>
    </div>
  </section>;
}

/** Build a fresh notation document for a lesson that predates the notation field. */
export function createNotation(events: MusicReferenceEvent[], duration: number, bpm?: number): NotationDocument {
  return buildNotation(events.map(event => ({
    id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch, velocity: event.velocity,
    confidence: event.confidence, optional: event.optional, string: event.string, fret: event.fret,
  })), { duration, bpm });
}

export default NotationEditor;
