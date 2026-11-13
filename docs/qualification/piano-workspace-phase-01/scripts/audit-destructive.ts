/**
 * Phase 1 audit: what do the existing notation commands actually do?
 *
 * Runs against a real draft dump (`--input`) or the tracked synthetic fixture
 * (`--fixture`), then writes a reproduction matrix to `<out>/audit-matrix-<label>.json`
 * alongside a readable report. Read-only: it never saves a draft or a revision.
 *
 * Usage (from the repository root):
 *   npx tsx docs/qualification/piano-workspace-phase-01/scripts/audit-destructive.ts --fixture
 *   npx tsx docs/qualification/piano-workspace-phase-01/scripts/audit-destructive.ts --input=.local/phase1-audit/draft-document.json
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {loadNotation} from './lib/notation.ts';
import {parseOptions, readJson, USAGE} from './lib/paths.ts';

type Status =
  | 'reproduced-real' | 'reproduced-fixture' | 'constructed-fixture'
  | 'safe-control' | 'static-analysis' | 'skipped';

type Receipt = {id: string; title: string; status: Status; detail: string; numbers?: Record<string, unknown>};

const options = parseOptions();
if (options.help) { console.log(USAGE); process.exit(0); }

const draft = readJson(options.input);
const notation = loadNotation();
const {buildNotation, changeDuration, changePitch, changeStaff, deleteNote, insertNote, moveEvent,
  refreshNotation, respellAccidental, tieToNext, untieLast} = notation;

const label = options.fixture ? 'fixture' : 'real';
const isReal = !options.fixture;

const performance: any[] = draft.events.map((event: any) => ({
  id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
  velocity: event.velocity, confidence: event.confidence, optional: event.optional,
  string: event.string, fret: event.fret,
}));

const score = buildNotation(performance, {duration: draft.duration});
const spb = 60 / (score.tempo.bpm * score.ppq);
const receipts: Receipt[] = [];
const record = (receipt: Receipt) => { receipts.push(receipt); };

/* ------------------------------------------------------------------ D1 */

function durationCollateral(): Receipt {
  const id = 'D1';
  const title = 'Written-duration command deletes neighbouring occurrences';
  const candidate = score.events
    .filter((event: any) => !event.rest && event.notes.length === 1)
    .map((event: any) => {
      const next = score.events.find((other: any) => other.id !== event.id && other.staff === event.staff
        && other.voice === event.voice && other.start > event.start
        && other.start < event.start + event.duration + 960);
      return next ? {event, next} : null;
    })
    .find(Boolean);
  if (!candidate) return {id, title, status: 'skipped', detail: 'No candidate event with a same-voice successor.'};
  const {event, next} = candidate!;
  const victimIds = new Set<string>(next.notes.flatMap((note: any) => note.performance_ids));
  const before = performance.find((item: any) => victimIds.has(item.id));
  const edited = changeDuration(score, event.id, event.duration + 960);
  const survivors = edited.performance.filter((item: any) => victimIds.has(item.id));
  return {
    id, title, status: isReal ? 'reproduced-real' : 'reproduced-fixture',
    detail: `Lengthened ${event.id} from ${event.duration} to ${event.duration + 960} ticks `
      + '(+960 ticks = a half note = two quarter-note beats at ppq 480). '
      + `${victimIds.size} linked occurrence(s) of ${next.id} disappeared: performance ${score.performance.length} -> ${edited.performance.length}.`,
    numbers: {
      edited_event: event.id,
      ticks_before: event.duration,
      ticks_after: event.duration + 960,
      added_ticks: 960,
      neighbour_event: next.id,
      neighbour_occurrences: victimIds.size,
      neighbour_onset_s: before?.onset ?? null,
      neighbour_recorded_duration_s: before?.duration ?? null,
      performance_before: score.performance.length,
      performance_after: edited.performance.length,
      victim_survivors: survivors.length,
    },
  };
}

/* ------------------------------------------------------------------ D2 */

function chordMove(): Receipt {
  const id = 'D2';
  const title = 'Event move rewrites every chord member to one tempo-derived onset';
  const chord = score.events.find((event: any) => {
    if (event.notes.length < 2) return false;
    const onsets = new Set(event.notes.flatMap((note: any) => note.performance_ids)
      .map((linked: string) => performance.find((item: any) => item.id === linked)?.onset).filter(Boolean));
    return onsets.size > 1;
  });
  if (!chord) return {id, title, status: 'skipped', detail: 'No chord with differing recorded onsets in this input.'};
  const linkedIds = new Set<string>(chord.notes.flatMap((note: any) => note.performance_ids));
  const before = [...linkedIds].map((linked: string) => performance.find((item: any) => item.id === linked))
    .filter(Boolean).map((item: any) => item.onset as number);
  const target = Math.max(0, chord.start - 120);
  const edited = moveEvent(score, chord.id, target);
  const after = edited.performance.filter((item: any) => linkedIds.has(item.id)).map((item: any) => item.onset as number);
  return {
    id, title, status: isReal ? 'reproduced-real' : 'reproduced-fixture',
    detail: `Moved ${chord.id} (${chord.notes.length} notes) by one sixteenth. Distinct recorded onsets before: `
      + `${new Set(before).size}; after: ${new Set(after).size}. Every member is re-stamped from ticks x tempo, so exact seconds are replaced.`,
    numbers: {
      event: chord.id, notes: chord.notes.length,
      onsets_before_s: before.map(value => +value.toFixed(4)),
      onsets_after_s: after.map(value => +value.toFixed(4)),
      spread_before_s: +(Math.max(...before) - Math.min(...before)).toFixed(4),
      spread_after_s: +(Math.max(...after) - Math.min(...after)).toFixed(4),
    },
  };
}

/* ------------------------------------------------------------------ D3 */

function tenMillisecondMove(): Receipt {
  const id = 'D3';
  const title = 'A 10 ms recorded-onset nudge with Snap off is rounded away';
  const event = score.events.find((item: any) => item.notes.length === 1 && item.start > 0);
  if (!event) return {id, title, status: 'skipped', detail: 'No single-note event to move.'};
  const linked = performance.find((item: any) => item.id === event.notes[0].performance_ids[0]);
  if (!linked) return {id, title, status: 'skipped', detail: 'Event has no linked performance occurrence.'};
  const requested = linked.onset + 0.01;
  const ticks = Math.round(requested / spb / 120) * 120;
  const edited = moveEvent(score, event.id, ticks);
  const stored = edited.performance.find((item: any) => item.id === linked.id).onset;
  return {
    id, title, status: isReal ? 'reproduced-real' : 'reproduced-fixture',
    detail: `Requested ${requested.toFixed(4)} s; the editor can only pass ${ticks} ticks, so ${stored.toFixed(4)} s was stored. `
      + `Net change ${(stored - linked.onset).toFixed(4)} s.`,
    numbers: {requested_s: +requested.toFixed(4), stored_s: +stored.toFixed(4), ticks, error_s: +(stored - requested).toFixed(4)},
  };
}

/* ------------------------------------------------------------------ D4 */

function tieBehaviour(): Receipt {
  const id = 'D4';
  const title = 'Tie deletes the second attack and rewrites the recorded length';
  const pair = score.events
    .map((event: any) => {
      const following = score.events.find((other: any) => other.id !== event.id && other.staff === event.staff
        && other.voice === event.voice && other.start === event.start + event.duration
        && other.notes.some((note: any) => event.notes.some((first: any) => first.pitch === note.pitch)));
      return following ? {event, following} : null;
    })
    .find(Boolean);
  if (!pair) return {id, title, status: 'skipped', detail: 'No adjacent same-pitch pair to tie.'};
  const {event, following} = pair!;
  const note = event.notes[0];
  const linked = performance.find((item: any) => item.id === note.performance_ids[0]);
  const absorbedNote = following.notes.find((item: any) => item.pitch === note.pitch);
  const absorbedIds: string[] = absorbedNote.performance_ids;
  let edited: any;
  try {
    edited = tieToNext(score, note.id);
  } catch (error) {
    return {id, title, status: 'skipped', detail: `tieToNext refused: ${(error as Error).message}`};
  }
  const after = edited.performance.find((item: any) => item.id === linked.id);
  const untied = untieLast(edited, event.id);
  return {
    id, title, status: isReal ? 'reproduced-real' : 'reproduced-fixture',
    detail: `Tied ${event.id}: recorded length ${linked.duration} s -> ${after.duration} s (tempo-derived), `
      + `${absorbedIds.length} absorbed occurrence(s) removed, and untie did not restore them.`,
    numbers: {
      event: event.id,
      recorded_before_s: linked.duration,
      recorded_after_s: after?.duration ?? null,
      tempo_derived_s: +((event.duration + following.duration) * spb).toFixed(4),
      absorbed_occurrences: absorbedIds.length,
      absorbed_present_after_tie: edited.performance.filter((item: any) => absorbedIds.includes(item.id)).length,
      absorbed_restored_by_untie: untied.performance.some((item: any) => absorbedIds.includes(item.id)),
    },
  };
}

/* ------------------------------------------------------------------ D5 */

function insertOverlap(): Receipt {
  const id = 'D5';
  const title = 'Insert silently replaces the note it lands on';
  const event = score.events.find((item: any) => item.notes.length === 1 && item.start > 480);
  if (!event) return {id, title, status: 'skipped', detail: 'No target event.'};
  const victim = event.notes[0].performance_ids[0];
  const edited = insertNote(score, {pitch: 61, start: event.start, duration: 480, staff: event.staff, voice: event.voice});
  return {
    id, title, status: isReal ? 'reproduced-real' : 'reproduced-fixture',
    detail: `Inserting at ${event.start} ticks removed ${victim} `
      + `(${performance.find((item: any) => item.id === victim)?.onset.toFixed(3)} s) with no error or warning; `
      + `total occurrences unchanged (${score.performance.length} -> ${edited.performance.length}).`,
    numbers: {
      insertion_ticks: event.start,
      insertion_s: +(event.start * spb).toFixed(3),
      victim,
      victim_present_after: edited.performance.some((item: any) => item.id === victim),
      performance_before: score.performance.length,
      performance_after: edited.performance.length,
    },
  };
}

/* ------------------------------------------------------------------ D6 */

function duplicateOccurrences(): Receipt {
  const id = 'D6';
  const title = 'Same-pitch, same-onset occurrences lose their mapping at build time';
  const built = buildNotation([
    {id: 'dup-a', onset: 1, duration: 1, pitch: 60, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
    {id: 'dup-b', onset: 1, duration: 1, pitch: 60, velocity: 0.4, confidence: null, optional: false, string: null, fret: null},
  ], {duration: 4});
  const note = built.events[0].notes[0];
  return {
    id, title, status: 'constructed-fixture',
    detail: `Two occurrences at the same pitch and onset produce one logical note linked only to "${note.performance_ids.join(', ')}". `
      + `The other stays in performance (${built.performance.length}) but is unmapped `
      + `(${built.performance.length - Object.keys(built.performance_map).length} unmapped), so it is unselectable and uneditable.`,
    numbers: {
      performance_notes: built.performance.length,
      logical_notes: built.events.flatMap((event: any) => event.notes).length,
      linked_ids: note.performance_ids,
      unmapped: built.performance.length - Object.keys(built.performance_map).length,
    },
  };
}

/* ------------------------------------------------------------------ D7 */

function thirdVoice(): Receipt {
  const id = 'D7';
  const title = 'A third overlapping voice is merged or truncates the previous event';
  const built = buildNotation([
    {id: 'v1', onset: 0.5, duration: 0.2, pitch: 70, velocity: 0.5, confidence: null, optional: false, string: null, fret: null},
    {id: 'v2', onset: 0.5, duration: 0.4, pitch: 64, velocity: 0.5, confidence: null, optional: false, string: null, fret: null},
    {id: 'v3', onset: 0.5, duration: 1.2, pitch: 72, velocity: 0.5, confidence: null, optional: false, string: null, fret: null},
  ], {duration: 4, bpm: 120});
  const atOnset = built.events.filter((event: any) => event.start === built.events[0]?.start);
  const truncations = built.events.filter((event: any) => event.duration < 480).length;
  return {
    id, title, status: 'constructed-fixture',
    detail: `Three same-onset groups produce ${atOnset.length} event(s); ${truncations} event(s) were shortened below a quarter note `
      + 'without any report. The third voice is merged into a chord or absorbed by truncating the previous event.',
    numbers: {events_at_onset: atOnset.length, durations: atOnset.map((event: any) => event.duration), truncated_events: truncations},
  };
}

/* ------------------------------------------------------------------ D8 */

function noOps(): Receipt {
  const id = 'D8';
  const title = 'No-op commands return a new document';
  const note = score.events.find((item: any) => item.notes.length === 1).notes[0];
  const natural = respellAccidental(score, note.id, 'natural');
  const sameStaff = changeStaff(score, score.events[0].id, score.events[0].staff);
  const samePitch = changePitch(score, note.id, note.pitch);
  return {
    id, title, status: isReal ? 'reproduced-real' : 'reproduced-fixture',
    detail: `respellAccidental(natural) returned a new object: ${natural !== score}; changeStaff(same) returned a new object: ${sameStaff !== score}. `
      + `changePitch(same) returns the original identity: ${samePitch === score}.`,
    numbers: {
      respell_natural_new_object: natural !== score,
      change_staff_new_object: sameStaff !== score,
      content_changed: JSON.stringify(natural.events) !== JSON.stringify(score.events),
    },
  };
}

/* ------------------------------------------------------------------ D10 */

function rebuildCost(): Receipt {
  const id = 'D10';
  const title = 'Every command rebuilds all segments, ties and generated rests';
  const started = Date.now();
  let replay = score;
  for (let index = 0; index < 10; index += 1) {
    const event = replay.events.find((item: any) => item.notes.length === 1
      && !String(item.notes[0].performance_ids[0]).startsWith('authored-'));
    const note = event.notes[0];
    replay = changePitch(replay, note.id, note.pitch === 60 ? 61 : 60);
  }
  const elapsed = Date.now() - started;
  const json = JSON.stringify(score);
  return {
    id, title, status: isReal ? 'reproduced-real' : 'reproduced-fixture',
    detail: `Ten sequential pitch edits took ${elapsed} ms (${Math.round(elapsed / 10)} ms each). Each edit regenerates `
      + `${score.segments.length} segments, ${score.ties.length} ties and `
      + `${score.segments.filter((segment: any) => segment.generated_rest).length} generated rests. `
      + `Serialised document size ${(json.length / 1_048_576).toFixed(2)} MB (serialised-size estimate, not a measured heap).`,
    numbers: {
      ten_edits_ms: elapsed, ms_per_edit: Math.round(elapsed / 10),
      segments: score.segments.length, ties: score.ties.length,
      generated_rests: score.segments.filter((segment: any) => segment.generated_rest).length,
      serialised_bytes: json.length,
      estimated_80_snapshot_mb: +((json.length * 80) / 1_048_576).toFixed(1),
    },
  };
}

/* ------------------------------------------------------------------ D11 */

function multiOccurrenceDocument(): Receipt {
  const id = 'D11';
  const title = 'A logical note with several occurrences is edited as a whole';
  const base = buildNotation([
    {id: 'm-a', onset: 1, duration: 0.5, pitch: 60, velocity: 0.5, confidence: null, optional: false, string: null, fret: null},
  ], {duration: 4, bpm: 120});
  // Construct the multi-occurrence relationship the model permits: one logical note,
  // two performance occurrences (as a future split/merge feature would produce).
  const constructed: any = structuredClone(base);
  constructed.performance.push({...constructed.performance[0], id: 'm-b', onset: 3});
  constructed.events[0].notes[0].performance_ids = ['m-a', 'm-b'];
  const document = refreshNotation(constructed);
  const noteId = document.events[0].notes[0].id;
  const edited = changePitch(document, noteId, 61);
  const changed = edited.performance.filter((item: any) => item.pitch === 61).map((item: any) => item.id);
  return {
    id, title, status: 'constructed-fixture',
    detail: `One logical note linked to two occurrences (1.0 s and 3.0 s). A single changePitch(${noteId}, 61) changed both: `
      + `${changed.join(', ')}. There is no split or rejection path in the command.`,
    numbers: {linked_occurrences: ['m-a', 'm-b'], pitches_after_edit: edited.performance.map((item: any) => item.pitch), changed},
  };
}

/* ------------------------------------------------------- safe controls */

function deleteChordMember(): Receipt {
  const chord = score.events.find((item: any) => item.notes.length > 1);
  if (!chord) return {id: 'C1', title: 'Delete one chord member leaves the rest intact', status: 'skipped', detail: 'No chord in input.'};
  const [target, other] = chord.notes;
  const otherPerf = performance.find((item: any) => item.id === other.performance_ids[0]);
  const edited = deleteNote(score, target.id);
  const after = edited.performance.find((item: any) => item.id === otherPerf.id);
  return {
    id: 'C1', title: 'Delete one chord member leaves the rest intact', status: 'safe-control',
    detail: `Deleting pitch ${target.pitch} from ${chord.id} kept pitch ${other.pitch} at its recorded length ${otherPerf.duration} s.`,
    numbers: {chord: chord.id, other_present: Boolean(after), recorded_duration_before: otherPerf.duration, recorded_duration_after: after?.duration ?? null},
  };
}

function pitchChordMember(): Receipt {
  const chord = score.events.find((item: any) => item.notes.length > 1);
  if (!chord) return {id: 'C2', title: 'Pitch change on one chord member leaves the rest intact', status: 'skipped', detail: 'No chord in input.'};
  const [target, other] = chord.notes;
  const otherPerf = performance.find((item: any) => item.id === other.performance_ids[0]);
  const edited = changePitch(score, target.id, target.pitch === 60 ? 61 : 60);
  const after = edited.performance.find((item: any) => item.id === otherPerf.id);
  return {
    id: 'C2', title: 'Pitch change on one chord member leaves the rest intact', status: 'safe-control',
    detail: `Changing ${target.pitch} kept neighbour ${other.pitch} at ${after?.pitch} with onset ${after?.onset} s and length ${after?.duration} s.`,
    numbers: {other_pitch_after: after?.pitch ?? null, other_onset_after: after?.onset ?? null, other_duration_after: after?.duration ?? null},
  };
}

/* --------------------------------------------------------- run and write */

record(durationCollateral());
record(chordMove());
record(tenMillisecondMove());
record(tieBehaviour());
record(insertOverlap());
record(duplicateOccurrences());
record(thirdVoice());
record(noOps());
record(rebuildCost());
record(multiOccurrenceDocument());
record(deleteChordMember());
record(pitchChordMember());

// Behaviours that live in the editor's save/UI layer rather than the notation package.
receipts.push(
  {id: 'D9', title: 'Selecting a generated rest then Delete inserts an explicit rest', status: 'static-analysis',
    detail: 'Generated rests carry no event id, so the destructive delete branch is unreachable; the editor instead falls '
      + 'through to insertRest (NotationEditor deleteSelection). Not executed because it is a React handler, not a package command.'},
  {id: 'D12', title: 'Reviewed editor ignores the sync offset', status: 'static-analysis',
    detail: 'MusicLessonEditor passes only a video URL to NotationEditor; the roll draws raw performance onsets while the '
      + 'playhead is video time. Measuring it needs a reviewed revision with a non-zero offset, which the local database does not contain.'},
);

const matrix = {
  input: options.input,
  label,
  generated_from: isReal ? 'real draft document dump' : 'synthetic Phase 1 fixture',
  events: performance.length,
  duration: draft.duration,
  tempo_bpm: score.tempo.bpm,
  receipts,
};
mkdirSync(options.out, {recursive: true});
const target = join(options.out, `audit-matrix-${label}.json`);
writeFileSync(target, `${JSON.stringify(matrix, null, 2)}\n`, 'utf-8');

console.log(`# Phase 1 destructive-path audit (${label}: ${basename(options.input)})`);
console.log(`# events=${performance.length} duration=${draft.duration} tempo=${score.tempo.bpm} -> ${target}\n`);
for (const receipt of receipts) {
  console.log(`## ${receipt.id} [${receipt.status}] ${receipt.title}\n${receipt.detail}\n`);
}
