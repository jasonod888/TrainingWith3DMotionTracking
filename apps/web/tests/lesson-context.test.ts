import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseLessonDocument} from '../../../packages/lesson-schema/parse';
import {
  buildLessonContext, buildPublicLessonContext, clearLessonContextCache, lessonContextCacheSize,
  loadLessonContext, loadReferenceValue, referenceCacheSize, revalidateLessonContext,
  UnsupportedActError,
} from '../src/app/lesson-context';

const FIXTURES = new URL('../../../packages/lesson-schema/', import.meta.url);
const bodyJson = JSON.parse(readFileSync(new URL('fixture.json', FIXTURES), 'utf8'));
const musicJson = JSON.parse(readFileSync(new URL('fixtures/music-v2.json', FIXTURES), 'utf8'));

function parsed(value: unknown) {
  const result = parseLessonDocument(value);
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.value;
}

type FetchCall = {url: string; init?: RequestInit};
let calls: FetchCall[] = [];
let restore: (() => void) | null = null;

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const original = globalThis.fetch;
  calls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({url: String(input), init});
    return handler(String(input), init);
  }) as typeof fetch;
  restore = () => { globalThis.fetch = original; };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: {'Content-Type': 'application/json'},
  });
}

afterEach(() => {
  restore?.();
  restore = null;
  clearLessonContextCache();
});

test('body context is full_body with practice available and no Act inference from content', () => {
  const context = buildLessonContext({
    document: parsed(bodyJson), audience: 'owner', accountScope: 'acct-1',
  });
  assert.equal(context.actId, 'full_body');
  assert.equal(context.actLabel, 'Full Body');
  assert.equal(context.revisionId, bodyJson.revision_id);
  assert.equal(context.permissions.isOwner, true);
  assert.equal(context.capabilities.canPractice.available, true);
  assert.equal(context.capabilities.canChallenge.support, 'supported');
  assert.deepEqual(Object.keys(context.capabilities.inputs).sort(), ['camera', 'microphone']);
});

test('piano and guitar resolve from the validated music subject', () => {
  const piano = buildLessonContext({
    document: parsed(musicJson), audience: 'owner', accountScope: 'acct-1',
  });
  assert.equal(piano.actId, 'piano');
  assert.equal(piano.capabilities.canPractice.available, true);
  // The deployment has not enabled challenges yet; that is unavailable, not unsupported.
  assert.equal(piano.capabilities.canChallenge.support, 'unavailable');
  assert.equal(piano.capabilities.canChallenge.reasonCode, 'deployment_disabled');
  assert.deepEqual(Object.keys(piano.capabilities.inputs).sort(),
    ['microphone', 'midi', 'uploaded_recording']);

  const guitar = buildLessonContext({
    document: parsed({...musicJson, subject: 'guitar', instrument: {instrument: 'guitar'}}),
    audience: 'owner', accountScope: 'acct-1', challengeEnabled: true,
  });
  assert.equal(guitar.actId, 'guitar');
  // Even with the deployment flag on, guitar has no challenge mode.
  assert.equal(guitar.capabilities.canChallenge.support, 'unsupported');
  assert.equal(guitar.capabilities.canChallenge.reasonCode, 'act_unsupported');
});

test('an unknown Act is refused and never becomes full_body', () => {
  assert.throws(() => buildLessonContext({
    document: parsed(bodyJson), audience: 'owner', accountScope: 'acct-1', actId: 'violin',
  }), (error: unknown) => {
    assert.ok(error instanceof UnsupportedActError);
    assert.equal(error.actId, 'violin');
    assert.equal(error.capabilities.canPractice.support, 'unsupported');
    return true;
  });
});

test('server effective capabilities are a ceiling the client cannot lift', async () => {
  mockFetch(() => json({
    context_version: 1, act_id: 'full_body', audience: 'owner', document: bodyJson,
    effective_capabilities: {
      canPractice: {support: 'unavailable', available: false,
        reasonCode: 'release_unavailable', explanation: 'No playable release.'},
      canChallenge: {support: 'unavailable', available: false,
        reasonCode: 'release_unavailable', explanation: 'No playable release.'},
    },
  }));
  const context = await loadLessonContext('lesson-a', {audience: 'owner', accountScope: 'acct-1'});
  assert.equal(context.capabilities.canPractice.available, false);
  assert.equal(context.capabilities.canChallenge.available, false);
  assert.equal(context.capabilities.canPractice.reasonCode, 'release_unavailable');
});

test('real public projection shapes validate for all five media cases', () => {
  const publicEnvelope = (document: Record<string, unknown>, actId: string,
                          representations: string[], extra: Record<string, unknown> = {}) => ({
    ...document, act_id: actId, release_revision: String(document.revision_id),
    published_revision_id: String(document.revision_id), creator: {id: 'creator-1', display_name: 'Ari'},
    creator_name: 'Ari', description: 'Published', tags: ['public'],
    public_roles: ['reference'], roles: ['reference'], representations,
    effective_actions: {watch: true, practice: true, challenge: false}, audience: 'public',
    like_count: 2, liked_by_viewer: false, poster: null, public_poster: null, ...extra,
  });

  const sam = buildPublicLessonContext(publicEnvelope(bodyJson, 'full_body', ['interactive_3d']));
  assert.equal(sam.audience, 'public');
  assert.equal(sam.document.kind, 'body');

  const videoOnly = buildPublicLessonContext(publicEnvelope({
    ...bodyJson, animation: null, landmarks: null, source_video: null, focused_video: null,
  }, 'full_body', ['video'], {
    playable_preview: {key: 'public/lesson-a/video.mp4', mime: 'video/mp4',
      bytes: 4, sha256: '0'.repeat(64)},
  }));
  assert.equal(videoOnly.document.kind, 'body');
  if (videoOnly.document.kind === 'body') {
    assert.equal(videoOnly.document.value.landmarks, null);
    assert.equal(videoOnly.document.value.source_video?.mime, 'video/mp4');
  }
  assert.equal(videoOnly.capabilities.canPractice.available, false);
  assert.equal(videoOnly.capabilities.canChallenge.available, false);
  assert.equal(videoOnly.capabilities.canAssess.available, false);

  const piano = buildPublicLessonContext(publicEnvelope({...musicJson, subject: 'piano'},
    'piano', ['interactive_notation']));
  assert.equal(piano.document.kind, 'music');
  assert.equal(piano.actId, 'piano');

  const guitar = buildPublicLessonContext(publicEnvelope({
    ...musicJson, subject: 'guitar', instrument: {instrument: 'guitar'},
  }, 'guitar', ['interactive_notation']));
  assert.equal(guitar.document.kind, 'music');
  assert.equal(guitar.actId, 'guitar');

  const drawing = {
    schema_version: 3, experience_family: 'visual', lesson_id: 'draw-1', revision_id: 'draw-rev-1',
    title: 'Draw a cube', subject: 'drawing', medium: 'pencil', assessment: 'none',
    steps: [{id: 's1', title: 'Box', instruction: 'Draw a box.'}], warnings: [],
  };
  const drawingContext = buildPublicLessonContext(publicEnvelope(drawing, 'drawing',
    ['interactive_notation']));
  assert.equal(drawingContext.document.kind, 'drawing');
  assert.equal(drawingContext.actId, 'drawing');

  // A malicious field still fails because only the known public envelope is stripped.
  assert.throws(() => buildPublicLessonContext({...publicEnvelope(bodyJson, 'full_body', []),
    malicious_projection: true}));
});

test('the loader negotiates the Act envelope and validates its document', async () => {
  mockFetch(() => json({
    context_version: 1,
    act_id: 'full_body',
    act: {id: 'full_body', label: 'Full Body', descriptor_version: 1},
    audience: 'owner',
    capabilities: {},
    document: bodyJson,
  }));
  const context = await loadLessonContext('lesson-a', {audience: 'owner', accountScope: 'acct-1'});
  assert.equal(context.actId, 'full_body');
  assert.equal(calls.length, 1);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers['X-Act-Formats'], '1');
  assert.equal(headers['X-Lesson-Formats'], '1,2,3');
});

test('a plain v1 response is adapted deterministically', async () => {
  mockFetch(() => json(bodyJson));
  const context = await loadLessonContext('lesson-a', {audience: 'owner', accountScope: 'acct-1'});
  assert.equal(context.actId, 'full_body');
  assert.equal(context.document.kind, 'body');
});

test('cached contexts are reused only for the same scope, audience and revision', async () => {
  mockFetch(() => json(bodyJson));
  const revision = bodyJson.revision_id as string;
  const owner = await loadLessonContext('lesson-a', {
    audience: 'owner', accountScope: 'acct-1', useCached: true, expectedRevisionId: revision,
  });
  assert.equal(owner.audience, 'owner');
  assert.equal(calls.length, 1);

  await loadLessonContext('lesson-a', {
    audience: 'owner', accountScope: 'acct-1', useCached: true, expectedRevisionId: revision,
  });
  assert.equal(calls.length, 1, 'an exact owner revision is reused');

  // A public view never reads the owner's entry.
  const publicView = await loadLessonContext('lesson-a', {
    audience: 'public', accountScope: 'public', useCached: true, expectedRevisionId: revision,
  });
  assert.equal(publicView.audience, 'public');
  assert.equal(publicView.accountScope, 'public');
  assert.equal(calls.length, 2);
});

test('a changed release pointer forces a fresh load', async () => {
  let revision = 'rev-1';
  mockFetch(() => json({...bodyJson, revision_id: revision}));
  const first = await loadLessonContext('lesson-a', {
    audience: 'owner', accountScope: 'acct-1', useCached: true, expectedRevisionId: 'rev-1',
  });
  assert.equal(first.revisionId, 'rev-1');
  assert.equal(calls.length, 1);

  revision = 'rev-2';
  const second = await loadLessonContext('lesson-a', {
    audience: 'owner', accountScope: 'acct-1', useCached: true, expectedRevisionId: 'rev-2',
  });
  assert.equal(second.revisionId, 'rev-2');
  assert.equal(calls.length, 2, 'the stale revision is not reused');

  // Explicit revalidation always goes to the server.
  await revalidateLessonContext(second);
  assert.equal(calls.length, 3);
});

test('sign-out clears contexts and references', async () => {
  mockFetch(() => json(bodyJson));
  const revision = bodyJson.revision_id as string;
  await loadLessonContext('lesson-a', {
    audience: 'owner', accountScope: 'acct-1', useCached: true, expectedRevisionId: revision,
  });
  assert.ok(lessonContextCacheSize() > 0);
  clearLessonContextCache();
  assert.equal(lessonContextCacheSize(), 0);
  assert.equal(referenceCacheSize(), 0);
  await loadLessonContext('lesson-a', {
    audience: 'owner', accountScope: 'acct-1', useCached: true, expectedRevisionId: revision,
  });
  assert.equal(calls.length, 2);
});

test('reference assets are cached and de-duplicated by SHA-256', async () => {
  const bytes = new TextEncoder().encode('{"reference_version":1}');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  mockFetch(() => new Response(bytes, {status: 200}));
  const asset = {bytes: bytes.byteLength, sha256};

  await loadReferenceValue({key: 'lessons/a/reference.json', ...asset});
  // A different URL with identical reviewed bytes is served from the hash cache.
  const second = await loadReferenceValue({key: 'lessons/b/reference.json', ...asset});
  assert.deepEqual(second, {reference_version: 1});
  assert.equal(calls.length, 1);
  assert.equal(referenceCacheSize(), 1);

  clearLessonContextCache();
  await Promise.all([
    loadReferenceValue({key: 'lessons/c/reference.json', ...asset}),
    loadReferenceValue({key: 'lessons/d/reference.json', ...asset}),
  ]);
  assert.equal(calls.length, 2, 'two concurrent misses make one request');
});

test('a reference whose bytes do not match its reviewed hash is rejected and not cached', async () => {
  const bytes = new TextEncoder().encode('{"tampered":true}');
  mockFetch(() => new Response(bytes, {status: 200}));
  await assert.rejects(
    loadReferenceValue({key: 'lessons/a/reference.json', bytes: bytes.byteLength, sha256: 'f'.repeat(64)}),
    /does not match its reviewed file/,
  );
  assert.equal(referenceCacheSize(), 0);
});
