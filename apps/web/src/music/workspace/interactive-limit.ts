/**
 * Proposed 5,000-occurrence interactive editing boundary.
 *
 * This module is deliberately not wired into the live workspace: the product
 * restriction requires explicit owner approval. It is the reviewable policy and
 * mutation/export implementation to activate only after that decision.
 */
export const INTERACTIVE_OCCURRENCE_LIMIT = 5000;
export const INTERACTIVE_LIMIT_APPROVED = false;

export type EditingMode = 'editing' | 'read-only';

export type InteractionPolicy = {
  mode: EditingMode;
  limit: number;
  occurrenceCount: number;
  approved: boolean;
  reason: string;
};

export function resolveInteractionPolicy(
  occurrenceCount: number,
  approved: boolean = INTERACTIVE_LIMIT_APPROVED,
): InteractionPolicy {
  if (!Number.isInteger(occurrenceCount) || occurrenceCount < 0) {
    throw new Error('The occurrence count must be a non-negative whole number.');
  }
  if (!approved) {
    return {
      mode: 'editing', limit: INTERACTIVE_OCCURRENCE_LIMIT, occurrenceCount, approved,
      reason: 'Interactive limit policy is not approved; no restriction is active.',
    };
  }
  if (occurrenceCount <= INTERACTIVE_OCCURRENCE_LIMIT) {
    return {
      mode: 'editing', limit: INTERACTIVE_OCCURRENCE_LIMIT, occurrenceCount, approved,
      reason: `Within the ${INTERACTIVE_OCCURRENCE_LIMIT}-occurrence interactive limit.`,
    };
  }
  return {
    mode: 'read-only', limit: INTERACTIVE_OCCURRENCE_LIMIT, occurrenceCount, approved,
    reason: `This lesson has ${occurrenceCount} occurrences; editing is limited to ${INTERACTIVE_OCCURRENCE_LIMIT}. `
      + 'Viewing, playback, selection and lossless export remain available.',
  };
}

export type MutationGuard =
  | {allowed: true}
  | {allowed: false; code: 'interactive-limit-read-only'; message: string};

export function guardMutation(policy: InteractionPolicy): MutationGuard {
  if (policy.mode === 'editing') return {allowed: true};
  return {
    allowed: false, code: 'interactive-limit-read-only',
    message: `${policy.reason} This edit was not applied.`,
  };
}

export type WorkspaceExport = {
  kind: 'piano-workspace-export-v1';
  exportedAt: string;
  title: string;
  occurrenceCount: number;
  document: unknown;
  editingMode: EditingMode;
  recovery: unknown | null;
};

/**
 * Lossless reference/recovery export for read-only lessons. The notation
 * document is copied verbatim (never truncated) so it can be re-imported or kept
 * as a recovery artifact.
 */
export function buildWorkspaceExport(input: {
  document: unknown;
  title: string;
  occurrenceCount: number;
  editingMode: EditingMode;
  recovery?: unknown;
  exportedAt?: string;
}): WorkspaceExport {
  if (!Number.isInteger(input.occurrenceCount) || input.occurrenceCount < 0) {
    throw new Error('The occurrence count must be a non-negative whole number.');
  }
  if (input.editingMode !== 'editing' && input.editingMode !== 'read-only') {
    throw new Error('Unknown editing mode.');
  }
  return {
    kind: 'piano-workspace-export-v1',
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    title: input.title,
    occurrenceCount: input.occurrenceCount,
    document: structuredClone(input.document),
    editingMode: input.editingMode,
    recovery: input.recovery === undefined ? null : structuredClone(input.recovery),
  };
}

export function serializeWorkspaceExport(exported: WorkspaceExport): string {
  return JSON.stringify(exported);
}
