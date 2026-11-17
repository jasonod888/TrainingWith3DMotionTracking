import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<html><body></body></html>', {url: 'http://localhost/', pretendToBeVisual: true});
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  React, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});

const {renderHook, waitFor, cleanup} = await import('@testing-library/react');
const {buildNotation, handPerformanceFingerprint} = await import('../../../packages/music-notation/index.ts');
const {useHandAssignments} = await import('../src/music/workspace/useHandAssignments.ts');

afterEach(cleanup);

const score = (pitch: number) => buildNotation([
  {id: 'a', onset: 0, duration: 0.5, pitch: 60, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
  {id: 'b', onset: 1, duration: 0.5, pitch, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
], {duration: 4, bpm: 120});

test('an obsolete hand request is aborted and does not become an unavailable state', async () => {
  const first = score(64);
  const second = score(67);
  let calls = 0;
  let firstSignal: AbortSignal | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      firstSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        firstSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      performance_fingerprint: handPerformanceFingerprint(second.performance),
      model: {name: 'midi2hands', version: 'test', sha256: 'x'},
      predictions: second.performance.map(note => ({id: note.id, hand: 'right', raw_score: 0.9, status: 'predicted'})),
    }), {headers: {'Content-Type': 'application/json'}}));
  }) as typeof fetch;
  try {
    const hook = renderHook(({document}) => useHandAssignments(document, 'lesson', true),
      {initialProps: {document: first}});
    await waitFor(() => assert.equal(calls, 1), {timeout: 2000});
    assert.ok(firstSignal !== null && !(firstSignal as AbortSignal).aborted);
    hook.rerender({document: second});
    await waitFor(() => assert.ok((firstSignal as AbortSignal).aborted), {timeout: 2000});
    await waitFor(() => assert.equal(hook.result.current.status, 'model'), {timeout: 3000});
    assert.equal(hook.result.current.assignments.a.hand, 'right');
    assert.equal(hook.result.current.modelInfo?.name, 'midi2hands');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a failed hand request falls back to a usable baseline without dirtying state', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({detail: 'model down'}),
    {status: 503, headers: {'Content-Type': 'application/json'}})) as typeof fetch;
  try {
    const hook = renderHook(() => useHandAssignments(score(64), 'lesson', true));
    await waitFor(() => assert.equal(hook.result.current.status, 'unavailable'), {timeout: 3000});
    assert.ok(hook.result.current.assignments.a, 'baseline assignment remains available');
    assert.equal(hook.result.current.modelInfo, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
