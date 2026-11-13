/**
 * Phase 2 developer harness: an isolated route for exercising the shared document,
 * occurrence selection, commands and history.
 *
 * Deliberately not part of the review workflow: it loads the same draft through the
 * same API, but writes nothing. The ordinary review route is untouched.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {assetUrl, request} from '../../api';
import {parseMusicDraftView} from '../../../../../packages/lesson-schema/parse';
import {
  buildNotation, selectionForOccurrence,
  type CorrectionSelection, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import {KeyboardEditor} from '../notation/KeyboardEditor';
import {PianoRoll} from '../notation/PianoRoll';
import {SheetMusic} from '../notation/SheetMusic';
import {NotationAudio} from '../notation/notation-audio';
import {
  createWorkspaceState, historySummary, workspaceReducer, workspaceStatus,
  type WorkspaceAction, type WorkspaceState,
} from './workspace-state';

const DURATION_CHOICES = [
  {label: 'Whole', ticks: 1920},
  {label: 'Half', ticks: 960},
  {label: 'Quarter', ticks: 480},
  {label: 'Eighth', ticks: 240},
  {label: '16th', ticks: 120},
];

const SNAP_CHOICES = [
  {label: 'Off', ticks: 0},
  {label: '1/4', ticks: 480},
  {label: '1/8', ticks: 240},
  {label: '1/16', ticks: 120},
];

type Diff = {changed: number; added: number; removed: number; total: number; changedIds: Set<string>};

function diffAgainst(baseline: NotationDocument, current: NotationDocument): Diff {
  const before = new Map(baseline.performance.map(item => [item.id, item]));
  const after = new Map(current.performance.map(item => [item.id, item]));
  const changedIds = new Set<string>();
  let removed = 0;
  for (const [id, note] of before) {
    const next = after.get(id);
    if (!next) { removed += 1; continue; }
    if (next.pitch !== note.pitch || Math.abs(next.onset - note.onset) > 1e-9 || next.duration !== note.duration) changedIds.add(id);
  }
  let added = 0;
  for (const id of after.keys()) if (!before.has(id)) added += 1;
  return {changed: changedIds.size, added, removed, total: after.size, changedIds};
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
  return <label className="ws-field">
    <span>{label}</span>
    <input type="number" step={step} min={min} max={max} value={draft} disabled={disabled}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); } }}/>
  </label>;
}

export function PianoWorkspaceHarness() {
  const params = new URLSearchParams(location.search);
  const lessonId = params.get('id') ?? '';

  const [state, setState] = useState<WorkspaceState | null>(null);
  const [baseline, setBaseline] = useState<NotationDocument | null>(null);
  const [title, setTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [snapTicks, setSnapTicks] = useState(0);
  const [writtenScope, setWrittenScope] = useState<'note' | 'event'>('note');
  const [respellDraft, setRespellDraft] = useState('');
  const [notice, setNotice] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<NotationAudio | null>(null);

  const dispatch = useCallback((action: WorkspaceAction) => {
    setState(previous => (previous ? workspaceReducer(previous, action) : previous));
  }, []);

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError('');
    if (!lessonId) { setError('Add ?id=<lesson id> to the harness URL.'); setLoading(false); return; }
    request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-draft`)
      .then(value => {
        const parsed = parseMusicDraftView(value);
        if (!parsed.ok) throw new Error(parsed.message);
        if (stopped) return;
        const draft = parsed.value;
        const document = buildNotation(draft.events.map(event => ({
          id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
          velocity: event.velocity, confidence: event.confidence, optional: event.optional,
          string: event.string, fret: event.fret, notation_duration: event.notation_duration ?? null,
        })), {duration: draft.duration});
        setBaseline(document);
        setState(createWorkspaceState(document));
        setTitle(draft.title);
        setVideoUrl(draft.source_video ? assetUrl(draft.source_video.key) : null);
      })
      .catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : 'The draft could not be opened.'); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [lessonId]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setPlayhead(media.currentTime);
      if (!media.paused && !media.ended) frame = requestAnimationFrame(update);
    };
    const refresh = () => { if (frame) cancelAnimationFrame(frame); update(); };
    const events = ['play', 'pause', 'seeked', 'timeupdate', 'ended', 'loadedmetadata'];
    events.forEach(name => media.addEventListener(name, refresh));
    refresh();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      events.forEach(name => media.removeEventListener(name, refresh));
    };
  }, [videoUrl]);

  useEffect(() => () => { audioRef.current?.dispose(); }, []);

  const audition = useCallback((pitches: number[], seconds = 0.5) => {
    if (!pitches.length) return;
    audioRef.current ??= new NotationAudio();
    audioRef.current.play(pitches, Math.max(0.12, Math.min(2, seconds)), 0.7);
  }, []);

  const seek = useCallback((seconds: number) => {
    const media = videoRef.current;
    const clamped = Math.max(0, Math.min(state?.document.duration ?? seconds, seconds));
    setPlayhead(clamped);
    if (media) media.currentTime = clamped;
  }, [state?.document.duration]);

  const select = useCallback((occurrenceId: string | null) => {
    if (occurrenceId) videoRef.current?.pause();
    setNotice('');
    dispatch({type: 'select', occurrenceId});
  }, [dispatch]);

  const document = state?.document ?? null;
  const selection = state?.selection ?? null;
  const selected = selection && document ? noteFacts(document, selection) : null;
  const secondsPerTick = document ? 60 / (document.tempo.bpm * document.ppq) : 0.0625;
  const diff = useMemo(() => (baseline && document ? diffAgainst(baseline, document) : null), [baseline, document]);

  const activePitches = useMemo(() => {
    if (!document) return [];
    return document.performance
      .filter(note => playhead >= note.onset && playhead < note.onset + (note.duration ?? 0.25))
      .map(note => note.pitch);
  }, [document, playhead]);

  const selectKey = useCallback((pitch: number) => {
    if (!document) return;
    const sounding = document.performance.filter(note => note.pitch === pitch
      && playhead >= note.onset && playhead < note.onset + (note.duration ?? 0.25));
    if (sounding.length === 1) { select(sounding[0].id); return; }
    if (sounding.length > 1) { setNotice(`${sounding.length} ${pitchName(pitch)} notes overlap here; use the roll to choose one.`); return; }
    setNotice(`No ${pitchName(pitch)} is sounding here. Audition only — select a note in the roll or score.`);
  }, [document, playhead, select]);

  if (loading) return <main className="ws-shell"><p role="status">Opening the draft…</p></main>;
  if (error) return <main className="ws-shell"><p role="alert" className="ws-error">{error}</p></main>;
  if (!document || !state) return <main className="ws-shell"><p role="status">No document.</p></main>;

  const snapSeconds = snapTicks ? snapTicks * secondsPerTick : null;
  const report = state.lastReport;
  const summary = historySummary(state);

  return <main className="ws-shell">
    <header className="ws-head">
      <div>
        <p className="ws-eyebrow">Developer harness · Phase 2 · writes nothing</p>
        <h1>{title || 'Piano correction workspace'}</h1>
        <p className="ws-sub">
          {document.performance.length} notes · {document.events.length} events · {document.measures.length} measures ·{' '}
          {document.tempo.bpm} BPM (estimated). Select one note in the roll, the score or the keyboard.
        </p>
      </div>
      <div className="ws-status">
        <strong>{workspaceStatus(state)}</strong>
        {diff && <span>{diff.changed} changed · {diff.added} added · {diff.removed} removed · {diff.total} total</span>}
        <span>{selection ? `Selected ${selection.occurrenceId}` : 'Nothing selected'}</span>
      </div>
    </header>

    <div className="ws-toolbar">
      <button type="button" onClick={() => dispatch({type: 'undo'})} disabled={!state.past.length}>Undo</button>
      <button type="button" onClick={() => dispatch({type: 'redo'})} disabled={!state.future.length}>Redo</button>
      <label className="ws-field ws-inline">
        <span>Snap</span>
        <select value={snapTicks} onChange={event => setSnapTicks(Number(event.target.value))}>
          {SNAP_CHOICES.map(choice => <option key={choice.label} value={choice.ticks}>{choice.label}</option>)}
        </select>
      </label>
      <span className="ws-time">{playhead.toFixed(2)} s / {document.duration.toFixed(2)} s</span>
      {report && <span className={report.status === 'rejected' ? 'ws-report is-bad' : 'ws-report'}>
        {report.status === 'rejected' ? report.message : report.label}
      </span>}
      {notice && <span className="ws-report">{notice}</span>}
    </div>

    <div className="ws-grid">
      <div className="ws-edit">
        <section className="ws-panel" aria-label="Keyboard">
          <KeyboardEditor document={document} selectedPitch={selected?.pitch ?? null} activePitches={activePitches}
            onKey={pitch => audition([pitch], 0.4)} onSelectKey={selectKey}
            toolbarHint="Tap to audition. With a note selected, tap a key to select that pitch at the playhead; it never edits a note."
            hint="Selection and audition only; use “Add note at playhead” in the inspector to insert."/>
        </section>

        <section className="ws-panel" aria-label="Piano roll">
          <PianoRoll document={document} selection={null} selectedOccurrenceId={selection?.occurrenceId ?? null}
            playhead={playhead} onSelect={() => {}} onSelectOccurrence={select}
            onPitchChange={() => {}} onMove={() => {}} onResize={() => {}} onSeek={seek}/>
          <p className="ws-hint">Click a note to select that occurrence. Dragging is not part of Phase 2.</p>
        </section>

        <section className="ws-panel" aria-label="Score">
          <SheetMusic document={document} selection={null} selectedOccurrenceId={selection?.occurrenceId ?? null}
            compact={false} focusMeasure={selection?.measureIndex ?? 0} zoom={1}
            onSelect={() => {}} onSelectOccurrence={select} onSelectRest={() => {}} onPitchChange={() => {}}/>
        </section>
      </div>

      <aside className="ws-side">
        <section className="ws-panel" aria-label="Reference video">
          {videoUrl
            ? <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" className="ws-video"/>
            : <p className="ws-hint">This draft has no source video.</p>}
        </section>

        <section className="ws-panel" aria-label="Selected note">
          <h2>Selected note</h2>
          {!selection || !selected
            ? <p className="ws-hint">Select a note in the roll, the score or the keyboard to edit it.</p>
            : <>
              <p className="ws-facts">
                <strong>{selected.spelling}</strong> · {selection.occurrenceId} · {pitchName(selected.pitch)} (MIDI {selected.pitch})<br/>
                {selected.onset.toFixed(3)} s · recorded {selected.duration === null ? 'unknown' : `${selected.duration.toFixed(3)} s`}<br/>
                {selection.staff} voice {selection.voice} · measure {selection.measureIndex + 1} · written {selected.writtenTicks} ticks
                {selected.linkedOccurrences > 1 && <> · <em>linked to {selected.linkedOccurrences} occurrences</em></>}
              </p>

              <div className="ws-row" role="group" aria-label="Pitch">
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: selection.occurrenceId, pitch: selected.pitch - 1}})}>− semitone</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: selection.occurrenceId, pitch: selected.pitch + 1}})}>+ semitone</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'apply-accidental', occurrenceId: selection.occurrenceId, accidental: 'sharp'}})}>♯</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'apply-accidental', occurrenceId: selection.occurrenceId, accidental: 'flat'}})}>♭</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'apply-accidental', occurrenceId: selection.occurrenceId, accidental: 'natural'}})}>♮</button>
              </div>

              <div className="ws-row" role="group" aria-label="Respell">
                <label className="ws-field ws-inline">
                  <span>Respell</span>
                  <input value={respellDraft} placeholder={selected.spelling} size={6}
                    onChange={event => setRespellDraft(event.target.value)}/>
                </label>
                <button type="button" disabled={!respellDraft.trim()}
                  onClick={() => { dispatch({type: 'command', command: {type: 'respell', occurrenceId: selection.occurrenceId, spelling: respellDraft.trim()}}); setRespellDraft(''); }}>
                  Apply spelling
                </button>
              </div>

              <div className="ws-row" role="group" aria-label="Written value scope">
                <span className="ws-hint">Written value for</span>
                <button type="button" aria-pressed={writtenScope === 'note'} className={writtenScope === 'note' ? 'is-active' : ''}
                  onClick={() => setWrittenScope('note')}>This note</button>
                <button type="button" aria-pressed={writtenScope === 'event'} className={writtenScope === 'event' ? 'is-active' : ''}
                  onClick={() => setWrittenScope('event')}>Whole event{selected.notesInEvent > 1 ? ` (${selected.notesInEvent} notes)` : ''}</button>
              </div>
              <div className="ws-row" role="group" aria-label="Written duration">
                {DURATION_CHOICES.map(choice => <button key={choice.label} type="button"
                  onClick={() => dispatch({type: 'command', command: writtenScope === 'note'
                    ? {type: 'set-written-duration', target: {logicalNoteId: selection.logicalNoteId}, ticks: choice.ticks, scope: 'note'}
                    : {type: 'set-written-duration', target: {eventId: selection.eventId}, ticks: choice.ticks, scope: 'event'}})}>
                  {choice.label}
                </button>)}
              </div>
              <p className="ws-hint">
                “This note” splits a chord member into its own voice if needed; “Whole event” rewrites every member's written value.
              </p>

              <NumberField label="Start (s)" value={selected.onset} min={0} max={document.duration} step={0.001}
                onCommit={value => { if (value !== null) dispatch({type: 'command', command: {type: 'set-occurrence-onset', occurrenceId: selection.occurrenceId, seconds: value, snapSeconds}}); }}/>
              <NumberField label="Recorded length (s)" value={selected.duration} min={0.001} max={document.duration} step={0.001}
                onCommit={value => { if (value !== null) dispatch({type: 'command', command: {type: 'set-occurrence-duration', occurrenceId: selection.occurrenceId, seconds: value}}); }}/>

              <label className="ws-field">
                <span>Velocity {selected.velocity === null ? '(unknown)' : `${Math.round(selected.velocity * 100)}%`}</span>
                <input type="range" min={0} max={1} step={0.01} value={selected.velocity ?? 0.7}
                  onChange={event => dispatch({type: 'command', command: {type: 'set-occurrence-velocity', occurrenceId: selection.occurrenceId, velocity: Number(event.target.value)}})}/>
              </label>

              <div className="ws-row" role="group" aria-label="Remove">
                <button type="button" onClick={() => { audition([selected.pitch], Math.min(1.2, selected.duration ?? 0.4)); }}>Audition</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'delete-occurrence', occurrenceId: selection.occurrenceId}})}>Delete note</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'delete-logical-note', logicalNoteId: selection.logicalNoteId}})}>Delete logical note</button>
              </div>
              <p className="ws-hint">
                Written value and recorded length are independent. Start uses exact seconds unless a Snap value is chosen.
              </p>
            </>}
        </section>

        <section className="ws-panel" aria-label="Insert">
          <h2>Insert</h2>
          <div className="ws-row">
            <button type="button" onClick={() => dispatch({type: 'command', command: {
              type: 'insert-note', pitch: selected?.pitch ?? 60, onsetSeconds: playhead, durationSeconds: 0.4,
            }})}>Add note at playhead</button>
            <button type="button" onClick={() => dispatch({type: 'command', command: {
              type: 'insert-note', pitch: selected?.pitch ?? 60, onsetSeconds: playhead, durationSeconds: 0.4, addToChord: true,
            }})}>Add to chord</button>
          </div>
          <p className="ws-hint">Insertion is rejected when it would overwrite or collide. “Add to chord” only joins an identical written position.</p>
        </section>

        <section className="ws-panel" aria-label="History">
          <h2>History</h2>
          <p className="ws-hint">
            {summary.undoSteps} undo step(s) · {summary.redoSteps} redoable ·{' '}
            {(summary.totalBytes / 1024).toFixed(1)} KB retained ({summary.undoBytes} B undo + {summary.redoBytes} B redo){' '}
            {summary.evicted ? '· oldest entries dropped' : ''}
          </p>
          <p className="ws-hint">History stores only the notes and events each edit changed; the score is rebuilt on undo.</p>
        </section>
      </aside>
    </div>
  </main>;
}

function noteFacts(document: NotationDocument, selection: CorrectionSelection) {
  const occurrence = document.performance.find(item => item.id === selection.occurrenceId);
  if (!occurrence) return null;
  const event = document.events.find(item => item.id === selection.eventId);
  const note = event?.notes.find(item => item.id === selection.logicalNoteId);
  const spelling = note?.spelling ?? pitchName(occurrence.pitch);
  return {
    pitch: occurrence.pitch,
    onset: occurrence.onset,
    duration: occurrence.duration,
    velocity: occurrence.velocity,
    spelling,
    writtenTicks: event?.duration ?? 0,
    notesInEvent: event?.notes.length ?? 1,
    linkedOccurrences: note?.performance_ids.length ?? 1,
  };
}

export default PianoWorkspaceHarness;

/** Re-exported so the controller and tests share one selection constructor. */
export {selectionForOccurrence};
