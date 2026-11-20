/** Pure review identity and immutable save-snapshot boundaries. */
import type {Alignment} from '../../../../../packages/music-notation/index.ts';
import type {WorkspaceState} from './workspace-state';
import {historyIdentity} from './workspace-state';
import {
  buildSaveBody, canonicalAnchors, serializeAlignment,
  type AnchorPointSaved, type SavedGuitarChord, type SavedSpan,
} from './save-payload';
import {sanitizeGuitarChords} from './recovery';

export type ReviewSidecars = {
  title: string;
  sections: {id: string; label: string; start: number; end: number}[];
  alignment: Alignment | null;
  anchors: AnchorPointSaved[];
  offsetSeconds: number;
  spans: SavedSpan[];
  pedal: unknown[];
  assessmentPolicy: string;
  feedbackEnabled: boolean;
  guitarChords: SavedGuitarChord[];
};

export function buildReviewSignature({documentEpoch, state, sidecars}: {
  documentEpoch: number;
  state: WorkspaceState | null;
  sidecars: ReviewSidecars;
}): string {
  if (!state) return '';
  return `${documentEpoch}:${historyIdentity(state)}:${JSON.stringify({
    alignment: serializeAlignment(sidecars.alignment, sidecars.anchors, sidecars.offsetSeconds),
    anchors: sidecars.anchors, offsetSeconds: sidecars.offsetSeconds, spans: sidecars.spans,
    title: sidecars.title, sections: sidecars.sections, pedal: sidecars.pedal,
    assessmentPolicy: sidecars.assessmentPolicy, feedbackEnabled: sidecars.feedbackEnabled,
    guitarChords: sidecars.guitarChords,
  })}`;
}

export function isReviewDirty({signature, savedSignature, serverSignature,
  stateDirty, chordsDirty}: {
  signature: string; savedSignature: string | null; serverSignature: string | null;
  stateDirty: boolean; chordsDirty: boolean;
}): boolean {
  return (savedSignature !== null
    ? signature !== savedSignature
    : signature !== (serverSignature ?? '') || stateDirty) || chordsDirty;
}

export type ReviewSaveSnapshot = {
  signature: string;
  body: ReturnType<typeof buildSaveBody>;
  validatedChords: SavedGuitarChord[];
};

export function captureReviewSaveSnapshot(input: {
  sidecars: ReviewSidecars;
  document: WorkspaceState['document'];
  documentEpoch: number;
  state: WorkspaceState;
  baseRevisionId: string | null;
  draftId: string;
  referenceSha256: string;
  verificationStateToken: string | null;
  savedSections?: {id: string; label: string; start: number; end: number}[] | null;
  assessment?: unknown;
}): {ok: true; snapshot: ReviewSaveSnapshot} | {ok: false; message: string} {
  const {sidecars} = input;
  const validated = input.document.subject === 'guitar'
    ? sanitizeGuitarChords(sidecars.guitarChords) : [];
  if (validated === null) {
    return {ok: false, message: 'Guitar chord shapes are invalid or exceed the 100-shape limit. '
      + 'Fix or remove invalid shapes before saving.'};
  }
  const copy = structuredClone(input.document);
  const alignment = sidecars.alignment ? structuredClone(sidecars.alignment) : null;
  const anchors = canonicalAnchors(structuredClone(sidecars.anchors));
  const signature = buildReviewSignature({documentEpoch: input.documentEpoch,
    state: input.state, sidecars});
  const body = buildSaveBody({
    title: sidecars.title, document: copy, spans: structuredClone(sidecars.spans),
    alignment, anchors, offsetSeconds: sidecars.offsetSeconds,
    baseRevisionId: input.baseRevisionId, draftId: input.draftId,
    referenceSha256: input.referenceSha256,
    verificationStateToken: input.verificationStateToken,
    sections: sidecars.sections.length ? structuredClone(sidecars.sections)
      : (input.savedSections ?? undefined),
    guitarChords: validated,
    assessment: input.assessment ?? (sidecars.assessmentPolicy === 'none'
      ? {assessment: 'none', input_modes: []} : {assessment: 'notes'}),
    feedbackEnabled: sidecars.feedbackEnabled,
  });
  return {ok: true, snapshot: {signature, body, validatedChords: validated}};
}
