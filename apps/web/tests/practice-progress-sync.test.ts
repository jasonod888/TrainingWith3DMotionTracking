import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {
  conservativeImport, createBodyPracticeStore, createLocalPracticeStore, createServerPracticeStore, importLocalProgress,
  clearPracticeStoreMemory,
  type PracticeIdentity, type PracticeRecord,
} from '../src/practice/practice-store';
import {
  buildAttemptEnvelope, validateAttemptEnvelope,
} from '../../../packages/learning-engine/attempt-envelope';

const identity: PracticeIdentity = {
  lessonId: 'lesson-1', revisionId: 'rev-1', planId: 'plan-a', duration: 60,
};

const record: PracticeRecord = {
  revisionId: 'rev-1', planId: 'plan-a', unitId: 'unit-2', time: 12.5, speed: 1,
  mode: 'sections', loop: false, repetitions: 2, countdownSeconds: 3, restSeconds: 2,
  updatedAt: 1_700_000_000_000,
};

type Call = {url: string; init?: RequestInit};
let calls: Call[] = [];
let restore: (() => void) | null = null;

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const original = globalThis.fetch;
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({url: String(input), init});
    return handler(String(input), init);
  }) as typeof fetch;
  restore = () => { globalThis.fetch = original; };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: {'Content-Type': 'application/json'},
  });
}

afterEach(() => {
  restore?.();
  restore = null;
  clearPracticeStoreMemory();
});

test('the server store loads progress for the exact account, revision and plan', async () => {
  mockFetch(() => json({
    lesson_id: 'lesson-1', revision_id: 'rev-1', plan_id: 'plan-a', unit_id: 'unit-2',
    time: 33, speed: 0.75, mode: 'sections', loop: true, repetitions: 1,
    countdown_seconds: 5, rest_seconds: 1.5, updated_at: '2026-11-19T10:00:00Z',
  }));
  const store = createServerPracticeStore({accountId: 'acct-1', local: createLocalPracticeStore()});
  const loaded = await store.load(identity);
  assert.ok(loaded);
  assert.equal(loaded.time, 33);
  assert.equal(loaded.unitId, 'unit-2');
  assert.match(calls[0].url, /lesson_id=lesson-1/);
  assert.match(calls[0].url, /revision_id=rev-1/);
  assert.match(calls[0].url, /plan_id=plan-a/);
});

test('an offline server falls back to the local record', async () => {
  const local = createLocalPracticeStore();
  await local.save(identity, record);
  mockFetch(() => json({detail: 'offline'}, 503));
  const store = createServerPracticeStore({accountId: 'acct-1', local});
  const loaded = await store.load(identity);
  assert.ok(loaded);
  assert.equal(loaded.time, record.time);
  assert.equal(loaded.repetitions, record.repetitions);
});

test('saving writes local first and syncs the same record to the server', async () => {
  mockFetch(() => json({}));
  const local = createLocalPracticeStore();
  const store = createServerPracticeStore({accountId: 'acct-1', local});
  await store.save(identity, record);
  assert.equal((await local.load(identity))?.time, record.time, 'local fallback is already written');
  const put = calls.find(call => call.init?.method === 'PUT');
  assert.ok(put, 'the record was synced');
  const body = JSON.parse(String(put.init?.body)) as Record<string, unknown>;
  assert.equal(body.lesson_id, 'lesson-1');
  assert.equal(body.revision_id, 'rev-1');
  assert.equal(body.plan_id, 'plan-a');
  assert.equal(body.time, record.time);
  assert.equal(body.countdown_seconds, 3);
});

test('a guest never calls the server and keeps isolated local progress', async () => {
  mockFetch(() => json({detail: 'should not be called'}, 500));
  const local = createLocalPracticeStore();
  const store = createServerPracticeStore({accountId: null, local});
  await store.save(identity, record);
  const loaded = await store.load(identity);
  assert.equal(loaded?.time, record.time);
  assert.equal(calls.length, 0, 'guest progress stays local');
});

test('local progress is scoped by account and never leaks between accounts', async () => {
  const alice = createLocalPracticeStore('alice');
  await alice.save(identity, {...record, time: 42});
  mockFetch(() => json({detail: 'not found'}, 404));
  const bob = createServerPracticeStore({accountId: 'bob', local: createLocalPracticeStore('bob')});
  assert.equal(await bob.load(identity), null, 'Bob must not inherit Alice\'s 42');
  await bob.save(identity, {...record, time: 3});
  assert.equal((await bob.load(identity))?.time, 3);
  assert.equal((await alice.load(identity))?.time, 42, 'Alice keeps her own record');
});

test('body practice is account-scoped and never reads the guest cache', async () => {
  mockFetch(() => json({detail: 'not found'}, 404));
  const lesson = {revision_id: 'rev-1'} as never;
  const alice = createBodyPracticeStore(lesson, 'alice');
  await alice.save(identity, {...record, time: 42});
  const bob = createBodyPracticeStore(lesson, 'bob');
  assert.equal(await bob.load(identity), null, 'Bob must not receive Alice\'s 42s');
  const guest = createBodyPracticeStore(lesson, null);
  assert.equal(await guest.load(identity), null);
  await bob.save(identity, {...record, time: 3});
  assert.equal((await bob.load(identity))?.time, 3);
  assert.equal((await alice.load(identity))?.time, 42);
});

test('local import never overwrites newer server progress', async () => {
  const localRecord: PracticeRecord = {...record, time: 10, updatedAt: 1000};
  const importInput = {
    accountId: 'acct-1', localAccountId: 'acct-1', localRecord,
    targetLessonId: 'lesson-1', targetRevisionId: 'rev-1', targetPlanId: 'plan-a',
  };
  mockFetch(() => json({
    lesson_id: 'lesson-1', revision_id: 'rev-1', plan_id: 'plan-a', unit_id: null,
    time: 50, speed: 1, mode: 'sections', loop: false, repetitions: 0,
    countdown_seconds: 3, rest_seconds: 2, updated_at: new Date(2000).toISOString(),
  }));
  const decision = await importLocalProgress(importInput);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'server_newer');
  assert.equal(calls.filter(call => call.init?.method === 'PUT').length, 0);

  mockFetch((_url, init) => init?.method === 'PUT'
    ? json({})
    : json({detail: 'not found'}, 404));
  const empty = await importLocalProgress(importInput);
  assert.equal(empty.allowed, true);
  assert.equal(calls.filter(call => call.init?.method === 'PUT').length, 1);
});

test('conservative import refuses guests, other accounts and other revisions', () => {
  assert.deepEqual(conservativeImport({
    accountId: null, localAccountId: 'acct-1', localRecord: record,
    targetRevisionId: 'rev-1', targetPlanId: 'plan-a',
  }), {allowed: false, reason: 'guest'});

  assert.deepEqual(conservativeImport({
    accountId: 'acct-1', localAccountId: 'acct-2', localRecord: record,
    targetRevisionId: 'rev-1', targetPlanId: 'plan-a',
  }), {allowed: false, reason: 'cross_account'});

  assert.deepEqual(conservativeImport({
    accountId: 'acct-1', localAccountId: 'acct-1',
    localRecord: {...record, revisionId: 'rev-0'},
    targetRevisionId: 'rev-1', targetPlanId: 'plan-a',
  }), {allowed: false, reason: 'revision_mismatch'});

  assert.deepEqual(conservativeImport({
    accountId: 'acct-1', localAccountId: 'acct-1', localRecord: null,
    targetRevisionId: 'rev-1', targetPlanId: 'plan-a',
  }), {allowed: false, reason: 'no_record'});
});

test('a matching local record imports and is re-scoped to the target plan', async () => {
  const decision = conservativeImport({
    accountId: 'acct-1', localAccountId: 'acct-1', localRecord: record,
    targetRevisionId: 'rev-1', targetPlanId: 'plan-b',
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.record?.planId, 'plan-b');
  assert.equal(decision.record?.revisionId, 'rev-1');

  mockFetch((_url, init) => init?.method === 'PUT'
    ? json({})
    : json({detail: 'not found'}, 404));
  const imported = await importLocalProgress({
    accountId: 'acct-1', localAccountId: 'acct-1', localRecord: record,
    targetLessonId: 'lesson-1', targetRevisionId: 'rev-1', targetPlanId: 'plan-b',
  });
  assert.equal(imported.allowed, true);
  const put = calls.find(call => call.init?.method === 'PUT');
  assert.ok(put);
  assert.equal((JSON.parse(String(put.init?.body)) as Record<string, unknown>).plan_id, 'plan-b');
});

test('a guest import makes no request at all', async () => {
  mockFetch(() => json({}));
  const decision = await importLocalProgress({
    accountId: null, localAccountId: 'acct-1', localRecord: record,
    targetLessonId: 'lesson-1', targetRevisionId: 'rev-1', targetPlanId: 'plan-a',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'guest');
  assert.equal(calls.length, 0);
});

test('the neutral attempt envelope preserves unassessed and insufficient states', () => {
  const unassessed = buildAttemptEnvelope({
    attemptId: 'attempt-1', lessonId: 'lesson-1', revisionId: 'rev-1', actId: 'full_body',
    mode: 'challenge', planId: 'plan-a', durationMs: 42_000, status: 'unassessed',
    assessmentAdapter: 'pose-v1', rubricVersion: 'pose-v1',
  });
  assert.equal(unassessed.status, 'unassessed');
  assert.equal(unassessed.assessmentAdapter, null, 'an unassessed attempt claims no adapter');
  assert.equal(unassessed.rubricVersion, null);
  assert.deepEqual(validateAttemptEnvelope(unassessed).ok, true);

  const insufficient = buildAttemptEnvelope({
    attemptId: 'attempt-2', lessonId: 'lesson-1', revisionId: 'rev-1', actId: 'piano',
    mode: 'practice', planId: 'plan-a', durationMs: 8_000, status: 'insufficient_evidence',
    assessmentAdapter: 'piano-midi-v1', rubricVersion: 'piano-midi-v1',
  });
  assert.equal(insufficient.status, 'insufficient_evidence');
  assert.deepEqual(validateAttemptEnvelope(insufficient).ok, true);

  const missingAdapter = validateAttemptEnvelope({
    ...unassessed, status: 'completed',
  });
  assert.equal(missingAdapter.ok, false);

  const withScore = validateAttemptEnvelope({...insufficient, score: 87});
  assert.equal(withScore.ok, false, 'a top-level cross-Act score is refused');
});
