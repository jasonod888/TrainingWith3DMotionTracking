/**
 * Shared capability resolution for every Act.
 *
 * The server owns identity, assets, review state, creator policy and publication
 * policy. The client adds the two layers the server cannot know: the learner's own
 * choices and the device's actual readiness. Keeping them separate is the point:
 *
 *   unsupported  the Act cannot do this at all (guitar has no challenge)
 *   unavailable  it could, but this lesson/device/deployment cannot right now
 *   learner_off  it could, but this person chose not to use it
 *
 * A learner turning feedback off must never look like a missing capability, and
 * an offline processing worker must never disable playback of an existing lesson.
 * Worker state is therefore not consulted here at all; it only affects new jobs.
 */
export type ActId = 'full_body' | 'piano' | 'guitar' | 'drawing';

export type ActInput =
  | 'camera'
  | 'midi'
  | 'microphone'
  | 'uploaded_recording'
  | 'pointer_stylus';

export type CapabilitySupport = 'supported' | 'unsupported' | 'unavailable';

export type CapabilityName =
  | 'canEdit'
  | 'canReview'
  | 'canPractice'
  | 'canChallenge'
  | 'canAssess'
  | 'canRecord'
  | 'canPublishPublicly';

export type CapabilityResult = {
  support: CapabilitySupport;
  available: boolean;
  reasonCode: string;
  explanation: string;
};

export type PracticeMode = 'watch' | 'practice' | 'challenge';

/** The server-provided Act descriptor, reduced to what resolution needs. */
export type ActSupport = {
  id: ActId | string;
  supported: boolean;
  practiceInputs: readonly ActInput[];
  practiceModes: readonly PracticeMode[];
  assessmentAdapters: readonly string[];
  publicationRepresentations: readonly string[];
};

export type LessonAssets = {
  /** A playable source or reference exists. */
  playable: boolean;
  /** A music reference has been reviewed (always true for body). */
  reviewed: boolean;
  /** An approved representation for the requested audience exists. */
  publicRepresentation: boolean;
};

export type CreatorPolicy = {
  /** Creator switch for assessment/feedback. */
  feedbackEnabled: boolean;
  /** Creator switch for public listing, when the Act allows it at all. */
  publicAllowed?: boolean;
};

export type LearnerChoice = {
  feedback: 'on' | 'off' | 'unset';
};

export type DeviceReadiness = {
  availableInputs: readonly ActInput[];
};

export type Audience = {
  canView: boolean;
  isOwner: boolean;
};

export type Deployment = {
  actEnabled: boolean;
  practiceEnabled: boolean;
  challengeEnabled: boolean;
};

export type CapabilityInput = {
  act: ActSupport;
  assets: LessonAssets;
  creator: CreatorPolicy;
  learner: LearnerChoice;
  device: DeviceReadiness;
  audience: Audience;
  deployment: Deployment;
  /**
   * Recorded for diagnostics only. Worker availability is a processing concern:
   * it must not change playback, practice or evidence inputs of an existing lesson.
   */
  processing?: { workerOnline: boolean };
};

export type CapabilitySet = Record<CapabilityName, CapabilityResult> & {
  inputs: Partial<Record<ActInput, CapabilityResult>>;
};

const CAPABILITY_NAMES: readonly CapabilityName[] = [
  'canEdit', 'canReview', 'canPractice', 'canChallenge', 'canAssess', 'canRecord', 'canPublishPublicly',
];

export const capability = (
  support: CapabilitySupport,
  available: boolean,
  reasonCode: string,
  explanation: string,
): CapabilityResult => ({ support, available, reasonCode, explanation });

const OK = (explanation: string): CapabilityResult => capability('supported', true, 'ok', explanation);

/** Every capability refuses with the same stable reason. Used for unknown Acts. */
export function unsupportedActCapabilities(
  reasonCode = 'unsupported_act',
  explanation = 'This lesson belongs to an Act this version does not support.',
): CapabilitySet {
  const blocked = capability('unsupported', false, reasonCode, explanation);
  const result = {} as CapabilitySet;
  for (const name of CAPABILITY_NAMES) result[name] = blocked;
  result.inputs = {};
  return result;
}

const hasMode = (act: ActSupport, mode: PracticeMode): boolean =>
  act.practiceModes.includes(mode);

/**
 * Resolve the seven capabilities plus per-input readiness.
 *
 * Pure: no I/O, no storage, no device APIs. The caller supplies every layer.
 */
export function resolveCapabilities(input: CapabilityInput): CapabilitySet {
  const { act } = input;

  // An unknown or disabled Act is not a licence to fall back to body rendering.
  if (!act.supported) {
    return unsupportedActCapabilities('unsupported_act', 'This Act is not supported by this server.');
  }
  if (!input.deployment.actEnabled) {
    const blocked = capability('unavailable', false, 'act_disabled', 'This Act is temporarily unavailable.');
    const result = {} as CapabilitySet;
    for (const name of CAPABILITY_NAMES) result[name] = blocked;
    result.inputs = {};
    return result;
  }
  if (!input.audience.canView) {
    const blocked = capability('unavailable', false, 'not_permitted', 'You do not have access to this lesson.');
    const result = {} as CapabilitySet;
    for (const name of CAPABILITY_NAMES) result[name] = blocked;
    result.inputs = {};
    return result;
  }

  const owner = input.audience.isOwner;
  const learnerFeedbackOff = input.learner.feedback === 'off';
  const captureInputs = act.practiceInputs.filter(
    value => value === 'camera' || value === 'uploaded_recording');

  const canEdit = owner
    ? OK('You can edit this lesson.')
    : capability('supported', false, 'not_owner', 'Only the owner can edit this lesson.');
  const canReview = canEdit;

  let canPractice: CapabilityResult;
  if (!hasMode(act, 'practice')) {
    canPractice = capability('unsupported', false, 'act_unsupported', 'This Act has no practice mode.');
  } else if (!input.deployment.practiceEnabled) {
    canPractice = capability('unavailable', false, 'deployment_disabled', 'Practice is disabled on this deployment.');
  } else if (!input.assets.playable) {
    canPractice = capability('unavailable', false, 'missing_source', 'This lesson has no playable source.');
  } else {
    canPractice = OK('Practice is available.');
  }

  let canChallenge: CapabilityResult;
  if (!hasMode(act, 'challenge')) {
    canChallenge = capability('unsupported', false, 'act_unsupported', 'This Act has no challenge mode.');
  } else if (!input.deployment.challengeEnabled) {
    canChallenge = capability('unavailable', false, 'deployment_disabled', 'Challenge is disabled on this deployment.');
  } else if (!input.assets.reviewed) {
    canChallenge = capability('unavailable', false, 'not_reviewed', 'Review this lesson before starting a challenge.');
  } else if (!input.creator.feedbackEnabled) {
    canChallenge = capability('unavailable', false, 'creator_disabled', 'The creator turned assessment feedback off.');
  } else if (learnerFeedbackOff) {
    canChallenge = capability('supported', false, 'learner_off', 'You turned feedback off for this lesson.');
  } else {
    canChallenge = OK('Challenge is available.');
  }

  let canAssess: CapabilityResult;
  if (act.assessmentAdapters.length === 0) {
    canAssess = capability('unsupported', false, 'no_assessment_adapter',
      'This Act has no assessment adapter.');
  } else if (!input.assets.reviewed) {
    canAssess = capability('unavailable', false, 'not_reviewed', 'Assessment needs a reviewed reference.');
  } else if (!input.creator.feedbackEnabled) {
    canAssess = capability('supported', false, 'creator_disabled', 'The creator turned assessment feedback off.');
  } else if (learnerFeedbackOff) {
    canAssess = capability('supported', false, 'learner_off', 'You turned feedback off for this lesson.');
  } else {
    canAssess = OK('Assessment is available.');
  }

  let canRecord: CapabilityResult;
  if (captureInputs.length === 0) {
    canRecord = capability('unsupported', false, 'act_unsupported', 'This Act records no learner evidence.');
  } else if (!captureInputs.some(value => input.device.availableInputs.includes(value))) {
    canRecord = capability('unavailable', false, 'device_unavailable', 'No recording device is available.');
  } else {
    canRecord = OK('Recording is available.');
  }

  let canPublishPublicly: CapabilityResult;
  if (act.publicationRepresentations.length === 0) {
    canPublishPublicly = capability('unsupported', false, 'act_not_public',
      'This Act has no approved public representation.');
  } else if (!owner) {
    canPublishPublicly = capability('supported', false, 'not_owner', 'Only the owner can publish this lesson.');
  } else if (!input.assets.publicRepresentation) {
    canPublishPublicly = capability('unavailable', false, 'unsupported_representation',
      'This revision has no approved public representation.');
  } else if (input.creator.publicAllowed === false) {
    canPublishPublicly = capability('supported', false, 'creator_disabled', 'The creator disallowed public publishing.');
  } else {
    canPublishPublicly = OK('This lesson can be published publicly.');
  }

  const inputs: Partial<Record<ActInput, CapabilityResult>> = {};
  for (const name of act.practiceInputs) {
    inputs[name] = input.device.availableInputs.includes(name)
      ? OK(`${name} is available on this device.`)
      : capability('unavailable', false, 'device_unavailable', `${name} is not available on this device.`);
  }

  return { canEdit, canReview, canPractice, canChallenge, canAssess, canRecord,
    canPublishPublicly, inputs };
}

/** The input set this Act declares, independent of the device. */
export function declaredInputs(act: ActSupport): ActInput[] {
  return [...act.practiceInputs];
}

/** Whether the learner can use at least one declared evidence input right now. */
export function hasUsableInput(set: CapabilitySet): boolean {
  return Object.values(set.inputs).some(value => value?.available === true);
}
