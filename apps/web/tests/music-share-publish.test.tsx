import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/music-share.html', pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, location: dom.window.location,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});

const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {MusicShareLesson} = await import('../src/music/MusicShareLesson.tsx');

type Call = {url: string; init?: RequestInit};
let calls: Call[] = [];
const originalFetch = globalThis.fetch;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: {'Content-Type': 'application/json'},
  });
}

globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  calls.push({url, init});
  if (url.endsWith('/sharing')) return json({
    mode: 'private', published_revision_id: null, accepted_revision_id: 'r1',
    draft_revision_id: 'r1', students: [], invitations: [], public_listed: false,
  });
  if (url.includes('/publishability')) return json({
    lesson_id: 'music-1', revision_id: 'r1', audience: 'public', publishable: true,
    roles: ['reference'], allowed_roles: ['reference', 'playable_preview', 'poster'],
    representations: ['interactive_notation'], missing: [], reasons: [],
  });
  if (init?.method === 'PATCH') return json({listed: true});
  return json({subject: 'piano', revision_id: 'r1',
    reference: {key: 'lessons/music-1/reference.json', mime: 'application/json',
      bytes: 4, sha256: '0'.repeat(64)},
    playable_preview: {key: 'lessons/music-1/preview.mp4', mime: 'video/mp4',
      bytes: 4, sha256: '0'.repeat(64)}});
}) as typeof fetch;

after(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  dom.window.close();
});

test('music creator selects public roles and publishes through readiness', async () => {
  const view = render(<MusicShareLesson lessonId="music-1" title="Piano piece"
    onBack={() => {}}/>);
  await view.findByText('Public gallery');
  const role = await view.findByLabelText('reviewed score/notation');
  if (!(role as HTMLInputElement).checked) fireEvent.click(role);
  fireEvent.click(view.getByLabelText('I have the right to publish this music lesson publicly.'));
  await waitFor(() => assert.equal(
    (view.getByText('List publicly').closest('button') as HTMLButtonElement).disabled, false));
  fireEvent.click(view.getByText('List publicly'));
  await waitFor(() => {
    const patch = calls.find(call => call.init?.method === 'PATCH'
      && String(call.url).includes('/public/lessons/music-1'));
    assert.ok(patch, 'public publish was called');
    const body = JSON.parse(String(patch!.init!.body)) as {listed: boolean; public_roles: string[]};
    assert.equal(body.listed, true);
    assert.ok(body.public_roles.includes('reference'));
  });
});
