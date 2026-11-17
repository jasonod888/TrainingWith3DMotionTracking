/**
 * Deterministic, conservative piano-hand estimates.
 *
 * This is a musical-guess layer over recorded performance occurrences. It deliberately
 * does not treat staff/clef as hand and never mutates pitches or timing. The estimator is
 * pure so it can be reused by the workspace and by later model/hybrid comparison code.
 */
import {
  type Hand, type HandAssignment, type HandConfidence, type HandModelInfo, type NotationDocument,
  type PerformanceNote,
} from './types';
import {sha256Hex} from './sha256';

const CHORD_TOLERANCE_SECONDS = 0.04;
const CONTINUITY_SECONDS = 1.6;
const LARGE_CHORD_SPAN = 12;
const MIDDLE_LOW = 56;
const MIDDLE_HIGH = 64;

export type HandEstimate = {
  hand: Hand;
  confidence: HandConfidence;
  reason: string;
  costs: {left: number; right: number};
  plausible: {left: boolean; right: boolean};
};

export type ModelHandEstimate = {
  hand: 'left' | 'right';
  confidence?: HandConfidence;
  model: HandModelInfo;
  plausible?: boolean;
  /** Raw, uncalibrated model score; used only as a weak margin, never as confidence. */
  score?: number;
};

export type ResolvedHand = HandAssignment;

type LastHand = {pitch: number; onset: number; end: number};
type Group = {onset: number; notes: PerformanceNote[]};

/** IDs/pitch/onset/duration only; written spelling and playback offset do not matter. */
function float64Hex(value: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  return view.getUint32(0).toString(16).padStart(8, '0')
    + view.getUint32(4).toString(16).padStart(8, '0');
}

function compareUtf8(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

/**
 * Compact versioned cache identity. Canonical bytes are:
 * `piano-hand-v1\n<count>\n` followed by rows sorted by UTF-8 id bytes:
 * `<idByteLength>:<id>\t<pitch>\t<f64behex(onset)>\t<f64behex(duration)|null>\n`.
 * The digest is the lowercase SHA-256 hex with a `ph1:` prefix. Numeric fields are
 * IEEE-754 big-endian hex, so browser and worker adapters avoid locale/float formatting
 * differences. Only this short digest is persisted per automatic assignment.
 */
export function handPerformanceFingerprint(performance: PerformanceNote[]): string {
  const encoder = new TextEncoder();
  const rows = performance.map(note => {
    const idBytes = encoder.encode(note.id);
    return {
      idBytes,
      body: `${idBytes.length}:${note.id}\t${note.pitch}\t${float64Hex(note.onset)}\t`
        + `${note.duration === null ? 'null' : float64Hex(note.duration)}\n`,
    };
  }).sort((left, right) => compareUtf8(left.idBytes, right.idBytes)
    || (left.body < right.body ? -1 : left.body > right.body ? 1 : 0));
  const canonical = `piano-hand-v1\n${rows.length}\n${rows.map(row => row.body).join('')}`;
  return `ph1:${sha256Hex(canonical)}`;
}

function grouping(performance: PerformanceNote[]): Group[] {
  const sorted = performance
    .filter(note => Number.isFinite(note.onset) && Number.isInteger(note.pitch))
    .map(note => ({...note}))
    .sort((left, right) => left.onset - right.onset || left.pitch - right.pitch || left.id.localeCompare(right.id));
  const groups: Group[] = [];
  for (const note of sorted) {
    const current = groups.at(-1);
    if (!current || note.onset - current.onset > CHORD_TOLERANCE_SECONDS) {
      groups.push({onset: note.onset, notes: [note]});
    } else {
      current.notes.push(note);
    }
  }
  return groups;
}

function inStandardPiano(pitch: number): boolean {
  return pitch >= 21 && pitch <= 108;
}

function handCosts(pitches: number[], onset: number, last: Record<'left' | 'right', LastHand | null>) {
  const low = Math.min(...pitches);
  const high = Math.max(...pitches);
  const center = (low + high) / 2;
  const registerBias = (center - 60) / 12;
  const continuity = (hand: 'left' | 'right') => {
    const previous = last[hand];
    if (!previous || onset - previous.onset > CONTINUITY_SECONDS) return 0.9;
    const leap = Math.abs(center - previous.pitch);
    // A short overlap is a soft same-hand cost, not proof of a physical hold: pedal-
    // inflated durations can overlap far beyond what a finger actually sustains.
    const overlap = Math.max(0, previous.end - onset);
    const overlapCost = Math.min(0.55, overlap * 0.2);
    const leapCost = leap > 14 ? 1.4 : Math.min(6, leap) * 0.18;
    return leapCost + overlapCost;
  };
  return {
    left: Math.max(0, registerBias) + continuity('left'),
    right: Math.max(0, -registerBias) + continuity('right'),
  };
}

function wholeGroupEstimate(notes: PerformanceNote[], onset: number,
  last: Record<'left' | 'right', LastHand | null>, reason = 'register-continuity'): HandEstimate {
  const pitches = notes.map(note => note.pitch);
  const costs = handCosts(pitches, onset, last);
  const center = (Math.min(...pitches) + Math.max(...pitches)) / 2;
  const difference = costs.right - costs.left;
  if (Math.abs(difference) >= 0.9) {
    const hand = difference > 0 ? 'left' : 'right';
    const clear = center <= 50 || center >= 70 || Math.abs(difference) >= 1.8;
    return {
      hand, confidence: clear ? 'clear' : 'ambiguous', reason,
      costs, plausible: {left: true, right: true},
    };
  }
  if (center <= MIDDLE_LOW) {
    return {hand: 'left', confidence: 'ambiguous', reason: 'middle-register-line', costs,
      plausible: {left: true, right: true}};
  }
  if (center >= MIDDLE_HIGH) {
    return {hand: 'right', confidence: 'ambiguous', reason: 'middle-register-line', costs,
      plausible: {left: true, right: true}};
  }
  return {hand: 'unassigned', confidence: 'ambiguous', reason: 'ambiguous-single-line', costs,
    plausible: {left: true, right: true}};
}

function splitChord(notes: PerformanceNote[], onset: number,
  last: Record<'left' | 'right', LastHand | null>): Map<string, HandEstimate> {
  const sorted = [...notes].sort((left, right) => left.pitch - right.pitch || left.id.localeCompare(right.id));
  let splitAt = 1;
  let largestGap = -1;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index].pitch - sorted[index - 1].pitch;
    if (gap >= largestGap) {
      largestGap = gap;
      splitAt = index;
    }
  }
  const leftNotes = sorted.slice(0, splitAt);
  const rightNotes = sorted.slice(splitAt);
  const leftPitches = leftNotes.map(note => note.pitch);
  const rightPitches = rightNotes.map(note => note.pitch);
  const costs = handCosts(sorted.map(note => note.pitch), onset, last);
  const result = new Map<string, HandEstimate>();
  const low = Math.min(...leftPitches);
  const high = Math.max(...rightPitches);
  const confidence: HandConfidence = low <= 55 || high >= 65 ? 'clear' : 'ambiguous';
  for (const note of leftNotes) result.set(note.id, {
    hand: 'left', confidence, reason: 'chord-split-span', costs,
    plausible: {left: true, right: true},
  });
  for (const note of rightNotes) result.set(note.id, {
    hand: 'right', confidence, reason: 'chord-split-span', costs,
    plausible: {left: true, right: true},
  });
  return result;
}

/** Estimate every occurrence. The result is keyed by stable performance id. */
export function baselineHandEstimates(performance: PerformanceNote[]): Record<string, HandEstimate> {
  const estimates: Record<string, HandEstimate> = {};
  const last: Record<'left' | 'right', LastHand | null> = {left: null, right: null};
  for (const group of grouping(performance)) {
    const valid = group.notes.filter(note => inStandardPiano(note.pitch));
    const outside = group.notes.filter(note => !inStandardPiano(note.pitch));
    for (const note of outside) {
      const costs = handCosts([note.pitch], group.onset, last);
      estimates[note.id] = {
        hand: 'unassigned', confidence: 'ambiguous', reason: 'outside-standard-piano',
        costs, plausible: {left: false, right: false},
      };
    }
    if (!valid.length) continue;
    const sorted = [...valid].sort((left, right) => left.pitch - right.pitch || left.id.localeCompare(right.id));
    const span = sorted.at(-1)!.pitch - sorted[0].pitch;
    if (span > LARGE_CHORD_SPAN) {
      const split = splitChord(sorted, group.onset, last);
      for (const [id, estimate] of split) estimates[id] = estimate;
    } else {
      const estimate = wholeGroupEstimate(sorted, group.onset, last);
      for (const note of sorted) estimates[note.id] = estimate;
    }
    // Continuity uses the group's realised hands, not the sounding staff.
    for (const hand of ['left', 'right'] as const) {
      const handNotes = sorted.filter(note => estimates[note.id]?.hand === hand);
      if (!handNotes.length) continue;
      last[hand] = {
        pitch: Math.round(handNotes.reduce((total, note) => total + note.pitch, 0) / handNotes.length),
        onset: group.onset,
        end: Math.max(...handNotes.map(note => note.onset + (note.duration ?? 0.25))),
      };
    }
  }
  return estimates;
}

function validStoredManual(value: HandAssignment | undefined): value is HandAssignment {
  return Boolean(value && value.manual === true && value.source === 'manual'
    && (value.hand === 'left' || value.hand === 'right' || value.hand === 'unassigned'));
}

function storedModel(document: NotationDocument, occurrenceId: string,
  fingerprint: string): ModelHandEstimate | null {
  const stored = document.hand_assignments?.[occurrenceId];
  if (!stored || stored.manual || stored.fingerprint !== fingerprint
    || (stored.source !== 'midi2hands' && stored.source !== 'hybrid')
    || (stored.hand !== 'left' && stored.hand !== 'right') || !stored.model) return null;
  return {hand: stored.hand, confidence: stored.confidence, model: stored.model, plausible: true};
}

/**
 * Deterministic hybrid resolution. Manual wins; agreement is consensus, a lone usable
 * source is used, ambiguous baseline prefers a plausible model, and clear disagreement
 * keeps the model suggestion with an explicit conflict marker unless implausible.
 */
export function resolveHandAssignments(document: NotationDocument,
  models: Record<string, ModelHandEstimate> = {}): Record<string, ResolvedHand> {
  const baseline = baselineHandEstimates(document.performance);
  const fingerprint = handPerformanceFingerprint(document.performance);
  const resolved: Record<string, ResolvedHand> = {};
  const automatic = (estimate: HandEstimate, source: 'baseline' | 'midi2hands' | 'hybrid',
    confidence: HandConfidence, reason: string, model?: HandModelInfo): HandAssignment => ({
    hand: estimate.hand, source, confidence, manual: false, reason, fingerprint,
    ...(model ? {model} : {}),
  });
  for (const note of [...document.performance].sort((left, right) => left.id.localeCompare(right.id))) {
    const manual = document.hand_assignments?.[note.id];
    if (validStoredManual(manual)) {
      resolved[note.id] = {...manual};
      continue;
    }
    const base = baseline[note.id] ?? {
      hand: 'unassigned' as const, confidence: 'ambiguous' as const, reason: 'no-estimate',
      costs: {left: Infinity, right: Infinity}, plausible: {left: false, right: false},
    };
    const explicit = models[note.id];
    const model = explicit && (explicit.hand === 'left' || explicit.hand === 'right')
      && (inStandardPiano(note.pitch)) ? explicit : storedModel(document, note.id, fingerprint);
    if (!model) {
      resolved[note.id] = automatic(base, 'baseline', base.confidence, base.reason);
      continue;
    }
    const modelPlausible = model.plausible !== false;
    if (base.hand === model.hand) {
      const confidence: HandConfidence = base.confidence === 'clear' && (model.confidence ?? 'ambiguous') === 'clear'
        ? 'clear' : 'ambiguous';
      resolved[note.id] = automatic({...base, hand: model.hand, confidence}, 'hybrid', confidence,
        'baseline-model-agreement', model.model);
      continue;
    }
    if (base.hand === 'unassigned') {
      resolved[note.id] = modelPlausible
        ? automatic({...base, hand: model.hand, confidence: model.confidence ?? 'ambiguous'},
          'midi2hands', model.confidence ?? 'ambiguous', 'baseline-ambiguous-model', model.model)
        : automatic(base, 'baseline', base.confidence, base.reason);
      continue;
    }
    if (!modelPlausible || !base.plausible[model.hand]) {
      resolved[note.id] = automatic(base, 'baseline', base.confidence, 'model-implausible', model.model);
      continue;
    }
    if (base.confidence === 'ambiguous') {
      resolved[note.id] = automatic({...base, hand: model.hand, confidence: model.confidence ?? 'ambiguous'},
        'midi2hands', model.confidence ?? 'ambiguous', 'baseline-ambiguous-model', model.model);
      continue;
    }
    const modelCost = base.costs[model.hand];
    const baselineCost = base.costs[base.hand === 'left' ? 'left' : 'right'];
    const margin = Number.isFinite(model.score)
      ? Math.min(1, Math.abs((model.score as number) - 0.5) * 2)
      : model.confidence === 'clear' ? 0.85 : model.confidence === 'conflict' ? 0.5 : 0.35;
    // A clear, feasible baseline resolves a weak or contextually inconsistent model.
    // The raw score is an uncalibrated margin only; it is never reported as confidence.
    if (margin < 0.28 || modelCost > baselineCost + 0.55) {
      resolved[note.id] = automatic(base, 'baseline', base.confidence,
        margin < 0.28 ? 'baseline-over-weak-model' : 'baseline-over-inconsistent-model');
      continue;
    }
    resolved[note.id] = automatic({...base, hand: model.hand, confidence: 'conflict'},
      'hybrid', 'conflict', 'baseline-model-conflict', model.model);
  }
  return resolved;
}

/** Remove automatic metadata whose cached performance context no longer matches. */
export function invalidateStaleHandAssignments(document: NotationDocument): NotationDocument {
  if (!document.hand_assignments) return document;
  const fingerprint = handPerformanceFingerprint(document.performance);
  let changed = false;
  for (const [id, assignment] of Object.entries(document.hand_assignments)) {
    if (!assignment.manual && assignment.fingerprint !== fingerprint) {
      delete document.hand_assignments[id];
      changed = true;
    }
  }
  if (changed && !Object.keys(document.hand_assignments).length) {
    document.hand_assignment_version = 1;
  }
  return document;
}

/** Copy a document with the currently applied estimates materialised for normal save. */
export function withHandAssignments(document: NotationDocument,
  assignments: Record<string, HandAssignment>): NotationDocument {
  const next = structuredClone(document);
  next.hand_assignment_version = 1;
  next.hand_assignments = Object.fromEntries(
    Object.entries(assignments).filter(([id]) => next.performance.some(note => note.id === id)),
  );
  return next;
}

/** Remove metadata for deleted occurrences; retained manual/automatic data is untouched. */
export function pruneHandAssignments(document: NotationDocument): NotationDocument {
  if (!document.hand_assignments) return document;
  const ids = new Set(document.performance.map(note => note.id));
  const entries = Object.entries(document.hand_assignments).filter(([id]) => ids.has(id));
  if (entries.length === Object.keys(document.hand_assignments).length) return document;
  document.hand_assignments = Object.fromEntries(entries);
  if (!entries.length) document.hand_assignment_version = 1;
  return document;
}

/** Validate stored metadata for parse/save compatibility. Returns {} when absent. */
export function parseHandAssignmentMetadata(value: unknown, version: unknown,
  occurrenceIds: Set<string>): {hand_assignment_version?: 1; hand_assignments?: Record<string, HandAssignment>} {
  if (value === undefined && version === undefined) return {};
  if (version !== 1) throw new Error('The hand assignment metadata version is invalid.');
  if (value === undefined) return {hand_assignment_version: 1};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The hand assignment metadata is invalid.');
  }
  const result: Record<string, HandAssignment> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!occurrenceIds.has(id)) throw new Error('A hand assignment references a missing performance note.');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A hand assignment is invalid.');
    const item = raw as Record<string, unknown>;
    if (item.hand !== 'left' && item.hand !== 'right' && item.hand !== 'unassigned') {
      throw new Error('A hand assignment label is invalid.');
    }
    if (item.source !== 'manual' && item.source !== 'baseline'
      && item.source !== 'midi2hands' && item.source !== 'hybrid') {
      throw new Error('A hand assignment source is invalid.');
    }
    if (item.confidence !== 'clear' && item.confidence !== 'ambiguous' && item.confidence !== 'conflict') {
      throw new Error('A hand assignment confidence is invalid.');
    }
    if (typeof item.manual !== 'boolean' || (item.source === 'manual') !== item.manual) {
      throw new Error('A hand assignment manual flag is invalid.');
    }
    if (item.reason !== undefined && (typeof item.reason !== 'string' || item.reason.length > 200)) {
      throw new Error('A hand assignment reason is invalid.');
    }
    if (!item.manual && (typeof item.fingerprint !== 'string'
      || !/^ph1:[0-9a-f]{64}$/.test(item.fingerprint))) {
      throw new Error('An automatic hand assignment has no valid performance fingerprint.');
    }
    let model: HandModelInfo | undefined;
    if (item.model !== undefined) {
      if (!item.model || typeof item.model !== 'object' || Array.isArray(item.model)) {
        throw new Error('A hand assignment model identity is invalid.');
      }
      const record = item.model as Record<string, unknown>;
      if (typeof record.name !== 'string' || !record.name || typeof record.version !== 'string' || !record.version) {
        throw new Error('A hand assignment model identity is incomplete.');
      }
      model = {name: record.name, version: record.version};
    }
    if ((item.source === 'midi2hands' || item.source === 'hybrid') && !model) {
      throw new Error('A model hand assignment has no model identity.');
    }
    result[id] = {
      hand: item.hand, source: item.source, confidence: item.confidence,
      manual: item.manual, ...(typeof item.reason === 'string' ? {reason: item.reason} : {}),
      ...(typeof item.fingerprint === 'string' ? {fingerprint: item.fingerprint} : {}),
      ...(model ? {model} : {}),
    };
  }
  return {hand_assignment_version: 1, hand_assignments: result};
}
