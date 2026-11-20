/** Focused behavior evidence for the music verification/correction coordinator. */
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {
  applyCommand, buildNotation, type NotationDocument,
} from '../../../packages/music-notation/index.ts';
import type {VerificationFinding} from '../src/music/verification.ts';
import {prepareFinding} from '../src/music/workspace/verification-transaction.ts';
import {classifySaveError} from '../src/music/workspace/editor-services.ts';
import {ApiError} from '../src/api.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  {url: 'http://localhost/', pretendToBeVisual: true});
const {window} = dom;
Object.assign(globalThis, {
  window: window as unknown as Window & typeof globalThis,
  document: window.document,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', {value: window.navigator, configurable: true});

const {renderHook, act, cleanup, waitFor} = await import('@testing-library/react');
const {useMusicVerificationController} = await import('../src/music/workspace/useMusicVerificationController.ts');

afterEach(cleanup);

const performanceNote = (id: string, onset: number, pitch: number) => ({
  id, onset, duration: 0.4, pitch, velocity: 0.7, confidence: null,
  optional: false, string: null, fret: null,
});

function score(): NotationDocument {
  return buildNotation([performanceNote('e1', 0.7, 60)], {bpm: 120, duration: 12});
}

const finding: VerificationFinding = {
  id: 'vf-1', kind: 'onset_shift', status: 'suggested', time_range: [0.5, 0.9],
  event_ids: ['e1'], pitch: 60, explanation: 'This note may start slightly later.',
  evidence: {gain: 0.4}, alternatives: [],
  proposed_edits: [{op: 'set_onset', event_ids: ['e1'], before: {onset: 0.7}, after: {onset: 0.5}}],
  ambiguous: false, ambiguity_reasons: [],
};

function verificationState(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1, available: true, draft_id: 'draft-1', lesson_id: 'lesson-1',
    proposal_sha256: 'a'.repeat(64), report_proposal_sha256: 'a'.repeat(64),
    report_sha256: 'd'.repeat(64), stale: false, report_error: null, invalid_working: null,
    state_token: 'c'.repeat(64), decisions: [], conflicts: [],
    events: [performanceNote('e1', 0.7, 60)],
    report: {
      schema_version: 1, verifier_version: 'piano-verifier-1', mode: 'diagnostic', status: 'complete',
      source: {proposal_sha256: 'a'.repeat(64), audio_sha256: 'b'.repeat(64)},
      findings: [finding], summary: {finding_count: 1},
    },
    ...overrides,
  };
}

function decisionState(decision: 'accepted' | 'rejected', token = 'e'.repeat(64), events = [performanceNote('e1', 0.7, 60)]) {
  return verificationState({
    state_token: token, events,
    decisions: [{finding_id: finding.id, decision, decided_at: '2026-11-19T10:00:00Z',
      report_sha256: 'd'.repeat(64), edits: finding.proposed_edits,
      finding: {kind: finding.kind, pitch: finding.pitch, time_range: finding.time_range,
        explanation: finding.explanation}}],
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
}

let requests: {url: string; method: string; body: any}[] = [];
let currentState: ReturnType<typeof verificationState>;
let decisionResponse: ReturnType<typeof verificationState> | null = null;
let decisionStatus = 200;
let decisionDetail = '';
let decisionGate: {promise: Promise<void>; resolve: () => void} | null = null;

function installFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.includes('/music-analysis/verification')) return json(currentState);
    if (url.includes('/music-draft/verification-decision')) {
      requests.push({url, method, body});
      if (decisionGate) await decisionGate.promise;
      if (decisionStatus !== 200) return json({detail: decisionDetail}, decisionStatus);
      return json(decisionResponse ?? currentState);
    }
    if (url.includes('/music-draft/corrections/rollback')) {
      requests.push({url, method, body});
      return json({rolled_back: true, draft_id: 'draft-1'});
    }
    return json({detail: 'not found'}, 404);
  }) as typeof fetch;
}

function resetFetch(): void {
  requests = [];
  currentState = verificationState();
  decisionResponse = null;
  decisionStatus = 200;
  decisionDetail = '';
  decisionGate = null;
  installFetch();
}

function gate(): {promise: Promise<void>; resolve: () => void} {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise, resolve: release};
}

test('loads findings and applies an accepted decision with exact server identity', async () => {
  resetFetch();
  decisionResponse = decisionState('accepted');
  const dispatches: any[] = [];
  const live = score();
  const {result} = renderHook(() => useMusicVerificationController({
    lessonId: 'lesson-1', draftId: 'draft-1', document: live, alignment: null,
    dispatch: action => dispatches.push(action),
  }));
  await waitFor(() => assert.ok(result.current.verification));
  assert.equal(result.current.token, 'c'.repeat(64));
  assert.equal(result.current.verification?.report?.findings[0].kind, 'onset_shift');

  await act(async () => { await result.current.decide(finding, 'accepted'); });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].body.draft_id, 'draft-1');
  assert.equal(requests[0].body.base_proposal_sha256, 'a'.repeat(64));
  assert.equal(requests[0].body.base_state_token, 'c'.repeat(64));
  assert.equal(requests[0].body.base_report_sha256, 'd'.repeat(64));
  assert.equal(requests[0].body.finding_id, 'vf-1');
  assert.equal(requests[0].body.decision, 'accepted');

  assert.equal(result.current.token, 'e'.repeat(64));
  assert.ok(result.current.acceptedBaselines['vf-1']);
  const commands = dispatches.find(action => action.type === 'commands');
  assert.ok(commands, 'an accepted suggestion must dispatch one command transaction');
  assert.equal(commands.commands[0].type, 'set-occurrence-onset');
  assert.equal(commands.commands[0].seconds, 0.5);
  assert.equal(commands.base.performance[0].onset, 0.7);
});

test('rejecting a previously accepted finding applies the guarded inverse', async () => {
  resetFetch();
  const prepared = prepareFinding(score(), finding, null);
  assert.equal(prepared.status, 'applied');
  if (prepared.status !== 'applied') return;
  const acceptedDocument = prepared.document;
  currentState = decisionState('accepted', 'c'.repeat(64),
    [performanceNote('e1', 0.5, 60)]);
  decisionResponse = decisionState('rejected', 'e'.repeat(64),
    [performanceNote('e1', 0.7, 60)]);
  const dispatches: any[] = [];
  const {result} = renderHook(() => useMusicVerificationController({
    lessonId: 'lesson-1', draftId: 'draft-1', document: acceptedDocument, alignment: null,
    dispatch: action => dispatches.push(action),
  }));
  await waitFor(() => assert.ok(result.current.verification));
  act(() => result.current.hydrate({
    acceptedBaselines: {[finding.id]: prepared.baseline},
  }));

  await act(async () => { await result.current.decide(finding, 'rejected'); });

  const commands = dispatches.find(action => action.type === 'commands');
  assert.ok(commands, 'rejecting an accepted finding must dispatch its inverse');
  assert.equal(commands.commands[0].type, 'set-occurrence-onset');
  assert.equal(commands.commands[0].seconds, 0.7);
  assert.equal(result.current.acceptedBaselines['vf-1'], undefined);
});

test('a late decision cannot apply after a reset', async () => {
  resetFetch();
  decisionGate = gate();
  decisionResponse = decisionState('accepted');
  const dispatches: any[] = [];
  const live = score();
  const {result} = renderHook(() => useMusicVerificationController({
    lessonId: 'lesson-1', draftId: 'draft-1', document: live, alignment: null,
    dispatch: action => dispatches.push(action),
  }));
  await waitFor(() => assert.ok(result.current.verification));

  let pending!: Promise<boolean>;
  act(() => { pending = result.current.decide(finding, 'accepted'); });
  act(() => result.current.reset());
  decisionGate.resolve();
  await act(async () => { await pending; });

  assert.equal(dispatches.length, 0, 'a reset invalidates the in-flight decision');
  assert.equal(result.current.verification, null);
  assert.equal(result.current.token, '');
});

test('a local edit cancels a pending decision and keeps the working document', async () => {
  resetFetch();
  decisionGate = gate();
  decisionResponse = decisionState('accepted');
  const base = score();
  const dispatches: any[] = [];
  const {result, rerender} = renderHook(({live}: {live: NotationDocument}) => useMusicVerificationController({
    lessonId: 'lesson-1', draftId: 'draft-1', document: live, alignment: null,
    dispatch: action => dispatches.push(action),
  }), {initialProps: {live: base}});
  await waitFor(() => assert.ok(result.current.verification));

  let pending!: Promise<boolean>;
  act(() => { pending = result.current.decide(finding, 'accepted'); });
  const changed = applyCommand(base, {type: 'set-occurrence-pitch', occurrenceId: 'e1', pitch: 63});
  assert.equal(changed.status, 'applied');
  rerender({live: changed.status === 'applied' ? changed.document : base});
  decisionGate.resolve();
  await act(async () => { await pending; });

  assert.equal(dispatches.length, 0, 'the stale prepared transaction never replaces the edit');
  assert.match(result.current.notice, /cancelled/i);
});

test('a failed decision keeps the local document and surfaces the verification conflict', async () => {
  resetFetch();
  decisionStatus = 409;
  decisionDetail = 'The verification state changed for this proposal. Reload the diagnostics.';
  const dispatches: any[] = [];
  const live = score();
  const {result} = renderHook(() => useMusicVerificationController({
    lessonId: 'lesson-1', draftId: 'draft-1', document: live, alignment: null,
    dispatch: action => dispatches.push(action),
  }));
  await waitFor(() => assert.ok(result.current.verification));

  await act(async () => { await result.current.decide(finding, 'accepted'); });

  assert.equal(dispatches.length, 0);
  assert.match(result.current.notice, /verification state changed/i);
  assert.match(result.current.conflict, /verification state changed/i);
  assert.doesNotMatch(result.current.conflict, /newer saved revision/i);
});

test('rollback uses the current token and reloads the server state', async () => {
  resetFetch();
  currentState = verificationState({
    automatic_corrections: [{finding_id: finding.id, kind: finding.kind,
      applied_at: '2026-11-19T10:00:00Z', edits: [], reverted_at: null}],
  });
  const live = score();
  const {result} = renderHook(() => useMusicVerificationController({
    lessonId: 'lesson-1', draftId: 'draft-1', document: live, alignment: null,
    dispatch: () => {},
  }));
  await waitFor(() => assert.ok(result.current.verification));

  await act(async () => { await result.current.rollback(); });

  const rollback = requests.find(request => request.url.includes('/corrections/rollback'));
  assert.ok(rollback, 'rollback must call the existing corrections endpoint');
  assert.equal(rollback.body.draft_id, 'draft-1');
  assert.equal(rollback.body.base_state_token, 'c'.repeat(64));
  assert.ok(result.current.verification, 'rollback reloads verification state');
});

test('a verification 409 is classified as verification, not a stale revision', () => {
  const verification = classifySaveError(new ApiError(
    'The verification state changed for this proposal.', 409));
  assert.equal(verification.conflict, true);
  assert.equal(verification.kind, 'verification');
  assert.match(verification.message, /verification state changed/i);
  const stale = classifySaveError(new ApiError('This revision was already edited.', 409));
  assert.equal(stale.kind, 'stale');
  assert.match(stale.message, /newer saved revision/i);
});
