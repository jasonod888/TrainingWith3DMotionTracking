/**
 * Static Act registry: the only place an Act id maps to executable code.
 *
 * The server supplies identity and policy descriptors, never a module path or a
 * URL to execute. Each loader below is a literal dynamic import, so the bundler
 * can split it and an unknown Act resolves to `null` instead of a body fallback.
 *
 * The loaders are used by LessonExperienceHost, so opening practice never imports
 * the review editor. Each loader is a literal dynamic import; the server never
 * supplies executable paths.
 */
import type { ActId, ActSupport, CapabilitySet } from '../../../../packages/learning-engine/act-capabilities';
import { unsupportedActCapabilities } from '../../../../packages/learning-engine/act-capabilities';

export type ActImplementation = {
  id: ActId;
  label: string;
  /** Loads the Act's practice entry module. Never the review/correction editor. */
  loadPractice: () => Promise<unknown>;
};

const IMPLEMENTATIONS: Record<ActId, ActImplementation> = {
  full_body: {
    id: 'full_body',
    label: 'Full Body',
    loadPractice: () => import('../PracticeWorkspace'),
  },
  piano: {
    id: 'piano',
    label: 'Piano',
    loadPractice: () => import('./music/PracticeEntry'),
  },
  guitar: {
    id: 'guitar',
    label: 'Guitar',
    loadPractice: () => import('./music/PracticeEntry'),
  },
  drawing: {
    id: 'drawing',
    label: 'Drawing',
    loadPractice: () => import('./drawing/DrawingPracticeEntry'),
  },
};

/**
 * Static capability descriptors for this build.
 *
 * They mirror the server descriptor, and are only used when a response predates
 * the negotiated envelope (v1 compatibility) or when a client must resolve a
 * device/learner layer. The server remains authoritative for identity and policy.
 */
const SUPPORT: Record<ActId, ActSupport> = {
  full_body: {
    id: 'full_body',
    supported: true,
    practiceInputs: ['camera', 'microphone'],
    practiceModes: ['watch', 'practice', 'challenge'],
    assessmentAdapters: ['pose-v1'],
    publicationRepresentations: ['interactive_3d'],
  },
  piano: {
    id: 'piano',
    supported: true,
    practiceInputs: ['midi', 'microphone', 'uploaded_recording'],
    practiceModes: ['watch', 'practice', 'challenge'],
    assessmentAdapters: ['piano-midi-v1'],
    publicationRepresentations: [],
  },
  guitar: {
    id: 'guitar',
    supported: true,
    practiceInputs: ['midi', 'microphone'],
    practiceModes: ['watch', 'practice'],
    assessmentAdapters: ['guitar-notes-v1'],
    publicationRepresentations: [],
  },
  drawing: {
    id: 'drawing',
    supported: true,
    practiceInputs: ['pointer_stylus'],
    practiceModes: ['watch', 'practice'],
    assessmentAdapters: [],
    publicationRepresentations: ['interactive_notation', 'poster'],
  },
};

const BY_ID = IMPLEMENTATIONS as Record<string, ActImplementation>;

/** Resolve an implementation. Unknown or absent Act ids return null. */
export function implementationFor(actId: string | null | undefined): ActImplementation | null {
  if (!actId) return null;
  return Object.prototype.hasOwnProperty.call(BY_ID, actId) ? BY_ID[actId] : null;
}

/** Registered ids, in stable display order. */
export function registeredActIds(): ActId[] {
  return Object.keys(IMPLEMENTATIONS) as ActId[];
}

/** True only for an Act this build can render. */
export function isSupportedAct(actId: string | null | undefined): boolean {
  return implementationFor(actId) !== null;
}

/**
 * Static support descriptor for an Act, or null when this build does not know it.
 * Never substitutes another Act's descriptor.
 */
export function actSupportFor(actId: string | null | undefined): ActSupport | null {
  if (!actId) return null;
  return Object.prototype.hasOwnProperty.call(SUPPORT, actId)
    ? SUPPORT[actId as ActId]
    : null;
}

/**
 * Safe result for an id this build does not know. Callers must render an explicit
 * unsupported state; they must not substitute another Act's implementation.
 */
export function unsupportedAct(actId: string | null | undefined): CapabilitySet {
  return unsupportedActCapabilities(
    'unsupported_act',
    actId
      ? `This lesson uses the "${actId}" Act, which this version of the app cannot open.`
      : 'This lesson does not declare an Act this version of the app can open.',
  );
}
