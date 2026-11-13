/**
 * Phase 1 audit: measure what the existing notation commands do to the REAL draft.
 *
 * Reads the dumped draft document (read-only copy), rebuilds notation, then runs the
 * existing edit commands and reports exactly what they deleted, rounded or rewrote.
 * Run with: npx tsx .local/phase1-audit/audit-destructive.ts
 */
import {readFileSync} from 'node:fs';
import {
  buildNotation, changeDuration, changePitch, changeStaff, deleteNote, eventDurationSeconds,
  insertNote, moveEvent, respellAccidental, setTempo, tieToNext, untieLast,
  type NotationDocument, type PerformanceNote,
} from '../../packages/music-notation/index.ts';

const path = new URL('./draft-document.json', import.meta.url);
const raw = readFileSync(path);
const text = (raw[0] === 0xff && raw[1] === 0xfe
  ? raw.toString('utf16le') : raw.toString('utf8')).replace(/^\uFEFF/, '');
const draft = JSON.parse(text);

const performance: PerformanceNote[] = draft.events.map((event: any) => ({
  id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
  velocity: event.velocity, confidence: event.confidence, optional: event.optional,
  string: event.string, fret: event.fret,
}));

const report = (title: string, value: unknown) => console.log(`\n## ${title}\n${JSON.stringify(value, null, 2)}`);

const started = Date.now();
const score = buildNotation(performance, {duration: draft.duration});
report('build cost and shape', {
  build_ms: Date.now() - started,
  duration: score.duration,
  tempo_bpm_estimated: score.tempo.bpm,
  measures: score.measures.length,
  events: score.events.length,
  logical_notes: score.events.reduce((total, event) => total + event.notes.length, 0),
  segments: score.segments.length,
  generated_rests: score.segments.filter(segment => segment.generated_rest).length,
  ties: score.ties.length,
  mapped_performance_notes: Object.keys(score.performance_map).length,
  performance_notes: score.performance.length,
  unmapped_performance_notes: score.performance.length - Object.keys(score.performance_map).length,
  events_with_2_voices_treble: score.events.filter(e => e.staff === 'treble' && e.voice === 2).length,
  events_with_2_voices_bass: score.events.filter(e => e.staff === 'bass' && e.voice === 2).length,
  max_chord: Math.max(...score.events.map(event => event.notes.length)),
});

// How wrong is a single-BPM tick map against the real performance?
const spb = 60 / (score.tempo.bpm * score.ppq);
const errors = score.events.flatMap(event => {
  const linked = event.notes.flatMap(note => note.performance_ids)
    .map(id => performance.find(item => item.id === id))
    .filter(Boolean) as PerformanceNote[];
  if (!linked.length) return [];
  const actual = Math.min(...linked.map(item => item.onset));
  return [{event: event.id, actual, mapped: event.start * spb, error: event.start * spb - actual}];
});
const abs = errors.map(item => Math.abs(item.error)).sort((a, b) => a - b);
report('single-tempo tick map error against real seconds', {
  mapped_events: errors.length,
  mean_abs_error_s: +(abs.reduce((t, v) => t + v, 0) / abs.length).toFixed(3),
  median_abs_error_s: +abs[Math.floor(abs.length / 2)].toFixed(3),
  p90_abs_error_s: +abs[Math.floor(abs.length * 0.9)].toFixed(3),
  max_abs_error_s: +abs[abs.length - 1].toFixed(3),
  worst: errors.reduce((worst, item) => Math.abs(item.error) > Math.abs(worst.error) ? item : worst),
});

// Snapping: how many onsets survive the 16th-note grid without rounding?
const snapped = new Set(performance.map(note => Math.round(note.onset / spb / 120) * 120));
const lost = performance.length - snapped.size;
report('sixteenth-grid quantisation on the real clip', {
  distinct_snapped_positions: snapped.size,
  distinct_real_onsets: new Set(performance.map(note => note.onset)).size,
  notes_that_share_a_grid_slot: lost,
});

/* ---------------------------------------------------------------- destructive edits */

function countPerformance(document: NotationDocument) {
  return document.performance.length;
}

/** 1. Lengthen one note's written duration: what else disappears? */
function testDurationOverwrite() {
  const candidate = score.events
    .filter(event => !event.rest && event.notes.length === 1)
    .map(event => {
      const next = score.events.find(other => other.id !== event.id && other.staff === event.staff
        && other.voice === event.voice && other.start > event.start && other.start < event.start + event.duration + 960);
      return next ? {event, next} : null;
    })
    .find(Boolean);
  if (!candidate) return {skipped: 'no candidate'};
  const {event, next} = candidate!;
  const victimIds = new Set(next.notes.flatMap(note => note.performance_ids));
  const before = {onset: performance.find(item => victimIds.has(item.id))!.onset,
    duration: performance.find(item => victimIds.has(item.id))!.duration};
  const edited = changeDuration(score, event.id, event.duration + 960);
  const survivor = edited.performance.filter(item => victimIds.has(item.id));
  return {
    edited_event: event.id,
    written: {from_ticks: event.duration, to_ticks: event.duration + 960},
    neighbour_event: next.id,
    neighbour_start_s: +(event.start * spb).toFixed(3),
    neighbour_victim_onset_s: before.onset,
    neighbour_victim_duration_s: before.duration,
    performance_notes_before: countPerformance(score),
    performance_notes_after: countPerformance(edited),
    victim_performance_notes_left: survivor.length,
    victim_notes_left_in_events: edited.events.filter(item => item.notes.some(note =>
      note.performance_ids.some(id => victimIds.has(id)))).length,
  };
}

/** 2. Shortening a neighbour: is its sound truncated as well as its symbol? */
function testNeighbourTruncation() {
  const pair = score.events
    .map(event => {
      const next = score.events.find(other => other.id !== event.id && other.staff === event.staff
        && other.voice === event.voice && other.start > event.start
        && other.start < event.start + event.duration);
      return next ? {event, next} : null;
    })
    .find(Boolean);
  if (!pair) return {skipped: 'no overlapping pair'};
  const {event, next} = pair!;
  const ids = next.notes.flatMap(note => note.performance_ids);
  const before = performance.find(item => ids.includes(item.id))!;
  const edited = changeDuration(score, event.id, event.duration + 120);
  const matched = edited.performance.filter(item => ids.includes(item.id));
  return {
    edited_event: event.id,
    event_start_s: +(event.start * spb).toFixed(3),
    neighbour_id: next.id,
    neighbour_truncated_ticks: next.duration,
    neighbour_performance_duration_before_s: before.duration,
    neighbour_performance_duration_after_s: matched.map(item => item.duration),
    neighbour_events_left: edited.events.filter(item => item.notes.some(note => ids.includes(note.performance_ids[0]))).length,
  };
}

/** 3. Free-time movement: what happens to a 10 ms adjustment when Snap is off? */
function testTenMillisecondMove() {
  const event = score.events.find(item => item.notes.length === 1 && item.start > 0)!;
  const linked = performance.find(item => item.id === event.notes[0].performance_ids[0])!;
  const targetSeconds = linked.onset + 0.01;
  const ticks = Math.round(targetSeconds / spb / 120) * 120;
  const edited = moveEvent(score, event.id, ticks);
  const moved = edited.performance.find(item => item.id === linked.id)!;
  return {
    event: event.id,
    requested_seconds: +targetSeconds.toFixed(4),
    stored_seconds: +moved.onset.toFixed(4),
    error_s: +(moved.onset - targetSeconds).toFixed(4),
    editor_passes_ticks_snapped_to_16th: ticks,
  };
}

/** 4. Tie: the absorbed attack and the tempo-derived sustain. */
function testTieAbsorbsAttack() {
  const candidate = score.events
    .map(event => {
      const following = score.events.find(other => other.id !== event.id && other.staff === event.staff
        && other.voice === event.voice && other.start === event.start + event.duration
        && other.notes.some(note => event.notes.some(first => first.pitch === note.pitch)));
      return following ? {event, following} : null;
    })
    .find(Boolean);
  if (!candidate) return {skipped: 'no adjacent same-pitch pair'};
  const {event, following} = candidate!;
  const note = event.notes[0];
  const linked = performance.find(item => item.id === note.performance_ids[0])!;
  const absorbedNote = following.notes.find(item => item.pitch === note.pitch)!;
  const absorbedIds = absorbedNote.performance_ids;
  const before = {onsets_affected: performance.filter(item => absorbedIds.includes(item.id)).map(item => item.onset)};
  let edited: NotationDocument;
  try {
    edited = tieToNext(score, note.id);
  } catch (error) {
    return {threw: (error as Error).message};
  }
  const after = edited.performance.find(item => item.id === linked.id)!;
  return {
    event: event.id,
    tied_note_pitch: note.pitch,
    recorded_duration_before_s: linked.duration,
    recorded_duration_after_s: after.duration,
    tempo_derived_written_seconds: +(event.duration + following.duration) * spb,
    absorbed_performance_notes: absorbedIds.length,
    absorbed_notes_still_present: edited.performance.filter(item => absorbedIds.includes(item.id)).length,
    before,
    untie_restores_absorbed_note: (() => {
      const back = untieLast(edited, event.id);
      return back.performance.some(item => absorbedIds.includes(item.id));
    })(),
  };
}

/** 5. No-op commands that still return a new document (spurious history entries). */
function testNoOps() {
  const note = score.events.find(item => item.notes.length === 1)!.notes[0];
  const natural = respellAccidental(score, note.id, 'natural');
  const sameStaff = changeStaff(score, score.events[0].id, score.events[0].staff);
  const samePitch = changePitch(score, note.id, note.pitch);
  const sameDuration = changeDuration(score, score.events[0].id, score.events[0].duration);
  return {
    respell_natural_returns_new_object: natural !== score,
    change_staff_same_returns_new_object: sameStaff !== score,
    change_pitch_same_returns_new_object: samePitch !== score,
    change_duration_same_returns_new_object: sameDuration !== score,
    respell_natural_actually_changed: JSON.stringify(natural.events) !== JSON.stringify(score.events),
  };
}

/** 6. One logical note, several performance occurrences: does one edit hit all of them? */
function testMultiMapping() {
  const merged = buildNotation([
    {id: 'a', onset: 1, duration: 1, pitch: 60, velocity: 0.5, confidence: null, optional: false, string: null, fret: null},
    {id: 'b', onset: 1, duration: 1, pitch: 60, velocity: 0.4, confidence: null, optional: false, string: null, fret: null},
  ], {duration: 4});
  const note = merged.events[0].notes[0];
  return {
    performance_notes: merged.performance.length,
    logical_notes: merged.events.flatMap(event => event.notes).length,
    linked_ids: note.performance_ids,
    events_with_same_pitch_same_onset: merged.events.length,
    performance_note_lost_at_build: merged.performance.length - Object.keys(merged.performance_map).length,
    mapped_ids: Object.keys(merged.performance_map),
  };
}

/** 7. Delete a chord member: does its neighbour survive with its recorded length? */
function testDeleteChordMember() {
  const chord = score.events.find(item => item.notes.length > 1
    && item.notes.every(note => performance.find(p => p.id === note.performance_ids[0])!.duration));
  if (!chord) return {skipped: 'no chord'};
  const target = chord.notes[0];
  const other = chord.notes[1];
  const edited = deleteNote(score, target.id);
  const otherPerf = performance.find(item => item.id === other.performance_ids[0])!;
  const afterOther = edited.performance.find(item => item.id === otherPerf.id);
  return {
    chord_event: chord.id,
    deleted_pitch: target.pitch,
    other_pitch: other.pitch,
    other_performance_present: Boolean(afterOther),
    other_duration_before: otherPerf.duration,
    other_duration_after: afterOther?.duration ?? null,
    chord_notes_before: chord.notes.length,
    events_after: edited.events.length,
    performance_before: performance.length,
    performance_after: edited.performance.length,
  };
}

/** 8. Insert: does it silently overwrite the note it lands on? */
function testInsertOverlap() {
  const event = score.events.find(item => item.notes.length === 1 && item.start > 480)!;
  const victim = event.notes[0].performance_ids[0];
  const start = event.start;
  const edited = insertNote(score, {pitch: 61, start, duration: 480, staff: event.staff, voice: event.voice});
  return {
    insertion_ticks: start,
    insertion_seconds: +(start * spb).toFixed(3),
    victim_performance_id: victim,
    victim_still_present: edited.performance.some(item => item.id === victim),
    performance_before: performance.length,
    performance_after: edited.performance.length,
  };
}

report('1. changeDuration on one note — collateral damage', testDurationOverwrite());
report('2. changeDuration over a sounding neighbour — truncation', testNeighbourTruncation());
report('3. moveEvent with a 10 ms request', testTenMillisecondMove());
report('4. tieToNext — attack absorption and sustain rewrite', testTieAbsorbsAttack());
report('5. no-op commands returning new documents', testNoOps());
report('6. same-pitch same-onset duplicate at build time', testMultiMapping());
report('7. deleteNote inside a chord', testDeleteChordMember());
report('8. insertNote over an existing note', testInsertOverlap());

/* ------------------------------------------------------- history/serialisation cost */

const serialised = JSON.stringify(score);
report('document size', {
  json_bytes: serialised.length,
  json_mb: +(serialised.length / 1_048_576).toFixed(2),
  estimated_80_snapshot_history_mb: +(serialised.length * 80 / 1_048_576).toFixed(1),
});

const editStarted = Date.now();
let replay = score;
for (let index = 0; index < 10; index += 1) {
  const event = replay.events.find(item => item.notes.length === 1 && !item.notes[0].performance_ids[0].startsWith('authored-'));
  const note = event!.notes[0];
  replay = changePitch(replay, note.id, note.pitch === 60 ? 61 : 60);
}
report('ten sequential pitch edits', {
  total_ms: Date.now() - editStarted,
  ms_per_edit: Math.round((Date.now() - editStarted) / 10),
});

void setTempo;
void eventDurationSeconds;
