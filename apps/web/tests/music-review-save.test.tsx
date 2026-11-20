import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  {url: 'http://localhost/', pretendToBeVisual: true});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true});
const {render, fireEvent, cleanup, waitFor, act} = await import('@testing-library/react');
const {createEditorSession} = await import('../src/editor/editor-session.ts');
const {useMusicReviewSave} = await import('../src/music/workspace/useMusicReviewSave.ts');

const original = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = original; });

type SaveArgs = {baseRevisionId: string | null; body: Record<string, unknown>;
  isCurrent: () => boolean};
let currentSave: ((args: SaveArgs) => Promise<unknown>) | null = null;

function SaveHarness({lessonId, session, onSaved}: {
  lessonId: string | null;
  session: ReturnType<typeof createEditorSession>;
  onSaved?: (manifest: {revision_id: string}) => void;
}) {
  const value = useMusicReviewSave({lessonId, editorSession: session, onSaved});
  currentSave = value.save;
  return <div>
    <span data-saving={String(value.saving)}>saving</span>
    <span data-message>{value.saveMessage}</span>
    <span data-error>{value.saveError}</span>
  </div>;
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return {promise, resolve};
}

function savedResponse(revisionId: string) {
  return new Response(JSON.stringify({revision_id: revisionId}), {
    status: 200, headers: {'Content-Type': 'application/json'}});
}

test('saving an older snapshot keeps the shared session dirty', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({revision_id: 'r2'}), {
    status: 200, headers: {'Content-Type': 'application/json'}})) as typeof fetch;
  const session = createEditorSession({state: 'saved-private', revisionId: 'r1', reviewed: true});
  session.markDirty();
  function Harness() {
    const save = useMusicReviewSave({lessonId: 'lesson', editorSession: session});
    return <div>
      <span data-dirty={String(session.getSnapshot().dirty)}>dirty</span>
      <span data-status={session.statusLabel()}>status</span>
      <span data-message>{save.saveMessage}</span>
      <button onClick={() => void save.save({baseRevisionId: 'r1', body: {},
        isCurrent: () => false})}>save</button>
    </div>;
  }
  const view = render(<Harness/>);
  fireEvent.click(view.getByText('save'));
  await waitFor(() => assert.match(view.container.querySelector('[data-message]')?.textContent ?? '',
    /newer edits are still unsaved/));
  assert.equal(view.container.querySelector('[data-dirty]')?.getAttribute('data-dirty'), 'true');
  assert.notEqual(view.container.querySelector('[data-status]')?.getAttribute('data-status'),
    'Saved privately');
});

test('a delayed save from lesson A cannot mutate lesson B after a lesson switch', async () => {
  const gate = deferredResponse();
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).includes('/lessons/A/')) return gate.promise;
    return savedResponse('rB');
  }) as typeof fetch;
  const sessionA = createEditorSession({state: 'saved-private', revisionId: 'rA1', reviewed: true});
  sessionA.markDirty();
  const sessionB = createEditorSession({state: 'saved-private', revisionId: 'rB1', reviewed: true});
  const beforeA = sessionA.getSnapshot();
  const beforeB = sessionB.getSnapshot();
  const saved: {revision_id: string}[] = [];
  const view = render(<SaveHarness lessonId="A" session={sessionA}
    onSaved={manifest => saved.push(manifest)}/>);
  let pending!: Promise<unknown>;
  act(() => {
    pending = currentSave!({baseRevisionId: 'rA1', body: {}, isCurrent: () => true});
  });
  await Promise.resolve();
  view.rerender(<SaveHarness lessonId="B" session={sessionB}
    onSaved={manifest => saved.push(manifest)}/>);
  await act(async () => {
    gate.resolve(savedResponse('rA2'));
    await pending;
  });
  assert.deepEqual(sessionA.getSnapshot(), beforeA,
    'lesson A session must not be advanced by a save invalidated by the switch');
  assert.deepEqual(sessionB.getSnapshot(), beforeB, 'lesson B session revision/dirty must stay untouched');
  assert.equal(saved.length, 0, 'onSaved must not receive lesson A work under lesson B');
  assert.equal(view.container.querySelector('[data-message]')?.textContent, '');
  assert.equal(view.container.querySelector('[data-error]')?.textContent, '');
  assert.equal(view.container.querySelector('[data-saving]')?.getAttribute('data-saving'), 'false');
});

test('a save resolving after unmount never updates the session or calls onSaved', async () => {
  const gate = deferredResponse();
  globalThis.fetch = (async () => gate.promise) as typeof fetch;
  const session = createEditorSession({state: 'saved-private', revisionId: 'r1', reviewed: true});
  session.markDirty();
  const before = session.getSnapshot();
  const saved: {revision_id: string}[] = [];
  const view = render(<SaveHarness lessonId="A" session={session}
    onSaved={manifest => saved.push(manifest)}/>);
  let pending!: Promise<unknown>;
  act(() => {
    pending = currentSave!({baseRevisionId: 'r1', body: {}, isCurrent: () => true});
  });
  await Promise.resolve();
  act(() => { view.unmount(); });
  await act(async () => {
    gate.resolve(savedResponse('r2'));
    await pending;
  });
  assert.deepEqual(session.getSnapshot(), before, 'an unmounted save must not mark the session saved');
  assert.equal(saved.length, 0);
});
