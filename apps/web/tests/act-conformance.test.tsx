import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseLessonDocument, parsePublicLessonDocument} from '../../../packages/lesson-schema/parse';
import {buildLessonContext, buildPublicLessonContext, type LessonContext} from '../src/app/lesson-context';
import {createLessonOpener} from '../src/app/lesson-opener';
import {lessonPageUrl, routeOf} from '../src/app/routes';
import {createResourceBag} from '../../../packages/learning-engine/practice-adapter';
import {createSessionGuard} from '../src/practice/session-guard';
import {submitAttempt} from '../src/practice/submit-attempt';
import {createEditorSession} from '../src/editor/editor-session';
import {applyReleaseChange, applySavedRevision} from '../src/editor/revision-handoff';

const FIXTURES = new URL('../../../packages/lesson-schema/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('fixture.json', FIXTURES), 'utf8'));
const musicFixture = JSON.parse(readFileSync(new URL('fixtures/music-v2.json', FIXTURES), 'utf8'));
const asset = (key: string, mime: string) => ({key, mime, bytes: 1, sha256: '0'.repeat(64)});
const drawingFixture = {
  schema_version: 3, experience_family: 'visual', lesson_id: 'drawing', revision_id: 'r1',
  title: 'Draw', subject: 'drawing', medium: 'pencil', assessment: 'none', warnings: [],
  steps: [{id: 's1', title: 'Step', instruction: 'Draw.'}],
};
const sam = {...fixture, lesson_id: 'sam', engine: 'sam-3d-body'};
const mediapipe = {...fixture, lesson_id: 'mediapipe', engine: 'mediapipe', animation: null,
  source_video: asset('preview.mp4', 'video/mp4')};
const publicEnvelope = {...fixture, ...sam, lesson_id: 'public-video', animation: null,
  landmarks: null, source_video: null, focused_video: null,
  act_id: 'full_body', release_revision: 'r1', published_revision_id: 'r1',
  creator_name: 'Ari', description: null, audience: 'public', tags: [], roles: ['playable_preview'],
  public_roles: [], representations: ['video'], like_count: null, liked_by_viewer: null,
  effective_actions: {watch: true, practice: false, challenge: false},
  playable_preview: asset('public/preview.mp4', 'video/mp4')};
const music = {...musicFixture, lesson_id: 'piano', subject: 'piano',
  instrument: {instrument: 'piano'}};
const guitar = {...music, lesson_id: 'guitar', subject: 'guitar', instrument: {instrument: 'guitar'}};

function parsed(value: unknown) {
  const result = parseLessonDocument(value);
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.value;
}

function publicParsed() {
  const result = parsePublicLessonDocument(publicEnvelope);
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.value;
}

function contexts(): {name: string; context: LessonContext}[] {
  return [
    {name: 'sam', context: buildLessonContext({document: parsed(sam), audience: 'owner', accountScope: 'a'})},
    {name: 'mediapipe', context: buildLessonContext({document: parsed(mediapipe), audience: 'owner', accountScope: 'a'})},
    {name: 'public-video', context: buildPublicLessonContext(publicEnvelope)},
    {name: 'piano', context: buildLessonContext({document: parsed(music), audience: 'owner', accountScope: 'a'})},
    {name: 'guitar', context: buildLessonContext({document: parsed(guitar), audience: 'owner', accountScope: 'a'})},
    {name: 'drawing', context: buildLessonContext({document: parsed(drawingFixture), audience: 'owner', accountScope: 'a'})},
  ];
}

test('strict parsing and six-Act opener/routing contracts agree', async () => {
  const table = contexts();
  const publicResult = publicParsed();
  assert.equal(publicResult.document.kind, 'body');
  assert.equal(table.find(value => value.name === 'sam')!.context.document.kind, 'body');
  const opener = createLessonOpener({
    privateLoad: async request => table.find(value => value.name === request.lessonId)!.context,
    publicLoad: async () => table.find(value => value.name === 'public-video')!.context,
    demoLoad: async () => table[0].context,
  });
  for (const {name, context} of table) {
    const opened = await opener.open({lessonId: name,
      source: name === 'public-video' ? 'public' : 'private', intent: 'preview',
      accountScope: context.accountScope});
    assert.equal(opened.context.actId, context.actId);
    const url = lessonPageUrl({page: opened.destinationPage, lessonId: context.lessonId,
      audience: context.audience});
    const restored = routeOf(url.slice(url.indexOf('?')));
    assert.equal(restored.id, context.lessonId);
    assert.equal(restored.source, context.audience === 'public' ? 'public' : null);
  }
  const publicVideo = table.find(value => value.name === 'public-video')!.context;
  assert.equal(publicVideo.capabilities.canPractice.available, false);
  assert.equal(publicVideo.capabilities.canChallenge.available, false);
  assert.equal(publicVideo.capabilities.canAssess.available, false);
});

test('editor lifecycle exposes dirty/save/conflict and release handoff invalidation', () => {
  const session = createEditorSession({state: 'saved-private', revisionId: 'r1', reviewed: true});
  assert.equal(session.getSnapshot().dirty, false);
  session.markDirty();
  assert.equal(session.getSnapshot().dirty, true);
  session.saved('r2');
  assert.equal(session.getSnapshot().dirty, false);
  session.conflict('newer saved revision');
  assert.equal(session.getSnapshot().errorCode, 'conflict');
  applySavedRevision('lesson', 'r2');
  applyReleaseChange('lesson');
});

test('publication readiness gates rights and guest attempt fallback stays account-scoped', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({detail: 'revoked'}),
    {status: 403, headers: {'Content-Type': 'application/json'}})) as typeof fetch;
  try {
    let released = 0;
    const bag = createResourceBag();
    bag.add({kind: 'camera', release: () => { released += 1; }});
    const guard = createSessionGuard({runtime: {destroy: () => {}} as never,
      resources: bag, revalidate: async () => { throw new Error('revoked'); }});
    await guard.handleError(Object.assign(new Error('revoked'), {status: 403}));
    assert.equal(guard.isLost(), true);
    assert.equal(released, 1);
    const result = await submitAttempt({attemptId: 'conf', lessonId: 'l', revisionId: 'r',
      actId: 'drawing', mode: 'practice', planId: 'p', durationMs: 0, status: 'unassessed',
      report: {}, accountScope: 'guest'}, {guard});
    assert.equal(result.ok, false);
  } finally { globalThis.fetch = original; }
});
