import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  declaredInputs, hasUsableInput, resolveCapabilities, unsupportedActCapabilities,
  type ActSupport, type CapabilityInput,
} from '../../../packages/learning-engine/act-capabilities';
import {
  implementationFor, isSupportedAct, registeredActIds, unsupportedAct,
} from '../src/acts/registry';

const FULL_BODY: ActSupport = {
  id: 'full_body',
  supported: true,
  practiceInputs: ['camera', 'microphone'],
  practiceModes: ['watch', 'practice', 'challenge'],
  assessmentAdapters: ['pose-v1'],
  publicationRepresentations: ['interactive_3d'],
};

const PIANO: ActSupport = {
  id: 'piano',
  supported: true,
  practiceInputs: ['midi', 'microphone', 'uploaded_recording'],
  practiceModes: ['watch', 'practice', 'challenge'],
  assessmentAdapters: ['piano-midi-v1'],
  publicationRepresentations: [],
};

const GUITAR: ActSupport = {
  id: 'guitar',
  supported: true,
  practiceInputs: ['midi', 'microphone'],
  practiceModes: ['watch', 'practice'],
  assessmentAdapters: ['guitar-notes-v1'],
  publicationRepresentations: [],
};

function input(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    act: FULL_BODY,
    assets: {playable: true, reviewed: true, publicRepresentation: true},
    creator: {feedbackEnabled: true},
    learner: {feedback: 'unset'},
    device: {availableInputs: ['camera', 'midi', 'microphone', 'uploaded_recording']},
    audience: {canView: true, isOwner: true},
    deployment: {actEnabled: true, practiceEnabled: true, challengeEnabled: true},
    ...overrides,
  };
}

test('an unsupported Act refuses every capability and never falls back to body', () => {
  const set = resolveCapabilities(input({
    act: {...FULL_BODY, id: 'violin', supported: false},
  }));
  for (const name of ['canEdit', 'canReview', 'canPractice', 'canChallenge',
    'canAssess', 'canRecord', 'canPublishPublicly'] as const) {
    assert.equal(set[name].support, 'unsupported', name);
    assert.equal(set[name].available, false, name);
    assert.equal(set[name].reasonCode, 'unsupported_act', name);
  }
  assert.deepEqual(set.inputs, {});
  assert.equal(unsupportedActCapabilities().canPractice.support, 'unsupported');
});

test('absent assets make practice unavailable, not unsupported', () => {
  const set = resolveCapabilities(input({assets: {playable: false, reviewed: true, publicRepresentation: true}}));
  assert.equal(set.canPractice.support, 'unavailable');
  assert.equal(set.canPractice.available, false);
  assert.equal(set.canPractice.reasonCode, 'missing_source');
  // Everything else still works.
  assert.equal(set.canEdit.available, true);
});

test('creator-disabled assessment stays distinct from a missing adapter', () => {
  const disabled = resolveCapabilities(input({creator: {feedbackEnabled: false}}));
  assert.equal(disabled.canAssess.support, 'supported');
  assert.equal(disabled.canAssess.available, false);
  assert.equal(disabled.canAssess.reasonCode, 'creator_disabled');

  const noAdapter = resolveCapabilities(input({
    act: {...FULL_BODY, assessmentAdapters: []},
  }));
  assert.equal(noAdapter.canAssess.support, 'unsupported');
  assert.equal(noAdapter.canAssess.reasonCode, 'no_assessment_adapter');
});

test('learner-off is neither unsupported nor unavailable', () => {
  const off = resolveCapabilities(input({learner: {feedback: 'off'}}));
  assert.equal(off.canAssess.support, 'supported');
  assert.equal(off.canAssess.available, false);
  assert.equal(off.canAssess.reasonCode, 'learner_off');
  // The creator still allows it; only this learner chose not to use it.
  assert.equal(off.canChallenge.reasonCode, 'learner_off');

  const noDevice = resolveCapabilities(input({
    act: PIANO,
    device: {availableInputs: []},
  }));
  assert.equal(noDevice.inputs.midi?.support, 'unavailable');
  assert.equal(noDevice.inputs.midi?.reasonCode, 'device_unavailable');
  assert.notEqual(noDevice.inputs.midi?.reasonCode, off.canAssess.reasonCode);
});

test('disconnected devices only affect capture inputs and recording', () => {
  // MIDI and microphone are present; the camera is not.
  const set = resolveCapabilities(input({device: {availableInputs: ['midi', 'microphone']}}));
  assert.equal(set.inputs.camera?.available, false);
  assert.equal(set.inputs.camera?.support, 'unavailable');
  assert.equal(set.inputs.camera?.reasonCode, 'device_unavailable');
  assert.equal(set.inputs.microphone?.available, true);
  // Body can capture through the camera, so with no camera there is no recording.
  assert.equal(set.canRecord.available, false);
  assert.equal(set.canRecord.reasonCode, 'device_unavailable');
  const piano = resolveCapabilities(input({act: PIANO, device: {availableInputs: ['midi']}}));
  assert.equal(piano.canRecord.available, false); // uploaded_recording needs a device
  assert.equal(piano.canPractice.available, true); // practice needs no capture device
  const uploaded = resolveCapabilities(input({act: PIANO, device: {availableInputs: ['uploaded_recording']}}));
  assert.equal(uploaded.canRecord.available, true);
});

test('an offline worker never disables existing playback or inputs', () => {
  const online = resolveCapabilities(input({processing: {workerOnline: true}}));
  const offline = resolveCapabilities(input({processing: {workerOnline: false}}));
  assert.deepEqual(offline, online);
  assert.equal(offline.canPractice.available, true);
  assert.equal(offline.canAssess.available, true);
});

test('guitar has no challenge and no public representation', () => {
  const set = resolveCapabilities(input({act: GUITAR, assets: {playable: true, reviewed: true, publicRepresentation: false}}));
  assert.equal(set.canChallenge.support, 'unsupported');
  assert.equal(set.canChallenge.reasonCode, 'act_unsupported');
  assert.equal(set.canPublishPublicly.support, 'unsupported');
  assert.equal(set.canPublishPublicly.reasonCode, 'act_not_public');
  assert.equal(set.canPractice.available, true);
});

test('deployment flags are unavailable, not unsupported', () => {
  const set = resolveCapabilities(input({
    act: PIANO,
    deployment: {actEnabled: true, practiceEnabled: true, challengeEnabled: false},
  }));
  // The Act supports challenge; this deployment cannot offer it right now.
  assert.equal(set.canChallenge.support, 'unavailable');
  assert.equal(set.canChallenge.available, false);
  assert.equal(set.canChallenge.reasonCode, 'deployment_disabled');

  // With the flag on, the same Act is fully supported.
  const enabled = resolveCapabilities(input({
    act: PIANO,
    deployment: {actEnabled: true, practiceEnabled: true, challengeEnabled: true},
  }));
  assert.equal(enabled.canChallenge.support, 'supported');
  assert.equal(enabled.canChallenge.available, true);

  const disabledAct = resolveCapabilities(input({
    deployment: {actEnabled: false, practiceEnabled: true, challengeEnabled: true},
  }));
  assert.equal(disabledAct.canPractice.reasonCode, 'act_disabled');
});

test('edit and review follow ownership; public publishing additionally needs a representation', () => {
  const viewer = resolveCapabilities(input({audience: {canView: true, isOwner: false}}));
  assert.equal(viewer.canEdit.available, false);
  assert.equal(viewer.canEdit.reasonCode, 'not_owner');
  assert.equal(viewer.canPractice.available, true);

  const noRepresentation = resolveCapabilities(input({
    assets: {playable: true, reviewed: true, publicRepresentation: false},
  }));
  // The Act supports public listing; this revision has no approved representation.
  assert.equal(noRepresentation.canPublishPublicly.support, 'unavailable');
  assert.equal(noRepresentation.canPublishPublicly.available, false);
  assert.equal(noRepresentation.canPublishPublicly.reasonCode, 'unsupported_representation');
});

test('inputs are a set, not one exclusive live input', () => {
  assert.deepEqual(declaredInputs(FULL_BODY), ['camera', 'microphone']);
  assert.deepEqual(declaredInputs(PIANO), ['midi', 'microphone', 'uploaded_recording']);
  const set = resolveCapabilities(input({act: PIANO}));
  assert.deepEqual(Object.keys(set.inputs).sort(), ['microphone', 'midi', 'uploaded_recording']);
  assert.equal(hasUsableInput(set), true);
  assert.equal(hasUsableInput(resolveCapabilities(input({
    act: PIANO, device: {availableInputs: []},
  }))), false);
  assert.equal(hasUsableInput(unsupportedActCapabilities()), false);
});

test('an Act this build does not know resolves safely to unsupported', () => {
  assert.deepEqual(registeredActIds(), ['full_body', 'piano', 'guitar', 'drawing']);
  assert.equal(isSupportedAct('guitar'), true);
  assert.equal(implementationFor('violin'), null);
  assert.equal(implementationFor(null), null);
  const refused = unsupportedAct('violin');
  assert.equal(refused.canPractice.support, 'unsupported');
  assert.equal(refused.canPractice.reasonCode, 'unsupported_act');
  // The registry never substitutes another Act's implementation.
  assert.equal(implementationFor('banjo'), null);
});
