/**
 * Normalized practice plan shared by every subject.
 *
 * Section/bar generation stays subject specific. This module only validates and
 * names the units a subject hands over, and remaps a restored position safely
 * when a lesson revision or a generated plan (for example, piano bars-per-chunk)
 * changes.
 */
export type PracticeUnitMetadata = Record<string, string | number | boolean | null | undefined>;

export type PracticeUnit = {
  id: string;
  label: string;
  start: number;
  end: number;
  metadata?: PracticeUnitMetadata;
};

export type PracticePlan = {
  /** Deterministic identity of lesson revision + unit boundaries + duration. */
  id: string;
  lessonId: string;
  revisionId: string;
  title?: string;
  duration: number;
  units: PracticeUnit[];
};

const EPSILON = 1e-6;

/** FNV-1a, used only for identity, never for security. */
function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function practicePlanId(input: {
  lessonId: string;
  revisionId: string;
  duration: number;
  units: readonly Pick<PracticeUnit, 'id' | 'start' | 'end'>[];
}): string {
  const units = input.units.map(unit => `${unit.id}:${unit.start.toFixed(6)}:${unit.end.toFixed(6)}`).join('|');
  return `${input.revisionId}:${digest(`${input.lessonId}|${input.duration.toFixed(6)}|${units}`)}`;
}

/** Validates a subject plan and copies it, so later subject arrays cannot mutate it. */
export function definePracticePlan(input: {
  lessonId: string;
  revisionId: string;
  title?: string;
  duration: number;
  units: readonly PracticeUnit[];
}): PracticePlan {
  if (!input.lessonId) throw new Error('A practice plan needs a lesson identity.');
  if (!input.revisionId) throw new Error('A practice plan needs a revision identity.');
  if (!Number.isFinite(input.duration) || input.duration <= 0) throw new Error('A practice plan needs a positive duration.');
  if (!input.units.length) throw new Error('A practice plan needs at least one unit.');
  const ids = new Set<string>();
  let previousEnd = -Infinity;
  const units = input.units.map(unit => {
    if (!unit.id || ids.has(unit.id)) throw new Error('Practice units need unique stable identities.');
    ids.add(unit.id);
    if (typeof unit.label !== 'string' || !unit.label.trim()) throw new Error('Practice units need a label.');
    if (!Number.isFinite(unit.start) || !Number.isFinite(unit.end)) throw new Error('Practice unit bounds must be finite.');
    if (unit.start < -EPSILON || unit.end > input.duration + EPSILON) throw new Error('Practice unit bounds must stay inside the lesson.');
    if (unit.end - unit.start <= EPSILON) throw new Error('Practice units must have a positive length.');
    if (unit.start < previousEnd - EPSILON) throw new Error('Practice units must not overlap.');
    previousEnd = unit.end;
    return {
      id: unit.id,
      label: unit.label,
      start: Math.max(0, unit.start),
      end: Math.min(input.duration, unit.end),
      ...(unit.metadata ? {metadata: {...unit.metadata}} : {}),
    };
  });
  return {
    id: practicePlanId({lessonId: input.lessonId, revisionId: input.revisionId, duration: input.duration, units}),
    lessonId: input.lessonId,
    revisionId: input.revisionId,
    ...(input.title ? {title: input.title} : {}),
    duration: input.duration,
    units,
  };
}

export type RestoredPosition = {
  unitId?: string | null;
  time: number;
  /** Set when the stored plan differed from the current plan. */
  planId?: string | null;
  revisionId?: string | null;
};

export type ReconciledPosition = {
  unitIndex: number;
  unitId: string;
  time: number;
  /** True when the saved unit identity and bounds still exist unchanged. */
  exact: boolean;
  /** True when the stored revision differs and the caller must not restore. */
  revisionMismatch: boolean;
  /** True when the stored plan identity differs from the current plan. */
  planChanged: boolean;
};

/**
 * Remaps a restored position onto the current plan.
 *
 * A changed revision is never restored silently: `revisionMismatch` is returned
 * so the caller can discard the record. A changed plan (edited body section or a
 * different piano bars-per-chunk setting) falls back from stable unit identity
 * to source time, then to the nearest unit start.
 */
export function reconcilePracticePlan(plan: PracticePlan, restored: RestoredPosition): ReconciledPosition {
  const revisionMismatch = Boolean(restored.revisionId && restored.revisionId !== plan.revisionId);
  if (revisionMismatch) {
    return {unitIndex: 0, unitId: plan.units[0].id, time: plan.units[0].start, exact: false, revisionMismatch: true, planChanged: true};
  }
  const planChanged = Boolean(restored.planId && restored.planId !== plan.id);
  const time = Number.isFinite(restored.time) ? Math.max(0, Math.min(plan.duration, restored.time)) : plan.units[0].start;
  const byId = restored.unitId ? plan.units.findIndex(unit => unit.id === restored.unitId) : -1;
  if (byId >= 0) {
    const unit = plan.units[byId];
    return {
      unitIndex: byId,
      unitId: unit.id,
      time: Math.max(unit.start, Math.min(unit.end - EPSILON, time)),
      exact: !planChanged,
      revisionMismatch: false,
      planChanged,
    };
  }
  const containing = plan.units.findIndex(unit => time >= unit.start && time < unit.end - EPSILON);
  if (containing >= 0) {
    return {
      unitIndex: containing,
      unitId: plan.units[containing].id,
      time,
      exact: false,
      revisionMismatch: false,
      planChanged: true,
    };
  }
  let nearest = 0;
  let nearestDistance = Infinity;
  plan.units.forEach((unit, index) => {
    const distance = time < unit.start ? unit.start - time : time > unit.end ? time - unit.end : 0;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  });
  const unit = plan.units[nearest];
  return {
    unitIndex: nearest,
    unitId: unit.id,
    time: Math.max(unit.start, Math.min(unit.end - EPSILON, time)),
    exact: false,
    revisionMismatch: false,
    planChanged: true,
  };
}

/** The unit containing a source time; boundaries prefer the next unit. */
export function practiceUnitAt(plan: PracticePlan, time: number): number {
  if (!plan.units.length) return -1;
  const clipped = Math.max(0, Math.min(plan.duration, time));
  const index = plan.units.findIndex(unit => clipped < unit.end - EPSILON);
  return index < 0 ? plan.units.length - 1 : index;
}

export function practiceUnitBounds(plan: PracticePlan, index: number): {start: number; end: number} {
  const unit = plan.units[Math.max(0, Math.min(plan.units.length - 1, index))];
  return unit ? {start: unit.start, end: unit.end} : {start: 0, end: plan.duration};
}
