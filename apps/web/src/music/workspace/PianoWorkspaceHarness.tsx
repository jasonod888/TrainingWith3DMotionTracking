/**
 * Developer harness for the correction workspace.
 *
 * Phase 3: the readable layout — keyboard above a ten-second time roll, a continuous
 * horizontally scrollable grand staff below, a whole-clip overview, and the smaller
 * reference video and inspector alongside. Isolated from the review workflow; it
 * loads the same draft through the same API and writes nothing.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createEditorSession} from '../../editor/editor-session';
import {
  ArrowLeft, ChevronRight, Mic, MicOff, MoreHorizontal, Pause, Play, Redo2, RotateCcw, Settings as SettingsIcon, Undo2, Video, Volume2, X,
} from 'lucide-react';
import {PracticePlayerDock} from '../../PracticePlayerDock';
import {PianoPracticeWorkspace} from './PianoPracticeWorkspace';
// Compatibility shim: the practice implementation is its own module and the Act
// practice entry imports it directly. Existing callers that still import it from
// the harness keep working without pulling the editor into the practice graph.
export {PianoPracticeWorkspace};
import {PracticePanel} from '../../PracticePanel';
import {
  PracticeSettingsProvider, SettingsChoices, SettingsGroup, SettingsRow,
} from '../../PracticeSettings';
import '../../practice.css';
import '../../practice-player.css';
import {assetUrl, getSession, request} from '../../api';
import {classifySaveError, privateSaveMessage, saveReviewedReference, startReviewLoad,
  type ReviewManifestDocument} from './editor-services';
import {parseMusicDraftView} from '../../../../../packages/lesson-schema/parse';
import {
  applyCommand, buildNotation, parseNotationDocument, selectionForOccurrence,
  activeOccurrenceIds, alignmentFromSpans, effectiveSecondsToTick, occurrenceIntervals,
  addAnchor, applyAnchors, scoreClock, secondsToTick, tickToEffectiveSeconds, tickToSeconds, toMusicXML, keyLabel, type AnchorPoint,
  type Alignment, type CorrectionSelection, type NotationDocument,
  withHandAssignments, type Hand,
} from '../../../../../packages/music-notation/index.ts';
import {useHandAssignments} from './useHandAssignments';
import {pitchName} from '../music-reference';
import {assessmentPolicyForSubject, effectiveFeedbackEnabled} from '../music-feedback';
import {buildTimelineLayout, clampScroll, heldPassageAt, type TimelineLayout} from './timeline-layout';
import {KeyboardEditor} from '../notation/KeyboardEditor';import {
  clampStandardPianoWindow, FULL_PIANO_MIN_WIDTH, isStandardPianoRange,
  narrowSemitonesForWidth, resolveKeyboardRange, STANDARD_PIANO_RANGE, type PianoRange,
} from '../notation/piano-key-geometry';
import {NotationAudio} from '../notation/notation-audio';
import {downloadMidiFile, exportPerformanceToMidi} from '../midi-export';
import {
  buildPracticeChunks, chunkAtTime, parseVoiceCommand,
  type ChunkBarsOption, type PracticeChunk, type PracticeVoiceCommand,
} from '../practice-chunks';
import {usePianoSourcePlayer} from '../usePianoSourcePlayer';
import {usePianoPerformanceAudio} from './usePianoPerformanceAudio';
import {usePianoPreviewAsset} from '../usePianoPreviewAsset';
import {
  decideVerification, findingDecision, loadVerification, parseVerificationState,
  type VerificationFinding, type VerificationState,
} from '../verification';
import {
  invertFinding, prepareFinding, type AcceptedBaseline,
} from './verification-transaction';
import type {Asset, MusicPedalSpan} from '../../../../../packages/lesson-schema/index';
import {ClipOverview} from './ClipOverview';
import {ContinuousScore} from './ContinuousScore';
import {PianoWaterfall} from './PianoWaterfall';
import {TimeRoll} from './TimeRoll';
import {
  clampTimeWindow, DEFAULT_SPAN_SECONDS, layoutMeasures, zoomAround, type TimeWindow,
} from './viewport';import {
  createWorkspaceState, historyIdentity, historySummary, workspaceReducer, workspaceStatus,
  type WorkspaceAction, type WorkspaceState,
} from './workspace-state';
import {
  buildWorkspaceExport, interactiveLimitApproved, resolveInteractionPolicy, serializeWorkspaceExport,
} from './interactive-limit';
import {useElementWidth} from './useElementWidth';
import {FormattedScore} from './FormattedScore';
import {createClock, useClockTime, type ClockStore} from './clock';
import type {GestureEdit} from './gestures';
import {
  buildSaveBody, canonicalAnchors, insertionPlacement, performanceChanged, restoreFromReference, serializeAlignment,
  type SavedGuitarChord, type SavedSpan,
} from './save-payload';
import {GuitarChordStrumHud} from './GuitarChordStrumHud';
import GuitarNeckGuide from '../renderers/GuitarNeckGuide';
import {detectGuitarChords} from './guitar-chords';
import {instrumentAdapter} from './instrument-adapters';
import {
  GUITAR_TUNINGS, assignGuitarFingers, normalizeGuitarSetup,
  openStringPitch, resolveGuitarPosition, type GuitarFinger, type GuitarTuningId,
} from '../../../../../packages/music-notation/guitar.ts';
import {
  clearRecovery, peekRecovery, readRecovery, salvageGuitarChords, sanitizeGuitarChords, writeRecovery,
  type RecoveryCheckpoint, type RecoveryIdentity,
} from './recovery';

/** Stable default order; a future layout descriptor may reorder these modules only. */
const DEFAULT_STAGE_LAYOUT = ['instrument', 'roll', 'sheet'] as const;

const DURATION_CHOICES = [  {label: 'Whole', ticks: 1920},
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

function timeLabel(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: {results: ArrayLike<ArrayLike<{transcript: string}>>}) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

/** Display-only title; the saved/source title is never rewritten. */
function displayPieceTitle(raw: string): string {
  const clean = raw.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Piano review';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

type CompactView = 'guide' | 'sheet';
const COMPACT_VIEW_STORAGE = 'piano-review-compact-view-v1';

function readCompactView(): CompactView {
  try {
    if (typeof globalThis.localStorage === 'undefined') return 'guide';
    return globalThis.localStorage.getItem(COMPACT_VIEW_STORAGE) === 'sheet' ? 'sheet' : 'guide';
  } catch {
    return 'guide';
  }
}

function writeCompactView(view: CompactView): void {
  try {
    globalThis.localStorage?.setItem(COMPACT_VIEW_STORAGE, view);
  } catch { /* UI preference only */ }
}

/** Limited available height, not orientation alone. Safe when matchMedia is absent. */
function useLimitedHeight(): boolean {
  const query = () => typeof globalThis.window?.matchMedia === 'function'
    ? globalThis.window.matchMedia('(max-height: 560px)') : null;
  const [limited, setLimited] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const media = query();
    if (!media) return;
    const update = () => setLimited(media.matches);
    update();
    media.addEventListener?.('change', update);
    media.addListener?.(update);
    return () => {
      media.removeEventListener?.('change', update);
      media.removeListener?.(update);
    };
  }, []);
  return limited;
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

export function PianoWorkspaceHarness(props: {
  lessonId?: string;
  /** Normal review route: hide harness-only labels and demo affordances. */
  embedded?: boolean;
  mode?: 'review' | 'practice' | 'challenge';
  challengeEnabled?: boolean;
  challengeHistoryEnabled?: boolean;
  audioAssessmentEnabled?: boolean;
  onModeChange?: (mode: 'watch' | 'practice' | 'compete') => void;
  lessonTitle?: string;
  onBack?: () => void;
  /** Mirrors workspace dirty state to the app router/navigation guards. */
  onDirty?: (dirty: boolean) => void;
  /** Receives the revision and whether it represents the current work. */
  onSaved?: (revisionId: string, current: boolean) => void;
} = {}) {
  if ((props.mode ?? 'review') === 'practice' || props.mode === 'challenge') {
    return <PianoPracticeWorkspace lessonId={props.lessonId} lessonTitle={props.lessonTitle}
      embedded={props.embedded} challengeMode={props.mode === 'challenge'}
      challengeAvailable={props.challengeEnabled===true}
      challengeHistoryEnabled={props.challengeHistoryEnabled===true}
      audioAssessmentEnabled={props.audioAssessmentEnabled===true}
      onBack={props.onBack} onModeChange={props.onModeChange}/>;
  }
  return <PianoReviewWorkspace {...props} mode="review"/>;
}

function PianoReviewWorkspace({lessonId: lessonIdProp, embedded = false, mode = 'review', lessonTitle, onBack, onDirty, onSaved}: {
  lessonId?: string;
  /** Normal review route: hide harness-only labels and demo affordances. */
  embedded?: boolean;
  mode?: 'review' | 'practice';
  lessonTitle?: string;
  onBack?: () => void;
  /** Mirrors workspace dirty state to the app router/navigation guards. */
  onDirty?: (dirty: boolean) => void;
  /** Receives the revision and whether it represents the current work. */
  onSaved?: (revisionId: string, current: boolean) => void;
} = {}) {
  const params = new URLSearchParams(location.search);
  const lessonId = lessonIdProp ?? params.get('id') ?? '';
  const isPractice = mode === 'practice';

  const [state, setState] = useState<WorkspaceState | null>(null);
  const [scoreMode, setScoreMode] = useState<'correction' | 'formatted'>('correction');
  const [rollOpen, setRollOpen] = useState(false);
  const scoreModeRef = useRef<'correction' | 'formatted'>('correction');
  scoreModeRef.current = scoreMode;
  /** Bumped when a document is replaced outside the undo history. */
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const snapshotRef = useRef<{document: NotationDocument | null; selection: unknown; dirty: boolean;
    past: number; future: number} | null>(null);
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
  const readOnlyRef = useRef(false);
  const [follow, setFollow] = useState(true);
  const [followSuspended, setFollowSuspended] = useState(false);
  const [gestureLock, setGestureLock] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [sharedScrollLeft, setSharedScrollLeft] = useState(0);
  const [sharedWidth, setSharedWidth] = useState(0);
  const [seekToken, setSeekToken] = useState(0);
  const lastSeekToken = useRef(0);
  const sharedBarRef = useRef<HTMLDivElement>(null);
  const commandedScroll = useRef(0);
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
  const emptyPianoRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<NotationAudio | null>(null);
  /** Latest render's "playback started" handler, used by the native media event. */
  const playbackStart = useRef<() => void>(() => {});
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [pedalSpans, setPedalSpans] = useState<MusicPedalSpan[]>([]);
  const [rawModelDraft, setRawModelDraft] = useState(false);
  const [previewIdentity, setPreviewIdentity] = useState('');
  const [audioMode, setAudioMode] = useState<'original' | 'piano'>('original');
  const [preferRenderedWav, setPreferRenderedWav] = useState(false);
  const [pipOpen, setPipOpen] = useState(() => mode === 'practice');
  const [pipPos, setPipPos] = useState<{left: number; top: number} | null>(null);
  const [chunkBars, setChunkBars] = useState<ChunkBarsOption>(() => mode === 'practice' ? 2 : 0);
  const [activeChunkIndex, setActiveChunkIndex] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'off' | 'listening' | 'unsupported'>('off');
  const [practiceStarted, setPracticeStarted] = useState(false);
  const [chunkPickerOpen, setChunkPickerOpen] = useState(false);
  const [practicePanel, setPracticePanel] = useState<'settings' | 'sections' | null>(null);
  const [settingsRow, setSettingsRow] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const practiceCommandSeek = useRef(false);
  const autoPausedChunk = useRef<number | null>(null);
  const hasWebAudio = typeof globalThis.window !== 'undefined'
    && Boolean(globalThis.window.AudioContext
      || (globalThis.window as typeof globalThis.window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext);
  // Bytes and SHA-256 are verified before Piano may be enabled; a pending or failed
  // asset keeps Original audio and never exposes a URL.
  const preview = usePianoPreviewAsset(previewAsset);
  const [keyboardRef, keyboardWidth] = useElementWidth<HTMLDivElement>();
  const compactKeyboard = keyboardWidth > 0 && keyboardWidth < 720;
  const tinyKeyboard = keyboardWidth > 0 && keyboardWidth < 520;
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
  const [assessmentPolicy, setAssessmentPolicy] = useState<'none' | 'notes'>('notes');
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const limitedHeight = useLimitedHeight();
  const [compactPreference, setCompactPreference] = useState<CompactView>(readCompactView);
  const [drawerTarget, setDrawerTarget] = useState<'settings' | 'more' | 'video' | 'sound' | 'note'>('settings');
  const [noteEditorExpanded, setNoteEditorExpanded] = useState(false);
  const [noteAdvancedOpen, setNoteAdvancedOpen] = useState(false);
  const [notePeekPosition, setNotePeekPosition] = useState<'top' | 'bottom'>('bottom');
  const [settingsTab, setSettingsTab] = useState<'view' | 'editing' | 'lesson' | 'timing' | 'more'>('view');
  const [pitchPickMode, setPitchPickMode] = useState<{occurrenceId: string; pitch: number} | null>(null);
  // Guitar uses the same document/state/transport; only these instrument-specific
  // surfaces and preferences are additional.
  const [guitarChords, setGuitarChords] = useState<SavedGuitarChord[]>([]);
  /** Serialized chord baseline for the explicit chords-dirty flag and recovery. */
  const savedChordsRef = useRef('[]');
  /** Last collection that passed sanitization, used to salvage recovery writes. */
  const lastValidChordsRef = useRef<SavedGuitarChord[]>([]);
  const [guitarTone, setGuitarTone] = useState(25);
  const [guitarHandedness, setGuitarHandedness] = useState<'right' | 'left'>('right');
  const [rollMode, setRollMode] = useState<'pitch' | 'strings'>('pitch');
  const [staffMode, setStaffMode] = useState<'grand' | 'guitar-tab' | 'guitar-both'>('grand');
  const [fretPickMode, setFretPickMode] = useState<string | null>(null);
  const [fretDraft, setFretDraft] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const reviewRef = useRef<HTMLDivElement | null>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const noteRevealSelection = useRef<string | null>(null);
  const drawerReturn = useRef<HTMLElement | null>(null);
  const addMenuReturn = useRef<HTMLElement | null>(null);
  const modeReturnFocus = useRef<HTMLElement | null>(null);
  const modeWasActive = useRef(false);
  const selectionReference = useRef<{occurrenceId: string; element: HTMLElement} | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveConflict, setSaveConflict] = useState(false);
  const [conflictKind, setConflictKind] = useState<'stale'|'verification'|'other'>('other');
  const [editorSession] = useState(() => createEditorSession({
    state: 'saved-private', revisionId: lessonIdProp ?? undefined, reviewed: true,
  }));
  const [reopenMessage, setReopenMessage] = useState('');
  const [recoveryOffer, setRecoveryOffer] = useState<RecoveryCheckpoint | null>(null);
  const [staleCheckpoint, setStaleCheckpoint] = useState<RecoveryCheckpoint | null>(null);
  const [replaceMode, setReplaceMode] = useState<{occurrenceId: string; pitch: number} | null>(null);
  const [addMode, setAddMode] = useState<{seconds: number; pitch: number; ticks: number; durationSeconds: number} | null>(null);
  const noteModeActive = Boolean(pitchPickMode || replaceMode);
  const compactLayoutActive = limitedHeight && !addMode;
  const compactPlaceLayout = limitedHeight && Boolean(addMode);
  const stageView = compactPlaceLayout ? 'place' : compactLayoutActive ? compactPreference : 'regular';
  const rollVisible = rollOpen || (limitedHeight && Boolean(addMode));
  const compactPlaceNotice = useRef(false);
  const chooseCompactView = useCallback((view: CompactView) => {
    setCompactPreference(view);
    writeCompactView(view);
  }, []);
  useEffect(() => {
    if (limitedHeight && addMode && !compactPlaceNotice.current) {
      compactPlaceNotice.current = true;
      setNotice('Editing roll opened temporarily for placement. It will close after Insert or Cancel.');
    }
    if (!addMode) compactPlaceNotice.current = false;
  }, [addMode, limitedHeight]);
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

  const openDrawer = useCallback((target: typeof drawerTarget, tab?: typeof settingsTab) => {
    drawerReturn.current = globalThis.document.activeElement as HTMLElement | null;
    modeWasActive.current = false;
    modeReturnFocus.current = null;
    setReplaceMode(null);
    setAddMode(null);
    setDuplicateId(null);
    setDrawerTarget(target);
    setDrawerOpen(true);
    if (target === 'settings') setSettingsTab(tab ?? 'view');
    setAddMenuOpen(false);
    setReviewOpen(false);
    setPitchPickMode(null);
  }, []);

  const openAddMenu = useCallback(() => {
    addMenuReturn.current = globalThis.document.activeElement as HTMLElement | null;
    modeWasActive.current = false;
    modeReturnFocus.current = null;
    setReplaceMode(null);
    setAddMode(null);
    setDuplicateId(null);
    setAddMenuOpen(true);
    setDrawerOpen(false);
    setReviewOpen(false);
    setPitchPickMode(null);
  }, []);

  useEffect(() => {
    if (noteModeActive) {
      modeWasActive.current = true;
      return;
    }
    if (!modeWasActive.current) return;
    modeWasActive.current = false;
    const target = modeReturnFocus.current;
    modeReturnFocus.current = null;
    target?.focus?.();
  }, [noteModeActive]);

  useEffect(() => {
    if (drawerOpen) return;
    const target = drawerReturn.current;
    drawerReturn.current = null;
    target?.focus?.();
  }, [drawerOpen]);

  useEffect(() => {
    if (addMenuOpen) return;
    const target = addMenuReturn.current;
    addMenuReturn.current = null;
    target?.focus?.();
  }, [addMenuOpen]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setAddMenuOpen(false); };
    globalThis.window.addEventListener('keydown', onKey);
    return () => globalThis.window.removeEventListener('keydown', onKey);
  }, [addMenuOpen]);

  useEffect(() => {
    if (!reviewOpen) return;
    const previous = globalThis.document.activeElement as HTMLElement | null;
    const dialog = reviewRef.current;
    dialog?.querySelector<HTMLElement>('[data-review-focus="true"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setReviewOpen(false); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    globalThis.window.addEventListener('keydown', onKey, true);
    return () => {
      globalThis.window.removeEventListener('keydown', onKey, true);
      (previous ?? reviewTrigger.current)?.focus?.();
    };
  }, [reviewOpen]);

  useEffect(() => {
    if (!reviewOpen || !saveAttempted) return;
    if (saveMessage || saveError || saveConflict) {
      setReviewOpen(false);
      setSaveAttempted(false);
    }
  }, [reviewOpen, saveAttempted, saveMessage, saveError, saveConflict]);

  useEffect(() => {
    if (!drawerOpen) return;
    const section = drawerRef.current?.querySelector<HTMLElement>(`[data-ws-section="${drawerTarget}"]`);
    section?.scrollIntoView?.({block: 'start'});
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A mode owns Escape before the surrounding inspector does.
      if (pitchPickMode) {
        setPitchPickMode(null);
        setNotice('Pitch selection cancelled.');
        return;
      }
      if (replaceMode) {
        setReplaceMode(null);
        setNotice('Replacement cancelled.');
        return;
      }
      if (addMode) {
        setAddMode(null);
        setDuplicateId(null);
        setNotice('Add note cancelled.');
        return;
      }
      setDrawerOpen(false);
    };
    globalThis.window.addEventListener('keydown', onKey);
    return () => globalThis.window.removeEventListener('keydown', onKey);
  }, [drawerOpen, drawerTarget, pitchPickMode, replaceMode, addMode]);

  useEffect(() => {
    const occurrenceId = state?.selection?.occurrenceId ?? null;
    if (!drawerOpen || drawerTarget !== 'note' || !occurrenceId || noteEditorExpanded) return;
    const update = () => {
      const candidates = [...globalThis.document.querySelectorAll<HTMLElement>(
        '.ws-roll-note[data-occurrence], .ws-score-notehead[data-occurrence]')]
        .filter(element => element.getAttribute('data-occurrence') === occurrenceId);
      const referenced = selectionReference.current?.occurrenceId === occurrenceId
        ? selectionReference.current.element : null;
      const score = candidates.find(element => element.classList.contains('ws-score-notehead'));
      const ordered = referenced ? [referenced, ...candidates.filter(item => item !== referenced)]
        : [...(score ? [score] : []), ...candidates.filter(item => item !== score)];
      const rect = ordered.map(element => element.getBoundingClientRect?.())
        .find(item => item && item.width > 0 && item.height > 0);
      if (rect) setNotePeekPosition(notePeekPositionFor(rect, globalThis.window.innerHeight));
    };
    update();
    globalThis.window.addEventListener('resize', update);
    return () => globalThis.window.removeEventListener('resize', update);
  }, [drawerOpen, drawerTarget, state?.selection?.occurrenceId, noteEditorExpanded, rollOpen,
    sharedScrollLeft, sharedWidth]);

  const dispatch = useCallback((action: WorkspaceAction) => {
    setState(previous => (previous ? workspaceReducer(previous, action) : previous));
  }, []);

  const document = state?.document ?? null;
  const guitar = instrumentAdapter(document?.subject)?.supportsTab ?? false;
  const activeSetup = normalizeGuitarSetup({tuning: document?.guitar_tuning, capo: document?.guitar_capo});
  useEffect(() => {
    if (!document) return;
    setRollMode(document.subject === 'guitar' ? 'strings' : 'pitch');
    setStaffMode(document.subject === 'guitar' ? 'guitar-both' : 'grand');
  }, [document?.subject, documentEpoch]);
  const guitarFingers = useMemo<Record<string, GuitarFinger>>(() => document?.subject === 'guitar'
    ? assignGuitarFingers(document.performance, activeSetup) : {},
    [document, activeSetup.tuning, activeSetup.capo]);
  /** Playable position for an occurrence, or null when the tuning/capo cannot reach it. */
  const positionOf = (note: {pitch: number; string: number | null; fret: number | null}) => {
    return resolveGuitarPosition(note.pitch, note.string, note.fret, activeSetup);
  };
  const previewStale = Boolean(previewBaseline && document && performanceChanged(previewBaseline, document));
  const verifyingPreview = Boolean(previewAsset && !preview.url && !preview.error);
  const verifiedPreview = Boolean(previewAsset && preview.url && !previewStale);
  const useWavPreview = verifiedPreview && (!hasWebAudio || preferRenderedWav);
  const livePiano = audioMode === 'piano' && !useWavPreview && !verifyingPreview;
  const pianoDisabled = verifyingPreview || Boolean(previewAsset && !preview.url) || !document?.performance.length;
  const pianoTitle = verifyingPreview ? 'Verifying piano audio…'
    : previewAsset && !preview.url ? preview.error || 'The verified piano WAV is unavailable'
    : livePiano ? 'Live Web Audio grand piano from the score and sustain pedal'
    : useWavPreview ? 'Rendered piano preview WAV'
    : previewStale ? 'Notes changed since the WAV preview; Piano now plays live synthesized notes from the edited score'
    : 'Piano plays live synthesized grand piano notes from the score';
  const liveMidiBytes = useMemo(
    () => document ? exportPerformanceToMidi(document.performance, pedalSpans, {
      subject: document.subject, program: document.subject === 'guitar' ? guitarTone : 0,
    }) : null,
    [document, pedalSpans, guitarTone]);
  const interactionPolicy = document
    ? resolveInteractionPolicy(document.performance.length, interactiveLimitApproved())
    : {mode: 'read-only' as const, reason: 'The score is not ready.'};
  const readOnly = isPractice || interactionPolicy.mode === 'read-only';
  readOnlyRef.current = readOnly;
  const hands = useHandAssignments(document, lessonId,
    Boolean(lessonId) && !readOnly && !params.get('demo'));
  const keyboardPitches = useMemo(
    () => document ? document.performance.map(note => note.pitch) : [],
    [document],
  );
  const [narrowFirst, setNarrowFirst] = useState<number | null>(null);
  const previousNarrowWindow = useRef<number | null>(null);
  const fullPiano = keyboardWidth >= FULL_PIANO_MIN_WIDTH;
  const narrowWindow = narrowSemitonesForWidth(keyboardWidth);
  const fallbackNarrow = clampStandardPianoWindow(
    resolveKeyboardRange(keyboardPitches, keyboardWidth, 0, narrowWindow).firstPitch,
    narrowWindow,
  );
  useEffect(() => {
    if (!document || keyboardWidth <= 0) return;
    if (fullPiano) {
      previousNarrowWindow.current = null;
      return;
    }
    setNarrowFirst(current => {
      let next = current;
      if (next === null) {
        next = fallbackNarrow.firstPitch;
      } else if (previousNarrowWindow.current !== null && previousNarrowWindow.current !== narrowWindow) {
        next += Math.round((previousNarrowWindow.current - narrowWindow) / 2);
      }
      return clampStandardPianoWindow(next, narrowWindow).firstPitch;
    });
    previousNarrowWindow.current = narrowWindow;
  }, [document, keyboardPitches, keyboardWidth, fullPiano, narrowWindow, fallbackNarrow.firstPitch]);
  const keyboardRange: PianoRange | null = fullPiano
    ? STANDARD_PIANO_RANGE
    : keyboardWidth > 0
      ? {firstPitch: narrowFirst ?? fallbackNarrow.firstPitch, semitones: narrowWindow}
      : null;
  const handleKeyboardRangeChange = useCallback((next: PianoRange) => {
    setNarrowFirst(clampStandardPianoWindow(next.firstPitch, next.semitones).firstPitch);
  }, []);
  const keyboardRangeLabel = keyboardRange
    ? isStandardPianoRange(keyboardRange)
      ? 'A0–C8 · 88 keys'
      : `A0–C8 · ${pitchName(keyboardRange.firstPitch)}–${pitchName(keyboardRange.firstPitch + keyboardRange.semitones)}`
    : '';
  const timelineLayout = useMemo(() => document ? buildTimelineLayout(document, zoomFactor) : null, [document, zoomFactor]);
  const timelineWidth = timelineLayout ? timelineLayout.contentWidth : 0;
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
      setPedalSpans([]);
      setRawModelDraft(false);
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

  useEffect(() => () => {
    audioRef.current?.dispose();
  }, []);

  // The existing source-driven controller for a verified WAV preview. Live synthesis has
  // its own source-clock scheduler and must not bind an empty/stale audio element.
  const player = usePianoSourcePlayer(videoRef, livePiano ? emptyPianoRef : pianoRef,
    livePiano ? 'original' : audioMode, offsetSeconds, previewIdentity,
    () => setNotice('Piano audio is unavailable. The original video keeps playing.'));

  // Audition yields to real playback and to a source-mode change.
  useEffect(() => { if (playing) audioRef.current?.stop(); }, [playing]);
  useEffect(() => {
    if (previewAsset && !preview.url && audioMode === 'piano') setAudioMode('original');
  }, [previewAsset, preview.url, audioMode]);
  // A controller failure visibly returns the source audio, never a silent Piano.
  useEffect(() => {
    if (!livePiano && player.error && audioMode === 'piano') setAudioMode('original');
  }, [player.error, audioMode, livePiano]);
  useEffect(() => { audioRef.current?.stop(); }, [audioMode]);

  const audition = useCallback((pitches: number[], seconds = 0.5, velocity?: number | null) => {
    if (!pitches.length) return;
    audioRef.current ??= new NotationAudio();
    audioRef.current.play(pitches, Math.max(0.12, Math.min(2, seconds)), velocity ?? 0.7);
  }, []);

  // The proven performance-audio hook owns live grand/MIDI playback, source mute,
  // volume, onset timing and seek/buffer reset for review and practice alike.
  usePianoPerformanceAudio({
    document, videoRef, clock: clockRef.current, livePiano, offsetSeconds,
    pedalSpans, rate, volume, rawModelDraft, guitarProgram: guitarTone,
  });

  const seek = useCallback((seconds: number) => {
    const media = videoRef.current;
    const clamped = Math.max(0, Math.min(state?.document.duration ?? seconds, seconds));
    setPlayhead(clamped);
    clockRef.current.set(clamped);
    setSeekToken(token => token + 1);
    if (media) media.currentTime = clamped;
  }, [state?.document.duration]);

  const select = useCallback((occurrenceId: string | null) => {
    setNotice('');
    dispatch({type: 'select', occurrenceId});
    if (!occurrenceId) {
      selectionReference.current = null;
      setDrawerOpen(false);
      setPitchPickMode(null);
      return;
    }
    videoRef.current?.pause();
    // Clicking a note seeks to its exact effective onset, never a score approximation.
    const note = state?.document.performance.find(item => item.id === occurrenceId);
    if (note) seek(note.onset + offsetSeconds);
    requestReveal(occurrenceId);
    // A stable overlay: opening it does not resize the stage under an active drag.
    const candidates = [...globalThis.document.querySelectorAll<HTMLElement>(
      '.ws-roll-note[data-occurrence], .ws-score-notehead[data-occurrence]')]
      .filter(element => element.getAttribute('data-occurrence') === occurrenceId);
    const referenced = selectionReference.current?.occurrenceId === occurrenceId
      ? selectionReference.current.element : null;
    const score = candidates.find(element => element.classList.contains('ws-score-notehead'));
    const ordered = referenced ? [referenced, ...candidates.filter(item => item !== referenced)]
      : [...(score ? [score] : []), ...candidates.filter(item => item !== score)];
    const selectedElement = ordered.find(element => {
      const rect = element.getBoundingClientRect?.();
      return Boolean(rect && rect.width > 0 && rect.height > 0);
    }) ?? ordered[0] ?? null;
    drawerReturn.current = selectedElement;
    const rect = selectedElement?.getBoundingClientRect?.();
    setNotePeekPosition(notePeekPositionFor(rect, globalThis.window.innerHeight));
    setDrawerTarget('note');
    setDrawerOpen(true);
    setNoteEditorExpanded(current => {
      const sameOpenNote = drawerOpen && drawerTarget === 'note'
        && state?.selection?.occurrenceId === occurrenceId;
      return sameOpenNote ? current : false;
    });
    setNoteAdvancedOpen(current => {
      const sameOpenNote = drawerOpen && drawerTarget === 'note'
        && state?.selection?.occurrenceId === occurrenceId;
      return sameOpenNote ? current : false;
    });
    setAddMenuOpen(false);
    setReviewOpen(false);
    setPitchPickMode(null);
    setReplaceMode(null);
    setAddMode(null);
    setDuplicateId(null);
    modeWasActive.current = false;
    modeReturnFocus.current = null;
  }, [dispatch, offsetSeconds, requestReveal, seek, state?.document, drawerOpen, drawerTarget,
    state?.selection?.occurrenceId]);

  const applyGestureEdit = useCallback((edit: GestureEdit) => {
    if (scoreModeRef.current === 'formatted') return;
    if (!document) return;
    if (edit.kind === 'pitch') {
      dispatch({type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: edit.occurrenceId,
        pitch: edit.pitch, ...(edit.spelling ? {spelling: edit.spelling} : {})}});
    } else if (edit.kind === 'time') {
      dispatch({type: 'command', command: {type: 'set-occurrence-onset', occurrenceId: edit.occurrenceId,
        seconds: edit.seconds}});
    } else if (edit.kind === 'position') {
      dispatch({type: 'command', command: {type: 'set-guitar-position', occurrenceId: edit.occurrenceId,
        string: edit.string, fret: edit.fret}});
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
      if (scoreModeRef.current === 'formatted' || readOnlyRef.current) return;
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

  // Guitar editor shortcut: with a note selected and focus outside a field, digits
  // 0-9 type the fret directly on the note's current string.
  useEffect(() => {
    if (!guitar || readOnly || !selection || !document) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey
        || event.defaultPrevented || event.isComposing) return;
      if (!/^[0-9]$/.test(event.key)) return;
      const target = event.target as Element | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (globalThis.document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const occurrence = document.performance.find(item => item.id === selection.occurrenceId);
      if (!occurrence) return;
      const position = positionOf(occurrence);
      if (!position) {
        setNotice('This note has no playable position under the current tuning and capo.');
        return;
      }
      event.preventDefault();
      dispatch({type: 'command', command: {type: 'set-guitar-position',
        occurrenceId: selection.occurrenceId, string: position.string, fret: Number(event.key)}});
      setNotice(`Fret ${event.key} on string ${position.string}.`);
    };
    globalThis.window.addEventListener('keydown', onKey);
    return () => globalThis.window.removeEventListener('keydown', onKey);
  }, [guitar, readOnly, selection?.occurrenceId, document, dispatch]);
  const editorSuppressed = Boolean(pitchPickMode || replaceMode || addMode);
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
      if (scoreModeRef.current === 'formatted' || readOnlyRef.current) return;
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
  const chunks = useMemo(() => (isPractice && document && alignment && chunkBars > 0)
    ? buildPracticeChunks(document.measures, alignment, offsetSeconds, document.duration, chunkBars)
    : [], [isPractice, document, alignment, offsetSeconds, chunkBars]);
  const timelineSections = useMemo(() => chunks.length
    ? chunks.map((chunk, index) => ({
      id: `chunk-${index}`, label: chunk.label, start: chunk.start, end: chunk.end,
    }))
    : document ? [{id: 'all', label: 'Whole piece', start: 0, end: document.duration}] : [],
    [chunks, document]);
  const practiceTimelineIndex = Math.min(activeChunkIndex, Math.max(0, timelineSections.length - 1));

  const runPracticeCommand = useCallback((command: PracticeVoiceCommand) => {
    if (!isPractice) return;
    const video = videoRef.current;
    if (command === 'play') { void video?.play().catch(() => {}); return; }
    if (command === 'pause') { video?.pause(); return; }
    if (!chunks.length) return;
    let index = activeChunkIndex;
    if (command === 'next') index = Math.min(chunks.length - 1, index + 1);
    else if (command === 'back') index = Math.max(0, index - 1);
    if (command !== 'again') setActiveChunkIndex(index);
    practiceCommandSeek.current = true;
    globalThis.setTimeout(() => { practiceCommandSeek.current = false; }, 150);
    seek(chunks[index].start);
    void video?.play().catch(() => {});
  }, [isPractice, chunks, activeChunkIndex, seek]);

  const startPracticePlayback = useCallback((voice: 'keep' | 'off') => {
    if (!isPractice) return;
    setPracticeStarted(true);
    if (voice === 'off') setVoiceEnabled(false);
    if (chunks.length) {
      setActiveChunkIndex(0);
      practiceCommandSeek.current = true;
      globalThis.setTimeout(() => { practiceCommandSeek.current = false; }, 150);
      seek(chunks[0].start);
    }
    void videoRef.current?.play().catch(() => {});
  }, [isPractice, chunks, seek]);

  useEffect(() => {
    if (!isPractice || playing || !chunks.length) return;
    if (autoPausedChunk.current === activeChunkIndex) { autoPausedChunk.current = null; return; }
    setActiveChunkIndex(chunkAtTime(chunks, playhead));
  }, [isPractice, playing, chunks, playhead, activeChunkIndex]);

  useEffect(() => {
    if (!isPractice || !playing || !chunks.length) return;
    const chunk = chunks[Math.min(activeChunkIndex, chunks.length - 1)];
    if (!chunk) return;
    let paused = false;
    return clockRef.current.subscribe(() => {
      if (paused || clockRef.current.get() < chunk.end - 0.02) return;
      if (practiceCommandSeek.current) return;
      paused = true;
      autoPausedChunk.current = activeChunkIndex;
      videoRef.current?.pause();
      seek(chunk.end);
    });
  }, [isPractice, playing, chunks, activeChunkIndex, rate, offsetSeconds, seek]);

  useEffect(() => {
    if (!isPractice || !chunks.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); runPracticeCommand('next'); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); runPracticeCommand('back'); }
      else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); runPracticeCommand('again'); }
    };
    globalThis.window.addEventListener('keydown', onKey);
    return () => globalThis.window.removeEventListener('keydown', onKey);
  }, [isPractice, chunks.length, runPracticeCommand]);

  useEffect(() => {
    if (!isPractice || !voiceEnabled) { setVoiceStatus('off'); return; }
    const speechWindow = globalThis.window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (typeof Recognition !== 'function') { setVoiceStatus('unsupported'); return; }
    let disposed = false;
    let failed = false;
    let recognition: SpeechRecognitionLike | null = null;
    try {
      recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.onresult = event => {
        if (disposed || playing) return;
        const result = event.results[event.results.length - 1];
        const transcript = result?.[0]?.transcript ?? '';
        const command = parseVoiceCommand(transcript);
        if (command) runPracticeCommand(command);
      };
      recognition.onerror = () => { failed = true; if (!disposed) setVoiceStatus('off'); };
      recognition.onend = () => {
        if (disposed || failed || !voiceEnabled) return;
        try { recognition?.start(); } catch { setVoiceStatus('off'); }
      };
      recognition.start();
      setVoiceStatus('listening');
    } catch {
      setVoiceStatus('unsupported');
    }
    return () => {
      disposed = true;
      recognition?.abort();
    };
  }, [isPractice, voiceEnabled, playing, runPracticeCommand]);
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
    anchors, offsetSeconds, spans, title, sectionsDraft, assessmentPolicy, feedbackEnabled, guitarChords,
  }), [alignment, anchors, offsetSeconds, spans, title, sectionsDraft, assessmentPolicy, feedbackEnabled, guitarChords]);
  const workspaceSignature = document && state
    ? `${documentEpoch}:${historyIdentity(state)}:${metaSignature}` : '';
  workspaceSignatureRef.current = workspaceSignature;
  useEffect(() => {
    const valid = sanitizeGuitarChords(guitarChords);
    if (valid !== null) lastValidChordsRef.current = valid;
  }, [guitarChords]);
  const chordsDirty = JSON.stringify(guitarChords) !== savedChordsRef.current;
  const dirty = (savedSignature !== null
    ? workspaceSignature !== savedSignature
    : workspaceSignature !== (serverSignature ?? '') || Boolean(state?.dirty)) || chordsDirty;
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  const recoveryIdentity = useMemo<RecoveryIdentity>(
    () => ({accountId, lessonId: lessonId ?? '', draftId, sourceSha256,
      baseRevisionId: savedRevisionId}),
    [accountId, lessonId, draftId, sourceSha256, savedRevisionId],
  );

  const applyRestoredReference = useCallback((restored: Extract<ReturnType<typeof restoreFromReference>, {ok: true}>['value'],
    revisionId: string, manifest: {draft_id?: string | null; source_video?: Asset | null;
      reference?: {key: string; sha256?: string} | null;
      preview_identity?: string | null; sha256?: string;
      pedal?: MusicPedalSpan[];
      section_set?: {sections?: {id: string; label: string; start: number; end: number}[]};
      assessment?: {assessment?: string}; feedback_enabled?: boolean | null; piano_preview?: Asset | null} | null) => {
    setBaseline(restored.document);
    setDocumentEpoch(value => value + 1);
    setState(createWorkspaceState(restored.document));
    setSpans(restored.spans);
    setGuitarChords(restored.guitarChords);
    lastValidChordsRef.current = sanitizeGuitarChords(restored.guitarChords) ?? [];
    savedChordsRef.current = JSON.stringify(restored.guitarChords);
    setPedalSpans(manifest?.pedal ?? []);
    setRawModelDraft(false);
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
    setAssessmentPolicy('notes');
    setFeedbackEnabled(effectiveFeedbackEnabled(manifest));
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
      const sources = startReviewLoad<ReviewManifestDocument>(lessonId);
      const draftPromise = sources.draft;
      const manifest = await sources.manifest;
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
          subject: draft.subject === 'guitar' ? 'guitar' : 'piano',
          scoreSeconds: note => clock.toScore(note.onset),
          scoreDuration: clock.scoreDuration,
        });
        if (!alive()) return;
        setBaseline(document);
        setDocumentEpoch(value => value + 1);
        setState(createWorkspaceState(document));
        setTitle(draft.title);
        setSpans(draftSpans);
        const draftChords = (draft.guitar_chords ?? []).map(chord => ({
          id: chord.id, name: chord.name, start: chord.start, frets: [...chord.frets], position: chord.position,
        }));
        setGuitarChords(draftChords);
        lastValidChordsRef.current = sanitizeGuitarChords(draftChords) ?? [];
        savedChordsRef.current = JSON.stringify(draftChords);
        setPedalSpans(draft.pedal ?? []);
        setRawModelDraft(Boolean(draft.raw_model || draft.provenance?.model === 'kong'));
        setOffsetSeconds(draft.playback?.sync_offset_seconds ?? 0);
        setDraftId(draft.draft_id);
        setSourceSha256(draft.reference?.sha256 ?? '');
        setVerificationToken(draft.verification_state_token ?? '');
        setSectionsDraft(current => current.length ? current
          : [{id: 'whole', label: 'Whole lesson', start: 0, end: draft.duration}]);
        setAssessmentPolicy('notes');
        setFeedbackEnabled(effectiveFeedbackEnabled(draft));
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
    if (!lessonId || !draftId || rawModelDraft || isPractice) { setVerification(null); return; }
    let stopped = false;
    void loadVerification(lessonId, draftId).then(value => {
      if (stopped || value === null) return;
      const parsed = parseVerificationState(value);
      if (parsed.ok) setVerification(parsed.value);
    }).catch(() => {});
    return () => { stopped = true; };
  }, [lessonId, draftId, rawModelDraft, isPractice]);

  const decideFinding = useCallback(async (finding: VerificationFinding, decision: 'accepted' | 'rejected') => {
    if (readOnlyRef.current) {
      setNotice('This lesson is read-only; verification decisions are disabled.');
      return;
    }
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
        feedbackEnabled,
        durationSeconds: document.duration,
        authoredSpellings: authoredSpellings.current,
        acceptedBaselines: acceptedBaselines.current,
        // An in-progress chord edit (blank name, unsorted position) must never make
        // the only recovery checkpoint unreadable.
        guitarChords: guitarChords.length
          ? salvageGuitarChords(guitarChords, lastValidChordsRef.current)
          : undefined,
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [workspaceSignature, dirty, accountId, draftId, sourceSha256, title, alignment, anchors, offsetSeconds,
      spans, recoveryIdentity, savedRevisionId, verificationToken, sectionsDraft, assessmentPolicy, feedbackEnabled, guitarChords]);

  snapshotRef.current = {
    document, selection, dirty, past: state?.past.length ?? 0, future: state?.future.length ?? 0,
  };
  // Read-only qualification snapshot used by the evidence runner. It reads the
  // render-current ref synchronously, so an immediate post-rAF read cannot observe
  // a stale effect closure. No mutation API is exposed.
  useEffect(() => {
    (globalThis as unknown as {__pianoWorkspaceSnapshot?: () => unknown}).__pianoWorkspaceSnapshot = () => {
      const current = snapshotRef.current;
      if (!current) return null;
      return {
        document: current.document ? structuredClone(current.document) : null,
        selection: current.selection ? {...(current.selection as Record<string, unknown>)} : null,
        dirty: current.dirty, past: current.past, future: current.future,
      };
    };
    return () => {
      delete (globalThis as unknown as {__pianoWorkspaceSnapshot?: unknown}).__pianoWorkspaceSnapshot;
    };
  }, []);

  // Any document change requires a fresh confirmation before it can be saved.
  useEffect(() => { setConfirmReviewed(false); }, [workspaceSignature]);

  // Preview-entry policy: pause the shared source at its current position; the
  // same media element (and its clock) is retained while formatted mode is open.
  useEffect(() => {
    if (scoreMode !== 'formatted') return;
    const media = videoRef.current;
    if (media && !media.paused) media.pause();
  }, [scoreMode]);

  const formattedScroll = useRef<number | null>(null);
  useEffect(() => {
    if (scoreMode === 'formatted') {
      formattedScroll.current = sharedScrollLeft;
      return;
    }
    if (formattedScroll.current === null) return;
    const saved = formattedScroll.current;
    formattedScroll.current = null;
    commandedScroll.current = saved;
    if (saved !== sharedScrollLeft) setSharedScrollLeft(saved);
    const bar = sharedBarRef.current;
    if (bar && Math.abs(bar.scrollLeft - saved) > 1) bar.scrollLeft = saved;
  }, [scoreMode]);

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

  const commitSharedScroll = useCallback((target: number) => {
    const width = timelineWidth + 116;
    const liveWidth = sharedBarRef.current?.clientWidth || sharedWidth;
    const next = clampScroll(target, width, liveWidth);
    commandedScroll.current = next;
    setSharedScrollLeft(next);
    const bar = sharedBarRef.current;
    if (bar && Math.abs(bar.scrollLeft - next) > 0.5) bar.scrollLeft = next;
    for (const node of globalThis.document.querySelectorAll<HTMLElement>('.ws-roll-viewport, .ws-score-viewport')) {
      if (Math.abs(node.scrollLeft - next) > 0.5) node.scrollLeft = next;
    }
  }, [timelineWidth, sharedWidth]);

  const revealSource = useCallback((seconds: number) => {
    const W = sharedBarRef.current?.clientWidth || sharedWidth;
    if (!timelineLayout || !alignment || W <= 0) return;
    const p = 116 + timelineLayout.sourceSecondsToX(seconds, alignment, 0);
    if (p < sharedScrollLeft || p > sharedScrollLeft + W) {
      commitSharedScroll(p - W * 0.25);
    }
  }, [timelineLayout, alignment, sharedWidth, sharedScrollLeft, commitSharedScroll]);

  // Open the contextual note editor after selection and reveal the note outside the
  // narrow editor overlay. A roll drag keeps its geometry until the gesture ends.
  useEffect(() => {
    if (!selectionOccurrence) {
      noteRevealSelection.current = null;
      return;
    }
    if (gestureLock) return;
    if (noteRevealSelection.current === selectionOccurrence) return;
    noteRevealSelection.current = selectionOccurrence;
    if (!timelineLayout || !alignment || !document) return;
    const occurrence = document.performance.find(item => item.id === selectionOccurrence);
    if (!occurrence) return;
    const W = sharedBarRef.current?.clientWidth || sharedWidth;
    if (W <= 0) return;
    const x = 116 + timelineLayout.sourceSecondsToX(occurrence.onset + offsetSeconds, alignment, 0);
    const reserve = W > 760 ? 354 : 0;
    if (x < sharedScrollLeft + 70) commitSharedScroll(x - 70);
    else if (x > sharedScrollLeft + W - reserve - 20) commitSharedScroll(x - (W - reserve - 20));
  }, [selectionOccurrence, gestureLock, timelineLayout, alignment, document,
    offsetSeconds, sharedWidth, sharedScrollLeft, commitSharedScroll]);

  /**
   * A real playback start (workspace transport, native controls or their keyboard
   * activation) clears the temporary manual-inspection suspension. Follow is only
   * resumed when the user's Follow preference is on; an explicit off stays off.
   */
  const handlePlaybackStart = useCallback(() => {
    setFollowSuspended(false);
    // An active note-edit transaction owns the horizontal geometry.
    if (gestureLock || !follow) return;
    const media = videoRef.current;
    revealSource(media && Number.isFinite(media.currentTime) ? media.currentTime : playhead);
  }, [follow, gestureLock, revealSource, playhead]);
  playbackStart.current = handlePlaybackStart;

  useEffect(() => {
    const media = videoRef.current;
    if (!media) return;
    const onPlay = () => playbackStart.current();
    media.addEventListener('play', onPlay);
    return () => media.removeEventListener('play', onPlay);
  }, [videoUrl]);

  useEffect(() => {
    if (seekToken === lastSeekToken.current) return;
    lastSeekToken.current = seekToken;
    revealSource(playhead);
  }, [seekToken, playhead, revealSource]);

  useEffect(() => {
    const bar = sharedBarRef.current;
    if (!bar) return;
    const measure = () => setSharedWidth(bar.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [document]);

  const onSharedScroll = useCallback(() => {
    const bar = sharedBarRef.current;
    if (!bar || scoreModeRef.current === 'formatted' || bar.clientWidth <= 0) return;
    const next = bar.scrollLeft;
    setSharedWidth(bar.clientWidth);
    // Follow writes the DOM directly at 60 fps and advances commandedScroll first.
    // Ignore its echoed scroll events so they do not re-enter React every frame.
    if (Math.abs(next - commandedScroll.current) <= 2) return;
    if (!gestureLock) setFollowSuspended(true);
    commandedScroll.current = next;
    setSharedScrollLeft(next);
    for (const node of globalThis.document.querySelectorAll<HTMLElement>('.ws-roll-viewport, .ws-score-viewport')) {
      if (Math.abs(node.scrollLeft - next) > 1) node.scrollLeft = next;
    }
  }, [gestureLock]);

  const handleSharedWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
    if (!horizontal) return;
    const bar = sharedBarRef.current;
    if (!bar) return;
    event.preventDefault();
    setFollowSuspended(true);
    const delta = event.shiftKey && Math.abs(event.deltaX) < 1 ? event.deltaY : event.deltaX;
    bar.scrollLeft = clampScroll(bar.scrollLeft + delta, timelineWidth + 116, sharedWidth);
  }, [timelineWidth, sharedWidth]);

  const returnToPlayhead = useCallback(() => {
    if (!timelineLayout || !alignment) return;
    setFollow(true);
    setFollowSuspended(false);
    revealSource(playhead);
  }, [timelineLayout, alignment, revealSource, playhead]);

  const toggleTransport = useCallback(() => {
    const media = videoRef.current;
    if (!media) return;
    // Playback start itself (the media `play` event) clears temporary suspension and
    // reveals the playhead, so native and keyboard-started playback share this path.
    if (media.paused) void media.play().catch(() => setNotice('The video could not start.'));
    else media.pause();
  }, []);

  const changeRate = useCallback((value: number) => {
    setRate(value);
    const media = videoRef.current;
    if (media) media.playbackRate = value;
  }, []);

  // Space is a workspace transport shortcut, not a global page shortcut. It uses the
  // same toggleTransport path and media.paused state; interactive targets keep Space.
  useEffect(() => {
    const interactive = (node: Element | null): boolean => {
      if (!node) return false;
      return Boolean(node.closest(
        'button, a, input, textarea, select, summary, video, audio, [contenteditable]:not([contenteditable="false"]),'
        + ' [role="button"], [role="slider"], [role="checkbox"], [role="switch"], [role="menuitem"],'
        + ' [role="option"], [role="link"], [role="textbox"], [role="combobox"], [role="spinbutton"]',
      ));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey
        || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      const shell = shellRef.current;
      if (!shell?.isConnected || !videoRef.current) return;
      if (shell.hidden || shell.getAttribute('aria-hidden') === 'true'
        || shell.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      const style = shell.ownerDocument.defaultView?.getComputedStyle(shell);
      if (style?.display === 'none' || style?.visibility === 'hidden') return;
      if (typeof (shell as unknown as {checkVisibility?: () => boolean}).checkVisibility === 'function'
        && !(shell as unknown as {checkVisibility: () => boolean}).checkVisibility()) return;
      if (reviewOpen || addMenuOpen || overlap) return;
      if (globalThis.document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target as Element | null;
      const active = globalThis.document.activeElement as Element | null;
      const inside = (node: Element | null) => Boolean(node && shell.contains(node));
      const bare = (node: Element | null) => node === null
        || node === globalThis.document.body || node === globalThis.document.documentElement;
      if (!inside(target) && !bare(target)) return;
      if (!inside(active) && !bare(active)) return;
      if (interactive(typeof target?.closest === 'function' ? target : null)
        || interactive(typeof active?.closest === 'function' ? active : null)) return;
      event.preventDefault();
      toggleTransport();
    };
    globalThis.window.addEventListener('keydown', onKeyDown);
    return () => globalThis.window.removeEventListener('keydown', onKeyDown);
  }, [addMenuOpen, overlap, reviewOpen, toggleTransport]);

  // One frame-driven follow writer: stationary cursor until the safe-area threshold,
  // then content advances beneath it. The DOM scrolls every frame; React state is
  // refreshed at only 4 Hz so virtualization stays current without a render storm.
  useEffect(() => {
    if (!follow || followSuspended || gestureLock || !playing || !document || !alignment || !timelineLayout) return;
    let lastReactSync = 0;
    const unsubscribe = clockRef.current.subscribe(() => {
      const W = sharedBarRef.current?.clientWidth || sharedWidth;
      if (W <= 0) return;
      const p = 116 + timelineLayout.sourceSecondsToX(clockRef.current.get(), alignment, 0);
      const plotWidth = Math.max(1, W - 116);
      const ratio = W < 700 ? 0.6 : 0.7;
      const right = 116 + ratio * plotWidth;
      const q = p - commandedScroll.current;
      let target: number | null = null;
      if (q < 0 || q > W) target = p - W * 0.25;
      else if (q > right) target = p - right;
      if (target === null) return;
      const next = clampScroll(target, timelineWidth + 116, W);
      commandedScroll.current = next;
      const bar = sharedBarRef.current;
      if (bar && Math.abs(bar.scrollLeft - next) > 0.5) bar.scrollLeft = next;
      for (const node of globalThis.document.querySelectorAll<HTMLElement>('.ws-roll-viewport, .ws-score-viewport')) {
        if (Math.abs(node.scrollLeft - next) > 0.5) node.scrollLeft = next;
      }
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (nowMs - lastReactSync >= 250) {
        lastReactSync = nowMs;
        setSharedScrollLeft(next);
      }
    });
    return unsubscribe;
  }, [follow, followSuspended, gestureLock, playing, document, alignment,
    timelineLayout, timelineWidth, sharedWidth]);

  // A pause freezes the view; flush the latest commanded position to React once.
  useEffect(() => {
    if (!playing) setSharedScrollLeft(commandedScroll.current);
  }, [playing]);

  // Keep the source clock's rate when the video (re)mounts.
  useEffect(() => {
    const media = videoRef.current;
    if (media) media.playbackRate = rate;
  }, [videoUrl, rate]);

  // Keep the source volume under the shared practice settings control.
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
    if (pianoRef.current) pianoRef.current.volume = volume;
  }, [volume, videoUrl, previewAsset]);

  const zoom = useCallback((factor: number) => {
    if (!timelineLayout || !alignment || gestureLock || !document) return;
    const p = 116 + timelineLayout.sourceSecondsToX(clockRef.current.get(), alignment, 0);
    const anchorX = p >= sharedScrollLeft && p <= sharedScrollLeft + sharedWidth
      ? p : sharedScrollLeft + sharedWidth / 2;
    const anchorTick = timelineLayout.xToTick(Math.max(0, anchorX - 116));
    const screenOffset = anchorX - sharedScrollLeft;
    const nextZoom = Math.max(0.25, Math.min(8, zoomFactor * factor));
    const nextLayout = buildTimelineLayout(document, nextZoom);
    setZoomFactor(nextZoom);
    const nextScroll = clampScroll(116 + nextLayout.tickToX(anchorTick) - screenOffset,
      nextLayout.contentWidth + 116, sharedWidth);
    commandedScroll.current = nextScroll;
    setSharedScrollLeft(nextScroll);
    const bar = sharedBarRef.current;
    if (bar) bar.scrollLeft = nextScroll;
  }, [timelineLayout, alignment, gestureLock, playhead, sharedScrollLeft, sharedWidth, document, zoomFactor]);

  /* ------------------------------------------------------ save and reopen */

  const save = useCallback(async (baseOverride?: string) => {
    if (readOnlyRef.current) {
      setNotice('This lesson is read-only; saving is disabled.');
      return;
    }
    if (!document || !lessonId || !confirmReviewed || saving) return;
    const validatedChords = document.subject === 'guitar' ? sanitizeGuitarChords(guitarChords) : [];
    if (validatedChords === null) {
      setSaveError('Guitar chord shapes are invalid or exceed the 100-shape limit. '
        + 'Fix or remove invalid shapes before saving.');
      return;
    }
    const snapshot = workspaceSignature;
    setSaving(true); setSaveError(''); setSaveMessage(''); setSaveConflict(false);
    const base = baseOverride ?? savedRevisionId;
    const body = buildSaveBody({
      title, document: withHandAssignments(document, hands.assignments), spans, alignment, anchors, offsetSeconds, baseRevisionId: base,
      draftId, referenceSha256: sourceSha256, verificationStateToken: verificationToken || null,
      sections: sectionsDraft.length ? sectionsDraft : (savedSections ?? undefined),
      guitarChords: validatedChords,
      assessment: assessmentPolicyForSubject(document.subject),
      feedbackEnabled,
    });
    try {
      const manifest = await saveReviewedReference(lessonId, base, body);
      editorSession.saved(manifest.revision_id);
      setSavedRevisionId(manifest.revision_id);
      setSavedSignature(snapshot);
      lastValidChordsRef.current = validatedChords;
      savedChordsRef.current = JSON.stringify(validatedChords);
      const current = snapshot === workspaceSignatureRef.current;
      onSaved?.(manifest.revision_id, current);
      setSaveConflict(false);
      const stillCurrent = snapshot === workspaceSignatureRef.current;
      if (stillCurrent) {
        // The acknowledged snapshot is still the current work.
        clearRecovery();
        setRecoveryOffer(null);
        setRecoveryNotice('');
        setSaveMessage(privateSaveMessage(manifest.revision_id, true));
      } else {
        // Newer edits exist; keep their checkpoint and say so rather than claim Saved.
        setSaveMessage(privateSaveMessage(manifest.revision_id, false));
      }
    } catch (cause) {
      // Edits stay in place; the local checkpoint keeps the work recoverable. A stale
      // base is a conflict with an explicit resolution, never silent data loss.
      const info = classifySaveError(cause);
      if (info.conflict) {
        editorSession.conflict(info.message);
        setSaveConflict(true);
        setConflictKind(info.kind ?? 'other');
        setSaveError(info.message);
      } else {
        setSaveError(info.message);
      }
    } finally {
      setSaving(false);
    }
  }, [document, lessonId, confirmReviewed, saving, title, spans, alignment, anchors, offsetSeconds,
      savedRevisionId, workspaceSignature, draftId, sourceSha256, verificationToken, savedSections, savedAssessment,
      feedbackEnabled, onSaved,
      hands.assignments, guitarChords]);

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
      const lesson = await request<{ revision_id: string; reference: { key: string }; title?: string;
        assessment?: {assessment?: string}; feedback_enabled?: boolean | null }>(
        `/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false, {'X-Lesson-Formats': '1,2'});
      const response = await fetch(assetUrl(lesson.reference.key), {credentials: 'same-origin'});
      if (!response.ok) throw new Error('The saved reference could not be read.');
      const restored = restoreFromReference(await response.json());
      if (!restored.ok) throw new Error(restored.message);
      applyRestoredReference(restored.value, lesson.revision_id,
        lesson as {section_set?: {sections?: {id: string; label: string; start: number; end: number}[]};
          assessment?: {assessment?: string}; feedback_enabled?: boolean | null; piano_preview?: Asset | null});
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
      setGuitarChords(staleCheckpoint.guitarChords ?? []);
      lastValidChordsRef.current = sanitizeGuitarChords(staleCheckpoint.guitarChords ?? []) ?? [];
      savedChordsRef.current = JSON.stringify(staleCheckpoint.guitarChords ?? []);
      setOffsetSeconds(staleCheckpoint.offsetSeconds);
      setAnchors(canonicalAnchors(staleCheckpoint.alignment?.anchors ?? []));
      if (staleCheckpoint.sections?.length) setSectionsDraft(staleCheckpoint.sections);
      if (typeof staleCheckpoint.feedbackEnabled === 'boolean') setFeedbackEnabled(staleCheckpoint.feedbackEnabled);
      setAssessmentPolicy('notes');
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
      setGuitarChords(recoveryOffer.guitarChords ?? []);
      lastValidChordsRef.current = sanitizeGuitarChords(recoveryOffer.guitarChords ?? []) ?? [];
      savedChordsRef.current = JSON.stringify(recoveryOffer.guitarChords ?? []);
      setOffsetSeconds(recoveryOffer.offsetSeconds);
      setAnchors(canonicalAnchors(recoveryOffer.alignment?.anchors ?? []));
      if (recoveryOffer.sections?.length) setSectionsDraft(recoveryOffer.sections);
      if (typeof recoveryOffer.feedbackEnabled === 'boolean') setFeedbackEnabled(recoveryOffer.feedbackEnabled);
      setAssessmentPolicy('notes');
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
    if (readOnlyRef.current) return;
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
  const downloadReference = () => {
    const exported = buildWorkspaceExport({
      document, title, occurrenceCount: document.performance.length, editingMode: interactionPolicy.mode,
      authored: {
        alignment: serializeAlignment(alignment, anchors, offsetSeconds),
        offsetSeconds, spans, sections: sectionsDraft, assessment: assessmentPolicy,
        identity: {accountId, lessonId: lessonId ?? '', draftId, sourceSha256},
      },
      recovery: peekRecovery(),
    });
    const blob = new Blob([serializeWorkspaceExport(exported)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = `${title || 'piano-workspace'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadMusicXml = () => {
    const xml = toMusicXML(document, {title});
    const blob = new Blob([xml], {type: 'application/vnd.recordare.musicxml+xml'});
    const url = URL.createObjectURL(blob);
    const link = globalThis.document.createElement('a');
    link.href = url;
    link.download = `${(title || 'piano-lesson').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 60)}.musicxml`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const headerStatus = isPractice ? 'Practice'
    : readOnly ? 'Read-only lesson'
    : saveMessage ? 'Saved'
    : dirty ? 'Unsaved changes · private draft'
    : savedRevisionId ? 'Saved' : 'Private draft';
  const headerStatusDetail = saveMessage || saveError || reopenMessage || notice
    || (readOnly ? interactionPolicy.reason : workspaceStatus(state));
  const addModePanel = addMode ? <section className={`ws-add-panel ws-add-mode-panel${stageView === 'place' ? ' ws-add-place-panel' : ''}`}
    data-add="active" data-add-mode-active="true" role="group" aria-label="Add note mode">
    <p>New {pitchName(addMode.pitch)} at {addMode.seconds.toFixed(3)} s (recorded) · written {addMode.ticks} ticks ·
      click the roll to place it.</p>
    <div className="ws-row">
      <label className="ws-field ws-inline"><span>Recorded length (s)</span>
        <input type="number" step={0.01} min={0.02} max={document?.duration ?? 0} data-add="length"
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
      <button type="button" data-add="commit" aria-label="Insert" onClick={commitAdd}>Insert</button>
      <button type="button" data-add="cancel"
        onClick={() => { setAddMode(null); setDuplicateId(null); setNotice('Add note cancelled.'); }}>Cancel</button>
    </div>
    {addProblem && <p className="ws-report is-bad" data-add="invalid">{addProblem}</p>}
    {ghostDuplicate && <p className="ws-report is-bad" data-add="duplicate">
      A {pitchName(addMode.pitch)} already starts here.
      <button type="button" data-select-existing aria-label="Select existing"
        onClick={() => { if (ghostDuplicateId) select(ghostDuplicateId); setAddMode(null); }}>Select existing</button>
    </p>}
  </section> : null;

  const startPipDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element | null)?.closest?.('button')) return;
    const pip = event.currentTarget.parentElement;
    if (!pip) return;
    event.preventDefault();
    const rect = pip.getBoundingClientRect();
    const startX = event.clientX, startY = event.clientY;
    const startLeft = rect.left, startTop = rect.top;
    const move = (next: PointerEvent) => {
      const maxLeft = Math.max(0, globalThis.innerWidth - rect.width);
      const maxTop = Math.max(0, globalThis.innerHeight - rect.height);
      setPipPos({
        left: Math.max(0, Math.min(maxLeft, startLeft + next.clientX - startX)),
        top: Math.max(0, Math.min(maxTop, startTop + next.clientY - startY)),
      });
    };
    const end = () => {
      globalThis.window.removeEventListener('pointermove', move);
      globalThis.window.removeEventListener('pointerup', end);
      globalThis.window.removeEventListener('pointercancel', end);
    };
    globalThis.window.addEventListener('pointermove', move);
    globalThis.window.addEventListener('pointerup', end);
    globalThis.window.addEventListener('pointercancel', end);
  };

  return <main className={`ws-shell ws-shell-focused${isPractice ? ' mimic-shell mimic-immersive minimal-practice' : ''}`} ref={shellRef} data-workspace-dirty={dirty ? 'true' : 'false'}
    data-practice-mode={isPractice ? 'true' : 'false'}
    data-interactive-mode={isPractice ? 'read-only' : interactionPolicy.mode}
    style={isPractice ? {overflowX: 'clip', maxWidth: '100vw'} : {overflowX: 'clip', maxWidth: '100vw', contain: 'paint'}}
    onPointerDownCapture={event => {
      workspaceActive.current = true;
      const target = (event.target as Element | null)?.closest?.('[data-occurrence]') as HTMLElement | null;
      const occurrenceId = target?.getAttribute('data-occurrence');
      if (target && occurrenceId) selectionReference.current = {occurrenceId, element: target};
    }}>
    <div className="ws-video-pip" hidden={!pipOpen || !videoUrl}
      data-video-pip={pipOpen ? 'open' : 'closed'}
      style={pipPos ? {left: pipPos.left, top: pipPos.top, right: 'auto', bottom: 'auto'} : undefined}>
      <div className="ws-video-pip-bar" onPointerDown={startPipDrag}>
        <span>Video</span>
        <button type="button" aria-label="Close video" title="Close video"
          onClick={() => setPipOpen(false)}><X size={15}/></button>
      </div>
      <video ref={videoRef} src={videoUrl ?? undefined} controls playsInline preload="metadata" className="ws-video"/>
      {previewAsset ? <audio ref={pianoRef} src={preview.url || undefined} preload="auto"/> : null}
    </div>
    <header className="ws-topbar">
      <div className="ws-topbar-lead">
        {onBack && <button type="button" className="ws-icon-button ws-back" data-workspace-back="true"
          aria-label="Back" title="Back"
          onClick={() => {
            if (dirty && !globalThis.window.confirm('Leave without saving your changes?')) return;
            onBack();
          }}><ArrowLeft size={19}/></button>}
        <div className="ws-title-block">
          <h1>{isPractice ? displayPieceTitle(lessonTitle || title) : displayPieceTitle(title)}</h1>
          {!isPractice && <p className="ws-topbar-status" data-save-status={dirty ? 'dirty' : 'clean'}
            title={headerStatusDetail}>{headerStatus}</p>}
        </div>
      </div>
      <div className="ws-topbar-actions" hidden={isPractice}>
        {scoreMode === 'formatted' && <button type="button" className="ws-quiet-button"
          onClick={() => setScoreMode('correction')}>Return to correction</button>}
        {!isPractice && <button type="button" className="ws-icon-button ws-undo" aria-label="Undo" title="Undo"
          onClick={() => dispatch({type: 'undo'})}
          disabled={readOnly || !state.past.length || Boolean(replaceMode) || Boolean(addMode)}><Undo2 size={19}/></button>}
        {!isPractice && <button type="button" className="ws-icon-button ws-redo" aria-label="Redo" title="Redo"
          onClick={() => dispatch({type: 'redo'})}
          disabled={readOnly || !state.future.length || Boolean(replaceMode) || Boolean(addMode)}><Redo2 size={19}/></button>}
        <button type="button" className="ws-icon-button" aria-label="Settings" title="Settings"
          aria-expanded={drawerOpen && drawerTarget === 'settings'} data-settings-toggle="true"
          onClick={() => openDrawer('settings')}><SettingsIcon size={19}/></button>
        <button type="button" className="ws-icon-button ws-more" aria-label="More" title="More"
          aria-expanded={drawerOpen && drawerTarget === 'more'} data-more-toggle="true"
          onClick={() => openDrawer('more')}><MoreHorizontal size={19}/></button>
        {!isPractice && !readOnly && <button ref={reviewTrigger} type="button" className="ws-save"
          onClick={() => {
            setReviewOpen(true); setDrawerOpen(false); setAddMenuOpen(false);
            setPitchPickMode(null); setReplaceMode(null); setAddMode(null); setDuplicateId(null);
            modeWasActive.current = false; modeReturnFocus.current = null;
          }}
          disabled={saving || !(dirty || savedRevisionId === null)}
          data-review-save="true" aria-label="Review and save" title="Review and save">
          {saving ? 'Saving…' : 'Save'}
        </button>}
      </div>
    </header>

    {!isPractice && (readOnly || saveMessage || saveError || saveConflict || reopenMessage || report || notice
      || verification?.stale || verification?.report_error || verification?.conflicts.length) &&
      <div className="ws-notice-strip">
        {readOnly ? <div className="inline-notice" role="status" data-read-only="true">
          <strong>Read-only:</strong> {interactionPolicy.reason}
          <button type="button" onClick={downloadReference}>Download reference</button>
        </div> : null}
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
        {(verification?.stale || verification?.report_error || verification?.conflicts.length) &&
          <span className="ws-report is-bad" data-verification-notice="true">
            Verification needs attention.
            <button type="button" onClick={() => openDrawer('settings', 'lesson')}>Review issues</button>
          </span>}
      </div>}

    {scoreMode === 'formatted' ? <FormattedScore document={document} title={title}
      selectedOccurrenceId={selection?.occurrenceId ?? null}/> : null}
    <div className="ws-correction" hidden={scoreMode === 'formatted'}>
    {!isPractice && recoveryOffer && <section className="ws-panel" role="status" aria-label="Local recovery" data-recovery="offer">
      <p>A local checkpoint from {new Date(recoveryOffer.savedAt).toLocaleString()} is available.
        It is <strong>not saved to the server</strong>.</p>
      <div className="ws-row">
        <button type="button" onClick={restoreCheckpoint}>Restore local checkpoint</button>
        <button type="button" onClick={() => { clearRecovery(); setRecoveryOffer(null); }}>Discard</button>
      </div>
    </section>}
    {!isPractice && recoveryNotice && <p className="ws-hint" role="status" data-recovery="rejected">{recoveryNotice}</p>}
    {!isPractice && staleCheckpoint && <section className="ws-panel" role="status" aria-label="Stale local recovery" data-recovery="stale">
      <p>This checkpoint was written against an older saved revision. Restoring keeps your work but
        saves as a new revision on the current base.</p>
      <div className="ws-row">
        <button type="button" onClick={restoreStaleCheckpoint}>Restore older checkpoint</button>
        <button type="button" onClick={() => { clearRecovery(); setStaleCheckpoint(null); }}>Discard</button>
      </div>
    </section>}


    <div className="ws-stage" data-stage-layout={DEFAULT_STAGE_LAYOUT.join('-')}
      data-compact-view={stageView} data-compact-preference={compactPreference}
      data-compact-limited={limitedHeight ? 'true' : 'false'} data-roll-open={rollOpen ? 'true' : 'false'}>
      <section className="ws-instrument" id="piano-instrument" data-stage-module="instrument"
        aria-label={guitar ? 'Guitar instrument' : 'Piano instrument'}>
        {guitar ? <div className="ws-guitar-instrument" data-stage-slot="guitar">
          <div className="ws-guitar-setup" role="group" aria-label="Guitar setup" data-guitar-setup="true">
            <label className="ws-field ws-inline"><span>Tuning</span>
              <select aria-label="Guitar tuning" value={activeSetup.tuning}
                onChange={event => dispatch({type: 'command', command: {type: 'set-guitar-setup',
                  tuning: event.target.value as GuitarTuningId}})}>
                {Object.values(GUITAR_TUNINGS).map(tuning => <option key={tuning.id} value={tuning.id}>{tuning.label}</option>)}
              </select>
            </label>
            <label className="ws-field ws-inline"><span>Capo</span>
              <input aria-label="Guitar capo" type="number" min={0} max={12} step={1}
                value={activeSetup.capo}
                onChange={event => {
                  const capo = Number(event.target.value);
                  if (!Number.isInteger(capo) || capo < 0 || capo > 12) return;
                  dispatch({type: 'command', command: {type: 'set-guitar-setup', capo}});
                }}/>
            </label>
          </div>
          <GuitarChordStrumHud chords={guitarChords} time={playhead}
            events={document.performance.map(note => ({onset: note.onset, pitch: note.pitch,
              string: note.string ?? positionOf(note)?.string ?? null}))}
            beatsPerBar={document.time_signature.numerator}
            onSelectChord={chord => seek(chord.start)}/>
          <GuitarNeckGuide
            tuning={activeSetup.tuning} capo={activeSetup.capo}
            positions={document.performance.filter(note => activeIds.includes(note.id))
              .flatMap(note => {
                const position = positionOf(note);
                return position ? [{pitch: note.pitch, ...position, label: pitchName(note.pitch),
                  finger: guitarFingers[note.id]}] : [];
              })}
            fretCount={24}
            handedness={guitarHandedness}
            upcomingPositions={document.performance
              .filter(note => note.onset > playhead && note.onset <= playhead + 0.5)
              .flatMap(note => {
                const position = positionOf(note);
                return position ? [{pitch: note.pitch, ...position}] : [];
              })}
            candidatePositions={selected && guitar ? Array.from({length: 6}, (_, index) => index + 1)
              .map(string => ({string, fret: selected.pitch - (openStringPitch(string, activeSetup) ?? selected.pitch)}))
              .filter(item => item.fret >= 0 && item.fret <= 24)
              .map(item => ({string: item.string, fret: item.fret, pitch: selected.pitch})) : []}
            onPositionSelect={(string, fret) => {
              const target = fretPickMode ?? selection?.occurrenceId ?? null;
              if (!target) { setNotice('Select a note before choosing a fretboard position.'); return; }
              dispatch({type: 'command', command: {type: 'set-guitar-position',
                occurrenceId: target, string, fret}});
              setFretPickMode(null);
              setNotice(`Position set to string ${string}, fret ${fret}.`);
            }}/>
        </div> : null}
        <div className="ws-waterfall-slot" hidden={guitar} id="piano-waterfall-slot" data-waterfall-slot="true"
          data-stage-slot="waterfall">
          <PianoWaterfall document={document} clock={clockRef.current} intervals={intervals}
            range={keyboardRange}
            selectedOccurrenceId={selection?.occurrenceId ?? null}
            hands={hands.assignments}
            onSelect={select}/>
        </div>
        <section className="ws-keyboard-surface" id="piano-keyboard" aria-label="Keyboard" hidden={guitar}>
          <div className="ws-surface-head"><span>Piano keys</span><span className="ws-surface-note">Tap to audition</span></div>
          <div ref={keyboardRef}>
            <LiveKeyboard document={document} clock={clockRef.current} intervals={intervals}
              selectedPitch={selected?.pitch ?? null}
              range={keyboardRange ?? undefined} onRangeChange={handleKeyboardRangeChange}
              onKey={(pitch, _auditionOnly, velocity) => audition([pitch], 0.4, velocity)}
              onSelectKey={pitch => {
                if (pitchPickMode) {
                  dispatch({type: 'command', command: {type: 'set-occurrence-pitch',
                    occurrenceId: pitchPickMode.occurrenceId, pitch}});
                  setNotice(`Pitch set to ${pitchName(pitch)}.`);
                  setPitchPickMode(null);
                  return;
                }
                if (replaceMode) { replacementPitch(pitch); return; }
                if (addMode) { setAddMode(mode => mode ? {...mode, pitch} : mode); return; }
                selectKey(pitch);
              }}
              width={keyboardWidth > 0 ? keyboardWidth : tinyKeyboard ? 480 : compactKeyboard ? 640 : 1040}
              height={tinyKeyboard ? 105 : compactKeyboard ? 100 : 150}
              hands={hands.assignments}/>
          </div>
          {replaceMode && <div className="ws-replace-banner ws-mode-banner" data-replace="active">
            Replacing {pitchName(replaceMode.pitch)} — click a key to commit. Every key and octave control is available.
            <button type="button" onClick={() => { setReplaceMode(null); setNotice('Replacement cancelled.'); }}>Cancel</button>
          </div>}
          {pitchPickMode && <div className="ws-replace-banner ws-mode-banner" data-pitch-pick-active="true">
            Choose a key for {selected?.spelling ?? 'the selected note'} — the note editor is hidden so every key and octave control is available.
            <button type="button" onClick={() => { setPitchPickMode(null); setNotice('Pitch selection cancelled.'); }}>Cancel</button>
          </div>}
        </section>
      </section>

        <div className="ws-shared-stage" onWheel={handleSharedWheel}>
        <section className="ws-roll-surface" id="piano-roll" data-stage-module="roll" aria-label="Piano roll">
          <div className="ws-roll-disclosure">
          <button type="button" className="ws-accordion" data-roll-toggle="true"
            aria-expanded={rollVisible} aria-controls="piano-roll-body"
            disabled={limitedHeight && Boolean(addMode)}
            onClick={() => setRollOpen(open => !open)}>
            <span>{guitar ? (rollMode === 'strings' ? '6-String Roll' : 'Pitch Roll') : 'Piano roll'}</span><span className="ws-accordion-state">{rollVisible ? 'Hide' : 'Show'}</span>
          </button>
          {guitar && <button type="button" className="ws-quiet-button" data-roll-mode-toggle="true"
            aria-label="Toggle roll rows"
            onClick={() => setRollMode(mode => mode === 'strings' ? 'pitch' : 'strings')}>
            {rollMode === 'strings' ? 'Pitch Roll' : '6-String Roll'}
          </button>}
          {!isPractice && <button type="button" className="ws-quiet-button ws-add-trigger" data-add-menu-toggle="true"
            aria-expanded={addMenuOpen} aria-label="Add note" title="Add note"
            onClick={() => addMenuOpen ? setAddMenuOpen(false) : openAddMenu()}>+ Add note</button>}
          </div>
          <div id="piano-roll-body" hidden={!rollVisible}>
          <TimeRoll document={document} window={window} onWindowChange={next => changeWindow(next, 'reveal')}
            layout={timelineLayout ?? undefined} alignment={alignment ?? undefined}
            sharedScrollLeft={sharedScrollLeft} sharedViewportWidth={sharedWidth} gutter={sharedWidth > 0 && sharedWidth < 700 ? 82 : 70}
            cursorFallbackSeconds={timelineLayout && alignment ? playhead : null}
            onGestureStart={() => { setGestureLock(true); setFollowSuspended(true); }}
            onGestureEnd={() => setGestureLock(false)}
            onWindowChangeOrigin={changeWindow}
            offsetSeconds={offsetSeconds} activeOccurrenceIds={activeIds}
            clock={clockRef.current} intervals={intervals}
            selectedOccurrenceId={selection?.occurrenceId ?? null}
            reveal={null}
            onGestureCommit={applyGestureEdit} onAuditionPitch={auditionPitch}
            editingEnabled={!isPractice && scoreMode === 'correction' && !replaceMode && !addMode}
            snapSeconds={snapTicks ? snapTicks * secondsPerTick : null}
            addMode={Boolean(addMode)}
            ghost={addMode ? {seconds: addMode.seconds, pitch: addMode.pitch,
              durationSeconds: addMode.durationSeconds, invalid: Boolean(addProblem)} : null}
            onGhostPlace={(seconds, pitch) => setAddMode(mode => ({
              seconds: seconds - offsetSeconds, pitch,
              ticks: mode?.ticks ?? lastWrittenTicks.current,
              durationSeconds: mode?.durationSeconds ?? lastRecordedSeconds.current}))}
            playhead={playhead} onSelect={select} onSeek={seek} rowMode={guitar ? rollMode : 'pitch'}
            tuning={activeSetup.tuning} capo={activeSetup.capo}/>
          </div>
        </section>

        <section className="ws-score-surface" id="piano-score" data-stage-module="sheet" aria-label="Score">
          <p className="ws-score-meta" data-score-key>Key: {keyLabel(document.key_signature || 'C')} · {document.time_signature.numerator}/{document.time_signature.denominator}</p>
          {guitar && <button type="button" className="ws-quiet-button" data-staff-mode-toggle="true"
            aria-label="Toggle score staff" onClick={() => setStaffMode(mode =>
              mode === 'guitar-both' ? 'guitar-tab' : 'guitar-both')}>
            {staffMode === 'guitar-both' ? 'TAB only' : 'TAB + Sheet'}
          </button>}
          <ContinuousScore document={document} boxes={boxes} selectedOccurrenceId={selection?.occurrenceId ?? null}
            reveal={null} onSelect={select}
            staffMode={guitar ? staffMode : 'grand'} guitarChords={guitar ? guitarChords : []}
            tuning={activeSetup.tuning} capo={activeSetup.capo}
            playheadTick={playheadTick} activeOccurrenceIds={activeIds}
            clock={clockRef.current} alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals}
            layout={timelineLayout ?? undefined} sharedScrollLeft={sharedScrollLeft}
            cursorFallbackSeconds={timelineLayout && alignment ? playhead : null}
            onSeekTick={seekToTick}
            onGestureCommit={applyGestureEdit} onAuditionPitch={auditionPitch}
            editingEnabled={!isPractice && scoreMode === 'correction' && !replaceMode && !addMode}
            onAmbiguous={(logicalNoteId, occurrenceIds) => setNotice(
              `This written note maps ${occurrenceIds.length} occurrences; choose one in the roll (logical ${logicalNoteId}).`)}/>
        </section>
        <div className="ws-shared-scrollbar" ref={sharedBarRef} onScroll={onSharedScroll}
          data-shared-scrollbar aria-label="Shared timeline horizontal scroll">
          <div style={{width: Math.max(1, timelineWidth + 116), height: 1}}/>
        </div>
        </div>

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
        {stageView === 'place' && addModePanel}
      </div>

      {!isPractice && <div className="ws-dock" data-compact={limitedHeight ? 'true' : 'false'}>
        <button type="button" className="ws-play" onClick={toggleTransport}
          aria-label={playing ? 'Pause' : 'Play'} aria-keyshortcuts="Space"
          title={playing ? 'Pause (Space)' : 'Play (Space)'}>
          {playing ? <Pause size={22}/> : <Play size={22}/>}
        </button>
        <div className="ws-dock-centre">
          <ClipOverview document={document} playhead={playhead}
            window={timelineLayout && alignment && sharedWidth > 0 ? {
              start: timelineLayout.xToSourceSeconds(Math.max(0, sharedScrollLeft - 116), alignment, 0),
              span: Math.max(0.01, timelineLayout.xToSourceSeconds(Math.max(0, sharedScrollLeft - 116 + sharedWidth), alignment, 0)
                - timelineLayout.xToSourceSeconds(Math.max(0, sharedScrollLeft - 116), alignment, 0)),
            } : window}
            onNavigate={(next, seekSeconds) => {
              if (timelineLayout && alignment) {
                commitSharedScroll(116 + timelineLayout.sourceSecondsToX(next.start, alignment, 0));
              } else {
                setWindow(clampTimeWindow(next, document.duration));
              }
              if (seekSeconds !== undefined) seek(seekSeconds);
            }}/>
          <div className="ws-dock-times">
            <LiveTimeLabel clock={clockRef.current} fallback={playhead}/>
            <span>{timeLabel(document.duration)}</span>
          </div>
        </div>
        <div className="ws-dock-actions">
          {isPractice&&chunks.length>0&&<div className="ws-practice-chunks" role="group" aria-label="Practice chunks">
            <button type="button" aria-label="Previous chunk"
              onClick={() => runPracticeCommand('back')}>Back</button>
            <button type="button" aria-label="Repeat chunk"
              onClick={() => runPracticeCommand('again')}>Again</button>
            <button type="button" aria-label="Next chunk"
              onClick={() => runPracticeCommand('next')}>Next</button>
            <span className="ws-practice-chunk-status" data-practice-chunk="true">
              {chunks[Math.min(activeChunkIndex, chunks.length - 1)]?.label}
              {` (${Math.min(activeChunkIndex, chunks.length - 1) + 1}/${chunks.length})`}
            </span>
          </div>}
          {isPractice&&chunks.length>0&&<button type="button" className="ws-icon-button"
            aria-label="Voice commands" aria-pressed={voiceEnabled}
            title={voiceStatus === 'unsupported'
              ? 'Voice recognition unavailable in this browser'
              : 'Voice commands (Next, Back, Again)'}
            onClick={() => setVoiceEnabled(enabled => !enabled)}>Mic</button>}
          <span className="ws-hand-mini" data-hands-inline-legend="true" role="img"
            aria-label="Hand colour legend: blue left, amber right, grey-green unknown">
            <span className="hand-left" title="Left hand">Left</span>
            <span className="hand-right" title="Right hand">Right</span>
            <span className="hand-unassigned" title="Unassigned/unknown hand">?</span>
          </span>
          {keyboardRange && <span className="ws-piano-range" data-piano-range="true"
            data-first-pitch={keyboardRange.firstPitch}
            data-last-pitch={keyboardRange.firstPitch + keyboardRange.semitones}
            title={isStandardPianoRange(keyboardRange)
              ? 'Full standard piano range A0–C8'
              : `Full standard piano A0–C8; showing ${pitchName(keyboardRange.firstPitch)}–${pitchName(keyboardRange.firstPitch + keyboardRange.semitones)}`}>
            {keyboardRangeLabel}
          </span>}
          {limitedHeight && !addMode && <div className="ws-compact-switch" role="group" aria-label="Compact view">
            <button type="button" aria-pressed={compactPreference === 'guide'}
              className={compactPreference === 'guide' ? 'is-active' : ''}
              onClick={() => chooseCompactView('guide')}>Guide</button>
            <button type="button" aria-pressed={compactPreference === 'sheet'}
              className={compactPreference === 'sheet' ? 'is-active' : ''}
              onClick={() => chooseCompactView('sheet')}>Sheet</button>
          </div>}
          {followSuspended && <button type="button" className="ws-pill" onClick={returnToPlayhead}>Resume follow</button>}
          {followSuspended && <span className="ws-sr-only" data-follow-suspended="true">Follow suspended · manual inspection</span>}
          <LiveFollowDirection clock={clockRef.current} fallback={playhead}
            timelineLayout={timelineLayout} alignment={alignment}
            sharedWidth={sharedWidth} sharedScrollLeft={sharedScrollLeft} playing={playing}/>
          <label className="ws-speed">
            <span className="ws-sr-only">Playback speed</span>
            <select value={rate} aria-label={`Playback speed ${rate}×`}
              onChange={event => changeRate(Number(event.target.value))}>
              {[0.5, 0.75, 1].map(value => <option key={value} value={value}>{value}×</option>)}
            </select>
          </label>
          <div className="ws-audio" role="group" aria-label="Source audio">
            <button type="button" aria-pressed={audioMode === 'original'}
              className={audioMode === 'original' ? 'is-active' : ''}
              onClick={() => setAudioMode('original')}>Original</button>
            <button type="button" aria-pressed={audioMode === 'piano'}
              className={audioMode === 'piano' ? 'is-active' : ''}
              disabled={pianoDisabled}
              title={pianoTitle}
              onClick={() => setAudioMode('piano')}>{guitar ? 'Guitar' : 'Piano'}</button>
          </div>
          <button type="button" className="ws-icon-button" aria-pressed={pipOpen}
            aria-label="Video" title={pipOpen ? 'Hide video' : 'Show video'}
            onClick={() => setPipOpen(open => !open)}><Video size={19}/></button>
          <button type="button" className="ws-icon-button" onClick={() => openDrawer('sound')}
            aria-label="Sound options" title="Sound options"><Volume2 size={19}/></button>
        </div>
      </div>}



      {isPractice && practicePanel === 'settings' && <PracticePanel title="Practice settings"
        drawer modal={false} onClose={() => setPracticePanel(null)}>
        <PracticeSettingsProvider row={settingsRow} setRow={setSettingsRow}>
          <SettingsGroup id="setup" title="Audio & Practice"
            summary={audioMode === 'piano' ? (guitar ? 'Guitar' : 'Piano') : 'Original'}>
            <SettingsRow id="audio" label="Sound" value={audioMode === 'piano' ? (guitar ? 'Guitar' : 'Piano') : 'Original'}>
              <SettingsChoices label="Sound" value={audioMode}
                options={[{value: 'original', label: 'Original'},
                  {value: 'piano', label: guitar ? 'Guitar' : 'Piano', disabled: pianoDisabled}]}
                onChange={value => setAudioMode(value === 'piano' ? 'piano' : 'original')}/>
            </SettingsRow>
            <SettingsRow id="stops" label="Practice stops"
              value={chunkBars === 0 ? 'Off' : `${chunkBars} bar${chunkBars === 1 ? '' : 's'}`}>
              <SettingsChoices label="Practice stops" value={chunkBars}
                options={[{value: 0, label: 'Off (0)'}, {value: 1, label: '1 bar'},
                  {value: 2, label: '2 bars'}, {value: 4, label: '4 bars'}]}
                onChange={value => { setChunkBars(value as ChunkBarsOption); setActiveChunkIndex(0); }}/>
            </SettingsRow>
            <SettingsRow id="voice" label="Voice commands" value={voiceEnabled ? 'On' : 'Off'}>
              <SettingsChoices label="Voice commands" value={voiceEnabled ? 'on' : 'off'}
                options={[{value: 'off', label: 'Off'}, {value: 'on', label: 'On'}]}
                onChange={value => setVoiceEnabled(value === 'on')}/>
            </SettingsRow>
            <SettingsRow id="volume" label="Volume" value={`${Math.round(volume * 100)}%`}>
              <input aria-label="Volume" type="range" min={0} max={1} step={0.01}
                value={volume} onChange={event => setVolume(Number(event.target.value))}/>
            </SettingsRow>
          </SettingsGroup>
          <SettingsGroup id="playback" title="Playback" summary={`${rate}×`}>
            <SettingsRow id="speed" label="Speed" value={`${rate}×`}>
              <SettingsChoices label="Speed" value={rate}
                options={[{value: 0.5, label: '0.5×'}, {value: 0.75, label: '0.75×'},
                  {value: 1, label: '1×'}]}
                onChange={value => changeRate(value)}/>
            </SettingsRow>
          </SettingsGroup>
          <SettingsGroup id="display" title="Display" summary={pipOpen ? 'Video on' : 'Video hidden'}>
            <SettingsRow id="video" label="Instructor video" value={pipOpen ? 'Shown' : 'Hidden'}>
              <SettingsChoices label="Instructor video" value={pipOpen ? 'show' : 'hide'}
                disabled={!videoUrl}
                options={[{value: 'show', label: 'Show'}, {value: 'hide', label: 'Hide'}]}
                onChange={value => setPipOpen(value === 'show')}/>
            </SettingsRow>
            <SettingsRow id="roll" label="Piano roll" value={rollVisible ? 'Shown' : 'Hidden'}>
              <SettingsChoices label="Piano roll" value={rollVisible ? 'show' : 'hide'}
                options={[{value: 'show', label: 'Show'}, {value: 'hide', label: 'Hide'}]}
                onChange={value => setRollOpen(value === 'show')}/>
            </SettingsRow>
          </SettingsGroup>
        </PracticeSettingsProvider>
      </PracticePanel>}
      {isPractice && practicePanel === 'sections' && <PracticePanel title="Sections"
        onClose={() => setPracticePanel(null)}>
        <div className="practice-section-list section-picker">
          {chunks.length > 0 ? chunks.map(chunk => <button key={chunk.index}
            type="button" className="section-picker-item" onClick={() => {
              setActiveChunkIndex(chunk.index);
              seek(chunk.start);
              setPracticePanel(null);
            }}>{chunk.label}</button>)
            : <button type="button" className="section-picker-item" onClick={() => {
              seek(0);
              setActiveChunkIndex(0);
              setPracticePanel(null);
            }}>Whole piece</button>}
        </div>
      </PracticePanel>}

      {!isPractice && <aside ref={drawerRef} className="ws-side ws-drawer"
        role={drawerTarget === 'note' ? 'region' : 'dialog'}
        aria-label={drawerTarget === 'note' ? 'Note editor' : drawerTarget === 'more' ? 'More'
          : drawerTarget === 'video' ? 'Video' : drawerTarget === 'sound' ? 'Sound' : 'Settings and details'}
        aria-modal={drawerTarget === 'note' ? undefined : 'false'} hidden={!drawerOpen}
        data-settings-drawer="true" data-mode={drawerTarget}
        data-settings-tab={settingsTab}
        data-note-expanded={noteEditorExpanded ? 'true' : 'false'}
        data-note-advanced={noteAdvancedOpen ? 'true' : 'false'}
        data-peek-position={notePeekPosition}
        data-suppressed={editorSuppressed ? 'true' : 'false'}>
        <header className="ws-drawer-head">
          <h2>{drawerTarget === 'note' ? 'Note editor' : drawerTarget === 'more' ? 'More'
            : drawerTarget === 'video' ? 'Video' : drawerTarget === 'sound' ? 'Sound' : 'Settings & details'}</h2>
          <button type="button" className="ws-icon-button"
            aria-label={drawerTarget === 'note' ? 'Close note editor' : 'Close settings'}
            title={drawerTarget === 'note' ? 'Close note editor' : 'Close settings'}
            onClick={() => { setPitchPickMode(null); setDrawerOpen(false); }}><X size={19}/></button>
        </header>
        <div className="ws-drawer-body">
        <nav className="ws-drawer-tabs" aria-label="Settings sections">
          {([
            ['view', 'Playback & view'],
            ['editing', 'Editing'],
            ['lesson', 'Lesson'],
            ['timing', 'Advanced timing'],
            ['more', 'More'],
          ] as const).filter(([key]) => !isPractice || key !== 'editing').map(([key, label]) =>
            <button key={key} type="button" aria-pressed={settingsTab === key}
              className={settingsTab === key ? 'is-active' : ''}
              onClick={() => setSettingsTab(key)}>{label}</button>)}
        </nav>
        <section className="ws-drawer-section" data-ws-section="settings" data-settings-section="view">
          <h3>View &amp; playback</h3>
          <div className="ws-row">
            <label className="ws-field ws-inline">
              <span><input type="checkbox" aria-label="Follow playback" checked={follow}
                onChange={event => { setFollow(event.target.checked); if (event.target.checked) { setFollowSuspended(false); revealSource(playhead); } }}/> Follow playback</span>
            </label>
          </div>
          <p className="ws-hint" data-space-hint="true">Press Space to play or pause when the workspace has focus. Typing, sliders, buttons and piano keys keep their normal Space behavior.</p>
          {isPractice&&<div className="ws-row" data-practice-stops="true">
            <label className="ws-field ws-inline">
              <span>Practice stops</span>
              <select aria-label="Practice stops" value={chunkBars}
                onChange={event => {
                  setChunkBars(Number(event.target.value) as ChunkBarsOption);
                  setActiveChunkIndex(0);
                }}>
                <option value={0}>Off / Continuous</option>
                <option value={1}>Every 1 bar</option>
                <option value={2}>Every 2 bars (8 beats in 4/4)</option>
                <option value={4}>Every 4 bars</option>
              </select>
            </label>
          </div>}
          {isPractice&&chunkPickerOpen&&<section className="ws-practice-chunk-picker" data-practice-chunk-picker="true">
            <h3>Practice sections</h3>
            <div className="ws-row">
              {chunks.length > 0 ? chunks.map((chunk, index) => <button key={chunk.index} type="button"
                aria-pressed={activeChunkIndex === index}
                onClick={() => { setActiveChunkIndex(index); seek(chunk.start); }}>
                {chunk.label} <small>{chunk.start.toFixed(1)}–{chunk.end.toFixed(1)}s</small>
              </button>) : <button type="button" onClick={() => seek(0)}>Whole piece</button>}
            </div>
          </section>}
          <section className="ws-hand-legend" data-hands-legend="true" aria-label="Hand estimate legend">
            <h2>Hands</h2>
            <div className="ws-row">
              <span className="ws-hand-swatch hand-left">Left</span>
              <span className="ws-hand-swatch hand-right">Right</span>
              <span className="ws-hand-swatch hand-unassigned">Unknown</span>
            </div>
            <p className="ws-hint" data-hands-status={hands.status}>
              {hands.status === 'loading' ? 'Checking the piano-hand model…'
                : hands.status === 'model' ? 'Model estimate applied; manual choices stay locked.'
                : hands.status === 'too-many' ? 'Musical baseline only: this lesson exceeds the bounded model limit.'
                : hands.status === 'unavailable' ? 'Musical baseline only: the model is unavailable.'
                : 'Musical baseline estimate. Manual choices stay locked.'}
            </p>
            {hands.modelInfo && <p className="ws-hint" data-hands-model-identity="true">
              midi2hands · {hands.modelInfo.version.slice(0, 12)} · {hands.modelInfo.sha256.slice(0, 12)}…
            </p>}
            <p className="ws-hint" data-hands-reliability="true">
              Automatic labels are uncalibrated estimates, not verified pianist truth. Use Left/Right/Unknown in the note editor to lock an override; Auto returns to these estimates.
            </p>
            <button type="button" data-hands-refresh="true" disabled={readOnly || hands.status === 'loading'}
              onClick={hands.refresh}>Refresh hand estimates</button>
            <p className="ws-hint">Colours are estimates, not verified truth. Blue is left, amber is right, grey-green is unknown; striped means both hands at the same pitch.</p>
          </section>
          {narrowViewport && <div className="ws-row" data-mobile-actions="true">
            <button type="button" onClick={() => dispatch({type: 'undo'})}
              disabled={readOnly || !state.past.length || Boolean(replaceMode) || Boolean(addMode)}>Undo</button>
            <button type="button" onClick={() => dispatch({type: 'redo'})}
              disabled={readOnly || !state.future.length || Boolean(replaceMode) || Boolean(addMode)}>Redo</button>
            <button type="button" onClick={() => setDrawerTarget('more')}>More actions</button>
            <label className="ws-field ws-inline"><span>Speed</span>
              <select value={rate} onChange={event => changeRate(Number(event.target.value))}>
                {[0.5, 0.75, 1].map(value => <option key={value} value={value}>{value}×</option>)}
              </select>
            </label>
          </div>}
          <div className="ws-zoom" role="group" aria-label="Zoom">
            <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
            <span className="ws-window-label" data-window-span={(() => {
              if (!timelineLayout || !alignment || sharedWidth <= 0) return window.span.toFixed(2);
              const from = timelineLayout.xToSourceSeconds(Math.max(0, sharedScrollLeft - 116), alignment, 0);
              const to = timelineLayout.xToSourceSeconds(Math.max(0, sharedScrollLeft - 116 + sharedWidth), alignment, 0);
              return Math.max(0.01, to - from).toFixed(2);
            })()} data-shared-zoom={zoomFactor.toFixed(3)}>
              {(() => {
                if (!timelineLayout || !alignment || sharedWidth <= 0) {
                  return `${window.span.toFixed(window.span < 10 ? 1 : 0)} s visible`;
                }
                const from = timelineLayout.xToSourceSeconds(Math.max(0, sharedScrollLeft - 116), alignment, 0);
                const to = timelineLayout.xToSourceSeconds(Math.max(0, sharedScrollLeft - 116 + sharedWidth), alignment, 0);
                return `${Math.max(0, to - from).toFixed(Math.max(0, to - from) < 10 ? 1 : 0)} s visible`;
              })()}
            </span>
            <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom in">+</button>
          </div>
          <label className="ws-field">
            <span>{spans.length ? 'Source clock position' : 'Position'}</span>
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
          {alignment && heldPassageAt(alignment, playhead) ? <p className="ws-hint" data-held-passage="true">Explanation · score paused</p> : null}
          {alignment && timelineLayout && (playhead < tickToEffectiveSeconds(alignment, 0, 0)
            || playhead > tickToEffectiveSeconds(alignment, timelineLayout.totalTicks, 0)) ? <p className="ws-hint" data-outside-score="true">
            Outside scored passage</p> : null}
        </section>
        <section className="ws-drawer-section" data-ws-section="settings" data-settings-section="editing">
          <h3>Editing &amp; timing</h3>
          <div className="ws-row">
            <label className="ws-field ws-inline">
              <span>Snap</span>
              <select value={snapTicks} onChange={event => setSnapTicks(Number(event.target.value))}>
                {SNAP_CHOICES.map(choice => <option key={choice.label} value={choice.ticks}>{choice.label}</option>)}
              </select>
            </label>
            <label className="ws-field ws-inline">
              <span>Offset (s)</span>
              <input type="number" step={0.01} min={-10} max={10} value={offsetSeconds} style={{width: 72}}
                disabled={readOnly}
                aria-label="Sync offset in seconds"
                onChange={event => { if (readOnlyRef.current) return; setOffsetSeconds(Math.max(-10, Math.min(10, Number(event.target.value) || 0))); }}/>
            </label>
          </div>
          {diff && <p className="ws-hint">Your changes: {diff.changed} changed · {diff.added} added · {diff.removed} removed</p>}
        </section>
        {guitar && <section className="ws-drawer-section" data-ws-section="settings" data-settings-section="guitar"
          aria-label="Guitar settings">
          <h3>Guitar</h3>
          <label className="ws-field">Guitar sound
            <select aria-label="Guitar sound" value={guitarTone}
              onChange={event => setGuitarTone(Number(event.target.value))}>
              <option value={25}>Acoustic Steel</option>
              <option value={24}>Classical Nylon</option>
              <option value={27}>Clean Electric</option>
              <option value={26}>Jazz</option>
            </select>
          </label>
          <label className="ws-field">Fretboard orientation
            <select aria-label="Fretboard orientation" value={guitarHandedness}
              onChange={event => setGuitarHandedness(event.target.value === 'left' ? 'left' : 'right')}>
              <option value="right">Right-handed</option>
              <option value="left">Left-handed</option>
            </select>
          </label>
          <div className="ws-row" role="group" aria-label="Guitar stage">
            <button type="button" aria-pressed={rollMode === 'strings'} data-stage-roll="strings"
              onClick={() => { setRollMode('strings'); setRollOpen(true); }}>Roll</button>
            <button type="button" aria-pressed={staffMode === 'guitar-tab'} data-stage-compact="tab"
              onClick={() => setStaffMode(staffMode === 'guitar-tab' ? 'guitar-both' : 'guitar-tab')}>
              {staffMode === 'guitar-tab' ? 'TAB + Sheet' : 'Compact TAB'}
            </button>
          </div>
          <p className="ws-hint">Guitar notes use the same score, transport and practice engine as piano.</p>
        </section>}
        <section className="ws-drawer-section" data-ws-section="sound" aria-label="Sound">
          <h3>Sound</h3>
          <div className="ws-row" role="group" aria-label="Source audio options">
            <button type="button" aria-pressed={audioMode === 'original'}
              className={audioMode === 'original' ? 'is-active' : ''}
              onClick={() => setAudioMode('original')}>Original</button>
            <button type="button" aria-pressed={audioMode === 'piano'}
              className={audioMode === 'piano' ? 'is-active' : ''}
              disabled={pianoDisabled}
              title={pianoTitle}
              onClick={() => setAudioMode('piano')}>{guitar ? 'Guitar' : 'Piano'}</button>
          </div>
          {verifiedPreview && hasWebAudio && <div className="ws-row" role="group"
            aria-label="Piano synthesis source" data-piano-source="true">
            <button type="button" aria-pressed={!preferRenderedWav}
              className={!preferRenderedWav ? 'is-active' : ''}
              onClick={() => setPreferRenderedWav(false)}>Live grand piano</button>
            <button type="button" aria-pressed={preferRenderedWav}
              className={preferRenderedWav ? 'is-active' : ''}
              onClick={() => setPreferRenderedWav(true)}>Rendered WAV</button>
          </div>}
          <div className="ws-row" role="group" aria-label="MIDI export">
            <button type="button" disabled={!liveMidiBytes}
              onClick={() => {
                if (!liveMidiBytes) return;
                downloadMidiFile(`${title.trim() || 'performance'}.mid`, liveMidiBytes);
              }}>Export .mid</button>
          </div>
        </section>
        <section className="ws-drawer-section" data-ws-section="video" aria-label="Reference video">
          <h3>Video</h3>
          {videoUrl
            ? <button type="button" aria-pressed={pipOpen}
                onClick={() => setPipOpen(open => !open)}>{pipOpen ? 'Hide video' : 'Show video'}</button>
            : <p className="ws-hint">This draft has no source video.</p>}
          <span className="ws-hint" data-preview-state={verifyingPreview ? 'verifying'
            : previewAsset && !preview.url ? 'unavailable' : useWavPreview ? 'verified' : 'live'}>
            {guitar
              ? 'Guitar plays live synthesized notes from the score, with the chosen guitar tone across all six strings; Original keeps the video sound.'
              : previewStale
                ? 'Piano preview is stale: the notes changed. Piano plays live synthesized grand piano notes from the edited score, with velocity dynamics and sustain pedal.'
                : verifyingPreview
                  ? 'Verifying piano audio… Original plays until it is verified.'
                  : previewAsset && !preview.url
                    ? `Piano unavailable as a verified WAV: ${preview.error ?? 'the audio could not be verified'} Original audio remains active.`
                    : useWavPreview
                      ? 'Verified piano preview follows the video clock; it never free-runs. Choose Live grand piano above for the synthesized performance.'
                      : 'Piano plays live synthesized grand piano notes from the score and performance, with velocity dynamics and sustain pedal; Original keeps the video sound.'}
          </span>
        </section>

        <section className="ws-drawer-section ws-note-section" data-ws-section="note"
          data-note-expanded={noteEditorExpanded ? 'true' : 'false'}
          data-note-advanced={noteAdvancedOpen ? 'true' : 'false'} aria-label="Selected note">
          {!selection || !selected
            ? <p className="ws-hint">Select a note in the roll, the score or the keyboard to edit it.</p>
            : <>
              <header className="ws-note-head">
                <div>
                  <h2>{selected.spelling}</h2>
                  <p className="ws-note-location">{pitchName(selected.pitch)} · measure {selection.measureIndex + 1} · {selection.staff} voice {selection.voice}</p>
                </div>
                {narrowViewport && !noteEditorExpanded && <div className="ws-note-peek-actions">
                  <button type="button" disabled={readOnly}
                    onClick={() => { audition([selected.pitch], Math.min(1.2, selected.duration ?? 0.4), selected.velocity); }}>Preview</button>
                  <button type="button" onClick={() => { setNoteEditorExpanded(true); setNoteAdvancedOpen(false); }}>Edit note</button>
                </div>}
              </header>
              {(!narrowViewport || noteEditorExpanded) && <div className="ws-note-primary">
                <div className="ws-row" role="group" aria-label="Note actions">
                  <button type="button" disabled={readOnly} onClick={() => { audition([selected.pitch], Math.min(1.2, selected.duration ?? 0.4), selected.velocity); }}>Preview</button>
                  <button type="button" data-pitch-pick aria-pressed={pitchPickMode?.occurrenceId === selection.occurrenceId}
                    disabled={readOnly}
                    onClick={() => {
                      modeReturnFocus.current = globalThis.document.activeElement as HTMLElement | null;
                      setReplaceMode(null); setAddMode(null);
                      setPitchPickMode({occurrenceId: selection.occurrenceId, pitch: selected.pitch});
                      setNotice(`Choose a key for ${selected.spelling}, or press Escape to cancel.`);
                    }}>Choose on keyboard</button>
                </div>
                {!isPractice && narrowViewport && <div className="ws-row ws-note-history" role="group" aria-label="Note history">
                  <button type="button" onClick={() => dispatch({type: 'undo'})}
                    disabled={readOnly || !state.past.length || Boolean(replaceMode) || Boolean(addMode)}>Undo</button>
                  <button type="button" onClick={() => dispatch({type: 'redo'})}
                    disabled={readOnly || !state.future.length || Boolean(replaceMode) || Boolean(addMode)}>Redo</button>
                </div>}
                <div className="ws-row" role="group" aria-label="Pitch">
                  <button type="button" disabled={readOnly} onClick={() => dispatch({type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: selection.occurrenceId, pitch: selected.pitch - 1}})}>− semitone</button>
                  <button type="button" disabled={readOnly} onClick={() => dispatch({type: 'command', command: {type: 'set-occurrence-pitch', occurrenceId: selection.occurrenceId, pitch: selected.pitch + 1}})}>+ semitone</button>
                </div>
                {guitar ? (() => {
                  const occurrence = document.performance.find(item => item.id === selection.occurrenceId);
                  if (!occurrence) return null;
                  const position = positionOf(occurrence);
                  if (!position) return <p className="ws-hint" data-unplayable-note="true" role="status">
                    {pitchName(occurrence.pitch)} has no playable position under the current tuning and capo.
                  </p>;
                  return <div className="ws-guitar-note-editor" data-guitar-note-editor="true"
                    data-guitar-current={`${position.string}:${position.fret}`}>
                    <div className="ws-row" role="group" aria-label="Guitar string and fret">
                      <label className="ws-field ws-inline"><span>String</span>
                        <select aria-label="Guitar string" value={position.string} disabled={readOnly}
                          onChange={event => {
                            const string = Number(event.target.value);
                            const fret = position.fret;
                            const outcome = applyCommand(document, {type: 'set-guitar-position',
                              occurrenceId: selection.occurrenceId, string, fret});
                            if (outcome.status === 'rejected') { setNotice(outcome.message); return; }
                            dispatch({type: 'command', command: {type: 'set-guitar-position',
                              occurrenceId: selection.occurrenceId, string, fret}});
                          }}>
                          {[1, 2, 3, 4, 5, 6].map(string => <option key={string} value={string}>{string}</option>)}
                        </select>
                      </label>
                      <label className="ws-field ws-inline"><span>Fret</span>
                        <input aria-label="Guitar fret" type="number" min={0} max={24} data-guitar-fret-input="true"
                          value={fretDraft} placeholder={String(position.fret)} disabled={readOnly}
                          onChange={event => setFretDraft(event.target.value)}/>
                      </label>
                      <button type="button" data-guitar-fret-apply="true" disabled={readOnly || !fretDraft.trim()}
                        onClick={() => {
                          const fret = Number(fretDraft);
                          if (!Number.isInteger(fret) || fret < 0 || fret > 24) { setNotice('A fret must be a whole number between 0 and 24.'); return; }
                          const outcome = applyCommand(document, {type: 'set-guitar-position',
                            occurrenceId: selection.occurrenceId, string: position.string, fret});
                          if (outcome.status === 'rejected') { setNotice(outcome.message); return; }
                          dispatch({type: 'command', command: {type: 'set-guitar-position',
                            occurrenceId: selection.occurrenceId, string: position.string, fret}});
                          setFretDraft('');
                        }}>Set position</button>
                    </div>
                    <div className="ws-row" role="group" aria-label="Shift string keeping pitch">
                      <span className="ws-hint">Shift string (keep pitch)</span>
                      {[1, 2, 3, 4, 5, 6].map(string => <button key={string} type="button"
                        data-shift-string={string} disabled={readOnly || string === position.string}
                        onClick={() => {
                          const outcome = applyCommand(document, {type: 'shift-guitar-string',
                            occurrenceId: selection.occurrenceId, string});
                          if (outcome.status === 'rejected') { setNotice(outcome.message); return; }
                          dispatch({type: 'command', command: {type: 'shift-guitar-string',
                            occurrenceId: selection.occurrenceId, string}});
                        }}>{string}</button>)}
                    </div>
                    <div className="ws-row" role="group" aria-label="Choose on fretboard">
                      <button type="button" data-guitar-fret-pick="true"
                        aria-pressed={fretPickMode === selection.occurrenceId}
                        disabled={readOnly}
                        onClick={() => { setFretPickMode(fretPickMode === selection.occurrenceId ? null : selection.occurrenceId);
                          setNotice(fretPickMode === selection.occurrenceId ? 'Fretboard pick cancelled.'
                            : 'Click a string and fret on the guitar neck.'); }}>
                        Choose on fretboard
                      </button>
                    </div>
                  </div>;
                })() : null}
                <div className="ws-row ws-hand-picker" role="group" aria-label="Hand assignment"
                  data-hand-assignment="true" data-hand-current={hands.assignments[selection.occurrenceId]?.hand ?? 'unassigned'}>
                  <span className="ws-hint">Hand</span>
                  {(['left', 'right', 'unassigned'] as const).map(hand =>
                    <button key={hand} type="button" data-hand-choice={hand}
                      aria-pressed={(hands.assignments[selection.occurrenceId]?.hand ?? 'unassigned') === hand}
                      disabled={readOnly || Boolean(replaceMode) || Boolean(addMode)}
                      onClick={() => dispatch({type: 'command',
                        command: {type: 'set-occurrence-hand', occurrenceId: selection.occurrenceId, hand}})}>
                      {hand === 'left' ? 'Left' : hand === 'right' ? 'Right' : 'Unknown'}
                    </button>)}
                  <button type="button" data-hand-reset="true"
                    disabled={readOnly || !document.hand_assignments?.[selection.occurrenceId]?.manual}
                    title="Remove the manual override and return to automatic estimates"
                    onClick={() => dispatch({type: 'command',
                      command: {type: 'reset-occurrence-hand', occurrenceId: selection.occurrenceId}})}>Auto</button>
                  <span className="ws-hint" data-hand-provenance="true">
                    {hands.assignments[selection.occurrenceId]?.manual ? 'manual override' :
                      `${hands.assignments[selection.occurrenceId]?.source ?? 'baseline'} · ${hands.assignments[selection.occurrenceId]?.confidence ?? 'ambiguous'}`}
                  </span>
                </div>
                <div className="ws-row" role="group" aria-label="Written duration">
                  <span className="ws-hint">{writtenScope === 'event' ? 'Note value · whole event' : 'Note value'}</span>
                  {DURATION_CHOICES.map(choice => <button key={choice.label} type="button" disabled={readOnly}
                    onClick={() => dispatch({type: 'command', command: writtenScope === 'note'
                      ? {type: 'set-written-duration', target: {logicalNoteId: selection.logicalNoteId}, ticks: choice.ticks, scope: 'note'}
                      : {type: 'set-written-duration', target: {eventId: selection.eventId}, ticks: choice.ticks, scope: 'event'}})}>
                    {choice.label}
                  </button>)}
                </div>
                <label className="ws-field">
                  <span>Loudness {selected.velocity === null ? '(unknown)' : `${Math.round(selected.velocity * 100)}%`}</span>
                  <input type="range" min={0} max={1} step={0.01} disabled={readOnly} value={selected.velocity ?? 0.7}
                    onChange={event => dispatch({type: 'command', command: {type: 'set-occurrence-velocity', occurrenceId: selection.occurrenceId, velocity: Number(event.target.value)}})}/>
                </label>
                <button type="button" className="ws-note-more-toggle" aria-expanded={noteAdvancedOpen}
                  onClick={() => setNoteAdvancedOpen(value => !value)}>
                  {noteAdvancedOpen ? 'Less timing' : 'Timing & more…'}
                </button>
              </div>}
              {noteAdvancedOpen && <div className="ws-note-secondary">
                <fieldset className="ws-inspector-fieldset" disabled={readOnly || Boolean(replaceMode) || Boolean(addMode)}>
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

              <div className="ws-row" role="group" aria-label="More pitch options">
                <button type="button" data-replace="start" disabled={Boolean(addMode)} aria-label="Replace pitch"
                  onClick={() => { modeReturnFocus.current = globalThis.document.activeElement as HTMLElement | null; setAddMode(null); setPitchPickMode(null); setReplaceMode({occurrenceId: selection.occurrenceId, pitch: selected.pitch}); setNotice(''); }}>Replace pitch</button>
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
              <NumberField label="Start (s)" value={selected.onset} min={0} max={document.duration} step={0.001}
                onCommit={value => { if (value !== null) dispatch({type: 'command', command: {type: 'set-occurrence-onset', occurrenceId: selection.occurrenceId, seconds: value, snapSeconds}}); }}/>
              <NumberField label="Recorded length (s)" value={selected.duration} min={0.001} max={document.duration} step={0.001}
                onCommit={value => { if (value !== null) dispatch({type: 'command', command: {type: 'set-occurrence-duration', occurrenceId: selection.occurrenceId, seconds: value}}); }}/>

              <div className="ws-row" role="group" aria-label="Remove">
                <button type="button" onClick={() => requestReveal(selection.occurrenceId)}>Reveal in views</button>
                <button type="button" onClick={() => { audition([selected.pitch], Math.min(1.2, selected.duration ?? 0.4), selected.velocity); }}>Audition</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'delete-occurrence', occurrenceId: selection.occurrenceId}})}>Delete note</button>
                <button type="button" onClick={() => dispatch({type: 'command', command: {type: 'delete-logical-note', logicalNoteId: selection.logicalNoteId}})}>Delete logical note</button>
              </div>
              <p className="ws-hint">
                Written value and recorded length are independent. Start uses exact seconds unless a Snap value is chosen.
              </p>
                </fieldset>
              </div>}
            </>}
        </section>

        {guitar && <section className="ws-drawer-section" data-ws-section="chords" aria-label="Guitar chord shapes">
          <h2>Chord shapes</h2>
          <div className="ws-row" role="group" aria-label="Chord shape actions">
            <button type="button" data-chord-detect="true" disabled={readOnly}
              onClick={() => {
                const detected = detectGuitarChords(document.performance.map(note => ({
                  id: note.id, onset: note.onset, pitch: note.pitch,
                  string: positionOf(note)?.string ?? null,
                  fret: positionOf(note)?.fret ?? null,
                }))).slice(0, 100);
                setGuitarChords(detected);
                setNotice(detected.length
                  ? `Detected ${detected.length} chord shape${detected.length === 1 ? '' : 's'} from the notes; review them before saving.`
                  : 'No strummed chord clusters were detected in this performance.');
              }}>Auto-detect from notes</button>
            <button type="button" data-chord-add="true" disabled={readOnly || guitarChords.length >= 100}
              onClick={() => {
                if (readOnly || guitarChords.length >= 100) return;
                const id = `chord-${Date.now().toString(36)}`;
                setGuitarChords(chords => [...chords, {
                  id, name: 'C', start: Math.max(0, playhead), frets: [0, 0, 0, 0, 0, 0], position: 1,
                }].sort((left, right) => left.start - right.start));
              }}>Add shape</button>
          </div>
          {guitarChords.length === 0
            ? <p className="ws-hint">No reviewed chord shapes yet. Detect them from the notes or add one at the playhead.</p>
            : <ul className="ws-chord-shape-list" aria-label="Reviewed chord shapes">
              {guitarChords.map(chord => <li key={chord.id} data-chord-shape={chord.id}>
                <label className="ws-field ws-inline"><span>Name</span>
                  <input value={chord.name} maxLength={40} disabled={readOnly} aria-label={`Chord ${chord.id} name`}
                    onChange={event => setGuitarChords(chords => chords.map(item => item.id === chord.id
                      ? {...item, name: event.target.value} : item))}
                    onBlur={() => setGuitarChords(chords => chords.map(item => item.id === chord.id
                      ? {...item, name: item.name.trim() || 'Chord'} : item))}/>
                </label>
                <label className="ws-field ws-inline"><span>At (s)</span>
                  <input type="number" min={0} step={0.01} value={chord.start} disabled={readOnly}
                    aria-label={`Chord ${chord.id} start`}
                    onChange={event => setGuitarChords(chords => chords.map(item => item.id === chord.id
                      ? {...item, start: Math.max(0, Number(event.target.value))} : item))}/>
                </label>
                <span className="ws-hint" data-chord-frets="true">{chord.frets.map(fret => fret < 0 ? 'x' : fret).join(' ')}</span>
                <label className="ws-field ws-inline"><span>Frets</span>
                  <input defaultValue={chord.frets.join(' ')} disabled={readOnly}
                    aria-label={`Chord ${chord.id} frets`} data-chord-frets-input="true"
                    onBlur={event => {
                      const parts = event.target.value.trim().split(/\s+/).map(Number);
                      const positive = parts.filter(fret => fret > 0);
                      if (parts.length === 6 && parts.every(fret => Number.isInteger(fret) && fret >= -1 && fret <= 24)
                        && parts.some(fret => fret >= 0)
                        && (!positive.length || Math.max(...positive) - Math.min(...positive) <= 3)) {
                        setGuitarChords(chords => chords.map(item => item.id === chord.id
                          ? {...item, frets: parts, position: positive.length ? Math.max(1, Math.min(...positive)) : 1} : item));
                      } else {
                        event.target.value = chord.frets.join(' ');
                        setNotice('Enter six frets (-1 muted, 0 open, 1-24) inside a four-fret span.');
                      }
                    }}/>
                </label>
                <button type="button" disabled={readOnly} aria-label={`Remove chord ${chord.name}`}
                  onClick={() => setGuitarChords(chords => chords.filter(item => item.id !== chord.id))}>Remove</button>
              </li>)}
            </ul>}
          <p className="ws-hint">Chord shapes are suggestions authored in this editor; they are saved with the guitar reference.</p>
        </section>}

        <section className="ws-drawer-section" data-ws-section="insert" data-settings-section="editing" aria-label="Insert">
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
          <p className="ws-hint">Insertion is rejected when it would overwrite or collide. “Add to chord” only joins an identical written position.</p>
        </section>

        <section className="ws-drawer-section" data-ws-section="timing" data-settings-section="timing" aria-label="Alignment">
          <fieldset disabled={readOnly} style={{border: 0, padding: 0, margin: 0, minWidth: 0}}>
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
          </fieldset>
        </section>

        <section className="ws-drawer-section" data-ws-section="more" data-settings-section="more" aria-label="History and more">
          <h2>More</h2>
          <div className="ws-row">
            <button type="button" data-formatted-toggle="true"
              aria-pressed={scoreMode === 'formatted'}
              onClick={() => {
                setAddMode(null); setReplaceMode(null); setDuplicateId(null);
                setScoreMode('formatted');
                setDrawerOpen(false);
              }} aria-label="Formatted score">Formatted preview</button>
            <button type="button" onClick={reopen} disabled={Boolean(replaceMode) || Boolean(addMode)}>Reopen saved</button>
            <button type="button" onClick={downloadMusicXml}>MusicXML</button>
            <button type="button" onClick={downloadReference}>Download reference</button>
          </div>
          <h2>History</h2>
          <p className="ws-hint">
            {summary.undoSteps} undo step(s) · {summary.redoSteps} redoable ·{' '}
            {(summary.totalBytes / 1024).toFixed(1)} KB retained ({summary.undoBytes} B undo + {summary.redoBytes} B redo){' '}
            {summary.evicted ? '· oldest entries dropped' : ''}
          </p>
          <p className="ws-hint">History stores only the notes and events each edit changed; the score is rebuilt on undo.</p>
        </section>
        <section className="ws-drawer-section" data-ws-section="lesson" data-settings-section="lesson">
          <details className="ws-advanced-details" data-lesson-settings="true">
            <summary>Lesson settings, teaching sections and assessment</summary>
            <fieldset disabled={readOnly} style={{border: 0, padding: 0, margin: 0, minWidth: 0}}>
            <h2>Teaching sections</h2>
            <div className="ws-row">
              <button type="button" data-section-add onClick={() => {
                if (readOnlyRef.current) return;
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
            {sectionsDraft.map((section, index) => <fieldset key={section.id} data-section={section.id} disabled={readOnly}>
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
                      return next.map((item, position) => position === index - 1 ? {...item, end: removed.end} : item);
                    }
                    return next.map((item, position) => position === 0 ? {...item, start: 0} : item);
                  });
                  setConfirmReviewed(false);
                }}>Remove</button>}
              </div>
            </fieldset>)}
            <h2>Feedback</h2>
            <label className="review-checkbox ws-field ws-inline">
              <input type="checkbox" checked={feedbackEnabled} data-feedback-enabled
                disabled={readOnly}
                onChange={event => {
                  if (readOnlyRef.current) return;
                  setFeedbackEnabled(event.target.checked);
                  setConfirmReviewed(false);
                }}/> Enable practice feedback
            </label>
            <p className="ws-hint" data-assessment-policy="notes">When enabled, reviewed piano and guitar references offer local pitch-and-timing feedback. Guitar uses sounding pitch only; scoring stays experimental and withheld. Turning it off never deletes notes, sections, alignment or the saved reference.</p>
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
            </fieldset>
          </details>
        </section>
        </div>
      </aside>}
      {drawerOpen && drawerTarget !== 'note' && !editorSuppressed &&
        <button type="button" className="ws-drawer-scrim" aria-label="Close settings"
          onClick={() => setDrawerOpen(false)}/>}
      {reviewOpen && <div className="ws-review-scrim">
        <section ref={reviewRef} className="ws-review" role="dialog" aria-modal="true" aria-label="Review and save">
          <header><h2>Review and save</h2>
            <button type="button" className="ws-icon-button" aria-label="Close review" onClick={() => setReviewOpen(false)}><X size={18}/></button>
          </header>
          <p className="ws-review-title">{title || 'Piano review'}</p>
          <p className="ws-review-state" data-review-state={dirty ? 'dirty' : 'clean'}>
            {dirty ? 'Unsaved changes · private draft' : savedRevisionId ? 'Saved revision' : 'Private draft'}
          </p>
          <p className="ws-hint">Saving creates a private revision for this lesson. A local backup is not a server save.</p>
          {saveError && <p className="ws-report is-bad">{saveError}</p>}
          {saveConflict && <p className="ws-report is-bad">
            This draft conflicts with a newer revision. Close review to choose “Save on latest revision” or “Reload saved revision”.
          </p>}
          <label className="ws-review-confirm">
            <input type="checkbox" aria-label="Confirm reviewed" checked={confirmReviewed}
              onChange={event => setConfirmReviewed(event.target.checked)}/>
            <span>I reviewed these changes and want to save them privately.</span>
          </label>
          <div className="ws-review-actions">
            <button type="button" data-review-focus="true" onClick={() => setReviewOpen(false)}>Cancel</button>
            <button type="button" data-save-button="true" aria-label="Save privately" className="ws-save"
              disabled={readOnly || !confirmReviewed || saving || !(dirty || savedRevisionId === null)}
              onClick={() => { setSaveAttempted(true); void save(); }}>
              {saving ? 'Saving…' : 'Save privately'}
            </button>
          </div>
        </section>
      </div>}

      {stageView !== 'place' && addModePanel}
      {!isPractice && addMenuOpen && <section className="ws-add-menu" role="dialog" aria-label="Add note options">
        <header><strong>Add a note</strong>
          <button type="button" className="ws-icon-button" aria-label="Close add note" onClick={() => setAddMenuOpen(false)}><X size={16}/></button>
        </header>
        <button type="button" data-add-menu="playhead" disabled={readOnly}
          onClick={() => { insertAtPlayhead(false); setAddMenuOpen(false); }}>Insert at playhead</button>
        <button type="button" data-add-menu="chord" disabled={readOnly}
          onClick={() => { insertAtPlayhead(true); setAddMenuOpen(false); }}>Insert into chord</button>
        <button type="button" data-add-menu="place" disabled={readOnly}
          onClick={() => {
            setDrawerOpen(false); setReplaceMode(null); setPitchPickMode(null); setDuplicateId(null);
            setAddMode({seconds: playhead - offsetSeconds, pitch: selected?.pitch ?? 60,
              ticks: lastWrittenTicks.current, durationSeconds: lastRecordedSeconds.current});
            setNotice('Click the roll to place the note; Escape cancels.');
            setAddMenuOpen(false);
          }}>Place note on the roll</button>
        <p className="ws-hint">Rest insertion is not supported by this score yet.</p>
      </section>}
    </div>

      {isPractice && <LivePracticeDock clock={clockRef.current} fallback={playhead}
        id="piano-practice-player" sections={timelineSections} duration={document.duration}
        activeIndex={practiceTimelineIndex} range={null} timelineDisabled={false}
        onScrubStart={() => {}}
        onSeek={seek}
        onSelect={index => {
          const section = timelineSections[index];
          if (!section) return;
          setActiveChunkIndex(index);
          seek(section.start);
        }}
        onBrowse={() => {
          setPracticePanel(panel => panel === 'sections' ? null : 'sections');
        }}
        primaryAction={<LivePracticePrimary clock={clockRef.current} fallback={playhead}
          chunks={chunks} activeChunkIndex={activeChunkIndex} playing={playing}
          practiceStarted={practiceStarted} onCommand={runPracticeCommand}
          onStart={startPracticePlayback}/>}
        toolsBefore={<>
          <select className="ws-practice-source-select" aria-label="Source audio" value={audioMode}
            onChange={event => setAudioMode(event.target.value === 'piano' ? 'piano' : 'original')}>
            <option value="original">Original</option>
            <option value="piano" disabled={pianoDisabled}>Piano</option>
          </select>
          <button type="button" className="player-tool" aria-label="Voice commands"
            aria-pressed={voiceEnabled}
            title={voiceStatus === 'unsupported'
              ? 'Voice recognition unavailable in this browser'
              : 'Voice commands (Next, Back, Again)'}
            onClick={() => setVoiceEnabled(enabled => !enabled)}>
            {voiceEnabled ? <Mic size={18}/> : <MicOff size={18}/>}
            <span>{voiceEnabled ? 'Voice on' : 'Voice off'}</span>
          </button>
        </>}
        speed={rate}
        onSpeedClick={() => { setSettingsRow('speed'); setPracticePanel('settings'); }}
        onSettingsClick={() => setPracticePanel(panel => panel === 'settings' ? null : 'settings')}
        toolsAfter={<button type="button" className="player-tool" aria-label="Video" title="Video"
          aria-pressed={pipOpen} onClick={() => setPipOpen(open => !open)}><Video size={19}/></button>}
        status={voiceStatus === 'listening' ? 'Listening for voice commands' : undefined}/>}
  </main>;
}

function notePeekPositionFor(rect: Pick<DOMRect, 'top' | 'bottom'> | undefined,
  viewportHeight: number): 'top' | 'bottom' {
  if (!rect || viewportHeight <= 0) return 'bottom';
  const bottomPeekTop = viewportHeight - 72 - 120;
  if (rect.bottom <= bottomPeekTop - 4) return 'bottom';
  const topPeekBottom = 56 + 120;
  if (rect.top >= topPeekBottom + 4) return 'top';
  return rect.top > viewportHeight / 2 ? 'top' : 'bottom';
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
function LivePracticePrimary({clock, fallback, chunks, activeChunkIndex, playing,
  practiceStarted, onCommand, onStart}: {
  clock: ClockStore;
  fallback: number;
  chunks: readonly PracticeChunk[];
  activeChunkIndex: number;
  playing: boolean;
  practiceStarted: boolean;
  onCommand: (command: PracticeVoiceCommand) => void;
  onStart: (voice: 'keep' | 'off') => void;
}) {
  const t = useClockTime(clock, fallback);
  const activeChunk = chunks[activeChunkIndex];
  const chunkFinished = Boolean(!playing && activeChunk
    && t >= activeChunk.end - 0.05 && activeChunkIndex < chunks.length - 1);
  const hasProgress = Boolean(activeChunk ? t > activeChunk.start + 0.05 : t > 0.05);
  if (!practiceStarted) {
    return <>
      <button type="button" className="practice-player-primary" onClick={() => onStart('keep')}>
        <Play size={18}/><span>Start practice</span>
      </button>
      <button type="button" className="player-text-action" onClick={() => onStart('off')}>Without voice</button>
    </>;
  }
  if (playing) {
    return <button type="button" className="practice-player-primary" onClick={() => onCommand('pause')}>
      <Pause size={18}/><span>Pause</span>
    </button>;
  }
  if (chunkFinished) {
    return <>
      <button type="button" className="practice-player-primary" onClick={() => onCommand('next')}>
        <ChevronRight size={18}/><span>Next section</span>
      </button>
      <button type="button" className="player-text-action" onClick={() => onCommand('again')}>Repeat section</button>
    </>;
  }
  return <>
    <button type="button" className="practice-player-primary" onClick={() => onCommand('play')}>
      <Play size={18}/><span>Play</span>
    </button>
    {hasProgress && <button type="button" className="player-text-action" onClick={() => onCommand('again')}>
      <RotateCcw size={14}/><span>Start over</span>
    </button>}
  </>;
}

function LivePracticeDock({clock, fallback, ...dock}: {
  clock: ClockStore;
  fallback: number;
} & Omit<React.ComponentProps<typeof PracticePlayerDock>, 'time'>) {
  const time = useClockTime(clock, fallback);
  return <PracticePlayerDock {...dock} time={time}/>;
}

function LiveTimeLabel({clock, fallback}: {clock: ClockStore; fallback: number}) {
  const time = useClockTime(clock, fallback);
  return <span className="ws-time">{timeLabel(time)}</span>;
}

function LiveFollowDirection({clock, fallback, timelineLayout, alignment, sharedWidth,
  sharedScrollLeft, playing}: {
  clock: ClockStore;
  fallback: number;
  timelineLayout: TimelineLayout | null;
  alignment: Alignment | null;
  sharedWidth: number;
  sharedScrollLeft: number;
  playing: boolean;
}) {
  const time = useClockTime(clock, fallback);
  if (!timelineLayout || !alignment || sharedWidth <= 0) return null;
  const p = 116 + timelineLayout.sourceSecondsToX(time, alignment, 0);
  const direction = p < sharedScrollLeft ? 'left'
    : p > sharedScrollLeft + sharedWidth ? 'right' : 'visible';
  if (direction === 'visible') return null;
  return <span className="ws-follow-direction" data-follow-direction={direction}
    aria-label={playing ? (direction === 'right' ? 'Playing to the right' : 'Playing to the left')
      : (direction === 'right' ? 'Playhead to the right' : 'Playhead to the left')}>
    {direction === 'right' ? '→' : '←'}
  </span>;
}

function LiveKeyboard({document, clock, intervals, selectedPitch, onKey, onSelectKey, width, height,
  range, onRangeChange, toolbarHint, hint, hands}: {
  document: NotationDocument;
  clock: ClockStore | null;
  intervals: { id: string; start: number; end: number; pitch: number }[];
  selectedPitch: number | null;
  onKey: (pitch: number, auditionOnly: boolean, velocity?: number) => void;
  onSelectKey: (pitch: number) => void;
  width: number;
  range?: PianoRange;
  onRangeChange?: (range: PianoRange) => void;
  height?: number;
  toolbarHint?: string;
  hint?: string;
  hands?: Record<string, {hand: Hand}>;
}) {
  const live = useClockTime(clock, 0);
  const soundingHands: Record<number, 'left' | 'right' | 'unassigned' | 'mixed'> = {};
  const activePitches: number[] = [];
  for (const interval of intervals) {
    if (!(live >= interval.start && live < interval.end)) continue;
    activePitches.push(interval.pitch);
    const hand = hands?.[interval.id]?.hand ?? 'unassigned';
    const previous = soundingHands[interval.pitch];
    soundingHands[interval.pitch] = previous && previous !== hand ? 'mixed' : hand;
  }
  return <KeyboardEditor document={document} selectedPitch={selectedPitch} activePitches={activePitches}
    soundingHands={soundingHands}
    onKey={onKey} onSelectKey={onSelectKey} width={width} height={height}
    range={range} onRangeChange={onRangeChange}
    toolbarHint={toolbarHint} hint={hint}/>;
}

/** Re-exported so the controller and tests share one selection constructor. */
export {selectionForOccurrence};
