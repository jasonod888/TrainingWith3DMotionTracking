/**
 * Production music review composition root (exported as `PianoWorkspaceHarness` for
 * compatibility and mounted review tests).
 *
 * The root composes focused owners: loading/recovery, document/history, selection,
 * alignment authoring, verification transactions, editor playback/audio, and
 * save/conflict state. Specialist notation surfaces and the topbar/note/verification/
 * settings views remain Act-owned. The compatibility `mode='practice'` branch delegates
 * to `PianoPracticeWorkspace` and does not import these editor controllers.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import {createEditorSession} from '../../editor/editor-session';
import {useMusicReviewSave} from './useMusicReviewSave';
import {useMusicReviewRecovery, type RecoveryRestore} from './useMusicReviewRecovery';
import {buildReviewSignature, captureReviewSaveSnapshot, isReviewDirty} from './review-selectors';
import {
  ChevronRight, Mic, MicOff, Pause, Play, RotateCcw, Video, Volume2, X,
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
import {type ReviewManifestDocument} from './editor-services';
import {useMusicEditorSelection} from './useMusicEditorSelection';
import {useMusicWorkspaceDocument} from './useMusicWorkspaceDocument';
import {useMusicReviewLoad} from './useMusicReviewLoad';
import {
  applyCommand, buildNotation, selectionForOccurrence,
  activeOccurrenceIds, effectiveSecondsToTick, occurrenceIntervals,
  scoreClock, secondsToTick, tickToEffectiveSeconds, tickToSeconds, toMusicXML, keyLabel,
  type Alignment, type NotationDocument,
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
import {downloadMidiFile, exportPerformanceToMidi} from '../midi-export';
import {
  buildPracticeChunks, chunkAtTime, parseVoiceCommand,
  type ChunkBarsOption, type PracticeChunk, type PracticeVoiceCommand,
} from '../practice-chunks';
import type {AcceptedBaseline} from './useMusicVerificationController';
import type {Asset, MusicPedalSpan} from '../../../../../packages/lesson-schema/index';
import {ClipOverview} from './ClipOverview';
import {ContinuousScore} from './ContinuousScore';
import {PianoWaterfall} from './PianoWaterfall';
import {TimeRoll} from './TimeRoll';
import {
  clampTimeWindow, DEFAULT_SPAN_SECONDS, layoutMeasures, zoomAround, type TimeWindow,
} from './viewport';import {
  historySummary, workspaceStatus,
} from './workspace-state';
import {
  buildWorkspaceExport, interactiveLimitApproved, resolveInteractionPolicy, serializeWorkspaceExport,
} from './interactive-limit';
import {useElementWidth} from './useElementWidth';
import {FormattedScore} from './FormattedScore';
import {useClockTime, type ClockStore} from './clock';
import {
  insertionPlacement, restoreFromReference, serializeAlignment,
  type SavedGuitarChord,
} from './save-payload';
import {useMusicAlignmentEditor} from './useMusicAlignmentEditor';
import {useMusicVerificationController} from './useMusicVerificationController';
import {useMusicEditorPlayback} from './useMusicEditorPlayback';
import {readCompactView, writeCompactView, type CompactView} from './compact-view';
import {MusicReviewHeader} from './MusicReviewHeader';
import {MusicAddNotePanel, MusicNoteInspector} from './MusicNoteInspector';
import {MusicReviewSettings} from './MusicReviewSettings';
import {MusicVerificationBanner, MusicVerificationPanel} from './MusicVerificationPanel';
import {GuitarChordStrumHud} from './GuitarChordStrumHud';
import GuitarNeckGuide from '../renderers/GuitarNeckGuide';
import {detectGuitarChords} from './guitar-chords';
import {instrumentAdapter} from './instrument-adapters';
import {
  GUITAR_TUNINGS, assignGuitarFingers, normalizeGuitarSetup,
  openStringPitch, resolveGuitarPosition, type GuitarFinger, type GuitarTuningId,
} from '../../../../../packages/music-notation/guitar.ts';
import {peekRecovery, sanitizeGuitarChords, type RecoveryIdentity} from './recovery';

/** Stable default order; a future layout descriptor may reorder these modules only. */
const DEFAULT_STAGE_LAYOUT = ['instrument', 'roll', 'sheet'] as const;

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

  const documentOwner = useMusicWorkspaceDocument();
  const {state, documentEpoch} = documentOwner;
  const document = state?.document ?? null;
  const interactionPolicy = document
    ? resolveInteractionPolicy(document.performance.length, interactiveLimitApproved())
    : {mode: 'read-only' as const, reason: 'The score is not ready.'};
  const readOnly = isPractice || interactionPolicy.mode === 'read-only';
  // Selection owns the transient edit modes, reveal token, focus/selection references
  // and the gesture→command translation; the root only composes its view behavior.
  const editorSelection = useMusicEditorSelection({
    state, document, dispatch: documentOwner.dispatch, readOnly,
  });
  const {
    selection, selected, addMode, setAddMode, replaceMode, setReplaceMode,
    pitchPickMode, setPitchPickMode, fretPickMode, setFretPickMode,
    respellDraft, setRespellDraft, reveal: rollReveal, requestReveal, modeReturnFocus,
    selectionReference, applyGesture,
  } = editorSelection;
  const [scoreMode, setScoreMode] = useState<'correction' | 'formatted'>('correction');
  const [rollOpen, setRollOpen] = useState(false);
  const scoreModeRef = useRef<'correction' | 'formatted'>('correction');
  scoreModeRef.current = scoreMode;
  const snapshotRef = useRef<{document: NotationDocument | null; selection: unknown; dirty: boolean;
    past: number; future: number} | null>(null);
  const [baseline, setBaseline] = useState<NotationDocument | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [snapTicks, setSnapTicks] = useState(0);
  const [writtenScope, setWrittenScope] = useState<'note' | 'event'>('note');
  const [writtenStartDraft, setWrittenStartDraft] = useState('');
  const [writtenStartScope, setWrittenStartScope] = useState<'note' | 'event'>('note');
  const [notice, setNotice] = useState('');
  const [window, setWindow] = useState<TimeWindow>({start: 0, span: DEFAULT_SPAN_SECONDS});
  const readOnlyRef = useRef(false);
  const [follow, setFollow] = useState(true);
  const [followSuspended, setFollowSuspended] = useState(false);
  const [gestureLock, setGestureLock] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [sharedScrollLeft, setSharedScrollLeft] = useState(0);
  const [sharedWidth, setSharedWidth] = useState(0);
  const lastSeekToken = useRef(0);
  const sharedBarRef = useRef<HTMLDivElement>(null);
  const commandedScroll = useRef(0);
  const [scoreTarget, setScoreTarget] = useState<{ tick: number; token: number } | null>(null);
  const [anchorTick, setAnchorTick] = useState('');
  const [anchorPreview, setAnchorPreview] = useState('');
  const linkToken = useRef(0);

  const [pedalSpans, setPedalSpans] = useState<MusicPedalSpan[]>([]);
  const [rawModelDraft, setRawModelDraft] = useState(false);
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
  const practiceCommandSeek = useRef(false);
  const autoPausedChunk = useRef<number | null>(null);
  const [keyboardRef, keyboardWidth] = useElementWidth<HTMLDivElement>();
  const compactKeyboard = keyboardWidth > 0 && keyboardWidth < 720;
  const tinyKeyboard = keyboardWidth > 0 && keyboardWidth < 520;
  const [accountId, setAccountId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [sourceSha256, setSourceSha256] = useState('');
  const [savedSections, setSavedSections] = useState<{id: string; label: string; start: number; end: number}[] | null>(null);
  const [sectionsDraft, setSectionsDraft] = useState<{id: string; label: string; start: number; end: number}[]>([]);
  const [assessmentPolicy, setAssessmentPolicy] = useState<'none' | 'notes'>('notes');
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);
  const [savedAssessment, setSavedAssessment] = useState<unknown>(null);
  const [serverSignature, setServerSignature] = useState<string | null>(null);
  const pendingSavedSignature = useRef(false);
  const workspaceSignatureRef = useRef('');
  const referenceLoadedRef = useRef(false);
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
  const modeWasActive = useRef(false);
  const [editorSession] = useState(() => createEditorSession());
  const subscribeSession = useCallback(
    (listener: () => void) => editorSession.subscribe(listener), [editorSession]);
  const sessionSnapshot = useSyncExternalStore(subscribeSession, editorSession.getSnapshot);
  const reviewSave = useMusicReviewSave({lessonId: lessonId ?? null, editorSession});
  const {saving, saveMessage, saveError, saveConflict, conflictKind, setSaveError,
    setSaveConflict} = reviewSave;
  const [reopenMessage, setReopenMessage] = useState('');
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

  const openReview = useCallback(() => {
    setReviewOpen(true); setDrawerOpen(false); setAddMenuOpen(false);
    setPitchPickMode(null); setReplaceMode(null); setAddMode(null); setDuplicateId(null);
    modeWasActive.current = false; modeReturnFocus.current = null;
  }, []);

  const closeDrawer = useCallback(() => {
    setPitchPickMode(null);
    setDrawerOpen(false);
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

  const dispatch = documentOwner.dispatch;

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
  const liveMidiBytes = useMemo(
    () => document ? exportPerformanceToMidi(document.performance, pedalSpans, {
      subject: document.subject, program: document.subject === 'guitar' ? guitarTone : 0,
    }) : null,
    [document, pedalSpans, guitarTone]);
  readOnlyRef.current = readOnly;

  /** Alignment authoring owns passages, anchors, offset and anchor history. */
  const alignmentEditor = useMusicAlignmentEditor({document, readOnly});
  const alignment = alignmentEditor.alignment;
  const anchors = alignmentEditor.anchors;
  const spans = alignmentEditor.spans;
  const offsetSeconds = alignmentEditor.offsetSeconds;

  /**
   * Playback/audio owns the media attachment, commands, preview verification and the
   * single visual clock. Source media remains authoritative.
   */
  const playback = useMusicEditorPlayback({
    document, offsetSeconds, pedalSpans, rawModelDraft, guitarProgram: guitarTone,
  });
  const {
    clock: clockRef, videoUrl, setVideoUrl, videoNode, hasMediaElement,
    preview, previewAsset, restorePreview,
    previewStale, verifyingPreview, verifiedPreview, useWavPreview,
    pianoDisabled, pianoTitle, hasWebAudio,
    preferRenderedWav, setPreferRenderedWav,
    audioMode, setAudioMode,
    playhead, setPlayhead, playing, setPlaying, rate, volume, setVolume, seekToken,
    seek, audition, play, pause, toggleTransport, changeRate,
    error: playbackError,
  } = playback;

  /**
   * Verification owns findings, the server token, prepared decisions and accepted
   * baselines. Local document commands still flow through the document owner.
   */
  const verificationController = useMusicVerificationController({
    lessonId: lessonId ?? null, draftId: draftId || null, document, alignment,
    dispatch, documentEpoch, rawModelDraft, enabled: !isPractice, readOnly,
  });
  const {
    verification, busy: verificationBusy, token: verificationToken,
    acceptedBaselines, notice: verificationNotice, conflict: verificationConflict,
    decide: decideFinding,
  } = verificationController;

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
  const authoredSpellings = useRef<Record<string, Record<string, string>>>({});

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
      documentOwner.replace(document);
      setTitle(demo === 'explanation' ? 'Fixture: explanation passage'
        : demo === 'frames' ? 'Fixture: 12 ms attacks'
        : demo === 'double' ? 'Fixture: two attacks on one written note'
        : 'Fixture: arpeggiated chord');
      alignmentEditor.hydrate({spans: demoSpans, offsetSeconds: 0, alignment: null, anchors: []});
      setPedalSpans([]);
      setRawModelDraft(false);
      setVideoUrl(null);
      setLoading(false);
      return () => { stopped = true; };
    }
  }, [lessonId]);

  const select = useCallback((occurrenceId: string | null) => {
    setNotice('');
    dispatch({type: 'select', occurrenceId});
    if (!occurrenceId) {
      selectionReference.current = null;
      setDrawerOpen(false);
      setPitchPickMode(null);
      return;
    }
    pause();
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
  }, [dispatch, offsetSeconds, requestReveal, seek, pause, state?.document, drawerOpen, drawerTarget,
    state?.selection?.occurrenceId]);

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
    if (command === 'play') { play(); return; }
    if (command === 'pause') { pause(); return; }
    if (!chunks.length) return;
    let index = activeChunkIndex;
    if (command === 'next') index = Math.min(chunks.length - 1, index + 1);
    else if (command === 'back') index = Math.max(0, index - 1);
    if (command !== 'again') setActiveChunkIndex(index);
    practiceCommandSeek.current = true;
    globalThis.setTimeout(() => { practiceCommandSeek.current = false; }, 150);
    seek(chunks[index].start);
    play();
  }, [isPractice, chunks, activeChunkIndex, seek, play, pause]);

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
    play();
  }, [isPractice, chunks, seek, play]);

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
    return clockRef.subscribe(() => {
      if (paused || clockRef.get() < chunk.end - 0.02) return;
      if (practiceCommandSeek.current) return;
      paused = true;
      autoPausedChunk.current = activeChunkIndex;
      pause();
      seek(chunk.end);
    });
  }, [isPractice, playing, chunks, activeChunkIndex, rate, offsetSeconds, seek, pause]);

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

  // Dirty identity is the current history path plus all persisted sidecars.
  const workspaceSignature = buildReviewSignature({documentEpoch, state, sidecars:{
    title, sections:sectionsDraft, alignment, anchors, offsetSeconds, spans,
    pedal:pedalSpans, assessmentPolicy, feedbackEnabled, guitarChords,
  }});
  workspaceSignatureRef.current = workspaceSignature;
  useEffect(() => {
    const valid = sanitizeGuitarChords(guitarChords);
    if (valid !== null) lastValidChordsRef.current = valid;
  }, [guitarChords]);
  const chordsDirty = JSON.stringify(guitarChords) !== savedChordsRef.current;
  const dirty = isReviewDirty({signature:workspaceSignature, savedSignature, serverSignature,
    stateDirty:Boolean(state?.dirty), chordsDirty});
  const setDraftSession = useCallback(() => {
    editorSession.reset();
    editorSession.processingCompleted(null);
  }, [editorSession]);
  // Do not translate the one-render baseline gap during hydration (or a pending
  // reopened signature) into a false "dirty" session transition.
  const sessionHydrated = !pendingSavedSignature.current && (savedRevisionId !== null
    ? savedSignature !== null
    : serverSignature !== null);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  // The shared session mirrors the workspace's real lifecycle: an ordinary edit marks
  // it dirty, and undoing to the clean baseline restores the exact current identity —
  // a saved revision id when one exists, otherwise the unreviewed draft state.
  useEffect(() => {
    if (!sessionHydrated) return;
    const session = editorSession.getSnapshot();
    if (dirty) {
      if (!session.dirty) editorSession.markDirty();
    } else if (savedRevisionId) {
      // A clean workspace on a saved revision must always report that exact reviewed
      // revision, even after a save path that only advanced the base revision.
      if (session.dirty || !session.reviewed || session.revisionId !== savedRevisionId) {
        editorSession.reviewed(savedRevisionId);
      }
    } else if (session.dirty) {
      setDraftSession();
    }
  }, [dirty, editorSession, savedRevisionId, setDraftSession, sessionHydrated]);
  const recoveryIdentity = useMemo<RecoveryIdentity>(
    () => ({accountId, lessonId: lessonId ?? '', draftId, sourceSha256,
      baseRevisionId: savedRevisionId}),
    [accountId, lessonId, draftId, sourceSha256, savedRevisionId],
  );

  const applyRecoveryCheckpoint = useCallback(({checkpoint, document: restored, stale}: RecoveryRestore) => {
    documentOwner.replace(restored);
    alignmentEditor.hydrate({spans: checkpoint.spans,
      offsetSeconds: checkpoint.offsetSeconds, alignment: checkpoint.alignment,
      anchors: checkpoint.alignment?.anchors ?? []});
    setGuitarChords(checkpoint.guitarChords ?? []);
    lastValidChordsRef.current = sanitizeGuitarChords(checkpoint.guitarChords ?? []) ?? [];
    savedChordsRef.current = JSON.stringify(checkpoint.guitarChords ?? []);
    if (checkpoint.sections?.length) setSectionsDraft(checkpoint.sections);
    if (typeof checkpoint.feedbackEnabled === 'boolean') setFeedbackEnabled(checkpoint.feedbackEnabled);
    setAssessmentPolicy('notes');
    authoredSpellings.current = checkpoint.authoredSpellings ?? {};
    verificationController.hydrate({
      ...(!stale && checkpoint.verificationToken ? {token: checkpoint.verificationToken} : {}),
      acceptedBaselines: (checkpoint.acceptedBaselines ?? {}) as Record<string, AcceptedBaseline>,
    });
    // A recovered checkpoint keeps its server base so a retry is not a first review;
    // a stale checkpoint deliberately keeps the current base.
    if (!stale && checkpoint.baseRevisionId) setSavedRevisionId(checkpoint.baseRevisionId);
    setConfirmReviewed(false);
  }, [alignmentEditor.hydrate, verificationController.hydrate]);

  const recovery = useMusicReviewRecovery({
    identity: recoveryIdentity,
    enabled: Boolean(accountId && lessonId && sourceSha256 && document),
    dirty, workspaceSignature, document, title, alignment, anchors, offsetSeconds, spans,
    sectionsDraft, assessmentPolicy, feedbackEnabled, guitarChords,
    lastValidChords: lastValidChordsRef.current,
    verificationToken, acceptedBaselines, authoredSpellings, savedRevisionId,
    onRestore: applyRecoveryCheckpoint,
  });
  const {
    recoveryOffer, staleCheckpoint, recoveryNotice, recoveryMessage,
    restoreCheckpoint, restoreStaleCheckpoint, discardCheckpoint,
    discardStaleCheckpoint, clearCheckpoint,
  } = recovery;

  const applyRestoredReference = useCallback((restored: Extract<ReturnType<typeof restoreFromReference>, {ok: true}>['value'],
    revisionId: string, manifest: ReviewManifestDocument | null) => {
    setBaseline(restored.document);
    documentOwner.replace(restored.document);
    setSaveConflict(false);
    setSaveError('');
    alignmentEditor.hydrate({spans: restored.spans, offsetSeconds: restored.offsetSeconds,
      alignment: restored.alignment, anchors: restored.alignment?.anchors ?? []});
    setGuitarChords(restored.guitarChords);
    lastValidChordsRef.current = sanitizeGuitarChords(restored.guitarChords) ?? [];
    savedChordsRef.current = JSON.stringify(restored.guitarChords);
    setPedalSpans(manifest?.pedal ?? []);
    setRawModelDraft(false);
    referenceLoadedRef.current = true;
    setError('');
    setLoading(false);
    setSavedRevisionId(revisionId);
    // The shared session records the exact immutable revision, never the lesson id.
    editorSession.reviewed(revisionId);
    setSavedSections(manifest?.section_set?.sections ?? null);
    if (manifest?.section_set?.sections?.length) setSectionsDraft(manifest.section_set.sections);
    setAssessmentPolicy('notes');
    setFeedbackEnabled(effectiveFeedbackEnabled(manifest));
    setSavedAssessment(manifest?.assessment ?? null);
    restorePreview((manifest?.piano_preview as Asset | null) ?? null,
      manifest?.preview_identity ?? '',
      // The preview is valid only for the performance it was rendered from.
      manifest?.piano_preview ? restored.document : null);
    setVideoUrl(manifest?.source_video ? assetUrl(manifest.source_video.key) : null);
    // A saved-only lesson keeps identity without inventing a draft id.
    setDraftId(manifest?.draft_id ?? '');
    setSourceSha256(manifest?.source_video?.sha256 ?? manifest?.reference?.sha256 ?? manifest?.sha256 ?? '');
    if (restored.title) setTitle(restored.title);
    // A different revision is a different review identity; no verification decision
    // prepared against the previous one may survive.
    verificationController.hydrate({verification: null, token: '', acceptedBaselines: {}});
    pendingSavedSignature.current = true;
  }, [alignmentEditor.hydrate, editorSession, restorePreview, setVideoUrl,
    verificationController.hydrate]);

  // Loading/hydration is owned by useMusicReviewLoad; this composition applies one
  // validated initialization and never exposes a partial editable session.
  const reviewLoad = useMusicReviewLoad({lessonId, demo: Boolean(params.get('demo')),
    onLoaded: loaded => {
      if (loaded.kind === 'saved') {
        applyRestoredReference(loaded.restored, loaded.revisionId, loaded.manifest);
        setReopenMessage(`Opened saved revision ${loaded.revisionId.slice(0, 8)} from ${
          loaded.restored.source === 'notation' ? 'the authored notation' : 'performance only (legacy reference)'}.`);
        return;
      }
      const {draft, document} = loaded;
      const draftSpans = draft.spans.map(span => ({start: span.start, end: span.end, kind: span.kind}));
      setBaseline(document);
      documentOwner.replace(document);
      setTitle(draft.title);
      alignmentEditor.hydrate({spans: draftSpans, offsetSeconds: draft.playback?.sync_offset_seconds ?? 0,
        alignment: null, anchors: []});
      const draftChords = (draft.guitar_chords ?? []).map(chord => ({
        id: chord.id, name: chord.name, start: chord.start, frets: [...chord.frets], position: chord.position,
      }));
      setGuitarChords(draftChords);
      lastValidChordsRef.current = sanitizeGuitarChords(draftChords) ?? [];
      savedChordsRef.current = JSON.stringify(draftChords);
      setPedalSpans(draft.pedal ?? []);
      setRawModelDraft(Boolean(draft.raw_model || draft.provenance?.model === 'kong'));
      setDraftId(draft.draft_id);
      setSourceSha256(draft.reference?.sha256 ?? '');
      verificationController.hydrate({token: draft.verification_state_token ?? ''});
      setSectionsDraft(current => current.length ? current
        : [{id: 'whole', label: 'Whole lesson', start: 0, end: draft.duration}]);
      setAssessmentPolicy('notes');
      setFeedbackEnabled(effectiveFeedbackEnabled(draft));
      restorePreview((draft.piano_preview as Asset | null) ?? null,
        draft.preview_identity ?? '', draft.piano_preview ? document : null);
      setVideoUrl(draft.source_video ? assetUrl(draft.source_video.key) : null);
      // A never-saved proposal is review work, not a private saved revision.
      setSavedRevisionId(null);
      setDraftSession();
      // Mount the transport in the same accepted-load commit as the media URL so the
      // media binding cannot attach before its element exists.
      setLoading(false);
    }});
  useEffect(() => {
    setLoading(reviewLoad.loading);
    if (reviewLoad.error) setError(reviewLoad.error);
    if (reviewLoad.reopenMessage) setReopenMessage(reviewLoad.reopenMessage);
  }, [reviewLoad.loading, reviewLoad.error, reviewLoad.reopenMessage]);

  useEffect(() => {
    getSession().then(session => { if (session) setAccountId(session.account.id); }).catch(() => {});
  }, []);

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
    pause();
  }, [scoreMode, pause]);

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

  const revealSource = useCallback((seconds: number, force = false) => {
    const W = sharedBarRef.current?.clientWidth || sharedWidth;
    if (!timelineLayout || !alignment || W <= 0) return;
    const p = 116 + timelineLayout.sourceSecondsToX(seconds, alignment, 0);
    if (force || p < sharedScrollLeft || p > sharedScrollLeft + W) {
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
    const resumeFromInspection = followSuspended;
    setFollowSuspended(false);
    // An active note-edit transaction owns the horizontal geometry.
    if (gestureLock || !follow) return;
    // A real play after manual inspection centres the resumed follow view, even when
    // the mapped playhead is still just inside the old viewport.
    revealSource(videoNode && Number.isFinite(videoNode.currentTime) ? videoNode.currentTime : playhead,
      resumeFromInspection);
  }, [follow, followSuspended, gestureLock, revealSource, playhead, videoNode]);

  // The media element remains authoritative; this observes the coarse playback state
  // so a native play (and workspace transport) clears inspection suspension exactly
  // once, even when the native event fired before the play listener was attached.
  const playbackWasPlaying = useRef(false);
  useEffect(() => {
    if (playing && !playbackWasPlaying.current) handlePlaybackStart();
    playbackWasPlaying.current = playing;
  }, [playing, handlePlaybackStart]);

  useEffect(() => {
    if (seekToken === lastSeekToken.current) return;
    lastSeekToken.current = seekToken;
    revealSource(playhead);
  }, [seekToken, playhead, revealSource]);

  // A layout effect keeps the canonical gutter measurement in the same paint as the
  // first document commit; a passive effect would shift already-rendered note x
  // positions by the gutter difference on the next pass.
  useLayoutEffect(() => {
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
      if (!shell?.isConnected || !hasMediaElement) return;
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
  }, [addMenuOpen, overlap, reviewOpen, toggleTransport, hasMediaElement]);

  // One frame-driven follow writer: stationary cursor until the safe-area threshold,
  // then content advances beneath it. The DOM scrolls every frame; React state is
  // refreshed at only 4 Hz so virtualization stays current without a render storm.
  useEffect(() => {
    if (!follow || followSuspended || gestureLock || !playing || !document || !alignment || !timelineLayout) return;
    let lastReactSync = 0;
    const unsubscribe = clockRef.subscribe(() => {
      const W = sharedBarRef.current?.clientWidth || sharedWidth;
      if (W <= 0) return;
      const p = 116 + timelineLayout.sourceSecondsToX(clockRef.get(), alignment, 0);
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

  const zoom = useCallback((factor: number) => {
    if (!timelineLayout || !alignment || gestureLock || !document) return;
    const p = 116 + timelineLayout.sourceSecondsToX(clockRef.get(), alignment, 0);
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
    if (!document || !lessonId || !confirmReviewed || saving || !state) return;
    const base = baseOverride ?? savedRevisionId;
    const captured = captureReviewSaveSnapshot({
      sidecars:{title, sections:sectionsDraft, alignment, anchors, offsetSeconds, spans,
        pedal:pedalSpans, assessmentPolicy, feedbackEnabled, guitarChords},
      document:withHandAssignments(document, hands.assignments), documentEpoch, state,
      baseRevisionId:base, draftId, referenceSha256:sourceSha256,
      verificationStateToken:verificationToken || null, savedSections,
      assessment:assessmentPolicyForSubject(document.subject),
    });
    if (!captured.ok) { setSaveError(captured.message); return; }
    const {snapshot:saveSnapshot} = captured;
    const snapshot = saveSnapshot.signature;
    const validatedChords = saveSnapshot.validatedChords;
    const manifest = await reviewSave.save({baseRevisionId: base, body: saveSnapshot.body,
      isCurrent: () => snapshot === workspaceSignatureRef.current});
    if (!manifest) return;
    setSavedRevisionId(manifest.revision_id);
    setSavedSignature(snapshot);
    lastValidChordsRef.current = validatedChords;
    savedChordsRef.current = JSON.stringify(validatedChords);
    const stillCurrent = snapshot === workspaceSignatureRef.current;
    onSaved?.(manifest.revision_id, stillCurrent);
    if (stillCurrent) {
      // The acknowledged snapshot is still the current work.
      clearCheckpoint();
    }
  }, [document, lessonId, confirmReviewed, saving, title, spans, alignment, anchors, offsetSeconds,
      savedRevisionId, workspaceSignature, draftId, sourceSha256, verificationToken, savedSections, savedAssessment,
      feedbackEnabled, onSaved, reviewSave, clearCheckpoint,
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
    // A reopen may not overwrite work the user changed while the reference was loading.
    const before = workspaceSignatureRef.current;
    setReopenMessage('');
    const outcome = await reviewLoad.reopenSaved({
      shouldApply: () => workspaceSignatureRef.current === before,
    });
    if (outcome.status === 'applied') {
      setConfirmReviewed(false);
      setReopenMessage(`Reopened revision ${outcome.value.revisionId.slice(0, 8)} from ${
        outcome.value.restored.source === 'notation'
          ? 'the authored notation' : 'performance only (legacy reference)'}.`);
    } else if (outcome.status === 'stale') {
      setReopenMessage('Reopen ignored: the document changed while the saved revision was loading. '
        + 'Your local work was kept.');
    } else if (outcome.status === 'error') {
      setReopenMessage(outcome.message);
    }
  }, [lessonId, reviewLoad.reopenSaved]);

  /* --------------------------------------------------- alignment authoring */

  const storedPlayhead = Math.max(0, playhead - offsetSeconds);
  const visibleSpanSeconds = timelineLayout && alignment && sharedWidth > 0
    ? Math.max(0.01,
      timelineLayout.xToSourceSeconds(Math.max(0, sharedScrollLeft - 116 + sharedWidth), alignment, 0)
      - timelineLayout.xToSourceSeconds(Math.max(0, sharedScrollLeft - 116), alignment, 0))
    : null;

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
    if (!alignment) return;
    const tick = Number(anchorTick);
    if (!Number.isInteger(tick) || tick < 0) { setAnchorPreview('Enter a whole tick number.'); return; }
    // The anchor is applied to the map in use, so a reopened stored map stays editable.
    const applied = alignmentEditor.applyAnchor(storedPlayhead, tick);
    setAnchorPreview(applied ? '' : alignmentEditor.notice);
  }, [alignment, anchorTick, storedPlayhead, alignmentEditor.applyAnchor, alignmentEditor.notice]);

  const undoAnchorPoint = useCallback(() => {
    if (alignmentEditor.undo()) setAnchorPreview('');
  }, [alignmentEditor.undo]);
  const redoAnchorPoint = useCallback(() => {
    if (alignmentEditor.redo()) setAnchorPreview('');
  }, [alignmentEditor.redo]);
  const resetAnchorPoints = useCallback(() => {
    if (alignmentEditor.reset()) setAnchorPreview('');
  }, [alignmentEditor.reset]);
  const removeAnchorPoint = useCallback((index: number) => {
    if (alignmentEditor.removeAnchor(index)) setAnchorPreview('');
  }, [alignmentEditor.removeAnchor]);

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
  const addModePanel = addMode ? <MusicAddNotePanel
    addMode={addMode}
    stageView={stageView}
    duration={document?.duration ?? 0}
    addProblem={addProblem}
    ghostDuplicate={ghostDuplicate}
    ghostDuplicateId={ghostDuplicateId}
    onDurationChange={durationSeconds => setAddMode(mode => mode ? {...mode,
      durationSeconds: Math.max(0.02, durationSeconds)} : mode)}
    onTicksChange={ticks => setAddMode(mode => mode ? {...mode, ticks} : mode)}
    onCommit={commitAdd}
    onCancel={() => { setAddMode(null); setDuplicateId(null); setNotice('Add note cancelled.'); }}
    onSelectExisting={occurrenceId => { select(occurrenceId); setAddMode(null); }}
  /> : null;

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
    data-session-dirty={sessionSnapshot.dirty ? 'true' : 'false'}
    data-session-state={sessionSnapshot.state}
    data-session-revision={sessionSnapshot.revisionId ?? ''}
    data-session-reviewed={sessionSnapshot.reviewed ? 'true' : 'false'}
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
      <video ref={playback.attachVideo} src={videoUrl ?? undefined} controls playsInline preload="metadata" className="ws-video"
        onPlay={handlePlaybackStart}/>
      {previewAsset ? <audio ref={playback.attachPiano} src={preview.url || undefined} preload="auto"/> : null}
    </div>
    <MusicReviewHeader
      isPractice={isPractice}
      title={title}
      lessonTitle={lessonTitle}
      onBack={onBack}
      dirty={dirty}
      status={headerStatus}
      statusDetail={headerStatusDetail}
      formatted={scoreMode === 'formatted'}
      onReturnToCorrection={() => setScoreMode('correction')}
      canUndo={state.past.length > 0}
      canRedo={state.future.length > 0}
      readOnly={readOnly}
      historyLocked={Boolean(replaceMode) || Boolean(addMode)}
      onUndo={() => dispatch({type: 'undo'})}
      onRedo={() => dispatch({type: 'redo'})}
      drawerOpen={drawerOpen}
      drawerTarget={drawerTarget}
      onOpenSettings={() => openDrawer('settings')}
      onOpenMore={() => openDrawer('more')}
      reviewTrigger={reviewTrigger}
      onOpenReview={openReview}
      saving={saving}
      saveDisabled={!(dirty || savedRevisionId === null)}
    />

    {!isPractice && (readOnly || saveMessage || saveError || saveConflict || reopenMessage
      || recoveryMessage || report || notice
      || playbackError || verificationNotice || verificationConflict
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
        {recoveryMessage && <span className="ws-report" data-reopen-state="message"
          data-recovery-state="message">{recoveryMessage}</span>}
        {report && <span className={report.status === 'rejected' ? 'ws-report is-bad' : 'ws-report'}>
          {report.status === 'rejected' ? report.message : report.label}
        </span>}
        {notice && <span className="ws-report">{notice}</span>}
        {playbackError && <span className="ws-report is-bad" data-playback-error="true">{playbackError}</span>}
        <MusicVerificationBanner conflict={verificationConflict} notice={verificationNotice}
          needsAttention={Boolean(verification?.stale || verification?.report_error
            || verification?.conflicts.length)}
          onReviewIssues={() => openDrawer('settings', 'lesson')}/>
      </div>}

    {scoreMode === 'formatted' ? <FormattedScore document={document} title={title}
      selectedOccurrenceId={selection?.occurrenceId ?? null}/> : null}
    <div className="ws-correction" hidden={scoreMode === 'formatted'}>
    {!isPractice && recoveryOffer && <section className="ws-panel" role="status" aria-label="Local recovery" data-recovery="offer">
      <p>A local checkpoint from {new Date(recoveryOffer.savedAt).toLocaleString()} is available.
        It is <strong>not saved to the server</strong>.</p>
      <div className="ws-row">
        <button type="button" onClick={restoreCheckpoint}>Restore local checkpoint</button>
        <button type="button" onClick={discardCheckpoint}>Discard</button>
      </div>
    </section>}
    {!isPractice && recoveryNotice && <p className="ws-hint" role="status" data-recovery="rejected">{recoveryNotice}</p>}
    {!isPractice && staleCheckpoint && <section className="ws-panel" role="status" aria-label="Stale local recovery" data-recovery="stale">
      <p>This checkpoint was written against an older saved revision. Restoring keeps your work but
        saves as a new revision on the current base.</p>
      <div className="ws-row">
        <button type="button" onClick={restoreStaleCheckpoint}>Restore older checkpoint</button>
        <button type="button" onClick={discardStaleCheckpoint}>Discard</button>
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
          <PianoWaterfall document={document} clock={clockRef} intervals={intervals}
            range={keyboardRange}
            selectedOccurrenceId={selection?.occurrenceId ?? null}
            hands={hands.assignments}
            onSelect={select}/>
        </div>
        <section className="ws-keyboard-surface" id="piano-keyboard" aria-label="Keyboard" hidden={guitar}>
          <div className="ws-surface-head"><span>Piano keys</span><span className="ws-surface-note">Tap to audition</span></div>
          <div ref={keyboardRef}>
            <LiveKeyboard document={document} clock={clockRef} intervals={intervals}
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
            sharedScrollLeft={sharedScrollLeft} sharedViewportWidth={sharedWidth} gutter={70}
            cursorFallbackSeconds={timelineLayout && alignment ? playhead : null}
            onGestureStart={() => { setGestureLock(true); setFollowSuspended(true); }}
            onGestureEnd={() => setGestureLock(false)}
            onWindowChangeOrigin={changeWindow}
            offsetSeconds={offsetSeconds} activeOccurrenceIds={activeIds}
            clock={clockRef} intervals={intervals}
            selectedOccurrenceId={selection?.occurrenceId ?? null}
            reveal={null}
            onGestureCommit={applyGesture} onAuditionPitch={auditionPitch}
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
            clock={clockRef} alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals}
            layout={timelineLayout ?? undefined} sharedScrollLeft={sharedScrollLeft}
            cursorFallbackSeconds={timelineLayout && alignment ? playhead : null}
            onSeekTick={seekToTick}
            onGestureCommit={applyGesture} onAuditionPitch={auditionPitch}
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
            <LiveTimeLabel clock={clockRef} fallback={playhead}/>
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
          <LiveFollowDirection clock={clockRef} fallback={playhead}
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
            onClick={() => openDrawer('video')}><Video size={19}/></button>
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
        <MusicReviewSettings
          isPractice={isPractice}
          noteInspector={<MusicNoteInspector
            selection={selection}
            selected={selected}
            document={document}
            readOnly={readOnly}
            isPractice={isPractice}
            guitar={guitar}
            narrowViewport={narrowViewport}
            noteEditorExpanded={noteEditorExpanded}
            noteAdvancedOpen={noteAdvancedOpen}
            onExpandEditor={() => { setNoteEditorExpanded(true); setNoteAdvancedOpen(false); }}
            onToggleAdvanced={() => setNoteAdvancedOpen(value => !value)}
            onAudition={(pitch, seconds, velocity) => audition([pitch], seconds, velocity)}
            onCommand={command => dispatch({type: 'command', command})}
            canUndo={state.past.length > 0}
            canRedo={state.future.length > 0}
            onUndo={() => dispatch({type: 'undo'})}
            onRedo={() => dispatch({type: 'redo'})}
            replaceMode={Boolean(replaceMode)}
            addMode={Boolean(addMode)}
            pitchPickOccurrenceId={pitchPickMode?.occurrenceId ?? null}
            onStartPitchPick={() => {
              if (!selection || !selected) return;
              modeReturnFocus.current = globalThis.document.activeElement as HTMLElement | null;
              setReplaceMode(null); setAddMode(null);
              setPitchPickMode({occurrenceId: selection.occurrenceId, pitch: selected.pitch});
              setNotice(`Choose a key for ${selected.spelling}, or press Escape to cancel.`);
            }}
            onStartReplace={() => {
              if (!selection || !selected) return;
              modeReturnFocus.current = globalThis.document.activeElement as HTMLElement | null;
              setAddMode(null); setPitchPickMode(null);
              setReplaceMode({occurrenceId: selection.occurrenceId, pitch: selected.pitch});
              setNotice('');
            }}
            hands={hands.assignments}
            onSetHand={hand => {
              if (!selection) return;
              dispatch({type: 'command', command: {
                type: 'set-occurrence-hand', occurrenceId: selection.occurrenceId, hand}});
            }}
            onResetHand={() => {
              if (!selection) return;
              dispatch({type: 'command', command: {
                type: 'reset-occurrence-hand', occurrenceId: selection.occurrenceId}});
            }}
            positionOf={positionOf}
            fretDraft={fretDraft}
            onFretDraftChange={setFretDraft}
            onApplyFret={(string, fret) => {
              if (!selection) return;
              dispatch({type: 'command', command: {type: 'set-guitar-position',
                occurrenceId: selection.occurrenceId, string, fret}});
              setFretDraft('');
            }}
            onShiftGuitarString={string => {
              if (!selection) return;
              dispatch({type: 'command', command: {type: 'shift-guitar-string',
                occurrenceId: selection.occurrenceId, string}});
            }}
            fretPickMode={fretPickMode}
            onToggleFretPick={() => {
              if (!selection) return;
              setFretPickMode(fretPickMode === selection.occurrenceId ? null : selection.occurrenceId);
              setNotice(fretPickMode === selection.occurrenceId ? 'Fretboard pick cancelled.'
                : 'Click a string and fret on the guitar neck.');
            }}
            writtenScope={writtenScope}
            onWrittenScopeChange={setWrittenScope}
            respellDraft={respellDraft}
            onRespellDraftChange={setRespellDraft}
            onApplyRespell={() => {
              if (!selection || !respellDraft.trim()) return;
              dispatch({type: 'command', command: {type: 'respell',
                occurrenceId: selection.occurrenceId, spelling: respellDraft.trim()}});
              setRespellDraft('');
            }}
            writtenStartScope={writtenStartScope}
            onWrittenStartScopeChange={setWrittenStartScope}
            writtenStartDraft={writtenStartDraft}
            onWrittenStartDraftChange={setWrittenStartDraft}
            onApplyWrittenStart={() => {
              if (!selection) return;
              const ticks = Number(writtenStartDraft);
              if (!Number.isInteger(ticks) || ticks < 0) { setNotice('Enter a whole, non-negative tick value.'); return; }
              if (writtenStartScope === 'note' && selected && selected.notesInEvent > 1) {
                setNotice('Moving one chord member needs its own voice; choose “Whole written event” or split the note first.');
                return;
              }
              const command = {type: 'move-written-start' as const, eventId: selection.eventId, ticks};
              const outcome = applyCommand(state.document, command);
              if (outcome.status === 'rejected') { setNotice(outcome.message); return; }
              dispatch({type: 'command', command});
              setNotice(outcome.status === 'unchanged' ? 'The written position is unchanged.' : 'Written position moved; recorded onset unchanged.');
              setWrittenStartDraft('');
            }}
            snapSeconds={snapSeconds}
            tiedSegmentCount={tiedSegmentCount}
            onReveal={() => { if (selection) requestReveal(selection.occurrenceId); }}
            onNotice={setNotice}
          />}
          follow={follow}
          onFollowChange={value => {
            setFollow(value);
            if (value) { setFollowSuspended(false); revealSource(playhead); }
          }}
          chunkBars={chunkBars}
          onChunkBarsChange={value => { setChunkBars(value); setActiveChunkIndex(0); }}
          chunkPickerOpen={chunkPickerOpen}
          chunks={chunks}
          activeChunkIndex={activeChunkIndex}
          onSelectChunk={index => {
            const chunk = chunks[index];
            if (!chunk) return;
            setActiveChunkIndex(index);
            seek(chunk.start);
          }}
          onSeek={seek}
          handStatus={hands.status}
          handModelInfo={hands.modelInfo}
          onRefreshHands={hands.refresh}
          readOnly={readOnly}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          historyLocked={Boolean(replaceMode) || Boolean(addMode)}
          onUndo={() => dispatch({type: 'undo'})}
          onRedo={() => dispatch({type: 'redo'})}
          onShowMore={() => setDrawerTarget('more')}
          narrowViewport={narrowViewport}
          rate={rate}
          onRateChange={changeRate}
          onZoom={zoom}
          zoomFactor={zoomFactor}
          windowSpan={window.span}
          visibleSpan={visibleSpanSeconds}
          embedded={embedded}
          playhead={playhead}
          duration={document.duration}
          onSourceClockChange={value => {
            if (videoUrl && hasMediaElement) { seek(value); return; }
            setPlayhead(value); setPlaying(false);
          }}
          alignmentMode={alignment?.mode ?? null}
          playheadTick={playheadTick}
          ticksPerSecond={alignment ? Math.round((1 / secondsPerTick) * 1000) / 1000 : null}
          explanationCount={spans.filter(span => span.kind === 'explanation').length}
          spansCount={spans.length}
          heldPassage={Boolean(alignment && heldPassageAt(alignment, playhead))}
          outsideScore={Boolean(alignment && timelineLayout && (playhead < tickToEffectiveSeconds(alignment, 0, 0)
            || playhead > tickToEffectiveSeconds(alignment, timelineLayout.totalTicks, 0)))}
          snapTicks={snapTicks}
          onSnapTicksChange={setSnapTicks}
          offsetSeconds={offsetSeconds}
          onOffsetSecondsChange={value => { if (!readOnlyRef.current) alignmentEditor.setOffsetSeconds(value); }}
          diff={diff}
          guitar={guitar}
          guitarTone={guitarTone}
          onGuitarToneChange={setGuitarTone}
          guitarHandedness={guitarHandedness}
          onGuitarHandednessChange={setGuitarHandedness}
          rollMode={rollMode}
          onRollModeChange={mode => { setRollMode(mode); setRollOpen(true); }}
          staffMode={staffMode}
          onStaffModeChange={setStaffMode}
          audioMode={audioMode}
          onAudioModeChange={setAudioMode}
          pianoDisabled={pianoDisabled}
          pianoTitle={pianoTitle}
          verifiedPreview={verifiedPreview}
          hasWebAudio={hasWebAudio}
          preferRenderedWav={preferRenderedWav}
          onPreferRenderedWavChange={setPreferRenderedWav}
          liveMidiBytes={liveMidiBytes}
          onExportMidi={() => {
            if (!liveMidiBytes) return;
            downloadMidiFile(`${title.trim() || 'performance'}.mid`, liveMidiBytes);
          }}
          videoUrl={videoUrl}
          pipOpen={pipOpen}
          onTogglePip={() => setPipOpen(open => !open)}
          verifyingPreview={verifyingPreview}
          previewAssetUnavailable={Boolean(previewAsset && !preview.url)}
          previewError={preview.error ?? null}
          useWavPreview={useWavPreview}
          previewStale={previewStale}
          guitarChords={guitarChords}
          onDetectChords={() => {
            const detected = detectGuitarChords(document.performance.map(note => ({
              id: note.id, onset: note.onset, pitch: note.pitch,
              string: positionOf(note)?.string ?? null,
              fret: positionOf(note)?.fret ?? null,
            }))).slice(0, 100);
            setGuitarChords(detected);
            setNotice(detected.length
              ? `Detected ${detected.length} chord shape${detected.length === 1 ? '' : 's'} from the notes; review them before saving.`
              : 'No strummed chord clusters were detected in this performance.');
          }}
          onAddChord={() => {
            if (readOnly || guitarChords.length >= 100) return;
            const id = `chord-${Date.now().toString(36)}`;
            setGuitarChords(chords => [...chords, {
              id, name: 'C', start: Math.max(0, playhead), frets: [0, 0, 0, 0, 0, 0], position: 1,
            }].sort((left, right) => left.start - right.start));
          }}
          onChordNameChange={(id, name) => setGuitarChords(chords => chords.map(item =>
            item.id === id ? {...item, name} : item))}
          onChordStartChange={(id, start) => setGuitarChords(chords => chords.map(item =>
            item.id === id ? {...item, start} : item))}
          onChordFretsChange={(id, frets, position) => setGuitarChords(chords => chords.map(item =>
            item.id === id ? {...item, frets, position} : item))}
          onRemoveChord={id => setGuitarChords(chords => chords.filter(item => item.id !== id))}
          onNotice={setNotice}
          replaceMode={Boolean(replaceMode)}
          addMode={Boolean(addMode)}
          onInsertAtPlayhead={insertAtPlayhead}
          onToggleAddMode={() => {
            setDuplicateId(null);
            setReplaceMode(null);
            setAddMode(addMode ? null : {seconds: playhead - offsetSeconds, pitch: selected?.pitch ?? 60,
              ticks: lastWrittenTicks.current, durationSeconds: lastRecordedSeconds.current});
          }}
          anchors={anchors}
          anchorTick={anchorTick}
          onAnchorTickChange={setAnchorTick}
          onUseCurrentTick={useCurrentTick}
          onPreviewAnchor={previewAnchor}
          onApplyAnchor={applyAnchorPoint}
          canUndoAnchor={alignmentEditor.canUndo}
          canRedoAnchor={alignmentEditor.canRedo}
          onUndoAnchor={undoAnchorPoint}
          onRedoAnchor={redoAnchorPoint}
          onResetAnchors={resetAnchorPoints}
          onRemoveAnchor={removeAnchorPoint}
          anchorPreview={anchorPreview}
          alignmentNotice={alignmentEditor.notice}
          formatted={scoreMode === 'formatted'}
          onFormattedPreview={() => {
            setAddMode(null); setReplaceMode(null); setDuplicateId(null);
            setScoreMode('formatted');
            setDrawerOpen(false);
          }}
          onReopen={reopen}
          onDownloadMusicXml={downloadMusicXml}
          onDownloadReference={downloadReference}
          history={summary}
          sectionsDraft={sectionsDraft}
          onAddSection={() => {
            if (readOnlyRef.current) return;
            setSectionsDraft(current => {
              const last = current[current.length - 1] ?? {id: 'whole', label: 'Whole lesson', start: 0, end: document.duration};
              const sequence = current.length ? current : [last];
              const middle = (last.start + last.end) / 2;
              return [...sequence.slice(0, -1), {...last, end: middle},
                {id: `section-${sequence.length + 1}`, label: `Section ${sequence.length + 1}`, start: middle, end: last.end}];
            });
            setConfirmReviewed(false);
          }}
          onSectionLabelChange={(index, label) => {
            setSectionsDraft(current => current.map((item, position) => position === index ? {...item, label} : item));
            setConfirmReviewed(false);
          }}
          onSectionStartChange={(index, raw) => {
            setSectionsDraft(current => {
              const section = current[index];
              if (!section) return current;
              const floor = index === 0 ? 0 : (current[index - 1]?.start ?? 0) + 0.05;
              const start = index === 0 ? 0 : Math.max(floor, Math.min(section.end - 0.05, raw));
              return current.map((item, position) => {
                if (position === index) return {...item, start};
                if (position === index - 1) return {...item, end: start};
                return item;
              });
            });
            setConfirmReviewed(false);
          }}
          onSectionEndChange={(index, raw) => {
            setSectionsDraft(current => {
              const section = current[index];
              if (!section) return current;
              const ceiling = index === current.length - 1 ? document.duration
                : (current[index + 1]?.end ?? document.duration) - 0.05;
              const end = Math.max(section.start + 0.05, Math.min(ceiling, raw));
              return current.map((item, position) => {
                if (position === index) return {...item, end};
                if (position === index + 1) return {...item, start: end};
                return item;
              });
            });
            setConfirmReviewed(false);
          }}
          onRemoveSection={index => {
            setSectionsDraft(current => {
              const removed = current[index];
              if (!removed) return current;
              const next = current.filter((_, position) => position !== index);
              if (index > 0) {
                return next.map((item, position) => position === index - 1 ? {...item, end: removed.end} : item);
              }
              return next.map((item, position) => position === 0 ? {...item, start: 0} : item);
            });
            setConfirmReviewed(false);
          }}
          feedbackEnabled={feedbackEnabled}
          onFeedbackEnabledChange={value => {
            if (readOnlyRef.current) return;
            setFeedbackEnabled(value);
            setConfirmReviewed(false);
          }}
          verificationPanel={<MusicVerificationPanel verification={verification} busy={verificationBusy}
            onDecide={(finding, decision) => { void decideFinding(finding, decision); }}
            onRollback={() => { void verificationController.rollback(); }}/>}
          spans={spans}
        />






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
            {conflictKind === 'verification'
              ? 'Verification changed for this proposal. Close review, reload the saved revision and resolve the diagnostics before saving.'
              : 'This draft conflicts with a newer revision. Close review to choose “Save on latest revision” or “Reload saved revision”.'}
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

      {isPractice && <LivePracticeDock clock={clockRef} fallback={playhead}
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
        primaryAction={<LivePracticePrimary clock={clockRef} fallback={playhead}
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
