/** Local application of a verification finding to the working note list.
 *
 * The server remains the source of truth, but applying the edit locally preserves
 * unrelated manual note edits while a decision response is in flight.
 */
import type {MusicDraftEvent} from '../../../../packages/lesson-schema/index';
import type {VerificationEdit, VerificationFinding} from './verification';

const FLOAT_FIELDS = new Set(['onset', 'duration', 'velocity']);

const note = (id: string, onset: number, duration: number, pitch: number,
              velocity: number | null): MusicDraftEvent => ({
  id, onset, duration, pitch, velocity, confidence: null, optional: false, string: null, fret: null,
});

function clampDuration(onset: number, duration: number, clip: number) {
  const length = Math.min(duration, clip - onset);
  if (onset < 0 || length <= 0.001) throw new Error('The proposed note lies outside the clip.');
  return length;
}

function matches(item: MusicDraftEvent, before: unknown): boolean {
  if (!before || typeof before !== 'object' || Array.isArray(before)) return false;
  const expected = before as Record<string, unknown>;
  if ('id' in expected && String(item.id) !== String(expected.id)) return false;
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'id') continue;
    const actual = (item as unknown as Record<string, unknown>)[key];
    if (FLOAT_FIELDS.has(key)) {
      if (value === null || actual === null || actual === undefined) {
        if (value !== actual) return false;
      } else if (Math.abs(Number(actual) - Number(value)) > 1e-6) return false;
    } else if (actual !== value) return false;
  }
  return true;
}

function sorted(events: MusicDraftEvent[]) {
  return events.sort((left, right) => left.onset - right.onset || left.pitch - right.pitch || left.id.localeCompare(right.id));
}

export function applyFindingEdits(events: MusicDraftEvent[], finding: VerificationFinding,
                                  clip: number, enforce = true): MusicDraftEvent[] {
  let result = events.map(event => ({...event}));
  const locate = (identifier: string) => {
    const item = result.find(event => String(event.id) === identifier);
    if (!item) throw new Error('This suggestion refers to a note that is no longer present.');
    return item;
  };
  for (const edit of finding.proposed_edits) {
    const before = edit.before;
    const after = edit.after as Record<string, unknown> | unknown[] | null;
    const identifiers = edit.event_ids.map(String);
    if (edit.op === 'set_onset') {
      const value = Number((after as Record<string, unknown>).onset);
      for (const identifier of identifiers) {
        const item = locate(identifier);
        if (enforce && before && typeof before === 'object' && !Array.isArray(before) &&
            'onset' in before && Math.abs(item.onset - Number((before as Record<string, unknown>).onset)) > 1e-6) {
          throw new Error('The note timing changed after this suggestion was generated.');
        }
        if (!Number.isFinite(value) || value < 0 || value > clip) throw new Error('The proposed timing lies outside the clip.');
        if (value + (item.duration ?? 0) > clip + 1e-6) throw new Error('The proposed note would extend past the clip.');
        item.onset = value;
      }
    } else if (edit.op === 'set_pitch') {
      const value = Number((after as Record<string, unknown>).pitch);
      for (const identifier of identifiers) {
        const item = locate(identifier);
        if (enforce && before && typeof before === 'object' && !Array.isArray(before) &&
            'pitch' in before && item.pitch !== Number((before as Record<string, unknown>).pitch)) {
          throw new Error('The note pitch changed after this suggestion was generated.');
        }
        if (!Number.isInteger(value) || value < 0 || value > 127) throw new Error('The proposed pitch is invalid.');
        item.pitch = value;
      }
    } else if (edit.op === 'delete_note') {
      for (const identifier of identifiers) {
        const item = locate(identifier);
        if (enforce && !matches(item, before)) throw new Error('This note changed after the suggestion was generated.');
      }
      result = result.filter(item => !identifiers.includes(String(item.id)));
    } else if (edit.op === 'merge') {
      if (identifiers.length !== 2) throw new Error('A merge needs two notes.');
      const matchesList = identifiers.map(locate);
      if (enforce) {
        const snapshots = Array.isArray(before) ? before : [];
        if (!matchesList.every(item => snapshots.some(snapshot => matches(item, snapshot)))) {
          throw new Error('A merged note changed after this suggestion was generated.');
        }
      }
      const data = after as Record<string, unknown>;
      const onset = Number(data.onset);
      const length = clampDuration(onset, Number(data.duration), clip);
      const merged = note(`vf-${finding.id}-m`, onset, length, Number(data.pitch),
        Math.max(...matchesList.map(item => item.velocity ?? 0)));
      result = result.filter(item => !identifiers.includes(String(item.id))).concat(merged);
    } else if (edit.op === 'split_note') {
      if (identifiers.length !== 1) throw new Error('A split needs one note.');
      const original = locate(identifiers[0]);
      if (enforce && !matches(original, before)) throw new Error('This note changed after the suggestion was generated.');
      const pieces = (Array.isArray(after) ? after : []) as Record<string, unknown>[];
      const created = pieces.map((piece, index) => {
        const onset = Number(piece.onset);
        return note(`vf-${finding.id}-${index + 1}`, onset, clampDuration(onset, Number(piece.duration), clip),
          Number(piece.pitch), original.velocity);
      });
      result = result.filter(item => String(item.id) !== identifiers[0]).concat(created);
    } else if (edit.op === 'add_note') {
      const data = after as Record<string, unknown>;
      const onset = Number(data.onset);
      result.push(note(`vf-${finding.id}-a`, onset, clampDuration(onset, Number(data.duration), clip),
        Number(data.pitch), data.velocity === null || data.velocity === undefined ? null : Number(data.velocity)));
    } else {
      throw new Error('This suggestion uses an unsupported operation.');
    }
  }
  return sorted(result);
}

export function revertFindingEdits(events: MusicDraftEvent[], finding: VerificationFinding,
                                   clip: number): MusicDraftEvent[] {
  let result = events.map(event => ({...event}));
  const locate = (identifier: string) => {
    const item = result.find(event => String(event.id) === identifier);
    if (!item) throw new Error('The accepted change is no longer present.');
    return item;
  };
  for (const edit of finding.proposed_edits) {
    const before = edit.before;
    const after = edit.after as Record<string, unknown> | unknown[] | null;
    const identifiers = edit.event_ids.map(String);
    if (edit.op === 'set_onset') {
      const value = Number((after as Record<string, unknown>).onset);
      for (const identifier of identifiers) {
        const item = locate(identifier);
        if (Math.abs(item.onset - value) > 1e-4) throw new Error('The note timing was edited after acceptance.');
        if (!before || typeof before !== 'object' || Array.isArray(before)) throw new Error('The original timing is unavailable.');
        item.onset = Number((before as Record<string, unknown>).onset);
      }
    } else if (edit.op === 'set_pitch') {
      const value = Number((after as Record<string, unknown>).pitch);
      for (const identifier of identifiers) {
        const item = locate(identifier);
        if (item.pitch !== value) throw new Error('The note pitch was edited after acceptance.');
        if (!before || typeof before !== 'object' || Array.isArray(before)) throw new Error('The original pitch is unavailable.');
        item.pitch = Number((before as Record<string, unknown>).pitch);
      }
    } else if (edit.op === 'delete_note') {
      if (before && typeof before === 'object' && !Array.isArray(before)) {
        const snapshot = before as Record<string, unknown>;
        if (!result.some(item => String(item.id) === String(snapshot.id))) {
          result.push({...note(String(snapshot.id), Number(snapshot.onset), Number(snapshot.duration),
            Number(snapshot.pitch), snapshot.velocity === null ? null : Number(snapshot.velocity)), ...snapshot});
        }
      }
    } else if (edit.op === 'add_note') {
      result = result.filter(item => String(item.id) !== `vf-${finding.id}-a`);
    } else if (edit.op === 'merge') {
      result = result.filter(item => String(item.id) !== `vf-${finding.id}-m`);
      if (Array.isArray(before)) {
        for (const snapshot of before) {
          if (!result.some(item => String(item.id) === String((snapshot as Record<string, unknown>).id))) {
            result.push({...note(String((snapshot as Record<string, unknown>).id),
              Number((snapshot as Record<string, unknown>).onset), Number((snapshot as Record<string, unknown>).duration),
              Number((snapshot as Record<string, unknown>).pitch),
              (snapshot as Record<string, unknown>).velocity === null ? null : Number((snapshot as Record<string, unknown>).velocity)), ...snapshot});
          }
        }
      }
    } else if (edit.op === 'split_note') {
      for (let index = 0; index < ((Array.isArray(after) ? after.length : 0)); index += 1) {
        result = result.filter(item => String(item.id) !== `vf-${finding.id}-${index + 1}`);
      }
      if (before && typeof before === 'object' && !Array.isArray(before)) {
        const snapshot = before as Record<string, unknown>;
        if (!result.some(item => String(item.id) === String(snapshot.id))) {
          result.push({...note(String(snapshot.id), Number(snapshot.onset), Number(snapshot.duration),
            Number(snapshot.pitch), snapshot.velocity === null ? null : Number(snapshot.velocity)), ...snapshot});
        }
      }
    } else {
      throw new Error('This suggestion uses an unsupported operation.');
    }
  }
  return sorted(result);
}
