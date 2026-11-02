import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acquireCamera,CameraFailure,listCameras} from '../src/camera-acquisition.ts';

const REAR_WIDE = {facing: 'rear', lens: 'prefer-wide', deviceId: ''};
const FRONT = {facing: 'front', lens: 'default', deviceId: ''};

const CAMERAS = [
  {kind: 'videoinput', deviceId: 'id-front', label: 'Front Camera'},
  {kind: 'videoinput', deviceId: 'id-back', label: 'Back Camera'},
  {kind: 'videoinput', deviceId: 'id-ultra', label: 'Back Ultra Wide Camera'},
];

function named(name, message = 'failed') {
  const error = new Error(message);
  error.name = name;
  return error;
}

/**
 * Records every getUserMedia call, every stream stop, and the peak number of
 * streams open at once so "never two phone cameras at the same time" is checked
 * mechanically.
 */
function harness(respond, devices = []) {
  const calls = [];
  const events = [];
  const open = new Set();
  let peak = 0;
  const make = (options = {}) => {
    const state = {stopped: false};
    const label = options.label ?? 'Back Camera';
    const stream = {
      state,
      getVideoTracks: () => [track],
      getTracks: () => [track],
    };
    const track = {
      label,
      getSettings: () => ({
        width: options.width ?? 1280,
        height: options.height ?? 720,
        deviceId: options.deviceId ?? 'cam-back',
        facingMode: options.facingMode ?? 'environment',
      }),
      stop: () => {
        state.stopped = true;
        open.delete(stream);
        events.push(`stop:${label}`);
      },
    };
    return stream;
  };
  const io = {
    async getUserMedia(constraints) {
      calls.push(constraints);
      const result = respond(constraints, calls.length, make);
      if (result instanceof Error) {
        events.push(`reject:${result.name}`);
        throw result;
      }
      open.add(result);
      peak = Math.max(peak, open.size);
      events.push(`open:${result.getVideoTracks()[0].label}`);
      return result;
    },
    async enumerateDevices() {
      return devices;
    },
  };
  return {io, calls, events, open, peak: () => peak, devices};
}

test('a rear wide preference probes once, then prefers the labelled wide lens', async () => {
  const devices = [];
  const test1 = harness((constraints, attempt, make) => {
    if (attempt === 1) {
      devices.push(...CAMERAS);
      return make({label: 'Back Camera', deviceId: 'id-back'});
    }
    return make({label: 'Back Ultra Wide Camera', deviceId: 'id-ultra'});
  }, devices);
  const result = await acquireCamera(REAR_WIDE, test1.io);
  assert.equal(test1.calls.length, 2);
  assert.equal(test1.calls[0].video.facingMode.ideal, 'environment');
  assert.equal(test1.calls[0].video.deviceId, undefined);
  assert.equal(test1.calls[1].video.deviceId.exact, 'id-ultra');
  assert.equal(result.label, 'Back Ultra Wide Camera');
  assert.equal(result.lensStatus, 'wide-requested-unverified');
  assert.equal(result.wideAttempted, true);
  assert.equal(result.fallback, false);
  assert.equal(test1.peak(), 1, 'the probe must be released before the wide lens is opened');
  const stop = test1.events.indexOf('stop:Back Camera');
  const reopen = test1.events.indexOf('open:Back Ultra Wide Camera');
  assert.ok(stop >= 0 && stop < reopen, test1.events.join(' → '));
});

test('a wide lens that cannot start falls back to an ordinary rear camera', async () => {
  const devices = [];
  const test2 = harness((constraints, attempt, make) => {
    if (attempt === 1) {
      devices.push(...CAMERAS);
      return make({label: 'Back Camera', deviceId: 'id-back'});
    }
    if (constraints.video.deviceId?.exact === 'id-ultra') return named('OverconstrainedError', 'no wide mode');
    return make({label: 'Back Camera', deviceId: 'id-back'});
  }, devices);
  const result = await acquireCamera(REAR_WIDE, test2.io);
  assert.equal(test2.calls.length, 3);
  assert.equal(result.fallback, true);
  assert.equal(result.lensStatus, 'standard');
  assert.equal(result.deviceId, 'id-back');
  assert.equal(test2.peak(), 1);
});

test('permission denial stops immediately instead of cycling lenses', async () => {
  const test3 = harness(() => named('NotAllowedError', 'denied'));
  await assert.rejects(
    () => acquireCamera(REAR_WIDE, test3.io),
    (error) => error instanceof CameraFailure && error.code === 'permission_denied',
  );
  assert.equal(test3.calls.length, 1);
});

test('a busy camera is reported as busy and is not retried', async () => {
  const test4 = harness(() => named('NotReadableError', 'in use'));
  await assert.rejects(
    () => acquireCamera(FRONT, test4.io),
    (error) => error instanceof CameraFailure && error.code === 'busy',
  );
  assert.equal(test4.calls.length, 1);
});

test('a front request opens one user-facing stream and is never called wide', async () => {
  const test5 = harness((constraints, attempt, make) => make({label: 'Front Camera', deviceId: 'id-front', facingMode: 'user'}), CAMERAS);
  const result = await acquireCamera(FRONT, test5.io);
  assert.equal(test5.calls.length, 1);
  assert.equal(test5.calls[0].video.facingMode.ideal, 'user');
  assert.equal(result.facing, 'user');
  assert.equal(result.lensStatus, 'standard');
});

test('an explicit wide device is confirmed only because a person chose it', async () => {
  const test6 = harness((constraints, attempt, make) => {
    assert.equal(constraints.video.deviceId.exact, 'id-ultra');
    return make({label: 'Back Ultra Wide Camera', deviceId: 'id-ultra'});
  }, CAMERAS);
  const result = await acquireCamera({...REAR_WIDE, deviceId: 'id-ultra'}, test6.io, {devices: CAMERAS, explicit: true});
  assert.equal(test6.calls.length, 1);
  assert.equal(result.lensStatus, 'wide-confirmed');
});

test('a browser without device enumeration still acquires from the facing request', async () => {
  const io = {
    async getUserMedia() {
      return {
        getVideoTracks: () => [{label: '', getSettings: () => ({width: 1280, height: 720}), stop: () => {}}],
        getTracks: () => [{stop: () => {}}],
      };
    },
  };
  const result = await acquireCamera(REAR_WIDE, io);
  assert.equal(result.lensStatus, 'unknown');
  assert.equal(result.facing, 'unknown');
});

test('a null media stack fails as an insecure context rather than hanging', async () => {
  await assert.rejects(
    () => acquireCamera(REAR_WIDE, null),
    (error) => error instanceof CameraFailure && error.code === 'insecure_context',
  );
});

test('enumeration keeps video inputs only', async () => {
  const io = {
    async getUserMedia() { throw new Error('unused'); },
    async enumerateDevices() {
      return [
        {kind: 'audioinput', deviceId: 'mic', label: 'Microphone'},
        {kind: 'videoinput', deviceId: 'default', label: 'Default'},
        {kind: 'videoinput', deviceId: 'id-back', label: 'Back Camera'},
      ];
    },
  };
  assert.deepEqual(await listCameras(io), [{deviceId: 'id-back', label: 'Back Camera'}]);
  assert.deepEqual(await listCameras(null), []);
});
