import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  activeOccurrenceIds, alignmentFromSpans, applyAnchors, occurrenceIntervals,
  type Alignment, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import type {MusicLessonManifest, MusicPedalSpan} from '../../../../../packages/lesson-schema/index';
import {assetUrl, request} from '../../api';
import {MUSIC_CAPABILITIES, voiceControl, type PracticeCapabilities} from '../../../../../packages/learning-engine/practice-capabilities';
import {emptyPracticeSnapshot} from '../../../../../packages/learning-engine/practice-runtime';
import {PracticeShell} from '../../practice/PracticeShell';
import {ExperienceModeSelector} from '../../practice/ExperienceModeSelector';
import {experienceModeCapabilitiesFrom, experienceModeToLegacy} from '../../../../../packages/learning-engine/experience-mode';
import {useMusicPractice} from '../../practice/useMusicPractice';
import {usePracticeVoice} from '../../practice/usePracticeVoice';
import {voiceCommandToPractice} from '../../practice/practice-input';
import {createLocalPracticeStore} from '../../practice/practice-store';
import {pianoPracticePlan} from '../../practice/practice-plans';
import {buildPracticeChunks, type ChunkBarsOption} from '../practice-chunks';
import {usePianoPreviewAsset} from '../usePianoPreviewAsset';
import {usePianoSourcePlayer} from '../usePianoSourcePlayer';
import {usePianoPreferences} from '../piano-preferences';
import {useHandAssignments} from './useHandAssignments';
import {
  PianoPracticeKeysView, PianoPracticeNotesView, PianoPracticeWaterfallView,
  type PracticeViewKind,
} from './PianoPracticeViews';
import {restoreFromReference} from './save-payload';
import {usePianoPerformanceAudio} from './usePianoPerformanceAudio';

type Manifest = MusicLessonManifest & {reader?: unknown};
const PRACTICE_VIEW_KEY = 'piano-practice-view-v1';
const PRACTICE_VIEWS: PracticeViewKind[] = ['notes', 'waterfall', 'keys'];

function readPracticeView(): PracticeViewKind {
  try {
    const saved = globalThis.localStorage?.getItem(PRACTICE_VIEW_KEY);
    return saved === 'notes' || saved === 'waterfall' || saved === 'keys' ? saved : 'waterfall';
  } catch { return 'waterfall'; }
}

/**
 * Dedicated piano practice route.
 *
 * It does not construct the correction/undo/save editor. It loads the reviewed
 * notation and alignment, shares the rendering/transport modules with review,
 * and lets the common runtime own every practice transition.
 */
export function PianoPracticeWorkspace({lessonId: lessonIdProp, lessonTitle, embedded = false, onBack, onModeChange}: {
  lessonId?: string;
  lessonTitle?: string;
  embedded?: boolean;
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [chunkBars, setChunkBars] = useState<ChunkBarsOption>(2);
  const [pipOpen, setPipOpen] = useState(true);
  const [practiceView, setPracticeView] = useState<PracticeViewKind>(readPracticeView);
  const choosePracticeView = (view: PracticeViewKind) => {
    if (!PRACTICE_VIEWS.includes(view)) return;
    setPracticeView(view);
    try { globalThis.localStorage?.setItem(PRACTICE_VIEW_KEY, view); } catch { /* preference optional */ }
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
    setLoading(true);
    setError('');
    setDocument(null);
    setManifest(null);
    (async () => {
      try {
        if (!lessonId) throw new Error('This practice link is incomplete.');
        const value = await request<Manifest>(`/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false,
          {'X-Lesson-Formats': '1,2'});
        const reference = value.reference;
        if (!reference?.key) throw new Error('This lesson has no reviewed piano reference.');
        const response = await fetch(assetUrl(reference.key), {credentials: 'same-origin'});
        if (!response.ok) throw new Error('The reviewed piano reference could not be loaded.');
        const bytes = await response.arrayBuffer();
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map(value => value.toString(16).padStart(2, '0')).join('');
        if (typeof reference.bytes === 'number' && bytes.byteLength !== reference.bytes
          || reference.sha256 && digest !== reference.sha256) {
          throw new Error('The piano reference does not match its reviewed file. Reopen the lesson.');
        }
        const payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
        const restored = restoreFromReference(payload);
        if (!restored.ok) throw new Error(restored.message);
        if (cancelled) return;
        const saved = restored.value.alignment;
        const base: Alignment = saved?.passages?.length
          ? {alignment_version: 1, mode: saved.mode, basis: saved.basis, passages: saved.passages as Alignment['passages']}
          : alignmentFromSpans(restored.value.document, restored.value.spans);
        const anchored = applyAnchors(base, restored.value.document, saved?.anchors ?? []);
        if (anchored.problem) throw new Error(`The saved alignment could not be applied: ${anchored.problem}`);
        setManifest(value);
        setDocument(restored.value.document);
        setAlignment(anchored.alignment);
        setOffsetSeconds(restored.value.offsetSeconds);
        setPedalSpans(value.pedal ?? []);
        setTitle(restored.value.title ?? value.title ?? lessonTitle ?? 'Piano practice');
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The piano practice could not open.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId, lessonTitle]);

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
  const store = useMemo(() => createLocalPracticeStore(), []);
  const capabilities = useMemo<PracticeCapabilities>(() => ({
    ...MUSIC_CAPABILITIES,
    speeds: [0.25, 0.5, 0.75, 1],
    countIn: {supported: true, value: 0, options: [0, 3, 5, 10].map(seconds => ({seconds, label: seconds ? `${seconds}s` : 'Off'}))},
    rest: {supported: true, value: 1.5, options: [0, 1.5, 3, 5]},
  }), []);
  const practice = useMusicPractice({
    plan: plan ?? {id: 'unavailable', lessonId, revisionId: 'unavailable', duration: document?.duration ?? 0, units: []},
    mediaRef,
    transportKey: mediaKey,
    capabilities,
    store,
  });
  const snapshot = practice.snapshot;
  useEffect(() => {
    if (livePiano && videoRef.current) videoRef.current.muted = true;
  }, [livePiano, snapshot?.status, videoUrl]);
  const voice = usePracticeVoice(command => {
    const mapped = voiceCommandToPractice(command, {rates: [0.25, 0.5, 0.75, 1],
      rate: snapshot?.rate ?? 1, loop: snapshot?.loop ?? false});
    if (mapped) practice.dispatch(mapped);
  });
  const liveCapabilities = useMemo<PracticeCapabilities>(() => ({...capabilities,
    voice: voiceControl(voice.status, voice.error, voice.supported)}), [capabilities, voice]);
  const dispatchPractice = (command: Parameters<typeof practice.dispatch>[0]) => {
    practice.dispatch(command);
  };

  const intervals = useMemo(() => document ? occurrenceIntervals(document, offsetSeconds) : [], [document, offsetSeconds]);
  const playhead = snapshot?.time ?? 0;
  const activeIds = useMemo(() => activeOccurrenceIds(intervals, playhead), [intervals, playhead]);
  const hands = useHandAssignments(document, lessonId || null, false);
  const sourcePlayer = usePianoSourcePlayer(videoRef, livePiano ? emptyPianoRef : pianoRef,
    livePiano ? 'original' : audioMode, offsetSeconds, manifest?.preview_identity ?? '', () => setAudioMode('original'));
  const performanceAudio = usePianoPerformanceAudio({
    document, videoRef, clock: practice.clock, livePiano, offsetSeconds,
    pedalSpans, rate: snapshot?.rate ?? 1, volume,
  });
  const seek = useCallback((value: number) => {
    if (practice.runtime) practice.dispatch({type: 'seek', time: Math.max(0, Math.min(document?.duration ?? value, value))});
    else if (videoRef.current) videoRef.current.currentTime = value;
  }, [practice, document?.duration]);
  const seekOccurrence = useCallback((id: string) => {
    const note = document?.performance.find(item => item.id === id);
    if (note) seek(note.onset + offsetSeconds);
  }, [document, offsetSeconds, seek]);

  const stage = document ? <div className="ws-stage piano-practice-stage">
    <div className="ws-video-pip" hidden={!pipOpen} inert={!pipOpen || undefined}
      aria-hidden={!pipOpen || undefined} data-video-pip={pipOpen ? 'open' : 'closed'}>
      <div className="ws-video-pip-bar"><span>Video</span>
        <button type="button" aria-label="Hide video" onClick={() => setPipOpen(false)}>×</button></div>
      <video ref={videoRef} src={videoUrl || undefined} playsInline preload="metadata" className="ws-video"/>
      <audio ref={pianoRef} src={preview.url || undefined} preload="auto"/>
      <audio ref={emptyPianoRef}/>
    </div>
    {practiceView === 'notes' && <PianoPracticeNotesView document={document} clock={practice.clock}
      alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals} activeIds={activeIds}
      playhead={playhead} hands={hands.assignments} onSeekOccurrence={seekOccurrence} onSeek={seek}/>}
    {practiceView === 'waterfall' && <PianoPracticeWaterfallView document={document} clock={practice.clock}
      alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals} activeIds={activeIds}
      playhead={playhead} hands={hands.assignments} onSeekOccurrence={seekOccurrence} onSeek={seek}/>}
    {practiceView === 'keys' && <PianoPracticeKeysView document={document} clock={practice.clock}
      alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals} activeIds={activeIds}
      playhead={playhead} hands={hands.assignments} onSeekOccurrence={seekOccurrence} onSeek={seek}/>}
  </div> : null;

  if (loading) return <section className="ws-shell ws-shell-focused piano-practice-shell" aria-busy="true">
    <p role="status">Opening piano practice…</p></section>;
  if (error || !document || !plan) return <section className="ws-shell ws-shell-focused piano-practice-shell">
    {onBack && <button type="button" className="ws-icon-button" onClick={onBack}>Back</button>}
    <p role="alert">{error || 'The piano practice could not open.'}</p></section>;
  const displaySnapshot=snapshot??emptyPracticeSnapshot(plan, mediaKey?'Preparing practice…':'Practice needs the lesson video or verified piano audio.');
  const shellStatus=snapshot?(undefined as undefined):mediaKey?'starting':'Practice source unavailable';
  return <PracticeShell className="ws-shell ws-shell-focused piano-practice-shell mimic-shell mimic-immersive minimal-practice"
    stageClassName="ws-correction" dockId="piano-practice-player" title={title}
    eyebrow={embedded ? 'PIANO PRACTICE' : undefined} onBack={onBack} stage={stage}
    modeControl={onModeChange&&<ExperienceModeSelector compact current="practice"
      capabilities={experienceModeCapabilitiesFrom(liveCapabilities)}
      onSelect={mode=>onModeChange(experienceModeToLegacy(mode))}/>}
    plan={plan} snapshot={displaySnapshot} capabilities={liveCapabilities} voice={voice} disabled={!snapshot}
    onCommand={dispatchPractice} onSeek={seek} onSelect={index => dispatchPractice({type: 'select', index})}
    autoStartVoice
    status={shellStatus}
    toolsBefore={<>
      <select className="ws-practice-view-select" aria-label="Practice view" value={practiceView}
        onChange={event => choosePracticeView(event.target.value as PracticeViewKind)}>
        <option value="notes">Notes</option>
        <option value="waterfall">Waterfall</option>
        <option value="keys">Piano keys</option>
      </select>
      <select className="ws-practice-source-select" aria-label="Source audio" value={audioMode}
        onChange={event => setAudioMode(event.target.value === 'piano' ? 'piano' : 'original')}>
        <option value="original">Original</option>
        <option value="piano" disabled={pianoOptionDisabled}>Piano</option>
      </select>
      <button type="button" className="player-tool" aria-pressed={pipOpen} aria-label="Video"
        title={pipOpen ? 'Hide video' : 'Show video'} onClick={() => setPipOpen(value => !value)}>Video</button>
    </>}
    settingsExtra={<>
      <label>Practice stops<select aria-label="Practice stops" value={chunkBars}
        onChange={event => setChunkBars(Number(event.target.value) as ChunkBarsOption)}>
        <option value={0}>Off (whole piece)</option><option value={1}>1 bar</option>
        <option value={2}>2 bars</option><option value={4}>4 bars</option>
      </select></label>
      {preview.url && hasWebAudio && <label>Piano sound<select aria-label="Piano synthesis source" value={preferRenderedWav ? 'wav' : 'live'}
        onChange={event => { const wav = event.target.value === 'wav'; setPreferRenderedWav(wav); setAudioMode('piano'); }}>
        <option value="live">Live grand piano</option><option value="wav">Rendered WAV</option>
      </select></label>}
      <label>Volume<input aria-label="Volume" type="range" min={0} max={1} step={0.01}
        value={volume} onChange={event => setVolume(Number(event.target.value))}/></label>
      {sourcePlayer.error && <p role="alert">{sourcePlayer.error}</p>}
      {performanceAudio.error && <p role="alert">{performanceAudio.error}</p>}
      {preview.error && <p role="alert">{preview.error}</p>}
      <p className="small muted">Piano practice is unscored. The reviewed video or verified piano audio is the only source clock.</p>
    </>}/>
}
