/** Short synthesized audition of the proposed notes around one finding. */
import type {MusicDraftEvent} from '../../../../packages/lesson-schema/index';
import {MASTER_GAIN} from './music-velocity';
import {schedulePianoVoice} from './piano-audition';

const MAX_NOTES = 200;

export function auditionRange(events: MusicDraftEvent[], start: number, end: number, volume = 70): () => void {
  const Ctor = window.AudioContext ?? (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return () => {};
  const relevant = events.filter(note => {
    const noteEnd = note.onset + (note.duration ?? .25);
    return note.onset < end && noteEnd > start;
  }).slice(0, MAX_NOTES);
  const context = new Ctor();
  void context.resume();
  const output = context.createGain();
  output.gain.value = MASTER_GAIN * (volume / 100);
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 8;
  compressor.attack.value = .003;
  compressor.release.value = .25;
  compressor.connect(output).connect(context.destination);
  const scheduled: {oscillator: OscillatorNode; gain: GainNode}[] = [];
  const base = context.currentTime + .05;
  const stopAt = Math.max(.1, end - start) + .4;
  for (const note of relevant) {
    const noteStart = Math.max(start, note.onset);
    const noteEnd = Math.min(end, note.onset + (note.duration ?? .25));
    if (noteEnd <= start || noteStart >= end) continue;
    const begin = base + Math.max(0, noteStart - start);
    const voice = schedulePianoVoice(context, compressor, {pitch: note.pitch, velocity: note.velocity,
      startTime: begin, duration: note.duration ?? .25, elapsed: Math.max(0, start - note.onset),
      windowSeconds: noteEnd - noteStart});
    if (voice) scheduled.push(voice);
  }
  const timer = window.setTimeout(() => {
    for (const item of scheduled) {
      try { item.oscillator.stop(); } catch { /* already stopped */ }
      try { item.gain.disconnect(); } catch { /* disconnected */ }
    }
    void context.close().catch(() => {});
  }, (stopAt + .2) * 1000);
  return () => {
    window.clearTimeout(timer);
    for (const item of scheduled) {
      try { item.oscillator.stop(); } catch { /* already stopped */ }
      try { item.gain.disconnect(); } catch { /* disconnected */ }
    }
    void context.close().catch(() => {});
  };
}
