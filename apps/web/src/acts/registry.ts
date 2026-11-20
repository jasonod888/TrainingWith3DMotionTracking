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
import type {ComponentType} from 'react';
import type { ActId, ActSupport, CapabilitySet } from '../../../../packages/learning-engine/act-capabilities';
import { unsupportedActCapabilities } from '../../../../packages/learning-engine/act-capabilities';
import serverActCatalogue from '../../../../packages/lesson-schema/act-descriptors.json';

/** Generated server catalogue facts; executable loaders stay local below. */
export const serverActDescriptors = serverActCatalogue;

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
    loadPractice: () => import('../PracticeWorkspace')
      .then(module => ({default: module.PracticeWorkspace})),
  },
  piano: {
    id: 'piano',
    label: 'Piano',
    loadPractice: () => import('./music/PracticeEntry')
      .then(module => ({default: module.MusicPracticeEntry})),
  },
  guitar: {
    id: 'guitar',
    label: 'Guitar',
    loadPractice: () => import('./music/PracticeEntry')
      .then(module => ({default: module.MusicPracticeEntry})),
  },
  drawing: {
    id: 'drawing',
    label: 'Drawing',
    loadPractice: () => import('./drawing/DrawingPracticeEntry')
      .then(module => ({default: module.DrawingPracticeEntry})),
  },
};

/**
 * Capability facts generated from the Python descriptor catalogue. This removes
 * hand-maintained drift; only executable entry loaders remain local.
 */
const SUPPORT = Object.fromEntries(serverActDescriptors.acts.map(descriptor => [descriptor.id, {
  id: descriptor.id,
  supported: true,
  practiceInputs: descriptor.practice_inputs,
  practiceModes: descriptor.practice_modes,
  assessmentAdapters: descriptor.assessment_adapters,
  publicationRepresentations: descriptor.publication_representations,
}])) as unknown as Record<ActId, ActSupport>;

const BY_ID = IMPLEMENTATIONS as Record<string, ActImplementation>;

/** Resolve an implementation. Unknown or absent Act ids return null. */
export function implementationFor(actId: string | null | undefined): ActImplementation | null {
  if (!actId) return null;
  return Object.prototype.hasOwnProperty.call(BY_ID, actId) ? BY_ID[actId] : null;
}

export type PracticeEntryProps = Record<string, unknown>;
export type PracticeEntryComponent = ComponentType<PracticeEntryProps>;

/** The one executable practice-entry loader for an Act, consumed by the host. */
export function practiceEntryFor(actId: string | null | undefined):
  (() => Promise<{default: PracticeEntryComponent}>) | null {
  const implementation = implementationFor(actId);
  return implementation ? implementation.loadPractice as
    () => Promise<{default: PracticeEntryComponent}> : null;
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
