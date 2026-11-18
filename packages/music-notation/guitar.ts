/**
 * Guitar geometry shared by the notation engine, the editor and the practice surfaces.
 *
 * Application convention (matching the API contracts): string 1 is the highest string
 * and string 6 is the lowest. A fret of 0 means the open string; with a capo it means
 * "at the capo". Positions are always `openStringPitch(string, setup) + fret`.
 */
export const GUITAR_STRING_COUNT = 6;
export const MAX_FRET = 24;
/** Lowest standard/alternate open pitch (D2). */
export const MIN_GUITAR_PITCH = 38;
/** Highest standard open string plus the 24th fret. */
export const MAX_GUITAR_PITCH = 88;

export type GuitarTuningId = 'standard' | 'drop_d' | 'half_step_down' | 'dadgad';
export type GuitarSetup = {tuning?: GuitarTuningId; capo?: number};

export type GuitarTuning = {
  id: GuitarTuningId;
  label: string;
  /** Open-string MIDI pitch by canonical string number (1 = highest). */
  openPitches: Readonly<Record<number, number>>;
  /** Display order used by the TAB staff/roll: high string first. */
  stringLabels: ReadonlyArray<string>;
  /** @moonwave99/fretboard.js tuning order: low string first. */
  fretboardTuning: ReadonlyArray<string>;
};

export const GUITAR_TUNINGS: Readonly<Record<GuitarTuningId, GuitarTuning>> = Object.freeze({
  standard: {
    id: 'standard',
    label: 'Standard (E A D G B E)',
    openPitches: Object.freeze({1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}),
    stringLabels: Object.freeze(['E4', 'B3', 'G3', 'D3', 'A2', 'E2']),
    fretboardTuning: Object.freeze(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']),
  },
  drop_d: {
    id: 'drop_d',
    label: 'Drop D (D A D G B E)',
    openPitches: Object.freeze({1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 38}),
    stringLabels: Object.freeze(['E4', 'B3', 'G3', 'D3', 'A2', 'D2']),
    fretboardTuning: Object.freeze(['D2', 'A2', 'D3', 'G3', 'B3', 'E4']),
  },
  half_step_down: {
    id: 'half_step_down',
    label: 'Half-Step Down (Eb Ab Db Gb Bb Eb)',
    openPitches: Object.freeze({1: 63, 2: 58, 3: 54, 4: 49, 5: 44, 6: 39}),
    stringLabels: Object.freeze(['Eb4', 'Bb3', 'Gb3', 'Db3', 'Ab2', 'Eb2']),
    fretboardTuning: Object.freeze(['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4']),
  },
  dadgad: {
    id: 'dadgad',
    label: 'DADGAD (D A D G A D)',
    openPitches: Object.freeze({1: 62, 2: 57, 3: 55, 4: 50, 5: 45, 6: 38}),
    stringLabels: Object.freeze(['D4', 'A3', 'G3', 'D3', 'A2', 'D2']),
    fretboardTuning: Object.freeze(['D2', 'A2', 'D3', 'G3', 'A3', 'D4']),
  },
});

export const DEFAULT_GUITAR_SETUP: Required<GuitarSetup> = {tuning: 'standard', capo: 0};

export function isGuitarTuningId(value: unknown): value is GuitarTuningId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUITAR_TUNINGS, value);
}

export function normalizeGuitarSetup(setup?: GuitarSetup): Required<GuitarSetup> {
  const requestedTuning = setup?.tuning;
  const tuning = isGuitarTuningId(requestedTuning) ? requestedTuning : DEFAULT_GUITAR_SETUP.tuning;
  const rawCapo = setup?.capo;
  const capo = typeof rawCapo === 'number' && Number.isInteger(rawCapo)
    ? Math.max(0, Math.min(12, rawCapo)) : DEFAULT_GUITAR_SETUP.capo;
  return {tuning, capo};
}

/** Backwards-compatible standard-tuning open pitches by canonical string number. */
export const OPEN_STRING: Readonly<Record<number, number>> = GUITAR_TUNINGS.standard.openPitches;

/** Backwards-compatible standard display order used by the TAB staff: high E first. */
export const GUITAR_STRING_LABELS: ReadonlyArray<{string: number; label: string; pitch: number}> =
  GUITAR_TUNINGS.standard.stringLabels.map((label, index) => ({
    string: index + 1, label, pitch: GUITAR_TUNINGS.standard.openPitches[index + 1],
  }));

export type GuitarFingering = {string: number; fret: number};

/** Sounding pitch of a string at its open/capo position. */
export function openStringPitch(string: number, setup?: GuitarSetup): number | null {
  const {tuning, capo} = normalizeGuitarSetup(setup);
  const open = GUITAR_TUNINGS[tuning].openPitches[string];
  return open === undefined ? null : open + capo;
}

/** Playable pitch range for the active tuning and capo, inclusive. */
export function isGuitarPitch(pitch: number, setup?: GuitarSetup): boolean {
  if (!Number.isInteger(pitch)) return false;
  const {tuning, capo} = normalizeGuitarSetup(setup);
  const open = Object.values(GUITAR_TUNINGS[tuning].openPitches);
  const low = Math.min(...open) + capo;
  const high = Math.max(...open) + capo + MAX_FRET;
  return pitch >= low && pitch <= high;
}

export function isGuitarString(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= GUITAR_STRING_COUNT;
}

export function isGuitarFret(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_FRET;
}

/** True when the supplied position is physically consistent with the pitch. */
export function isPlayablePosition(pitch: number, string: unknown, fret: unknown, setup?: GuitarSetup): boolean {
  if (!isGuitarString(string) || !isGuitarFret(fret)) return false;
  const open = openStringPitch(string, setup);
  return open !== null && open + (fret as number) === pitch;
}

/**
 * Deterministic ergonomic assignment: prefer open strings and the lowest fret, which
 * keeps the hand in a low position and matches how the player would read the TAB.
 * Pitches outside the active tuning's range return null rather than inventing a shape.
 */
export function guitarFingering(pitch: number, setup?: GuitarSetup): GuitarFingering | null {
  if (!isGuitarPitch(pitch, setup)) return null;
  let best: GuitarFingering | null = null;
  for (const string of [1, 2, 3, 4, 5, 6]) {
    const open = openStringPitch(string, setup);
    if (open === null) continue;
    const fret = pitch - open;
    if (fret < 0 || fret > MAX_FRET) continue;
    if (!best || fret < best.fret || (fret === best.fret && string < best.string)) {
      best = {string, fret};
    }
  }
  return best;
}

/**
 * Canonical string/fret for a sounding pitch. Browser surfaces use this name; it is
 * the same deterministic ergonomic assignment as {@link guitarFingering}.
 */
export const guitarStringForPitch = guitarFingering;

/**
 * Keep a supplied position when it is playable; otherwise fall back to the ergonomic
 * assignment. Used when a transcription or a manual pitch edit leaves string/fret null.
 */
export function resolveGuitarPosition(
  pitch: number, string: number | null, fret: number | null, setup?: GuitarSetup,
): GuitarFingering | null {
  if (isPlayablePosition(pitch, string, fret, setup)) return {string: string as number, fret: fret as number};
  return guitarFingering(pitch, setup);
}

/** Reassign a string while holding the sounding pitch invariant. */
export function fretOnString(
  pitch: number, string: number, setup?: GuitarSetup,
): {ok: true; fret: number} | {ok: false; message: string} {
  if (!isGuitarString(string)) return {ok: false, message: 'A guitar string must be 1 to 6.'};
  const open = openStringPitch(string, setup);
  if (open === null) return {ok: false, message: 'That guitar string is not available in this tuning.'};
  const fret = pitch - open;
  if (fret < 0 || fret > MAX_FRET) {
    return {ok: false, message: `That note cannot be played on string ${string} between frets 0 and ${MAX_FRET}.`};
  }
  return {ok: true, fret};
}

/* ------------------------------------------------------------- fingering */

export type GuitarFinger = 0 | 1 | 2 | 3 | 4;

export const GUITAR_FINGER_PALETTE: Readonly<Record<GuitarFinger, {finger: GuitarFinger; label: string; color: string}>> =
  Object.freeze({
    0: {finger: 0, label: 'Open', color: '#94a3b8'},
    1: {finger: 1, label: 'Index', color: '#4a90e2'},
    2: {finger: 2, label: 'Middle', color: '#50b86c'},
    3: {finger: 3, label: 'Ring', color: '#e6a23c'},
    4: {finger: 4, label: 'Pinky', color: '#d96b98'},
  });

/** Map a fret to a finger in the current hand position. */
export function fingerForFret(fret: number, basePosition = 1): GuitarFinger {
  if (!Number.isFinite(fret) || fret <= 0) return 0;
  const offset = fret - Math.max(1, basePosition);
  return offset <= 0 ? 1 : offset === 1 ? 2 : offset === 2 ? 3 : 4;
}

export type FingerableNote = {
  id: string;
  onset: number;
  string: number | null;
  fret: number | null;
  pitch?: number;
  /** Sustained notes remain part of the hand context while they still sound. */
  duration?: number | null;
};

/**
 * Assign a finger to every playable occurrence. The hand position is the lowest
 * positive fret among notes in the same 1.5 s lookback (plus the current strum rake),
 * including sustained notes that started earlier but are still sounding.
 */
export function assignGuitarFingers(
  notes: ReadonlyArray<FingerableNote>, setup?: GuitarSetup,
): Record<string, GuitarFinger> {
  // Deterministic chord order independent of arbitrary note ids.
  const ordered = [...notes].sort((left, right) =>
    left.onset - right.onset
    || (right.string ?? -1) - (left.string ?? -1)
    || (left.fret ?? -1) - (right.fret ?? -1)
    || (left.pitch ?? -1) - (right.pitch ?? -1)
    || left.id.localeCompare(right.id));
  const resolved = ordered.flatMap(note => {
    const pitch = note.pitch ?? (note.string != null
      ? (openStringPitch(note.string, setup) ?? 0) + (note.fret ?? 0) : null);
    if (pitch === null) return [];
    const position = resolveGuitarPosition(pitch, note.string, note.fret, setup);
    return position ? [{note, string: position.string, fret: position.fret}] : [];
  });
  const fingers: Record<string, GuitarFinger> = {};
  for (const item of resolved) {
    const t = item.note.onset;
    const active = resolved.filter(other =>
      (other.note.onset >= t - 1.5 && other.note.onset <= t + 0.055)
      || (other.note.onset <= t
        && other.note.onset + Math.max(0, other.note.duration ?? 0) >= t - 1e-6));
    const positive = active.map(other => other.fret).filter(fret => fret > 0);
    const basePosition = positive.length ? Math.min(...positive) : 1;
    fingers[item.note.id] = fingerForFret(item.fret, basePosition);
  }
  return fingers;
}
