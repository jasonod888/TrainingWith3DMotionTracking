import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CameraSetupController, SETUP_DEFAULTS, GUIDED_HANDOFF_SECONDS, sourceKey} from '../src/camera-setup-controller.ts';
import {setupPose, hidePose, compressPose, INDEX} from './setup-pose-fixture.mjs';

const pose = setupPose();
const SOURCE = {generation: 1, deviceId: 'front-camera', width: 1280, height: 720};
const USER = {facing: 'user', pairedDisplay: false, controlsConfirmed: true};
const REAR = {facing: 'environment', pairedDisplay: false, controlsConfirmed: false};

function boot({intent = 'start_practice', source = SOURCE, requirements = USER} = {}) {
  const controller = new CameraSetupController();
  controller.dispatch({type: 'prepare', intent, now: 0});
  controller.dispatch({type: 'begin', intent, source, requirements, now: 0});
  controller.dispatch({type: 'camera_ready', now: 0});
  return controller;
}

/** Interleave ticks with observations, the way the app runs them. */
function drive(controller, {from = 0, to, hz = 10, frame = pose, source = SOURCE, delay = 10} = {}) {
  const period = 1000 / hz;
  for (let t = from; t <= to + 1e-9; t += period) {
    controller.dispatch({type: 'tick', now: t + delay});
    controller.dispatch({
      type: 'observation',
      image: frame.image,
      world: frame.world,
      source,
      capturedAt: t,
      receivedAt: t + delay,
    });
  }
  return controller.snapshot;
}

/** Drive until the controller leaves the given stage; returns the snapshot and the clock. */
function driveUntilLeaving(controller, stage, {from = 0, hz = 10, to = 20000} = {}) {
  const period = 1000 / hz;
  let entered = false;
  for (let t = from; t <= to + 1e-9; t += period) {
    controller.dispatch({type: 'tick', now: t + 10});
    controller.dispatch({type: 'observation', image: pose.image, world: pose.world, source: SOURCE, capturedAt: t, receivedAt: t + 10});
    const current = controller.snapshot.stage;
    if (current === stage) entered = true;
    else if (entered) return {snapshot: controller.snapshot, at: t + 10};
  }
  throw new Error(`never left ${stage}`);
}

test('a full guided run hands off exactly once with a five-second countdown', () => {
  const controller = boot();
  assert.equal(controller.snapshot.stage, 'positioning');
  const final = drive(controller, {to: 6000});
  assert.equal(final.stage, 'handoff');
  assert.equal(final.handoff.pending, true);
  assert.equal(final.handoff.consumed, false);
  assert.ok(final.calibration && final.calibration.height > 0);
  assert.equal(final.progress, 1);

  const handoff = controller.consumeHandoff();
  assert.ok(handoff);
  assert.equal(handoff.intent, 'start_practice');
  assert.equal(handoff.countdownSeconds, GUIDED_HANDOFF_SECONDS);
  assert.equal(handoff.countdownSeconds, 5);
  assert.ok(handoff.calibration.height > 0);
  assert.equal(handoff.source.generation, 1);

  // The token is single use, no matter how often the completion is re-reported.
  assert.equal(controller.consumeHandoff(), null);
  controller.dispatch({type: 'announcement_finished', now: 7000});
  controller.dispatch({type: 'tick', now: 7100});
  assert.equal(controller.consumeHandoff(), null);
  assert.equal(controller.snapshot.handoff.consumed, true);
  assert.equal(controller.snapshot.blocksSessionActions, false);
});

test('setup blocks session actions from preparation until the handoff is consumed', () => {
  const controller = new CameraSetupController();
  controller.dispatch({type: 'prepare', intent: 'start_practice', now: 0});
  assert.equal(controller.snapshot.stage, 'prepare');
  assert.equal(controller.snapshot.blocksSessionActions, true);
  controller.dispatch({type: 'begin', intent: 'start_practice', source: SOURCE, requirements: USER, now: 0});
  assert.equal(controller.snapshot.blocksSessionActions, true);
  controller.dispatch({type: 'camera_ready', now: 0});
  drive(controller, {to: 6000});
  assert.equal(controller.snapshot.stage, 'handoff');
  assert.equal(controller.snapshot.blocksSessionActions, true, 'still blocked until consumed');
  controller.consumeHandoff();
  assert.equal(controller.snapshot.blocksSessionActions, false);
});

test('positioning requires 500 ms of continuous eligibility before measuring', () => {
  const controller = boot();
  assert.equal(drive(controller, {to: 400}).stage, 'positioning');
  assert.equal(drive(controller, {from: 500, to: 600}).stage, 'measuring');
});

test('an ineligible frame restarts positioning dwell', () => {
  const controller = boot();
  drive(controller, {to: 300});
  const offCentre = setupPose({centre: 0.78});
  controller.dispatch({type: 'tick', now: 400});
  controller.dispatch({type: 'observation', image: offCentre.image, world: offCentre.world, source: SOURCE, capturedAt: 400, receivedAt: 410});
  const after = controller.snapshot;
  assert.equal(after.stage, 'positioning');
  assert.equal(after.dwellMs, 0);
  assert.equal(after.issue, 'off_center');
  assert.ok(after.issues.includes('off_center'));
});

test('structured issues report missing regions and unusable scale', () => {
  const controller = boot();
  const feetHidden = hidePose(pose, [INDEX.leftAnkle, INDEX.rightAnkle], 0.2);
  controller.dispatch({type: 'tick', now: 10});
  controller.dispatch({type: 'observation', image: feetHidden.image, world: feetHidden.world, source: SOURCE, capturedAt: 0, receivedAt: 10});
  let snapshot = controller.snapshot;
  assert.ok(snapshot.issues.includes('feet_missing'));
  assert.equal(snapshot.regions.feet, false);

  const far = compressPose(pose, 0.3);
  controller.dispatch({type: 'observation', image: far.image, world: far.world, source: SOURCE, capturedAt: 100, receivedAt: 110});
  snapshot = controller.snapshot;
  assert.ok(snapshot.issues.includes('too_small'));
  assert.equal(snapshot.stage, 'positioning');
});

test('stale, duplicate, out-of-order and foreign observations are rejected without evidence', () => {
  const controller = boot();
  drive(controller, {to: 200});
  const before = controller.snapshot.samples;

  controller.dispatch({type: 'observation', image: pose.image, world: pose.world, source: SOURCE, capturedAt: 300, receivedAt: 300 + SETUP_DEFAULTS.evidenceFreshnessMs + 1});
  assert.equal(controller.snapshot.rejection, 'stale');

  controller.dispatch({type: 'observation', image: pose.image, world: pose.world, source: SOURCE, capturedAt: 300, receivedAt: 310});
  controller.dispatch({type: 'observation', image: pose.image, world: pose.world, source: SOURCE, capturedAt: 300, receivedAt: 320});
  assert.equal(controller.snapshot.rejection, 'duplicate');

  controller.dispatch({type: 'observation', image: pose.image, world: pose.world, source: SOURCE, capturedAt: 250, receivedAt: 330});
  assert.equal(controller.snapshot.rejection, 'out_of_order');

  const other = {...SOURCE, deviceId: 'other-camera'};
  controller.dispatch({type: 'observation', image: pose.image, world: pose.world, source: other, capturedAt: 400, receivedAt: 410});
  assert.equal(controller.snapshot.rejection, 'source_mismatch');

  controller.dispatch({type: 'observation', image: pose.image, world: pose.world, source: SOURCE, capturedAt: Number.NaN, receivedAt: 420});
  assert.equal(controller.snapshot.rejection, 'non_finite');
  assert.equal(controller.snapshot.samples, before);
});

test('losing tracking at 99% progress never hands off, and reacquisition completes', () => {
  const controller = boot();
  const near = drive(controller, {to: 3300});
  assert.equal(near.stage, 'measuring');
  assert.equal(near.samples, 29);
  assert.ok(near.progress > 0.95, `expected near-complete progress, got ${near.progress}`);
  assert.ok(near.progress < 1);

  // Silence past the tracking-loss budget: no calibration, no handoff.
  controller.dispatch({type: 'tick', now: 3300 + 10 + SETUP_DEFAULTS.trackingLossMs + 20});
  const lost = controller.snapshot;
  assert.equal(lost.stage, 'positioning');
  assert.equal(lost.calibration, null);
  assert.equal(lost.handoff.pending, false);
  assert.equal(lost.handoff.consumed, false);
  assert.ok(lost.issues.includes('tracking_lost'));
  assert.equal(lost.progress, 0);

  const recovered = drive(controller, {from: 4400, to: 10000});
  assert.equal(recovered.stage, 'handoff');
  assert.ok(controller.consumeHandoff());
});

test('cancellation is terminal and no completion can follow it', () => {
  const controller = boot();
  drive(controller, {to: 1500});
  assert.equal(controller.snapshot.stage, 'measuring');
  controller.dispatch({type: 'cancel', now: 1600});
  assert.equal(controller.snapshot.stage, 'cancelled');
  assert.equal(controller.snapshot.blocksSessionActions, false);

  const after = drive(controller, {from: 1700, to: 8000});
  assert.equal(after.stage, 'cancelled');
  assert.equal(after.rejection, null, 'observations are ignored, not processed');
  assert.equal(controller.consumeHandoff(), null);
  controller.dispatch({type: 'tick', now: 9000});
  controller.dispatch({type: 'announcement_finished', now: 9100});
  assert.equal(controller.snapshot.stage, 'cancelled');
  assert.equal(controller.consumeHandoff(), null);
});

test('the ready screen is held for its minimum time and bounded by a timeout', () => {
  const controller = boot();
  const {snapshot: ready, at} = driveUntilLeaving(controller, 'measuring');
  assert.equal(ready.stage, 'ready');
  assert.equal(ready.ready.announcement, 'pending');
  controller.dispatch({type: 'announcement_finished', now: at + 100});
  // The camera keeps delivering frames while the success screen is shown.
  const early = drive(controller, {from: at, to: at + 900});
  assert.equal(early.ready.announcement, 'finished');
  assert.equal(early.stage, 'ready', 'success stays visible for the minimum duration');
  controller.dispatch({type: 'tick', now: at + SETUP_DEFAULTS.readyMinimumMs + 1});
  assert.equal(controller.snapshot.stage, 'handoff');
});

test('a missing or failed success announcement cannot trap the user', () => {
  const controller = boot();
  const {at} = driveUntilLeaving(controller, 'measuring');
  assert.equal(controller.snapshot.stage, 'ready');
  const bounded = drive(controller, {from: at, to: at + SETUP_DEFAULTS.readyAnnouncementTimeoutMs + 100});
  assert.equal(bounded.ready.announcement, 'timed_out');
  assert.equal(bounded.stage, 'handoff');
  assert.ok(controller.consumeHandoff());
});

test('repeated completion events and repeated ready events produce one handoff', () => {
  const controller = boot();
  const {snapshot: ready, at} = driveUntilLeaving(controller, 'measuring');
  assert.equal(ready.stage, 'ready');
  controller.dispatch({type: 'announcement_finished', now: at + 100});
  for (let i = 0; i < 5; i++) controller.dispatch({type: 'announcement_finished', now: at + 110 + i});
  const settled = drive(controller, {from: at + 100, to: at + SETUP_DEFAULTS.readyMinimumMs + 100});
  assert.equal(settled.stage, 'handoff');
  const first = controller.consumeHandoff();
  const second = controller.consumeHandoff();
  assert.ok(first);
  assert.equal(second, null);
});

test('React StrictMode style duplicate lifecycle events do not corrupt the run', () => {
  const controller = new CameraSetupController();
  controller.dispatch({type: 'prepare', intent: 'start_compete', now: 0});
  controller.dispatch({type: 'begin', intent: 'start_compete', source: SOURCE, requirements: USER, now: 0});
  // Effects that run twice.
  controller.dispatch({type: 'camera_ready', now: 0});
  controller.dispatch({type: 'camera_ready', now: 0});
  const final = drive(controller, {to: 6000});
  assert.equal(final.stage, 'handoff');
  assert.equal(final.intent, 'start_compete');
  assert.ok(controller.consumeHandoff());
  assert.equal(controller.consumeHandoff(), null);
});

test('a source change invalidates calibration, requirements and the pending handoff', () => {
  const controller = boot();
  drive(controller, {to: 6000});
  assert.equal(controller.snapshot.stage, 'handoff');
  controller.dispatch({type: 'source_changed', source: {...SOURCE, generation: 2}, now: 6100});
  const changed = controller.snapshot;
  assert.equal(changed.stage, 'positioning');
  assert.equal(changed.calibration, null);
  assert.equal(changed.handoff.pending, false);
  assert.equal(controller.consumeHandoff(), null);
  assert.equal(changed.resetReason, 'source_changed');
  assert.equal(changed.requirements.controlsConfirmed, false, 'confirmation belongs to the configuration');
});

test('the same source reported again does not invalidate anything', () => {
  const controller = boot();
  drive(controller, {to: 6000});
  const before = controller.snapshot.calibration;
  controller.dispatch({type: 'source_changed', source: {...SOURCE}, now: 6100});
  assert.equal(controller.snapshot.stage, 'handoff');
  assert.deepEqual(controller.snapshot.calibration, before);
  assert.equal(sourceKey(controller.snapshot.source), sourceKey(SOURCE));
});

test('rear camera: measurement is preflighted on the explicit confirmation', () => {
  const controller = boot({intent: 'start_compete', requirements: REAR});
  const {snapshot: blocked} = driveUntilLeaving(controller, 'positioning', {hz: 10});
  assert.equal(blocked.stage, 'help');
  assert.equal(blocked.help.reason, 'controls_unconfirmed');
  assert.equal(blocked.requirementBlocked, true);
  assert.equal(controller.consumeHandoff(), null);

  controller.dispatch({type: 'confirm_controls'});
  assert.equal(controller.snapshot.requirementBlocked, false);
  controller.dispatch({type: 'retry_setup', now: 1000});
  assert.equal(controller.snapshot.stage, 'positioning');
  const done = drive(controller, {from: 1100, to: 9000});
  assert.equal(done.stage, 'handoff');
  assert.equal(done.requirements.controlsConfirmed, true);
});

test('a paired display satisfies the rear-camera requirement without confirmation', () => {
  const controller = boot({intent: 'start_compete', requirements: {...REAR, pairedDisplay: true}});
  const done = drive(controller, {to: 6000});
  assert.equal(done.stage, 'handoff');
  assert.equal(done.requirementBlocked, false);
});

test('requirements are rechecked before handoff, not only before measurement', () => {
  const controller = boot({requirements: {...REAR, controlsConfirmed: true}});
  const {snapshot: ready, at} = driveUntilLeaving(controller, 'measuring');
  assert.equal(ready.stage, 'ready');
  controller.dispatch({type: 'requirements', requirements: {...REAR, controlsConfirmed: false}});
  controller.dispatch({type: 'announcement_finished', now: at + 100});
  const rechecked = drive(controller, {from: at, to: at + SETUP_DEFAULTS.readyMinimumMs + 200});
  assert.equal(rechecked.stage, 'help');
  assert.equal(rechecked.help.reason, 'controls_unconfirmed');
  assert.equal(controller.consumeHandoff(), null);
});

test('invalid observations during ready return the user to positioning', () => {
  const controller = boot();
  const {snapshot: ready, at} = driveUntilLeaving(controller, 'measuring');
  assert.equal(ready.stage, 'ready');
  const blocked = hidePose(pose, [INDEX.leftAnkle, INDEX.rightAnkle], 0.2);
  let now = at + 10;
  for (let i = 0; i < 12; i++, now += 100) {
    controller.dispatch({type: 'tick', now});
    controller.dispatch({type: 'observation', image: blocked.image, world: blocked.world, source: SOURCE, capturedAt: now, receivedAt: now + 10});
  }
  const lost = controller.snapshot;
  assert.equal(lost.stage, 'positioning');
  assert.equal(lost.calibration, null);
  assert.equal(lost.handoff.pending, false);
});

test('setup-only hands off as a paused return, never a start', () => {
  const controller = boot({intent: 'setup_only'});
  const final = drive(controller, {to: 6000});
  assert.equal(final.stage, 'handoff');
  const handoff = controller.consumeHandoff();
  assert.equal(handoff.intent, 'setup_only');
  assert.equal(handoff.countdownSeconds, 5);
});

test('a sub-threshold observation rate ends in an explicit slow-tracking recovery', () => {
  const controller = boot();
  const period = 500; // 2 Hz: no tracking loss, but too slow to reach 30 samples in 10 s
  let stage = 'positioning';
  for (let t = 0; t <= 20000 && stage !== 'help'; t += period) {
    controller.dispatch({type: 'tick', now: t + 10});
    controller.dispatch({type: 'observation', image: pose.image, world: pose.world, source: SOURCE, capturedAt: t, receivedAt: t + 10});
    stage = controller.snapshot.stage;
  }
  const help = controller.snapshot;
  assert.equal(help.stage, 'help');
  assert.equal(help.help.reason, 'slow_measurement');
  assert.equal(help.help.suggested, true);
  assert.equal(help.calibration, null);
  assert.equal(help.progress < 1, true);

  // Recovery is explicit: retry restarts measurement from zero.
  controller.dispatch({type: 'retry_setup', now: 21000});
  assert.equal(controller.snapshot.stage, 'positioning');
  assert.equal(controller.snapshot.samples, 0);
  assert.equal(controller.snapshot.progress, 0);
});

test('camera failure and retry are explicit stages', () => {
  const controller = boot();
  controller.dispatch({type: 'camera_failed', failure: 'permission_denied', now: 500});
  assert.equal(controller.snapshot.stage, 'error');
  assert.equal(controller.snapshot.failure, 'permission_denied');
  assert.equal(controller.snapshot.blocksSessionActions, true);
  controller.dispatch({type: 'retry_camera', now: 600});
  assert.equal(controller.snapshot.stage, 'starting');
  assert.equal(controller.snapshot.failure, null);
});

test('help is offered before it is forced', () => {
  const controller = boot();
  drive(controller, {to: 1000});
  controller.dispatch({type: 'tick', now: SETUP_DEFAULTS.helpAfterMs + 1});
  const suggested = controller.snapshot;
  assert.equal(suggested.help.suggested, true);
  assert.equal(suggested.help.stuck, false);
  controller.dispatch({type: 'tick', now: SETUP_DEFAULTS.stuckAfterMs + 1});
  assert.equal(controller.snapshot.help.stuck, true);
});

test('the handoff keeps the calibration and the source identity together', () => {
  const controller = boot({intent: 'start_compete'});
  drive(controller, {to: 6000});
  const handoff = controller.consumeHandoff();
  assert.ok(handoff);
  assert.equal(handoff.source.deviceId, SOURCE.deviceId);
  assert.equal(handoff.source.width, SOURCE.width);
  const snapshot = controller.snapshot;
  assert.equal(snapshot.handoff.intent, 'start_compete');
  assert.deepEqual(snapshot.calibration, handoff.calibration);
});
