/** Shared synthetic preview voice. Held notes remain audible through their displayed span.
 * This is a duration-monitoring audition, not a calibrated acoustic-piano renderer.
 */
import {velocityCutoff, velocityDecay, velocityGain, velocityPartials} from './music-velocity';

export type EnvelopePoint = {time: number; gain: number};
export type PianoVoice = {oscillator: OscillatorNode; gain: GainNode};
const SILENCE = 0.0001;
const HELD_FRACTION = 0.18;

export function auditionEnvelope(duration: number, pitch: number, velocity?: number | null): EnvelopePoint[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const level = velocityGain(velocity);
  const release = Math.min(.04, duration * .2);
  const heldUntil = duration - release;
  const attack = Math.min(.008, heldUntil * .25);
  const decayEnd = Math.min(velocityDecay(velocity), heldUntil * .6);
  const timeConstant = Math.max(1.5, Math.min(4, 2.8 + (60 - pitch) * .025));
  const floorAt = decayEnd + timeConstant * Math.log(.45 / HELD_FRACTION);
  const heldGain = level * Math.max(HELD_FRACTION, .45 * Math.exp(-(heldUntil - decayEnd) / timeConstant));
  const points = [{time: 0, gain: SILENCE}, {time: attack, gain: level},
    {time: decayEnd, gain: level * .45}];
  if (floorAt < heldUntil) points.push({time: floorAt, gain: level * HELD_FRACTION});
  points.push({time: heldUntil, gain: heldGain}, {time: duration, gain: SILENCE});
  return points;
}

export function envelopeGainAt(points: EnvelopePoint[], time: number): number {
  if (!points.length) return SILENCE;
  if (time <= 0) return points[0].gain;
  for (let i = 1; i < points.length; i++) {
    const right = points[i], left = points[i - 1];
    if (time <= right.time) {
      const fraction = (time - left.time) / (right.time - left.time);
      return left.gain * (right.gain / left.gain) ** fraction;
    }
  }
  return points[points.length - 1].gain;
}

export function schedulePianoVoice(context: BaseAudioContext, destination: AudioNode, note: {
  pitch: number; velocity?: number | null; duration: number; startTime: number;
  elapsed?: number; windowSeconds?: number;
}): PianoVoice | null {
  const elapsed = Math.max(0, note.elapsed ?? 0);
  const length = Math.min(note.duration - elapsed, note.windowSeconds ?? Infinity);
  if (!Number.isFinite(length) || length <= 0 || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) return null;
  const points = auditionEnvelope(note.duration, note.pitch, note.velocity);
  const oscillator = context.createOscillator(), gain = context.createGain(), filter = context.createBiquadFilter();
  const partials = velocityPartials(note.velocity);
  oscillator.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, ...partials]), new Float32Array(partials.length + 1)));
  oscillator.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
  filter.type = 'lowpass'; filter.frequency.value = velocityCutoff(note.velocity); filter.Q.value = .7;
  // Clip the same full-note envelope, preserving elapsed decay when a range starts mid-note.
  const clipped = elapsed + length < note.duration - 1e-9;
  const fadeStart = clipped ? length - Math.min(.04, length * .2) : length;
  gain.gain.setValueAtTime(envelopeGainAt(points, elapsed), note.startTime);
  for (const point of points) {
    const relative = point.time - elapsed;
    if (relative > 0 && relative < fadeStart) {
      gain.gain.exponentialRampToValueAtTime(point.gain, note.startTime + relative);
    }
  }
  if (clipped) {
    gain.gain.exponentialRampToValueAtTime(envelopeGainAt(points, elapsed + fadeStart), note.startTime + fadeStart);
  }
  gain.gain.exponentialRampToValueAtTime(SILENCE, note.startTime + length);
  oscillator.connect(filter).connect(gain).connect(destination);
  oscillator.onended = () => {oscillator.disconnect(); filter.disconnect(); gain.disconnect();};
  oscillator.start(note.startTime);
  oscillator.stop(note.startTime + length + .005);
  return {oscillator, gain};
}
