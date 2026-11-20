import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildNotation} from '../../../packages/music-notation/index.ts';
import {createWorkspaceState, workspaceReducer} from '../src/music/workspace/workspace-state.ts';
import {buildReviewSignature, captureReviewSaveSnapshot, isReviewDirty,
  type ReviewSidecars} from '../src/music/workspace/review-selectors.ts';

const notation = (subject: 'piano' | 'guitar' = 'piano') => buildNotation([{
  id: 'e1', onset: 0, duration: 1, pitch: 60, velocity: .8, confidence: 1,
  optional: false, string: subject === 'guitar' ? 1 : null,
  fret: subject === 'guitar' ? 0 : null, notation_duration: null,
}], {bpm: 120, duration: 1, subject});

const sidecars = (): ReviewSidecars => ({
  title: 'Piece', sections: [{id: 'whole', label: 'Whole', start: 0, end: 1}],
  alignment: null, anchors: [], offsetSeconds: 0, spans: [{start: 0, end: 1, kind: 'playing'}],
  pedal: [], assessmentPolicy: 'notes', feedbackEnabled: true, guitarChords: [],
});

test('sidecar-only edits and undo-to-baseline drive the same dirty identity', () => {
  const document = notation();
  let state = createWorkspaceState(document);
  const base = buildReviewSignature({documentEpoch: 0, state, sidecars: sidecars()});
  const saved = {signature: base, savedSignature: base, serverSignature: base,
    stateDirty: false, chordsDirty: false};
  assert.equal(isReviewDirty(saved), false);
  const retitled = buildReviewSignature({documentEpoch: 0, state,
    sidecars: {...sidecars(), title: 'Renamed'}});
  assert.notEqual(retitled, base);
  assert.equal(isReviewDirty({...saved, signature: retitled}), true);

  state = workspaceReducer(state, {type: 'command',
    command: {type: 'set-occurrence-pitch', occurrenceId: document.performance[0].id, pitch: 62}});
  const edited = buildReviewSignature({documentEpoch: 0, state, sidecars: sidecars()});
  assert.notEqual(edited, base);
  state = workspaceReducer(state, {type: 'undo'});
  assert.equal(buildReviewSignature({documentEpoch: 0, state, sidecars: sidecars()}), base);
});

test('captured save snapshot is immutable after later edits', () => {
  const document = notation();
  const state = createWorkspaceState(document);
  const captured = captureReviewSaveSnapshot({sidecars: sidecars(), document, documentEpoch: 0,
    state, baseRevisionId: null, draftId: 'd1', referenceSha256: 'a'.repeat(64),
    verificationStateToken: 'tok'});
  assert.ok(captured.ok);
  const before = JSON.stringify(captured.snapshot.body);
  document.performance[0].pitch = 72;
  sidecars().title = 'mutated';
  assert.equal(JSON.stringify(captured.snapshot.body), before);
  assert.equal(captured.snapshot.signature,
    buildReviewSignature({documentEpoch: 0, state, sidecars: sidecars()}));
});

test('guitar save snapshots retain guitar fields while piano omits them', () => {
  const piano = notation('piano');
  const pianoCaptured = captureReviewSaveSnapshot({sidecars: sidecars(), document: piano,
    documentEpoch: 0, state: createWorkspaceState(piano), baseRevisionId: null,
    draftId: 'd', referenceSha256: '', verificationStateToken: null});
  assert.ok(pianoCaptured.ok);
  assert.equal('guitar_chords' in pianoCaptured.snapshot.body, false);

  const guitar = notation('guitar');
  const chords = [{id: 'c1', name: 'C', start: 0, frets: [0, 1, 0, 2, 3, 0], position: 1}];
  const guitarCaptured = captureReviewSaveSnapshot({sidecars: {...sidecars(), guitarChords: chords},
    document: guitar, documentEpoch: 0, state: createWorkspaceState(guitar),
    baseRevisionId: null, draftId: 'd', referenceSha256: '', verificationStateToken: null});
  assert.ok(guitarCaptured.ok);
  assert.deepEqual(guitarCaptured.snapshot.body.guitar_chords, chords);
  assert.equal(guitarCaptured.snapshot.body.subject, 'guitar');
});
