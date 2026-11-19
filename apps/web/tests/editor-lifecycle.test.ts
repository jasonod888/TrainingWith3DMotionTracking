import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  AUTHORING_LABELS, INITIAL_AUTHORING, canPublish, publishLabel, reduceAuthoring, statusLabel,
} from '../src/editor/authoring-lifecycle';
import {blockReason, editorReadiness} from '../src/editor/editor-readiness';
import {assertEditorAdapter, type ActEditorAdapter} from '../src/editor/editor-adapter';
import {createEditorSession} from '../src/editor/editor-session';
import {applySavedRevision} from '../src/editor/revision-handoff';
import {
  clearLessonContextCache, lessonContextCacheSize, loadLessonContext,
} from '../src/app/lesson-context';
import {parseLessonDocument} from '../../../packages/lesson-schema/parse';

const bodyJson = JSON.parse(
  readFileSync(new URL('../../../packages/lesson-schema/fixture.json', import.meta.url), 'utf8'));

test('the happy path keeps processing, review and release as separate steps', () => {
  let snapshot = reduceAuthoring(INITIAL_AUTHORING, {type: 'select-source'});
  snapshot = reduceAuthoring(snapshot, {type: 'upload-started'});
  assert.equal(snapshot.state, 'uploading');
  snapshot = reduceAuthoring(snapshot, {type: 'processing-started'});
  assert.equal(snapshot.state, 'processing');

  snapshot = reduceAuthoring(snapshot, {type: 'processing-completed', revisionId: 'rev-1'});
  assert.equal(snapshot.state, 'needs-review');
  assert.equal(snapshot.reviewed, false, 'a finished job is not reviewed');
  assert.equal(snapshot.releasedRevisionId, null, 'a finished job is not published');
  assert.equal(canPublish(snapshot), false);

  snapshot = reduceAuthoring(snapshot, {type: 'edit-started'});
  assert.equal(snapshot.state, 'editing');
  assert.equal(snapshot.dirty, true);

  // Saving a private draft is still not a review.
  snapshot = reduceAuthoring(snapshot, {type: 'save-succeeded', revisionId: 'rev-1'});
  assert.equal(snapshot.state, 'needs-review');
  assert.equal(snapshot.reviewed, false);
  assert.equal(snapshot.dirty, false);

  snapshot = reduceAuthoring(snapshot, {type: 'review-completed', revisionId: 'rev-1'});
  assert.equal(snapshot.state, 'saved-private');
  assert.equal(snapshot.reviewed, true);
  assert.equal(canPublish(snapshot), true);

  snapshot = reduceAuthoring(snapshot, {type: 'ready-to-release'});
  assert.equal(snapshot.state, 'ready-to-release');

  snapshot = reduceAuthoring(snapshot, {type: 'release-published', revisionId: 'rev-1'});
  assert.equal(snapshot.releasedRevisionId, 'rev-1');
  assert.equal(canPublish(snapshot), false, 'the released revision is not publishable again');
});

test('processing failures and cancellations are explicit and do not touch saved work', () => {
  const processing = reduceAuthoring(
    reduceAuthoring(INITIAL_AUTHORING, {type: 'processing-started'}),
    {type: 'failed', message: 'worker lost'});
  assert.equal(processing.state, 'failed');
  assert.equal(processing.errorCode, 'processing_failed');
  assert.equal(statusLabel(processing), AUTHORING_LABELS.processingFailed);

  const cancelled = reduceAuthoring(
    reduceAuthoring(INITIAL_AUTHORING, {type: 'upload-started'}), {type: 'cancelled'});
  assert.equal(cancelled.state, 'cancelled');

  const saved = {...INITIAL_AUTHORING, state: 'saved-private' as const, revisionId: 'rev-1', reviewed: true};
  assert.deepEqual(
    reduceAuthoring(saved, {type: 'failed', message: 'late worker error'}), saved,
    'a saved private revision is not un-saved by an unrelated processing failure');
});

test('a dirty session reports unsaved changes and a conflict keeps the edits', () => {
  const session = createEditorSession();
  session.processingCompleted('rev-1');
  session.beginEdit();
  assert.equal(session.statusLabel(), AUTHORING_LABELS.unsaved);
  const conflicted = session.conflict('This lesson has a newer saved revision.');
  assert.equal(conflicted.errorCode, 'conflict');
  assert.equal(conflicted.dirty, true);
  assert.equal(conflicted.state, 'editing');
  assert.match(conflicted.error ?? '', /newer saved revision/);
  // Resolving with the latest base saves privately, not publicly.
  const resolved = session.saved('rev-2');
  assert.equal(resolved.dirty, false);
  assert.equal(resolved.state, 'needs-review');
});

test('readiness separates playback validity from optional assessment', () => {
  const unassessed = editorReadiness({
    playback: {valid: true},
    assessment: {support: 'unsupported', available: false, reasonCode: 'act_unsupported',
      explanation: 'This Act has no assessment adapter.'},
    reviewRequired: true,
  });
  assert.equal(unassessed.playbackValid, true);
  assert.equal(unassessed.reviewReady, true, 'a valid lesson may be unassessed');
  assert.equal(unassessed.assessmentReady, false);
  assert.equal(unassessed.unassessedReason, 'This Act has no assessment adapter.');
  assert.deepEqual(unassessed.blockers, []);

  const invalid = editorReadiness({
    playback: {valid: false, reason: 'This lesson has no valid playback.'},
    assessment: {support: 'supported', available: true, reasonCode: 'ok', explanation: 'Scoring ready.'},
    reviewRequired: true,
  });
  assert.equal(invalid.reviewReady, false);
  assert.equal(blockReason(invalid, 'practice'), 'This lesson has no valid playback.');
  assert.equal(invalid.assessmentReady, true, 'assessment readiness does not fix playback');
});

test('status and publish labels are shared across Acts', () => {
  assert.equal(statusLabel({...INITIAL_AUTHORING, state: 'needs-review'}), 'Review required');
  assert.equal(statusLabel({...INITIAL_AUTHORING, state: 'saved-private'}), 'Saved privately');
  assert.equal(statusLabel({...INITIAL_AUTHORING, state: 'saved-private', dirty: true}),
    'Unsaved changes');
  assert.equal(statusLabel({...INITIAL_AUTHORING, state: 'failed'}), 'Processing failed');
  assert.equal(statusLabel({...INITIAL_AUTHORING, state: 'cancelled'}), 'Cancelled');
  assert.equal(publishLabel(INITIAL_AUTHORING), 'Publish');
  assert.equal(publishLabel({...INITIAL_AUTHORING, releasedRevisionId: 'rev-1'}),
    'Update published version');
});

test('the adapter contract refuses an incomplete Act adapter', () => {
  assert.throws(() => assertEditorAdapter({actId: 'guitar'} as unknown as ActEditorAdapter<unknown>),
    /missing loadDraft/);
  const adapter: ActEditorAdapter<{value: number}> = {
    actId: 'piano',
    loadDraft: async () => ({value: 1}),
    readiness: () => editorReadiness({
      playback: {valid: true},
      assessment: {support: 'supported', available: true, reasonCode: 'ok', explanation: 'Ready.'},
      reviewRequired: true,
    }),
    isDirty: draft => draft.value > 1,
    save: async () => ({revisionId: 'rev-2'}),
    completeReview: async (_draft, revision) => revision,
  };
  assert.doesNotThrow(() => assertEditorAdapter(adapter));
});

test('a saved revision is handed back to the shell and invalidates its cached context', async () => {
  const parsed = parseLessonDocument(bodyJson);
  assert.ok(parsed.ok);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(bodyJson), {
    status: 200, headers: {'Content-Type': 'application/json'},
  })) as typeof fetch;
  try {
    clearLessonContextCache();
    await loadLessonContext('lesson-x', {audience: 'owner', accountScope: 'acct-1'});
    assert.ok(lessonContextCacheSize() > 0);

    const saved = applySavedRevision('lesson-x', 'rev-2');
    assert.deepEqual(saved, {lessonId: 'lesson-x', revisionId: 'rev-2'});
    assert.equal(lessonContextCacheSize(), 0, 'the shell must reload the lesson context');
  } finally {
    globalThis.fetch = original;
    clearLessonContextCache();
  }
});

test('a session can publish only a reviewed, saved revision', () => {
  const session = createEditorSession();
  session.processingCompleted('rev-1');
  session.beginEdit();
  session.saved('rev-1');
  assert.equal(session.canPublish(), false, 'private save is not a review');
  session.reviewed('rev-1');
  assert.equal(session.canPublish(), true);
  session.published('rev-1');
  assert.equal(session.canPublish(), false);
  assert.equal(session.publishActionLabel(), 'Update published version');
});
