/** Standard MIDI Format 0 export from the live NotationDocument performance. */

type MidiNote = {
  id: string;
  pitch: number;
  onset: number;
  duration?: number | null;
  velocity?: number | null;
  /** Guitar TAB string (1 = high E). Ignored for piano. */
  string?: number | null;
};

type MidiPedal = {
  onset?: number;
  offset?: number;
  start?: number;
  end?: number;
  onset_seconds?: number;
  value?: number;
};

type MidiEvent = {tick: number; priority: number; bytes: number[]};

const TICKS_PER_SECOND = 960;
const TPQ = 480;
const TEMPO_US = 500000;

const isGhost = (duration: number, velocity: number) =>
  duration < 0.035 || (duration < 0.06 && velocity < 0.35);

const variableLength = (value: number): number[] => {
  let remaining = Math.max(0, Math.round(value));
  const bytes = [remaining & 0x7f];
  while ((remaining >>= 7) > 0) bytes.unshift((remaining & 0x7f) | 0x80);
  return bytes;
};

const eventByte = (tick: number, priority: number, ...bytes: number[]): MidiEvent => ({
  tick: Math.max(0, Math.round(tick)), priority, bytes,
});

/** General MIDI programs the unified music export can name. */
export const GUITAR_GM_PROGRAMS = {
  nylon: 24, steel: 25, jazz: 26, cleanElectric: 27,
} as const;

export type MidiExportOptions = {
  /** General MIDI program; piano defaults to 0, guitar to 25 (steel). */
  program?: number;
  subject?: 'piano' | 'guitar';
};

export function exportPerformanceToMidi(
  notes: ReadonlyArray<MidiNote>,
  pedalSpans?: ReadonlyArray<MidiPedal>,
  options: MidiExportOptions = {},
): Uint8Array {
  const guitar = options.subject === 'guitar';
  const program = Math.max(0, Math.min(127, Math.round(options.program ?? (guitar ? GUITAR_GM_PROGRAMS.steel : 0))));
  const channelFor = (note: MidiNote): number => {
    // One channel per guitar string keeps TAB fingering audible and lets each string
    // hold its own notes; piano keeps the whole performance on channel 0.
    if (!guitar) return 0;
    const string = note.string;
    return Number.isInteger(string) && (string as number) >= 1 && (string as number) <= 6 ? (string as number) - 1 : 0;
  };
  const normalized = notes
    .filter(note => Number.isFinite(note.pitch) && Number.isFinite(note.onset)
      && note.pitch >= 0 && note.pitch <= 127)
    .map(note => ({
      id: note.id,
      pitch: Math.round(note.pitch),
      onset: Math.max(0, note.onset),
      duration: Math.max(0.001, note.duration ?? 0.25),
      velocity: Math.max(0, Math.min(1, note.velocity ?? 0.5)),
      channel: channelFor(note),
    }))
    .filter(note => !isGhost(note.duration, note.velocity));

  // Resolve same-pitch overlaps by capping the earlier note at the next onset.
  const byPitch = new Map<number, typeof normalized>();
  for (const note of normalized) {
    const group = byPitch.get(note.pitch) ?? [];
    group.push(note);
    byPitch.set(note.pitch, group);
  }
  const endById = new Map<string, number>();
  for (const group of byPitch.values()) {
    group.sort((left, right) => left.onset - right.onset || left.id.localeCompare(right.id));
    for (let index = 0; index < group.length; index += 1) {
      const note = group[index];
      const next = group[index + 1];
      const naturalEnd = note.onset + note.duration;
      const end = next && next.onset < naturalEnd ? next.onset : naturalEnd;
      endById.set(note.id, Math.max(note.onset + 1 / TICKS_PER_SECOND, end));
    }
  }

  const trackName = guitar ? 'Guitar' : 'Piano';
  const nameBytes = [...trackName].map(character => character.charCodeAt(0) & 0x7f);
  const events: MidiEvent[] = [
    eventByte(0, 0, 0xff, 0x03, nameBytes.length, ...nameBytes),
    eventByte(0, 1, 0xff, 0x51, 0x03, (TEMPO_US >> 16) & 0xff,
      (TEMPO_US >> 8) & 0xff, TEMPO_US & 0xff),
  ];
  // Guitar spans channels 0..5 (string 1..6), all carrying the chosen guitar program;
  // piano keeps the single grand-piano channel.
  for (const channel of guitar ? [0, 1, 2, 3, 4, 5] : [0]) {
    events.push(eventByte(0, 2, 0xc0 | channel, program));
  }

  for (const note of normalized) {
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
    const onTick = note.onset * TICKS_PER_SECOND;
    const offTick = (endById.get(note.id) ?? note.onset + note.duration) * TICKS_PER_SECOND;
    events.push(eventByte(onTick, 5, 0x90 | note.channel, note.pitch, velocity));
    events.push(eventByte(offTick, 4, 0x80 | note.channel, note.pitch, 0x40));
  }

  for (const span of pedalSpans ?? []) {
    const start = span.onset ?? span.start ?? span.onset_seconds;
    if (start === undefined || !Number.isFinite(start)) continue;
    const end = span.offset ?? span.end;
    if (end !== undefined && Number.isFinite(end)) {
      events.push(eventByte(start * TICKS_PER_SECOND, 3, 0xb0, 64, 127));
      events.push(eventByte(end * TICKS_PER_SECOND, 3, 0xb0, 64, 0));
    } else if (span.value !== undefined && Number.isFinite(span.value)) {
      events.push(eventByte(start * TICKS_PER_SECOND, 3, 0xb0, 64, span.value > 0 ? 127 : 0));
    }
  }

  events.sort((left, right) => left.tick - right.tick || left.priority - right.priority);
  const track: number[] = [];
  let lastTick = 0;
  for (const event of events) {
    track.push(...variableLength(event.tick - lastTick), ...event.bytes);
    lastTick = event.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00,
    0x00, 0x01, (TPQ >> 8) & 0xff, TPQ & 0xff,
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >> 24) & 0xff, (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff, track.length & 0xff,
  ];
  return new Uint8Array([...header, ...track]);
}

export function downloadMidiFile(filename: string, bytes: Uint8Array): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function') return;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], {type: 'audio/midi'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.toLowerCase().endsWith('.mid') ? filename : `${filename}.mid`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
