import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html>', {url: 'http://localhost/'});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, localStorage: dom.window.localStorage});
const {submitAttempt} = await import('../src/practice/submit-attempt.ts');
const {loadLocalAttempts, clearPracticeStoreMemory} = await import('../src/practice/practice-store.ts');

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; dom.window.localStorage.clear();
  clearPracticeStoreMemory(); });

test('assessed attempts serialize their neutral wire payload', async () => {
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response('{}', {status: 200, headers: {'Content-Type': 'application/json'}});
  }) as typeof fetch;
  const result = await submitAttempt({attemptId: 'a1', lessonId: 'l1', revisionId: 'r1',
    actId: 'full_body', mode: 'challenge', planId: 'p1', unitId: 'u1', durationMs: 1000,
    status: 'completed', assessmentAdapter: 'pose-v1', rubricVersion: 'pose-v1',
    report: {scored: true}, accountScope: 'acct'});
  assert.equal(result.ok, true);
  assert.equal(body?.attempt_id, 'a1');
  assert.equal(body?.status, 'completed');
  assert.equal(body?.assessment_adapter, 'pose-v1');
  assert.deepEqual(body?.report, {scored: true});
});

test('unassessed and insufficient evidence stay truthful', async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response('{}', {status: 200});
  }) as typeof fetch;
  await submitAttempt({attemptId: 'a2', lessonId: 'l2', revisionId: 'r2', actId: 'drawing',
    mode: 'practice', planId: 'p2', durationMs: 0, status: 'unassessed',
    report: {stepsSeen: 3}, accountScope: 'acct'});
  await submitAttempt({attemptId: 'a3', lessonId: 'l3', revisionId: 'r3', actId: 'piano',
    mode: 'practice', planId: 'p3', durationMs: 10, status: 'insufficient_evidence',
    report: {reason: 'clip too short'}, accountScope: 'acct'});
  assert.equal(bodies[0].status, 'unassessed');
  assert.equal(bodies[0].assessment_adapter, null);
  assert.equal(bodies[1].status, 'insufficient_evidence');
});

test('403 triggers the guard and keeps an account-scoped local fallback', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({detail: 'revoked'}),
    {status: 403, headers: {'Content-Type': 'application/json'}})) as typeof fetch;
  let handled: unknown = null;
  const result = await submitAttempt({attemptId: 'a4', lessonId: 'l4', revisionId: 'r4',
    actId: 'piano', mode: 'practice', planId: 'p4', durationMs: 10, status: 'unassessed',
    report: {}, accountScope: 'acct'},
    {guard: {handleError: async cause => { handled = cause; }} as never});
  assert.equal(result.ok, false);
  assert.ok(handled);
  assert.equal(loadLocalAttempts('acct').some(value => value.attemptId === 'a4'), true);
  assert.equal(loadLocalAttempts('other').some(value => value.attemptId === 'a4'), false);
});
