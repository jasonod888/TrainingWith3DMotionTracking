/** Salamander Grand Piano sample-bank discovery and per-context decode cache. */

type Sample = { midi: number; name: string };

export const SALAMANDER_SAMPLES: readonly Sample[] = [
  {midi: 21, name: 'A0'}, {midi: 24, name: 'C1'}, {midi: 27, name: 'Ds1'},
  {midi: 30, name: 'Fs1'}, {midi: 33, name: 'A1'}, {midi: 36, name: 'C2'},
  {midi: 39, name: 'Ds2'}, {midi: 42, name: 'Fs2'}, {midi: 45, name: 'A2'},
  {midi: 48, name: 'C3'}, {midi: 51, name: 'Ds3'}, {midi: 54, name: 'Fs3'},
  {midi: 57, name: 'A3'}, {midi: 60, name: 'C4'}, {midi: 63, name: 'Ds4'},
  {midi: 66, name: 'Fs4'}, {midi: 69, name: 'A4'}, {midi: 72, name: 'C5'},
  {midi: 75, name: 'Ds5'}, {midi: 78, name: 'Fs5'}, {midi: 81, name: 'A5'},
  {midi: 84, name: 'C6'}, {midi: 87, name: 'Ds6'}, {midi: 90, name: 'Fs6'},
  {midi: 93, name: 'A6'}, {midi: 96, name: 'C7'}, {midi: 99, name: 'Ds7'},
  {midi: 102, name: 'Fs7'}, {midi: 105, name: 'A7'}, {midi: 108, name: 'C8'},
];

type SampleState = {
  buffers: Map<string, AudioBuffer>;
  pending: Map<string, Promise<void>>;
};

const states = new WeakMap<BaseAudioContext, SampleState>();
const stateFor = (context: BaseAudioContext): SampleState => {
  let state = states.get(context);
  if (!state) {
    state = {buffers: new Map(), pending: new Map()};
    states.set(context, state);
  }
  return state;
};

const urlFor = (sample: Sample) => `/audio/salamander/${sample.name}.mp3`;

export function nearestSampleForPitch(pitch: number): { midi: number; url: string } {
  const target = Number.isFinite(pitch) ? Math.round(pitch) : 60;
  let nearest = SALAMANDER_SAMPLES[0];
  for (const sample of SALAMANDER_SAMPLES) {
    if (Math.abs(sample.midi - target) < Math.abs(nearest.midi - target)) nearest = sample;
  }
  return {midi: nearest.midi, url: urlFor(nearest)};
}

export function getSampleBuffer(context: BaseAudioContext, pitch: number):
  { buffer: AudioBuffer; sampleMidi: number } | null {
  const nearest = nearestSampleForPitch(pitch);
  const state = stateFor(context);
  const cached = state.buffers.get(nearest.url);
  if (cached) return {buffer: cached, sampleMidi: nearest.midi};
  if (state.pending.has(nearest.url)) return null;
  const decoder = (context as AudioContext).decodeAudioData;
  if (typeof fetch !== 'function' || typeof decoder !== 'function') return null;
  const pending = fetch(nearest.url)
    .then(response => {
      if (!response.ok) throw new Error(`Piano sample request failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then(data => decoder.call(context, data))
    .then(buffer => { state.buffers.set(nearest.url, buffer); })
    .catch(() => { /* keep the synthesis fallback available */ })
    .finally(() => { state.pending.delete(nearest.url); });
  state.pending.set(nearest.url, pending);
  return null;
}

export function preloadPianoSamples(context: BaseAudioContext): void {
  const middle = SALAMANDER_SAMPLES.filter(sample => sample.midi >= 48 && sample.midi <= 84);
  const rest = SALAMANDER_SAMPLES.filter(sample => sample.midi < 48 || sample.midi > 84);
  for (const sample of [...middle, ...rest]) getSampleBuffer(context, sample.midi);
}
