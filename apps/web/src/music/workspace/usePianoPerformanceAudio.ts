import {useEffect, useMemo, useRef, useState, type RefObject} from 'react';
import type {NotationDocument} from '../../../../../packages/music-notation/index.ts';
import type {MusicPedalSpan} from '../../../../../packages/lesson-schema/index';
import {NotationAudio} from '../notation/notation-audio';
import {MidiPlayerEngine} from '../midi-player';
import {exportPerformanceToMidi} from '../midi-export';
import {resolvePerformanceAudibleTimings, shiftOnset} from '../piano-playback';

/**
 * Proven piano performance playback, extracted from the review workspace:
 * source-clocked live grand synthesis with pedal/velocity, a MIDI engine fallback,
 * onset-zero attack, held-note seek behaviour and source/WAV volume.
 */
export function usePianoPerformanceAudio({
  document, videoRef, clock, livePiano, offsetSeconds, pedalSpans, rate, volume, rawModelDraft = false,
  guitarProgram = 25, enabled = true,
}: {
  document: NotationDocument | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  clock: {get: () => number};
  livePiano: boolean;
  offsetSeconds: number;
  pedalSpans: MusicPedalSpan[];
  rate: number;
  volume: number;
  rawModelDraft?: boolean;
  /** General MIDI guitar program used when the document is a guitar lesson. */
  guitarProgram?: number;
  /** False during a muted reference capture or challenge. */
  enabled?: boolean;
}) {
  const liveAudio = useRef<NotationAudio | null>(null);
  const midiPlayer = useRef<MidiPlayerEngine | null>(null);
  const liveMuted = useRef<boolean | null>(null);
  const userMuted = useRef<boolean | null>(null);
  const [midiReady, setMidiReady] = useState(false);
  const [error, setError] = useState('');
  const audibleTimings = useMemo(() => document
    ? resolvePerformanceAudibleTimings(document.performance, pedalSpans) : new Map(),
    [document, pedalSpans]);
  const guitar = document?.subject === 'guitar';
  const midiBytes = useMemo(() => document
    ? exportPerformanceToMidi(document.performance, pedalSpans, {
        subject: document.subject, program: document.subject === 'guitar' ? guitarProgram : 0,
      }) : null,
    [document, pedalSpans, guitarProgram]);

  useEffect(() => {
    if (!livePiano || !enabled) { midiPlayer.current?.stop(); return; }
    if (!MidiPlayerEngine.isSupported()) { setMidiReady(false); return; }
    let disposed = false;
    const player = midiPlayer.current ??= new MidiPlayerEngine();
    void player.init().then(ok => { if (!disposed) setMidiReady(ok); }).catch(() => { if (!disposed) setError('Piano synthesis could not start.'); });
    return () => { disposed = true; };
  }, [livePiano, enabled]);

  useEffect(() => {
    if (!midiBytes || !midiPlayer.current) return;
    try {
      midiPlayer.current.loadMidi(midiBytes, Math.max(0,
        (videoRef.current?.currentTime ?? clock.get()) - offsetSeconds));
    } catch { setError('Piano synthesis could not load this performance.'); }
  }, [midiBytes, midiReady, offsetSeconds, clock, videoRef]);

  useEffect(() => {
    if (!livePiano || !midiReady || !enabled) return;
    const player = midiPlayer.current;
    const media = videoRef.current;
    if (!player || !media) return;
    let stalled = false;
    const sync = (forceSeek: boolean) => {
      player.setVolume(media.volume);
      player.syncTransport({
        playing: !media.paused && !media.ended && !media.seeking && !stalled && media.readyState >= 2,
        currentTime: media.currentTime,
        rate: media.playbackRate || rate,
        offsetSeconds,
        forceSeek,
      });
    };
    const handlers: [string, () => void][] = [
      ['play', () => sync(false)], ['pause', () => sync(false)],
      ['seeking', () => sync(true)], ['seeked', () => sync(true)],
      ['ratechange', () => sync(false)], ['volumechange', () => sync(false)],
      ['waiting', () => { stalled = true; sync(false); }],
      ['playing', () => { stalled = false; sync(false); }],
    ];
    for (const [name, handler] of handlers) media.addEventListener(name, handler);
    sync(false);
    const timer = globalThis.setInterval(() => sync(false), 250);
    return () => {
      globalThis.clearInterval(timer);
      for (const [name, handler] of handlers) media.removeEventListener(name, handler);
    };
  }, [livePiano, midiReady, offsetSeconds, rate, videoRef, enabled]);

  // Track the learner's own mute choice while Original owns the video.
  useEffect(() => {
    if (livePiano) return;
    const media = videoRef.current;
    if (!media) return;
    userMuted.current = media.muted;
    const update = () => { userMuted.current = media.muted; };
    media.addEventListener('volumechange', update);
    return () => media.removeEventListener('volumechange', update);
  }, [livePiano, videoRef]);

  useEffect(() => {
    if (!livePiano) return;
    const media = videoRef.current;
    if (!media) return;
    if (liveMuted.current === null) liveMuted.current = userMuted.current ?? media.muted;
    media.muted = true;
    return () => {
      if (liveMuted.current !== null) media.muted = liveMuted.current;
      liveMuted.current = null;
    };
  }, [livePiano, videoRef]);

  useEffect(() => {
    const media = videoRef.current;
    const audio = liveAudio.current ??= new NotationAudio(1.15);
    audio.setVolume(enabled ? volume : 0);
    if (!enabled) audio.stop();
    if (media) media.volume = volume;
  }, [volume, videoRef, livePiano, enabled]);

  // Live synthesis is source-clocked and only runs when the MIDI engine is not
  // already providing playback, matching the review workspace. Guitar always uses
  // the SoundFont engine so its string channels keep the chosen guitar tone.
  useEffect(() => {
    if (!livePiano || !document || midiReady || guitar || !enabled) return;
    const media = videoRef.current;
    const audio = liveAudio.current ??= new NotationAudio(1.15);
    const triggered = new Set<string>();
    let frame = 0;
    let initialPass = true;
    let stalled = false;
    const sourceTime = () => media && Number.isFinite(media.currentTime) ? media.currentTime : clock.get();
    let lastTime = sourceTime();
    const syncVolume = () => audio.setVolume(media ? media.volume : volume);
    syncVolume();
    const isGhost = (duration: number, velocity: number | null | undefined) =>
      duration < 0.035 || (duration < 0.06 && (velocity ?? 0.5) < 0.35);
    const stopVoices = () => { audio.stop(); triggered.clear(); initialPass = true; lastTime = sourceTime(); };
    const nextRawOnset = new Map<string, number>();
    if (rawModelDraft) {
      const byPitch = new Map<number, {id: string; onset: number}[]>();
      for (const note of document.performance) {
        if (isGhost(note.duration ?? 0.25, note.velocity)) continue;
        const list = byPitch.get(note.pitch) ?? [];
        list.push({id: note.id, onset: note.onset});
        byPitch.set(note.pitch, list);
      }
      for (const list of byPitch.values()) {
        list.sort((left, right) => left.onset - right.onset || left.id.localeCompare(right.id));
        for (let index = 0; index + 1 < list.length; index += 1) nextRawOnset.set(list[index].id, list[index + 1].onset);
      }
    }
    const scheduleAt = () => {
      const now = sourceTime();
      const windowFrom = initialPass ? now - 0.04 : Math.min(lastTime, now) - 0.04;
      const windowTo = now + 0.12;
      for (const note of document.performance) {
        if (triggered.has(note.id)) continue;
        const rawDuration = note.duration ?? 0.25;
        if (rawModelDraft && isGhost(rawDuration, note.velocity)) continue;
        let duration = rawDuration;
        let dampedByKey = true;
        if (!rawModelDraft && pedalSpans.length > 0) {
          const timing = audibleTimings.get(note.id);
          duration = timing?.soundingDuration ?? rawDuration;
          dampedByKey = timing?.dampedByKey ?? true;
        } else if (rawModelDraft) {
          const nextOnset = nextRawOnset.get(note.id);
          if (nextOnset !== undefined && nextOnset > note.onset && nextOnset < note.onset + rawDuration) duration = nextOnset - note.onset;
          const pedaled = pedalSpans.some(span => {
            const start = (span as MusicPedalSpan & {start?: number}).start ?? span.onset;
            const end = (span as MusicPedalSpan & {end?: number}).end ?? span.offset;
            return start <= note.onset && note.onset <= end;
          });
          dampedByKey = pedalSpans.length > 0 ? !pedaled && rawDuration < 1.2 : rawDuration < 1.2;
        }
        const start = shiftOnset(note.onset, offsetSeconds);
        const end = start + duration;
        if (initialPass) {
          if (start < now - 0.04 && now < end) {
            triggered.add(note.id);
            audio.playScheduledNote({pitch: note.pitch, velocity: note.velocity, duration: duration / rate,
              elapsed: (now - start) / rate, windowSeconds: (end - now) / rate, dampedByKey});
          } else if (start >= now - 0.04 && start <= windowTo) {
            triggered.add(note.id);
            audio.playScheduledNote({pitch: note.pitch, velocity: note.velocity, duration: duration / rate,
              delaySeconds: Math.max(0, (start - now) / rate), dampedByKey});
          }
        } else if (start >= windowFrom && start <= windowTo) {
          triggered.add(note.id);
          audio.playScheduledNote({pitch: note.pitch, velocity: note.velocity, duration: duration / rate,
            delaySeconds: Math.max(0, (start - now) / rate), dampedByKey});
        }
      }
      initialPass = false;
      lastTime = now;
    };
    const tick = () => {
      if (frame) return;
      if (stalled || !media || media.paused || media.ended || media.seeking || media.readyState < 2) {
        stopVoices();
        return;
      }
      scheduleAt();
      frame = requestAnimationFrame(() => { frame = 0; tick(); });
    };
    const reset = () => { if (frame) cancelAnimationFrame(frame); frame = 0; stopVoices(); };
    const onSeeked = () => { reset(); if (media && !media.paused && !media.ended) tick(); };
    const onRate = () => reset();
    const onEnded = () => reset();
    const listeners: [string, () => void][] = [
      ['play', () => { stalled = false; tick(); }],
      ['playing', () => { stalled = false; tick(); }],
      ['timeupdate', tick],
      ['seeking', reset],
      ['seeked', onSeeked],
      ['pause', reset],
      ['waiting', () => { stalled = true; reset(); }],
      ['ended', onEnded],
      ['ratechange', onRate],
      ['volumechange', syncVolume],
    ];
    if (media) for (const [name, handler] of listeners) media.addEventListener(name, handler);
    if (media && !media.paused && !media.ended) tick();
    return () => {
      reset();
      if (media) for (const [name, handler] of listeners) media.removeEventListener(name, handler);
    };
  }, [livePiano, midiReady, document, offsetSeconds, pedalSpans, audibleTimings, rate, rawModelDraft, videoRef, clock, volume, guitar, enabled]);

  useEffect(() => () => {
    liveAudio.current?.dispose();
    liveAudio.current = null;
    midiPlayer.current?.dispose();
    midiPlayer.current = null;
  }, []);

  return {midiReady, error};
}
