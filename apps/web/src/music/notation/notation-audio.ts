/** Small, allocation-light piano audition for score editing. No samples or network. */
import {MASTER_GAIN, velocityCutoff, velocityDecay, velocityGain, velocityPartials} from '../music-velocity';

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
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      const partials = velocityPartials(velocity);
      oscillator.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, ...partials]), new Float32Array(partials.length + 1)));
      oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
      filter.type = 'lowpass';
      filter.frequency.value = velocityCutoff(velocity);
      filter.Q.value = 0.7;
      const level = velocityGain(velocity);
      const decay = Math.min(length, Math.max(0.08, velocityDecay(velocity)));
      gain.gain.setValueAtTime(0.0001, base);
      gain.gain.exponentialRampToValueAtTime(level, base + 0.008);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * 0.45), base + decay);
      gain.gain.exponentialRampToValueAtTime(0.0001, base + length);
      oscillator.connect(filter).connect(gain).connect(output);
      oscillator.start(base);
      oscillator.stop(base + length + 0.02);
      this.voices.push({oscillator, gain});
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
