import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createResourceBag} from '../../../packages/learning-engine/practice-adapter';
import {createSessionGuard,createContextRevalidator} from '../src/practice/session-guard';
import {buildLessonContext} from '../src/app/lesson-context';

const {render, cleanup} = await import('@testing-library/react');
const {DrawingPracticeEntry} = await import('../src/acts/drawing/DrawingPracticeEntry.tsx');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/'});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, HTMLElement: dom.window.HTMLElement});
Object.defineProperty(dom.window.document, 'visibilityState', {value: 'visible', configurable: true});
after(() => { cleanup(); dom.window.close(); });

function fakeLostSession() {
  let stopped = false;
  let released = false;
  const bag = createResourceBag();
  bag.add({kind: 'camera', release: () => { released = true; }});
  const runtime = {destroy: () => { stopped = true; }};
  const transport = {destroy: () => { stopped = true; }};
  return {bag, runtime, transport, stopped: () => stopped, released: () => released};
}

test('a mounted practice session stops and releases resources on 404 access loss', async () => {
  const session = fakeLostSession();
  const guard = createSessionGuard({
    runtime: session.runtime, transport: session.transport, resources: session.bag,
    revalidate: async () => { throw Object.assign(new Error('gone'), {status: 404}); },
  });
  assert.equal(await guard.check(), true);
  assert.equal(guard.isLost(), true);
  assert.equal(session.stopped(), true, 'runtime and transport stopped');
  assert.equal(session.released(), true, 'resource bag released');
});

test('visibility/focus revalidation automatically tears down a mounted session', async () => {
  const session = fakeLostSession();
  const guard = createSessionGuard({
    runtime: session.runtime, transport: session.transport, resources: session.bag,
    revalidate: async () => { throw Object.assign(new Error('gone'), {status: 403}); },
  });
  guard.start(60_000);
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(guard.isLost(), true);
  assert.equal(session.released(), true);
});

test('stopping the guard removes listeners and interval revalidation', async () => {
  let calls = 0;
  const session = fakeLostSession();
  const guard = createSessionGuard({
    runtime: session.runtime, transport: session.transport, resources: session.bag,
    revalidate: async () => { calls += 1; },
  });
  const stop = guard.start(5);
  await new Promise(resolve => setTimeout(resolve, 20));
  const before = calls;
  stop();
  await new Promise(resolve => setTimeout(resolve, 20));
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  window.dispatchEvent(new dom.window.Event('focus'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, before, 'no revalidation after stop');
});

test('demo contexts never poll and public contexts use only the public endpoint', async () => {
  const demo = buildLessonContext({document: {kind: 'body', value: {
    ...JSON.parse(readFileSync(new URL('../../../packages/lesson-schema/fixture.json', import.meta.url), 'utf8')),
  }}, audience: 'demo', accountScope: 'public'});
  assert.equal(createContextRevalidator(demo), null);

  const publicContext = {...demo, audience: 'public' as const, accountScope: 'public'};
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    return new Response(JSON.stringify({detail: 'not found'}), {status: 404,
      headers: {'Content-Type': 'application/json'}});
  }) as typeof fetch;
  try {
    const revalidate = createContextRevalidator(publicContext);
    assert.ok(revalidate);
    await revalidate!().catch(() => undefined);
    assert.ok(calls.every(url => url.includes('/api/public/moves/')));
    assert.equal(calls.filter(url => url.includes('/api/lessons/')).length, 0);
  } finally { globalThis.fetch = original; }
});

test('unmounting drawing practice stops revalidation listeners', async () => {
  const lesson = {schema_version: 3, experience_family: 'visual', lesson_id: 'd1',
    revision_id: 'r1', title: 'Cube', subject: 'drawing', medium: 'pencil',
    assessment: 'none', warnings: [], steps: [{id: 's1', title: 'Box', instruction: 'Draw.'}]} as const;
  const context = buildLessonContext({document: {kind: 'drawing', value: lesson as never},
    audience: 'public', accountScope: 'public'});
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { calls += 1; return new Response('{}', {status: 200}); }) as typeof fetch;
  try {
    const view = render(<DrawingPracticeEntry context={context}/>);
    view.unmount();
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    window.dispatchEvent(new dom.window.Event('focus'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 0, 'no revalidation after unmount');
  } finally { globalThis.fetch = original; }
});

test('body and music screens register real camera/audio/MIDI/runtime cleanup', () => {
  const body = readFileSync(new URL('../src/PracticeWorkspace.tsx', import.meta.url), 'utf8');
  assert.ok(/bag\.add\(\{\s*kind:\s*'camera'/.test(body));
  assert.ok(/bag\.add\(\{\s*kind:\s*'audio'/.test(body));
  assert.ok(body.includes('usePracticeAccessGuard('));
  const music = readFileSync(new URL('../src/music/workspace/PianoPracticeWorkspace.tsx', import.meta.url), 'utf8');
  assert.ok(/kind:\s*'audio'/.test(music));
  assert.ok(music.includes("kind:'microphone'") || music.includes("kind: 'microphone'"));
  assert.ok(music.includes('challengeRef.current?.cancel'));
  assert.ok(music.includes('listenPlayRef.current?.cancel'));
  assert.ok(music.includes("midi.disconnect()"));
  assert.ok(music.includes("practice.runtime?.destroy()"));
  assert.ok(/bag\.add\(\{\s*kind:\s*'audio'[\s\S]*midi\.disconnect\(\)/.test(music));
  assert.ok(/bag\.add\(\{\s*kind:\s*'microphone'/.test(music));
});

test('403 and 401 revoke a mounted session, while transient failures do not', async () => {
  for (const status of [401, 403]) {
    const session = fakeLostSession();
    const guard = createSessionGuard({
      runtime: session.runtime, transport: session.transport, resources: session.bag,
      revalidate: async () => { throw Object.assign(new Error('lost'), {status}); },
    });
    assert.equal(await guard.check(), true);
    assert.equal(session.released(), true);
  }
  const session = fakeLostSession();
  const guard = createSessionGuard({
    runtime: session.runtime, transport: session.transport, resources: session.bag,
    revalidate: async () => { throw Object.assign(new Error('offline'), {status: 503}); },
  });
  assert.equal(await guard.check(), false);
  assert.equal(guard.isLost(), false);
  assert.equal(session.released(), false);
});
