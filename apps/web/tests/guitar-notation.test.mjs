import {test} from 'node:test';
import assert from 'node:assert/strict';

const {
  buildNotation, applyCommand, assignGuitarFingers, fingerForFret, isPlayablePosition, openStringPitch,
  parseNotationDocument,
} = await import('../../../packages/music-notation/index.ts');
const {restoreFromReference, buildSaveBody} = await import('../src/music/workspace/save-payload.ts');
const {exportPerformanceToMidi} = await import('../src/music/midi-export.ts');
const {diffDocuments, applyPatch} = await import('../src/music/workspace/document-patch.ts');
const {writeRecovery, readRecovery, peekRecovery, sanitizeGuitarChords, salvageGuitarChords} =
  await import('../src/music/workspace/recovery.ts');

const note = (id, onset, pitch, string = null, fret = null) => ({
  id, onset, pitch, duration: 0.4, velocity: 0.7, confidence: null, optional: false, string, fret,
});

function guitarScore(events = [note('n1', 0, 64), note('n2', 0.5, 40), note('n3', 1, 45)]) {
  return buildNotation(events, {subject: 'guitar', duration: 2});
}

test('guitar notation writes one treble staff and a playable position for every note', () => {
  const score = guitarScore();
  assert.equal(score.subject, 'guitar');
  assert.ok(score.events.length > 0);
  assert.ok(score.events.every(event => event.staff === 'treble'));
  for (const occurrence of score.performance) {
    assert.ok(Number.isInteger(occurrence.string) && occurrence.string >= 1 && occurrence.string <= 6);
    assert.ok(Number.isInteger(occurrence.fret) && occurrence.fret >= 0 && occurrence.fret <= 24);
    assert.equal({1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}[occurrence.string] + occurrence.fret,
      occurrence.pitch);
  }
});

test('buildNotation defaults to piano and still splits the grand staff', () => {
  const score = buildNotation([note('low', 0, 40), note('high', 0.5, 72)], {duration: 2});
  assert.equal(score.subject, 'piano');
  assert.notEqual(score.events[0].staff, score.events[1].staff);
});

test('shift-guitar-string keeps the sounding pitch and moves only the fret', () => {
  const score = guitarScore([note('n1', 0, 64)]);
  const before = score.performance[0];
  assert.deepEqual([before.string, before.fret], [1, 0]);
  const outcome = applyCommand(score, {type: 'shift-guitar-string', occurrenceId: 'n1', string: 2});
  assert.equal(outcome.status, 'applied');
  const after = outcome.document.performance[0];
  assert.equal(after.pitch, 64);
  assert.deepEqual([after.string, after.fret], [2, 5]);
});

test('shift-guitar-string rejects a physically impossible string', () => {
  const score = guitarScore([note('n1', 0, 40)]);
  const outcome = applyCommand(score, {type: 'shift-guitar-string', occurrenceId: 'n1', string: 1});
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.code, 'invalid-position');
});

test('set-guitar-position changes pitch, spelling and the occurrence position together', () => {
  const score = guitarScore([note('n1', 0, 64)]);
  const outcome = applyCommand(score, {type: 'set-guitar-position', occurrenceId: 'n1', string: 3, fret: 5});
  assert.equal(outcome.status, 'applied');
  const occurrence = outcome.document.performance[0];
  assert.equal(occurrence.pitch, 60);
  assert.deepEqual([occurrence.string, occurrence.fret], [3, 5]);
  const logical = outcome.document.events.flatMap(event => event.notes)
    .find(item => item.performance_ids.includes('n1'));
  assert.ok(logical);
  assert.equal(logical.spelling, 'C4');
});

test('set-occurrence-pitch keeps guitar string and fret consistent with the new pitch', () => {
  const score = guitarScore([note('n1', 0, 64)]);
  const outcome = applyCommand(score, {type: 'set-occurrence-pitch', occurrenceId: 'n1', pitch: 66});
  assert.equal(outcome.status, 'applied');
  const occurrence = outcome.document.performance[0];
  assert.equal(occurrence.pitch, 66);
  assert.equal({1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}[occurrence.string] + occurrence.fret, 66);
});

test('a legacy guitar draft without notation restores through the shared builder', () => {
  const payload = {
    reference_version: 1, subject: 'guitar', instrument: {instrument: 'guitar'}, duration: 2,
    events: [
      {id: 'n1', onset: 0, duration: 0.4, pitch: 64, velocity: 0.7, confidence: null, optional: false},
      {id: 'n2', onset: 0.6, duration: 0.4, pitch: 40, velocity: 0.7, confidence: null, optional: false},
    ],
    spans: [{start: 0, end: 2, kind: 'playing'}],
    guitar_chords: [{id: 'c1', name: 'C', start: 0, frets: [-1, 3, 2, 0, 1, 0], position: 1}],
  };
  const restored = restoreFromReference(payload);
  assert.equal(restored.ok, true);
  assert.equal(restored.value.source, 'performance');
  assert.equal(restored.value.document.subject, 'guitar');
  assert.equal(restored.value.guitarChords.length, 1);
  assert.ok(restored.value.document.performance.every(item => item.string !== null && item.fret !== null));
});

test('buildSaveBody names the guitar subject and preserves reviewed chord shapes', () => {
  const score = guitarScore();
  const body = buildSaveBody({
    title: 'Guitar', document: score, spans: [{start: 0, end: 2, kind: 'playing'}],
    alignment: null, anchors: [], offsetSeconds: 0, draftId: 'draft-1', referenceSha256: 'a'.repeat(64),
    guitarChords: [{id: 'c1', name: 'C', start: 0, frets: [-1, 3, 2, 0, 1, 0], position: 1}],
  });
  assert.equal(body.subject, 'guitar');
  assert.deepEqual(body.guitar_chords.map(chord => chord.name), ['C']);
});

test('alternate tunings and capo keep every sounding pitch playable', () => {
  const built = buildNotation([note('low-d', 0, 40)], {
    subject: 'guitar', duration: 1, guitar_tuning: 'drop_d', guitar_capo: 2,
  });
  assert.equal(built.guitar_tuning, 'drop_d');
  assert.equal(built.guitar_capo, 2);
  assert.deepEqual([built.performance[0].string, built.performance[0].fret], [6, 0]);
  const expected = {
    drop_d: {1: [0, 64], 6: [2, 40]},
    half_step_down: {1: [1, 64], 6: [1, 40]},
    dadgad: {1: [2, 64], 6: [2, 40]},
  };
  for (const [tuning, positions] of Object.entries(expected)) {
    const score = guitarScore([note('high', 0, 64), note('low', 0.5, 40)]);
    const outcome = applyCommand(score, {type: 'set-guitar-setup', tuning});
    assert.equal(outcome.status, 'applied', tuning);
    assert.equal(outcome.document.guitar_tuning, tuning);
    for (const occurrence of outcome.document.performance) {
      const [fret, pitch] = positions[occurrence.string];
      assert.equal(occurrence.pitch, pitch);
      assert.equal(occurrence.fret, fret, `${tuning} string ${occurrence.string}`);
      assert.equal(openStringPitch(occurrence.string, {tuning, capo: 0}) + occurrence.fret, occurrence.pitch);
    }
  }
  const score = guitarScore([note('high', 0, 64), note('low', 0.5, 40)]);
  const capo = applyCommand(score, {type: 'set-guitar-setup', tuning: 'standard', capo: 2});
  assert.equal(capo.status, 'applied');
  assert.equal(capo.document.guitar_capo, 2);
  const high = capo.document.performance.find(item => item.pitch === 64);
  assert.ok(high && high.string !== null && high.fret !== null);
  assert.equal(openStringPitch(high.string, {tuning: 'standard', capo: 2}) + high.fret, 64);
  // A capo at fret 2 makes E2 unplayable, so it is left unpositioned rather than faked.
  const low = capo.document.performance.find(item => item.pitch === 40);
  assert.equal(low.string, null);
  assert.equal(low.fret, null);
});

test('set-guitar-setup participates in Undo/Redo document patches', () => {
  const before = guitarScore([note('n1', 0, 64), note('n2', 0.5, 40)]);
  const outcome = applyCommand(before, {type: 'set-guitar-setup', tuning: 'drop_d'});
  assert.equal(outcome.status, 'applied');
  const patch = diffDocuments(before, outcome.document);
  assert.ok(patch.guitar);
  assert.equal(patch.guitar.tuningBefore, 'standard');
  assert.equal(patch.guitar.tuningAfter, 'drop_d');
  const undone = applyPatch(outcome.document, patch, 'before');
  assert.equal(undone.guitar_tuning, 'standard');
  assert.deepEqual(undone.performance.map(item => [item.string, item.fret]),
    before.performance.map(item => [item.string, item.fret]));
  const redone = applyPatch(undone, patch, 'after');
  assert.equal(redone.guitar_tuning, 'drop_d');
  assert.deepEqual(redone.performance.map(item => [item.string, item.fret]),
    outcome.document.performance.map(item => [item.string, item.fret]));
});

test('a non-standard guitar save leaves top-level events unpositioned but keeps notation positions', () => {
  const score = applyCommand(guitarScore([note('n1', 0, 64), note('n2', 0.5, 40)]),
    {type: 'set-guitar-setup', tuning: 'drop_d'}).document;
  const body = buildSaveBody({
    title: 'Drop D', document: score, spans: [{start: 0, end: 2, kind: 'playing'}],
    alignment: null, anchors: [], offsetSeconds: 0, draftId: 'draft-1', referenceSha256: 'a'.repeat(64),
  });
  assert.equal(body.notation.guitar_tuning, 'drop_d');
  assert.ok(body.events.every(event => event.string === null && event.fret === null));
  assert.ok(body.notation.performance.every(item => item.string !== null && item.fret !== null));
});

test('finger assignment uses 0 for open strings and 1-4 across a four-fret window', () => {
  assert.equal(fingerForFret(0, 3), 0);
  assert.deepEqual([3, 4, 5, 6].map(fret => fingerForFret(fret, 3)), [1, 2, 3, 4]);
  const fingers = assignGuitarFingers([
    {id: 'open', onset: 0, string: 1, fret: 0, pitch: 64},
    {id: 'i', onset: 0.2, string: 2, fret: 3, pitch: 62},
    {id: 'm', onset: 0.4, string: 2, fret: 4, pitch: 63},
    {id: 'r', onset: 0.6, string: 2, fret: 5, pitch: 64},
    {id: 'p', onset: 0.8, string: 2, fret: 6, pitch: 65},
  ]);
  assert.deepEqual(fingers, {open: 0, i: 1, m: 2, r: 3, p: 4});
});

test('local recovery round-trips guitar chords and rejects malformed shapes', () => {
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  }});
  const identity = {accountId: 'a', lessonId: 'l', draftId: 'd', sourceSha256: 's'};
  const chord = {id: 'c1', name: 'C', start: 0, frets: [-1, 3, 2, 0, 1, 0], position: 1};
  assert.equal(writeRecovery({identity, title: 'T', notation: {a: 1}, alignment: null,
    offsetSeconds: 0, spans: [], guitarChords: [chord]}), true);
  const restored = readRecovery(identity);
  assert.equal(restored.status, 'restored');
  assert.deepEqual(restored.checkpoint.guitarChords, [chord]);
  assert.equal(writeRecovery({identity, title: 'T', notation: {a: 1}, alignment: null,
    offsetSeconds: 0, spans: [], guitarChords: [{...chord, frets: [25, 3, 2, 0, 1, 0]}]}), true);
  const rejected = readRecovery(identity);
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.reason, /invalid guitar chords/);
});

test('recovery accepts a blank chord name and peek validates/sanitizes chords', () => {
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  }});
  const identity = {accountId: 'a', lessonId: 'l', draftId: 'd', sourceSha256: 's'};
  const chord = {id: 'c1', name: '', start: 0, frets: [-1, 3, 2, 0, 1, 0], position: 1};
  assert.equal(writeRecovery({identity, title: 'T', notation: {a: 1}, alignment: null,
    offsetSeconds: 0, spans: [], guitarChords: [chord]}), true);
  const restored = readRecovery(identity);
  assert.equal(restored.status, 'restored');
  assert.equal(restored.checkpoint.guitarChords[0].name, 'Chord');
  assert.ok(peekRecovery());
  // A stale-base peek must reject a structurally malformed chord list, not bypass it.
  assert.equal(writeRecovery({identity, title: 'T', notation: {a: 1}, alignment: null,
    offsetSeconds: 0, spans: [], guitarChords: [{...chord, frets: [1, 2]}]}), true);
  assert.equal(peekRecovery(), null);
  assert.equal(sanitizeGuitarChords([{...chord, name: '  '}])[0].name, 'Chord');
  assert.equal(sanitizeGuitarChords([{...chord, frets: [1, 2]}]), null);
});

test('finger assignment is stable for simultaneous notes and includes sustained notes', () => {
  const chord = [
    {id: 'z', onset: 0, string: 6, fret: 3, pitch: 43},
    {id: 'a', onset: 0, string: 5, fret: 4, pitch: 49},
    {id: 'm', onset: 0, string: 4, fret: 5, pitch: 55},
  ];
  const first = assignGuitarFingers(chord);
  const reversed = assignGuitarFingers([...chord].reverse());
  for (const note of chord) assert.equal(first[note.id], reversed[note.id]);
  assert.deepEqual([first.z, first.a, first.m], [1, 2, 3]);

  const sustained = assignGuitarFingers([
    {id: 'held', onset: 0, duration: 3, string: 2, fret: 5, pitch: 64},
    {id: 'later', onset: 2, duration: 0.2, string: 3, fret: 7, pitch: 62},
  ]);
  // The held note keeps the hand at fret 5, so fret 7 is the ring finger (3).
  assert.equal(sustained.later, 3);
});

test('parseNotationDocument treats null tuning/capo like undefined', () => {
  const score = guitarScore([note('n1', 0, 64, 1, 0)]);
  const parsed = parseNotationDocument({...score, guitar_tuning: null, guitar_capo: null});
  assert.equal(parsed.subject, 'guitar');
  assert.equal(parsed.guitar_tuning, undefined);
  assert.equal(parsed.guitar_capo, undefined);
});

test('salvageGuitarChords keeps 100 shapes and falls back only when unrecoverable', () => {
  const make = index => ({id: `c${index}`, name: `C${index}`, start: index,
    frets: [-1, 3, 2, 0, 1, 0], position: 1});
  const hundredOne = Array.from({length: 101}, (_, index) => make(index));
  const capped = salvageGuitarChords(hundredOne);
  assert.equal(capped.length, 100);
  assert.equal(capped[0].id, 'c0');
  const mixed = salvageGuitarChords([make(1), {id: 'bad', name: '', start: 0, frets: [1], position: 1}, make(2)]);
  assert.deepEqual(mixed.map(chord => chord.id), ['c1', 'c2']);
  const fallback = [make(9)];
  assert.deepEqual(salvageGuitarChords([{id: 'bad'}], fallback).map(chord => chord.id), ['c9']);
  assert.deepEqual(salvageGuitarChords([], fallback), []);
});

test('guitar MIDI export emits six string channels and a guitar program', () => {
  const bytes = exportPerformanceToMidi(
    [{id: 'a', pitch: 64, onset: 0, duration: 0.4, velocity: 0.8, string: 1},
      {id: 'b', pitch: 40, onset: 0, duration: 0.4, velocity: 0.8, string: 6}],
    [], {subject: 'guitar', program: 25},
  );
  let sawSteel = false;
  const channels = new Set();
  for (let index = 0; index + 1 < bytes.length; index += 1) {
    const status = bytes[index];
    if (status >= 0xc0 && status <= 0xc5 && bytes[index + 1] === 25) {
      sawSteel = true;
      channels.add(status & 0x0f);
    }
  }
  assert.equal(sawSteel, true);
  assert.equal(channels.size, 6);
  assert.equal(isPlayablePosition(64, 1, 0), true);
  assert.equal(isPlayablePosition(64, 1, 1), false);
});
