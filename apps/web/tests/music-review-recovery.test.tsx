import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  {url: 'http://localhost/', pretendToBeVisual: true});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true});
const {renderHook, act, cleanup, waitFor} = await import('@testing-library/react');
const {useLayoutEffect} = await import('react');
const {buildNotation} = await import('../../../packages/music-notation/index.ts');
const {clearRecovery, peekRecovery, writeRecovery} = await import('../src/music/workspace/recovery.ts');
const {useMusicReviewRecovery, checkpointMatchesIdentity} = await import(
  '../src/music/workspace/useMusicReviewRecovery.ts');
type RecoveryOptions = Parameters<typeof useMusicReviewRecovery>[0];
type RecoveryRestore = Parameters<RecoveryOptions['onRestore']>[0];

const KEY = 'piano-workspace-recovery-v1';
const identity = {accountId: 'account-1', lessonId: 'lesson-1', draftId: 'draft-1',
  sourceSha256: 'a'.repeat(64)};
const identityB = {accountId: 'account-2', lessonId: 'lesson-2', draftId: 'draft-2',
  sourceSha256: 'b'.repeat(64)};

function score() {
  return buildNotation([
    {id: 'n1', onset: 0.5, duration: 0.4, pitch: 60, velocity: 0.5, confidence: null,
      optional: false, string: null, fret: null},
  ], {bpm: 120, duration: 2});
}

function options(overrides: Partial<RecoveryOptions> = {}): RecoveryOptions {
  return {
    identity, enabled: true, dirty: false, workspaceSignature: 'sig', document: score(),
    title: 'Local work', alignment: null, anchors: [], offsetSeconds: 0, spans: [],
    sectionsDraft: [], assessmentPolicy: 'notes' as const, feedbackEnabled: true,
    guitarChords: [], lastValidChords: [], verificationToken: '', acceptedBaselines: {},
    authoredSpellings: {current: {}}, savedRevisionId: null,
    onRestore: () => {},
    ...overrides,
  };
}

afterEach(() => { cleanup(); clearRecovery(); });

test('a matching checkpoint is offered, restored through the caller, and reported as local', async () => {
  writeRecovery({identity, title: 'Local work', notation: score(), alignment: null,
    offsetSeconds: 0, spans: []});
  const restores: RecoveryRestore[] = [];
  const {result, unmount} = renderHook(() => useMusicReviewRecovery(
    options({onRestore: value => restores.push(value)})));
  await waitFor(() => assert.ok(result.current.recoveryOffer));
  act(() => result.current.restoreCheckpoint());
  assert.equal(restores.length, 1);
  assert.equal(restores[0].stale, false);
  assert.equal(restores[0].checkpoint.title, 'Local work');
  assert.equal(result.current.recoveryOffer, null);
  assert.match(result.current.recoveryMessage, /not saved to the server/i);
  unmount();
});

test('discarding a recovery offer removes the device checkpoint', async () => {
  writeRecovery({identity, title: 'Local work', notation: score(), alignment: null,
    offsetSeconds: 0, spans: []});
  const {result, unmount} = renderHook(() => useMusicReviewRecovery(options()));
  await waitFor(() => assert.ok(result.current.recoveryOffer));
  act(() => result.current.discardCheckpoint());
  assert.equal(result.current.recoveryOffer, null);
  assert.equal(peekRecovery(), null);
  unmount();
});

test('a checkpoint from an older base is offered as stale and restored without moving the base', async () => {
  writeRecovery({identity: {...identity, baseRevisionId: 'old-base'}, title: 'Older local work',
    notation: score(), alignment: null, offsetSeconds: 0, spans: []});
  const restores: RecoveryRestore[] = [];
  const {result, unmount} = renderHook(() => useMusicReviewRecovery(options({
    identity: {...identity, baseRevisionId: 'new-base'}, savedRevisionId: 'new-base',
    onRestore: value => restores.push(value),
  })));
  await waitFor(() => assert.ok(result.current.staleCheckpoint));
  assert.match(result.current.recoveryNotice, /older saved revision/i);
  act(() => result.current.restoreStaleCheckpoint());
  assert.equal(restores.length, 1);
  assert.equal(restores[0].stale, true);
  assert.equal(restores[0].checkpoint.title, 'Older local work');
  assert.equal(result.current.staleCheckpoint, null);
  assert.match(result.current.recoveryMessage, /current base/i);
  unmount();
});

test('the hook owns delayed checkpoint writes and clearing them', async () => {
  const {result, unmount} = renderHook(() => useMusicReviewRecovery(options({dirty: true})));
  await waitFor(() => assert.ok(localStorage.getItem(KEY)), {timeout: 2000});
  const stored = JSON.parse(localStorage.getItem(KEY)!);
  assert.equal(stored.identity.lessonId, 'lesson-1');
  assert.equal(stored.title, 'Local work');
  act(() => result.current.clearCheckpoint());
  assert.equal(localStorage.getItem(KEY), null);
  assert.equal(result.current.recoveryOffer, null);
  unmount();
});

test('switching identity clears the previous offer and restore cannot cross lessons/accounts', async () => {
  writeRecovery({identity, title: 'Lesson A local work', notation: score(), alignment: null,
    offsetSeconds: 0, spans: []});
  const restores: RecoveryRestore[] = [];
  const {result, rerender, unmount} = renderHook(
    ({currentIdentity}: {currentIdentity: typeof identity}) => useMusicReviewRecovery(
      options({identity: currentIdentity, onRestore: value => restores.push(value)})),
    {initialProps: {currentIdentity: identity}},
  );
  await waitFor(() => assert.ok(result.current.recoveryOffer));
  const offerA = result.current.recoveryOffer!;
  assert.equal(checkpointMatchesIdentity(offerA, identity), true);

  // B has no checkpoint of its own; remove A's device checkpoint before switching.
  clearRecovery();
  rerender({currentIdentity: identityB});
  await waitFor(() => assert.equal(result.current.recoveryOffer, null));
  assert.equal(result.current.staleCheckpoint, null);
  assert.equal(result.current.recoveryNotice, '');
  assert.equal(result.current.recoveryMessage, '');

  act(() => {
    result.current.restoreCheckpoint();
    result.current.restoreStaleCheckpoint();
  });
  assert.equal(restores.length, 0,
    'lesson/account A work must never reach B through restore');
  assert.equal(checkpointMatchesIdentity(offerA, identityB), false,
    'the restore-time identity guard rejects the old checkpoint');
  unmount();
});

test('restore re-validates identity before the offer-clearing effect runs', async () => {
  writeRecovery({identity, title: 'Lesson A local work', notation: score(), alignment: null,
    offsetSeconds: 0, spans: []});
  const restores: RecoveryRestore[] = [];
  const {result, rerender, unmount} = renderHook(
    ({currentIdentity, trigger}: {currentIdentity: typeof identity; trigger: boolean}) => {
      const recovery = useMusicReviewRecovery(options({
        identity: currentIdentity, onRestore: value => restores.push(value),
      }));
      // Layout effects run before the passive identity-clear/read effect, reproducing
      // the race where a stale offer is still present during the new identity render.
      useLayoutEffect(() => {
        if (trigger) recovery.restoreCheckpoint();
      });
      return recovery;
    },
    {initialProps: {currentIdentity: identity, trigger: false}},
  );
  await waitFor(() => assert.ok(result.current.recoveryOffer));
  const offerA = result.current.recoveryOffer!;

  rerender({currentIdentity: identityB, trigger: true});
  assert.equal(restores.length, 0,
    'the new identity must reject the old checkpoint even before the effect clears it');
  assert.equal(checkpointMatchesIdentity(offerA, identityB), false);
  await waitFor(() => assert.equal(result.current.recoveryOffer, null));
  unmount();
});
