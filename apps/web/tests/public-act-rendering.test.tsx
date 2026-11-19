import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/public.html', pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document, location: dom.window.location,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
});

const {render, cleanup} = await import('@testing-library/react');
const {buildPublicLessonContext, loadLessonContext} = await import('../src/app/lesson-context.ts');
const {routeOf, lessonPageUrl} = await import('../src/app/routes.ts');
const {PublicRepresentation} = await import('../src/Public.tsx');
import type {PublicDetail} from '../src/api';

const FIXTURES = new URL('../../../packages/lesson-schema/', import.meta.url);
const body = JSON.parse(readFileSync(new URL('fixture.json', FIXTURES), 'utf8'));
const music = JSON.parse(readFileSync(new URL('fixtures/music-v2.json', FIXTURES), 'utf8'));
const asset = (key: string, mime: string) => ({key, mime, bytes: 4, sha256: '0'.repeat(64)});

function publicLesson(document: Record<string, unknown>, act: string,
                       representations: string[], extra: Record<string, unknown> = {}) {
  return {
    ...document, act_id: act, release_revision: String(document.revision_id),
    published_revision_id: String(document.revision_id), creator: {id: 'c1', display_name: 'Ari'},
    creator_name: 'Ari', description: 'Published', tags: ['public'],
    public_roles: ['reference'], roles: ['reference'], representations,
    effective_actions: {watch: true, practice: true, challenge: false}, audience: 'public',
    like_count: 1, liked_by_viewer: false, poster: null, public_poster: null, ...extra,
  };
}

after(() => { cleanup(); dom.window.close(); });

test('public piano, guitar, video-only and drawing dispatch to their own Act context', () => {
  const piano = buildPublicLessonContext(publicLesson({...music, subject: 'piano'}, 'piano',
    ['interactive_notation']));
  assert.equal(piano.actId, 'piano');
  assert.equal(piano.document.kind, 'music');

  const guitar = buildPublicLessonContext(publicLesson({
    ...music, subject: 'guitar', instrument: {instrument: 'guitar'},
  }, 'guitar', ['interactive_notation']));
  assert.equal(guitar.actId, 'guitar');
  assert.equal(guitar.document.kind, 'music');

  const video = buildPublicLessonContext(publicLesson({...body, animation: null, landmarks: null,
    source_video: null, focused_video: null}, 'full_body', ['video'],
    {playable_preview: asset('public/v1/body.mp4', 'video/mp4')}));
  assert.equal(video.document.kind, 'body');

  const drawingDocument = {
    schema_version: 3, experience_family: 'visual', lesson_id: 'd1', revision_id: 'dr1',
    title: 'Cube', subject: 'drawing', medium: 'pencil', assessment: 'none', warnings: [],
    steps: [{id: 's1', title: 'Box', instruction: 'Draw a box.'}],
  };
  const drawing = buildPublicLessonContext(publicLesson(drawingDocument, 'drawing',
    ['interactive_notation']));
  assert.equal(drawing.actId, 'drawing');
  assert.equal(drawing.document.kind, 'drawing');
});

test('public video-only route derives source from audience, not landmarks', () => {
  const context = buildPublicLessonContext(publicLesson({...body, animation: null, landmarks: null,
    source_video: null, focused_video: null}, 'full_body', ['video'], {
    playable_preview: asset('public/v1/body.mp4', 'video/mp4'),
    effective_capabilities: {canPractice: {support: 'unavailable', available: false,
      reasonCode: 'watch_only', explanation: 'Watch only.'}},
  }));
  assert.equal(context.audience, 'public');
  const url = lessonPageUrl({page: 'preview', lessonId: context.lessonId,
    audience: context.audience});
  assert.match(url, /source=public/);
  assert.match(url, new RegExp(`id=${context.lessonId}`));
  const restored = routeOf(url.slice(url.indexOf('?')));
  assert.equal(restored.page, 'preview');
  assert.equal(restored.id, context.lessonId);
  assert.equal(restored.source, 'public');
  const source = readFileSync(new URL('../src/LibraryApp.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('lessonPageUrl({page,lessonId:active.lesson_id,audience:context?.audience})'));
});

test('Studio share loading negotiates 1,2,3 and routes music/drawing share surfaces', async () => {
  const original = globalThis.fetch;
  let format = '';
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    format = String((init?.headers as Record<string, string> | undefined)?.['X-Lesson-Formats'] ?? '');
    if (!format.includes('3')) return new Response(JSON.stringify({detail: 'old client'}),
      {status: 406, headers: {'Content-Type': 'application/json'}});
    return new Response(JSON.stringify({context_version: 1, act_id: 'drawing',
      audience: 'owner', document: {
        schema_version: 3, experience_family: 'visual', lesson_id: 'd1', revision_id: 'r1',
        title: 'Cube', subject: 'drawing', medium: 'pencil', assessment: 'none', warnings: [],
        steps: [{id: 's1', title: 'Box', instruction: 'Draw.'}],
      }}), {status: 200, headers: {'Content-Type': 'application/json'}});
  }) as typeof fetch;
  try {
    const loaded = await loadLessonContext('d1', {audience: 'owner', accountScope: 'acct'});
    assert.equal(loaded.actId, 'drawing');
    assert.ok(format.includes('3'));
  } finally { globalThis.fetch = original; }
  const library = readFileSync(new URL('../src/LibraryApp.tsx', import.meta.url), 'utf8');
  assert.match(library, /onShare=\{item=>void run\(async\(\)=>\{const loaded=await loadLessonContext/);
  assert.ok(library.includes("loaded.actId==='drawing'"));
  assert.ok(library.includes("navigate('drawing-share')"));
  assert.ok(library.includes("loaded.actId==='piano'||loaded.actId==='guitar'"));
});

test('PublicRepresentation renders video-only body with a real video player', () => {
  const lesson = publicLesson({...body, animation: null, landmarks: null}, 'full_body', ['video'],
    {playable_preview: asset('public/v1/body.mp4', 'video/mp4')}) as unknown as PublicDetail;
  const view = render(<PublicRepresentation lesson={lesson}/>);
  const video = view.container.querySelector('video');
  assert.ok(video);
  assert.match(video!.getAttribute('src') ?? '', /body\.mp4/);
  assert.equal(video!.closest('[data-public-act]')?.getAttribute('data-public-act'), 'video-only');
});

test('PublicRepresentation renders music preview and published reference summary', () => {
  const lesson = publicLesson({...music, subject: 'piano',
    instrument: {instrument: 'piano', tuning: null}},
  'piano', ['interactive_notation', 'video'],
  {playable_preview: asset('public/m1/piano.mp4', 'video/mp4')}) as unknown as PublicDetail;
  const view = render(<PublicRepresentation lesson={lesson}/>);
  assert.equal(view.container.querySelector('[data-public-act="piano"]') !== null, true);
  assert.ok(view.container.querySelector('video'));
  assert.match(view.container.textContent ?? '', /published section/i);
});

test('PublicRepresentation renders ordered drawing steps and medium', () => {
  const lesson = publicLesson({
    schema_version: 3, experience_family: 'visual', lesson_id: 'd1', revision_id: 'dr1',
    title: 'Cube', subject: 'drawing', medium: 'charcoal', assessment: 'none', warnings: [],
    steps: [
      {id: 's1', title: 'Box', instruction: 'Draw a light box.'},
      {id: 's2', title: 'Shade', instruction: 'Shade one face.'},
    ],
  }, 'drawing', ['interactive_notation']) as unknown as PublicDetail;
  const view = render(<PublicRepresentation lesson={lesson}/>);
  assert.equal(view.container.querySelector('[data-public-act="drawing"]') !== null, true);
  assert.match(view.container.textContent ?? '', /Draw a light box\./);
  assert.match(view.container.textContent ?? '', /charcoal/i);
  assert.equal(view.container.querySelectorAll('li').length, 2);
});
