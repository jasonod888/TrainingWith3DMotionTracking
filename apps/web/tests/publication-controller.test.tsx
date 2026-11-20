import {test, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/publication.html', pretendToBeVisual: true});
Object.assign(globalThis, {window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, location: dom.window.location,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true});
const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {useState} = await import('react');
const {usePublicationController} = await import('../src/sharing/usePublicationController.ts');

type Call = {url: string; method: string; body?: string};
let calls: Call[] = [];
let deny = false;
const original = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  calls.push({url: String(input), method: init?.method ?? 'GET',
    body: init?.body ? String(init.body) : undefined});
  if (init?.method === 'PATCH' && deny) {
    return new Response(JSON.stringify({detail: 'Server denied publication.'}),
      {status: 409, headers: {'Content-Type': 'application/json'}});
  }
  if (init?.method === 'PATCH') return new Response('{}', {status: 200,
    headers: {'Content-Type': 'application/json'}});
  return new Response(JSON.stringify({lesson_id: 'l1', revision_id: 'r1',
    audience: 'public', publishable: true, roles: ['reference'],
    allowed_roles: ['poster', 'playable_preview', 'reference'], representations: [],
    missing: [], reasons: []}), {status: 200, headers: {'Content-Type': 'application/json'}});
}) as typeof fetch;

after(() => { cleanup(); globalThis.fetch = original; dom.window.close(); });
afterEach(() => { cleanup(); });

function Harness() {
  const controller = usePublicationController({lessonId: 'l1', initialRoles: ['reference']});
  return <div>
    <span data-ready={String(!controller.loading)}>{controller.publishability?.publishable ? 'ready' : 'not-ready'}</span>
    <span data-can={String(controller.canPublish)}>can</span>
    <button onClick={() => controller.setRights(true)}>rights</button>
    <button onClick={() => void controller.publish({title: 'Public', creatorName: 'Ari',
      tags: ['drawing'], rightsAcknowledged: controller.rights, roles: controller.roles,
      releaseRevisionId: 'r1'})}>publish</button>
    <button onClick={() => void controller.unlist()}>unlist</button>
    {controller.error && <p role="alert">{controller.error}</p>}
  </div>;
}

test('controller loads readiness, gates rights, publishes exact revision and unlists', async () => {
  deny = false; calls = [];
  const view = render(<Harness/>);
  await waitFor(() => assert.equal(view.container.querySelector('[data-ready]')?.getAttribute('data-ready'), 'true'));
  assert.equal(view.container.querySelector('[data-can]')?.getAttribute('data-can'), 'false');
  fireEvent.click(view.getByText('rights'));
  await waitFor(() => assert.equal(view.container.querySelector('[data-can]')?.getAttribute('data-can'), 'true'));
  fireEvent.click(view.getByText('publish'));
  await waitFor(() => assert.ok(calls.some(call => call.method === 'PATCH')));
  const patch = calls.find(call => call.method === 'PATCH')!;
  const body = JSON.parse(patch.body ?? '{}') as Record<string, unknown>;
  assert.equal(body.listed, true);
  assert.equal(body.release_revision_id, 'r1');
  assert.deepEqual(body.public_roles, ['reference']);
  await waitFor(() => assert.equal(calls.filter(call => call.url.includes('/publishability')).length, 2));
  fireEvent.click(view.getByText('unlist'));
  await waitFor(() => assert.equal(calls.filter(call => call.method === 'PATCH').length, 2));
  assert.equal(JSON.parse(calls.filter(call => call.method === 'PATCH')[1].body ?? '{}').listed, false);
});

test('server denial is surfaced and does not fake success', async () => {
  deny = true; calls = [];
  const view = render(<Harness/>);
  await waitFor(() => assert.equal(view.container.querySelector('[data-ready]')?.getAttribute('data-ready'), 'true'));
  fireEvent.click(view.getByText('rights'));
  fireEvent.click(view.getByText('publish'));
  await waitFor(() => assert.match(view.getByRole('alert').textContent ?? '', /Server denied/));
});

test('out-of-order lesson readiness cannot overwrite the newer lesson', async () => {
  const previous = globalThis.fetch;
  const pending = new Map<string, (value: Response) => void>();
  globalThis.fetch = ((input: unknown) => {
    const url = String(input);
    if (url.includes('/publishability')) {
      const id = url.includes('/B/') ? 'B' : 'A';
      return new Promise<Response>(resolve => { pending.set(id, resolve); });
    }
    return Promise.resolve(new Response('{}', {status: 200}));
  }) as typeof fetch;
  function Switcher() {
    const [id, setId] = useState('A');
    const controller = usePublicationController({lessonId: id, initialRoles: ['reference']});
    return <div>
      <span data-ready={String(controller.publishability?.publishable ?? false)}>ready</span>
      <span data-can={String(controller.canPublish)}>can</span>
      <button onClick={() => setId('B')}>switch</button>
    </div>;
  }
  try {
    const view = render(<Switcher/>);
    await waitFor(() => assert.ok(pending.has('A')));
    fireEvent.click(view.getByText('switch'));
    await waitFor(() => assert.ok(pending.has('B')));
    const body = (publishable: boolean) => JSON.stringify({lesson_id: 'x', revision_id: 'r',
      audience: 'public', publishable, roles: ['reference'], allowed_roles: ['reference'],
      representations: [], missing: [], reasons: []});
    pending.get('B')!(new Response(body(false), {status: 200,
      headers: {'Content-Type': 'application/json'}}));
    await waitFor(() => assert.equal(view.container.querySelector('[data-ready]')?.getAttribute('data-ready'), 'false'));
    pending.get('A')!(new Response(body(true), {status: 200,
      headers: {'Content-Type': 'application/json'}}));
    await waitFor(() => assert.equal(view.container.querySelector('[data-can]')?.getAttribute('data-can'), 'false'));
    assert.equal(view.container.querySelector('[data-ready]')?.getAttribute('data-ready'), 'false');
  } finally { globalThis.fetch = previous; }
});
