/**
 * Developer harness for the correction workspace.
 *
 * Phase 3: the readable layout — keyboard above a ten-second time roll, a continuous
 * horizontally scrollable grand staff below, a whole-clip overview, and the smaller
 * reference video and inspector alongside. Isolated from the review workflow; it
 * loads the same draft through the same API and writes nothing.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {assetUrl, request} from '../../api';
import {parseMusicDraftView} from '../../../../../packages/lesson-schema/parse';
import {
  buildNotation, selectionForOccurrence,
  activeOccurrenceIds, alignmentFromSpans, effectiveSecondsToTick, occurrenceIntervals,
  applyAnchors, scoreClock, secondsToTick, tickToEffectiveSeconds, tickToSeconds, type AnchorPoint,
  type Alignment, type CorrectionSelection, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import {KeyboardEditor} from '../notation/KeyboardEditor';
import {NotationAudio} from '../notation/notation-audio';
import {usePianoSourcePlayer} from '../usePianoSourcePlayer';
import {ClipOverview} from './ClipOverview';
import {ContinuousScore} from './ContinuousScore';
import {TimeRoll} from './TimeRoll';
import {
  clampTimeWindow, DEFAULT_SPAN_SECONDS, layoutMeasures, zoomAround, type TimeWindow,
} from './viewport';import {
  createWorkspaceState, historySummary, workspaceReducer, workspaceStatus,
  type WorkspaceAction, type WorkspaceState,
} from './workspace-state';
import {useElementWidth} from './useElementWidth';
import {createClock, useClockTime, type ClockStore} from './clock';

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
  const [window, setWindow] = useState<TimeWindow>({start: 0, span: DEFAULT_SPAN_SECONDS});
  const [spans, setSpans] = useState<{ start: number; end: number; kind: 'playing' | 'explanation' }[]>([]);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [scoreTarget, setScoreTarget] = useState<{ tick: number; token: number } | null>(null);
  const [anchors, setAnchors] = useState<AnchorPoint[]>([]);
  const [anchorPast, setAnchorPast] = useState<AnchorPoint[][]>([]);
  const [anchorFuture, setAnchorFuture] = useState<AnchorPoint[][]>([]);
  const [anchorTick, setAnchorTick] = useState('');
  const [anchorPreview, setAnchorPreview] = useState('');
  const linkToken = useRef(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pianoRef = useRef<HTMLAudioElement>(null);
  const audioRef = useRef<NotationAudio | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIdentity, setPreviewIdentity] = useState('');
  const [audioMode, setAudioMode] = useState<'original' | 'piano'>('original');
  const [keyboardRef, keyboardWidth] = useElementWidth<HTMLDivElement>();
  const compactKeyboard = keyboardWidth > 0 && keyboardWidth < 720;
  const [rollReveal, setRollReveal] = useState<{occurrenceId: string; token: number} | null>(null);
  const [scoreReveal, setScoreReveal] = useState<{tick: number; token: number} | null>(null);
  const revealToken = useRef(0);
  const clockRef = useRef(createClock());

  const dispatch = useCallback((action: WorkspaceAction) => {
    setState(previous => (previous ? workspaceReducer(previous, action) : previous));
  }, []);

  const document = state?.document ?? null;

  /** A navigation request: bumped only by a selection change or an explicit Reveal. */
  const requestReveal = useCallback((occurrenceId: string) => {
    if (!document) return;
    revealToken.current += 1;
    const token = revealToken.current;
    setRollReveal({occurrenceId, token});
    const tick = document.events
      .find(event => event.notes.some(note => note.performance_ids.includes(occurrenceId)))?.start;
    if (tick !== undefined) setScoreReveal({tick, token});
  }, [document]);

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError('');
    const demo = params.get('demo');
    if (demo === 'explanation' || demo === 'arpeggio') {
      // A local fixture for cases the real recording does not contain: an arpeggiated
      // chord, a spoken explanation passage and a held score cursor.
      const events = demo === 'explanation'
        ? [
            {id: 'd-1', onset: 1.0, duration: 0.6, pitch: 60},
            {id: 'd-2', onset: 2.0, duration: 0.6, pitch: 62},
            {id: 'd-3', onset: 2.045, duration: 0.6, pitch: 66},
            {id: 'd-4', onset: 2.09, duration: 0.6, pitch: 69},
            {id: 'd-5', onset: 8.0, duration: 0.6, pitch: 72},
            {id: 'd-6', onset: 9.0, duration: 0.6, pitch: 64},
          ]
        : [
            {id: 'd-1', onset: 2.0, duration: 0.6, pitch: 62},
            {id: 'd-2', onset: 2.045, duration: 0.6, pitch: 66},
            {id: 'd-3', onset: 2.09, duration: 0.6, pitch: 69},
          ];
      const demoSpans = demo === 'explanation'
        ? [{start: 0, end: 4, kind: 'playing' as const}, {start: 4, end: 7, kind: 'explanation' as const}, {start: 7, end: 12, kind: 'playing' as const}]
        : [{start: 0, end: 12, kind: 'playing' as const}];
      const demoClock = scoreClock(demoSpans, 12);
      const document = buildNotation(events.map(event => ({
        ...event, velocity: 0.6, confidence: null, optional: false, string: null, fret: null,
      })), {
        bpm: 120, duration: 12,
        scoreSeconds: note => demoClock.toScore(note.onset),
        scoreDuration: demoClock.scoreDuration,
      });
      setBaseline(document);
      setState(createWorkspaceState(document));
      setTitle(demo === 'explanation' ? 'Fixture: explanation passage' : 'Fixture: arpeggiated chord');
      setSpans(demoSpans);
      setVideoUrl(null);
      setLoading(false);
      return () => { stopped = true; };
    }
    if (!lessonId) { setError('Add ?id=<lesson id> to the harness URL.'); setLoading(false); return; }
    request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-draft`)
      .then(value => {
        const parsed = parseMusicDraftView(value);
        if (!parsed.ok) throw new Error(parsed.message);
        if (stopped) return;
        const draft = parsed.value;
        const draftSpans = draft.spans.map(span => ({start: span.start, end: span.end, kind: span.kind}));
        const clock = scoreClock(draftSpans, draft.duration);
        const document = buildNotation(draft.events.map(event => ({
          id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
          velocity: event.velocity, confidence: event.confidence, optional: event.optional,
          string: event.string, fret: event.fret, notation_duration: event.notation_duration ?? null,
        })), {
          duration: draft.duration,
          scoreSeconds: note => clock.toScore(note.onset),
          scoreDuration: clock.scoreDuration,
        });
        setBaseline(document);
        setState(createWorkspaceState(document));
        setTitle(draft.title);
        setSpans(draft.spans.map(span => ({start: span.start, end: span.end, kind: span.kind})));
        setOffsetSeconds(draft.playback?.sync_offset_seconds ?? 0);
        setVideoUrl(draft.source_video ? assetUrl(draft.source_video.key) : null);
        setPreviewUrl(draft.piano_preview ? assetUrl(draft.piano_preview.key) : null);
        setPreviewIdentity(draft.preview_identity ?? '');
      })
      .catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : 'The draft could not be opened.'); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [lessonId]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    let frame = 0;
    let lastState = 0;
    const update = (force = false) => {
      frame = 0;
      // The visual clock is mirrored every frame; only the low-frequency state the
      // inspector reads is throttled, so cursor layers stay frame-accurate.
      clockRef.current.set(media.currentTime);
      const now = performance.now();
      if (force || now - lastState >= 250) {
        lastState = now;
        setPlayhead(media.currentTime);
        setPlaying(!media.paused && !media.ended);
      }
      if (!media.paused && !media.ended) frame = requestAnimationFrame(() => update());
    };
    const refresh = () => { if (frame) cancelAnimationFrame(frame); update(true); };
    const events = ['play', 'pause', 'seeked', 'timeupdate', 'ended', 'loadedmetadata'];
    events.forEach(name => media.addEventListener(name, refresh));
    refresh();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      events.forEach(name => media.removeEventListener(name, refresh));
    };
  }, [videoUrl]);

  useEffect(() => () => { audioRef.current?.dispose(); }, []);

  // The existing source-driven controller: one clock, Piano mapped to it, never free-running.
  const player = usePianoSourcePlayer(videoRef, pianoRef, audioMode, offsetSeconds, previewIdentity,
    () => setNotice('Piano audio is unavailable. The original video keeps playing.'));

  // Audition yields to real playback and to a source-mode change.
  useEffect(() => { if (player.playing) audioRef.current?.stop(); }, [player.playing]);
  useEffect(() => { audioRef.current?.stop(); }, [audioMode]);

  const audition = useCallback((pitches: number[], seconds = 0.5) => {
    if (!pitches.length) return;
    audioRef.current ??= new NotationAudio();
    audioRef.current.play(pitches, Math.max(0.12, Math.min(2, seconds)), 0.7);
  }, []);

  const seek = useCallback((seconds: number) => {
    const media = videoRef.current;
    const clamped = Math.max(0, Math.min(state?.document.duration ?? seconds, seconds));
    setPlayhead(clamped);
    clockRef.current.set(clamped);
    if (media) media.currentTime = clamped;
  }, [state?.document.duration]);

  const select = useCallback((occurrenceId: string | null) => {
    setNotice('');
    dispatch({type: 'select', occurrenceId});
    if (!occurrenceId) return;
    videoRef.current?.pause();
    // Clicking a note seeks to its exact effective onset, never a score approximation.
    const note = state?.document.performance.find(item => item.id === occurrenceId);
    if (note) seek(note.onset + offsetSeconds);
    requestReveal(occurrenceId);
  }, [dispatch, offsetSeconds, requestReveal, seek, state?.document]);

  const selection = state?.selection ?? null;
  const selected = selection && document ? noteFacts(document, selection) : null;
  const secondsPerTick = document ? 60 / (document.tempo.bpm * document.ppq) : 0.0625;
  const diff = useMemo(() => (baseline && document ? diffAgainst(baseline, document) : null), [baseline, document]);

  const boxes = useMemo(() => (document ? layoutMeasures(document).boxes : []), [document]);

  const baseAlignment = useMemo<Alignment | null>(
    () => (document ? alignmentFromSpans(document, spans) : null), [document, spans]);
  const anchored = useMemo(
    () => (document && baseAlignment ? applyAnchors(baseAlignment, document, anchors) : null),
    [document, baseAlignment, anchors]);
  const alignment = anchored?.alignment ?? baseAlignment;
  const intervals = useMemo(() => (document ? occurrenceIntervals(document, offsetSeconds) : []), [document, offsetSeconds]);
  const activeIds = useMemo(() => activeOccurrenceIds(intervals, playhead), [intervals, playhead]);
  const playheadTick = alignment ? effectiveSecondsToTick(alignment, playhead, offsetSeconds) : null;

  // Active highlighting and key selection use the same offset-aware intervals as
  // the roll and score, so the keyboard cannot light or select an unsounding note.
  const activePitches = useMemo(
    () => intervals.filter(interval => playhead >= interval.start && playhead < interval.end).map(interval => interval.pitch),
    [intervals, playhead]);

  const selectKey = useCallback((pitch: number) => {
    if (!document) return;
    const sounding = intervals.filter(interval => interval.pitch === pitch
      && playhead >= interval.start && playhead < interval.end);
    if (sounding.length === 1) { select(sounding[0].id); return; }
    if (sounding.length > 1) { setNotice(`${sounding.length} ${pitchName(pitch)} notes overlap here; use the roll to choose one.`); return; }
    setNotice(`No ${pitchName(pitch)} is sounding here. Audition only — select a note in the roll or score.`);
  }, [document, intervals, playhead, select]);

  // A selection that changes for any reason (click, undo, insert) requests one reveal.
  const selectionOccurrence = state?.selection?.occurrenceId ?? null;
  useEffect(() => {
    if (!selectionOccurrence) return;
    if (rollReveal?.occurrenceId === selectionOccurrence) return;
    requestReveal(selectionOccurrence);
  }, [selectionOccurrence, rollReveal?.occurrenceId, requestReveal]);

  // The roll opens at a readable window rather than fitting the whole recording.
  useEffect(() => {
    if (!document) return;
    setWindow(clampTimeWindow({start: 0, span: DEFAULT_SPAN_SECONDS}, document.duration));
  }, [document?.duration]);

  const changeWindow = useCallback((next: TimeWindow, origin: 'user' | 'reveal' | 'playback' = 'reveal') => {
    if (!document) return;
    const clamped = clampTimeWindow(next, document.duration);
    setWindow(clamped);
    if (origin === 'user') {
      // A manual pan suspends Follow and drives the score by musical position.
      setFollow(false);
      if (alignment) {
        linkToken.current += 1;
        setScoreTarget({tick: effectiveSecondsToTick(alignment, clamped.start, offsetSeconds), token: linkToken.current});
      }
    }
  }, [document, alignment, offsetSeconds]);

  const onScoreScroll = useCallback((tick: number) => {
    if (!document || !alignment) return;
    setFollow(false);
    linkToken.current += 1;
    setScoreTarget({tick, token: linkToken.current});
    setWindow(clampTimeWindow({start: tickToEffectiveSeconds(alignment, tick, offsetSeconds), span: window.span}, document.duration));
  }, [document, alignment, offsetSeconds, window.span]);

  const seekToTick = useCallback((tick: number) => {
    if (!alignment) return;
    seek(tickToEffectiveSeconds(alignment, tick, offsetSeconds));
  }, [alignment, offsetSeconds, seek]);

  const returnToPlayhead = useCallback(() => {
    if (!document || !alignment) return;
    setWindow(clampTimeWindow({start: playhead - window.span / 4, span: window.span}, document.duration));
    linkToken.current += 1;
    setScoreTarget({tick: playheadTick ?? 0, token: linkToken.current});
    setFollow(true);
  }, [document, alignment, playhead, playheadTick, window.span]);

  const toggleTransport = useCallback(() => {
    const media = videoRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => setNotice('The video could not start.'));
    else media.pause();
  }, []);

  const changeRate = useCallback((value: number) => {
    setRate(value);
    const media = videoRef.current;
    if (media) media.playbackRate = value;
  }, []);

  // Follow playback: edge-based scroll that keeps the cursor comfortably visible.
  useEffect(() => {
    if (!follow || !playing || !document) return;
    setWindow(current => {
      const lead = playhead - current.start;
      if (lead >= 0 && lead <= current.span * 0.75) return current;
      return clampTimeWindow({start: playhead - current.span * 0.25, span: current.span}, document.duration);
    });
  }, [playhead, follow, playing, document]);

  // The score follows the same clock by musical position.
  useEffect(() => {
    if (!follow || playheadTick === null) return;
    linkToken.current += 1;
    setScoreTarget({tick: playheadTick, token: linkToken.current});
  }, [playheadTick, follow]);

  // Keep the source clock's rate when the video (re)mounts.
  useEffect(() => {
    const media = videoRef.current;
    if (media) media.playbackRate = rate;
  }, [videoUrl, rate]);

  const zoom = useCallback((factor: number) => {
    if (!document) return;
    setWindow(current => {
      const anchor = playhead >= current.start && playhead <= current.start + current.span
        ? playhead
        : current.start + current.span / 2;
      return zoomAround(current, document.duration, factor, anchor);
    });
  }, [document, playhead]);

  /* --------------------------------------------------- alignment authoring */

  const storedPlayhead = Math.max(0, playhead - offsetSeconds);

  const commitAnchors = useCallback((next: AnchorPoint[]) => {
    if (!document || !baseAlignment) return;
    const check = applyAnchors(baseAlignment, document, next);
    if (check.problem) { setAnchorPreview(`Not applied: ${check.problem}`); return; }
    setAnchorPast(history => [...history.slice(-19), anchors]);
    setAnchorFuture([]);
    setAnchors(next);
    setAnchorPreview(next.length ? `Anchored at ${next.length} point(s).` : 'Reset to the estimated map.');
  }, [document, baseAlignment, anchors]);

  const useCurrentTick = useCallback(() => {
    if (!alignment) return;
    setAnchorTick(String(Math.max(0, secondsToTick(alignment, storedPlayhead))));
    setAnchorPreview('');
  }, [alignment, storedPlayhead]);

  const previewAnchor = useCallback(() => {
    if (!alignment) return;
    const tick = Number(anchorTick);
    if (!Number.isInteger(tick) || tick < 0) { setAnchorPreview('Enter a whole tick number.'); return; }
    setAnchorPreview(`Tick ${tick} currently maps to ${tickToSeconds(alignment, tick).toFixed(3)} s.`);
  }, [alignment, anchorTick]);

  const applyAnchorPoint = useCallback(() => {
    const tick = Number(anchorTick);
    if (!Number.isInteger(tick) || tick < 0) { setAnchorPreview('Enter a whole tick number.'); return; }
    commitAnchors([...anchors, {seconds: storedPlayhead, tick}]);
  }, [anchorTick, anchors, commitAnchors, storedPlayhead]);

  const undoAnchors = useCallback(() => {
    if (!anchorPast.length) return;
    const previous = anchorPast[anchorPast.length - 1];
    setAnchorPast(anchorPast.slice(0, -1));
    setAnchorFuture([anchors, ...anchorFuture].slice(0, 20));
    setAnchors(previous);
    setAnchorPreview('Anchor removed (undo).');
  }, [anchorPast, anchorFuture, anchors]);

  const redoAnchors = useCallback(() => {
    if (!anchorFuture.length) return;
    const [next, ...rest] = anchorFuture;
    setAnchorPast([...anchorPast.slice(-19), anchors]);
    setAnchorFuture(rest);
    setAnchors(next);
    setAnchorPreview('Anchor restored (redo).');
  }, [anchorPast, anchorFuture, anchors]);

  if (loading) return <main className="ws-shell"><p role="status">Opening the draft…</p></main>;
  if (error) return <main className="ws-shell"><p role="alert" className="ws-error">{error}</p></main>;
  if (!document || !state) return <main className="ws-shell"><p role="status">No document.</p></main>;

  const snapSeconds = snapTicks ? snapTicks * secondsPerTick : null;
  const report = state.lastReport;
  const summary = historySummary(state);

  return <main className="ws-shell">
    <header className="ws-head">
      <div>
        <p className="ws-eyebrow">Developer harness · Phase 4 · writes nothing</p>
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
      <button type="button" onClick={toggleTransport}>{playing ? 'Pause' : 'Play'}</button>
      <label className="ws-field ws-inline">
        <span>Rate</span>
        <select value={rate} onChange={event => changeRate(Number(event.target.value))}>
          {[0.5, 0.75, 1].map(value => <option key={value} value={value}>{value}×</option>)}
        </select>
      </label>
      <label className="ws-field ws-inline">
        <span><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)}/> Follow</span>
      </label>
      <button type="button" onClick={returnToPlayhead}>Return to playhead</button>
      <button type="button" onClick={() => dispatch({type: 'undo'})} disabled={!state.past.length}>Undo</button>
      <button type="button" onClick={() => dispatch({type: 'redo'})} disabled={!state.future.length}>Redo</button>
      <label className="ws-field ws-inline">
        <span>Snap</span>
        <select value={snapTicks} onChange={event => setSnapTicks(Number(event.target.value))}>
          {SNAP_CHOICES.map(choice => <option key={choice.label} value={choice.ticks}>{choice.label}</option>)}
        </select>
      </label>
      <label className="ws-field ws-inline">
        <span>Offset</span>
        <input type="number" step={0.01} min={-10} max={10} value={offsetSeconds} style={{width: 72}}
          aria-label="Sync offset in seconds (not saved)"
          onChange={event => setOffsetSeconds(Math.max(-10, Math.min(10, Number(event.target.value) || 0)))}/>
        <span className="ws-hint">s · not saved</span>
      </label>
      <div className="ws-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
        <span className="ws-window-label" data-window-span={window.span.toFixed(2)}>
          {window.span.toFixed(window.span < 10 ? 1 : 0)} s visible · from {window.start.toFixed(1)} s
        </span>
        <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom in">+</button>
      </div>
      <span className="ws-time">{playhead.toFixed(2)} s / {document.duration.toFixed(2)} s</span>
      {!videoUrl && <label className="ws-field ws-inline">
        <span>Fixture clock</span>
        <input type="range" min={0} max={document.duration} step={0.01} value={playhead}
          aria-label="Fixture clock"
          onChange={event => { const value = Number(event.target.value); setPlayhead(value); clockRef.current.set(value); setPlaying(false); }}/>
      </label>}
      <span className="ws-alignment" data-alignment-mode={alignment?.mode ?? 'none'} data-playhead-tick={playheadTick ?? ''}
        data-ticks-per-second={alignment ? Math.round((1 / secondsPerTick) * 1000) / 1000 : ''}>
        {alignment?.mode === 'anchored' ? 'Score alignment anchored' : 'Score alignment estimated'}
        {spans.length > 1 ? ` · ${spans.filter(span => span.kind === 'explanation').length} explanation passage(s)` : ''}
      </span>
      {report && <span className={report.status === 'rejected' ? 'ws-report is-bad' : 'ws-report'}>
        {report.status === 'rejected' ? report.message : report.label}
      </span>}
      {notice && <span className="ws-report">{notice}</span>}
    </div>

    <div className="ws-grid">
      <div className="ws-edit">
        <section className="ws-panel ws-surface" aria-label="Keyboard">
          <div ref={keyboardRef}>
            <LiveKeyboard document={document} clock={clockRef.current} intervals={intervals}
              selectedPitch={selected?.pitch ?? null}
              onKey={pitch => audition([pitch], 0.4)} onSelectKey={selectKey}
              width={compactKeyboard ? 640 : 1040} semitones={compactKeyboard ? 36 : 60}
              toolbarHint="Tap to audition. With a note selected, tap a key to select that pitch at the playhead; it never edits a note."
              hint="Selection and audition only; use “Add note at playhead” in the inspector to insert."/>
          </div>
        </section>

        <section className="ws-panel ws-surface" aria-label="Piano roll">
          <TimeRoll document={document} window={window} onWindowChange={next => changeWindow(next, 'reveal')}
            onWindowChangeOrigin={changeWindow}
            offsetSeconds={offsetSeconds} activeOccurrenceIds={activeIds}
            clock={clockRef.current} intervals={intervals}
            selectedOccurrenceId={selection?.occurrenceId ?? null}
            reveal={rollReveal}
            playhead={playhead} onSelect={select} onSeek={seek}/>
          <p className="ws-hint">Click a note to select that occurrence; click the ruler to seek. Scrolling never seeks. Dragging notes is Phase 6.</p>
        </section>

        <section className="ws-panel ws-surface" aria-label="Score">
          <ContinuousScore document={document} boxes={boxes} selectedOccurrenceId={selection?.occurrenceId ?? null}
            reveal={scoreReveal} onSelect={select}
            playheadTick={playheadTick} activeOccurrenceIds={activeIds}
            clock={clockRef.current} alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals}
            scrollTarget={scoreTarget} onSeekTick={seekToTick} onUserScroll={onScoreScroll}
            onAmbiguous={(logicalNoteId, occurrenceIds) => setNotice(
              `This written note maps ${occurrenceIds.length} occurrences; choose one in the roll (logical ${logicalNoteId}).`)}/>
          <p className="ws-hint">One continuous grand staff; the cursor is the mapped musical position. Click the ruler to seek, a notehead to select.</p>
        </section>

        <section className="ws-panel ws-surface" aria-label="Overview">
          <ClipOverview document={document} window={window} playhead={playhead}
            onWindowChange={next => changeWindow(next, 'user')}/>
        </section>
      </div>

      <aside className="ws-side">
        <section className="ws-panel" aria-label="Reference video">
          {videoUrl
            ? <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" className="ws-video"/>
            : <p className="ws-hint">This draft has no source video.</p>}
          {previewUrl ? <audio ref={pianoRef} src={previewUrl} preload="auto"/> : null}
          <div className="ws-row" role="group" aria-label="Source audio">
            <button type="button" aria-pressed={audioMode === 'original'}
              className={audioMode === 'original' ? 'is-active' : ''}
              onClick={() => setAudioMode('original')}>Original</button>
            <button type="button" aria-pressed={audioMode === 'piano'}
              className={audioMode === 'piano' ? 'is-active' : ''}
              disabled={!previewUrl}
              title={previewUrl ? 'Mapped piano preview' : 'No verified piano preview for this draft'}
              onClick={() => setAudioMode('piano')}>Piano</button>
            <span className="ws-hint">
              {previewUrl
                ? (player.error ? player.error : 'Piano preview follows the video clock; it never free-runs.')
                : 'No verified piano preview: Original audio only.'}
            </span>
          </div>
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
                <button type="button" onClick={() => requestReveal(selection.occurrenceId)}>Reveal in views</button>
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

        <section className="ws-panel" aria-label="Alignment">
          <h2>Alignment</h2>
          <p className="ws-hint" data-aligned={anchors.length > 0 ? 'true' : 'false'}>
            {anchors.length
              ? `Anchored from ${anchors.length} authored point(s); later pitch or velocity edits keep them.`
              : 'Estimated from the tempo and passages. Author an anchor to correct it.'}
          </p>
          <div className="ws-row">
            <button type="button" onClick={useCurrentTick}>Use current</button>
            <label className="ws-field ws-inline">
              <span>Tick</span>
              <input value={anchorTick} size={8} aria-label="Anchor tick"
                onChange={event => setAnchorTick(event.target.value)}/>
            </label>
            <button type="button" onClick={previewAnchor}>Preview</button>
            <button type="button" onClick={applyAnchorPoint}>Apply anchor</button>
          </div>
          <div className="ws-row">
            <button type="button" onClick={undoAnchors} disabled={!anchorPast.length}>Undo point</button>
            <button type="button" onClick={redoAnchors} disabled={!anchorFuture.length}>Redo point</button>
            <button type="button" onClick={() => commitAnchors([])} disabled={!anchors.length}>Reset</button>
          </div>
          {anchors.map((anchor, index) => <p className="ws-hint" key={`${anchor.seconds}-${anchor.tick}-${index}`}>
            {anchor.seconds.toFixed(3)} s → tick {anchor.tick}{' '}
            <button type="button" onClick={() => commitAnchors(anchors.filter((_, position) => position !== index))}>Remove</button>
          </p>)}
          {anchorPreview && <p className="ws-report">{anchorPreview}</p>}
          <p className="ws-hint">Anchors are local and unsaved until Phase 5. One or more applied points make the map “anchored”.</p>
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

/**
 * The keyboard lights keys from the frame-rate clock, so sounding pitches stay exact
 * without re-rendering the inspector around it.
 */
function LiveKeyboard({document, clock, intervals, selectedPitch, onKey, onSelectKey, width, semitones, toolbarHint, hint}: {
  document: NotationDocument;
  clock: ClockStore | null;
  intervals: { id: string; start: number; end: number; pitch: number }[];
  selectedPitch: number | null;
  onKey: (pitch: number, auditionOnly: boolean) => void;
  onSelectKey: (pitch: number) => void;
  width: number;
  semitones: number;
  toolbarHint: string;
  hint: string;
}) {
  const live = useClockTime(clock, 0);
  const activePitches = intervals
    .filter(interval => live >= interval.start && live < interval.end)
    .map(interval => interval.pitch);
  return <KeyboardEditor document={document} selectedPitch={selectedPitch} activePitches={activePitches}
    onKey={onKey} onSelectKey={onSelectKey} width={width} semitones={semitones}
    toolbarHint={toolbarHint} hint={hint}/>;
}

/** Re-exported so the controller and tests share one selection constructor. */
export {selectionForOccurrence};
