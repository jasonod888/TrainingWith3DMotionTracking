/**
 * One transaction contract for verification findings: prepare an atomic command
 * sequence, capture an operation-aware accepted baseline (present and intentionally
 * absent occurrences, plus authored before-state), validate it, and build a safe
 * inverse. Pure and DOM-free so the matrix is testable without React.
 */
import {
  applyCommand,
  parseSpelling,
  secondsToTick,
  type Alignment,
  type CorrectionCommand,
  type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import type {VerificationFinding} from '../verification';

export type AuthoredOccurrence =
  | {
      present: true;
      pitch: number;
      onset: number;
      duration: number | null;
      velocity: number | null;
      spelling: string;
      staff: 'treble' | 'bass';
      voice: 1 | 2;
      eventStart: number;
      eventDuration: number;
      notationDuration: number | null;
      confidence: number | null;
      optional: boolean;
      string: number | null;
      fret: number | null;
    }
  | {present: false; occurrenceId: string};

export type AcceptedBaseline = {
  version: 1;
  findingId: string;
  /** Accepted after-state, including explicit absence for deleted/merged originals. */
  entries: Record<string, AuthoredOccurrence>;
  /** Authored state before the transaction, for restoring removed/replaced notes. */
  before: Record<string, AuthoredOccurrence>;
};

export type Prepared =
  | {status: 'applied'; commands: CorrectionCommand[]; baseline: AcceptedBaseline; document: NotationDocument}
  | {status: 'unchanged'; reason: string}
  | {status: 'rejected'; reason: string};

export function captureOccurrence(document: NotationDocument, id: string): AuthoredOccurrence {
  const note = document.performance.find(item => item.id === id);
  if (!note) return {present: false, occurrenceId: id};
  const event = document.events.find(item => item.notes.some(n => n.performance_ids.includes(id)));
  const written = event?.notes.find(n => n.performance_ids.includes(id));
  if (!event || !written) return {present: false, occurrenceId: id};
  return {
    present: true, pitch: note.pitch, onset: note.onset, duration: note.duration,
    velocity: note.velocity, spelling: written.spelling, staff: event.staff, voice: event.voice,
    eventStart: event.start, eventDuration: event.duration,
    notationDuration: note.notation_duration ?? null,
    confidence: note.confidence, optional: note.optional,
    string: note.string, fret: note.fret,
  };
}

/** IDs a finding touches, with whether the accepted result must contain them. */
export function affectedIds(finding: VerificationFinding): Array<{id: string; present: boolean}> {
  const result = new Map<string, boolean>();
  for (const edit of finding.proposed_edits) {
    for (const raw of edit.event_ids) {
      const id = String(raw);
      if (edit.op === 'delete_note') result.set(id, false);
      else if (edit.op === 'merge') result.set(id, false);
      else if (edit.op === 'split_note') result.set(id, false);
      else if (!result.has(id)) result.set(id, true);
    }
    if (edit.op === 'add_note') result.set(`vf-${finding.id}-a`, true);
    if (edit.op === 'merge') result.set(`vf-${finding.id}-m`, true);
    if (edit.op === 'split_note' && Array.isArray(edit.after)) {
      (edit.after as unknown[]).forEach((_, index) => result.set(`vf-${finding.id}-${index + 1}`, true));
    }
  }
  return [...result].map(([id, present]) => ({id, present}));
}

function tickFor(alignment: Alignment | null, seconds: number): number | undefined {
  return alignment ? Math.max(0, Math.round(secondsToTick(alignment, seconds) / 120) * 120) : undefined;
}

function insertCommand(id: string, state: AuthoredOccurrence, alignment: Alignment | null): CorrectionCommand | null {
  if (!state.present) return null;
  return {
    type: 'insert-note', id, pitch: state.pitch, onsetSeconds: state.onset,
    startTicks: state.eventStart, durationTicks: state.eventDuration,
    staff: state.staff, voice: state.voice, velocity: state.velocity, addToChord: true,
    allowDuplicate: true,
    durationSeconds: state.duration,
    restore: {notation_duration: state.notationDuration, confidence: state.confidence,
      optional: state.optional, string: state.string, fret: state.fret, velocity: state.velocity},
  };
}

function restoreCommands(id: string, state: AuthoredOccurrence, alignment: Alignment | null): CorrectionCommand[] {
  if (!state.present) return [];
  const insert = insertCommand(id, state, alignment);
  if (!insert) return [];
  return [insert, {type: 'set-occurrence-pitch', occurrenceId: id, pitch: state.pitch, spelling: state.spelling}];
}

function removeCommand(id: string): CorrectionCommand {
  return {type: 'delete-occurrence', occurrenceId: id};
}

/** Build the explicit accepted after-state from a simulated result. */
function captureAfter(document: NotationDocument, finding: VerificationFinding): Record<string, AuthoredOccurrence> {
  const entries: Record<string, AuthoredOccurrence> = {};
  for (const {id} of affectedIds(finding)) entries[id] = captureOccurrence(document, id);
  return entries;
}

function matchesState(actual: AuthoredOccurrence, expected: AuthoredOccurrence): boolean {
  if (expected.present !== actual.present) return false;
  if (!expected.present) return true;
  if (!actual.present) return false;
  return actual.pitch === expected.pitch
    && Math.abs(actual.onset - expected.onset) < 1e-6
    && (actual.duration ?? 0) === (expected.duration ?? 0)
    && (actual.velocity ?? -1) === (expected.velocity ?? -1)
    && actual.spelling === expected.spelling
    && actual.staff === expected.staff
    && actual.voice === expected.voice
    && actual.eventStart === expected.eventStart
    && actual.eventDuration === expected.eventDuration
    && actual.notationDuration === expected.notationDuration
    && actual.confidence === expected.confidence
    && actual.optional === expected.optional
    && actual.string === expected.string
    && actual.fret === expected.fret;
}

export function validateBaseline(finding: VerificationFinding, value: unknown): {ok: true; baseline: AcceptedBaseline}
  | {ok: false; reason: string} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {ok: false, reason: 'unavailable reversal baseline'};
  const baseline = value as Partial<AcceptedBaseline>;
  if (baseline.version !== 1 || baseline.findingId !== finding.id) {
    return {ok: false, reason: 'baseline belongs to another finding or version'};
  }
  if (!baseline.entries || typeof baseline.entries !== 'object' || Array.isArray(baseline.entries)) {
    return {ok: false, reason: 'baseline has no affected occurrences'};
  }
  if (!baseline.before || typeof baseline.before !== 'object' || Array.isArray(baseline.before)) {
    return {ok: false, reason: 'baseline has no authored before-state'};
  }
  const required = affectedIds(finding);
  if (!required.length) return {ok: false, reason: 'finding touches no occurrences'};
  const presentEntry = (entry: unknown): entry is Extract<AuthoredOccurrence, {present: true}> => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Record<string, unknown>;
    if (!(typeof item.pitch === 'number' && Number.isInteger(item.pitch) && item.pitch >= 0 && item.pitch <= 127)) return false;
    if (!(typeof item.onset === 'number' && Number.isFinite(item.onset) && item.onset >= 0)) return false;
    if (!(item.duration === null || (typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration > 0))) return false;
    if (!(item.velocity === null || (typeof item.velocity === 'number' && Number.isFinite(item.velocity) && item.velocity >= 0 && item.velocity <= 1))) return false;
    if (!(typeof item.spelling === 'string' && item.spelling.length > 0 && item.spelling.length <= 12)) return false;
    let parsed: {pitch: number};
    try { parsed = parseSpelling(item.spelling as string); } catch { return false; }
    if (parsed.pitch !== item.pitch) return false;
    if (item.staff !== 'treble' && item.staff !== 'bass') return false;
    if (item.voice !== 1 && item.voice !== 2) return false;
    if (!(typeof item.eventStart === 'number' && Number.isInteger(item.eventStart) && item.eventStart >= 0
      && item.eventStart % 120 === 0)) return false;
    if (!(typeof item.eventDuration === 'number' && Number.isInteger(item.eventDuration)
      && item.eventDuration >= 120 && item.eventDuration % 120 === 0)) return false;
    if (!(item.notationDuration === null || (typeof item.notationDuration === 'number'
      && Number.isFinite(item.notationDuration) && item.notationDuration > 0))) return false;
    if (!(item.confidence === null || (typeof item.confidence === 'number'
      && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1))) return false;
    if (typeof item.optional !== 'boolean') return false;
    if (!(item.string === null || (typeof item.string === 'number' && Number.isInteger(item.string)
      && item.string >= 1 && item.string <= 6))) return false;
    if (!(item.fret === null || (typeof item.fret === 'number' && Number.isInteger(item.fret)
      && item.fret >= 0 && item.fret <= 24))) return false;
    return true;
  };
  for (const {id, present} of required) {
    const entry = (baseline.entries as Record<string, unknown>)[id];
    if (!entry || typeof entry !== 'object') return {ok: false, reason: `missing baseline entry for ${id}`};
    if (present) {
      if (!presentEntry(entry)) return {ok: false, reason: `invalid present state for ${id}`};
      if ((entry as {present?: boolean}).present !== true) return {ok: false, reason: `expected ${id} to be present`};
    } else {
      const absent = entry as {present?: boolean; occurrenceId?: unknown};
      if (absent.present !== false || absent.occurrenceId !== id) {
        return {ok: false, reason: `expected explicit absence for ${id}`};
      }
    }
    const before = (baseline.before as Record<string, unknown>)[id];
    const synthetic = id.startsWith(`vf-${finding.id}-`);
    if (present && synthetic) continue; // inserted by the transaction; no before-state
    if (before === undefined) return {ok: false, reason: `missing authored before-state for ${id}`};
    if (!presentEntry(before)) {
      return {ok: false, reason: present ? `invalid before-state for ${id}` : `removed ${id} has no authored before-state`};
    }
  }
  return {ok: true, baseline: baseline as AcceptedBaseline};
}

export function matchesBaseline(document: NotationDocument, finding: VerificationFinding,
  baseline: AcceptedBaseline): boolean {
  for (const [id, expected] of Object.entries(baseline.entries)) {
    if (!matchesState(captureOccurrence(document, id), expected)) return false;
  }
  for (const {id, present} of affectedIds(finding)) {
    const entry = baseline.entries[id];
    if (!entry || entry.present !== present) return false;
  }
  return true;
}

/** Apply commands to a candidate copy, all-or-nothing. */
export function stage(document: NotationDocument, commands: CorrectionCommand[]):
  {ok: true; document: NotationDocument} | {ok: false; reason: string} {
  let candidate = document;
  for (const command of commands) {
    const outcome = applyCommand(candidate, command);
    if (outcome.status === 'rejected') return {ok: false, reason: outcome.message};
    if (outcome.status === 'applied') candidate = outcome.document;
  }
  return {ok: true, document: candidate};
}

function applyCommands(document: NotationDocument, finding: VerificationFinding,
  alignment: Alignment | null): CorrectionCommand[] | {reason: string} {
  const commands: CorrectionCommand[] = [];
  for (const edit of finding.proposed_edits) {
    const after = (edit.after ?? {}) as Record<string, unknown>;
    if (edit.op === 'set_pitch') {
      for (const id of edit.event_ids) commands.push({type: 'set-occurrence-pitch', occurrenceId: id, pitch: Number(after.pitch)});
    } else if (edit.op === 'set_onset') {
      for (const id of edit.event_ids) commands.push({type: 'set-occurrence-onset', occurrenceId: id, seconds: Number(after.onset)});
    } else if (edit.op === 'delete_note') {
      for (const id of edit.event_ids) commands.push(removeCommand(id));
    } else if (edit.op === 'add_note') {
      const id = `vf-${finding.id}-a`;
      commands.push({type: 'insert-note', id, pitch: Number(after.pitch), onsetSeconds: Number(after.onset),
        durationSeconds: Math.max(0.02, Number(after.duration) || 0.25),
        startTicks: tickFor(alignment, Number(after.onset)),
        velocity: after.velocity === null || after.velocity === undefined ? 0.7 : Number(after.velocity),
        addToChord: true} as CorrectionCommand);
    } else if (edit.op === 'merge') {
      const velocity = Math.max(0, ...(Array.isArray(edit.before) ? edit.before as Record<string, unknown>[] : [])
        .map(event => Number(event.velocity ?? 0)));
      for (const id of edit.event_ids) commands.push(removeCommand(id));
      commands.push({type: 'insert-note', id: `vf-${finding.id}-m`, pitch: Number(after.pitch),
        onsetSeconds: Number(after.onset), durationSeconds: Math.max(0.02, Number(after.duration) || 0.25),
        startTicks: tickFor(alignment, Number(after.onset)), velocity: velocity || 0.7, addToChord: true});
    } else if (edit.op === 'split_note') {
      for (const id of edit.event_ids) commands.push(removeCommand(id));
      const pieces = Array.isArray(edit.after) ? edit.after as Record<string, unknown>[] : [];
      pieces.forEach((piece, index) => commands.push({
        type: 'insert-note', id: `vf-${finding.id}-${index + 1}`, pitch: Number(piece.pitch),
        onsetSeconds: Number(piece.onset), durationSeconds: Math.max(0.02, Number(piece.duration) || 0.25),
        startTicks: tickFor(alignment, Number(piece.onset)), addToChord: true,
      }));
    } else {
      return {reason: `The ${edit.op} suggestion is not supported.`};
    }
  }
  return commands;
}

/** Validate preconditions against the live document at apply time. */
export function matchesBefore(document: NotationDocument, finding: VerificationFinding): boolean {
  for (const edit of finding.proposed_edits) {
    if (edit.op === 'add_note') continue;
    const snapshots = Array.isArray(edit.before) ? edit.before as Record<string, unknown>[]
      : edit.before && typeof edit.before === 'object' ? [edit.before as Record<string, unknown>] : [];
    for (const [index, id] of edit.event_ids.map(String).entries()) {
      const actual = captureOccurrence(document, id);
      if (!actual.present) return false;
      const before = snapshots[index] ?? snapshots[0];
      if (!before) continue;
      if (before.pitch !== undefined && actual.pitch !== Number(before.pitch)) return false;
      if (before.onset !== undefined && Math.abs(actual.onset - Number(before.onset)) > 1e-6) return false;
      if (before.duration !== undefined) {
        if (before.duration === null ? actual.duration !== null
          : actual.duration === null || Math.abs(actual.duration - Number(before.duration)) > 1e-6) return false;
      }
      if (before.velocity !== undefined) {
        if (before.velocity === null ? actual.velocity !== null
          : actual.velocity === null || Math.abs(actual.velocity - Number(before.velocity)) > 1e-6) return false;
      }
      if (before.notation_duration !== undefined) {
        const expected = before.notation_duration === null ? null : Number(before.notation_duration);
        if (expected !== actual.notationDuration) return false;
      }
      if (before.confidence !== undefined) {
        if (before.confidence === null ? actual.confidence !== null
          : actual.confidence === null || Math.abs(actual.confidence - Number(before.confidence)) > 1e-6) return false;
      }
      if (before.optional !== undefined && Boolean(before.optional) !== actual.optional) return false;
      if (before.string !== undefined && (before.string ?? null) !== actual.string) return false;
      if (before.fret !== undefined && (before.fret ?? null) !== actual.fret) return false;
    }
  }
  return true;
}

/** Prepare one atomic transaction or reject without mutating. */
export function prepareFinding(document: NotationDocument, finding: VerificationFinding,
  alignment: Alignment | null): Prepared {
  if (!matchesBefore(document, finding)) {
    return {status: 'rejected', reason: 'This suggestion conflicts with later local edits.'};
  }
  const commands = applyCommands(document, finding, alignment);
  if (!Array.isArray(commands)) return {status: 'rejected', reason: commands.reason};
  const staged = stage(document, commands);
  if (!staged.ok) return {status: 'rejected', reason: staged.reason};
  const before: Record<string, AuthoredOccurrence> = {};
  for (const {id} of affectedIds(finding)) before[id] = captureOccurrence(document, id);
  return {
    status: 'applied', commands, document: staged.document,
    baseline: {version: 1, findingId: finding.id, entries: captureAfter(staged.document, finding), before},
  };
}

/** Build the exact inverse for the accepted state, or refuse. */
export function invertFinding(document: NotationDocument, finding: VerificationFinding,
  alignment: Alignment | null, baselineUnknown: unknown):
  {commands: CorrectionCommand[]; document: NotationDocument} | {reason: string} {
  const checked = validateBaseline(finding, baselineUnknown);
  if (!checked.ok) return {reason: `Reversal unavailable: ${checked.reason}.`};
  if (!matchesBaseline(document, finding, checked.baseline)) {
    return {reason: 'The affected notes changed after the suggestion was accepted.'};
  }
  const commands: CorrectionCommand[] = [];
  for (const edit of finding.proposed_edits) {
    if (edit.op === 'set_pitch' || edit.op === 'set_onset') {
      for (const id of edit.event_ids.map(String)) {
        const before = checked.baseline.before[id];
        if (before?.present) {
          if (edit.op === 'set_pitch') commands.push({type: 'set-occurrence-pitch', occurrenceId: id, pitch: before.pitch, spelling: before.spelling});
          else commands.push({type: 'set-occurrence-onset', occurrenceId: id, seconds: before.onset});
        }
      }
    } else if (edit.op === 'add_note') {
      commands.push(removeCommand(`vf-${finding.id}-a`));
    } else if (edit.op === 'delete_note') {
      for (const id of edit.event_ids.map(String)) commands.push(...restoreCommands(id, checked.baseline.before[id], alignment));
    } else if (edit.op === 'merge') {
      commands.push(removeCommand(`vf-${finding.id}-m`));
      for (const id of edit.event_ids.map(String)) commands.push(...restoreCommands(id, checked.baseline.before[id], alignment));
    } else if (edit.op === 'split_note') {
      const pieces = Array.isArray(edit.after) ? edit.after as unknown[] : [];
      pieces.forEach((_, index) => commands.push(removeCommand(`vf-${finding.id}-${index + 1}`)));
      for (const id of edit.event_ids.map(String)) commands.push(...restoreCommands(id, checked.baseline.before[id], alignment));
    } else {
      return {reason: `The ${edit.op} suggestion cannot be reverted.`};
    }
  }
  const staged = stage(document, commands);
  if (!staged.ok) return {reason: `The reversal cannot be represented safely: ${staged.reason}`};
  return {commands, document: staged.document};
}
