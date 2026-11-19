import {test, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import type {DrawingLessonManifest} from '../../../packages/lesson-schema/index';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/drawing.html', pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document,
  location: dom.window.location,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});

const drawing: DrawingLessonManifest = {
  schema_version: 3, experience_family: 'visual', lesson_id: 'drawing-1',
  revision_id: 'rev-1', title: 'Draw a cube', subject: 'drawing', medium: 'pencil',
  assessment: 'none', warnings: [], feedback_enabled: null,
  steps: [
    {id: 's1', title: 'Box', instruction: 'Draw a light box.'},
    {id: 's2', title: 'Shade', instruction: 'Shade one face.'},
    {id: 's3', title: 'Detail', instruction: 'Add a cast shadow.'},
  ],
};

const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {parseDrawing} = await import('../src/acts/drawing/drawing-document.ts');
const {drawingPlan, createDrawingTransport} = await import('../src/acts/drawing/drawing-adapter.ts');
const {buildLessonContext} = await import('../src/app/lesson-context.ts');
const {DrawingPracticeEntry} = await import('../src/acts/drawing/DrawingPracticeEntry.tsx');
const {DrawingEditorEntry} = await import('../src/acts/drawing/DrawingEditorEntry.tsx');
const {routeOf} = await import('../src/app/routes.ts');
const {loadLocalAttempts} = await import('../src/practice/practice-store.ts');

after(() => { cleanup(); dom.window.close(); });
afterEach(() => { cleanup(); });

test('the drawing payload is discriminated and refuses body/music fields', () => {
  const parsed = parseDrawing(drawing);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.schema_version, 3);
  assert.equal(parsed.value.experience_family, 'visual');
  assert.equal(parsed.value.assessment, 'none');
  assert.equal(parsed.value.steps.length, 3);

  const withBody = parseDrawing({...drawing, animation: {}});
  assert.equal(withBody.ok, false);
  const withAssessment = parseDrawing({...drawing, assessment: 'notes'});
  assert.equal(withAssessment.ok, false);
  const duplicate = parseDrawing({...drawing, steps: [drawing.steps[0], drawing.steps[0]]});
  assert.equal(duplicate.ok, false);
});

test('the context resolves drawing with unassessed practice and no challenge', () => {
  const context = buildLessonContext({
    document: {kind: 'drawing', value: drawing}, audience: 'owner', accountScope: 'acct-1',
  });
  assert.equal(context.actId, 'drawing');
  assert.equal(context.capabilities.canPractice.available, true);
  assert.equal(context.capabilities.canAssess.support, 'unsupported');
  assert.equal(context.capabilities.canAssess.reasonCode, 'no_assessment_adapter');
  assert.equal(context.capabilities.canChallenge.support, 'unsupported');
  assert.equal(context.capabilities.canRecord.support, 'unsupported');
});

test('step transport uses step indices, not fake media timestamps', () => {
  const plan = drawingPlan(drawing);
  assert.deepEqual(plan.units.map(unit => unit.id), ['s1', 's2', 's3']);
  assert.equal(plan.duration, 3);

  const transport = createDrawingTransport(drawing);
  const initial = transport.snapshot();
  assert.equal(initial.time, 0);
  assert.equal(initial.duration, 3);
  assert.equal(initial.ready, true);
  assert.equal('advance' in transport, false, 'no wall-clock advancing transport');
  transport.seek(2);
  assert.equal(transport.snapshot().time, 2);
  assert.equal(transport.currentIndex(), 2);
  assert.equal(transport.snapshot().duration, 3);
});

test('drawing practice steps forward and reports an honest unassessed completion', () => {
  const view = render(<DrawingPracticeEntry document={drawing}/>);
  assert.ok(view.getByText('Step 1 of 3'));
  assert.ok(view.getByText('Draw a light box.'));
  fireEvent.click(view.getByText('Next step'));
  assert.ok(view.getByText('Step 2 of 3'));
  assert.ok(view.getByText('Shade one face.'));
  fireEvent.click(view.getByText('Finish practice'));
  assert.ok(view.getByText(/Attempt complete · unassessed/));
  // No score is rendered for a drawing attempt.
  assert.equal(view.queryByText(/score:?\s*\d/i), null);
});

test('the drawing editor uses the shared lifecycle labels and dirty state', () => {
  const view = render(<DrawingEditorEntry lesson={drawing}/>);
  assert.ok(view.getByText('Review required'));
  assert.ok(view.getByText('Unassessed practice · no score'));
  const title = view.container.querySelector('input')!;
  fireEvent.change(title, {target: {value: 'Draw a bigger cube'}});
  assert.ok(view.getByText('Unsaved changes'));
  assert.ok(view.getByText('Save privately'));
});

test('drawing practice persists an unassessed attempt on completion', async () => {
  const original = globalThis.fetch;
  let posted: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input).includes('/practice/attempts') && init?.method === 'POST') {
      posted = JSON.parse(String(init.body)) as Record<string, unknown>;
    }
    return new Response('{}', {status: 200, headers: {'Content-Type': 'application/json'}});
  }) as typeof fetch;
  try {
    const view = render(<DrawingPracticeEntry document={drawing}/>);
    fireEvent.click(view.getByText('Finish practice'));
    await waitFor(() => assert.ok(posted));
    assert.equal(posted!.act_id, 'drawing');
    assert.equal(posted!.status, 'unassessed');
    assert.equal(posted!.assessment_adapter, null);
  } finally {
    globalThis.fetch = original;
  }
});

test('a 403 on attempt save stops the session and keeps the attempt locally', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({detail: 'gone'}),
    {status: 403, headers: {'Content-Type': 'application/json'}})) as typeof fetch;
  try {
    const view = render(<DrawingPracticeEntry document={drawing}/>);
    fireEvent.click(view.getByText('Finish practice'));
    await waitFor(() => assert.ok(view.queryByText(/Access to this lesson was removed/)));
    assert.ok(loadLocalAttempts('guest').some(value => value.status === 'unassessed'));
  } finally {
    globalThis.fetch = original;
  }
});

test('createDrawingLesson posts and validates the new drawing document', async () => {
  const original = globalThis.fetch;
  let call: {url: string; init?: RequestInit} | null = null;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    call = {url: String(input), init};
    return new Response(JSON.stringify(drawing), {status: 201,
      headers: {'Content-Type': 'application/json'}});
  }) as typeof fetch;
  try {
    const {createDrawingLesson} = await import('../src/api.ts');
    const value = await createDrawingLesson({title: 'Cube', medium: 'pencil',
      steps: [{id: 's1', title: 'Box', instruction: 'Draw a box.'}]});
    assert.equal(value.schema_version, 3);
    assert.match(call!.url, /\/api\/drawing\/lessons$/);
    assert.equal(call!.init?.method, 'POST');
  } finally {
    globalThis.fetch = original;
  }
});

test('drawing edit is a first-class lesson route', () => {
  const route = routeOf('?page=drawing-edit&id=drawing-1');
  assert.equal(route.page, 'drawing-edit');
  assert.equal(route.id, 'drawing-1');
  const library = readFileSync(new URL('../src/LibraryApp.tsx', import.meta.url), 'utf8');
  assert.ok(library.includes("if(page==='practice'&&drawing)q.set('id',drawing.lesson_id)"));
  assert.ok(library.includes("setDrawingEditId(value.lesson_id);navigate('drawing-edit')"));
});
test('drawing practice imports no body/music editor or assessment code', () => {
  const directory = new URL('../src/acts/drawing/', import.meta.url);
  for (const name of ['DrawingPracticeEntry.tsx', 'drawing-adapter.ts', 'drawing-document.ts']) {
    const source = readFileSync(new URL(name, directory), 'utf8');
    for (const forbidden of ['music/workspace', 'PianoWorkspaceHarness', 'LessonWorkspace',
      'editor/', 'music-feedback', 'MimicInterface', 'pose-capture']) {
      assert.ok(!source.includes(forbidden), `${name} must not import ${forbidden}`);
    }
  }
});
