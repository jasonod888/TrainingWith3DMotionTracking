/**
 * Phase 5 acceptance evidence at the actual workspace level: edit → confirm → save →
 * reopen, failed-save retention, conflict resolution and honest local recovery.
 */
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/workspace-harness.html?id=lesson-1', pretendToBeVisual: true,
});
const {window} = dom;
Object.assign(globalThis, {
  window: window as unknown as Window & typeof globalThis,
  document: window.document,
  location: window.location,
  localStorage: window.localStorage,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
});
Object.defineProperty(globalThis, 'navigator', {value: window.navigator, configurable: true});
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 600; }, configurable: true});

const fixture = JSON.parse(readFileSync(
  resolve('..', '..', 'docs', 'qualification', 'piano-workspace-phase-01', 'fixtures', 'phase1-draft-fixture.json'), 'utf8'));
const draft = {...fixture,
  draft_id: 'draft-1', lesson_id: 'lesson-1', title: 'Save fixture', status: 'draft',
  reference: {...fixture.reference, sha256: 'b'.repeat(64)},
  source_video: {key: 'lessons/lesson-1/video.mp4', mime: 'video/mp4', bytes: 3, sha256: 'c'.repeat(64)}};

let posts: {url: string; body: any}[] = [];
let saveStatus = 200;
let latestReference: any = null;
let lessonGets = 0;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/auth/session')) {
    return new Response(JSON.stringify({account: {id: 'account-1', email: 'owner@test', platform_role: 'member', status: 'active', mfa_enrolled: false}, csrf: 'csrf'}));
  }
  if (url.includes('/music-draft/review') || url.includes('/music-revision')) {
    posts.push({url, body: JSON.parse(String(init?.body))});
    if (saveStatus === 409) return new Response(JSON.stringify({detail: 'This revision was already edited. Reopen the lesson.'}), {status: 409});
    if (saveStatus >= 500) return new Response(JSON.stringify({detail: 'The save could not be completed.'}), {status: saveStatus});
    latestReference = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({revision_id: 'rev-saved-1'}));
  }
  if (/\/lessons\/lesson-1$/.test(url)) {
    lessonGets += 1;
    return new Response(JSON.stringify({revision_id: 'rev-latest-9', reference: {key: 'lessons/lesson-1/ref.json'}}));
  }
  if (url.includes('/assets/ref.json')) {
    return new Response(JSON.stringify(latestReference), {headers: {'Content-Type': 'application/json'}});
  }
  return new Response(JSON.stringify(draft), {headers: {'Content-Type': 'application/json'}});
}) as typeof fetch;

const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {PianoWorkspaceHarness} = await import('../src/music/workspace/PianoWorkspaceHarness.tsx');

afterEach(() => cleanup());

async function open() {
  const view = render(<PianoWorkspaceHarness/>);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-svg')));
  return view;
}

function dirtyEdit(view: any) {
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note'));
  fireEvent.click(view.getByRole('button', {name: '+ semitone'}));
}

test('edit → confirm → save carries notation, alignment and offset; confirmation resets', async () => {
  posts = []; saveStatus = 200; latestReference = null;
  const view = await open();
  const save = () => view.getByRole('button', {name: 'Save privately'}) as HTMLButtonElement;
  assert.equal(save().disabled, true, 'nothing to save yet');
  dirtyEdit(view);
  const confirm = () => view.getByLabelText('Confirm reviewed') as HTMLInputElement;
  await waitFor(() => assert.equal(confirm().checked, false, 'a change needs confirmation first'));
  assert.equal(save().disabled, true, 'saving requires confirmation');
  fireEvent.click(confirm());
  await waitFor(() => assert.equal(save().disabled, false, 'an edit with confirmation should enable saving'));

  // A further edit must require fresh confirmation.
  fireEvent.change(view.getByLabelText(/Velocity/), {target: {value: '0.9'}});
  await waitFor(() => assert.equal(confirm().checked, false, 'an edit must reset the confirmation'));
  fireEvent.click(confirm());
  await waitFor(() => assert.equal(save().disabled, false));

  fireEvent.click(save());
  await waitFor(() => assert.ok(view.queryByText(/Saved privately/i), 'no saved status'));
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /music-draft\/review$/);
  assert.ok(posts[0].body.notation, 'the save must carry authored notation');
  assert.ok(posts[0].body.alignment, 'the save must carry the versioned alignment');
  assert.equal(posts[0].body.alignment.offset_seconds, 0);
  assert.equal(posts[0].body.offset_seconds, 0);
  assert.equal(posts[0].body.confirm_reviewed, true);
  assert.equal(posts[0].body.events.length, 20);
  assert.equal(save().disabled, true, 'the workspace is saved');
});

test('a failed save keeps the edits and the local checkpoint, and never claims Saved', async () => {
  posts = []; saveStatus = 500; latestReference = null; localStorage.clear();
  const view = await open();
  dirtyEdit(view);
  fireEvent.click(view.getByLabelText('Confirm reviewed'));
  const save = () => view.getByRole('button', {name: 'Save privately'}) as HTMLButtonElement;
  await waitFor(() => assert.equal(save().disabled, false));
  fireEvent.click(save());
  await waitFor(() => assert.ok(view.queryByText(/could not be completed/i), 'no failure message'));
  assert.equal(save().disabled, false, 'the edit remains saveable');
  assert.equal(view.queryByText(/Saved privately/i), null, 'a failure must not claim Saved');
  let stored = localStorage.getItem('piano-workspace-recovery-v1');
  await waitFor(() => {
    stored = localStorage.getItem('piano-workspace-recovery-v1');
    assert.ok(stored, 'the local checkpoint was not written');
  });
  const checkpoint = JSON.parse(stored);
  assert.equal(checkpoint.version, 1);
  assert.deepEqual(checkpoint.identity, {
    accountId: 'account-1', lessonId: 'lesson-1', draftId: 'draft-1', sourceSha256: draft.reference.sha256,
  });
  assert.ok(checkpoint.notation);
});

test('a 409 keeps the work and offers explicit resolution on the latest revision', async () => {
  posts = []; saveStatus = 409; latestReference = null; lessonGets = 0;
  const view = await open();
  dirtyEdit(view);
  fireEvent.click(view.getByLabelText('Confirm reviewed'));
  const save = () => view.getByRole('button', {name: 'Save privately'}) as HTMLButtonElement;
  await waitFor(() => assert.equal(save().disabled, false));
  fireEvent.click(save());
  await waitFor(() => assert.ok(view.queryByText(/newer saved revision/i), 'no conflict message'));
  assert.ok(view.getByRole('button', {name: 'Save on latest revision'}));
  assert.ok(view.getByRole('button', {name: 'Reload saved revision'}));
  assert.equal(save().disabled, false, 'the edits survive the conflict');

  saveStatus = 200;
  fireEvent.click(view.getByRole('button', {name: 'Save on latest revision'}));
  await waitFor(() => assert.ok(view.queryByText(/Saved privately/i), 'the resolution did not save'));
  assert.equal(lessonGets, 1, 'the conflict resolution reads the latest revision');
  const retry = posts[posts.length - 1];
  assert.equal(retry.body.base_revision_id, 'rev-latest-9');
  assert.ok(retry.body.notation, 'the local work is preserved on the new base');
  assert.equal(posts.length, 2, 'exactly one review and one revision attempt');
  assert.match(posts[0].url, /music-draft\/review$/);
  assert.match(posts[1].url, /music-revision$/);
  assert.equal(posts[1].body.base_revision_id, 'rev-latest-9',
    'the retry is rebased, not a duplicate finalisation of the same base');
});

test('reopen restores the saved notation, alignment anchors and offset', async () => {
  posts = []; saveStatus = 200;
  const view = await open();
  dirtyEdit(view);
  fireEvent.click(view.getByLabelText('Confirm reviewed'));
  const save = () => view.getByRole('button', {name: 'Save privately'}) as HTMLButtonElement;
  await waitFor(() => assert.equal(save().disabled, false));
  fireEvent.click(save());
  await waitFor(() => assert.ok(view.queryByText(/Saved privately/i)));

  // A stored authored spelling and an anchored offset, as another client saved them.
  const stored = JSON.parse(JSON.stringify(posts[0].body));
  const target = stored.notation.events.flatMap((event: any) => event.notes)
    .find((note: any) => note.pitch === 60);
  target.spelling = 'B#3';
  stored.alignment = {...stored.alignment, mode: 'anchored', anchors: [{seconds: 1, tick: 960}], offset_seconds: 0.25};
  stored.offset_seconds = 0.25;
  latestReference = stored;
  localStorage.clear();

  fireEvent.click(view.getByRole('button', {name: 'Reopen saved'}));
  await waitFor(() => assert.ok(view.queryByText(/Reopened revision rev-late/i), 'no reopen status'));
  console.log('REOPEN', view.container.querySelector('.ws-report')?.textContent,
    [...view.container.querySelectorAll('.ws-score-notehead')].slice(0, 6).map(node => node.getAttribute('aria-label')));
  await waitFor(() => assert.ok(
    view.container.querySelector('.ws-score-notehead[aria-label*="B#3"]'),
    'the authored spelling was regenerated instead of restored'));
  const offset = view.getByLabelText('Sync offset in seconds (not saved)') as HTMLInputElement;
  assert.equal(offset.value, '0.25', 'the saved offset was not restored');
  assert.match(view.getByText(/Score alignment anchored/i).textContent ?? '', /anchored/i);
  assert.equal(save().disabled, true, 'a reopened revision is clean');
});

test('a matching local checkpoint is offered as local work, and restored without claiming Saved', async () => {
  posts = []; saveStatus = 200; latestReference = null;
  localStorage.clear();
  const {buildNotation} = await import('../../../packages/music-notation/index.ts');
  const notation = buildNotation(fixture.events.map((event: any) => ({
    id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
    velocity: event.velocity ?? null, confidence: event.confidence ?? null, optional: Boolean(event.optional),
    string: null, fret: null, notation_duration: event.notation_duration ?? null,
  })), {duration: fixture.duration});
  localStorage.setItem('piano-workspace-recovery-v1', JSON.stringify({
    version: 1, savedAt: new Date().toISOString(),
    identity: {accountId: 'account-1', lessonId: 'lesson-1', draftId: 'draft-1', sourceSha256: draft.reference.sha256},
    title: 'Local work', notation,
    alignment: {alignment_version: 1, mode: 'anchored', basis: 'tempo', offset_seconds: 0.5,
      anchors: [{seconds: 1, tick: 960}]},
    offsetSeconds: 0.5, spans: [{start: 0, end: 12, kind: 'playing'}],
  }));
  const view = await open();
  await waitFor(() => assert.ok(view.queryByText(/not saved to the server/i), 'no local checkpoint offer'));
  fireEvent.click(view.getByRole('button', {name: 'Restore local checkpoint'}));
  await waitFor(() => assert.ok(view.queryByText(/it is not saved to the server/i), 'no honest restore status'));
  assert.equal((view.getByLabelText('Sync offset in seconds (not saved)') as HTMLInputElement).value, '0.5');
  assert.match(view.getByText(/Score alignment anchored/i).textContent ?? '', /anchored/i);
  assert.equal(view.queryByText(/Saved privately/i), null, 'a local checkpoint must never claim Saved');
});

test('a checkpoint for another account is rejected and never offered', async () => {
  posts = []; saveStatus = 200; latestReference = null;
  localStorage.clear();
  localStorage.setItem('piano-workspace-recovery-v1', JSON.stringify({
    version: 1, savedAt: new Date().toISOString(),
    identity: {accountId: 'someone-else', lessonId: 'lesson-1', draftId: 'draft-1', sourceSha256: draft.reference.sha256},
    title: 'Not mine', notation: {notation_version: 1}, alignment: null, offsetSeconds: 0, spans: [],
  }));
  const view = await open();
  await waitFor(() => assert.ok(view.queryByText(/different account, draft or source/i), 'no rejection notice'));
  assert.equal(view.queryByText(/not saved to the server/i), null, 'a foreign checkpoint must not be offered');
  assert.equal(view.queryByRole('button', {name: 'Restore local checkpoint'}), null);
});
