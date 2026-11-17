/** Small, allocation-light piano audition for score editing. No samples or network. */
import {MASTER_GAIN} from '../music-velocity';
import {schedulePianoVoice, type PianoVoice} from '../piano-audition';

type ScheduledPianoNote = {
  pitch: number;
  duration: number;
  velocity?: number | null;
  delaySeconds?: number;
  elapsed?: number;
  windowSeconds?: number;
  dampedByKey?: boolean;
};

export type {ScheduledPianoNote};

export class NotationAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: AudioNode | null = null;
  private voices: PianoVoice[] = [];
  private activeByPitch = new Map<number, PianoVoice>();
  private volume = 0.65;

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.context) this.master.gain.value = MASTER_GAIN * this.volume;
  }

  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = window.AudioContext ?? (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Ctor) return null;
    const context = new Ctor();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    // A warm, slightly resonant soundboard stage sits before the shared limiter.
    // The compressor is created once here; play() must never allocate another one.
    let bus: AudioNode = compressor;
    if (typeof context.createBiquadFilter === 'function') {
      const body = context.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = 220;
      body.Q.value = 0.7;
      body.gain.value = 2.8;
      body.connect(compressor);
      bus = body;
    }
    compressor.connect(master).connect(context.destination);
    this.context = context;
    this.master = master;
    this.bus = bus;
    master.gain.value = MASTER_GAIN * this.volume;
    return context;
  }

  /** Audition one pitch or a chord. Repeated calls are additive, as on a piano. */
  play(pitches: number[], seconds = 0.55, velocity: number | null = 0.7): void {
    const context = this.ensure();
    if (!context || !pitches.length) return;
    void context.resume().catch(() => {});
    const base = context.currentTime + 0.01;
    const length = Math.max(0.12, Math.min(4, seconds));
    for (const pitch of pitches) {
      if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) continue;
      const existing = this.activeByPitch.get(pitch);
      if (existing) existing.releaseAt?.(base, 0.015);
      const voice = schedulePianoVoice(context, this.bus!, {
        pitch, velocity, duration: length, startTime: base, unison: true,
        acousticDecay: true, dampedByKey: true,
      });
      if (voice) {
        this.voices.push(voice);
        this.activeByPitch.set(pitch, voice);
      }
    }
    this.voices = this.voices.slice(-96);
  }

  /** Schedule one live transport note on the shared grand-piano bus. */
  playScheduledNote(note: ScheduledPianoNote): PianoVoice | null {
    const context = this.ensure();
    if (!context || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) return null;
    void context.resume().catch(() => {});
    const delay = Math.max(0, Number.isFinite(note.delaySeconds) ? note.delaySeconds! : 0);
    const startTime = context.currentTime + delay;
    const existing = this.activeByPitch.get(note.pitch);
    if (existing) existing.releaseAt?.(startTime, 0.015);
    const voice = schedulePianoVoice(context, this.bus!, {
      pitch: note.pitch,
      velocity: note.velocity,
      duration: Math.max(0.001, note.duration),
      startTime,
      elapsed: note.elapsed,
      windowSeconds: note.windowSeconds,
      unison: true,
      acousticDecay: true,
      dampedByKey: note.dampedByKey ?? true,
    });
    if (voice) {
      this.voices.push(voice);
      this.activeByPitch.set(note.pitch, voice);
    }
    this.voices = this.voices.slice(-128);
    return voice;
  }

  stop(): void {
    for (const voice of this.voices) {
      try { voice.stop?.(); } catch { /* already stopped */ }
      try { voice.oscillator.stop(); } catch { /* already stopped */ }
      try { voice.gain.disconnect(); } catch { /* already disconnected */ }
    }
    this.voices = [];
    this.activeByPitch.clear();
  }

  dispose(): void {
    this.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.bus = null;
  }
}
