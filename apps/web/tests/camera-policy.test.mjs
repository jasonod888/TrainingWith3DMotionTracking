import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_REQUEST_DEFAULTS,CAMERA_PREFERENCE_KEY,acquisitionPlan,applyRequest,buildVideoConstraints,
  classifyLens,describeCamera,describeLens,deviceLabel,facingAvailability,hasLabelledDevices,labelFacing,loadPreference,
  needsDiscoveryProbe,normalizeDevices,parsePreference,protocolFacing,rankDevices,savePreference,
  wantsWide,wideCandidate,wideEvidence,
} from '../src/camera-policy.ts';

const rear = (overrides = {}) => ({...CAMERA_REQUEST_DEFAULTS, facing: 'rear', lens: 'prefer-wide', ...overrides});
const device = (deviceId, label) => ({deviceId, label});

const CAMERAS = [
  device('id-front', 'Front Camera'),
  device('id-back', 'Back Camera'),
  device('id-ultra', 'Back Ultra Wide Camera'),
  device('id-tele', 'Back Telephoto Camera'),
];

test('facing is read from labels, including localised ones, and stays unknown otherwise', () => {
  assert.equal(labelFacing('Front Camera'), 'user');
  assert.equal(labelFacing('Back Ultra Wide Camera'), 'environment');
  assert.equal(labelFacing('camera2 1, facing front'), 'user');
  assert.equal(labelFacing('Caméra arrière'), 'environment');
  assert.equal(labelFacing('后置摄像头'), 'environment');
  assert.equal(labelFacing('Camera 1'), 'unknown');
  assert.equal(labelFacing(''), 'unknown');
  // A label naming both directions is not evidence of either.
  assert.equal(labelFacing('Front-Back Camera'), 'unknown');
});

test('facing availability needs a label or a live track, never a camera count', () => {
  // A single unlabelled webcam is one neutral camera, never a rear camera.
  assert.deepEqual(facingAvailability([device('a', 'HD Pro Webcam C920')]), {front: false, rear: false, single: true, count: 1});
  assert.deepEqual(facingAvailability([device('a', '')]), {front: false, rear: false, single: true, count: 1});
  // Desktops report extra video inputs (virtual, IR, capture) that are all the self camera.
  assert.deepEqual(facingAvailability([device('a', 'HD Webcam'), device('b', 'Virtual Camera')]), {front: false, rear: false, single: true, count: 2});
  assert.deepEqual(facingAvailability([]), {front: false, rear: false, single: true, count: 0});
  // Labelled phone pairs are the only thing that offers both directions.
  assert.deepEqual(facingAvailability([device('f', 'Front Camera'), device('b', 'Back Camera')]), {front: true, rear: true, single: false, count: 2});
  // A rear-only device keeps its rear choice and does not invent a front one.
  assert.deepEqual(facingAvailability([device('a', 'camera2 0, facing back')]), {front: false, rear: true, single: false, count: 1});
  // An unlabelled second camera does not turn a labelled front camera into a pair.
  assert.deepEqual(facingAvailability([device('f', 'Front Camera'), device('x', 'Camera 2')]), {front: true, rear: false, single: false, count: 2});
  // A live track is direct evidence.
  assert.equal(facingAvailability([device('a', 'Camera')], 'environment').rear, true);
  assert.equal(facingAvailability([device('a', 'Camera')], 'user').front, true);
});

test('wide evidence separates ultra-wide from ambiguous wide wording', () => {
  assert.equal(wideEvidence('Back Ultra Wide Camera'), 'strong');
  assert.equal(wideEvidence('Rear 0.5x'), 'strong');
  assert.equal(wideEvidence('超广角镜头'), 'strong');
  assert.equal(wideEvidence('Wide Angle Camera'), 'weak');
  assert.equal(wideEvidence('Back Camera'), 'none');
  assert.equal(wideEvidence('Telephoto Camera'), 'none');
});

test('device ranking is deterministic and independent of enumeration order', () => {
  const first = rankDevices(CAMERAS, rear()).map((entry) => entry.deviceId);
  const shuffled = rankDevices([...CAMERAS].reverse(), rear()).map((entry) => entry.deviceId);
  assert.deepEqual(first, shuffled);
  // Rear + prefer-wide puts the ultra-wide first.
  assert.equal(first[0], 'id-ultra');
});

test('device ids are never used as lens evidence', () => {
  const trap = [device('ultrawide-0.5x', 'Camera 2'), device('plain', 'Camera 1')];
  assert.equal(wideCandidate(trap, rear()), null);
  assert.equal(rankDevices(trap, rear())[0].deviceId, 'plain');
});

test('a front camera is never chosen as the wide candidate', () => {
  const only = [device('f', 'Front Ultra Wide Camera')];
  assert.equal(wideCandidate(only, rear()), null);
});

test('acquisition plan is bounded: one preferred device, then the facing request', () => {
  const plan = acquisitionPlan(rear(), CAMERAS);
  assert.deepEqual(plan.map((step) => step.kind), ['device', 'facing']);
  assert.equal(plan[0].purpose, 'wide');
  assert.equal(plan[0].deviceId, 'id-ultra');
  assert.ok(plan.length <= 2);
});

test('an explicit device choice wins over automatic wide preference', () => {
  const plan = acquisitionPlan(rear({deviceId: 'id-back'}), CAMERAS);
  assert.equal(plan[0].kind, 'device');
  assert.equal(plan[0].purpose, 'explicit');
  assert.equal(plan[0].deviceId, 'id-back');
});

test('an unknown stored device id is ignored instead of failing the request', () => {
  const plan = acquisitionPlan(rear({deviceId: 'gone'}), CAMERAS);
  // The stale id is dropped, so the wide preference still applies.
  assert.equal(plan[0].purpose, 'wide');
  assert.equal(plan[0].deviceId, 'id-ultra');
  assert.equal(plan[plan.length - 1].kind, 'facing');
  const none = acquisitionPlan({...CAMERA_REQUEST_DEFAULTS, facing: 'front', deviceId: 'gone'}, CAMERAS);
  assert.deepEqual(none, [{kind: 'facing', purpose: 'default'}]);
});

test('a discovery probe is only needed before labels are readable', () => {
  assert.equal(needsDiscoveryProbe(rear(), []), true);
  assert.equal(needsDiscoveryProbe(rear(), [device('id', '')]), true);
  assert.equal(needsDiscoveryProbe(rear(), CAMERAS), false);
  assert.equal(needsDiscoveryProbe({...CAMERA_REQUEST_DEFAULTS, facing: 'front'}, []), false);
  assert.equal(wantsWide(rear({lens: 'default'})), false);
});

test('lens classification never upgrades a preference into a confirmed lens', () => {
  const devices = CAMERAS;
  assert.equal(classifyLens({request: rear(), actualFacing: 'environment', actualLabel: 'Back Ultra Wide Camera', devices, explicit: false}), 'wide-requested-unverified');
  assert.equal(classifyLens({request: rear(), actualFacing: 'environment', actualLabel: 'Back Ultra Wide Camera', devices, explicit: true}), 'wide-confirmed');
  assert.equal(classifyLens({request: rear(), actualFacing: 'environment', actualLabel: 'Back Camera', devices, explicit: true}), 'standard');
  assert.equal(classifyLens({request: rear(), actualFacing: 'environment', actualLabel: 'Back Camera', devices, explicit: false}), 'standard');
  // No labels at all: the lens type is genuinely not identified.
  assert.equal(classifyLens({request: rear(), actualFacing: 'environment', actualLabel: '', devices: [device('a', '')], explicit: false}), 'unknown');
  // A front camera is never described as wide.
  assert.equal(classifyLens({request: {facing: 'front', lens: 'prefer-wide', deviceId: ''}, actualFacing: 'user', actualLabel: 'Front Ultra Wide Camera', devices, explicit: true}), 'standard');
});

test('camera wording distinguishes confirmed, unavailable and unidentified lenses', () => {
  assert.equal(describeLens('wide-confirmed'), 'Rear wide camera');
  assert.match(describeLens('standard'), /unavailable/);
  assert.match(describeLens('unknown'), /not identified/);
  for (const status of ['standard', 'unknown', 'wide-requested-unverified']) {
    assert.doesNotMatch(describeCamera({requested: rear(), actualFacing: 'environment', lensStatus: status}), /Rear wide camera/);
  }
  assert.equal(describeCamera({requested: rear(), actualFacing: 'environment', lensStatus: 'wide-confirmed'}), 'Rear wide camera');
  assert.equal(describeCamera({requested: {facing: 'front', lens: 'default', deviceId: ''}, actualFacing: 'user', lensStatus: 'standard'}), 'Front camera');
  assert.match(describeCamera({requested: rear(), actualFacing: 'unknown', lensStatus: 'unknown'}), /not identified/);
  assert.match(describeCamera({requested: {facing: 'front', lens: 'default', deviceId: ''}, actualFacing: 'unknown', lensStatus: 'standard'}), /facing not confirmed/);
});

test('facing is reported to the receiver from the actual track, not the request', () => {
  assert.equal(protocolFacing('user'), 'front');
  assert.equal(protocolFacing('environment'), 'rear');
  assert.equal(protocolFacing('unknown'), 'unknown');
});

test('acquisition constraints never bind capture geometry to a presentation size', () => {
  const constraints = buildVideoConstraints({...CAMERA_REQUEST_DEFAULTS, facing: 'rear'});
  assert.equal(constraints.facingMode.ideal, 'environment');
  assert.equal(constraints.width.ideal, 1280);
  assert.equal(constraints.height.ideal, 720);
  assert.equal(constraints.frameRate.max, 30);
  assert.equal('aspectRatio' in constraints, false);
  const explicit = buildVideoConstraints(rear({deviceId: 'id-ultra'}), 'id-ultra');
  assert.equal(explicit.deviceId.exact, 'id-ultra');
  assert.equal('facingMode' in explicit, false);
});

test('pseudo and duplicate device ids are ignored', () => {
  const devices = normalizeDevices([
    {deviceId: 'default', label: 'Default'},
    {deviceId: '', label: 'Empty'},
    {deviceId: 'a', label: 'A'},
    {deviceId: 'a', label: 'A again'},
    {deviceId: 'b', label: ''},
  ]);
  assert.deepEqual(devices.map((entry) => entry.deviceId), ['a', 'b']);
  assert.equal(hasLabelledDevices(devices), true);
  assert.equal(hasLabelledDevices([device('b', '')]), false);
});

test('device labels fall back to neutral numbering, never invented lens names', () => {
  assert.equal(deviceLabel(device('x', ''), 3), 'Camera 4');
  assert.equal(deviceLabel(device('x', 'Back Camera'), 0), 'Back Camera');
});

test('only facing and lens persist; a device id is revalidated each start', () => {
  const store = new Map();
  const storage = {getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)};
  savePreference(storage, rear({deviceId: 'id-ultra'}));
  const stored = JSON.parse(store.get(CAMERA_PREFERENCE_KEY));
  assert.deepEqual(stored, {facing: 'rear', lens: 'prefer-wide'});
  assert.equal(loadPreference(storage).deviceId, '');
  assert.equal(loadPreference(storage).facing, 'rear');
});

test('stored preferences are defensive against corrupt or hostile values', () => {
  assert.deepEqual(parsePreference('{not json'), CAMERA_REQUEST_DEFAULTS);
  assert.deepEqual(parsePreference(null), CAMERA_REQUEST_DEFAULTS);
  assert.equal(parsePreference('{"facing":"sideways","lens":"8x"}').facing, 'front');
  assert.equal(parsePreference('{"facing":"rear","lens":"8x"}').lens, 'default');
  const throwing = {getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }};
  assert.deepEqual(loadPreference(throwing), CAMERA_REQUEST_DEFAULTS);
  savePreference(throwing, rear());
  assert.deepEqual(applyRequest(rear(), {facing: 'front', deviceId: ''}).facing, 'front');
});
