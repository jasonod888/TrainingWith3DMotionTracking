/** SoundFont-backed MIDI playback through spessasynth's AudioWorklet sequencer. */
import {Sequencer, WorkletSynthesizer} from 'spessasynth_lib';

export class MidiPlayerEngine {
  context: AudioContext | null = null;
  masterGain: GainNode | null = null;
  synth: WorkletSynthesizer | null = null;
  sequencer: Sequencer | null = null;
  ready = false;
  initPromise: Promise<boolean> | null = null;
  pendingMidi: {bytes: Uint8Array; time?: number} | null = null;
  volume = 1;
  private lastRate = 1;
  private lastSeekAt = 0;
  private pendingSeekTime: number | null = null;
  private loadedBytes: Uint8Array | null = null;
  private songLoaded = false;

  static isSupported(): boolean {
    return typeof window !== 'undefined'
      && typeof (window.AudioContext
        || (window as unknown as {webkitAudioContext?: unknown}).webkitAudioContext) === 'function'
      && typeof AudioWorkletNode === 'function'
      && typeof fetch === 'function';
  }

  async init(): Promise<boolean> {
    if (!MidiPlayerEngine.isSupported()) return false;
    if (this.initPromise) return this.initPromise;
    const promise = (async () => {
      try {
        const Ctor = window.AudioContext
          ?? (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
        const context = new Ctor();
        this.context = context;
        const masterGain = context.createGain();
        masterGain.gain.value = this.volume * 1.15;
        masterGain.connect(context.destination);
        this.masterGain = masterGain;
        await context.audioWorklet.addModule('/audio/spessasynth_processor.min.js');
        const response = await fetch('/audio/FluidR3.sf3');
        if (!response.ok) throw new Error(`SoundFont request failed: ${response.status}`);
        const soundBank = await response.arrayBuffer();
        const synth = new WorkletSynthesizer(context);
        synth.connect(masterGain);
        await synth.soundBankManager.addSoundBank(soundBank, 'main');
        await synth.isReady;
        synth.programChange(0, 0);
        const sequencer = new Sequencer(synth, {skipToFirstNoteOn: false});
        sequencer.loopCount = 0;
        sequencer.eventHandler.addEvent('songChange', 'workspace-song-change', () => {
          this.songLoaded = true;
          if (this.pendingSeekTime !== null) {
            sequencer.currentTime = Math.max(0, this.pendingSeekTime);
            this.pendingSeekTime = null;
            this.lastSeekAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
          }
        });
        this.synth = synth;
        this.sequencer = sequencer;
        this.ready = true;
        if (this.pendingMidi) {
          const pending = this.pendingMidi;
          this.pendingMidi = null;
          this.loadMidi(pending.bytes, pending.time);
        }
        return true;
      } catch (error) {
        this.ready = false;
        console.warn('[MidiPlayerEngine] init failed:', error);
        return false;
      }
    })();
    this.initPromise = promise;
    return promise;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    const gain = this.volume * 1.15;
    if (this.masterGain && Math.abs(this.masterGain.gain.value - gain) > 1e-4) {
      this.masterGain.gain.value = gain;
    }
  }

  loadMidi(bytes: Uint8Array, preserveTime?: number): void {
    if (this.ready && this.sequencer && bytes === this.loadedBytes) return;
    if (!this.ready || !this.sequencer) {
      this.pendingMidi = {bytes, time: preserveTime};
      return;
    }
    this.loadedBytes = bytes;
    this.songLoaded = false;
    this.pendingSeekTime = preserveTime !== undefined && Number.isFinite(preserveTime)
      ? Math.max(0, preserveTime) : null;
    this.sequencer.loadNewSongList([{binary: bytes.slice().buffer as ArrayBuffer}]);
    if (!this.sequencer.paused) this.sequencer.pause();
  }

  syncTransport(opts: {
    playing: boolean; currentTime: number; rate: number; offsetSeconds: number; forceSeek?: boolean;
  }): void {
    if (!this.ready || !this.sequencer || !this.context) return;
    if (Math.abs(opts.rate - this.lastRate) > 1e-4) {
      this.sequencer.playbackRate = opts.rate;
      this.lastRate = opts.rate;
    }
    const target = Math.max(0, opts.currentTime - opts.offsetSeconds);
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (opts.playing) {
      void this.context.resume().catch(() => {});
      if (this.sequencer.paused) {
        if (this.songLoaded) {
          this.sequencer.currentTime = target;
          this.lastSeekAt = nowMs;
          this.sequencer.play();
        } else {
          this.pendingSeekTime = target;
          this.sequencer.play();
        }
      } else if (opts.forceSeek
        || (this.songLoaded && nowMs - this.lastSeekAt > 2000
          && Math.abs(this.sequencer.currentTime - target) > 0.25)) {
        this.sequencer.currentTime = target;
        this.lastSeekAt = nowMs;
      }
    } else {
      if (!this.sequencer.paused) this.sequencer.pause();
      if (opts.forceSeek && this.songLoaded) {
        this.sequencer.currentTime = target;
        this.lastSeekAt = nowMs;
      }
    }
  }

  stop(): void {
    if (this.sequencer && !this.sequencer.paused) this.sequencer.pause();
    this.synth?.stopAll(true);
  }

  dispose(): void {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.masterGain = null;
    this.synth = null;
    this.sequencer = null;
    this.ready = false;
    this.initPromise = null;
    this.pendingMidi = null;
    this.volume = 1;
    this.lastRate = 1;
    this.lastSeekAt = 0;
    this.pendingSeekTime = null;
    this.loadedBytes = null;
    this.songLoaded = false;
  }
}
