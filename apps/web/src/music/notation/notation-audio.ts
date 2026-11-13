/** Small, allocation-light piano audition for score editing. No samples or network. */
import {MASTER_GAIN} from '../music-velocity';
import {schedulePianoVoice} from '../piano-audition';

type Voice = {oscillator: OscillatorNode; gain: GainNode};

export class NotationAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
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
    compressor.connect(master).connect(context.destination);
    this.context = context;
    this.master = master;
    master.gain.value = MASTER_GAIN * this.volume;
    return context;
  }

  /** Audition one pitch or a chord. Repeated calls are additive, as on a piano. */
  play(pitches: number[], seconds = 0.55, velocity: number | null = 0.7): void {
    const context = this.ensure();
    if (!context || !pitches.length) return;
    void context.resume().catch(() => {});
    const output = this.context!.createDynamicsCompressor();
    output.threshold.value = -18;
    output.knee.value = 12;
    output.ratio.value = 8;
    output.attack.value = 0.003;
    output.release.value = 0.25;
    output.connect(this.master!);
    const base = context.currentTime + 0.01;
    const length = Math.max(0.12, Math.min(4, seconds));
    for (const pitch of pitches) {
      if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) continue;
      const voice = schedulePianoVoice(context, output, {pitch, velocity, duration: length, startTime: base});
      if (voice) this.voices.push(voice);
    }
    // Trim finished voices without a timer leak.
    this.voices = this.voices.slice(-64);
  }

  stop(): void {
    for (const voice of this.voices) {
      try { voice.oscillator.stop(); } catch { /* already stopped */ }
      try { voice.gain.disconnect(); } catch { /* already disconnected */ }
    }
    this.voices = [];
  }

  dispose(): void {
    this.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
