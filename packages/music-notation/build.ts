/**
 * Performance-to-score interpretation.
 *
 * The conversion is intentionally conservative: it quantizes to a sixteenth-note
 * grid, groups simultaneous pitches into chords, assigns at most two voices per
 * staff, splits written durations at barlines, and fills the remaining time with
 * rests. The original seconds remain in `performance` and are never overwritten.
 */
import {
  GRID, MAX_EVENTS, MAX_MEASURES, MAX_NOTATION_NOTES, PPQ,
  type BuildOptions, type Measure, type NotationDocument, type NotationEvent,
  type NotationNote, type NotationSegment, type NotationSegmentNote, type PerformanceNote,
  type Tie, type TimeSignature,
} from './types';
import { decomposeTicks, measureCount, measureTicks, snapTick, splitAtMeasures } from './rhythm';
import { accidentalName, displayAccidental, keySignature, parseSpelling, spellPitch } from './spelling';

const DEFAULT_TIME: TimeSignature = { numerator: 4, denominator: 4 };

export function estimateTempo(performance: PerformanceNote[]): number {
  const onsets = [...new Set(performance.map(note => note.onset).filter(value => Number.isFinite(value) && value >= 0))]
    .sort((left, right) => left - right);
  const intervals = onsets.slice(1).map((value, index) => value - onsets[index])
    .filter(value => value >= 0.08 && value <= 2)
    .sort((left, right) => left - right);
  if (intervals.length < 2) return 100;
  const median = intervals[Math.floor(intervals.length / 2)];
  if (!Number.isFinite(median) || median <= 0) return 100;
  // A median 0.25 s attack gap is an eighth note at 120 BPM; 0.5 s is a quarter.
  const candidate = 30 / median;
  const clamped = Math.max(60, Math.min(180, candidate));
  return Math.max(40, Math.min(240, Math.round(clamped / 5) * 5));
}

function copyPerformance(note: PerformanceNote): PerformanceNote {
  return {
    id: note.id,
    onset: note.onset,
    duration: note.duration,
    ...(note.notation_duration != null ? {notation_duration: note.notation_duration} : {}),
    pitch: note.pitch,
    velocity: note.velocity,
    confidence: note.confidence,
    optional: note.optional,
    string: note.string,
    fret: note.fret,
  };
}

function makeMeasures(duration: number, bpm: number, time: TimeSignature): Measure[] {
  const count = measureCount(duration, bpm, time);
  const ticks = measureTicks(time);
  return Array.from({ length: count }, (_, index) => ({
    id: `measure-${index + 1}`,
    index,
    start: index * ticks,
    duration: ticks,
  }));
}

type Group = {
  staff: 'treble' | 'bass';
  start: number;
  duration: number;
  notes: PerformanceNote[];
};

type AssignedGroup = Group & { voice: 1 | 2; skipped?: boolean };

function groupPerformance(
  performance: PerformanceNote[], secondsPerTick: number, splitPitch: number,
  scoreSeconds: (note: PerformanceNote) => number,
): Group[] {
  const groups = new Map<string, Group>();
  for (const source of performance) {
    const scoreOnset = scoreSeconds(source);
    const start = snapTick(scoreOnset / secondsPerTick);
    const sourceLength = source.notation_duration && source.notation_duration > 0
      ? source.notation_duration
      : source.duration && source.duration > 0 ? source.duration : 0.25;
    const end = snapTick((scoreOnset + sourceLength) / secondsPerTick);
    const duration = Math.max(GRID, end - start);
    const staff = source.pitch >= splitPitch ? 'treble' : 'bass';
    const key = `${staff}:${start}:${duration}`;
    const current = groups.get(key);
    if (current) current.notes.push(source);
    else groups.set(key, { staff, start, duration, notes: [source] });
  }
  return [...groups.values()].sort((left, right) =>
    left.start - right.start || right.duration - left.duration || left.staff.localeCompare(right.staff));
}

function assignVoices(groups: Group[]): AssignedGroup[] {
  const result: AssignedGroup[] = [];
  for (const staff of ['treble', 'bass'] as const) {
    const voiceEnds: Record<1 | 2, number> = { 1: -1, 2: -1 };
    const voiceGroups: Record<1 | 2, AssignedGroup[]> = { 1: [], 2: [] };
    const staffGroups = groups.filter(group => group.staff === staff)
      .sort((left, right) => left.start - right.start || right.duration - left.duration);
    for (const group of staffGroups) {
      let voice: 1 | 2 | null = null;
      if (voiceEnds[1] <= group.start) voice = 1;
      else if (voiceEnds[2] <= group.start) voice = 2;
      if (voice === null) {
        // More than two simultaneous voices: merge a same-onset group into the
        // existing chord when possible, otherwise shorten the previous voice and
        // start the new group there. The editor exposes only two voices per staff.
        const same = [...voiceGroups[1], ...voiceGroups[2]].find(item => item.start === group.start);
        if (same) {
          same.notes.push(...group.notes);
          continue;
        }
        voice = voiceEnds[1] <= voiceEnds[2] ? 1 : 2;
        const previous = voiceGroups[voice][voiceGroups[voice].length - 1];
        if (previous) previous.duration = Math.max(GRID, group.start - previous.start);
      }
      const assigned: AssignedGroup = { ...group, voice };
      voiceGroups[voice].push(assigned);
      voiceEnds[voice] = group.start + group.duration;
      result.push(assigned);
    }
  }
  return result;
}

function eventId(group: AssignedGroup, index: number): string {
  const first = group.notes.map(note => note.id).sort()[0] ?? 'note';
  return `ev-${group.staff}-${group.voice}-${group.start}-${index}-${first}`.slice(0, 80);
}

function buildLogicalNote(note: PerformanceNote, key: string): NotationNote {
  const spelling = spellPitch(note.pitch, key);
  return {
    id: `n-${note.id}`.slice(0, 80),
    pitch: note.pitch,
    spelling: spelling.spelling,
    accidental: accidentalName(spelling.alter),
    performance_ids: [note.id],
  };
}

/** Interpret a performance transcription as a piano grand-staff document. */
export function buildNotation(performance: PerformanceNote[], options: BuildOptions = {}): NotationDocument {
  if (!Array.isArray(performance) || performance.length > MAX_EVENTS) throw new Error('The transcription has too many notes.');
  const source = performance.map(copyPerformance);
  const seen = new Set<string>();
  for (const note of source) {
    if (!note.id || note.id.length > 80 || seen.has(note.id)) throw new Error('Performance note ids must be unique.');
    seen.add(note.id);
    if (!Number.isFinite(note.onset) || note.onset < 0) throw new Error('A performance note has an invalid onset.');
    if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) throw new Error('A performance note has an invalid pitch.');
  }
  const bpm = Math.max(20, Math.min(300, options.bpm ?? estimateTempo(source)));
  const time = options.time_signature ?? DEFAULT_TIME;
  const key = options.key_signature ?? 'C';
  keySignature(key);
  const duration = options.duration ?? Math.max(0.05, ...source.map(note => note.onset + (note.duration && note.duration > 0 ? note.duration : 0.25)));
  const splitPitch = Math.max(0, Math.min(127, options.staff_split_pitch ?? 60));
  const secondsPerTick = 60 / (bpm * PPQ);
  const scoreSeconds = options.scoreSeconds ?? ((note: PerformanceNote) => note.onset);
  const measures = makeMeasures(options.scoreDuration ?? duration, bpm, time);
  const groups = assignVoices(groupPerformance(source, secondsPerTick, splitPitch, scoreSeconds));
  const events: NotationEvent[] = groups.map((group, index) => {
    const notes: NotationNote[] = [];
    const byPitch = new Map<number, PerformanceNote>();
    for (const note of group.notes) {
      const existing = byPitch.get(note.pitch);
      if (!existing || (note.velocity ?? 0) > (existing.velocity ?? 0)) byPitch.set(note.pitch, note);
    }
    for (const note of [...byPitch.values()].sort((left, right) => left.pitch - right.pitch)) {
      notes.push(buildLogicalNote(note, key));
    }
    return {
      id: eventId(group, index),
      staff: group.staff,
      voice: group.voice,
      start: group.start,
      duration: group.duration,
      notes,
      rest: false,
      source: 'performance',
    };
  });
  events.sort((left, right) => left.start - right.start || left.staff.localeCompare(right.staff) || left.voice - right.voice);
  const performanceMap: Record<string, string> = {};
  for (const event of events) {
    for (const note of event.notes) {
      for (const id of note.performance_ids) performanceMap[id] = note.id;
    }
  }
  return refreshNotation({
    notation_version: 1,
    subject: 'piano',
    duration,
    ppq: PPQ,
    tempo: { bpm, beat_unit: 4, mode: 'notation', source: options.bpm ? 'instructor' : 'estimated' },
    time_signature: time,
    key_signature: key,
    staff_split_pitch: splitPitch,
    measures,
    events,
    segments: [],
    ties: [],
    performance: source,
    performance_map: performanceMap,
    created_from: 'performance',
  });
}

function appendMeasures(document: NotationDocument, untilTick: number): void {
  const ticks = document.measures[0]?.duration ?? measureTicks(document.time_signature);
  while (document.measures.length && document.measures[document.measures.length - 1].start + ticks < untilTick) {
    if (document.measures.length >= MAX_MEASURES) throw new Error('The notation has too many measures.');
    const index = document.measures.length;
    document.measures.push({ id: `measure-${index + 1}`, index, start: index * ticks, duration: ticks });
  }
}

function mergeIntervals(intervals: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  const result: { start: number; end: number }[] = [];
  for (const interval of sorted) {
    const last = result[result.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

/**
 * Recompute segments, ties and generated rests after any edit. The logical
 * `events` array is the editable source; everything else is derived.
 */
export function refreshNotation(document: NotationDocument): NotationDocument {
  if (!document.measures.length) throw new Error('The notation has no measures.');
  if (document.events.length > MAX_EVENTS) throw new Error('The notation has too many events.');
  document.measures.sort((left, right) => left.index - right.index);
  document.events.sort((left, right) => left.start - right.start || left.staff.localeCompare(right.staff) || left.voice - right.voice);
  for (const event of document.events) {
    if (!Number.isFinite(event.start) || event.start < 0) throw new Error('A notation event has an invalid start.');
    if (!Number.isFinite(event.duration) || event.duration < GRID) throw new Error('A notation event is too short.');
    if (event.duration % GRID !== 0) throw new Error('A notation duration must be on the sixteenth-note grid.');
    if (event.start % GRID !== 0) throw new Error('A notation start must be on the sixteenth-note grid.');
    if (event.notes.length && event.rest) throw new Error('A rest cannot contain notes.');
    if (!event.notes.length && !event.rest) throw new Error('A note event needs at least one pitch.');
    if (new Set(event.notes.map(note => note.pitch)).size !== event.notes.length) throw new Error('A chord repeats a pitch.');
    for (const note of event.notes) {
      if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) throw new Error('A notation note has an invalid pitch.');
      const parsed = parseSpelling(note.spelling);
      if (parsed.pitch !== note.pitch) throw new Error('A notation spelling does not match its MIDI pitch.');
    }
  }
  const maxEnd = Math.max(...document.events.map(event => event.start + event.duration), document.measures[0].start + document.measures[0].duration);
  appendMeasures(document, maxEnd);

  const segments: NotationSegment[] = [];
  const byEvent = new Map<string, NotationSegment[]>();
  for (const event of document.events) {
    const slices = splitAtMeasures(event.start, event.duration, document.measures);
    const owned: NotationSegment[] = [];
    for (const slice of slices) {
      const specs = decomposeTicks(slice.duration);
      let offset = 0;
      for (const spec of specs) {
        const start = slice.start + offset;
        const measure = document.measures[slice.measure_index];
        const id = `${event.id}:${owned.length}`.slice(0, 100);
        const notes: NotationSegmentNote[] = event.rest ? [] : event.notes.map(note => {
          const parsed = parseSpelling(note.spelling);
          return {
            id: `${note.id}:${owned.length}`.slice(0, 100),
            logical_note_id: note.id,
            pitch: note.pitch,
            spelling: note.spelling,
            accidental: note.accidental,
            display_accidental: displayAccidental(parsed.letter, parsed.alter, document.key_signature),
            tie_from: owned.length > 0,
            tie_to: false, // filled after the event's segment count is known
            performance_ids: [...note.performance_ids],
          };
        });
        const segment: NotationSegment = {
          id,
          event_id: event.id,
          measure_id: measure.id,
          measure_index: measure.index,
          staff: event.staff,
          voice: event.voice,
          start,
          duration: spec.ticks,
          value: spec.value,
          dotted: spec.dotted,
          rest: event.rest,
          generated_rest: false,
          notes,
        };
        segments.push(segment);
        owned.push(segment);
        offset += spec.ticks;
      }
    }
    // Every segment except the last is tied to the next one for each pitch.
    for (let index = 0; index < owned.length - 1; index += 1) {
      for (const note of owned[index].notes) note.tie_to = true;
    }
    byEvent.set(event.id, owned);
  }

  // Generated rests cover every gap in every voice that owns events.
  const voices = [...new Set(document.events.map(event => `${event.staff}:${event.voice}`))];
  for (const voiceKey of voices) {
    const [staff, voiceText] = voiceKey.split(':');
    const voice = Number(voiceText) as 1 | 2;
    for (const measure of document.measures) {
      const occupied = segments
        .filter(segment => segment.staff === staff && segment.voice === voice && segment.measure_index === measure.index)
        .map(segment => ({ start: segment.start, end: segment.start + segment.duration }));
      const merged = mergeIntervals(occupied);
      let cursor = measure.start;
      const gaps: { start: number; end: number }[] = [];
      for (const interval of merged) {
        if (interval.start > cursor) gaps.push({ start: cursor, end: Math.min(interval.start, measure.start + measure.duration) });
        cursor = Math.max(cursor, interval.end);
      }
      if (cursor < measure.start + measure.duration) gaps.push({ start: cursor, end: measure.start + measure.duration });
      for (const gap of gaps) {
        if (gap.end - gap.start < GRID) continue;
        const specs = decomposeTicks(snapTick(gap.end - gap.start));
        let offset = 0;
        for (const spec of specs) {
          const id = `grest:${staff}:${voice}:${gap.start + offset}:${spec.ticks}`.slice(0, 100);
          segments.push({
            id,
            event_id: '',
            measure_id: measure.id,
            measure_index: measure.index,
            staff: staff as 'treble' | 'bass',
            voice,
            start: gap.start + offset,
            duration: spec.ticks,
            value: spec.value,
            dotted: spec.dotted,
            rest: true,
            generated_rest: true,
            notes: [],
          });
          offset += spec.ticks;
        }
      }
    }
  }

  segments.sort((left, right) => left.start - right.start || left.staff.localeCompare(right.staff)
    || left.voice - right.voice || left.id.localeCompare(right.id));
  if (segments.reduce((total, segment) => total + segment.notes.length, 0) > MAX_NOTATION_NOTES) {
    throw new Error('The notation has too many note segments.');
  }

  const ties: Tie[] = [];
  for (const owned of byEvent.values()) {
    for (let index = 0; index < owned.length - 1; index += 1) {
      const current = owned[index];
      const next = owned[index + 1];
      for (const note of current.notes) {
        if (!note.tie_to) continue;
        const counterpart = next.notes.find(candidate => candidate.logical_note_id === note.logical_note_id);
        if (!counterpart) continue;
        ties.push({ id: `tie:${note.id}:${counterpart.id}`.slice(0, 120), from_segment_note_id: note.id, to_segment_note_id: counterpart.id, pitch: note.pitch });
      }
    }
  }

  const performanceMap: Record<string, string> = {};
  for (const event of document.events) {
    for (const note of event.notes) {
      for (const id of note.performance_ids) performanceMap[id] = note.id;
    }
  }
  for (const id of Object.keys(performanceMap)) {
    if (!document.performance.some(note => note.id === id)) delete performanceMap[id];
  }

  document.segments = segments;
  document.ties = ties;
  document.performance_map = performanceMap;
  document.created_from = 'saved';
  return document;
}

export function selectableEvents(document: NotationDocument): NotationEvent[] {
  return [...document.events].sort((left, right) => left.start - right.start || left.staff.localeCompare(right.staff) || left.voice - right.voice);
}
