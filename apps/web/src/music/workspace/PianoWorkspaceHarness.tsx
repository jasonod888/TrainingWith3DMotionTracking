/**
 * Developer harness for the correction workspace.
 *
 * Phase 3: the readable layout — keyboard above a ten-second time roll, a continuous
 * horizontally scrollable grand staff below, a whole-clip overview, and the smaller
 * reference video and inspector alongside. Isolated from the review workflow; it
 * loads the same draft through the same API and writes nothing.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ApiError, assetUrl, getSession, request} from '../../api';
import {parseMusicDraftView} from '../../../../../packages/lesson-schema/parse';
import {
  applyCommand, buildNotation, parseNotationDocument, selectionForOccurrence,
  activeOccurrenceIds, alignmentFromSpans, effectiveSecondsToTick, occurrenceIntervals,
  addAnchor, applyAnchors, scoreClock, secondsToTick, tickToEffectiveSeconds, tickToSeconds, type AnchorPoint,
  type Alignment, type CorrectionSelection, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import {KeyboardEditor} from '../notation/KeyboardEditor';
import {NotationAudio} from '../notation/notation-audio';
import {usePianoSourcePlayer} from '../usePianoSourcePlayer';
import {usePianoPreviewAsset} from '../usePianoPreviewAsset';
import {
  decideVerification, findingDecision, loadVerification, parseVerificationState,
  type VerificationFinding, type VerificationState,
} from '../verification';
import {
  invertFinding, prepareFinding, type AcceptedBaseline,
} from './verification-transaction';
import type {Asset} from '../../../../../packages/lesson-schema/index';
import {ClipOverview} from './ClipOverview';
import {ContinuousScore} from './ContinuousScore';
import {TimeRoll} from './TimeRoll';
import {
  clampTimeWindow, DEFAULT_SPAN_SECONDS, layoutMeasures, zoomAround, type TimeWindow,
} from './viewport';import {
  createWorkspaceState, historyPath, historySummary, workspaceReducer, workspaceStatus,
  type WorkspaceAction, type WorkspaceState,
} from './workspace-state';
import {useElementWidth} from './useElementWidth';
import {createClock, useClockTime, type ClockStore} from './clock';
import type {GestureEdit} from './gestures';
import {
  buildSaveBody, canonicalAnchors, insertionPlacement, performanceChanged, restoreFromReference, serializeAlignment,
  type SavedSpan,
} from './save-payload';
import {
  clearRecovery, peekRecovery, readRecovery, writeRecovery, type RecoveryCheckpoint, type RecoveryIdentity,
} from './recovery';

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

export function PianoWorkspaceHarness({lessonId: lessonIdProp, embedded = false, onBack, onDirty, onSaved}: {
  lessonId?: string;
  /** Normal review route: hide harness-only labels and demo affordances. */
  embedded?: boolean;
  onBack?: () => void;
  /** Mirrors workspace dirty state to the app router/navigation guards. */
  onDirty?: (dirty: boolean) => void;
  /** Receives the revision and whether it represents the current work. */
  onSaved?: (revisionId: string, current: boolean) => void;
} = {}) {
  const params = new URLSearchParams(location.search);
  const lessonId = lessonIdProp ?? params.get('id') ?? '';

  const [state, setState] = useState<WorkspaceState | null>(null);
  /** Bumped when a document is replaced outside the undo history. */
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [baseline, setBaseline] = useState<NotationDocument | null>(null);
  const [title, setTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [snapTicks, setSnapTicks] = useState(0);
  const [writtenScope, setWrittenScope] = useState<'note' | 'event'>('note');
  const [respellDraft, setRespellDraft] = useState('');
  const [writtenStartDraft, setWrittenStartDraft] = useState('');
  const [writtenStartScope, setWrittenStartScope] = useState<'note' | 'event'>('note');
  const [notice, setNotice] = useState('');
  const [window, setWindow] = useState<TimeWindow>({start: 0, span: DEFAULT_SPAN_SECONDS});
  const [spans, setSpans] = useState<{ start: number; end: number; kind: 'playing' | 'explanation' }[]>([]);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [scoreTarget, setScoreTarget] = useState<{ tick: number; token: number } | null>(null);
  const [anchors, setAnchors] = useState<AnchorPoint[]>([]);
  const [anchorPast, setAnchorPast] = useState<{anchors: AnchorPoint[]; map: Alignment | null}[]>([]);
  const [anchorFuture, setAnchorFuture] = useState<{anchors: AnchorPoint[]; map: Alignment | null}[]>([]);
  const [anchorTick, setAnchorTick] = useState('');
  const [anchorPreview, setAnchorPreview] = useState('');
  const linkToken = useRef(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pianoRef = useRef<HTMLAudioElement>(null);
  const audioRef = useRef<NotationAudio | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [previewIdentity, setPreviewIdentity] = useState('');
  const [audioMode, setAudioMode] = useState<'original' | 'piano'>('original');
  // Bytes and SHA-256 are verified before Piano may be enabled; a pending or failed
  // asset keeps Original audio and never exposes a URL.
  const preview = usePianoPreviewAsset(previewAsset);
  const [keyboardRef, keyboardWidth] = useElementWidth<HTMLDivElement>();
  const compactKeyboard = keyboardWidth > 0 && keyboardWidth < 720;
  const [rollReveal, setRollReveal] = useState<{occurrenceId: string; token: number} | null>(null);
  const [scoreReveal, setScoreReveal] = useState<{tick: number; token: number} | null>(null);
  const revealToken = useRef(0);
  const clockRef = useRef(createClock());
  const [accountId, setAccountId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [sourceSha256, setSourceSha256] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [savedSections, setSavedSections] = useState<{id: string; label: string; start: number; end: number}[] | null>(null);
  const [sectionsDraft, setSectionsDraft] = useState<{id: string; label: string; start: number; end: number}[]>([]);
  const [assessmentPolicy, setAssessmentPolicy] = useState<'none' | 'notes'>('none');
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [savedAssessment, setSavedAssessment] = useState<unknown>(null);
  const [serverSignature, setServerSignature] = useState<string | null>(null);
  const [mapState, setMapState] = useState<Alignment | null>(null);
  const [previewBaseline, setPreviewBaseline] = useState<NotationDocument | null>(null);
  const pendingSavedSignature = useRef(false);
  const workspaceSignatureRef = useRef('');
  const referenceLoadedRef = useRef(false);
  const loadGeneration = useRef(0);
  const [savedRevisionId, setSavedRevisionId] = useState<string | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [confirmReviewed, setConfirmReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveConflict, setSaveConflict] = useState(false);
  const [conflictKind, setConflictKind] = useState<'stale'|'verification'|'other'>('other');
  const [reopenMessage, setReopenMessage] = useState('');
  const [recoveryOffer, setRecoveryOffer] = useState<RecoveryCheckpoint | null>(null);
  const [staleCheckpoint, setStaleCheckpoint] = useState<RecoveryCheckpoint | null>(null);
  const [replaceMode, setReplaceMode] = useState<{occurrenceId: string; pitch: number} | null>(null);
  const [addMode, setAddMode] = useState<{seconds: number; pitch: number; ticks: number; durationSeconds: number} | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<{pitch: number; ids: string[]} | null>(null);
  const lastWrittenTicks = useRef(480);
  const alignmentRef = useRef<Alignment | null>(null);
  const workspaceActive = useRef(false);
  const shellRef = useRef<HTMLElement | null>(null);
  const selectedRef = useRef<{ pitch: number } | null>(null);
  const selectionOccurrenceRef = useRef<string | null>(null);
  const lastRecordedSeconds = useRef(0.5);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [narrowViewport, setNarrowViewport] = useState(() =>
    globalThis.window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const media = globalThis.window.matchMedia('(max-width: 760px)');
    const update = () => setNarrowViewport(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const dispatch = useCallback((action: WorkspaceAction) => {
    setState(previous => (previous ? workspaceReducer(previous, action) : previous));
  }, []);

  const document = state?.document ?? null;
  const documentRef = useRef<NotationDocument | null>(null);
  const verificationRef = useRef<VerificationState | null>(null);
  const authoredSpellings = useRef<Record<string, Record<string, string>>>({});
  const acceptedBaselines = useRef<Record<string, AcceptedBaseline>>({});
  documentRef.current = document;
  verificationRef.current = verification;

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
    if (demo === 'explanation' || demo === 'arpeggio' || demo === 'frames' || demo === 'double') {
      // A local fixture for cases the real recording does not contain: an arpeggiated
      // chord, a spoken explanation passage and a held score cursor.
      const events = demo === 'double'
        ? [
            {id: 'x-1', onset: 2.0, duration: 0.5, pitch: 60},
            {id: 'x-2', onset: 2.012, duration: 0.5, pitch: 60},
            {id: 'x-3', onset: 5.0, duration: 0.5, pitch: 64},
          ]
        : demo === 'frames'
        ? [
            {id: 'f-1', onset: 2.0, duration: 0.5, pitch: 60},
            {id: 'f-2', onset: 2.012, duration: 0.5, pitch: 64},
            {id: 'f-3', onset: 2.024, duration: 0.5, pitch: 67},
            {id: 'f-4', onset: 6.0, duration: 0.5, pitch: 72},
          ]
        : demo === 'explanation'
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
      setDocumentEpoch(value => value + 1);
      setState(createWorkspaceState(document));
      setTitle(demo === 'explanation' ? 'Fixture: explanation passage'
        : demo === 'frames' ? 'Fixture: 12 ms attacks'
        : demo === 'double' ? 'Fixture: two attacks on one written note'
        : 'Fixture: arpeggiated chord');
      setSpans(demoSpans);
      setVideoUrl(null);
      setLoading(false);
      return () => { stopped = true; };
    }
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
  useEffect(() => { if (playing) audioRef.current?.stop(); }, [playing]);
  useEffect(() => { if (!preview.url && audioMode === 'piano') setAudioMode('original'); }, [preview.url, audioMode]);
  // A controller failure visibly returns the source audio, never a silent Piano.
  useEffect(() => { if (player.error && audioMode === 'piano') setAudioMode('original'); }, [player.error, audioMode]);
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

  const applyGestureEdit = useCallback((edit: GestureEdit) => {
    if (!document) return;
    if (edit.kind === 'pitch') {
      dispatch({type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: edit.occurrenceId,
        pitch: edit.pitch, ...(edit.spelling ? {spelling: edit.spelling} : {})}});
    } else if (edit.kind === 'time') {
      dispatch({type: 'command', command: {type: 'set-occurrence-onset', occurrenceId: edit.occurrenceId,
        seconds: edit.seconds}});
    } else {
      dispatch({type: 'command', command: {type: 'set-occurrence-duration', occurrenceId: edit.occurrenceId,
        seconds: edit.durationSeconds}});
    }
  }, [dispatch, document]);

  const auditionPitch = useCallback((pitch: number) => { audition([pitch], 0.25); }, [audition]);

  // Replace-pitch mode changes exactly its target and exits.
  const replacementPitch = useCallback((pitch: number) => {
    if (!replaceMode || !state) return;
    const command = {type: 'set-occurrence-pitch' as const, occurrenceId: replaceMode.occurrenceId, pitch};
    const outcome = applyCommand(state.document, command);
    if (outcome.status === 'rejected') { setNotice(outcome.message); return; }
    if (outcome.status === 'unchanged') {
      setReplaceMode(null);
      setNotice(pitch === replaceMode.pitch ? 'Replacement cancelled: same pitch, no change.' : outcome.label);
      return;
    }
    dispatch({type: 'command', command});
    setReplaceMode(null);
    setNotice(`Pitch replaced with ${pitchName(pitch)}.`);
  }, [dispatch, replaceMode, state]);

  useEffect(() => {
    if (replaceMode && document && !document.performance.some(note => note.id === replaceMode.occurrenceId)) {
      setReplaceMode(null);
      setNotice('The replacement target no longer exists; replacement cancelled.');
    }
  }, [replaceMode, document]);

  useEffect(() => {
    if (!replaceMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setReplaceMode(null); setNotice('Replacement cancelled.'); }
    };
    globalThis.window.addEventListener('keydown', onKey);
    return () => globalThis.window.removeEventListener('keydown', onKey);
  }, [replaceMode]);

  const placementFor = useCallback((sourceSeconds: number): {performed: number; tick: number} | {problem: string} => {
    if (!document) return {problem: 'The score is not ready for insertion.'};
    const placement = insertionPlacement(alignmentRef.current, document, sourceSeconds, offsetSeconds);
    return placement.ok ? {performed: placement.performed, tick: placement.tick} : {problem: placement.problem};
  }, [document, offsetSeconds]);

  const addPlacement = addMode ? placementFor(addMode.seconds + offsetSeconds) : null;
  const addProblem = addPlacement && 'problem' in addPlacement ? addPlacement.problem : null;
  const ghostDuplicate = Boolean(addMode && document?.performance.some(note =>
    note.pitch === addMode.pitch && Math.abs(note.onset - addMode.seconds) < 0.001));
  const ghostDuplicateId = ghostDuplicate && document
    ? document.performance.find(note => note.pitch === addMode!.pitch && Math.abs(note.onset - addMode!.seconds) < 0.001)?.id ?? null
    : null;

  const insertAtPlayhead = useCallback((addToChord: boolean) => {
    if (!document || !state) return;
    const placement = placementFor(playhead);
    if ('problem' in placement) { setNotice(placement.problem); return; }
    const command = {type: 'insert-note' as const, pitch: selectedRef.current?.pitch ?? 60,
      onsetSeconds: placement.performed, durationSeconds: lastRecordedSeconds.current,
      startTicks: placement.tick, durationTicks: lastWrittenTicks.current, addToChord};
    const outcome = applyCommand(state.document, command);
    if (outcome.status === 'applied') {
      dispatch({type: 'command', command});
      setNotice('');
    } else {
      setNotice(outcome.status === 'rejected' ? outcome.message : outcome.label);
    }
  }, [document, state, placementFor, playhead, dispatch]);

  const commitAdd = useCallback(() => {
    if (!addMode || !document || !state) return;
    if (ghostDuplicateId) { setDuplicateId(ghostDuplicateId); return; }
    const placement = placementFor(addMode.seconds + offsetSeconds);
    if ('problem' in placement) { setNotice(placement.problem); return; }
    const command = {type: 'insert-note' as const, pitch: addMode.pitch, onsetSeconds: placement.performed,
      durationSeconds: Math.max(0.02, addMode.durationSeconds), startTicks: placement.tick,
      durationTicks: addMode.ticks};
    const outcome = applyCommand(state.document, command);
    if (outcome.status === 'rejected') { setNotice(outcome.message); return; }
    if (outcome.status === 'unchanged') {
      setNotice(outcome.label || 'That note already exists.');
      if (ghostDuplicateId) setDuplicateId(ghostDuplicateId);
      return;
    }
    lastWrittenTicks.current = addMode.ticks;
    lastRecordedSeconds.current = addMode.durationSeconds;
    dispatch({type: 'command', command});
    setAddMode(null);
    setDuplicateId(null);
    setNotice('');
  }, [addMode, document, state, ghostDuplicateId, dispatch, placementFor, offsetSeconds]);

  useEffect(() => {
    if (!addMode) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'Enter') { event.preventDefault(); commitAdd(); }
      else if (event.key === 'Escape') { setAddMode(null); setDuplicateId(null); setNotice('Add note cancelled.'); }
    };
    globalThis.window.addEventListener('keydown', onKey);
    return () => globalThis.window.removeEventListener('keydown', onKey);
  }, [addMode, commitAdd]);

  const selection = state?.selection ?? null;
  const selected = selection && document ? noteFacts(document, selection) : null;
  useEffect(() => {
    const inside = (target: EventTarget | null) => {
      const root = shellRef.current;
      return Boolean(root && target instanceof Object && root.contains(target as Node));
    };
    const onDown = (event: Event) => { workspaceActive.current = inside(event.target); };
    const onFocus = (event: Event) => { workspaceActive.current = inside(event.target); };
    globalThis.window.addEventListener('pointerdown', onDown, true);
    globalThis.document.addEventListener('focusin', onFocus, true);
    return () => {
      globalThis.window.removeEventListener('pointerdown', onDown, true);
      globalThis.document.removeEventListener('focusin', onFocus, true);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !event.shiftKey && event.key.toLowerCase() === 'z') {
        if (!workspaceActive.current || replaceMode || addMode) return;
        event.preventDefault();
        dispatch({type: 'undo'});
        return;
      }
      if (modifier && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        if (!workspaceActive.current || replaceMode || addMode) return;
        event.preventDefault();
        dispatch({type: 'redo'});
        return;
      }
      const occurrence = selectionOccurrenceRef.current;
      if ((event.key === 'Delete' || event.key === 'Backspace') && occurrence && !replaceMode && !addMode
        && workspaceActive.current) {
        event.preventDefault();
        dispatch({type: 'command', command: {type: 'delete-occurrence', occurrenceId: occurrence}});
      }
    };
    globalThis.window.addEventListener('keydown', onKey);
    return () => globalThis.window.removeEventListener('keydown', onKey);
  }, [dispatch, replaceMode, addMode]);

  useEffect(() => {
    setWrittenStartDraft(selected ? String(selected.writtenStartTicks) : '');
    // Re-bind whenever the selected written position changes.
  }, [selection?.eventId, selection?.logicalNoteId, selected?.writtenStartTicks, document]);
  const tiedSegmentCount = useMemo(() => {
    if (!document || !selection) return 0;
    return document.segments
      .flatMap(segment => segment.notes)
      .filter(note => note.logical_note_id === selection.logicalNoteId).length;
  }, [document, selection]);
  const secondsPerTick = document ? 60 / (document.tempo.bpm * document.ppq) : 0.0625;
  const diff = useMemo(() => (baseline && document ? diffAgainst(baseline, document) : null), [baseline, document]);

  const boxes = useMemo(() => (document ? layoutMeasures(document).boxes : []), [document]);

  const baseAlignment = useMemo<Alignment | null>(
    () => (document ? alignmentFromSpans(document, spans) : null), [document, spans]);
  const anchored = useMemo(
    () => (document && baseAlignment ? applyAnchors(baseAlignment, document, anchors) : null),
    [document, baseAlignment, anchors]);
  const alignment = mapState ?? anchored?.alignment ?? baseAlignment;
  const intervals = useMemo(() => (document ? occurrenceIntervals(document, offsetSeconds) : []), [document, offsetSeconds]);

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
    if (sounding.length > 1) { setOverlap({pitch, ids: sounding.map(interval => interval.id)}); setNotice(''); return; }
    setNotice(`No ${pitchName(pitch)} is sounding here. Audition only — select a note in the roll or score.`);
  }, [document, intervals, playhead, select]);

  const activeIds = useMemo(() => activeOccurrenceIds(intervals, playhead), [intervals, playhead]);
  alignmentRef.current = alignment;
  const playheadTick = alignment ? effectiveSecondsToTick(alignment, playhead, offsetSeconds) : null;

  // A selection that changes for any reason (click, undo, insert) requests one reveal.
  const selectionOccurrence = state?.selection?.occurrenceId ?? null;
  selectedRef.current = selected;
  selectionOccurrenceRef.current = selectionOccurrence;
  useEffect(() => {
    if (!selectionOccurrence) return;
    if (rollReveal?.occurrenceId === selectionOccurrence) return;
    requestReveal(selectionOccurrence);
  }, [selectionOccurrence, rollReveal?.occurrenceId, requestReveal]);

  // Dirty identity is the current history path (length + top entry identity) plus
  // the small editable metadata and a document-replacement epoch. Undoing back to
  // the saved path is clean; redo and branching produce a different path. This
  // avoids serializing the whole document on every edit.
  const metaSignature = useMemo(() => JSON.stringify({
    alignment: serializeAlignment(alignment, anchors, offsetSeconds),
    anchors, offsetSeconds, spans, title, sectionsDraft, assessmentPolicy,
  }), [alignment, anchors, offsetSeconds, spans, title, sectionsDraft, assessmentPolicy]);
  const workspaceSignature = document && state
    ? `${documentEpoch}:${historyPath(state)}:${metaSignature}` : '';
  workspaceSignatureRef.current = workspaceSignature;
  const dirty = savedSignature !== null
    ? workspaceSignature !== savedSignature
    : workspaceSignature !== (serverSignature ?? '') || Boolean(state?.dirty);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  const previewStale = Boolean(previewBaseline && document && performanceChanged(previewBaseline, document));
  const recoveryIdentity = useMemo<RecoveryIdentity>(
    () => ({accountId, lessonId: lessonId ?? '', draftId, sourceSha256,
      baseRevisionId: savedRevisionId}),
    [accountId, lessonId, draftId, sourceSha256, savedRevisionId],
  );

  const applyRestoredReference = useCallback((restored: Extract<ReturnType<typeof restoreFromReference>, {ok: true}>['value'],
    revisionId: string, manifest: {draft_id?: string | null; source_video?: Asset | null;
      reference?: {key: string; sha256?: string} | null;
      preview_identity?: string | null; sha256?: string;
      section_set?: {sections?: {id: string; label: string; start: number; end: number}[]};
      assessment?: unknown; piano_preview?: Asset | null} | null) => {
    setBaseline(restored.document);
    setDocumentEpoch(value => value + 1);
    setState(createWorkspaceState(restored.document));
    setSpans(restored.spans);
    setOffsetSeconds(restored.offsetSeconds);
    // One authoritative editable map: the stored map is the base for later anchors.
    setMapState(restored.alignment?.passages?.length ? {
      alignment_version: 1, mode: restored.alignment.mode, basis: restored.alignment.basis,
      passages: restored.alignment.passages,
    } : null);
    setAnchors(restored.alignment?.anchors ?? []);
    setAnchorPast([]); setAnchorFuture([]);
    referenceLoadedRef.current = true;
    setError('');
    setLoading(false);
    setSavedRevisionId(revisionId);
    setSavedSections(manifest?.section_set?.sections ?? null);
    if (manifest?.section_set?.sections?.length) setSectionsDraft(manifest.section_set.sections);
    setAssessmentPolicy(((manifest?.assessment as {assessment?: string} | null)?.assessment === 'notes') ? 'notes' : 'none');
    setSavedAssessment(manifest?.assessment ?? null);
    setPreviewAsset((manifest?.piano_preview as Asset | null) ?? null);
    setPreviewIdentity(manifest?.preview_identity ?? '');
    setVideoUrl(manifest?.source_video ? assetUrl(manifest.source_video.key) : null);
    // A saved-only lesson keeps identity without inventing a draft id.
    setDraftId(manifest?.draft_id ?? '');
    setSourceSha256(manifest?.source_video?.sha256 ?? manifest?.reference?.sha256 ?? manifest?.sha256 ?? '');
    // The preview is valid only for the performance it was rendered from.
    setPreviewBaseline(manifest?.piano_preview ? restored.document : null);
    if (restored.title) setTitle(restored.title);
    pendingSavedSignature.current = true;
  }, []);

  // One coordinator chooses the workspace: a saved reference wins over a proposal,
  // and a late response can never replace what the user is editing.
  useEffect(() => {
    // Demo fixtures own their workspace; the API coordinator must not run for them.
    if (params.get('demo')) { setLoading(false); return; }
    if (!lessonId) { setError('This review link is incomplete.'); setLoading(false); return; }
    const generation = ++loadGeneration.current;
    let cancelled = false;
    const alive = () => !cancelled && generation === loadGeneration.current;

    (async () => {
      setLoading(true);
      setError('');
      // Both requests start together; a slow draft must not delay a saved reference.
      const draftPromise = request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-draft`)
        .catch(() => null);
      let manifest: {revision_id: string; reference: {key: string; sha256?: string};
        source_video?: Asset | null; piano_preview?: Asset | null; preview_identity?: string | null;
        draft_id?: string | null;
        section_set?: {sections?: {id: string; label: string; start: number; end: number}[]};
        assessment?: unknown} | null = null;
      try {
        manifest = await request(`/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false,
        {'X-Lesson-Formats': '1,2'});
      } catch {
        manifest = null;
      }
      if (!alive()) return;

      let restored = false;
      if (manifest?.revision_id && manifest.reference?.key) {
        try {
          const response = await fetch(assetUrl(manifest.reference.key), {credentials: 'same-origin'});
          if (!alive()) return;
          if (!response.ok) {
            setReopenMessage('The saved revision could not be read; showing the current proposal instead.');
          } else {
            const result = restoreFromReference(await response.json());
            if (!alive()) return;
            if (result.ok) {
              applyRestoredReference(result.value, manifest.revision_id, manifest);
              setReopenMessage(`Opened saved revision ${manifest.revision_id.slice(0, 8)} from ${
                result.value.source === 'notation' ? 'the authored notation' : 'performance only (legacy reference)'}.`);
              restored = true;
            } else {
              setReopenMessage(`The saved revision could not be opened (${result.message}); showing the proposal instead.`);
            }
          }
        } catch {
          if (!alive()) return;
          setReopenMessage('The saved revision could not be read; showing the current proposal instead.');
        }
      }
      if (!alive()) return;
      if (restored) { setLoading(false); return; }

      // Fallback to the proposal only when no saved reference could be opened.
      setError('');
      const value = await draftPromise;
      if (!alive()) return;
      if (value === null) {
        setError('No draft or saved revision is available for this lesson.');
        setLoading(false);
        return;
      }
      try {
        const parsed = parseMusicDraftView(value);
        if (!parsed.ok) throw new Error(parsed.message);
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
        if (!alive()) return;
        setBaseline(document);
        setDocumentEpoch(value => value + 1);
        setState(createWorkspaceState(document));
        setTitle(draft.title);
        setSpans(draftSpans);
        setOffsetSeconds(draft.playback?.sync_offset_seconds ?? 0);
        setDraftId(draft.draft_id);
        setSourceSha256(draft.reference?.sha256 ?? '');
        setVerificationToken(draft.verification_state_token ?? '');
        setSectionsDraft(current => current.length ? current
          : [{id: 'whole', label: 'Whole lesson', start: 0, end: draft.duration}]);
        setAssessmentPolicy(current => current === 'notes' ? 'notes' : 'none');
        setPreviewAsset((draft.piano_preview as Asset | null) ?? null);
        setPreviewIdentity(draft.preview_identity ?? '');
        setPreviewBaseline(draft.piano_preview ? document : null);
        setVideoUrl(draft.source_video ? assetUrl(draft.source_video.key) : null);
      } catch (cause) {
        if (alive()) setError(cause instanceof Error ? cause.message : 'The draft could not be opened.');
      } finally {
        if (alive()) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [lessonId, applyRestoredReference]);

  useEffect(() => {
    getSession().then(session => { if (session) setAccountId(session.account.id); }).catch(() => {});
  }, []);

  // A reopened reference becomes the clean saved state once its document is applied.
  useEffect(() => {
    if (!lessonId || !draftId) { setVerification(null); return; }
    let stopped = false;
    void loadVerification(lessonId, draftId).then(value => {
      if (stopped || value === null) return;
      const parsed = parseVerificationState(value);
      if (parsed.ok) setVerification(parsed.value);
    }).catch(() => {});
    return () => { stopped = true; };
  }, [lessonId, draftId]);

  const decideFinding = useCallback(async (finding: VerificationFinding, decision: 'accepted' | 'rejected') => {
    const current = verificationRef.current;
    const live = documentRef.current;
    if (!lessonId || !draftId || !current || !live || verificationBusy) return;
    if (decision === 'accepted') {
      const prepared = prepareFinding(live, finding, alignment);
      if (prepared.status !== 'applied') { setNotice(prepared.reason); return; }
    }
    const previous = findingDecision(current, finding.id);
    const wasAccepted = previous?.decision === 'accepted';
    setVerificationBusy(true);
    try {
      const value = await decideVerification(lessonId, draftId, current.proposal_sha256,
        current.state_token, current.report_sha256, finding.id, decision);
      const parsed = parseVerificationState(value);
      if (!parsed.ok) throw new Error(parsed.message);
      setVerification(parsed.value);
      setVerificationToken(parsed.value.state_token);
      const latest = documentRef.current;
      if (!latest) return;
      if (decision === 'accepted') {
        // Revalidate against the live document after the async response.
        const prepared = prepareFinding(latest, finding, alignment);
        if (prepared.status !== 'applied') {
          setNotice('The server accepted this suggestion, but the local notes changed while the request was pending. '
            + 'The document was not overwritten; save will report a conflict until you reconcile it.');
          return;
        }
        acceptedBaselines.current[finding.id] = prepared.baseline;
        dispatch({type: 'commands', commands: prepared.commands, candidate: prepared.document, base: latest,
          label: `Verification: ${finding.kind}`});
        setConfirmReviewed(false);
      } else if (wasAccepted) {
        const result = invertFinding(latest, finding, alignment, acceptedBaselines.current[finding.id]);
        if ('reason' in result) {
          setNotice(`${result.reason} The local document was kept.`);
          return;
        }
        dispatch({type: 'commands', commands: result.commands, candidate: result.document, base: latest,
          label: 'Verification: reverted suggestion'});
        setConfirmReviewed(false);
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message
        : 'The verification decision conflicted; the working document was kept.');
      void loadVerification(lessonId, draftId).then(value => {
        if (value === null) return;
        const parsed = parseVerificationState(value);
        if (!parsed.ok) return;
        setVerification(parsed.value);
        const liveDoc = documentRef.current;
        const same = liveDoc && parsed.value.events.length === liveDoc.performance.length
          && parsed.value.events.every((event, index) => {
            const local = liveDoc.performance[index];
            return local && event.id === local.id && event.pitch === local.pitch
              && Math.abs(event.onset - local.onset) < 1e-6;
          });
        if (same) setVerificationToken(parsed.value.state_token);
        else setNotice('Verification changed on the server and the local notes differ. '
          + 'The save token was not advanced; review the diagnostics before saving.');
      }).catch(() => {});
    } finally {
      setVerificationBusy(false);
    }
  }, [lessonId, draftId, verificationBusy, alignment, dispatch]);

  useEffect(() => {
    if (pendingSavedSignature.current && workspaceSignature) {
      pendingSavedSignature.current = false;
      setSavedSignature(workspaceSignature);
    }
  }, [workspaceSignature]);

  // The server baseline is the loaded draft, kept separate from any local restoration.
  useEffect(() => {
    if (workspaceSignature && serverSignature === null) setServerSignature(workspaceSignature);
  }, [workspaceSignature, serverSignature]);

  // A local checkpoint is offered only when its account, draft and source match.
  useEffect(() => {
    if (!accountId || !lessonId || !sourceSha256 || !document) return;
    const outcome = readRecovery(recoveryIdentity);
    if (outcome.status === 'restored') setRecoveryOffer(outcome.checkpoint);
    else if (outcome.status === 'rejected') {
      setRecoveryNotice(outcome.reason);
      if (/saved revision/i.test(outcome.reason)) setStaleCheckpoint(peekRecovery());
    }
    // Only when the draft identity becomes available.
  }, [accountId, lessonId, draftId, sourceSha256, document === null]);

  // Autosave a local checkpoint while edits are unsaved; it is never called Saved.
  useEffect(() => {
    if (!document || !dirty || !accountId || !sourceSha256) return;
    const timer = setTimeout(() => {
      writeRecovery({
        identity: recoveryIdentity, title,
        baseRevisionId: savedRevisionId, verificationToken: verificationToken || null,
        notation: document,
        alignment: serializeAlignment(alignment, anchors, offsetSeconds),
        offsetSeconds, spans,
        sections: sectionsDraft.length ? sectionsDraft : undefined,
        assessment: {policy: assessmentPolicy},
        durationSeconds: document.duration,
        authoredSpellings: authoredSpellings.current,
        acceptedBaselines: acceptedBaselines.current,
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [workspaceSignature, dirty, accountId, draftId, sourceSha256, title, alignment, anchors, offsetSeconds,
      spans, recoveryIdentity, savedRevisionId, verificationToken, sectionsDraft, assessmentPolicy]);

  // Any document change requires a fresh confirmation before it can be saved.
  useEffect(() => { setConfirmReviewed(false); }, [workspaceSignature]);

  // A stale preview must fall back to Original rather than pretend it is current.
  useEffect(() => {
    if (previewStale && audioMode === 'piano') setAudioMode('original');
  }, [previewStale, audioMode]);

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
  }, [document, offsetSeconds]);

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

  /* ------------------------------------------------------ save and reopen */

  const save = useCallback(async (baseOverride?: string) => {
    if (!document || !lessonId || !confirmReviewed || saving) return;
    const snapshot = workspaceSignature;
    setSaving(true); setSaveError(''); setSaveMessage(''); setSaveConflict(false);
    const base = baseOverride ?? savedRevisionId;
    const body = buildSaveBody({
      title, document, spans, alignment, anchors, offsetSeconds, baseRevisionId: base,
      draftId, referenceSha256: sourceSha256, verificationStateToken: verificationToken || null,
      sections: sectionsDraft.length ? sectionsDraft : (savedSections ?? undefined),
      assessment: assessmentPolicy === 'notes'
        ? {assessment: 'notes', input_modes: ['midi'], dimensions: ['pitch', 'timing'], rubric_version: 'piano-midi-v1'}
        : {assessment: 'none', input_modes: ['none'], dimensions: [], rubric_version: 'music-watch-v1'},
    });
    try {
      const manifest = await request<{ revision_id: string }>(
        `/lessons/${encodeURIComponent(lessonId)}/${base ? 'music-revision' : 'music-draft/review'}`,
        'POST', body);
      setSavedRevisionId(manifest.revision_id);
      setSavedSignature(snapshot);
      const current = snapshot === workspaceSignatureRef.current;
      onSaved?.(manifest.revision_id, current);
      setSaveConflict(false);
      if (snapshot === workspaceSignatureRef.current) {
        // The acknowledged snapshot is still the current work.
        clearRecovery();
        setRecoveryOffer(null);
        setRecoveryNotice('');
        setSaveMessage(`Saved privately · revision ${manifest.revision_id.slice(0, 8)}`);
      } else {
        // Newer edits exist; keep their checkpoint and say so rather than claim Saved.
        setSaveMessage(`Saved an earlier version · revision ${manifest.revision_id.slice(0, 8)}; newer edits remain unsaved.`);
      }
    } catch (cause) {
      // Edits stay in place; the local checkpoint keeps the work recoverable. A stale
      // base is a conflict with an explicit resolution, never silent data loss.
      if (cause instanceof ApiError && cause.status === 409) {
        setSaveConflict(true);
        const message = cause.message ?? '';
        if (/verification|working notes/i.test(message)) {
          setConflictKind('verification');
          setSaveError('The verification decisions changed. Your edits are kept; reload the saved revision to review them.');
        } else if (/already been reviewed|already edited|newer saved revision|newer revision/i.test(message)) {
          setConflictKind('stale');
          setSaveError('This lesson has a newer saved revision. Your edits are kept locally.');
        } else {
          setConflictKind('other');
          setSaveError(`${message || 'The save conflicted with the saved lesson.'} Your edits are kept locally.`);
        }
      } else {
        setSaveError(cause instanceof Error ? cause.message : 'The save failed; your edits are kept.');
      }
    } finally {
      setSaving(false);
    }
  }, [document, lessonId, confirmReviewed, saving, title, spans, alignment, anchors, offsetSeconds,
      savedRevisionId, workspaceSignature, draftId, sourceSha256, verificationToken, savedSections, savedAssessment, onSaved]);

  const saveOnLatestRevision = useCallback(async () => {
    if (!lessonId) return;
    try {
      const lesson = await request<{ revision_id: string }>(`/lessons/${encodeURIComponent(lessonId)}`,
        'GET', undefined, false, {'X-Lesson-Formats': '1,2'});
      setSavedRevisionId(lesson.revision_id);
      setSaveConflict(false);
      await save(lesson.revision_id);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'The latest revision could not be read.');
    }
  }, [lessonId, save]);

  const reopen = useCallback(async () => {
    if (!lessonId) return;
    setReopenMessage('');
    try {
      const lesson = await request<{ revision_id: string; reference: { key: string }; title?: string }>(
        `/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false, {'X-Lesson-Formats': '1,2'});
      const response = await fetch(assetUrl(lesson.reference.key), {credentials: 'same-origin'});
      if (!response.ok) throw new Error('The saved reference could not be read.');
      const restored = restoreFromReference(await response.json());
      if (!restored.ok) throw new Error(restored.message);
      applyRestoredReference(restored.value, lesson.revision_id,
        lesson as {section_set?: {sections?: {id: string; label: string; start: number; end: number}[]};
          assessment?: unknown; piano_preview?: Asset | null});
      setConfirmReviewed(false);
      setReopenMessage(`Reopened revision ${lesson.revision_id.slice(0, 8)} from ${
        restored.value.source === 'notation' ? 'the authored notation' : 'performance only (legacy reference)'}.`);
    } catch (cause) {
      setReopenMessage(cause instanceof Error ? cause.message : 'The saved revision could not be reopened.');
    }
  }, [lessonId, applyRestoredReference]);

  const restoreStaleCheckpoint = useCallback(() => {
    if (!staleCheckpoint) return;
    try {
      const restored = parseNotationDocument(staleCheckpoint.notation);
      setDocumentEpoch(value => value + 1);
      setState(createWorkspaceState(restored));
      setSpans(staleCheckpoint.spans);
      setOffsetSeconds(staleCheckpoint.offsetSeconds);
      setAnchors(canonicalAnchors(staleCheckpoint.alignment?.anchors ?? []));
      if (staleCheckpoint.sections?.length) setSectionsDraft(staleCheckpoint.sections);
      if (staleCheckpoint.assessment) setAssessmentPolicy(staleCheckpoint.assessment.policy);
      authoredSpellings.current = staleCheckpoint.authoredSpellings ?? {};
      acceptedBaselines.current = (staleCheckpoint.acceptedBaselines ?? {}) as typeof acceptedBaselines.current;
      if (staleCheckpoint.alignment?.passages?.length) {
        setMapState({alignment_version: 1, mode: staleCheckpoint.alignment.mode,
          basis: staleCheckpoint.alignment.basis, passages: staleCheckpoint.alignment.passages});
      }
      // The current base is deliberately kept: saving creates a new revision on it.
      setConfirmReviewed(false);
      setStaleCheckpoint(null);
      setRecoveryNotice('');
      setReopenMessage('Restored a checkpoint written against an older revision. '
        + 'Saving now creates a new revision on the current base.');
    } catch {
      setRecoveryNotice('The stale checkpoint could not be restored and was ignored.');
      setStaleCheckpoint(null);
    }
  }, [staleCheckpoint]);

  const restoreCheckpoint = useCallback(() => {
    if (!recoveryOffer) return;
    try {
      const restored = parseNotationDocument(recoveryOffer.notation);
      setDocumentEpoch(value => value + 1);
      setState(createWorkspaceState(restored));
      setSpans(recoveryOffer.spans);
      setOffsetSeconds(recoveryOffer.offsetSeconds);
      setAnchors(canonicalAnchors(recoveryOffer.alignment?.anchors ?? []));
      if (recoveryOffer.sections?.length) setSectionsDraft(recoveryOffer.sections);
      if (recoveryOffer.assessment) setAssessmentPolicy(recoveryOffer.assessment.policy);
      authoredSpellings.current = recoveryOffer.authoredSpellings ?? {};
      acceptedBaselines.current = (recoveryOffer.acceptedBaselines ?? {}) as typeof acceptedBaselines.current;
      // Recovered work keeps its server base so a retry is not a first review.
      if (recoveryOffer.baseRevisionId) setSavedRevisionId(recoveryOffer.baseRevisionId);
      if (recoveryOffer.verificationToken) setVerificationToken(recoveryOffer.verificationToken);
      if (recoveryOffer.alignment?.passages?.length) {
        setMapState({alignment_version: 1, mode: recoveryOffer.alignment.mode,
          basis: recoveryOffer.alignment.basis, passages: recoveryOffer.alignment.passages});
      }
      setConfirmReviewed(false);
      setRecoveryOffer(null);
      setReopenMessage(`Restored a local checkpoint from ${
        new Date(recoveryOffer.savedAt).toLocaleString()} — it is not saved to the server.`);
    } catch {
      setRecoveryNotice('The local checkpoint could not be restored and was ignored.');
      setRecoveryOffer(null);
    }
  }, [recoveryOffer]);

  /* --------------------------------------------------- alignment authoring */

  const storedPlayhead = Math.max(0, playhead - offsetSeconds);

  const snapshot = useCallback(() => ({anchors, map: mapState}), [anchors, mapState]);

  const commitAnchors = useCallback((next: AnchorPoint[], nextMap: Alignment | null) => {
    setAnchorPast(history => [...history.slice(-19), snapshot()]);
    setAnchorFuture([]);
    setAnchors(next);
    setMapState(nextMap);
    setAnchorPreview(next.length ? `Anchored at ${next.length} point(s).` : 'Reset to the estimated map.');
  }, [snapshot]);

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
    if (!document || !alignment) return;
    const tick = Number(anchorTick);
    if (!Number.isInteger(tick) || tick < 0) { setAnchorPreview('Enter a whole tick number.'); return; }
    // The anchor is applied to the map in use, so a reopened stored map stays editable.
    const result = addAnchor(alignment, document, storedPlayhead, tick);
    if (!result.ok) { setAnchorPreview(`Not applied: ${result.message}`); return; }
    // Authoring order is not map order: canonicalise by source time before saving.
    commitAnchors(canonicalAnchors([...anchors, {seconds: storedPlayhead, tick}]), result.alignment);
  }, [document, alignment, anchorTick, anchors, commitAnchors, storedPlayhead]);

  const removeAnchor = useCallback((index: number) => {
    if (!document) return;
    const next = anchors.filter((_, position) => position !== index);
    const base = alignmentFromSpans(document, spans);
    const result = next.length ? applyAnchors(base, document, next) : {alignment: base, problem: null};
    if (result.problem) { setAnchorPreview(`Not applied: ${result.problem}`); return; }
    commitAnchors(next, next.length ? result.alignment : null);
  }, [document, anchors, spans, commitAnchors]);

  const undoAnchors = useCallback(() => {
    if (!anchorPast.length) return;
    const previous = anchorPast[anchorPast.length - 1];
    setAnchorPast(anchorPast.slice(0, -1));
    setAnchorFuture([snapshot(), ...anchorFuture].slice(0, 20));
    setAnchors(previous.anchors);
    setMapState(previous.map);
    setAnchorPreview('Anchor change undone.');
  }, [anchorPast, anchorFuture, snapshot]);

  const redoAnchors = useCallback(() => {
    if (!anchorFuture.length) return;
    const [next, ...rest] = anchorFuture;
    setAnchorPast([...anchorPast.slice(-19), snapshot()]);
    setAnchorFuture(rest);
    setAnchors(next.anchors);
    setMapState(next.map);
    setAnchorPreview('Anchor change restored.');
  }, [anchorPast, anchorFuture, snapshot]);

  if (loading) return <main className="ws-shell"><p role="status">Opening the draft…</p></main>;
  if (error) return <main className="ws-shell"><p role="alert" className="ws-error">{error}</p></main>;
  if (!document || !state) return <main className="ws-shell"><p role="status">No document.</p></main>;

  const snapSeconds = snapTicks ? snapTicks * secondsPerTick : null;
  const report = state.lastReport;
  const summary = historySummary(state);

  return <main className="ws-shell" ref={shellRef} data-workspace-dirty={dirty ? 'true' : 'false'}
    style={{overflowX: 'clip', maxWidth: '100vw', contain: 'paint'}}
    onPointerDownCapture={() => { workspaceActive.current = true; }}>
    <header className="ws-head">
      <div>
        <p className="ws-eyebrow">{embedded ? 'Piano review · private until you save' : 'Correction workspace · local preview'}</p>
        <div className="ws-title-row">
          {onBack && <button type="button" className="ws-back" data-workspace-back="true"
            onClick={() => {
              if (dirty && !globalThis.window.confirm('Leave without saving your changes?')) return;
              onBack();
            }}>← Back</button>}
          <h1>{title || 'Piano correction workspace'}</h1>
        </div>
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
      <label className="ws-field ws-inline">
        <span><input type="checkbox" aria-label="Confirm reviewed" checked={confirmReviewed}
          onChange={event => setConfirmReviewed(event.target.checked)}/> Reviewed</span>
      </label>
      <button type="button" onClick={() => save()} disabled={!confirmReviewed || saving || !(dirty || savedRevisionId === null)}
        data-save-button="true">{saving ? 'Saving…' : 'Save privately'}</button>
      <button type="button" onClick={reopen} disabled={Boolean(replaceMode) || Boolean(addMode)}>Reopen saved</button>

      <button type="button" onClick={() => dispatch({type: 'undo'})} disabled={!state.past.length || Boolean(replaceMode) || Boolean(addMode)}>Undo</button>
      <button type="button" onClick={() => dispatch({type: 'redo'})} disabled={!state.future.length || Boolean(replaceMode) || Boolean(addMode)}>Redo</button>
      <label className="ws-field ws-inline">
        <span>Snap</span>
        <select value={snapTicks} onChange={event => setSnapTicks(Number(event.target.value))}>
          {SNAP_CHOICES.map(choice => <option key={choice.label} value={choice.ticks}>{choice.label}</option>)}
        </select>
      </label>
      <label className="ws-field ws-inline">
        <span>Offset</span>
        <input type="number" step={0.01} min={-10} max={10} value={offsetSeconds} style={{width: 72}}
          aria-label="Sync offset in seconds"
          onChange={event => setOffsetSeconds(Math.max(-10, Math.min(10, Number(event.target.value) || 0)))}/>
        <span className="ws-hint">s · preview alignment</span>
      </label>
      <div className="ws-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
        <span className="ws-window-label" data-window-span={window.span.toFixed(2)}>
          {window.span.toFixed(window.span < 10 ? 1 : 0)} s visible · from {window.start.toFixed(1)} s
        </span>
        <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom in">+</button>
      </div>
      <span className="ws-time">{playhead.toFixed(2)} s / {document.duration.toFixed(2)} s</span>
      <label className="ws-field ws-inline">
        <span>{spans.length ? 'Source clock' : 'Position'}</span>
        <input type="range" min={0} max={document.duration} step={0.01} value={playhead}
          aria-label={embedded ? 'Source clock position' : 'Fixture clock'}
          onChange={event => {
            const value = Number(event.target.value);
            if (videoUrl && videoRef.current) { seek(value); return; }
            setPlayhead(value); clockRef.current.set(value); setPlaying(false);
          }}/>
      </label>
      <span className="ws-alignment" data-alignment-mode={alignment?.mode ?? 'none'} data-playhead-tick={playheadTick ?? ''}
        data-ticks-per-second={alignment ? Math.round((1 / secondsPerTick) * 1000) / 1000 : ''}>
        {alignment?.mode === 'anchored' ? 'Score alignment anchored' : 'Score alignment estimated'}
        {spans.length > 1 ? ` · ${spans.filter(span => span.kind === 'explanation').length} explanation passage(s)` : ''}
      </span>
      {saveMessage && <span className="ws-report" data-save-state="saved">{saveMessage}</span>}
      {saveError && <span className="ws-report is-bad" data-save-state="error">{saveError}</span>}
      {saveConflict && <span className="ws-report" data-save-state="conflict" data-conflict={conflictKind}>
        {conflictKind !== 'verification' &&
          <button type="button" onClick={saveOnLatestRevision}>Save on latest revision</button>}
        <button type="button" onClick={reopen}>Reload saved revision</button>
      </span>}
      {reopenMessage && <span className="ws-report" data-reopen-state="message">{reopenMessage}</span>}
      {report && <span className={report.status === 'rejected' ? 'ws-report is-bad' : 'ws-report'}>
        {report.status === 'rejected' ? report.message : report.label}
      </span>}
      {notice && <span className="ws-report">{notice}</span>}
    </div>

    {recoveryOffer && <section className="ws-panel" role="status" aria-label="Local recovery" data-recovery="offer">
      <p>A local checkpoint from {new Date(recoveryOffer.savedAt).toLocaleString()} is available.
        It is <strong>not saved to the server</strong>.</p>
      <div className="ws-row">
        <button type="button" onClick={restoreCheckpoint}>Restore local checkpoint</button>
        <button type="button" onClick={() => { clearRecovery(); setRecoveryOffer(null); }}>Discard</button>
      </div>
    </section>}
    {recoveryNotice && <p className="ws-hint" role="status" data-recovery="rejected">{recoveryNotice}</p>}
    {staleCheckpoint && <section className="ws-panel" role="status" aria-label="Stale local recovery" data-recovery="stale">
      <p>This checkpoint was written against an older saved revision. Restoring keeps your work but
        saves as a new revision on the current base.</p>
      <div className="ws-row">
        <button type="button" onClick={restoreStaleCheckpoint}>Restore older checkpoint</button>
        <button type="button" onClick={() => { clearRecovery(); setStaleCheckpoint(null); }}>Discard</button>
      </div>
    </section>}

    <details className="ws-panel" data-lesson-settings="true">
      <summary>Lesson settings, teaching sections and assessment</summary>
      <h2>Teaching sections</h2>
      <div className="ws-row">
        <button type="button" data-section-add onClick={() => {
          setSectionsDraft(current => {
            const last = current[current.length - 1] ?? {id: 'whole', label: 'Whole lesson', start: 0, end: document.duration};
            const sequence = current.length ? current : [last];
            const middle = (last.start + last.end) / 2;
            return [...sequence.slice(0, -1), {...last, end: middle},
              {id: `section-${sequence.length + 1}`, label: `Section ${sequence.length + 1}`, start: middle, end: last.end}];
          });
          setConfirmReviewed(false);
        }}>Add section</button>
      </div>
      {sectionsDraft.map((section, index) => <fieldset key={section.id} data-section={section.id}>
        <legend>Section {index + 1}</legend>
        <label className="ws-field"><span>Name</span>
          <input value={section.label} maxLength={80} onChange={event => {
            const label = event.target.value;
            setSectionsDraft(current => current.map((item, position) => position === index ? {...item, label} : item));
            setConfirmReviewed(false);
          }}/></label>
        <div className="ws-row">
          <label className="ws-field ws-inline"><span>Start (s)</span>
            <input type="number" step={0.01} min={0} max={section.end - 0.05} value={section.start}
              onChange={event => {
                const raw = Number(event.target.value);
                const floor = index === 0 ? 0 : (sectionsDraft[index - 1]?.start ?? 0) + 0.05;
                const start = index === 0 ? 0 : Math.max(floor, Math.min(section.end - 0.05, raw));
                setSectionsDraft(current => current.map((item, position) => {
                  if (position === index) return {...item, start};
                  // Shared boundary: the previous section ends where this one starts.
                  if (position === index - 1) return {...item, end: start};
                  return item;
                }));
                setConfirmReviewed(false);
              }}/></label>
          <label className="ws-field ws-inline"><span>End (s)</span>
            <input type="number" step={0.01} min={section.start + 0.05} max={document.duration} value={section.end}
              onChange={event => {
                const raw = Number(event.target.value);
                const ceiling = index === sectionsDraft.length - 1 ? document.duration
                  : (sectionsDraft[index + 1]?.end ?? document.duration) - 0.05;
                const end = Math.max(section.start + 0.05, Math.min(ceiling, raw));
                setSectionsDraft(current => current.map((item, position) => {
                  if (position === index) return {...item, end};
                  // Shared boundary: the next section starts where this one ends.
                  if (position === index + 1) return {...item, start: end};
                  return item;
                }));
                setConfirmReviewed(false);
              }}/></label>
          {sectionsDraft.length > 1 && <button type="button" onClick={() => {
            setSectionsDraft(current => {
              const removed = current[index];
              const next = current.filter((_, position) => position !== index);
              if (index > 0) {
                // Give the removed span to the previous section.
                return next.map((item, position) => position === index - 1 ? {...item, end: removed.end} : item);
              }
              // Removing the first section starts the new first one at zero.
              return next.map((item, position) => position === 0 ? {...item, start: 0} : item);
            });
            setConfirmReviewed(false);
          }}>Remove</button>}
        </div>
      </fieldset>)}
      <h2>Assessment</h2>
      <label className="ws-field ws-inline"><span>Policy</span>
        <select value={assessmentPolicy} data-assessment-policy
          onChange={event => { setAssessmentPolicy(event.target.value === 'notes' ? 'notes' : 'none'); setConfirmReviewed(false); }}>
          <option value="none">Watch only (no note scoring)</option>
          <option value="notes">Pitch and timing from MIDI</option>
        </select>
      </label>
      <h2>Verification diagnostics</h2>
      {!verification ? <p className="ws-hint">No verification report is available for this proposal.</p> : <>
        <p className="ws-hint" data-verification-status>
          {verification.stale ? 'Stale report' : verification.report ? 'Report ready' : 'Report unavailable'}
          {' · '}{verification.decisions.length} decided
          {verification.conflicts.length ? ` · ${verification.conflicts.length} conflict(s)` : ''}
        </p>
        {verification.report_error && <p className="ws-hint">{verification.report_error}</p>}
        {verification.report?.findings.slice(0, 12).map(finding => {
          const decision = findingDecision(verification, finding.id);
          return <div className="ws-row" key={finding.id} data-finding={finding.id}>
            <span>{finding.kind} · {finding.explanation}</span>
            <span className="ws-hint">{decision ? decision.decision : finding.status}</span>
            <button type="button" disabled={verificationBusy} data-verification-accept={finding.id}
              onClick={() => void decideFinding(finding, 'accepted')}>Accept</button>
            <button type="button" disabled={verificationBusy} data-verification-reject={finding.id}
              onClick={() => void decideFinding(finding, 'rejected')}>Reject</button>
          </div>;
        })}
        {verification.report && verification.report.findings.length > 12
          && <p className="ws-hint">{verification.report.findings.length - 12} more findings are not shown here.</p>}
      </>}
      <h2>Passages</h2>
      <p className="ws-hint">Playing passages carry score time; explanation passages are held and reject insertion.</p>
      {spans.map((span, index) => <div className="ws-row" key={`${index}-${span.start}`} data-passage={index}>
        <select aria-label={`Passage ${index + 1} kind`} value={span.kind}
          onChange={() => setNotice('Passage changes would move the existing notation. '
            + 'This edit was not applied; adjust the alignment instead of relabelling a passage that already carries notes.')}>
          <option value="playing">Playing</option>
          <option value="explanation">Explanation</option>
        </select>
        <label className="ws-field ws-inline"><span>Start</span>
          <input type="number" step={0.01} value={span.start}
            onChange={() => setNotice('Passage boundary changes would move the existing notation and were not applied.')}/></label>
        <label className="ws-field ws-inline"><span>End</span>
          <input type="number" step={0.01} value={span.end}
            onChange={() => setNotice('Passage boundary changes would move the existing notation and were not applied.')}/></label>
        {spans.length > 1 && <button type="button" onClick={() => setNotice('Passages cannot be removed while they carry scored notes.')}>Remove</button>}
      </div>)}
      <div className="ws-row"><button type="button"
        onClick={() => setNotice('Adding a passage to a scored clip is not supported yet; it would overlap existing score time.')}>
        Add passage</button></div>
      <p className="ws-hint" data-passage-rejected="true">Passage kind and boundary edits are validated against the existing map and
        currently rejected rather than silently re-timing engraved notes.</p>
      <p className="ws-hint">Verification decisions from the proposal remain server-authoritative; a changed verification state is reported as a conflict instead of being overwritten.</p>
    </details>

    <div className="ws-grid">
      <div className="ws-edit">
        <section className="ws-panel ws-surface" aria-label="Keyboard">
          <div ref={keyboardRef}>
            <LiveKeyboard document={document} clock={clockRef.current} intervals={intervals}
              selectedPitch={selected?.pitch ?? null}
              onKey={pitch => audition([pitch], 0.4)}
              onSelectKey={pitch => {
                if (replaceMode) { replacementPitch(pitch); return; }
                if (addMode) { setAddMode(mode => mode ? {...mode, pitch} : mode); return; }
                selectKey(pitch);
              }}
              width={compactKeyboard ? 640 : 1040} semitones={compactKeyboard ? 36 : 60}
              toolbarHint="Tap to audition. With a note selected, tap a key to select that pitch at the playhead; it never edits a note."
              hint="Selection and audition only; use “Add note at playhead” in the inspector to insert."/>
          </div>
          {replaceMode && <div className="ws-replace-banner" data-replace="active">
            Replacing {pitchName(replaceMode.pitch)} — click a key to commit.
            <button type="button" onClick={() => { setReplaceMode(null); setNotice('Replacement cancelled.'); }}>Cancel</button>
          </div>}
        </section>

        <section className="ws-panel ws-surface" aria-label="Piano roll">
          <TimeRoll document={document} window={window} onWindowChange={next => changeWindow(next, 'reveal')}
            onWindowChangeOrigin={changeWindow}
            offsetSeconds={offsetSeconds} activeOccurrenceIds={activeIds}
            clock={clockRef.current} intervals={intervals}
            selectedOccurrenceId={selection?.occurrenceId ?? null}
            reveal={rollReveal}
            onGestureCommit={applyGestureEdit} onAuditionPitch={auditionPitch}
            editingEnabled={!replaceMode && !addMode}
            snapSeconds={snapTicks ? snapTicks * secondsPerTick : null}
            addMode={Boolean(addMode)}
            ghost={addMode ? {seconds: addMode.seconds, pitch: addMode.pitch,
              durationSeconds: addMode.durationSeconds, invalid: Boolean(addProblem)} : null}
            onGhostPlace={(seconds, pitch) => setAddMode(mode => ({
              seconds: seconds - offsetSeconds, pitch,
              ticks: mode?.ticks ?? lastWrittenTicks.current,
              durationSeconds: mode?.durationSeconds ?? lastRecordedSeconds.current}))}
            playhead={playhead} onSelect={select} onSeek={seek}/>
          <p className="ws-hint">Click a note to select that occurrence; click the ruler to seek. Scrolling never seeks. Drag a note to edit pitch, time or recorded length.</p>
        </section>

        <section className="ws-panel ws-surface" aria-label="Score">
          <ContinuousScore document={document} boxes={boxes} selectedOccurrenceId={selection?.occurrenceId ?? null}
            reveal={scoreReveal} onSelect={select}
            playheadTick={playheadTick} activeOccurrenceIds={activeIds}
            clock={clockRef.current} alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals}
            scrollTarget={scoreTarget} onSeekTick={seekToTick} onUserScroll={onScoreScroll}
            onGestureCommit={applyGestureEdit} onAuditionPitch={auditionPitch}
            editingEnabled={!replaceMode && !addMode}
            onAmbiguous={(logicalNoteId, occurrenceIds) => setNotice(
              `This written note maps ${occurrenceIds.length} occurrences; choose one in the roll (logical ${logicalNoteId}).`)}/>
          <p className="ws-hint">One continuous grand staff; the cursor is the mapped musical position. Click the ruler to seek, a notehead to select.</p>
        </section>

        {overlap && <section className="ws-panel" aria-label="Overlap picker" data-overlap="true">
          <h2>Overlapping {pitchName(overlap.pitch)} notes</h2>
          <div className="ws-row">
            {overlap.ids.map(id => {
              const note = document.performance.find(item => item.id === id);
              return note ? <button key={id} type="button" data-overlap-id={id}
                onClick={() => { select(id); setOverlap(null); }}>
                at {note.onset.toFixed(3)} s · {note.duration?.toFixed(2) ?? '?'} s
              </button> : null;
            })}
            <button type="button" onClick={() => setOverlap(null)}>Cancel</button>
          </div>
        </section>}
        <section className="ws-panel ws-surface" aria-label="Overview">
          <ClipOverview document={document} window={window} playhead={playhead}
            onWindowChange={next => changeWindow(next, 'user')}/>
        </section>
      </div>

      <aside className="ws-side" data-inspector-sheet={narrowViewport ? 'true' : 'false'}
        style={narrowViewport ? {position: 'sticky', bottom: 0, maxHeight: '44vh', overflow: 'auto', zIndex: 6,
          background: '#fff', borderTop: '1px solid #d5dbe3'} : undefined}>
        <section className="ws-panel" aria-label="Reference video">
          {videoUrl
            ? <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" className="ws-video"/>
            : <p className="ws-hint">This draft has no source video.</p>}
          {previewAsset ? <audio ref={pianoRef} src={preview.url || undefined} preload="auto"/> : null}
          <div className="ws-row" role="group" aria-label="Source audio">
            <button type="button" aria-pressed={audioMode === 'original'}
              className={audioMode === 'original' ? 'is-active' : ''}
              onClick={() => setAudioMode('original')}>Original</button>
            <button type="button" aria-pressed={audioMode === 'piano'}
              className={audioMode === 'piano' ? 'is-active' : ''}
              disabled={!preview.url || previewStale}
              title={previewStale ? 'The preview is stale: the notes changed since it was rendered'
                : preview.url ? 'Verified, mapped piano preview' : preview.error || 'Piano audio is not verified for this draft'}
              onClick={() => setAudioMode('piano')}>Piano</button>
            <span className="ws-hint" data-preview-state={previewStale ? 'stale' : preview.url ? 'verified' : 'unavailable'}>
              {previewStale
                ? 'Piano preview is stale: the notes changed since it was rendered. Original audio only.'
                : preview.url
                  ? 'Verified preview follows the video clock; it never free-runs.'
                  : preview.error
                    ? `Piano unavailable: ${preview.error} Original audio remains active.`
                    : previewAsset
                      ? 'Verifying piano audio… Original plays until it is verified.'
                      : 'No verified piano preview: Original audio only.'}
            </span>
          </div>
        </section>

        <section className="ws-panel" aria-label="Selected note">
          <h2>Selected note</h2>
          {!selection || !selected
            ? <p className="ws-hint">Select a note in the roll, the score or the keyboard to edit it.</p>
            : <fieldset className="ws-inspector-fieldset" disabled={Boolean(replaceMode) || Boolean(addMode)}>
              <p className="ws-facts">
                <strong>{selected.spelling}</strong> · {selection.occurrenceId} · {pitchName(selected.pitch)} (MIDI {selected.pitch})<br/>
                {selected.onset.toFixed(3)} s · recorded {selected.duration === null ? 'unknown' : `${selected.duration.toFixed(3)} s`}<br/>
                {selection.staff} voice {selection.voice} · measure {selection.measureIndex + 1} · written {selected.writtenTicks} ticks
              <br/><span data-written-segments="true">Written segments: {tiedSegmentCount} ({(selected.writtenTicks / 480).toFixed(2)} beats written)</span>
              <br/><span data-recorded-attacks="true">Recorded attacks mapped to this written note: {selected.linkedOccurrences}</span>
              {tiedSegmentCount > 1 && <>
                <br/><strong data-tie-scope="segments">This written note is tied across {tiedSegmentCount} segments; pitch replacement edits only the selected attack and splits the written note if several attacks share it.</strong>
              </>}
              {selected.linkedOccurrences > 1 && <>
                <br/><strong data-occurrence-scope="multiple">This written note owns {selected.linkedOccurrences} recorded attacks. “Delete note” removes the selected attack; “Delete logical note” removes the written note and every attack mapped to it.</strong>
              </>}
              </p>

              <div className="ws-row" role="group" aria-label="Pitch">
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: selection.occurrenceId, pitch: selected.pitch - 1}})}>− semitone</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: selection.occurrenceId, pitch: selected.pitch + 1}})}>+ semitone</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'apply-accidental', occurrenceId: selection.occurrenceId, accidental: 'sharp'}})}>♯</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'apply-accidental', occurrenceId: selection.occurrenceId, accidental: 'flat'}})}>♭</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'apply-accidental', occurrenceId: selection.occurrenceId, accidental: 'natural'}})}>♮</button>
                <button type="button" data-replace="start" disabled={Boolean(addMode)}
                  onClick={() => { setAddMode(null); setReplaceMode({occurrenceId: selection.occurrenceId, pitch: selected.pitch}); setNotice(''); }}>Replace pitch</button>
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

              <div className="ws-row" role="group" aria-label="Written beat position">
                <span className="ws-hint">Written position for</span>
                <button type="button" aria-pressed={writtenStartScope === 'note'} data-written-scope="note"
                  className={writtenStartScope === 'note' ? 'is-active' : ''}
                  onClick={() => setWrittenStartScope('note')}>This note</button>
                <button type="button" aria-pressed={writtenStartScope === 'event'} data-written-scope="event"
                  className={writtenStartScope === 'event' ? 'is-active' : ''}
                  onClick={() => setWrittenStartScope('event')}>Whole written event</button>
                <label className="ws-field ws-inline"><span>Written beat position (ticks)</span>
                  <input type="number" min={0} step={120} data-written-start
                    value={writtenStartDraft}
                    onChange={event => setWrittenStartDraft(event.target.value)}/>
                </label>
                <button type="button" data-written-start-apply disabled={!writtenStartDraft.trim()}
                  onClick={() => {
                    const ticks = Number(writtenStartDraft);
                    if (!Number.isInteger(ticks) || ticks < 0) { setNotice('Enter a whole, non-negative tick value.'); return; }
                    if (writtenStartScope === 'note' && selected.notesInEvent > 1) {
                      setNotice('Moving one chord member needs its own voice; choose “Whole written event” or split the note first.');
                      return;
                    }
                    const command = {type: 'move-written-start' as const, eventId: selection.eventId, ticks};
                    const outcome = applyCommand(state.document, command);
                    if (outcome.status === 'rejected') { setNotice(outcome.message); return; }
                    dispatch({type: 'command', command});
                    setNotice(outcome.status === 'unchanged' ? 'The written position is unchanged.' : 'Written position moved; recorded onset unchanged.');
                    setWrittenStartDraft('');
                  }}>Apply written position</button>
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
            </fieldset>}
        </section>

        <section className="ws-panel" aria-label="Insert">
          <h2>Insert</h2>
          <div className="ws-row">
            <button type="button" disabled={Boolean(replaceMode) || Boolean(addMode)}
              onClick={() => insertAtPlayhead(false)}>Add note at playhead</button>
            <button type="button" disabled={Boolean(replaceMode) || Boolean(addMode)}
              onClick={() => insertAtPlayhead(true)}>Add to chord</button>
          </div>
          <div className="ws-row">
            <button type="button" data-add="toggle" aria-pressed={Boolean(addMode)} disabled={Boolean(replaceMode)}
              onClick={() => {
                setDuplicateId(null);
                setReplaceMode(null);
                setAddMode(addMode ? null : {seconds: playhead - offsetSeconds, pitch: selected?.pitch ?? 60,
                  ticks: lastWrittenTicks.current, durationSeconds: lastRecordedSeconds.current});
              }}>{addMode ? 'Cancel add note' : 'Add note (place)'}</button>
          </div>
          {addMode && <div className="ws-add-panel" data-add="active">
            <p>New {pitchName(addMode.pitch)} at {addMode.seconds.toFixed(3)} s (recorded) · written {addMode.ticks} ticks ·
              click the roll to place it.</p>
            <div className="ws-row">
              <label className="ws-field ws-inline"><span>Recorded length (s)</span>
                <input type="number" step={0.01} min={0.02} max={document.duration} data-add="length"
                  value={addMode.durationSeconds}
                  onChange={event => setAddMode(mode => mode ? {...mode,
                    durationSeconds: Math.max(0.02, Number(event.target.value) || 0.02)} : mode)}/>
              </label>
              <label className="ws-field ws-inline"><span>Written value</span>
                <select data-add="written" value={addMode.ticks}
                  onChange={event => setAddMode(mode => mode ? {...mode, ticks: Number(event.target.value)} : mode)}>
                  {DURATION_CHOICES.map(choice => <option key={choice.ticks} value={choice.ticks}>{choice.label}</option>)}
                </select>
              </label>
              <button type="button" data-add="commit" onClick={commitAdd}>Insert</button>
              <button type="button" data-add="cancel"
                onClick={() => { setAddMode(null); setDuplicateId(null); setNotice('Add note cancelled.'); }}>Cancel</button>
            </div>
            {addProblem && <p className="ws-report is-bad" data-add="invalid">{addProblem}</p>}
            {ghostDuplicate && <p className="ws-report is-bad" data-add="duplicate">
              A {pitchName(addMode.pitch)} already starts here.
              <button type="button" onClick={() => { if (ghostDuplicateId) select(ghostDuplicateId); setAddMode(null); }}>Select existing</button>
            </p>}
          </div>}
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
            <button type="button" onClick={() => commitAnchors([], null)} disabled={!anchors.length}>Reset</button>
          </div>
          {anchors.map((anchor, index) => <p className="ws-hint" key={`${anchor.seconds}-${anchor.tick}-${index}`}>
            {anchor.seconds.toFixed(3)} s → tick {anchor.tick}{' '}
            <button type="button" onClick={() => removeAnchor(index)}>Remove</button>
          </p>)}
          {anchorPreview && <p className="ws-report">{anchorPreview}</p>}
          <p className="ws-hint">Applied anchors shape the score map and are saved with the review.</p>
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
    writtenStartTicks: event?.start ?? 0,
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
