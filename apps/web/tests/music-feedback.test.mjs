import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRunFeedback, calibrateLatency, feedbackEligibility} from '../src/music/music-feedback.ts';
import {parseMusicReference} from '../src/music/music-reference.ts';

const reference = {
  reference_version: 1, subject: 'piano', instrument: {instrument: 'piano'}, duration: 4,
  events: [
    {id: 'a', onset: 1.0, duration: 0.3, pitch: 60, optional: false},
    {id: 'b', onset: 1.4, duration: 0.3, pitch: 64, optional: false},
    {id: 'opt', onset: 1.8, duration: 0.3, pitch: 67, optional: true},
  ],
  spans: [{start: 0.5, end: 2}],
};
const base = {reference, sectionId: 'phrase', start: 0.5, end: 2.0, speed: 1, run: 0, latencyMs: 0, latencyMeasured: false};

function feedback(attacks, overrides = {}) {
  return buildRunFeedback({...base, attacks, ...overrides});
}

test('calibration takes a clamped median and needs four taps', () => {
  assert.equal(calibrateLatency([20, 30, 40, 50]), 35);
  assert.equal(calibrateLatency([10, 20, 30, 40, 50]), 30);
  assert.equal(calibrateLatency([10, 20, 500, 30, 40]), 25);
  assert.throws(() => calibrateLatency([10, 20, 30]), /four notes/);
});

test('watch-only rubrics and missing input are refused with reasons', () => {
  const watch = feedbackEligibility({assessment: {rubric_version: 'x', assessment: 'none', input_modes: ['none'], dimensions: []},
    subject: 'piano', referenceReviewed: true, inputSelected: true, latencyMeasured: true});
  assert.equal(watch.eligible, false);
  assert.match(watch.reasons.join(' '), /no MIDI note rubric/);
  const good = feedbackEligibility({assessment: {rubric_version: 'piano-midi-v1', assessment: 'notes', input_modes: ['midi'], dimensions: ['pitch','timing']},
    subject: 'piano', referenceReviewed: true, inputSelected: true, latencyMeasured: true});
  assert.equal(good.eligible, true);
  const noInput = feedbackEligibility({assessment: {rubric_version: 'piano-midi-v1', assessment: 'notes', input_modes: ['midi'], dimensions: ['pitch','timing']},
    subject: 'piano', referenceReviewed: true, inputSelected: false, latencyMeasured: false});
  assert.equal(noInput.eligible, false);
  assert.match(noInput.reasons.join(' '), /keyboard input/);
  assert.match(noInput.warnings.join(' '), /approximate/);
});

test('matching produces corrections without a score and never grades optional misses', () => {
  const result = feedback([{id: 'x', pitch: 60, sourceTime: 1.02}, {id: 'y', pitch: 64, sourceTime: 1.44}]);
  assert.equal(result.status, 'complete');
  assert.equal(result.matched, 2);
  assert.equal(result.missing, 0);
  assert.equal(result.extra, 0);
  assert.equal(result.notes.filter(note => note.status === 'matched').length, 2);
  assert.equal(result.notes.find(note => note.status === 'matched')?.timing, 'on-time');
  assert.ok(!('score' in result));
  const missingRequired = feedback([{id: 'x', pitch: 60, sourceTime: 1.02}]);
  assert.equal(missingRequired.missing, 1);
  assert.equal(missingRequired.notes.find(note => note.status === 'missing')?.name, 'E4');
  const withoutOptional = feedback([]);
  assert.equal(withoutOptional.missing, 2, 'only the two required notes are missing');
});

test('extra notes are reported and duplicate evidence invalidates the run', () => {
  const extra = feedback([{id: 'x', pitch: 60, sourceTime: 1.0}, {id: 'y', pitch: 72, sourceTime: 1.6}]);
  assert.equal(extra.extra, 1);
  assert.equal(extra.notes.find(note => note.status === 'extra')?.name, 'C5');
  const invalid = feedback([{id: 'same', pitch: 60, sourceTime: 1}, {id: 'same', pitch: 64, sourceTime: 1.4}]);
  assert.equal(invalid.status, 'invalid');
  assert.match(invalid.reason ?? '', /Invalid/);
  assert.equal(invalid.matched, 0);
});

test('each repeat is analysed independently', () => {
  const first = feedback([{id: 'a1', pitch: 60, sourceTime: 1}, {id: 'a2', pitch: 64, sourceTime: 1.4}], {run: 0});
  const second = feedback([{id: 'b1', pitch: 60, sourceTime: 1}], {run: 1});
  assert.equal(first.run, 0);
  assert.equal(second.run, 1);
  assert.equal(first.matched, 2);
  assert.equal(second.missing, 1);
});


test('unknown rubrics and unsupported dimensions never enable fixed-policy feedback', () => {
  const base={subject:'piano', referenceReviewed:true, inputSelected:true, latencyMeasured:true};
  for(const assessment of [
    {rubric_version:'future-midi-v2',assessment:'notes',input_modes:['midi'],dimensions:['pitch','timing']},
    {rubric_version:'piano-midi-v1',assessment:'notes',input_modes:['midi'],dimensions:['pitch','timing','release']},
    {rubric_version:'piano-midi-v1',assessment:'notes',input_modes:['midi'],dimensions:[]},
  ]) assert.equal(feedbackEligibility({...base,assessment}).eligible,false);
  assert.equal(feedback([],{speed:NaN}).status,'invalid');
  assert.equal(feedback([],{end:5}).status,'invalid');
});

test('coverage reports how much of the reference has a complete assessment window', () => {
  const edged = {...reference, events: [...reference.events, {id: 'edge', onset: 0.55, duration: 0.2, pitch: 72, optional: false}]};
  const result = buildRunFeedback({...base, reference: edged, attacks: [{id: 'x', pitch: 60, sourceTime: 1.0}]});
  assert.equal(result.total, 4);
  assert.equal(result.unassessed, 1);
  assert.equal(result.assessed, 3);
  assert.equal(result.coverage, 0.75);
  assert.ok(!result.notes.some(note => note.name === 'C5'), 'an unassessed edge note is not a correction');
});

test('explanation passages never produce learner corrections', () => {
  const explained = {...reference, duration: 4,
    events: [{id: 'x', onset: 1, duration: 0.3, pitch: 60, optional: false},
             {id: 'y', onset: 2.5, duration: 0.3, pitch: 64, optional: false}],
    spans: [{start: 0, end: 2, kind: 'explanation'}, {start: 2, end: 4, kind: 'playing'}]};
  const result = buildRunFeedback({...base, reference: explained, start: 0, end: 4,
    attacks: [{id: 'a', pitch: 60, sourceTime: 1}, {id: 'b', pitch: 64, sourceTime: 2.5}]});
  assert.equal(result.matched, 1);
  assert.equal(result.missing, 0);
  assert.equal(result.extra, 0);
  assert.equal(result.total, 1);
  assert.deepEqual(result.notes.map(note => note.name), ['E4']);
});

test('passages may not overlap and boundary-crossing notes are unassessed', () => {
  const overlapping = {...reference, spans: [{start: 0, end: 2, kind: 'playing'}, {start: 1.5, end: 3, kind: 'explanation'}]};
  assert.throws(() => parseMusicReference(overlapping), /must not overlap/);
  const boundary = {...reference, duration: 4,
    events: [{id: 'early', onset: 1.6, duration: 0.3, pitch: 60, optional: false},
             {id: 'inside', onset: 3, duration: 0.3, pitch: 64, optional: false}],
    spans: [{start: 0, end: 1, kind: 'explanation'}, {start: 1.5, end: 4, kind: 'playing'}]};
  const result = buildRunFeedback({...base, reference: boundary, start: 0, end: 4, tolerance: 0.15,
    attacks: [{id: 'a', pitch: 60, sourceTime: 1.6}, {id: 'b', pitch: 64, sourceTime: 3}]});
  assert.equal(result.matched, 1);
  assert.equal(result.missing, 0);
  assert.equal(result.extra, 0);
  assert.equal(result.unassessed, 1);
  assert.equal(result.total, 2);
  assert.equal(result.assessed, 1);
});

test('boundary exclusions pair a note and its nearby attack in both directions', () => {
  const boundary = {...reference, duration: 4,
    events: [{id: 'late-expected', onset: 1.2, duration: 0.3, pitch: 60, optional: false},
             {id: 'early-expected', onset: 1.1, duration: 0.3, pitch: 64, optional: false}],
    spans: [{start: 0, end: 1, kind: 'explanation'}, {start: 1, end: 4, kind: 'playing'}]};
  // Expected 1.20 is fully inside, but the learner's 1.10 attack crosses the boundary.
  const earlyAttack = buildRunFeedback({...base, reference: {...boundary, events: [boundary.events[0]]},
    start: 0, end: 4, tolerance: 0.15, attacks: [{id: 'a', pitch: 60, sourceTime: 1.1}]});
  assert.equal(earlyAttack.matched, 0);
  assert.equal(earlyAttack.missing, 0);
  assert.equal(earlyAttack.extra, 0);
  assert.equal(earlyAttack.unassessed, 1);
  // Expected 1.10 is near the boundary; the learner's 1.20 attack must not be extra.
  const lateAttack = buildRunFeedback({...base, reference: {...boundary, events: [boundary.events[1]]},
    start: 0, end: 4, tolerance: 0.15, attacks: [{id: 'b', pitch: 64, sourceTime: 1.2}]});
  assert.equal(lateAttack.matched, 0);
  assert.equal(lateAttack.missing, 0);
  assert.equal(lateAttack.extra, 0);
  assert.equal(lateAttack.unassessed, 1);
});

test('corrections are ordered by reviewed/performance time', () => {
  const result = buildRunFeedback({...base, reference, start: 0.5, end: 2, tolerance: 0.15,
    attacks: [{id: 'extra', pitch: 72, sourceTime: 1.6}, {id: 'b', pitch: 64, sourceTime: 1.4}]});
  assert.deepEqual(result.notes.map(note => note.status), ['missing', 'matched', 'extra']);
  assert.deepEqual(result.notes.map(note => note.time), [1, 1.4, 1.6]);
});
