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

export type SavedAlignment = {
  alignment_version: 1;
  mode: 'estimated' | 'anchored';
  basis: 'tempo' | 'passages';
  offset_seconds: number;
  anchors: AnchorPointSaved[];
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

export function serializeAlignment(
  alignment: Alignment | null, anchors: AnchorPointSaved[], offsetSeconds: number,
): SavedAlignment | null {
  if (!alignment) return null;
  return {
    alignment_version: 1,
    mode: anchors.length ? 'anchored' : alignment.mode,
    basis: alignment.basis,
    offset_seconds: offsetSeconds,
    anchors: anchors.map(anchor => ({seconds: anchor.seconds, tick: anchor.tick})),
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
}) {
  const duration = input.document.duration;
  return {
    ...(input.baseRevisionId ? {base_revision_id: input.baseRevisionId} : {}),
    title: input.title || 'Piano correction',
    events: performanceOf(input.document),
    spans: input.spans,
    sections: [{id: 'whole', label: 'Whole lesson', start: 0, end: duration}],
    assessment: {assessment: 'none', input_modes: ['none'], dimensions: [], rubric_version: 'music-watch-v1'},
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
  return {alignment_version: 1, mode, basis, offset_seconds: offset, anchors};
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
  const offsetSeconds = alignment?.offset_seconds ?? (Number.isFinite(value.offset_seconds) ? Number(value.offset_seconds) : 0);

  if (value.notation !== undefined && value.notation !== null) {
    try {
      const document = parseNotationDocument(value.notation);
      if (Number.isFinite(duration) && Math.abs(document.duration - duration) > 1e-6) {
        return {ok: false, message: 'The saved notation duration does not match its reference.'};
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
