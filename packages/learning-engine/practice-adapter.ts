/**
 * Act practice adapter contract.
 *
 * `PracticeRuntime` stays the only session authority; an adapter never owns a
 * second clock. It builds a normalized plan, supplies the one transport, declares
 * its stage/assessment support, and hands back an explicit resource bag so route,
 * Act or input switches release capture devices, audio nodes, subscriptions,
 * animation loops and assessment workers.
 */
import type {PracticePlan} from './practice-plan';
import type {PracticeTransport} from './practice-transport';
import type {PracticeCapabilities} from './practice-capabilities';
import type {EvidenceInput, PracticeMode} from './practice-policy';

export type PracticeResourceKind =
  | 'camera'
  | 'microphone'
  | 'audio'
  | 'pointer_stylus'
  | 'subscription'
  | 'animation_frame'
  | 'worker';

export type PracticeResource = {
  kind: PracticeResourceKind;
  label?: string;
  release: () => void | Promise<void>;
};

export type ReleaseReport = {released: number; failed: number};

export type PracticeResourceBag = {
  add(resource: PracticeResource): void;
  /** Release everything exactly once. Safe to call repeatedly on unmount. */
  releaseAll(): Promise<ReleaseReport>;
  size(): number;
};

export function createResourceBag(): PracticeResourceBag {
  const resources: PracticeResource[] = [];
  return {
    add(resource) {
      resources.push(resource);
    },
    async releaseAll() {
      // Detach first: a re-entrant call must not double-release a device.
      const pending = resources.splice(0, resources.length);
      let failed = 0;
      for (const resource of pending) {
        try {
          await resource.release();
        } catch {
          failed += 1;
        }
      }
      return {released: pending.length - failed, failed};
    },
    size: () => resources.length,
  };
}

export type PracticeStageKind = 'body' | 'notation' | 'custom';

export type ActPracticeAdapter = {
  actId: string;
  /** Normalized, revision-bound plan. Identity must include lesson and revision. */
  buildPlan(input: {
    lessonId: string;
    revisionId: string;
    duration: number;
    units: PracticePlan['units'];
  }): PracticePlan;
  /** The single advancing clock. The runtime only observes it. */
  createTransport(input: {media: unknown}): PracticeTransport;
  /**
   * Acquire inputs for this mode and return their release handles. Must not
   * request a device when the policy says no evidence is needed.
   */
  prepareInputs(input: {
    mode: PracticeMode;
    evidenceInputs: readonly EvidenceInput[];
  }): Promise<PracticeResourceBag>;
  stage: {kind: PracticeStageKind; id: string};
  assessmentSupport(): {
    supported: boolean;
    adapterId: string | null;
    rubricVersion: string | null;
  };
  /** Specialized settings ids; the shared shell renders the common ones. */
  settings(): readonly string[];
  capabilities(): PracticeCapabilities;
};

/** Shape guard for registration. Semantics are each Act's own tests. */
export function assertPracticeAdapter(adapter: ActPracticeAdapter): void {
  if (!adapter.actId) throw new Error('A practice adapter needs an Act id.');
  for (const name of ['buildPlan', 'createTransport', 'prepareInputs',
    'assessmentSupport', 'settings', 'capabilities'] as const) {
    if (typeof adapter[name] !== 'function') {
      throw new Error(`The ${adapter.actId} practice adapter is missing ${name}().`);
    }
  }
  if (!adapter.stage?.id) throw new Error(`The ${adapter.actId} practice adapter needs a stage.`);
}
