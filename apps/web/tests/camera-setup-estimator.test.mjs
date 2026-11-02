import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StableHeightCalibration, SETUP_MEASUREMENT_DEFAULTS} from '../src/camera-setup-estimator.ts';
import {setupPose, compressPose, hidePose, INDEX} from './setup-pose-fixture.mjs';

const pose = setupPose();

/** Feed a stable stream at `hz` for `ms`; returns every observation. */
function stream(estimator, {hz, ms, pose: frames = pose}) {
  const period = 1000 / hz;
  const observations = [];
  for (let t = 0; t <= ms + 1e-9; t += period) observations.push({at: t, result: estimator.observe(frames.image, frames.world, t)});
  return observations;
}

function completedAt(observations) {
  const done = observations.find(entry => entry.result.phase === 'done');
  return done ? done.at : null;
}

test('a stable stream completes at every supported observation rate', () => {
  const summary = {};
  for (const hz of [4, 6, 8, 10, 14]) {
    const estimator = new StableHeightCalibration();
    const observations = stream(estimator, {hz, ms: 11000});
    const at = completedAt(observations);
    assert.ok(at !== null, `${hz} Hz must complete`);
    assert.equal(estimator.measurement.value !== null, true);
    summary[hz] = at;
    // The 30-sample requirement binds below 10 Hz and the duration requirement
    // binds above it, exactly as documented.
    assert.ok(at < SETUP_MEASUREMENT_DEFAULTS.maxCandidateMs, `${hz} Hz completed inside the candidate bound`);
  }
  // The legacy 3000 ms window made 6, 8 and 9 Hz impossible. This is the
  // regression that matters: slower streams now take longer instead of failing.
  assert.ok(summary[4] > summary[6], '4 Hz is slower than 6 Hz');
  assert.ok(summary[6] > summary[10], '6 Hz is slower than 10 Hz');
  assert.ok(summary[4] <= 8000, '4 Hz completes well inside the bound');
});

test('rates below the supported bound expire into recovery instead of stalling', () => {
  for (const hz of [1, 2, 2.5]) {
    const estimator = new StableHeightCalibration();
    const observations = stream(estimator, {hz, ms: 13000});
    const expired = observations.find(entry => entry.result.phase === 'expired');
    assert.ok(expired, `${hz} Hz must expire`);
    assert.equal(expired.result.reason, 'slow');
    assert.equal(estimator.measurement.value, null);
    assert.ok(expired.result.progress < 1, `${hz} Hz must not report completion`);
    assert.ok(observations.every(entry => entry.result.phase !== 'done'));
  }
});

test('3 Hz is still supported, because the sample requirement is what binds', () => {
  const estimator = new StableHeightCalibration();
  const observations = stream(estimator, {hz: 3, ms: 11000});
  assert.ok(completedAt(observations) !== null);
});

test('duplicate and out-of-order timestamps never add evidence', () => {
  const estimator = new StableHeightCalibration();
  for (let i = 0; i < 5; i++) estimator.observe(pose.image, pose.world, i * 100);
  const before = estimator.measurement.samples;
  const duplicate = estimator.observe(pose.image, pose.world, 400);
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(duplicate.accepted, false);
  assert.equal(estimator.measurement.samples, before);
  const reordered = estimator.observe(pose.image, pose.world, 250);
  assert.equal(reordered.reason, 'out_of_order');
  assert.equal(reordered.accepted, false);
  assert.equal(estimator.measurement.samples, before);
  const nonFinite = estimator.observe(pose.image, pose.world, Number.NaN);
  assert.equal(nonFinite.reason, 'rejected_timestamp');
  assert.equal(estimator.measurement.samples, before);
  // A later valid timestamp still counts.
  const next = estimator.observe(pose.image, pose.world, 500);
  assert.equal(next.accepted, true);
  assert.equal(estimator.measurement.samples, before + 1);
});

test('invalid observations pause progress without adding samples or credited time', () => {
  const estimator = new StableHeightCalibration();
  for (let t = 0; t < 1000; t += 100) estimator.observe(pose.image, pose.world, t);
  const pausedAt = estimator.measurement;
  assert.ok(pausedAt.progress > 0);
  const blocked = hidePose(pose, [INDEX.leftAnkle], 0.3);
  let paused;
  for (let t = 1000; t < 1400; t += 100) paused = estimator.observe(blocked.image, blocked.world, t);
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.accepted, false);
  assert.equal(paused.progress, pausedAt.progress);
  assert.equal(paused.samples, pausedAt.samples);
  assert.equal(paused.acceptedMs, pausedAt.acceptedMs);
  // Resuming inside the tolerance continues, but the paused interval is never
  // credited as observed stability.
  const resumed = estimator.observe(pose.image, pose.world, 1500);
  assert.equal(resumed.accepted, true);
  assert.equal(resumed.reset, false);
  assert.equal(resumed.acceptedMs, pausedAt.acceptedMs, 'the first observation after a pause credits no time');
  assert.equal(resumed.samples, pausedAt.samples + 1);
});

test('a briefly occluded wrist is a positioning concern, not a measurement reset', () => {
  const estimator = new StableHeightCalibration();
  for (let t = 0; t < 800; t += 100) estimator.observe(pose.image, pose.world, t);
  const before = estimator.measurement;
  const wristHidden = hidePose(pose, [INDEX.leftWrist], 0.3);
  const result = estimator.observe(wristHidden.image, wristHidden.world, 800);
  assert.equal(result.accepted, true, 'the standing assessment does not require wrists');
  assert.equal(result.phase, 'collecting');
  assert.equal(result.samples, before.samples + 1);
  assert.equal(result.reset, false);
});

test('an interruption beyond the tolerance discards the candidate', () => {
  const estimator = new StableHeightCalibration();
  for (let t = 0; t < 1200; t += 100) estimator.observe(pose.image, pose.world, t);
  assert.ok(estimator.measurement.progress > 0);
  // A known invalid stretch, then a valid observation more than 600 ms after the
  // last accepted evidence: this is an interruption, not a slow stream.
  const blocked = hidePose(pose, [INDEX.leftAnkle], 0.3);
  estimator.observe(blocked.image, blocked.world, 1200);
  const resumed = estimator.observe(pose.image, pose.world, 1200 + SETUP_MEASUREMENT_DEFAULTS.interruptionToleranceMs + 1);
  assert.equal(resumed.reset, true);
  assert.equal(resumed.resetReason, 'interrupted');
  assert.equal(resumed.samples, 1);
  assert.equal(resumed.acceptedMs, 0);
  assert.equal(resumed.progress, 0);
});

test('a slow but continuous stream is not treated as an interruption', () => {
  // Regression: applying the 600 ms tolerance to consecutive accepted
  // observations reset every 1 Hz frame forever and stalled progress at zero,
  // which is the failure mode the adapter exists to remove.
  const estimator = new StableHeightCalibration();
  let resets = 0;
  let t = 0;
  for (let i = 0; i < 12; i++, t += 1000) {
    const result = estimator.observe(pose.image, pose.world, t);
    if (result.reset) resets++;
  }
  assert.equal(resets, 0, 'a 1 Hz stream is slow, not interrupted');
  assert.ok(estimator.measurement.samples > 10);
  const expired = estimator.expireIfStale(t + 20000);
  assert.equal(expired.phase, 'expired', 'the candidate age bound still catches it');
});

test('a meaningful posture change resets instead of continuing the candidate', () => {
  const estimator = new StableHeightCalibration();
  let t = 0;
  for (; t < 1200; t += 100) estimator.observe(pose.image, pose.world, t);
  const shorter = setupPose({feet: 0.86});
  const changed = estimator.observe(shorter.image, shorter.world, t);
  assert.equal(changed.reset, true);
  assert.equal(changed.resetReason, 'changed');
  assert.equal(changed.samples, 1);
});

test('completion never happens on an invalid observation', () => {
  const estimator = new StableHeightCalibration();
  // 29 accepted observations and >2.5 s of credit: one valid sample short.
  let t = 0;
  for (let i = 0; i < 29; i++, t += 100) estimator.observe(pose.image, pose.world, t);
  const beforeInvalid = estimator.measurement;
  assert.ok(beforeInvalid.samples < SETUP_MEASUREMENT_DEFAULTS.minSamples || beforeInvalid.acceptedMs < SETUP_MEASUREMENT_DEFAULTS.minAcceptedMs);
  const blocked = hidePose(pose, [INDEX.leftFoot], 0.2);
  const invalid = estimator.observe(blocked.image, blocked.world, t);
  assert.notEqual(invalid.phase, 'done');
  assert.equal(invalid.value, null);
  // Only a fresh valid observation completes it.
  const valid = estimator.observe(pose.image, pose.world, t + 100);
  assert.equal(valid.phase, 'done');
  assert.ok(valid.value && valid.value.height > 0);
});

test('progress never moves backwards inside a candidate', () => {
  const estimator = new StableHeightCalibration();
  let previous = 0;
  for (let t = 0; t <= 2600; t += 70) {
    const result = estimator.observe(pose.image, pose.world, t);
    assert.ok(result.progress >= previous - 1e-9, `progress regressed at ${t}`);
    previous = result.progress;
  }
  assert.equal(estimator.measurement.phase, 'done');
  assert.equal(estimator.measurement.progress, 1);
});

test('sample storage stays bounded on a long candidate', () => {
  const settings = {...SETUP_MEASUREMENT_DEFAULTS, minAcceptedMs: 20000, maxCandidateMs: 20000, maxStoredSamples: 16};
  const estimator = new StableHeightCalibration(settings);
  // Far more observations than the ring holds, with no completion possible.
  for (let t = 0; t <= 9000; t += 70) estimator.observe(pose.image, pose.world, t);
  assert.equal(estimator.storedSamples, 16);
  assert.ok(estimator.measurement.samples > 16);
});

test('a candidate with no further observations expires when the controller asks', () => {
  const estimator = new StableHeightCalibration();
  for (let t = 0; t < 1000; t += 100) estimator.observe(pose.image, pose.world, t);
  const before = estimator.expireIfStale(5000);
  assert.notEqual(before.phase, 'expired');
  const expired = estimator.expireIfStale(SETUP_MEASUREMENT_DEFAULTS.maxCandidateMs + 1);
  assert.equal(expired.phase, 'expired');
  assert.equal(expired.reason, 'slow');
  // An expired candidate does not silently restart.
  const after = estimator.observe(pose.image, pose.world, 10000);
  assert.equal(after.phase, 'expired');
  assert.equal(after.accepted, false);
  // Only an explicit reset starts a new candidate.
  estimator.reset();
  const restarted = estimator.observe(pose.image, pose.world, 10100);
  assert.equal(restarted.phase, 'collecting');
  assert.equal(restarted.samples, 1);
});

test('reset clears the candidate but keeps capture timestamps monotonic', () => {
  const estimator = new StableHeightCalibration();
  for (let t = 0; t < 500; t += 100) estimator.observe(pose.image, pose.world, t);
  estimator.reset();
  assert.equal(estimator.measurement.phase, 'idle');
  assert.equal(estimator.measurement.samples, 0);
  const replay = estimator.observe(pose.image, pose.world, 300);
  assert.equal(replay.reason, 'out_of_order');
  assert.equal(replay.accepted, false);
  const repeated = estimator.observe(pose.image, pose.world, 400);
  assert.equal(repeated.reason, 'duplicate');
  const fresh = estimator.observe(pose.image, pose.world, 500);
  assert.equal(fresh.accepted, true);
});

test('malformed landmarks pause measurement instead of throwing or becoming evidence', () => {
  const estimator = new StableHeightCalibration();
  for (let t = 0; t < 600; t += 100) estimator.observe(pose.image, pose.world, t);
  const before = estimator.measurement;
  const short = estimator.observe(pose.image.slice(0, 20), pose.world.slice(0, 20), 600);
  assert.equal(short.phase, 'paused');
  assert.equal(short.reason, 'invalid');
  assert.equal(short.samples, before.samples);
  const nan = pose.image.map(point => ({...point}));
  nan[27].x = Number.NaN;
  const nanWorld = pose.world.map(point => ({...point}));
  const poisoned = estimator.observe(nan, nanWorld, 700);
  assert.equal(poisoned.phase, 'paused');
  assert.equal(poisoned.samples, before.samples);
  const empty = estimator.observe(null, null, 800);
  assert.equal(empty.phase, 'paused');
  assert.equal(empty.reason, 'no_person');
});

test('low confidence on a core landmark is not measurement evidence', () => {
  const estimator = new StableHeightCalibration();
  for (let t = 0; t < 600; t += 100) estimator.observe(pose.image, pose.world, t);
  const before = estimator.measurement.samples;
  const occluded = hidePose(pose, [INDEX.leftAnkle], 0.3);
  const result = estimator.observe(occluded.image, occluded.world, 600);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'occluded');
  assert.equal(estimator.measurement.samples, before);
});

test('the adapter leaves the legacy estimator untouched', async () => {
  const {HeightCalibration} = await import('../../../web/dist/pose.js');
  const legacy = new HeightCalibration();
  const adapter = new StableHeightCalibration();
  // The legacy class still resets on an invalid sample; the adapter pauses.
  for (let t = 0; t < 1000; t += 100) {
    legacy.sample(pose.image, pose.world, t);
    adapter.observe(pose.image, pose.world, t);
  }
  const blocked = hidePose(pose, [INDEX.leftAnkle], 0.3);
  legacy.sample(blocked.image, blocked.world, 1000);
  const paused = adapter.observe(blocked.image, blocked.world, 1000);
  assert.deepEqual(legacy.samples, [], 'legacy behaviour is unchanged');
  assert.ok(paused.samples > 0, 'adapter keeps its candidate');
});
