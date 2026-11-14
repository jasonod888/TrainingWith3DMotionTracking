/**
 * Save and reopen payloads for the isolated correction workspace.
 *
 * A saved reference carries the performance events, the authored notation and the
 * versioned alignment. Reopening uses the saved notation verbatim, so authored spelling,
 * written durations, voices/ties, anchors and the offset survive without regeneration.
 */
import {
  buildNotation, parseNotationDocument,
  type Alignment, type NotationDocument, type PerformanceNote,
} from '../../../../../packages/music-notation/index.ts';

export type SavedSpan = { start: number; end: number; kind: 'playing' | 'explanation' };
export type AnchorPointSaved = { seconds: number; tick: number };

export type SavedPassage =
  | { kind: 'timed'; source_seconds: [number, number]; ticks: [number, number] }
  | { kind: 'held'; source_seconds: [number, number]; tick: number };

export type SavedAlignment = {
  alignment_version: 1;
  mode: 'estimated' | 'anchored';
  basis: 'tempo' | 'passages';
  offset_seconds: number;
  anchors: AnchorPointSaved[];
  passages: SavedPassage[];
};

export type RestoredReference = {
  document: NotationDocument;
  alignment: SavedAlignment | null;
  offsetSeconds: number;
  spans: SavedSpan[];
  /** `notation` means authored work was restored verbatim; `performance` means legacy. */
  source: 'notation' | 'performance';
  title: string | null;
};

export type RestoreResult = { ok: true; value: RestoredReference } | { ok: false; message: string };

/** Canonical authoring order: by source time; the server also requires increasing ticks. */
export function canonicalAnchors(anchors: AnchorPointSaved[]): AnchorPointSaved[] {
  return anchors
    .map(anchor => ({seconds: Number(anchor.seconds), tick: Number(anchor.tick)}))
    .filter(anchor => Number.isFinite(anchor.seconds) && Number.isInteger(anchor.tick) && anchor.tick >= 0)
    .sort((left, right) => left.seconds - right.seconds || left.tick - right.tick)
    .filter((anchor, index, list) => index === 0 || anchor.seconds !== list[index - 1].seconds);
}

export function serializeAlignment(
  alignment: Alignment | null, anchors: AnchorPointSaved[], offsetSeconds: number,
): SavedAlignment | null {
  if (!alignment) return null;
  const passages: SavedPassage[] = alignment.passages.map(passage => passage.kind === 'timed'
    ? {kind: 'timed', source_seconds: [passage.source_seconds[0], passage.source_seconds[1]],
        ticks: [passage.ticks[0], passage.ticks[1]]}
    : {kind: 'held', source_seconds: [passage.source_seconds[0], passage.source_seconds[1]], tick: passage.tick});
  return {
    alignment_version: 1,
    mode: anchors.length ? 'anchored' : alignment.mode,
    basis: alignment.basis,
    offset_seconds: offsetSeconds,
    anchors: canonicalAnchors(anchors),
    passages,
  };
}

export function performanceOf(document: NotationDocument): PerformanceNote[] {
  return document.performance.map(note => ({
    id: note.id, onset: note.onset, duration: note.duration, pitch: note.pitch,
    velocity: note.velocity, confidence: note.confidence, optional: note.optional,
    string: note.string, fret: note.fret, notation_duration: note.notation_duration ?? null,
  }));
}

/** Identity of the audible performance; spelling and layout are deliberately absent. */
export function performanceFingerprint(document: NotationDocument): string {
  return JSON.stringify(document.performance.map(note => [
    note.id, note.onset, note.duration, note.pitch, note.velocity, note.optional,
  ]));
}

export function performanceChanged(before: NotationDocument, after: NotationDocument): boolean {
  return performanceFingerprint(before) !== performanceFingerprint(after);
}

export function buildSaveBody(input: {
  title: string;
  document: NotationDocument;
  spans: SavedSpan[];
  alignment: Alignment | null;
  anchors: AnchorPointSaved[];
  offsetSeconds: number;
  baseRevisionId?: string | null;
  draftId?: string | null;
  referenceSha256?: string | null;
  verificationStateToken?: string | null;
  sections?: { id: string; label: string; start: number; end: number }[];
  assessment?: unknown;
}) {
  const duration = input.document.duration;
  return {
    // The review contract names the draft; the revision contract names its base.
    // Sending both would be rejected, so each payload carries only its own identity.
    ...(input.baseRevisionId
      ? {base_revision_id: input.baseRevisionId}
      : {
          ...(input.draftId ? {draft_id: input.draftId} : {}),
          ...(input.referenceSha256 ? {reference_sha256: input.referenceSha256} : {}),
          ...(input.verificationStateToken ? {verification_state_token: input.verificationStateToken} : {}),
        }),
    title: input.title || 'Piano correction',
    events: performanceOf(input.document),
    spans: input.spans,
    sections: input.sections?.length ? input.sections : [{id: 'whole', label: 'Whole lesson', start: 0, end: duration}],
    assessment: input.assessment ?? {assessment: 'none', input_modes: ['none'], dimensions: [], rubric_version: 'music-watch-v1'},
    confirm_reviewed: true as const,
    notation: input.document,
    alignment: serializeAlignment(input.alignment, input.anchors, input.offsetSeconds),
    offset_seconds: input.offsetSeconds,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function savedAlignment(value: unknown, fallbackOffset: number): SavedAlignment | null {
  if (!isRecord(value)) return null;
  if (value.alignment_version !== 1) return null;
  const mode = value.mode === 'anchored' ? 'anchored' : 'estimated';
  const basis = value.basis === 'passages' ? 'passages' : 'tempo';
  const offset = Number.isFinite(value.offset_seconds) ? Number(value.offset_seconds) : fallbackOffset;
  const anchors = Array.isArray(value.anchors)
    ? value.anchors.filter(isRecord).map(anchor => ({seconds: Number(anchor.seconds), tick: Number(anchor.tick)}))
      .filter(anchor => Number.isFinite(anchor.seconds) && Number.isInteger(anchor.tick))
    : [];
  // The complete map is restored as stored; malformed passages are refused, not filtered.
  if (!Array.isArray(value.passages) || !value.passages.length) return null;
  const passages: SavedPassage[] = [];
  for (const passage of value.passages) {
    if (!isRecord(passage)) return null;
    const seconds = passage.source_seconds;
    if (!Array.isArray(seconds) || seconds.length !== 2) return null;
    const start = Number(seconds[0]);
    const end = Number(seconds[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    if (passage.kind === 'timed') {
      const ticks = passage.ticks;
      if (!Array.isArray(ticks) || ticks.length !== 2) return null;
      const first = Number(ticks[0]);
      const last = Number(ticks[1]);
      if (!Number.isInteger(first) || !Number.isInteger(last) || last <= first) return null;
      passages.push({kind: 'timed', source_seconds: [start, end], ticks: [first, last]});
    } else if (passage.kind === 'held') {
      const tick = Number(passage.tick);
      if (!Number.isInteger(tick) || tick < 0) return null;
      passages.push({kind: 'held', source_seconds: [start, end], tick});
    } else {
      return null;
    }
  }
  return {alignment_version: 1, mode, basis, offset_seconds: offset, anchors, passages};
}

export function restoreFromReference(value: unknown): RestoreResult {
  if (!isRecord(value)) return {ok: false, message: 'The saved reference is not an object.'};
  const duration = Number(value.duration);
  const spans: SavedSpan[] = Array.isArray(value.spans)
    ? value.spans.filter(isRecord).map(span => ({
        start: Number(span.start), end: Number(span.end),
        kind: span.kind === 'explanation' ? 'explanation' as const : 'playing' as const,
      })).filter(span => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    : [];
  const alignment = savedAlignment(value.alignment, 0);
  if (value.alignment !== undefined && value.alignment !== null && alignment === null) {
    return {ok: false, message: 'The saved alignment is not a supported version.'};
  }
  if (alignment && !alignment.passages.length) {
    return {ok: false, message: 'The saved alignment has no passages.'};
  }
  const offsetSeconds = alignment?.offset_seconds ?? (Number.isFinite(value.offset_seconds) ? Number(value.offset_seconds) : 0);

  if (value.notation !== undefined && value.notation !== null) {
    try {
      const document = parseNotationDocument(value.notation);
      if (Number.isFinite(duration) && Math.abs(document.duration - duration) > 1e-6) {
        return {ok: false, message: 'The saved notation duration does not match its reference.'};
      }
      // The reference events and the notation performance must describe the same
      // recorded performance; a disagreement means the stored reference is corrupt.
      if (Array.isArray(value.events)) {
        const recorded = new Map<string, {onset: number; duration: number | null; pitch: number}>();
        for (const event of value.events) {
          if (!isRecord(event) || typeof event.id !== 'string') {
            return {ok: false, message: 'The saved reference has an invalid performance event.'};
          }
          recorded.set(event.id, {
            onset: Number(event.onset), pitch: Number(event.pitch),
            duration: event.duration === null || event.duration === undefined ? null : Number(event.duration),
          });
        }
        if (recorded.size !== value.events.length) {
          return {ok: false, message: 'The saved reference repeats a performance id.'};
        }
        const owned = new Set<string>();
        for (const note of document.performance) {
          const stored = recorded.get(note.id);
          if (!stored || stored.pitch !== note.pitch || Math.abs(stored.onset - note.onset) > 1e-6 ||
            stored.duration !== note.duration) {
            return {ok: false, message: 'The saved reference disagrees with its notation performance.'};
          }
          if (owned.has(note.id)) return {ok: false, message: 'The saved reference repeats an occurrence.'};
          owned.add(note.id);
        }
        if (owned.size !== recorded.size) {
          return {ok: false, message: 'The saved reference leaves an occurrence unmapped.'};
        }
      }
      return {ok: true, value: {document, alignment, offsetSeconds, spans, source: 'notation', title: typeof value.title === 'string' ? value.title : null}};
    } catch (cause) {
      return {ok: false, message: `The saved notation could not be read: ${cause instanceof Error ? cause.message : 'invalid document'}`};
    }
  }

  // Legacy references have no notation: the score must be regenerated from performance,
  // and the caller labels that honestly rather than presenting it as authored work.
  if (!Array.isArray(value.events)) return {ok: false, message: 'The saved reference has neither notation nor events.'};
  try {
    const performance: PerformanceNote[] = value.events.filter(isRecord).map((event, index) => ({
      id: typeof event.id === 'string' ? event.id : `event-${index}`,
      onset: Number(event.onset), duration: event.duration === null ? null : Number(event.duration),
      pitch: Number(event.pitch), velocity: event.velocity === null ? null : Number(event.velocity),
      confidence: event.confidence === null ? null : Number(event.confidence),
      optional: Boolean(event.optional), string: null, fret: null,
      notation_duration: event.notation_duration === null || event.notation_duration === undefined ? null : Number(event.notation_duration),
    }));
    const document = buildNotation(performance, {duration: Number.isFinite(duration) ? duration : undefined});
    return {ok: true, value: {document, alignment, offsetSeconds, spans, source: 'performance', title: typeof value.title === 'string' ? value.title : null}};
  } catch (cause) {
    return {ok: false, message: `The saved performance could not be read: ${cause instanceof Error ? cause.message : 'invalid events'}`};
  }
}

import {secondsToTick} from '../../../../../packages/music-notation/index.ts';

export type InsertionPlacement =
  | { ok: true; performed: number; tick: number }
  | { ok: false; problem: string };

/**
 * Source (displayed) seconds → stored performance seconds → written tick through the
 * map in use. Explanation holds have no score time and are rejected rather than
 * inventing beats.
 */
export function insertionPlacement(
  alignment: Alignment | null, document: NotationDocument, sourceSeconds: number, offsetSeconds: number,
): InsertionPlacement {
  if (!alignment) return {ok: false, problem: 'The score is not ready for insertion.'};
  const performed = sourceSeconds - offsetSeconds;
  if (performed < -1e-9) return {ok: false, problem: 'A note cannot start before the video.'};
  if (performed > document.duration + 1e-9) return {ok: false, problem: 'A note cannot start after the clip ends.'};
  const passage = alignment.passages.find(item =>
    performed >= item.source_seconds[0] - 1e-9 && performed <= item.source_seconds[1] + 1e-9);
  if (passage && passage.kind === 'held') {
    return {ok: false, problem: 'This moment is a spoken explanation with no score time. Choose a playing passage.'};
  }
  // Written positions are sixteenth-note grid ticks; the recorded onset keeps its
  // exact seconds, so snapping the score position never moves the performance.
  const rawTick = secondsToTick(alignment, performed);
  const tick = Math.max(0, Math.round(rawTick / 120) * 120);
  return {ok: true, performed: Math.max(0, Math.min(document.duration, performed)), tick};
}
