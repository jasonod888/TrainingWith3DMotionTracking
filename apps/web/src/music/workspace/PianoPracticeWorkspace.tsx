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
  PianoPracticeInstrumentView, PianoPracticeNotesView, type PracticePanel,
} from './PianoPracticeViews';
import {PracticeCheckboxMenu} from '../../practice/PracticeCheckboxMenu';
import {Button, IconButton, Input, Select} from '../../ui/controls';
import './piano-practice-views.css';
import {restoreFromReference, type SavedGuitarChord} from './save-payload';
import {usePianoPerformanceAudio} from './usePianoPerformanceAudio';
import {GuitarChordStrumHud} from './GuitarChordStrumHud';
import GuitarNeckGuide from '../renderers/GuitarNeckGuide';
import {ContinuousScore} from './ContinuousScore';
import {TimeRoll} from './TimeRoll';
import {buildTimelineLayout} from './timeline-layout';
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
  const [guitarChords, setGuitarChords] = useState<SavedGuitarChord[]>([]);
  const [guitarTone, setGuitarTone] = useState(25);
  const [guitarHandedness, setGuitarHandedness] = useState<'right' | 'left'>('right');
  const [guitarStage, setGuitarStage] = useState<'roll' | 'compact'>('roll');
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
        setGuitarChords(restored.value.guitarChords);
        const guitar = restored.value.document.subject === 'guitar';
        setTitle(restored.value.title ?? value.title ?? lessonTitle ?? (guitar ? 'Guitar practice' : 'Piano practice'));
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
    speeds: [0.25, 0.5, 0.75, 1, 1.25],
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
    const mapped = voiceCommandToPractice(command, {rates: [0.25, 0.5, 0.75, 1, 1.25],
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
    pedalSpans, rate: snapshot?.rate ?? 1, volume, guitarProgram: guitarTone,
  });
  const guitar = document?.subject === 'guitar';
  const activeSetup = normalizeGuitarSetup({tuning: document?.guitar_tuning, capo: document?.guitar_capo});
  const guitarFingers = useMemo<Record<string, GuitarFinger>>(() => document?.subject === 'guitar'
    ? assignGuitarFingers(document.performance, activeSetup) : {},
    [document, activeSetup.tuning, activeSetup.capo]);
  const boxes = useMemo(() => document ? layoutMeasures(document).boxes : [], [document]);
  const layout = useMemo(() => document ? buildTimelineLayout(document, 1) : null, [document]);
  const clockTime = useClockTime(practice.clock, playhead);
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
    if (practice.runtime) practice.dispatch({type: 'seek', time: Math.max(0, Math.min(document?.duration ?? value, value))});
    else if (videoRef.current) videoRef.current.currentTime = value;
  }, [practice, document?.duration]);
  const seekOccurrence = useCallback((id: string) => {
    const note = document?.performance.find(item => item.id === id);
    if (note) seek(note.onset + offsetSeconds);
  }, [document, offsetSeconds, seek]);

  const stage = document ? <div className={`ws-stage piano-practice-stage ${!guitar&&practicePanels.length>1?'has-combined-panels':''}`}>
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
        playhead={playhead} hands={hands.assignments} onSeekOccurrence={seekOccurrence} onSeek={seek}/>}
    {!guitar && practicePanels.includes('notes') && <PianoPracticeNotesView document={document} clock={practice.clock}
      alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals} activeIds={activeIds}
      playhead={playhead} hands={hands.assignments} onSeekOccurrence={seekOccurrence} onSeek={seek}/>}
    {!guitar && practicePanels.length === 0 && <p className="piano-practice-empty">
      Choose Notes, Waterfall, or Piano keys from View.
    </p>}
    {guitar && <div className="ws-guitar-practice" data-guitar-practice="true" ref={sharedRef}>
      <GuitarChordStrumHud chords={guitarChords} time={playhead}
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
        cursorFallbackSeconds={playhead} playhead={playhead} offsetSeconds={offsetSeconds}
        activeOccurrenceIds={activeIds} clock={practice.clock} intervals={intervals}
        selectedOccurrenceId={null} reveal={null} rowMode="strings"
        tuning={activeSetup.tuning} capo={activeSetup.capo}
        editingEnabled={false} onSelect={seekOccurrence} onSeek={seek}/>}
      {guitarStage === 'roll' && <ContinuousScore document={document} boxes={boxes}
        selectedOccurrenceId={null} reveal={null} onSelect={seekOccurrence}
        clock={practice.clock} alignment={alignment} offsetSeconds={offsetSeconds} intervals={intervals}
        activeOccurrenceIds={activeIds} layout={layout ?? undefined}
        sharedScrollLeft={sharedScrollLeft} cursorFallbackSeconds={playhead} playheadTick={null}
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
    modeControl={onModeChange&&<ExperienceModeSelector compact current="practice"
      capabilities={experienceModeCapabilitiesFrom(liveCapabilities)}
      onSelect={mode=>onModeChange(experienceModeToLegacy(mode))}/>}
    plan={plan} snapshot={displaySnapshot} capabilities={liveCapabilities} voice={voice} disabled={!snapshot}
    onCommand={dispatchPractice} onSeek={seek} onSelect={index => dispatchPractice({type: 'select', index})}
    autoStartVoice
    status={shellStatus}
    toolsBefore={<>
      {!guitar && <PracticeCheckboxMenu label="View"
        options={[{value:'notes',label:'Notes'},{value:'waterfall',label:'Waterfall'},{value:'keys',label:'Piano keys'}]}
        selected={practicePanels} onToggle={togglePracticePanel}/>}
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
    </>}/>
}
