import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  {url: 'http://localhost/', pretendToBeVisual: true});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true});
const {render, cleanup, waitFor, renderHook, act} = await import('@testing-library/react');
const {useState} = await import('react');
const {useMusicReviewLoad} = await import('../src/music/workspace/useMusicReviewLoad.ts');

const fixture = JSON.parse(readFileSync(
  resolve('..', '..', 'docs', 'qualification', 'piano-workspace-phase-01', 'fixtures',
    'phase1-draft-fixture.json'), 'utf8'));
const draft = (id: string) => ({...fixture, draft_id: `draft-${id}`, lesson_id: id,
  title: `Draft ${id}`, status: 'draft'});
const original = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = original; });

function Harness({onLoad, initial = 'A'}: {onLoad: (value: unknown) => void; initial?: string}) {
  const [lessonId] = useState(initial);
  useMusicReviewLoad({lessonId, onLoaded: onLoad});
  return <span>{lessonId}</span>;
}
test('draft loads use exact lesson-scoped paths and stale A cannot overwrite B', async () => {
  const calls: string[] = [];
  let resolveA!: (value: Response) => void;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input); calls.push(url);
    if (url.endsWith('/music-draft')) {
      if (url.includes('/A/')) return new Promise<Response>(resolve => { resolveA = resolve; });
      return new Response(JSON.stringify(draft('B')), {status: 200,
        headers: {'Content-Type': 'application/json'}});
    }
    return new Response('{}', {status: 404});
  }) as typeof fetch;
  const loaded: {kind: string; draft: {lesson_id: string}}[] = [];
  function Switch() {
    const [lessonId, setLessonId] = useState('A');
    useMusicReviewLoad({lessonId, onLoaded: value => {
      if (value.kind === 'draft') loaded.push(value);
    }});
    return <button onClick={() => setLessonId('B')}>switch</button>;
  }
  const view = render(<Switch/>);
  await waitFor(() => assert.ok(calls.some(url => url === '/api/lessons/A/music-draft')));
  view.getByText('switch').click();
  await waitFor(() => assert.ok(loaded.some(value => value.draft.lesson_id === 'B')));
  resolveA(new Response(JSON.stringify(draft('A')), {status: 200,
    headers: {'Content-Type': 'application/json'}}));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(loaded.map(value => value.draft.lesson_id), ['B']);
  assert.ok(calls.every(url => !url.includes('?lesson_id=')), 'no legacy query-string draft path');
});

test('unavailable draft surfaces an error rather than an editable empty document', async () => {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/music-draft') || /\/lessons\/[^/]+$/.test(url)) {
      return new Response(JSON.stringify({detail: 'forbidden'}), {status: 403,
        headers: {'Content-Type': 'application/json'}});
    }
    return new Response('{}', {status: 404});
  }) as typeof fetch;
  let loaded = 0;
  let error = '';
  function Permission() {
    const value = useMusicReviewLoad({lessonId: 'A', onLoaded: () => { loaded += 1; }});
    error = value.error;
    return <span data-error={value.error}>x</span>;
  }
  const view = render(<Permission/>);
  await waitFor(() => assert.match(view.container.querySelector('[data-error]')?.getAttribute('data-error') ?? '',
    /draft|available|forbidden/i));
  assert.equal(loaded, 0);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return {promise, resolve};
}

const savedReference = (title = 'Saved revision') => ({
  reference_version: 1, duration: fixture.duration, events: fixture.events,
  spans: fixture.spans, title,
});

test('reopen contributes SHA-256-verified references and rejects a tampered revision', async () => {
  const good = JSON.stringify(savedReference());
  const sha256 = createHash('sha256').update(good).digest('hex');
  let reopened = false;
  let referenceFetches = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/lessons/A')) {
      return json(reopened ? {revision_id: 'rev-1', reference: {
        key: 'lessons/A/ref.json', sha256}} : {});
    }
    if (url.endsWith('/music-draft')) return json(draft('A'));
    if (url.includes('/assets/ref.json')) {
      referenceFetches += 1;
      return new Response(JSON.stringify({...savedReference(), title: 'tampered'}), {status: 200});
    }
    return new Response('{}', {status: 404});
  }) as typeof fetch;
  const loaded: {kind: string}[] = [];
  const {result} = renderHook(() => useMusicReviewLoad({lessonId: 'A',
    onLoaded: value => { loaded.push(value); }}));
  await waitFor(() => assert.equal(loaded.length, 1));
  reopened = true;
  let outcome: {status: string; message?: string} | null = null;
  await act(async () => { outcome = await result.current.reopenSaved(); });
  assert.equal(referenceFetches, 1, 'reopen must load the reference through loadReferenceValue');
  assert.equal(outcome?.status, 'error');
  assert.match(outcome?.message ?? '', /does not match its reviewed file/i);
  assert.equal(loaded.length, 1, 'a tampered reference must never be applied');
});

test('a delayed reopen cannot overwrite newer local work', async () => {
  const gate = deferredResponse();
  let reopened = false;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/lessons/A')) {
      if (!reopened) return json({});
      return gate.promise;
    }
    if (url.endsWith('/music-draft')) return json(draft('A'));
    if (url.includes('/assets/ref.json')) return json(savedReference());
    return new Response('{}', {status: 404});
  }) as typeof fetch;
  const loaded: {kind: string}[] = [];
  const {result} = renderHook(() => useMusicReviewLoad({lessonId: 'A',
    onLoaded: value => { loaded.push(value); }}));
  await waitFor(() => assert.equal(loaded.length, 1));
  reopened = true;
  let localSignature = 'before';
  let pending!: Promise<{status: string}>;
  act(() => {
    pending = result.current.reopenSaved({
      shouldApply: () => localSignature === 'before',
    });
  });
  localSignature = 'after';
  await act(async () => {
    gate.resolve(json({revision_id: 'rev-1', reference: {key: 'lessons/A/ref.json'}}));
    assert.equal((await pending).status, 'stale');
  });
  assert.equal(loaded.filter(value => value.kind === 'saved').length, 0,
    'newer local work must not be replaced by a delayed reopen');
});

test('a delayed reopen cannot apply after a lesson switch', async () => {
  const gate = deferredResponse();
  let aGets = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/lessons/A')) {
      aGets += 1;
      return aGets === 1 ? json({}) : gate.promise;
    }
    if (url.endsWith('/lessons/B')) return json({});
    if (url.endsWith('/music-draft')) {
      const id = /\/lessons\/([^/]+)\/music-draft$/.exec(url)?.[1] ?? 'A';
      return json(draft(id));
    }
    if (url.includes('/assets/ref.json')) return json(savedReference());
    return new Response('{}', {status: 404});
  }) as typeof fetch;
  const loaded: {kind: string; draft?: {lesson_id: string}}[] = [];
  const reopenRef: {current: (() => Promise<{status: string}>) | null} = {current: null};
  function Switch() {
    const [lessonId, setLessonId] = useState('A');
    const load = useMusicReviewLoad({lessonId, onLoaded: value => { loaded.push(value); }});
    reopenRef.current = load.reopenSaved;
    return <button onClick={() => setLessonId('B')}>switch</button>;
  }
  const view = render(<Switch/>);
  await waitFor(() => assert.ok(loaded.some(value => value.draft?.lesson_id === 'A')));
  let pending!: Promise<{status: string}>;
  act(() => { pending = reopenRef.current!(); });
  view.getByText('switch').click();
  await waitFor(() => assert.ok(loaded.some(value => value.draft?.lesson_id === 'B')));
  await act(async () => {
    gate.resolve(json({revision_id: 'rev-A', reference: {key: 'lessons/A/ref.json'}}));
    assert.equal((await pending).status, 'cancelled');
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(loaded.filter(value => value.kind === 'saved').length, 0,
    'a reopened lesson A revision must not apply after switching to lesson B');
});
