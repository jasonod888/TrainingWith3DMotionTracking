import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  activeOccurrenceIds, alignmentFromSpans, applyAnchors, occurrenceIntervals,
  type Alignment, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import type {MusicLessonManifest, MusicPedalSpan} from '../../../../../packages/lesson-schema/index';
import {assetUrl, request} from '../../api';
import {loadReferenceValue, pinReference, unpinReference, type LessonContext} from '../../app/lesson-context';
import {MUSIC_CAPABILITIES, voiceControl, type PracticeCapabilities} from '../../../../../packages/learning-engine/practice-capabilities';
import {emptyPracticeSnapshot} from '../../../../../packages/learning-engine/practice-runtime';
import {PracticeShell} from '../../practice/PracticeShell';
import {ExperienceModeSelector} from '../../practice/ExperienceModeSelector';
import {experienceModeCapabilitiesFrom, experienceModeToLegacy} from '../../../../../packages/learning-engine/experience-mode';
import {useMusicPractice} from '../../practice/useMusicPractice';
import {usePracticeVoice} from '../../practice/usePracticeVoice';
import {voiceCommandToPractice} from '../../practice/practice-input';
import {createLocalPracticeStore, createServerPracticeStore, conservativeImport, importLocalProgress, readLocalOwner} from '../../practice/practice-store';
import {resolvePracticePolicy} from '../../../../../packages/learning-engine/practice-policy';
import {resolveMusicChallengeEligibility} from '../practice-challenge-policy';
import {usePracticeAccessGuard} from '../../practice/usePracticeAccessGuard';
import {submitAttempt} from '../../practice/submit-attempt';
import {pianoPracticePlan} from '../../practice/practice-plans';
import {buildPracticeChunks, type ChunkBarsOption} from '../practice-chunks';
import {usePianoPreviewAsset} from '../usePianoPreviewAsset';
import {usePianoSourcePlayer} from '../usePianoSourcePlayer';
import {usePianoPreferences} from '../piano-preferences';
import {useHandAssignments} from './useHandAssignments';
import {
  PianoPracticeInstrumentView, PianoPracticeNotesView, type PracticePanel,
} from './PianoPracticeViews';
import {PracticeCheckboxMenu} from '../../practice/PracticeCheckboxMenu';
import {Button, IconButton, Input, Select} from '../../ui/controls';
import './piano-practice-views.css';
import {restoreFromReference, type SavedGuitarChord} from './save-payload';
import {usePianoPerformanceAudio} from './usePianoPerformanceAudio';
import {useListenPlay} from '../useListenPlay';
import {useMusicChallenge} from '../useMusicChallenge';
import {useUploadAssessment} from '../useUploadAssessment';
import {FeedbackChoice, setFeedbackChoice} from './FeedbackChoice';
import {useMidiInput} from '../useMidiInput';
import {effectiveFeedbackEnabled, feedbackEligibility} from '../music-feedback';
import {useFeedbackPreference} from '../../feedback-preference';
import {challengeAttemptPayload} from '../challenge-payload';
import {GuitarChordStrumHud} from './GuitarChordStrumHud';
import GuitarNeckGuide from '../renderers/GuitarNeckGuide';
import {ContinuousScore} from './ContinuousScore';
import {TimeRoll} from './TimeRoll';
import {buildTimelineLayout} from './timeline-layout';
import {readCompactView, writeCompactView, type CompactView} from './compact-view';
import {useClockTime} from './clock';
import {useElementWidth} from './useElementWidth';
import {layoutMeasures, type TimeWindow} from './viewport';
import {pitchName} from '../music-reference';
import {
  assignGuitarFingers, normalizeGuitarSetup, resolveGuitarPosition, type GuitarFinger,
} from '../../../../../packages/music-notation/guitar.ts';

type Manifest = MusicLessonManifest & {reader?: unknown};
const PRACTICE_PANELS_KEY = 'piano-practice-panels-v2';
const LEGACY_PRACTICE_VIEW_KEY = 'piano-practice-view-v1';
const PRACTICE_PANELS: PracticePanel[] = ['notes', 'waterfall', 'keys'];
function newChallengeId():string {
  const value=globalThis.crypto?.randomUUID?.();
  if(value)return value;
  const stamp=Date.now().toString(16).padStart(12,'0').slice(-12);
  return `00000000-0000-4000-8000-${stamp}`;
}

function readPracticePanels(): PracticePanel[] {
  try {
    const saved = globalThis.localStorage?.getItem(PRACTICE_PANELS_KEY);
    if (saved !== null && saved !== undefined) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const valid = [...new Set(parsed.filter((value): value is PracticePanel =>
          PRACTICE_PANELS.includes(value as PracticePanel)))];
        if (valid.length || parsed.length === 0) return valid;
      }
    }
    const legacy = globalThis.localStorage?.getItem(LEGACY_PRACTICE_VIEW_KEY);
    if (legacy === 'notes') return ['notes'];
    if (legacy === 'keys') return ['keys'];
    if (legacy === 'waterfall') return ['waterfall', 'keys'];
  } catch { /* fall through */ }
  return ['waterfall', 'keys'];
}

/**
 * Dedicated piano practice route.
 *
 * It does not construct the correction/undo/save editor. It loads the reviewed
 * notation and alignment, shares the rendering/transport modules with review,
 * and lets the common runtime own every practice transition.
 */
export function PianoPracticeWorkspace({lessonId: lessonIdProp, lessonTitle, embedded = false, challengeMode = false, challengeAvailable = false, challengeHistoryEnabled = false, audioAssessmentEnabled = false, context, onBack, onModeChange}: {
  lessonId?: string;
  lessonTitle?: string;
  embedded?: boolean;
  challengeMode?: boolean;
  challengeAvailable?: boolean;
  challengeHistoryEnabled?: boolean;
  audioAssessmentEnabled?: boolean;
  /** Preloaded neutral context. When present, no manifest request is made. */
  context?: LessonContext;
  onBack?: () => void;
  onModeChange?: (mode: 'watch' | 'practice' | 'compete') => void;
}) {
  const params = new URLSearchParams(location.search);
  const lessonId = lessonIdProp ?? params.get('id') ?? '';
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [document, setDocument] = useState<NotationDocument | null>(null);
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [pedalSpans, setPedalSpans] = useState<MusicPedalSpan[]>([]);
  const [title, setTitle] = useState(lessonTitle ?? 'Piano practice');
  const [guitarChords, setGuitarChords] = useState<SavedGuitarChord[]>([]);
  const [guitarTone, setGuitarTone] = useState(25);
  const [guitarHandedness, setGuitarHandedness] = useState<'right' | 'left'>('right');
  const [guitarStage, setGuitarStage] = useState<'roll' | 'compact'>('roll');
  const [compactView, setCompactView] = useState<CompactView>(readCompactView);
  const chooseCompactView = (view: CompactView) => {
    setCompactView(view);
    writeCompactView(view);
  };
  const [follow, setFollow] = useState(true);
  const [followSuspended, setFollowSuspended] = useState(false);
  const [sharedScrollLeft, setSharedScrollLeft] = useState(0);
  const [rollWindow, setRollWindow] = useState<TimeWindow>({start: 0, span: 8});
  const [sharedRef, sharedWidth] = useElementWidth<HTMLDivElement>();
  const sharedBarRef = useRef<HTMLDivElement | null>(null);
  const programmaticScroll = useRef(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [chunkBars, setChunkBars] = useState<ChunkBarsOption>(2);
  const [pipOpen, setPipOpen] = useState(true);
  const [practicePanels, setPracticePanels] = useState<PracticePanel[]>(readPracticePanels);
  const togglePracticePanel = (panel: PracticePanel) => {
    setPracticePanels(current => {
      const next = current.includes(panel) ? current.filter(value => value !== panel) : [...current, panel];
      try { globalThis.localStorage?.setItem(PRACTICE_PANELS_KEY, JSON.stringify(next)); } catch { /* preference optional */ }
      return next;
    });
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const pianoRef = useRef<HTMLAudioElement>(null);
  const emptyPianoRef = useRef<HTMLAudioElement>(null);
  const {audioMode, setAudioMode, volume, setVolume} = usePianoPreferences();
  const [preferRenderedWav, setPreferRenderedWav] = useState(false);
  const preview = usePianoPreviewAsset(manifest?.piano_preview ?? null);
  const videoUrl = manifest?.source_video ? assetUrl(manifest.source_video.key) : '';
  const audioTransport = !videoUrl && preview.url;
  const mediaRef = audioTransport ? pianoRef : videoRef;
  const mediaKey = videoUrl || preview.url || '';
  const hasWebAudio = typeof globalThis.window !== 'undefined'
    && Boolean(globalThis.window.AudioContext
      || (globalThis.window as typeof globalThis.window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext);
  const useWavPreview = Boolean(preview.url) && (!hasWebAudio || preferRenderedWav);
  const livePiano = audioMode === 'piano' && !useWavPreview && Boolean(videoUrl);
  const pianoOptionDisabled = !preview.url && !hasWebAudio;
  useEffect(() => {
    if (audioMode === 'piano' && pianoOptionDisabled) setAudioMode('original');
  }, [audioMode, pianoOptionDisabled, setAudioMode]);
  useEffect(() => {
    if (pianoRef.current) pianoRef.current.volume = volume;
    if (emptyPianoRef.current) emptyPianoRef.current.volume = volume;
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume, useWavPreview, livePiano, videoUrl, preview.url]);

  useEffect(() => {
    let cancelled = false;
    let pinned: string | null = null;
    setLoading(true);
    setError('');
    setDocument(null);
    setManifest(null);
    (async () => {
      try {
        if (!lessonId) throw new Error('This practice link is incomplete.');
        // A passed-in context is already validated and release-checked. Fetching it
        // again here both duplicated the request and could disagree with the shell.
        const value = context && context.document.kind === 'music'
          ? context.document.value as unknown as Manifest
          : await request<Manifest>(`/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false,
            {'X-Lesson-Formats': '1,2'});
        const reference = value.reference;
        if (!reference?.key) throw new Error('This lesson has no reviewed piano reference.');
        // Immutable by hash; verified before it enters the cache.
        const payload = await loadReferenceValue(reference);
        const restored = restoreFromReference(payload);
        if (!restored.ok) throw new Error(restored.message);
        if (cancelled) return;
        const saved = restored.value.alignment;
        const base: Alignment = saved?.passages?.length
          ? {alignment_version: 1, mode: saved.mode, basis: saved.basis, passages: saved.passages as Alignment['passages']}
          : alignmentFromSpans(restored.value.document, restored.value.spans);
        const anchored = applyAnchors(base, restored.value.document, saved?.anchors ?? []);
        if (anchored.problem) throw new Error(`The saved alignment could not be applied: ${anchored.problem}`);
        if (cancelled) return;
        if (reference.sha256) { pinReference(reference.sha256); pinned = reference.sha256; }
        setManifest(value);
        setDocument(restored.value.document);
        setAlignment(anchored.alignment);
        setOffsetSeconds(restored.value.offsetSeconds);
        setPedalSpans(value.pedal ?? []);
        setGuitarChords(restored.value.guitarChords);
        const guitar = restored.value.document.subject === 'guitar';
        setTitle(restored.value.title ?? value.title ?? lessonTitle ?? (guitar ? 'Guitar practice' : 'Piano practice'));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The piano practice could not open.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; if (pinned) unpinReference(pinned); };
  }, [lessonId, lessonTitle, context]);

  const chunks = useMemo(() => document && alignment
    ? buildPracticeChunks(document.measures, alignment, offsetSeconds, document.duration, chunkBars)
    : [], [document, alignment, offsetSeconds, chunkBars]);
  const plan = useMemo(() => document ? pianoPracticePlan({
    lessonId: manifest?.lesson_id ?? lessonId,
    revisionId: manifest?.revision_id ?? 'practice',
    title,
    duration: document.duration,
    chunks,
  }) : null, [document, manifest, lessonId, title, chunks]);
  // Authenticated lessons sync plan-scoped progress to the server; guests and
  // public/demo contexts stay entirely local.
  const store = useMemo(() => {
    const scope = context?.accountScope;
    return scope && scope !== 'public' && scope !== 'guest'
      ? createServerPracticeStore({accountId: scope})
      : createLocalPracticeStore();
  }, [context?.accountScope]);
  // The four-axis policy is resolved for the active reference; it is the same
  // presentation the music practice surface uses for assessment/feedback.
  const practicePolicy = useMemo(() => resolvePracticePolicy({
    mode: 'practice',
    act: {id: manifest?.subject === 'guitar' ? 'guitar' : 'piano', supportsChallenge: false,
      allowsUnassessedChallenge: false,
      assessmentAdapterId: manifest?.assessment?.assessment && manifest.assessment.assessment !== 'none'
        ? `${manifest?.subject ?? 'piano'}-notes-v1` : null,
      rubricVersion: manifest?.assessment?.assessment && manifest.assessment.assessment !== 'none'
        ? 'rubric-v1' : null,
      defaultFeedback: 'after_attempt', practiceInputs: ['midi', 'microphone']},
    creator: {assessmentAllowed: manifest?.feedback_enabled !== false,
      feedbackAllowed: manifest?.feedback_enabled !== false},
    learner: {feedback: 'on', inputs: []},
    reference: {reviewed: manifest?.reference_reviewed === true, eligible: Boolean(manifest?.reference)},
    evidence: {selected: [], available: []},
  }), [manifest]);
  useEffect(() => {
    const scope = context?.accountScope;
    if (!plan || !manifest || !scope || scope === 'public' || scope === 'guest') return;
    let stopped = false;
    const identity = {lessonId: manifest.lesson_id, revisionId: manifest.revision_id,
      planId: plan.id, duration: plan.duration};
    void (async () => {
      const local = createLocalPracticeStore(scope);
      const record = await local.load(identity);
      const decision = conservativeImport({
        accountId: scope, localAccountId: readLocalOwner(identity, scope), localRecord: record,
        targetRevisionId: manifest.revision_id, targetPlanId: plan.id,
      });
      if (stopped || !decision.allowed || !decision.record) return;
      await importLocalProgress({
        accountId: scope, localAccountId: readLocalOwner(identity, scope),
        localRecord: decision.record, targetLessonId: manifest.lesson_id,
        targetRevisionId: manifest.revision_id, targetPlanId: plan.id,
      });
    })();
    return () => { stopped = true; };
  }, [plan?.id, manifest, context?.accountScope]);
  const capabilities = useMemo<PracticeCapabilities>(() => ({    ...MUSIC_CAPABILITIES,
    speeds: [0.25, 0.5, 0.75, 1, 1.25],
    countIn: {supported: true, value: 0, options: [0, 3, 5, 10].map(seconds => ({seconds, label: seconds ? `${seconds}s` : 'Off'}))},
    rest: {supported: true, value: 1.5, options: [0, 1.5, 3, 5]},
  }), []);
  const practice = useMusicPractice({    plan: plan ?? {id: 'unavailable', lessonId, revisionId: 'unavailable', duration: document?.duration ?? 0, units: []},
    mediaRef,
    transportKey: mediaKey,
    capabilities,
    store,
  });
  const snapshot = practice.snapshot;
  const [accessLost, setAccessLost] = useState(false);
  const access = usePracticeAccessGuard({runtime: practice.runtime, context,
    onLost: () => setAccessLost(true),
    register: bag => {
      bag.add({kind:'audio',label:'music playback',release:()=>{
        mediaRef.current?.pause();
        practice.dispatch({type:'action',action:'pause'});
      }});
      bag.add({kind:'audio',label:'midi input',release:()=>midi.disconnect()});
      bag.add({kind:'microphone',label:'listen/challenge capture',release:()=>{
        listenPlayRef.current?.cancel('Access to this lesson was removed.');
        challengeRef.current?.cancel('Access to this lesson was removed.');
        uploadRef.current.cancel();
      }});
      bag.add({kind:'worker',label:'practice runtime',release:()=>practice.runtime?.destroy()});
    },
  });
  useEffect(() => {
    if (livePiano && videoRef.current) videoRef.current.muted = true;
  }, [livePiano, snapshot?.status, videoUrl]);
  const voice = usePracticeVoice(command => {
    const mapped = voiceCommandToPractice(command, {rates: [0.25, 0.5, 0.75, 1, 1.25],
      rate: snapshot?.rate ?? 1, loop: snapshot?.loop ?? false});
    if (mapped) practice.dispatch(mapped);
  });
  const liveCapabilities = useMemo<PracticeCapabilities>(() => ({...capabilities,
    voice: voiceControl(voice.status, voice.error, voice.supported)}), [capabilities, voice]);
  const dispatchPractice = (command: Parameters<typeof practice.dispatch>[0]) => {
    if (listenPlay.active) listenPlay.cancel('Practice controls changed. This listen-then-play run is not scored.');
    if (challenge.active) challenge.cancel('Challenge stopped by a practice control. This run is not scored.');
    practice.dispatch(command);
  };

  const intervals = useMemo(() => document ? occurrenceIntervals(document, offsetSeconds) : [], [document, offsetSeconds]);
  const playhead = snapshot?.time ?? 0;
  const hands = useHandAssignments(document, lessonId || null, false);
  const sourcePlayer = usePianoSourcePlayer(videoRef, livePiano ? emptyPianoRef : pianoRef,
    livePiano ? 'original' : audioMode, offsetSeconds, manifest?.preview_identity ?? '', () => setAudioMode('original'));
  const [listenPlayEnabled, setListenPlayEnabled] = useFeedbackPreference(lessonIdProp ?? manifest?.lesson_id ?? 'unscoped');
  const [listenInputMode, setListenInputMode] = useState<'midi'|'microphone'>('midi');
  const [challengeInputMode, setChallengeInputMode] = useState<'midi'|'microphone'>('midi');
  const listenPlayRef = useRef<{recordAttack:(pitch:number,timeStamp:number)=>void; cancel:(reason?:string)=>void} | null>(null);
  const challengeRef = useRef<{active:boolean; recordAttack:(pitch:number,timeStamp:number)=>void; cancel:(reason?:string)=>void} | null>(null);
  const midi = useMidiInput({
    onAttack: attack => {
      if (challengeRef.current?.active) challengeRef.current.recordAttack(attack.pitch, attack.timeStamp);
      else listenPlayRef.current?.recordAttack(attack.pitch, attack.timeStamp);
    },
    onInputChange: id => {
      if (!id) {
        challengeRef.current?.cancel('Keyboard input was disconnected. This challenge run is not scored.');
        listenPlayRef.current?.cancel('Keyboard input was disconnected. This listen-then-play run is not scored.');
      }
    },
  });
  const listenExpected = useMemo(() => (document?.performance ?? []).map(note => ({
    id: note.id, onset: note.onset, pitch: note.pitch, optional: note.optional === true,
  })), [document]);
  const listenSections = useMemo(() => manifest?.section_set?.sections ?? plan?.units ?? [], [manifest, plan]);
  const listenUnit = plan?.units[snapshot?.unitIndex ?? 0] ?? null;
  const listenAssessment = useMemo(() => manifest?.assessment ?? {
    rubric_version: 'music-watch-v1', assessment: 'none' as const,
    input_modes: [] as ('midi' | 'microphone' | 'none')[],
    dimensions: [] as ('pitch' | 'timing' | 'release' | 'coverage')[],
  }, [manifest?.assessment]);
  const lessonFeedbackEnabled = effectiveFeedbackEnabled(manifest);
  const microphoneEligible = (manifest?.subject === 'piano' || manifest?.subject === 'guitar')
    && listenAssessment.assessment === 'notes'
    && (listenAssessment.input_modes ?? []).includes('microphone')
    && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const feedbackFor = (mode:'midi'|'microphone', selected:boolean) => feedbackEligibility({
    assessment: listenAssessment, subject: manifest?.subject ?? '',
    referenceReviewed: manifest?.reference_reviewed === true,
    inputSelected: selected, inputMode: mode, latencyMeasured: false,
    creatorEnabled: lessonFeedbackEnabled,
  });
  const listenEligibility = useMemo(() => feedbackFor(listenInputMode,
    listenInputMode === 'midi' ? midi.connected : microphoneEligible),
    [listenAssessment, manifest?.subject, manifest?.reference_reviewed, lessonFeedbackEnabled, midi.connected, listenInputMode, microphoneEligible]);
  const challengeEligibility = useMemo(() => feedbackFor(challengeInputMode,
    challengeInputMode === 'midi' ? midi.connected : microphoneEligible),
    [listenAssessment, manifest?.subject, manifest?.reference_reviewed, lessonFeedbackEnabled, midi.connected, challengeInputMode, microphoneEligible]);
  const listenPlayEligible = listenEligibility.eligible;
  const challengePolicy = useMemo(() => resolveMusicChallengeEligibility({
    subject: manifest?.subject === 'guitar' ? 'guitar' : 'piano',
    assessmentEnabled: practicePolicy.assessment.enabled,
    challengeEnabled: challengeMode,
    referencePlayable: Boolean(manifest?.reference),
    referenceReviewed: manifest?.reference_reviewed === true,
    configuredEligible: challengeEligibility.eligible,
  }), [manifest, challengeMode, challengeEligibility.eligible]);
  const challengeEligible = challengePolicy.buttonEligible;
  const listenPlay = useListenPlay({
    runtime: practice.runtime, snapshot, lastAttempt: practice.lastAttempt,
    unit: listenUnit, speed: snapshot?.rate ?? 1,
    expected: listenExpected, sections: listenSections,
    inputMode: listenInputMode,
    onPauseRuntime: () => practice.dispatch({type: 'action', action: 'pause'}),
  });
  listenPlayRef.current = {recordAttack: listenPlay.recordAttack, cancel: listenPlay.cancel};
  const challenge = useMusicChallenge({
    runtime: practice.runtime, snapshot, lastAttempt: practice.lastAttempt,
    duration: document?.duration ?? 0, expected: listenExpected, sections: listenSections,
    midiConnected: midi.connected && challengeMode && document?.subject === 'piano'
      && manifest?.assessment.assessment === 'notes',
    inputMode: challengeInputMode,
    onPauseRuntime: () => practice.dispatch({type: 'action', action: 'pause'}),
  });
  challengeRef.current = {active: challenge.active, recordAttack: challenge.recordAttack, cancel: challenge.cancel};
  useEffect(() => {
    const attempt = practice.lastAttempt;
    if (!attempt?.completed || challenge.active || !manifest) return;
    void submitAttempt({
      attemptId: attempt.id, lessonId: manifest.lesson_id, revisionId: manifest.revision_id,
      actId: manifest.subject === 'guitar' ? 'guitar' : 'piano', mode: 'practice',
      planId: plan?.id ?? `music-${manifest.revision_id}`, unitId: snapshot?.unitId ?? null,
      durationMs: Math.max(0, attempt.end - attempt.start) * 1000, status: 'unassessed',
      report: {reason: attempt.reason}, accountScope: context?.accountScope ?? 'guest',
    }, {guard: access.guardRef.current});
  }, [practice.lastAttempt?.id, challenge.active, manifest, plan?.id]);
  const upload=useUploadAssessment({expected:listenExpected,target:{start:0,end:document?.duration??0},sections:listenSections});
  const uploadRef=useRef(upload);uploadRef.current=upload;
  useEffect(()=>{
    if(!accessLost)return;
    listenPlayRef.current?.cancel('Access to this lesson was removed.');
    challengeRef.current?.cancel('Access to this lesson was removed.');
    uploadRef.current.cancel();
  },[accessLost]);
  useEffect(() => {
    if (lessonFeedbackEnabled) return;
    if (listenPlay.active) listenPlay.cancel('The lesson creator disabled feedback. This run is not scored.');
    if (challenge.active) challenge.cancel('The lesson creator disabled feedback. This run is not scored.');
    if (upload.phase !== 'idle' && upload.phase !== 'feedback' && upload.phase !== 'error') upload.cancel();
    // A live creator update must stop capture without changing the learner preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonFeedbackEnabled]);
  const [challengeSave, setChallengeSave] = useState<{state:'idle'|'saving'|'saved'|'error'; message:string}>({state:'idle',message:''});
  const challengeSaveId = useRef<string>('');
  useEffect(() => {
    if (challenge.phase === 'feedback' || upload.phase === 'feedback') {
      challengeSaveId.current = newChallengeId();
      setChallengeSave({state:'idle',message:''});
    }
  }, [challenge.phase, upload.phase]);
  useEffect(() => {
    if (!listenPlayEligible && listenPlay.active) {
      listenPlay.cancel('Feedback input is temporarily unavailable. Feedback preference stays On.');
    }
  }, [listenPlayEligible, listenPlay.active]);
  useEffect(() => {
    if (!microphoneEligible && listenInputMode === 'microphone') setListenInputMode('midi');
  }, [microphoneEligible, listenInputMode]);
  const changeFeedbackEnabled = (value:boolean) => setFeedbackChoice(value, {
    eligible: listenPlayEligible,
    cancel: () => listenPlay.cancel('Feedback turned off. This listen-then-play run is not scored.'),
    setEnabled: setListenPlayEnabled,
    creatorEnabled: lessonFeedbackEnabled,
  });
  useEffect(() => {
    if (listenPlay.active) listenPlay.cancel('Practice settings changed. This listen-then-play run is not scored.');
    // The selected unit or speed invalidates the capture window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.unitId, snapshot?.rate]);
  const mutedBeforeCapture = useRef<boolean | null>(null);
  const shouldMuteReference = listenPlay.phase === 'capturing' || challenge.active;
  const performanceAudio = usePianoPerformanceAudio({
    document, videoRef, clock: practice.clock, livePiano, offsetSeconds,
    pedalSpans, rate: snapshot?.rate ?? 1, volume, guitarProgram: guitarTone,
    enabled: !shouldMuteReference,
  });
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (shouldMuteReference && mutedBeforeCapture.current === null) {
      mutedBeforeCapture.current = media.muted;
      media.muted = true;
    } else if (!shouldMuteReference && mutedBeforeCapture.current !== null) {
      media.muted = mutedBeforeCapture.current;
      mutedBeforeCapture.current = null;
    }
  }, [shouldMuteReference, mediaKey]);
  const saveChallengeReport = async () => {
    if (!challengeReport || !manifest) return;
    setChallengeSave({state:'saving',message:''});
    if (!challengeSaveId.current) challengeSaveId.current = newChallengeId();
    try {
      await request(`/lessons/${encodeURIComponent(manifest.lesson_id)}/music-challenge-attempts`, 'POST',
        challengeAttemptPayload(challengeReport, {
          id: challengeSaveId.current,
          revisionId: manifest.revision_id,
          referenceSha256: manifest.reference.sha256,
          duration: document?.duration ?? manifest.duration,
          inputMode: challenge.report ? (challenge.report.modelProfile ? 'microphone' : 'midi') : 'microphone',
        }));
      void submitAttempt({
        attemptId: challengeSaveId.current, lessonId: manifest.lesson_id,
        revisionId: manifest.revision_id, actId: manifest.subject === 'guitar' ? 'guitar' : 'piano',
        mode: 'challenge', planId: plan?.id ?? `music-${manifest.revision_id}`,
        unitId: snapshot?.unitId ?? null, durationMs: (document?.duration ?? 0) * 1000,
        status: 'completed', assessmentAdapter: `${manifest.subject === 'guitar' ? 'guitar' : 'piano'}-notes-v1`,
        rubricVersion: 'v1', report: {challenge: challengeReport},
        accountScope: context?.accountScope ?? 'guest',
      }, {guard: access.guardRef.current});
      setChallengeSave({state:'saved',message:'Challenge report saved to your private history.'});
    } catch (cause) {
      setChallengeSave({state:'error',message:cause instanceof Error ? cause.message : 'The challenge report was not saved.'});
      void access.guardRef.current?.handleError(cause);
    }
  };
  const stagePlayhead = listenPlay.capturePlayhead ?? playhead;
  const challengeReport = challenge.report ?? upload.report;
  const challengeReportSource = challenge.report ? (challenge.report.modelProfile ? 'live-microphone' : 'live-midi') : upload.report ? 'upload' : null;
  const activeIds = useMemo(() => activeOccurrenceIds(intervals, stagePlayhead), [intervals, stagePlayhead]);
  const shellCapabilities = useMemo<PracticeCapabilities>(() => (challengeMode || challengeAvailable) && document?.subject === 'piano'
    ? {...liveCapabilities, challenge: 'supported'}
    : liveCapabilities, [challengeMode, challengeAvailable, document?.subject, liveCapabilities]);
  const guitar = document?.subject === 'guitar';
  const activeSetup = normalizeGuitarSetup({tuning: document?.guitar_tuning, capo: document?.guitar_capo});
  const guitarFingers = useMemo<Record<string, GuitarFinger>>(() => document?.subject === 'guitar'
    ? assignGuitarFingers(document.performance, activeSetup) : {},
    [document, activeSetup.tuning, activeSetup.capo]);
  const boxes = useMemo(() => document ? layoutMeasures(document).boxes : [], [document]);
  const layout = useMemo(() => document ? buildTimelineLayout(document, 1) : null, [document]);
  const clockTime = useClockTime(practice.clock, stagePlayhead);
  useEffect(() => {
    if (!guitar || !follow || followSuspended || !layout || !alignment) return;
    const width = Math.max(320, sharedWidth || 640);
    const x = 116 + layout.sourceSecondsToX(clockTime, alignment, 0);
    const target = Math.max(0, Math.min(layout.contentWidth, x - width * 0.35));
    setSharedScrollLeft(target);
    if (typeof globalThis.document !== 'undefined') {
      for (const node of globalThis.document.querySelectorAll<HTMLElement>(
        '.ws-guitar-practice .ws-roll-viewport, .ws-guitar-practice .ws-score-viewport')) {
        if (Math.abs(node.scrollLeft - target) > 0.5) node.scrollLeft = target;
      }
    }
  }, [guitar, follow, followSuspended, layout, alignment, clockTime, sharedWidth]);
  useEffect(() => {
    const bar = sharedBarRef.current;
    if (!bar || Math.abs(bar.scrollLeft - sharedScrollLeft) <= 0.5) return;
    programmaticScroll.current = true;
    bar.scrollLeft = sharedScrollLeft;
    const frame = requestAnimationFrame(() => { programmaticScroll.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [sharedScrollLeft]);
  const seek = useCallback((value: number) => {
    if (listenPlay.active) listenPlay.cancel('Position changed. This listen-then-play run is not scored.');
    if (challenge.active) challenge.cancel('Position changed. This challenge run is not scored.');
    if (practice.runtime) practice.dispatch({type: 'seek', time: Math.max(0, Math.min(document?.duration ?? value, value))});
    else if (videoRef.current) videoRef.current.currentTime = value;
  }, [practice, document?.duration, listenPlay, challenge]);
  const seekOccurrence = useCallback((id: string) => {
    const note = document?.performance.find(item => item.id === id);
    if (note) seek(note.onset + offsetSeconds);
  }, [document, offsetSeconds, seek]);

  const listenPlayInProgress = listenPlay.phase==='listening'||listenPlay.phase==='guard'
    ||listenPlay.phase==='count-in'||listenPlay.phase==='capturing'||listenPlay.phase==='analyzing';
  const stage = document ? <div className={`ws-stage piano-practice-stage ${!guitar&&practicePanels.length>1?'has-combined-panels':''}`}
    data-compact-view={compactView}>
    {listenPlayInProgress &&
      <div className={`listen-play-overlay listen-play-${listenPlay.phase}`} role="status" aria-live="polite">
        <strong>{listenPlay.phase==='listening'?'Listening':listenPlay.phase==='guard'?'Acoustic guard':listenPlay.phase==='count-in'?'Get ready':listenPlay.phase==='capturing'?'Play it back':'Analysing'}</strong>
        <span>{listenPlay.phase==='listening'?'Reference audio plays. Do not play yet.'
          :listenPlay.phase==='guard'?'Reference audio is muted. Let the room settle.'
          :listenPlay.phase==='count-in'?`${Math.max(1,Math.ceil(listenPlay.remaining))}`
          :listenPlay.phase==='capturing'?`${Math.max(0,Math.ceil(listenPlay.remaining))}s · ${listenPlay.captured} attacks measured`
          :'Aligning your performance…'}</span>
        {listenPlay.phase==='count-in'&&<i aria-hidden="true">{Math.max(1,Math.ceil(listenPlay.remaining))}</i>}
      </div>}
    {challengeMode&&(challenge.phase==='capturing'||challenge.phase==='analyzing')&&<div className={`listen-play-overlay listen-play-${challenge.phase}`} role="status" aria-live="polite">
      <strong>{challenge.phase==='capturing'?'Challenge run':'Analysing challenge'}</strong>
      <span>{challenge.phase==='capturing'?`Whole piece · 1× · ${challenge.captured} attacks measured`:'Fitting one global offset across the whole performance…'}</span>
    </div>}
    <div className="ws-video-pip" hidden={!pipOpen} inert={!pipOpen || undefined}
      aria-hidden={!pipOpen || undefined} data-video-pip={pipOpen ? 'open' : 'closed'}>
      <div className="ws-video-pip-bar"><span>Video</span>
        <Button variant="pip-close" type="button" aria-label="Hide video" onClick={() => setPipOpen(false)}>×</Button></div>
      <video ref={videoRef} src={videoUrl || undefined} playsInline preload="metadata" className="ws-video"/>
      <audio ref={pianoRef} src={preview.url || undefined} preload="auto"/>
      <audio ref={emptyPianoRef}/>
    </div>
    {!guitar && (practicePanels.includes('waterfall') || practicePanels.includes('keys')) &&
      <PianoPracticeInstrumentView document={document} clock={practice.clock}
        showWaterfall={practicePanels.includes('waterfall')} showKeys={practicePanels.includes('keys')}
        alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals} activeIds={activeIds}
        playhead={stagePlayhead} hands={hands.assignments} onSeekOccurrence={seekOccurrence} onSeek={seek}/>}
    {!guitar && practicePanels.includes('notes') && <PianoPracticeNotesView document={document} clock={practice.clock}
      alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals} activeIds={activeIds}
      playhead={stagePlayhead} hands={hands.assignments} onSeekOccurrence={seekOccurrence} onSeek={seek}/>}
    {!guitar && practicePanels.length === 0 && <p className="piano-practice-empty">
      Choose Notes, Waterfall, or Piano keys from View.
    </p>}
    {guitar && <div className="ws-guitar-practice" data-guitar-practice="true" ref={sharedRef}>
      <GuitarChordStrumHud chords={guitarChords} time={stagePlayhead}
        events={document.performance.map(note => ({onset: note.onset, pitch: note.pitch,
          string: note.string ?? resolveGuitarPosition(note.pitch, note.string, note.fret, activeSetup)?.string ?? null}))}
        beatsPerBar={document.time_signature.numerator}
        onSelectChord={chord => seek(chord.start)}/>
      <GuitarNeckGuide handedness={guitarHandedness} fretCount={24}
        tuning={activeSetup.tuning} capo={activeSetup.capo}
        positions={document.performance.filter(note => activeIds.includes(note.id))
          .flatMap(note => {
            const position = resolveGuitarPosition(note.pitch, note.string, note.fret, activeSetup);
            return position ? [{pitch: note.pitch, ...position, label: pitchName(note.pitch),
              finger: guitarFingers[note.id]}] : [];
          })}
        onPositionSelect={(string, fret) => {
          const target = document.performance.find(note => {
            const position = resolveGuitarPosition(note.pitch, note.string, note.fret, activeSetup);
            return position?.string === string && position?.fret === fret;
          }) ?? document.performance.find(note => Math.abs(note.onset - playhead) < 1.5);
          if (target) seekOccurrence(target.id);
        }}/>
      {guitarStage === 'roll' && <TimeRoll document={document} window={rollWindow}
        onWindowChange={next => { setRollWindow(next); setFollowSuspended(true); }}
        layout={layout ?? undefined} alignment={alignment ?? undefined}
        sharedScrollLeft={sharedScrollLeft} sharedViewportWidth={sharedWidth} gutter={70}
        cursorFallbackSeconds={stagePlayhead} playhead={stagePlayhead} offsetSeconds={offsetSeconds}
        activeOccurrenceIds={activeIds} clock={practice.clock} intervals={intervals}
        selectedOccurrenceId={null} reveal={null} rowMode="strings"
        tuning={activeSetup.tuning} capo={activeSetup.capo}
        editingEnabled={false} onSelect={seekOccurrence} onSeek={seek}/>}
      {guitarStage === 'roll' && <ContinuousScore document={document} boxes={boxes}
        selectedOccurrenceId={null} reveal={null} onSelect={seekOccurrence}
        clock={practice.clock} alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals}
        activeOccurrenceIds={activeIds} layout={layout ?? undefined}
        sharedScrollLeft={sharedScrollLeft} cursorFallbackSeconds={stagePlayhead} playheadTick={null}
        staffMode="guitar-tab" guitarChords={guitarChords}
        tuning={activeSetup.tuning} capo={activeSetup.capo}
        onUserScroll={() => setFollowSuspended(true)}
        editingEnabled={false}/>}
      {guitarStage === 'roll' && <div className="ws-shared-scrollbar" ref={sharedBarRef}
        data-shared-scrollbar aria-label="Shared timeline horizontal scroll"
        onScroll={event => {
          if (programmaticScroll.current) return;
          setFollowSuspended(true);
          setSharedScrollLeft(event.currentTarget.scrollLeft);
          if (typeof globalThis.document !== 'undefined') {
            for (const node of globalThis.document.querySelectorAll<HTMLElement>(
              '.ws-guitar-practice .ws-roll-viewport, .ws-guitar-practice .ws-score-viewport')) {
              if (Math.abs(node.scrollLeft - event.currentTarget.scrollLeft) > 0.5) {
                node.scrollLeft = event.currentTarget.scrollLeft;
              }
            }
          }
        }}>
        <div style={{width: Math.max(1, (layout?.contentWidth ?? 0) + 116), height: 1}}/>
      </div>}
    </div>}
  </div> : null;

  if (accessLost) return <section className="ws-shell ws-shell-focused piano-practice-shell" data-access-lost="true" aria-label="Music practice">
    <h1>Access to this lesson was removed.</h1>
    <p role="status">Practice stopped and device resources were released.</p>
  </section>;
  if (loading) return <section className="ws-shell ws-shell-focused piano-practice-shell" aria-busy="true">
    <p role="status">Opening practice…</p></section>;
  if (error || !document || !plan) return <section className="ws-shell ws-shell-focused piano-practice-shell">
    {onBack && <IconButton variant="icon-shell" className="ws-icon-button" onClick={onBack}>Back</IconButton>}
    <p role="alert">{error || 'The practice could not open.'}</p></section>;
  const displaySnapshot=snapshot??emptyPracticeSnapshot(plan, mediaKey?'Preparing practice…':'Practice needs the lesson video or verified piano audio.');
  const shellStatus=snapshot?(undefined as undefined):mediaKey?'starting':'Practice source unavailable';
  return <PracticeShell className="ws-shell ws-shell-focused piano-practice-shell mimic-shell mimic-immersive minimal-practice"
    stageClassName="ws-correction" dockId="piano-practice-player" title={title}
    eyebrow={embedded ? (guitar ? 'GUITAR PRACTICE' : 'PIANO PRACTICE') : undefined} onBack={onBack} stage={stage}
    modeControl={onModeChange&&<ExperienceModeSelector compact current={challengeMode?'challenge':'practice'}
      capabilities={experienceModeCapabilitiesFrom(shellCapabilities)}
      onSelect={mode=>onModeChange(experienceModeToLegacy(mode))}/>}
    plan={plan} snapshot={displaySnapshot} capabilities={shellCapabilities} voice={voice} disabled={!snapshot}
    onCommand={dispatchPractice} onSeek={seek} onSelect={index => dispatchPractice({type: 'select', index})}
    autoStartVoice
    status={shellStatus}
    toolsBefore={<>
      <div className="ws-compact-switch" role="group" aria-label="Compact view"
        onClick={() => chooseCompactView('guide')}>
        <button type="button" aria-pressed={compactView === 'guide'}
          className={compactView === 'guide' ? 'is-active' : ''}
          onClick={event => { event.stopPropagation(); chooseCompactView('guide'); }}>Guide</button>
        <button type="button" aria-pressed={compactView === 'sheet'}
          className={compactView === 'sheet' ? 'is-active' : ''}
          onClick={event => { event.stopPropagation(); chooseCompactView('sheet'); }}>Sheet</button>
      </div>
      {!guitar && <PracticeCheckboxMenu label="View"
        options={[{value:'notes',label:'Notes'},{value:'waterfall',label:'Waterfall'},{value:'keys',label:'Piano keys'}]}
        selected={practicePanels} onToggle={togglePracticePanel}/>}
      {!challengeMode && listenPlayEnabled && listenPlayEligible && <Button variant="dock-tool" type="button" className="player-tool"
        data-listen-play="true" aria-pressed={listenPlay.active}
        title={listenPlay.active ? 'Stop listen and play' : 'Play the section, then perform it back'}
        onClick={() => listenPlay.active ? listenPlay.cancel() : listenPlay.start()}>
        {listenPlay.active ? 'Stop listen & play' : 'Listen & play'}
      </Button>}
      {challengeMode && manifest?.subject==='piano' && <Button variant="dock-tool" type="button" className="player-tool"
        data-music-challenge="true" aria-pressed={challenge.active} disabled={!challenge.active&&!challengeEligible}
        title={challenge.active ? 'Stop the challenge' : 'Perform the whole piece at 1× with the reference muted'}
        onClick={() => {
          if (challenge.active) { challenge.cancel(); return; }
          upload.cancel();
          if (listenPlay.active) listenPlay.cancel();
          challenge.start();
        }}>
        {challenge.active ? 'Stop challenge' : challenge.phase === 'feedback' ? 'Challenge again' : 'Start challenge'}
      </Button>}
      <Select variant="dock-source" className="ws-practice-source-select" aria-label="Source audio" value={audioMode}
        onChange={event => setAudioMode(event.target.value === 'piano' ? 'piano' : 'original')}>
        <option value="original">Original</option>
        <option value="piano" disabled={pianoOptionDisabled}>{guitar ? 'Guitar' : 'Piano'}</option>
      </Select>
      <Button variant="dock-tool" type="button" className="player-tool" aria-pressed={pipOpen} aria-label="Video"
        title={pipOpen ? 'Hide video' : 'Show video'} onClick={() => setPipOpen(value => !value)}>Video</Button>
    </>}
    toolsAfter={guitar && followSuspended
      ? <Button variant="dock-tool" type="button" className="player-tool" data-follow-resume="true"
          onClick={() => { setFollow(true); setFollowSuspended(false); }}>Follow</Button>
      : undefined}
    settingsExtra={<>
      {!challengeMode&&<FeedbackChoice subject={manifest?.subject??''} assessment={listenAssessment}
        referenceReviewed={manifest?.reference_reviewed===true}
        inputSelected={listenInputMode==='midi'?midi.connected:microphoneEligible}
        inputMode={listenInputMode} microphoneAvailable={microphoneEligible}
        enabled={listenPlayEnabled} active={listenPlay.active}
        lessonEnabled={lessonFeedbackEnabled}
        onEnabledChange={changeFeedbackEnabled}/>}
      {challengeMode&&manifest?.subject==='piano'&&<section className="listen-play-setup" aria-label="Whole-piece challenge">
        <h3>Whole-piece challenge · experimental</h3>
        <p className="small muted">Perform the complete reviewed piece once at 1×. The reference is muted, one global start offset is fitted, and the overall score is withheld until the policy is qualified.</p>
        {midi.supported?<>
          {midi.inputs.length>0?<label>Keyboard input<Select variant="settings-extra" aria-label="Challenge keyboard input" value={midi.selected}
            onChange={event=>midi.select(event.target.value)}>
            <option value="">Choose an input</option>
            {midi.inputs.map(input=><option key={input.id} value={input.id}>{input.name}</option>)}
          </Select></label>:<Button variant="settings-choice" type="button" disabled={midi.busy} onClick={()=>void midi.connect()}>
            {midi.busy?'Connecting keyboard…':'Connect a keyboard'}
          </Button>}
          {midi.selected&&<button type="button" className="back-link" onClick={midi.disconnect}>Disconnect keyboard</button>}
          <p className="small muted" role="status">{midi.message}</p>
        </>:<p role="alert">This browser cannot connect a MIDI keyboard here.</p>}
        {microphoneEligible&&<label>Challenge input<Select variant="settings-extra" aria-label="Challenge input" value={challengeInputMode}
          onChange={event=>setChallengeInputMode(event.target.value==='microphone'?'microphone':'midi')}>
          <option value="midi">MIDI keyboard</option><option value="microphone">Microphone</option>
        </Select></label>}
        {!challengeEligible&&<p className="small muted" role="status">Challenge unavailable: {challengeInputMode==='midi'?listenEligibility.reasons.join(' '):'Microphone input is not enabled for this reviewed rubric.'}</p>}
        <Button variant="settings-choice" type="button" disabled={!challengeEligible||challenge.active}
          onClick={()=>challenge.start()}>{challenge.phase==='feedback'?'Run challenge again':'Start whole-piece challenge'}</Button>
        {challenge.error&&<p className="small muted" role="alert">{challenge.error}</p>}
        {audioAssessmentEnabled&&microphoneEligible&&<div className="listen-play-setup" aria-label="Uploaded performance">
          <h3>Uploaded performance · experimental</h3>
          <p className="small muted">Decode and transcribe an audio or video file locally, then align it to the whole piece. Raw media is not uploaded; the worker returns events and provenance, never a percentage.</p>
          <input type="file" accept="audio/*,video/*,.mp4,.webm,.mov,.m4a,.wav,.mp3,.ogg" aria-label="Upload performance audio or video"
            disabled={upload.phase==='decoding'||upload.phase==='transcribing'||upload.phase==='analyzing'}
            onChange={event=>{
              const file=event.currentTarget.files?.[0];
              event.currentTarget.value='';
              if(!file)return;
              challenge.cancel();
              listenPlay.cancel();
              void upload.analyze(file);
            }}/>
          {(upload.phase==='decoding'||upload.phase==='transcribing'||upload.phase==='analyzing')&&<p className="small muted" role="status">
            {upload.phase==='decoding'?'Decoding locally…':upload.phase==='transcribing'?'Transcribing with the pinned profile…':'Aligning…'} {Math.round(upload.progress*100)}%
            <button type="button" className="back-link" onClick={upload.cancel}>Cancel</button>
          </p>}
          {upload.error&&<p className="small muted" role="alert">{upload.error}</p>}
          <p className="small muted">No score is published. Browser/device qualification is still required; unsupported codecs fail explicitly.</p>
        </div>}
        <p className="small muted">Experimental. Counts, offset and coverage are reported; no score, ranking or leaderboard is produced. Microphone input is available only for a reviewed microphone rubric and remains unqualified.</p>
      </section>}
      {!challengeMode&&(manifest?.subject==='piano'||manifest?.subject==='guitar')&&listenAssessment.assessment==='notes'&&<section className="listen-play-setup" aria-label="Listen and play">
        <h3>Listen &amp; play · experimental</h3>
        <p className="small muted">Listen to the selected section, wait for the acoustic guard and count-in, then play it back with the reference audio muted. Feedback is local and unscored.</p>
        {midi.supported?<>
          {midi.inputs.length>0?<label>Keyboard input<Select variant="settings-extra" aria-label="Keyboard input" value={midi.selected}
            onChange={event=>midi.select(event.target.value)}>
            <option value="">Choose an input</option>
            {midi.inputs.map(input=><option key={input.id} value={input.id}>{input.name}</option>)}
          </Select></label>:<Button variant="settings-choice" type="button" disabled={midi.busy} onClick={()=>void midi.connect()}>
            {midi.busy?'Connecting keyboard…':'Connect a keyboard'}
          </Button>}
          {midi.selected&&<button type="button" className="back-link" onClick={midi.disconnect}>Disconnect keyboard</button>}
          <p className="small muted" role="status">{midi.message}</p>
        </>:<p role="alert">This browser cannot connect a MIDI keyboard here. The guide and timing practice remain available.</p>}
        <label>Feedback input<Select variant="settings-extra" aria-label="Feedback input" value={listenInputMode}
          onChange={event=>setListenInputMode(event.target.value==='microphone'?'microphone':'midi')}>
          <option value="midi">MIDI keyboard</option>
          <option value="microphone" disabled={!microphoneEligible} title={microphoneEligible?undefined:'Microphone feedback is not enabled for this reviewed lesson.'}>Microphone</option>
        </Select></label>
        {!microphoneEligible&&<p className="small muted" role="status">Microphone feedback is unavailable for this lesson or browser. MIDI feedback can still be used when an instrument is connected.</p>}
        {!listenPlayEligible&&<p className="small muted" role="status">Feedback preference is On, but setup is incomplete: {listenEligibility.reasons.join(' ')}</p>}
        {listenPlayEnabled&&!listenPlay.active&&listenPlayEligible&&<p className="small muted" role="status">Feedback is On. Press “Listen &amp; play” in the tools to start the listen-then-play run.</p>}
        {listenPlay.error&&<p className="small muted" role="alert">{listenPlay.error}</p>}
        <p className="small muted">No score is shown. The start offset is fitted separately; timing remains approximate and is not hardware-qualified.</p>
      </section>}
      <label>Practice stops<Select variant="settings-extra" aria-label="Practice stops" value={chunkBars}
        onChange={event => setChunkBars(Number(event.target.value) as ChunkBarsOption)}>
        <option value={0}>Off (whole piece)</option><option value={1}>1 bar</option>
        <option value={2}>2 bars</option><option value={4}>4 bars</option>
      </Select></label>
      {guitar && <label>Guitar sound<Select variant="settings-extra" aria-label="Guitar sound" value={guitarTone}
        onChange={event => setGuitarTone(Number(event.target.value))}>
        <option value={25}>Acoustic Steel</option>
        <option value={24}>Classical Nylon</option>
        <option value={27}>Clean Electric</option>
        <option value={26}>Jazz</option>
      </Select></label>}
      {guitar && <label>Fretboard orientation<Select variant="settings-extra" aria-label="Fretboard orientation" value={guitarHandedness}
        onChange={event => setGuitarHandedness(event.target.value === 'left' ? 'left' : 'right')}>
        <option value="right">Right-handed</option>
        <option value="left">Left-handed</option>
      </Select></label>}
      {guitar && <div className="ws-row" role="group" aria-label="Guitar stage">
        <Button variant="immersive-action" type="button" data-guitar-stage="roll" aria-pressed={guitarStage === 'roll'}
          onClick={() => setGuitarStage('roll')}>Roll</Button>
        <Button variant="immersive-action" type="button" data-guitar-stage="compact" aria-pressed={guitarStage === 'compact'}
          onClick={() => setGuitarStage('compact')}>Compact</Button>
      </div>}
      {!guitar && preview.url && hasWebAudio && <label>Piano sound<Select variant="settings-extra" aria-label="Piano synthesis source" value={preferRenderedWav ? 'wav' : 'live'}
        onChange={event => { const wav = event.target.value === 'wav'; setPreferRenderedWav(wav); setAudioMode('piano'); }}>
        <option value="live">Live grand piano</option><option value="wav">Rendered WAV</option>
      </Select></label>}
      <label>Volume<Input variant="plain" aria-label="Volume" type="range" min={0} max={1} step={0.01}
        value={volume} onChange={event => setVolume(Number(event.target.value))}/></label>
      {sourcePlayer.error && <p role="alert">{sourcePlayer.error}</p>}
      {performanceAudio.error && <p role="alert">{performanceAudio.error}</p>}
      {preview.error && <p role="alert">{preview.error}</p>}
      <p className="small muted">{guitar ? 'Guitar' : 'Piano'} practice is unscored. The reviewed video or verified {guitar ? 'guitar' : 'piano'} audio is the only source clock.</p>
    </>}
    children={<>
    {lessonFeedbackEnabled&&listenPlay.phase==='feedback'&&listenPlay.report?<section className="listen-play-feedback" aria-label="Listen and play feedback">
      <header>
        <div><p className="ws-eyebrow">EXPERIMENTAL · UNSCORED</p><h2>Listen &amp; play feedback</h2></div>
        <Button variant="immersive-action" type="button" onClick={()=>listenPlay.start()}>Listen &amp; play again</Button>
      </header>
      <p role="status">No score is shown for this policy. The fitted start offset is reported separately from internal timing.</p>
      <dl>
        <div><dt>Required notes matched</dt><dd>{listenPlay.report.matchedRequired} / {listenPlay.report.assessedRequired} assessed</dd></div>
        <div><dt>Missing · extra</dt><dd>{listenPlay.report.missingRequired} · {listenPlay.report.extra}</dd></div>
        <div><dt>Start offset</dt><dd>{listenPlay.report.offsetSeconds.toFixed(2)} s source · {listenPlay.report.offsetRealSeconds.toFixed(2)} s real</dd></div>
        <div><dt>Coverage</dt><dd>{Math.round(listenPlay.report.referenceCoverage*100)}% reference · {Math.round(listenPlay.report.captureCoverage*100)}% capture</dd></div>
        <div><dt>Timing</dt><dd>{listenPlay.report.timing.available
          ?`${Math.round((listenPlay.report.timing.meanAbsoluteErrorSeconds??0)*1000)} ms mean · ${listenPlay.report.timing.confidence} confidence`
          :'Unavailable for this evidence'}</dd></div>
      </dl>
      {listenPlay.report.reasons.length>0&&<p className="small muted">Evidence notes: {listenPlay.report.reasons.join(', ')}.</p>}
      {listenPlay.report.notes.length>0?<ul>{listenPlay.report.notes.slice(0,40).map(note=><li key={`${note.status}-${note.id}`} className={`feedback-note ${note.status}`}>
        {note.status==='matched'?`${pitchName(note.pitch)} ${note.timing??'matched'}${note.errorSeconds!==null?` (${Math.round(note.errorSeconds*1000)} ms)`:''}`
          :note.status==='missing'?`Missing ${pitchName(note.pitch)}`
          :note.status==='extra'?`Extra ${pitchName(note.pitch)}`
          :`Unassessed ${pitchName(note.pitch)}`}
      </li>)}</ul>:<p className="small muted">No note-level feedback was available.</p>}
      {listenPlay.report.notes.length>40&&<p className="small muted">Showing 40 of {listenPlay.report.notes.length} note events.</p>}
    </section>:null}
    {lessonFeedbackEnabled&&(challenge.phase==='feedback'||upload.phase==='feedback')&&challengeReport?<section className="listen-play-feedback challenge-feedback" aria-label="Whole-piece challenge report">
      <header>
        <div><p className="ws-eyebrow">EXPERIMENTAL · SCORE WITHHELD</p><h2>Whole-piece challenge{challengeReportSource==='upload'?' · uploaded performance':challengeReportSource==='live-microphone'?' · microphone':''}</h2></div>
        {challengeHistoryEnabled&&<Button variant="immersive-action" type="button" disabled={challengeSave.state==='saving'}
          onClick={()=>void saveChallengeReport()}>{challengeSave.state==='saving'?'Saving…':challengeSave.state==='saved'?'Saved':'Save report'}</Button>}
      </header>
      <p role="status">No overall score is published. {challengeReport.scoreReason?`Reason: ${challengeReport.scoreReason}.`:''} Counts, offset and coverage remain available.</p>
      <dl>
        <div><dt>Required notes matched</dt><dd>{challengeReport.matchedRequired} / {challengeReport.assessedRequired} assessed</dd></div>
        <div><dt>Missing · extra</dt><dd>{challengeReport.missingRequired} · {challengeReport.extra}</dd></div>
        <div><dt>Start offset</dt><dd>{challengeReport.offsetSeconds.toFixed(2)} s · support {Math.round(challengeReport.support*100)}%</dd></div>
        <div><dt>Coverage</dt><dd>{Math.round(challengeReport.referenceCoverage*100)}% reference · {Math.round(challengeReport.captureCoverage*100)}% capture</dd></div>
        <div><dt>Timing</dt><dd>{challengeReport.timing.available
          ?`${Math.round((challengeReport.timing.meanAbsoluteErrorSeconds??0)*1000)} ms mean · ${challengeReport.timing.confidence} confidence`
          :'Unavailable for this evidence'}</dd></div>
        <div><dt>Alignment</dt><dd>{challengeReport.ambiguous?'Ambiguous':'One global offset'} · {Math.round(challengeReport.peakSeparationSeconds*1000)} ms peak separation</dd></div>
      </dl>
      {challengeReport.reasons.length>0&&<p className="small muted">Evidence notes: {challengeReport.reasons.join(', ')}.</p>}
      {challengeReport.extraOutsideSections>0&&<p className="small muted">{challengeReport.extraOutsideSections} extra note{challengeReport.extraOutsideSections===1?'':'s'} outside the reviewed sections; not attributed to a section.</p>}
      <ul>{challengeReport.sections.map(section=><li key={section.id} className="feedback-note">
        {section.label}: {section.matchedRequired}/{section.assessedRequired} matched · {section.missingRequired} missing · {section.extra} extra
        {section.recall!==null?` · ${Math.round(section.recall*100)}% recall`:''}
      </li>)}</ul>
      {challengeSave.message&&<p className="small muted" role={challengeSave.state==='error'?'alert':'status'}>{challengeSave.message}</p>}
      <p className="small muted">Live MIDI only. No microphone, uploaded audio, leaderboard, ranking or publish action is enabled. This report is not device-qualified.</p>
    </section>:null}
    </>}/>
}
