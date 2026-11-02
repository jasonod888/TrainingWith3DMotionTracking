import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  RECEIVER_MEDIA_DEFAULTS,displayLabel,frameIsFresh,mediaIsLive,mediaLabel,nextMediaState,
} from '../src/receiver-media.ts';

const run = (signals, start = 'off') => signals.reduce((state, signal) => nextMediaState(state, signal), start);

test('an incoming track or a connected transport is not proof of a live picture', () => {
  assert.equal(nextMediaState('off', {type: 'track'}), 'starting');
  assert.equal(nextMediaState('starting', {type: 'connection', state: 'connected'}), 'starting');
  assert.equal(nextMediaState('off', {type: 'connection', state: 'connected'}), 'off');
  assert.equal(mediaIsLive('starting'), false);
  // Only a decoded frame promotes to live.
  assert.equal(nextMediaState('starting', {type: 'frame'}), 'live');
});

test('metadata alone never shows a live picture', () => {
  assert.equal(run([{type: 'track'}, {type: 'metadata'}]), 'starting');
  assert.equal(run([{type: 'track'}, {type: 'frame'}, {type: 'metadata'}]), 'live');
});

test('a stalled or interrupted picture drops out of live immediately', () => {
  assert.equal(run([{type: 'track'}, {type: 'frame'}, {type: 'stall'}]), 'interrupted');
  assert.equal(run([{type: 'track'}, {type: 'stall'}]), 'interrupted');
  assert.equal(run([{type: 'track'}, {type: 'frame'}, {type: 'stall'}, {type: 'frame'}]), 'live');
});

test('track end and reset clear the picture completely', () => {
  assert.equal(run([{type: 'track'}, {type: 'frame'}, {type: 'track-ended'}]), 'off');
  assert.equal(run([{type: 'track'}, {type: 'frame'}, {type: 'reset'}]), 'off');
});

test('transport failures are reported as failures, temporary drops as interruptions', () => {
  assert.equal(nextMediaState('live', {type: 'connection', state: 'failed'}), 'failed');
  assert.equal(nextMediaState('live', {type: 'connection', state: 'closed'}), 'failed');
  assert.equal(nextMediaState('live', {type: 'connection', state: 'disconnected'}), 'interrupted');
  assert.equal(nextMediaState('off', {type: 'connection', state: 'connecting'}), 'starting');
});

test('a blocked autoplay needs a gesture and is never shown as live', () => {
  assert.equal(nextMediaState('starting', {type: 'autoplay-blocked'}), 'interrupted');
  assert.equal(run([{type: 'track'}, {type: 'autoplay-blocked'}, {type: 'frame'}]), 'live');
  assert.ok(!mediaLabel('interrupted').includes('live'));
});

test('stalls do not disturb states that already have no picture', () => {
  assert.equal(nextMediaState('off', {type: 'stall'}), 'off');
  assert.equal(nextMediaState('interrupted', {type: 'stall'}), 'interrupted');
  assert.equal(nextMediaState('failed', {type: 'stall'}), 'failed');
});

test('frame freshness uses a bounded timeout', () => {
  assert.equal(frameIsFresh(1000, 2000), true);
  assert.equal(frameIsFresh(1000, 1000 + RECEIVER_MEDIA_DEFAULTS.frameTimeoutMs), true);
  assert.equal(frameIsFresh(1000, 1001 + RECEIVER_MEDIA_DEFAULTS.frameTimeoutMs), false);
  assert.equal(frameIsFresh(Number.NaN, 1000), false);
  assert.equal(frameIsFresh(1000, Number.NaN), false);
});

test('display wording distinguishes pairing from a current picture', () => {
  assert.equal(displayLabel(false, false, 'off'), 'Not connected');
  assert.equal(displayLabel(false, true, 'off'), 'Waiting for approval on the camera device');
  assert.equal(displayLabel(true, false, 'live'), 'Camera live');
  assert.equal(displayLabel(true, false, 'interrupted'), 'Camera interrupted');
  assert.equal(displayLabel(true, false, 'failed'), 'Camera connection failed');
  assert.equal(displayLabel(true, false, 'starting'), 'Camera connecting…');
  // An approved pairing with no media must never read as live.
  for (const state of ['off', 'starting', 'interrupted', 'failed']) {
    assert.ok(!displayLabel(true, false, state).includes('live'), state);
  }
});
