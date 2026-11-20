/**
 * Editor playback/audio binding for the music workspace.
 *
 * The source media element stays the only authoritative clock. This owner attaches
 * media listeners, exposes transport/seek/rate/volume/audio-mode commands, mirrors
 * time into the shared visual clock, composes the existing Original/Piano source
 * controller and performance-audio hook, and releases everything idempotently.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import type {Asset, MusicPedalSpan} from '../../../../../packages/lesson-schema/index';
import {NotationAudio} from '../notation/notation-audio';
import {usePianoPreviewAsset} from '../usePianoPreviewAsset';
import {usePianoSourcePlayer} from '../usePianoSourcePlayer';
import {createClock, type ClockStore} from './clock';
import {usePianoPerformanceAudio} from './usePianoPerformanceAudio';
import {performanceChanged} from './save-payload';

const PLAYBACK_ERROR = 'The video could not start.';

function hasWebAudioSupport(): boolean {
  if (typeof globalThis.window === 'undefined') return false;
  const scope = globalThis.window as typeof globalThis.window & {webkitAudioContext?: typeof AudioContext};
  return Boolean(globalThis.window.AudioContext || scope.webkitAudioContext);
}

function nowMs(): number {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

export function useMusicEditorPlayback({
  document, offsetSeconds, pedalSpans = [], rawModelDraft = false,
  guitarProgram = 25, enabled = true,
}: {
  document: NotationDocument | null;
  offsetSeconds: number;
  pedalSpans?: MusicPedalSpan[];
  rawModelDraft?: boolean;
  guitarProgram?: number;
  enabled?: boolean;
}) {
  const clockRef = useRef<ClockStore>(createClock());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pianoRef = useRef<HTMLAudioElement | null>(null);
  const emptyPianoRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<NotationAudio | null>(null);
  const [videoNode, setVideoNode] = useState<HTMLVideoElement | null>(null);
  const [pianoNode, setPianoNode] = useState<HTMLAudioElement | null>(null);

  const [videoUrl, setVideoUrlState] = useState<string | null>(null);
  const [previewAsset, setPreviewAssetState] = useState<Asset | null>(null);
  const [previewIdentity, setPreviewIdentityState] = useState('');
  const [previewBaseline, setPreviewBaselineState] = useState<NotationDocument | null>(null);
  const [preferRenderedWav, setPreferRenderedWavState] = useState(false);
  const [audioMode, setAudioModeState] = useState<'original' | 'piano'>('original');
  const [playhead, setPlayheadState] = useState(0);
  const [playing, setPlayingState] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [seekToken, setSeekTokenState] = useState(0);
  const [error, setError] = useState('');

  const preview = usePianoPreviewAsset(previewAsset);
  const hasWebAudio = hasWebAudioSupport();
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

  /** A callback ref, so a host that mounts after an async load is attached too. */
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoNode(node);
  }, []);
  const attachPiano = useCallback((node: HTMLAudioElement | null) => {
    pianoRef.current = node;
    setPianoNode(node);
  }, []);

  const setVideoUrl = useCallback((value: string | null) => setVideoUrlState(value), []);
  const setPreviewAsset = useCallback((value: Asset | null) => setPreviewAssetState(value), []);
  const setPreviewIdentity = useCallback((value: string) => setPreviewIdentityState(value), []);
  const setPreviewBaseline = useCallback((value: NotationDocument | null) => setPreviewBaselineState(value), []);
  const setPreferRenderedWav = useCallback((value: boolean) => setPreferRenderedWavState(value), []);

  /** Initialize the preview identity and its performance baseline from one load. */
  const restorePreview = useCallback((asset: Asset | null, identity: string,
    baseline: NotationDocument | null) => {
    setPreviewAssetState(asset);
    setPreviewIdentityState(identity);
    setPreviewBaselineState(baseline);
  }, []);

  const setAudioMode = useCallback((value: 'original' | 'piano') => {
    setAudioModeState(value === 'piano' ? 'piano' : 'original');
  }, []);

  // The media element is authoritative. This mirror updates the frame-rate clock on
  // every animation frame and the coarse inspector state at a throttled rate.
  useEffect(() => {
    const media = videoNode;
    if (!media) return;
    let frame = 0;
    let lastState = 0;
    const update = (force = false) => {
      frame = 0;
      // The visual clock mirrors every frame; React state stays at 4 Hz so the
      // inspector and document root do not re-render at frame rate.
      clockRef.current.set(media.currentTime);
      const now = nowMs();
      if (force || now - lastState >= 250) {
        lastState = now;
        setPlayheadState(media.currentTime);
        setCurrentTime(media.currentTime);
        setPlayingState(!media.paused && !media.ended);
      }
      if (!media.paused && !media.ended) frame = globalThis.requestAnimationFrame(() => update());
    };
    const refresh = () => {
      if (frame) globalThis.cancelAnimationFrame(frame);
      update(true);
    };
    const events = ['play', 'pause', 'seeked', 'timeupdate', 'ended', 'loadedmetadata'];
    events.forEach(name => media.addEventListener(name, refresh));
    refresh();
    return () => {
      if (frame) globalThis.cancelAnimationFrame(frame);
      events.forEach(name => media.removeEventListener(name, refresh));
    };
  }, [videoNode]);

  useEffect(() => () => {
    audioRef.current?.dispose();
    audioRef.current = null;
  }, []);

  // The existing source-driven controller for a verified WAV preview. Live synthesis
  // has its own source-clock scheduler and must not bind an empty/stale audio element.
  const player = usePianoSourcePlayer(videoRef, livePiano ? emptyPianoRef : pianoRef,
    livePiano ? 'original' : audioMode, offsetSeconds, previewIdentity,
    () => setError('Piano audio is unavailable. The original video keeps playing.'));

  usePianoPerformanceAudio({
    document, videoRef, clock: clockRef.current, livePiano, offsetSeconds,
    pedalSpans, rate, volume, rawModelDraft, guitarProgram, enabled,
  });

  // Audition yields to real playback and to a source-mode change.
  useEffect(() => { if (playing) audioRef.current?.stop(); }, [playing]);
  useEffect(() => {
    if (previewAsset && !preview.url && audioMode === 'piano') setAudioModeState('original');
  }, [previewAsset, preview.url, audioMode]);
  // A controller failure visibly returns the source audio, never a silent Piano.
  useEffect(() => {
    if (!livePiano && player.error && audioMode === 'piano') setAudioModeState('original');
  }, [player.error, audioMode, livePiano]);
  useEffect(() => { audioRef.current?.stop(); }, [audioMode]);

  const audition = useCallback((pitches: number[], seconds = 0.5, velocity?: number | null) => {
    if (!pitches.length) return;
    audioRef.current ??= new NotationAudio();
    audioRef.current.play(pitches, Math.max(0.12, Math.min(2, seconds)), velocity ?? 0.7);
  }, []);

  const seek = useCallback((seconds: number) => {
    const media = videoRef.current;
    const duration = document?.duration ?? (Number.isFinite(seconds) ? seconds : 0);
    const clamped = Math.max(0, Math.min(duration, Number.isFinite(seconds) ? seconds : 0));
    setPlayheadState(clamped);
    clockRef.current.set(clamped);
    setCurrentTime(clamped);
    setSeekTokenState(token => token + 1);
    if (media) media.currentTime = clamped;
  }, [document?.duration]);

  const play = useCallback(() => {
    const media = videoRef.current;
    if (!media) return;
    setError('');
    const attempt = media.play();
    if (attempt && typeof attempt.catch === 'function') {
      void attempt.catch(() => setError(PLAYBACK_ERROR));
    }
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const toggleTransport = useCallback(() => {
    const media = videoRef.current;
    if (!media) return;
    if (media.paused) play();
    else pause();
  }, [play, pause]);

  const changeRate = useCallback((value: number) => {
    const next = Number.isFinite(value) && value > 0 ? value : 1;
    setRateState(next);
    const media = videoRef.current;
    if (media) media.playbackRate = next;
  }, []);

  const setVolume = useCallback((value: number) => {
    setVolumeState(Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1);
  }, []);

  /** Demo/no-media positioning only; real playback always flows from the media element. */
  const setPlayhead = useCallback((seconds: number) => {
    const duration = document?.duration ?? (Number.isFinite(seconds) ? seconds : 0);
    const clamped = Math.max(0, Math.min(duration, Number.isFinite(seconds) ? seconds : 0));
    setPlayheadState(clamped);
    setCurrentTime(clamped);
    clockRef.current.set(clamped);
  }, [document?.duration]);

  // Keep the source element's rate and shared volume when it (re)mounts or the
  // preview audio element appears.
  useEffect(() => {
    const media = videoRef.current;
    if (media) media.playbackRate = rate;
  }, [rate, videoNode]);
  useEffect(() => {
    const media = videoRef.current;
    if (media) media.volume = volume;
    if (pianoRef.current) pianoRef.current.volume = volume;
  }, [volume, videoNode, pianoNode, previewAsset]);

  return {
    clock: clockRef.current,
    videoRef, pianoRef,
    attachVideo, attachPiano,
    videoNode, hasMediaElement: videoNode !== null,
    videoUrl, setVideoUrl,
    preview, previewAsset, setPreviewAsset, previewIdentity, setPreviewIdentity,
    previewBaseline, setPreviewBaseline, restorePreview,
    previewStale, verifyingPreview, verifiedPreview, useWavPreview, livePiano,
    pianoDisabled, pianoTitle, hasWebAudio,
    preferRenderedWav, setPreferRenderedWav,
    audioMode, setAudioMode,
    playhead, setPlayhead, playing, setPlaying: setPlayingState, currentTime,
    rate, volume, setVolume, seekToken,
    error, setError,
    player,
    audition, seek, play, pause, toggleTransport, changeRate,
  };
}
