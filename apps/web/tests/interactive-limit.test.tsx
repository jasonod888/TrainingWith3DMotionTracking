import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildNotation, parseNotationDocument, type PerformanceNote} from '../../../packages/music-notation/index.ts';
import {
  INTERACTIVE_LIMIT_APPROVED, INTERACTIVE_OCCURRENCE_LIMIT, buildWorkspaceExport, guardMutation,
  resolveInteractionPolicy, serializeWorkspaceExport,
} from '../src/music/workspace/interactive-limit';

const note = (id: string, onset: number, pitch: number): PerformanceNote => ({
  id, onset, duration: 0.5, pitch, velocity: 0.6, confidence: null, optional: false, string: null, fret: null,
});
const document = buildNotation([note('a', 0, 60), note('b', 1, 64)], {bpm: 120, duration: 4});

test('interactive limit is inactive until approved', () => {
  assert.equal(INTERACTIVE_LIMIT_APPROVED, false);
  const policy = resolveInteractionPolicy(INTERACTIVE_OCCURRENCE_LIMIT + 1);
  assert.equal(policy.mode, 'editing');
  assert.equal(guardMutation(policy).allowed, true);
});

test('approved policy edits at the exact boundary and is read-only above it', () => {
  const boundary = resolveInteractionPolicy(INTERACTIVE_OCCURRENCE_LIMIT, true);
  assert.equal(boundary.mode, 'editing');
  assert.equal(guardMutation(boundary).allowed, true);
  const over = resolveInteractionPolicy(INTERACTIVE_OCCURRENCE_LIMIT + 1, true);
  assert.equal(over.mode, 'read-only');
  const guard = guardMutation(over);
  assert.equal(guard.allowed, false);
  if (!guard.allowed) {
    assert.equal(guard.code, 'interactive-limit-read-only');
    assert.match(guard.message, /read-only|limited|not applied/i);
  }
});

test('lossless export keeps the complete document and recovery payload', () => {
  const recovery = {identity: {lessonId: 'lesson-1'}, notation: document};
  const exported = buildWorkspaceExport({
    document, title: 'Boundary lesson', occurrenceCount: 2, editingMode: 'read-only',
    recovery, exportedAt: '2026-11-15T00:00:00.000Z',
  });
  const parsedJson = JSON.parse(serializeWorkspaceExport(exported));
  assert.equal(parsedJson.kind, 'piano-workspace-export-v1');
  assert.equal(parsedJson.occurrenceCount, 2);
  assert.equal(parsedJson.editingMode, 'read-only');
  assert.deepEqual(parsedJson.recovery, recovery);
  const roundTripped = parseNotationDocument(parsedJson.document);
  assert.deepEqual(roundTripped, document);
});

test('export rejects malformed counts and modes', () => {
  assert.throws(() => buildWorkspaceExport({document, title: 'x', occurrenceCount: -1, editingMode: 'editing'}));
  assert.throws(() => buildWorkspaceExport({
    document, title: 'x', occurrenceCount: 1, editingMode: 'mutate' as unknown as 'editing',
  }));
});
