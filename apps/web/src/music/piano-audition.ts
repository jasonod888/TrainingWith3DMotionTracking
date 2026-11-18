/** Shared synthetic preview voice. Held notes remain audible through their displayed span.
 * This is a duration-monitoring audition, not a calibrated acoustic-piano renderer.
 */
import {
  grandPianoPartials, pitchRegisterGain, pitchVelocityCutoff, velocityDecay, velocityGain, velocityValue,
} from './music-velocity';
import {getSampleBuffer} from './piano-sampler';

export type EnvelopePoint = {time: number; gain: number};
export type PianoVoice = {
  oscillator: OscillatorNode;
  gain: GainNode;
  stop?: () => void;
  releaseAt?: (time: number, fadeSeconds?: number) => void;
};
const SILENCE = 0.0001;
const HELD_FRACTION = 0.18;

export function auditionEnvelope(duration: number, pitch: number, velocity?: number | null): EnvelopePoint[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const level = velocityGain(velocity);
  const release = Math.min(.04, duration * .2);
  const heldUntil = duration - release;
  // Harder strikes speak marginally faster; both remain safely inside the note.
  const attack = Math.min(velocityValue(velocity) >= .75 ? .004 : .008, heldUntil * .25);
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

/** Continuous acoustic string decay with a felt-damper release, no HELD floor. */
export function grandPianoEnvelope(duration: number, pitch: number, velocity?: number | null,
  dampedByKey = true): EnvelopePoint[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const level = velocityGain(velocity) * pitchRegisterGain(pitch);
  const release = dampedByKey ? Math.min(0.16, duration * 0.35) : Math.min(0.28, duration * 0.4);
  // Keep a minimum held body while preserving the full damper-release tail.
  const heldUntil = Math.max(duration * 0.2, duration - release);
  const attack = Math.min(velocityValue(velocity) >= 0.75 ? 0.0035 : 0.006, heldUntil * 0.18);
  const bloomEnd = Math.min(0.11, heldUntil * 0.35);
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);
  const tau = Math.max(0.55, Math.min(3.4, 1.55 * Math.pow(220 / Math.max(1, f0), 0.55)));
  const heldGain = Math.max(SILENCE * 2,
    level * 0.28 * Math.exp(-Math.max(0, heldUntil - bloomEnd) / tau));
  const points: EnvelopePoint[] = [
    {time: 0, gain: SILENCE},
    {time: attack, gain: level},
    {time: bloomEnd, gain: level * 0.28},
  ];
  if (heldUntil - bloomEnd > 0.25) {
    const midTime = bloomEnd + (heldUntil - bloomEnd) * 0.5;
    points.push({time: midTime,
      gain: Math.max(SILENCE * 2, level * 0.28 * Math.exp(-(midTime - bloomEnd) / tau))});
  }
  points.push({time: heldUntil, gain: heldGain}, {time: duration, gain: SILENCE});
  // Keep automation strictly ordered even for pathological tiny durations.
  for (let index = 1; index < points.length; index += 1) {
    if (!(points[index].time > points[index - 1].time)) {
      points[index].time = points[index - 1].time + 1e-5;
    }
    points[index].gain = Math.max(SILENCE, Math.min(1, points[index].gain));
  }
  return points;
}

export function envelopeGainAt(points: EnvelopePoint[], time: number): number {
  if (!points.length) return SILENCE;
  if (time <= 0) return points[0].gain;
  for (let i = 1; i < points.length; i++) {
    const right = points[i], left = points[i - 1];
    if (time <= right.time) {
      if (time === right.time) return right.gain;
      const fraction = (time - left.time) / (right.time - left.time);
      return left.gain * (right.gain / left.gain) ** fraction;
    }
  }
  return points[points.length - 1].gain;
}

export function schedulePianoVoice(context: BaseAudioContext, destination: AudioNode, note: {
  pitch: number; velocity?: number | null; duration: number; startTime: number;
  elapsed?: number; windowSeconds?: number; unison?: boolean;
  acousticDecay?: boolean; dampedByKey?: boolean;
}): PianoVoice | null {
  const elapsed = Math.max(0, note.elapsed ?? 0);
  const length = Math.min(note.duration - elapsed, note.windowSeconds ?? Infinity);
  if (!Number.isFinite(length) || length <= 0 || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) return null;
  if (note.acousticDecay && typeof (context as AudioContext).createBufferSource === 'function') {
    const sampled = getSampleBuffer(context, note.pitch);
    if (sampled) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const panner = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
      source.buffer = sampled.buffer;
      source.playbackRate.value = Math.pow(2, (note.pitch - sampled.sampleMidi) / 12);
      const level = Math.max(SILENCE * 2, Math.min(1, velocityGain(note.velocity) * 2.2));
      const release = (note.dampedByKey ?? true) ? Math.min(0.16, length * 0.35) : Math.min(0.32, length * 0.4);
      const fadeStart = Math.max(0.005, length - release);
      const start = note.startTime;
      const attackEnd = start + (elapsed > 0 ? 0.006 : 0.002);
      const end = start + length;
      gain.gain.setValueAtTime(SILENCE, start);
      gain.gain.exponentialRampToValueAtTime(level, attackEnd);
      const holdAt = Math.min(end - 0.001, Math.max(attackEnd + 0.001, start + fadeStart));
      if (holdAt > attackEnd) gain.gain.setValueAtTime(level, holdAt);
      gain.gain.exponentialRampToValueAtTime(SILENCE, end);
      source.connect(gain);
      if (panner) {
        panner.pan.value = Math.max(-0.35, Math.min(0.35, ((note.pitch - 60) / 44) * 0.35));
        gain.connect(panner).connect(destination);
      } else {
        gain.connect(destination);
      }
      const offset = Math.min(elapsed, Math.max(0, sampled.buffer.duration - 0.02));
      source.start(start, offset);
      source.stop(end + 0.01);
      const disconnect = () => {
        try { source.disconnect(); } catch { /* disconnected */ }
        try { gain.disconnect(); } catch { /* disconnected */ }
        try { panner?.disconnect(); } catch { /* disconnected */ }
      };
      source.onended = disconnect;
      return {
        oscillator: source as unknown as OscillatorNode,
        gain,
        stop: () => {
          try { source.stop(); } catch { /* already stopped */ }
          disconnect();
        },
        releaseAt: (time, fadeSeconds = .015) => {
          const at = Math.max(start, time);
          const fade = Math.max(.003, fadeSeconds);
          try { gain.gain.cancelScheduledValues?.(at); } catch { /* unsupported */ }
          try { gain.gain.setValueAtTime(level, at); } catch { /* already ended */ }
          try { gain.gain.exponentialRampToValueAtTime(SILENCE, at + fade); } catch { /* already ended */ }
          try { source.stop(at + fade + 0.01); } catch { /* already stopping */ }
        },
      };
    }
  }
  const points = note.acousticDecay
    ? grandPianoEnvelope(note.duration, note.pitch, note.velocity, note.dampedByKey ?? true)
    : auditionEnvelope(note.duration, note.pitch, note.velocity);
  const oscillator = context.createOscillator(), gain = context.createGain(), filter = context.createBiquadFilter();
  const partials = grandPianoPartials(note.pitch, note.velocity);
  const wave = context.createPeriodicWave(new Float32Array([0, ...partials]), new Float32Array(partials.length + 1));
  oscillator.setPeriodicWave(wave);
  oscillator.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
  filter.type = 'lowpass';
  filter.frequency.value = pitchVelocityCutoff(note.pitch, note.velocity);
  filter.Q.value = .7;
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
  // A full browser AudioContext gets a gently detuned unison string and a hammer
  // transient. The minimal test doubles intentionally provide neither capability.
  const fullSynthesis = typeof (context as AudioContext).createStereoPanner === 'function';
  if (fullSynthesis) {
    const attackCutoff = pitchVelocityCutoff(note.pitch, note.velocity);
    const f0 = oscillator.frequency.value;
    const bodyCutoff = Math.max(240,
      Math.min(attackCutoff * 0.42, f0 * (note.pitch >= 72 ? 1.75 : 2.4)));
    const tailCutoff = Math.max(200, Math.min(bodyCutoff, f0 * 1.35));
    if (typeof filter.frequency.setValueAtTime === 'function'
      && typeof filter.frequency.exponentialRampToValueAtTime === 'function') {
      filter.frequency.setValueAtTime(attackCutoff, note.startTime);
      filter.frequency.exponentialRampToValueAtTime(bodyCutoff,
        note.startTime + Math.min(0.24, length * 0.5));
      filter.frequency.exponentialRampToValueAtTime(tailCutoff, note.startTime + length);
    }
  }
  const panner = fullSynthesis ? context.createStereoPanner() : null;
  if (panner) {
    panner.pan.value = Math.max(-0.35, Math.min(0.35, ((note.pitch - 60) / 44) * 0.35));
  }
  oscillator.connect(filter).connect(gain);
  if (panner) gain.connect(panner).connect(destination);
  else gain.connect(destination);
  const extraOscillators: OscillatorNode[] = [];
  const extraGains: GainNode[] = [];
  const stopped = {value: false};
  const stopExtra = () => {
    if (stopped.value) return;
    stopped.value = true;
    for (const node of extraOscillators) {
      try { node.stop(); } catch { /* stopped */ }
      try { node.disconnect(); } catch { /* disconnected */ }
    }
    for (const node of extraGains) { try { node.disconnect(); } catch { /* disconnected */ } }
    try { panner?.disconnect(); } catch { /* disconnected */ }
  };
  if (fullSynthesis && note.unison !== false && note.pitch >= 40) {
    const secondary = context.createOscillator();
    secondary.setPeriodicWave(wave);
    secondary.frequency.value = oscillator.frequency.value;
    if (secondary.detune) secondary.detune.value = 0.7;
    const blend = context.createGain();
    blend.gain.value = 0.16;
    secondary.connect(blend).connect(filter);
    secondary.start(note.startTime);
    secondary.stop(note.startTime + length + .005);
    extraOscillators.push(secondary);
    extraGains.push(blend);
  }
  if (fullSynthesis && elapsed <= 1e-6) {
    const hammer = context.createOscillator();
    hammer.type = 'triangle';
    hammer.frequency.value = oscillator.frequency.value;
    const hammerGain = context.createGain();
    const level = Math.min(0.018, 0.003 + velocityValue(note.velocity) * 0.015);
    hammerGain.gain.setValueAtTime(Math.max(.0001, level), note.startTime);
    hammerGain.gain.exponentialRampToValueAtTime(SILENCE, note.startTime + .009);
    hammer.connect(hammerGain).connect(filter);
    hammer.start(note.startTime);
    hammer.stop(note.startTime + .014);
    extraOscillators.push(hammer);
    extraGains.push(hammerGain);
  }
  oscillator.onended = () => {
    stopExtra();
    try { oscillator.disconnect(); } catch { /* disconnected */ }
    try { filter.disconnect(); } catch { /* disconnected */ }
    try { gain.disconnect(); } catch { /* disconnected */ }
  };
  oscillator.start(note.startTime);
  oscillator.stop(note.startTime + length + .005);
  return {oscillator, gain, stop: () => {
    stopExtra();
    try { oscillator.stop(); } catch { /* already stopped */ }
    try { oscillator.disconnect(); } catch { /* disconnected */ }
    try { filter.disconnect(); } catch { /* disconnected */ }
    try { gain.disconnect(); } catch { /* disconnected */ }
  }, releaseAt: (time, fadeSeconds = .015) => {
    const at = Math.max(note.startTime, time);
    const fade = Math.max(.003, fadeSeconds);
    const relative = elapsed + Math.max(0, at - note.startTime);
    const current = Math.max(SILENCE, envelopeGainAt(points, relative));
    try { gain.gain.cancelScheduledValues?.(at); } catch { /* unsupported */ }
    try { gain.gain.setValueAtTime(current, at); } catch { /* already ended */ }
    try { gain.gain.exponentialRampToValueAtTime(SILENCE, at + fade); } catch { /* already ended */ }
    try { oscillator.stop(at + fade + .005); } catch { /* already stopping */ }
    for (const node of extraOscillators) {
      try { node.stop(at + fade + .005); } catch { /* already stopping */ }
    }
    // Let oscillator.onended run stopExtra() after the scheduled fade completes.
  }};
}
