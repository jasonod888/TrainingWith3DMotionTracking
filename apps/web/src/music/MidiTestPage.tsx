import {useEffect, useRef, useState} from 'react';
import {Sequencer, WorkletSynthesizer} from 'spessasynth_lib';

const MIDI_URL = '/audio/kong-piano-riverflow.mid';
const SOUNDFONT_URL = '/audio/FluidR3.sf3';

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export function MidiTestPage() {
  const contextRef = useRef<AudioContext | null>(null);
  const synthRef = useRef<WorkletSynthesizer | null>(null);
  const sequencerRef = useRef<Sequencer | null>(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    const start = async () => {
      try {
        if (typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
          throw new Error('This browser does not support AudioWorklet.');
        }
        const context = new AudioContext();
        contextRef.current = context;
        await context.audioWorklet.addModule('/audio/spessasynth_processor.min.js');
        const [soundFontResponse, midiResponse] = await Promise.all([
          fetch(SOUNDFONT_URL), fetch(MIDI_URL),
        ]);
        if (!soundFontResponse.ok) throw new Error(`SoundFont request failed (${soundFontResponse.status}).`);
        if (!midiResponse.ok) throw new Error(`MIDI request failed (${midiResponse.status}).`);
        const [soundFont, midi] = await Promise.all([
          soundFontResponse.arrayBuffer(), midiResponse.arrayBuffer(),
        ]);
        if (disposed) return;
        const synth = new WorkletSynthesizer(context);
        synth.connect(context.destination);
        await synth.soundBankManager.addSoundBank(soundFont, 'main');
        await synth.isReady;
        synth.programChange(0, 0);
        const sequencer = new Sequencer(synth, {skipToFirstNoteOn: false});
        sequencer.loopCount = 0;
        sequencer.eventHandler.addEvent('songChange', 'midi-test', () => {
          if (disposed) return;
          const nextDuration = Number(sequencer.duration);
          if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration);
          setStatus('ready');
        });
        sequencer.loadNewSongList([{binary: midi}]);
        const nextDuration = Number(sequencer.duration);
        if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration);
        setStatus('ready');
        synthRef.current = synth;
        sequencerRef.current = sequencer;
        timer = globalThis.setInterval(() => {
          if (disposed) return;
          const sequencerNow = sequencerRef.current;
          if (!sequencerNow) return;
          setCurrentTime(sequencerNow.currentTime);
          const next = Number(sequencerNow.duration);
          if (Number.isFinite(next) && next > 0) setDuration(next);
          if (sequencerNow.paused) setPlaying(false);
        }, 250);
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : 'Could not start MIDI playback.');
        setStatus('error');
      }
    };
    void start();
    return () => {
      disposed = true;
      if (timer) globalThis.clearInterval(timer);
      const sequencer = sequencerRef.current;
      if (sequencer && !sequencer.paused) sequencer.pause();
      synthRef.current?.stopAll(true);
      void contextRef.current?.close().catch(() => {});
      contextRef.current = null;
      synthRef.current = null;
      sequencerRef.current = null;
    };
  }, []);

  const play = () => {
    const sequencer = sequencerRef.current;
    const context = contextRef.current;
    if (!sequencer || !context) return;
    void context.resume().catch(() => {});
    sequencer.play();
    setPlaying(true);
  };
  const pause = () => {
    sequencerRef.current?.pause();
    setPlaying(false);
  };
  const stop = () => {
    const sequencer = sequencerRef.current;
    sequencer?.pause();
    if (sequencer) sequencer.currentTime = 0;
    synthRef.current?.stopAll(true);
    setCurrentTime(0);
    setPlaying(false);
  };
  const seek = (value: number) => {
    const sequencer = sequencerRef.current;
    if (!sequencer) return;
    sequencer.currentTime = Math.max(0, Math.min(duration, value));
    setCurrentTime(sequencer.currentTime);
  };

  return <main style={{
    minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
    boxSizing: 'border-box', background: '#f3f1e9', color: '#24352b',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  }}>
    <section style={{
      width: 'min(560px, 100%)', padding: 28, borderRadius: 18, background: '#fffdf8',
      border: '1px solid #ddd8ca', boxShadow: '0 12px 40px #23352b18',
    }}>
      <h1 style={{margin: '0 0 8px', fontSize: 24}}>Standalone MIDI Playback Test</h1>
      <p style={{margin: '0 0 20px', lineHeight: 1.5, color: '#5b685f'}}>
        Plays /audio/kong-piano-riverflow.mid with /audio/FluidR3.sf3 directly
        (no waterfall, sheet, or video sync).
      </p>
      <p role="status" style={{margin: '0 0 14px', fontWeight: 600}}>
        {status === 'loading' || status === 'error'
          ? status === 'error' ? `Error: ${error}` : 'Loading SoundFont & MIDI...'
          : `Ready (${duration.toFixed(2)}s)`}
      </p>
      <div style={{display: 'flex', gap: 8, marginBottom: 16}}>
        <button type="button" onClick={playing ? pause : play}
          disabled={status !== 'ready'}
          style={{minWidth: 88, minHeight: 40, borderRadius: 9, border: 0,
            background: '#24543a', color: '#fff', fontWeight: 650}}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={stop} disabled={status !== 'ready'}
          style={{minWidth: 76, minHeight: 40, borderRadius: 9, border: '1px solid #d4d0c4',
            background: '#fff', color: '#24352b', fontWeight: 600}}>Stop</button>
      </div>
      <input type="range" min={0} max={Math.max(0.001, duration)} step={0.01}
        value={Math.min(currentTime, Math.max(0.001, duration))}
        disabled={status !== 'ready'} onChange={event => seek(Number(event.target.value))}
        aria-label="MIDI seek" style={{width: '100%'}}/>
      <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 6,
        fontVariantNumeric: 'tabular-nums', fontSize: 13, color: '#5b685f'}}>
        <span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span>
      </div>
    </section>
  </main>;
}
