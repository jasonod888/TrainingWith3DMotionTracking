import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNotation, changeDuration, changeNoteStaff, changePitch, deleteNote, deleteRest, insertNote, insertRest,
  parseNotationDocument, setPerformanceDuration, setTempo, tieToNext, toMusicXML, type PerformanceNote,
} from '../../packages/music-notation/index';

const note = (id: string, onset: number, duration: number | null, pitch: number, velocity = 0.6): PerformanceNote => ({
  id, onset, duration, pitch, velocity, confidence: null, optional: false, string: null, fret: null,
});

/** Two measures at 120 BPM: a held treble line over a chord+melody, and a bass line. */
const performance: PerformanceNote[] = [
  note('bass-c', 0, 2, 48),
  note('treble-e', 0.5, 0.5, 64),
  note('treble-g', 0.5, 0.5, 67),
  note('treble-hold', 0.5, 2, 71),
  note('treble-c', 1, 0.5, 72),
  note('treble-d', 1.5, 0.5, 74),
  note('bass-g', 2, 2, 43),
];

function document() {
  return buildNotation(performance, {bpm: 120, time_signature: {numerator: 4, denominator: 4}, key_signature: 'C', duration: 4});
}

test('the score keeps both staves, chords, voices, rests and barline ties', () => {
  const score = document();
  assert.equal(score.measures.length, 2);
  assert.deepEqual(new Set(score.events.map(event => event.staff)), new Set(['treble', 'bass']));
  const chord = score.events.find(event => event.notes.some(item => item.performance_ids.includes('treble-e')));
  assert.ok(chord);
  assert.deepEqual(chord.notes.map(item => item.pitch), [64, 67]);
  assert.deepEqual(new Set(score.events.filter(event => event.staff === 'treble').map(event => event.voice)), new Set([1, 2]));
  assert.ok(score.segments.some(segment => segment.generated_rest));
  const hold = score.events.find(event => event.notes.some(item => item.performance_ids.includes('treble-hold')));
  assert.ok(hold);
  assert.equal(hold.duration, 1920);
  const holdSegments = score.segments.filter(segment => segment.notes.some(item => item.logical_note_id === hold.notes[0].id));
  assert.equal(holdSegments.length, 2);
  assert.equal(score.ties.length, 1);
  assert.equal(score.ties[0].pitch, 71);
  assert.equal(score.performance_map['treble-e'], chord.notes.find(item => item.pitch === 64)!.id);
});

test('changing one pitch inside a chord leaves its neighbour and the timing untouched', () => {
  const score = document();
  const chord = score.events.find(event => event.notes.some(item => item.performance_ids.includes('treble-e')))!;
  const e = chord.notes.find(item => item.performance_ids.includes('treble-e'))!;
  const edited = changePitch(score, e.id, 65);
  const editedChord = edited.events.find(event => event.notes.some(item => item.performance_ids.includes('treble-e')))!;
  assert.deepEqual(editedChord.notes.map(item => item.pitch), [65, 67]);
  assert.equal(edited.performance.find(item => item.id === 'treble-e')!.pitch, 65);
  assert.equal(edited.performance.find(item => item.id === 'treble-g')!.pitch, 67);
  assert.equal(edited.performance.find(item => item.id === 'treble-e')!.onset, 0.5);
});

test('quarter to half to whole overwrites the same voice and ties across the barline', () => {
  const score = document();
  const chord = score.events.find(event => event.notes.some(item => item.performance_ids.includes('treble-e')))!;
  const half = changeDuration(score, chord.id, 960);
  assert.equal(half.events.find(event => event.id === chord.id)!.duration, 960);
  // The half note covers the next melody note in the same voice.
  assert.ok(!half.events.some(event => event.notes.some(item => item.performance_ids.includes('treble-c'))));
  const whole = changeDuration(half, chord.id, 1920);
  const edited = whole.events.find(event => event.id === chord.id)!;
  assert.equal(edited.duration, 1920);
  const segments = whole.segments.filter(segment => segment.event_id === chord.id);
  assert.deepEqual(segments.map(segment => segment.duration), [1440, 480]);
  assert.equal(whole.ties.filter(tie => segments.some(segment => segment.notes.some(item => item.logical_note_id === tie.from_segment_note_id.split(':')[0]))).length >= 1, true);
  // The written length, not the source length, drives linked performance playback.
  assert.equal(whole.performance.find(item => item.id === 'treble-e')!.duration, 2);
  // Overwritten material cannot survive as a ghost note in the roll.
  assert.ok(!whole.performance.some(item => item.id === 'treble-c'));
});

test('notes and rests can be added, tied and deleted', () => {
  const score = document();
  const inserted = insertNote(score, {pitch: 76, start: 2880, duration: 480, staff: 'treble', voice: 1});
  const added = inserted.events.find(event => event.notes.some(item => item.pitch === 76));
  assert.ok(added);
  const deleted = deleteNote(inserted, added.notes[0].id);
  assert.ok(!deleted.events.some(event => event.notes.some(item => item.pitch === 76)));
  assert.ok(!deleted.performance.some(item => item.pitch === 76));
  const rest = insertRest(deleted, {start: 0, duration: 480, staff: 'treble', voice: 1});
  assert.ok(rest.segments.some(segment => segment.rest && segment.start === 0));
  const restEvent = rest.events.find(event => event.rest && event.start === 0)!;
  const closed = deleteRest(rest, restEvent.id);
  assert.ok(!closed.events.some(event => event.id === restEvent.id));
  const tieSource = document();
  const held = tieSource.events.find(event => event.notes.some(item => item.performance_ids.includes('bass-c')))!;
  const next = insertNote(tieSource, {pitch: 48, start: 1920, duration: 480, staff: 'bass', voice: 1});
  const firstBass = next.events.find(event => event.start === 0 && event.staff === 'bass' && event.notes.some(item => item.pitch === 48))!;
  const tied = tieToNext(next, firstBass.notes[0].id);
  assert.equal(tied.events.find(event => event.id === firstBass.id)!.duration, 2400);
  assert.ok(tied.ties.some(tie => tie.pitch === 48));
  assert.equal(held.start, 0);
});

test('a chord note can move to the other staff without dragging its neighbours', () => {
  const score = document();
  const chord = score.events.find(event => event.notes.some(item => item.performance_ids.includes('treble-e')))!;
  const e = chord.notes.find(item => item.performance_ids.includes('treble-e'))!;
  const moved = changeNoteStaff(score, e.id, 'bass');
  const old = moved.events.find(event => event.id === chord.id)!;
  assert.deepEqual(old.notes.map(item => item.pitch), [67]);
  const split = moved.events.find(event => event.notes.some(item => item.id === e.id))!;
  assert.equal(split.staff, 'bass');
  assert.equal(split.notes[0].pitch, 64);
  assert.ok(moved.performance.some(item => item.id === 'treble-e'));
});

test('tempo changes playback seconds without changing video-relative performance or notation ticks', () => {
  const score = document();
  const before = score.performance.map(item => item.onset);
  const edited = setTempo(score, 60);
  assert.equal(edited.tempo.bpm, 60);
  assert.deepEqual(edited.performance.map(item => item.onset), before);
  assert.deepEqual(edited.events.map(event => [event.start, event.duration]), score.events.map(event => [event.start, event.duration]));
});

test('performance sustain can differ from the written value without rewriting the staff', () => {
  const score = document();
  const e = score.events.find(event => event.notes.some(item => item.performance_ids.includes('treble-e')))!.notes[0];
  const edited = setPerformanceDuration(score, e.id, 1.75);
  const written = edited.events.find(event => event.notes.some(item => item.id === e.id))!;
  assert.equal(written.duration, 480);
  assert.equal(edited.performance.find(item => item.id === 'treble-e')!.duration, 1.75);
});

test('a saved document round-trips through the strict reader', () => {
  const score = changePitch(document(), document().events.find(event => event.notes.some(item => item.performance_ids.includes('treble-e')))!.notes[0].id, 65);
  const parsed = parseNotationDocument(JSON.parse(JSON.stringify(score)));
  assert.equal(parsed.events.length, score.events.length);
  assert.equal(parsed.segments.length, score.segments.length);
  assert.equal(parsed.ties.length, score.ties.length);
  assert.deepEqual(parsed.performance, score.performance);
  // Derived data is rebuilt rather than trusted from the saved document.
  const stripped = parseNotationDocument({...JSON.parse(JSON.stringify(score)), segments: [], ties: []});
  assert.equal(stripped.segments.length, score.segments.length);
  assert.equal(stripped.ties.length, score.ties.length);
  assert.throws(() => parseNotationDocument({...JSON.parse(JSON.stringify(score)), ppq: 960}), /tick resolution/);
});

test('MusicXML export contains both staves, voices, ties, rests and a metronome mark', () => {
  const score = document();
  const xml = toMusicXML(score, {title: 'A & B <test>'});
  assert.match(xml, /<score-partwise version="4.0">/);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<clef number="2"><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.match(xml, /<voice>2<\/voice>/);
  assert.match(xml, /<backup><duration>1920<\/duration><\/backup>/);
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<tied type="stop"\/>/);
  assert.match(xml, /<rest/);
  assert.match(xml, /<per-minute>120<\/per-minute>/);
  assert.match(xml, /A &amp; B &lt;test&gt;/);
  assert.match(xml, /<staff>2<\/staff>/);
  assert.equal((xml.match(/<measure /g) ?? []).length, 2);
});
