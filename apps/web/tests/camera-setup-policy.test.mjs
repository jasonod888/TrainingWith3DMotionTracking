import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CALIBRATION,
  applySetupPolicy,
  calibrationEnabled,
  normaliseCapabilities,
  setupPolicy,
} from '../src/camera-setup-policy.ts';

test('only an explicit false disables the guided flow', () => {
  assert.equal(normaliseCapabilities({camera_calibration: false}).calibrationEnabled, false);
  assert.equal(normaliseCapabilities({camera_calibration: true}).calibrationEnabled, true);
  // Everything else keeps the real flow, including a server that predates the field.
  assert.equal(normaliseCapabilities({}).calibrationEnabled, true);
  assert.equal(normaliseCapabilities({camera_calibration: null}).calibrationEnabled, true);
  assert.equal(normaliseCapabilities({camera_calibration: 'false'}).calibrationEnabled, true);
  assert.equal(normaliseCapabilities(null).calibrationEnabled, true);
  assert.equal(normaliseCapabilities(undefined).calibrationEnabled, true);
  assert.equal(normaliseCapabilities('nonsense').calibrationEnabled, true);
});

test('the policy defaults to enabled and can be overridden for a test', () => {
  assert.equal(calibrationEnabled(), true, 'the bypass must never appear by accident');
  applySetupPolicy({calibrationEnabled: false});
  assert.equal(setupPolicy().calibrationEnabled, false);
  applySetupPolicy({calibrationEnabled: true});
  assert.equal(calibrationEnabled(), true);
});

test('the default alignment is a plausible standing body', () => {
  assert.ok(DEFAULT_CALIBRATION.height > 0.32 && DEFAULT_CALIBRATION.height < 0.94);
  assert.ok(DEFAULT_CALIBRATION.floor > 0 && DEFAULT_CALIBRATION.floor <= 1);
  assert.ok(DEFAULT_CALIBRATION.center > 0 && DEFAULT_CALIBRATION.center < 1);
});
