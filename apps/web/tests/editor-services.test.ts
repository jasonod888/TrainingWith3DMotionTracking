import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../src/api';
import {classifySaveError, privateSaveMessage, reviewPath,
  saveReviewedReference, startReviewLoad} from '../src/music/workspace/editor-services';

const original = globalThis.fetch;
const calls: {url: string; method: string; body?: string; headers: Record<string, string>}[] = [];
afterEach(() => { globalThis.fetch = original; calls.length = 0; });

function mock() {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({url: String(input), method: init?.method ?? 'GET',
      body: init?.body ? String(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>});
    return new Response(JSON.stringify({revision_id: 'r1'}), {status: 200});
  }) as typeof fetch;
}

test('review loading and saving use the lesson-scoped endpoints', async () => {
  mock();
  const sources = startReviewLoad('lesson 1');
  await Promise.all([sources.draft, sources.manifest]);
  assert.deepEqual(calls.map(call => call.url), [
    '/api/lessons/lesson%201/music-draft', '/api/lessons/lesson%201']);
  assert.equal(calls[1].headers['X-Lesson-Formats'], '1,2');

  calls.length = 0;
  await saveReviewedReference('lesson 1', null, {draft_id: 'd1'});
  await saveReviewedReference('lesson 1', 'r0', {draft_id: 'd1'});
  assert.equal(reviewPath('lesson 1', null), '/lessons/lesson%201/music-draft/review');
  assert.equal(reviewPath('lesson 1', 'r0'), '/lessons/lesson%201/music-revision');
  assert.deepEqual(calls.map(call => call.url), [
    '/api/lessons/lesson%201/music-draft/review',
    '/api/lessons/lesson%201/music-revision',
  ]);
  assert.equal(JSON.parse(calls[1].body ?? '{}').base_revision_id, 'r0');
});

test('409 keeps the exact conflict message and save messages stay private', () => {
  const base = 'This lesson has a newer saved revision. Reload it or save on the latest revision.';
  const conflict = classifySaveError(new ApiError('conflict detail', 409));
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.kind, 'stale');
  assert.ok(conflict.message.startsWith(base), 'stale recovery copy stays first');
  assert.match(conflict.message, /conflict detail/, 'server detail is preserved');

  const plain = classifySaveError(new ApiError('', 409));
  assert.equal(plain.conflict, true);
  assert.equal(plain.kind, 'stale');
  assert.equal(plain.message, base);
  assert.match(privateSaveMessage('abcdef123456', true), /Saved privately/);
  assert.match(privateSaveMessage('abcdef123456', false), /newer edits are still unsaved/);
});
