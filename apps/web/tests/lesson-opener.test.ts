import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLessonOpener, StaleLessonOpenError} from '../src/app/lesson-opener';
import {buildLessonContext} from '../src/app/lesson-context';
import type {LessonContext} from '../src/app/lesson-context';
import type {LessonManifest, MusicLessonManifest, DrawingLessonManifest} from '../../../packages/lesson-schema/index';

const body = (animation: unknown = {key: 'a.glb'}): LessonManifest => ({
  schema_version: 1, lesson_id: 'body', revision_id: 'r1', title: 'Move', duration: 1,
  engine: 'mediapipe', engine_version: 'v1', source_start: 0, frame_rate: 15,
  animation: animation as never, landmarks: {key: 'a.json', mime: 'application/json', bytes: 1, sha256: '0'.repeat(64)},
  source_video: null, thumbnail: null, focused_video: null, confidence: 'unmeasured',
  section_set: {id: 's', revision: 1, duration: 1, sections: [{id: 'one', label: 'One', start: 0, end: 1}]},
  warnings: [],
} as never);
const music = (subject: 'piano' | 'guitar'): MusicLessonManifest => ({
  schema_version: 2, lesson_id: subject, revision_id: 'r1', title: subject,
  subject, reference: {key: 'ref.json', mime: 'application/json', bytes: 1, sha256: '0'.repeat(64)},
  reference_reviewed: true, duration: 1, instrument: {instrument: subject},
  assessment: {assessment: 'none', input_modes: []}, section_set: {id: 's', revision: 1, duration: 1,
    sections: [{id: 'one', label: 'One', start: 0, end: 1}]}, warnings: [],
} as never);
const drawing = (): DrawingLessonManifest => ({
  schema_version: 3, experience_family: 'visual', lesson_id: 'drawing', revision_id: 'r1',
  title: 'Draw', subject: 'drawing', medium: 'pencil', assessment: 'none', warnings: [],
  steps: [{id: 's1', title: 'Step', instruction: 'Draw.'}],
} as never);

function contextFor(kind: 'sam' | 'private-mediapipe' | 'public-video' | 'piano' | 'guitar' | 'drawing'): LessonContext {
  if (kind === 'piano' || kind === 'guitar') {
    return buildLessonContext({document: {kind: 'music', value: music(kind)}, audience: 'owner', accountScope: 'acct'});
  }
  if (kind === 'drawing') {
    return buildLessonContext({document: {kind: 'drawing', value: drawing()}, audience: 'owner', accountScope: 'acct'});
  }
  if (kind === 'sam') return buildLessonContext({document: {kind: 'body', value: body()}, audience: 'owner', accountScope: 'acct'});
  if (kind === 'private-mediapipe') {
    return buildLessonContext({document: {kind: 'body', value: body(null)}, audience: 'owner', accountScope: 'acct'});
  }
  return buildLessonContext({document: {kind: 'body', value: body(null)}, audience: 'public', accountScope: 'public'});
}

test('opener returns validated context and Act-appropriate destination', async () => {
  const opener = createLessonOpener({
    privateLoad: async request => contextFor(request.lessonId as never),
    publicLoad: async () => contextFor('public-video'),
    demoLoad: async () => contextFor('sam'),
  });
  for (const [id, page] of [['sam', 'preview'], ['private-mediapipe', 'preview'],
    ['piano', 'preview'], ['guitar', 'preview'], ['drawing', 'practice']] as const) {
    const opened = await opener.open({lessonId: id, source: 'private', intent: 'preview',
      accountScope: 'acct'});
    assert.equal(opened.context.actId, id === 'private-mediapipe' ? 'full_body'
      : id === 'sam' ? 'full_body' : id);
    assert.equal(opened.destinationPage, page);
  }
  assert.equal((await opener.open({lessonId: 'public-video', source: 'public',
    intent: 'practice', accountScope: 'public'})).destinationPage, 'practice');
  assert.equal((await opener.open({lessonId: 'drawing', source: 'private', intent: 'share',
    accountScope: 'acct'})).destinationPage, 'drawing-share');
});

test('stale opens are rejected rather than crossing navigation generations', async () => {
  let resolveFirst!: (value: LessonContext) => void;
  const first = new Promise<LessonContext>(resolve => { resolveFirst = resolve; });
  const opener = createLessonOpener({
    privateLoad: async request => request.lessonId === 'slow' ? first : contextFor('piano'),
  });
  const slow = opener.open({lessonId: 'slow', source: 'private', intent: 'preview', accountScope: 'acct'});
  const fast = await opener.open({lessonId: 'piano', source: 'private', intent: 'preview', accountScope: 'acct'});
  assert.equal(fast.context.actId, 'piano');
  resolveFirst(contextFor('sam'));
  await assert.rejects(slow, StaleLessonOpenError);
});

test('host and registry share one executable practice loader', () => {
  const host = readFileSync(new URL('../src/LessonExperienceHost.tsx', import.meta.url), 'utf8');
  const registry = readFileSync(new URL('../src/acts/registry.ts', import.meta.url), 'utf8');
  assert.match(host, /practiceEntryFor\('piano'\)/);
  assert.match(host, /practiceEntryFor\('drawing'\)/);
  assert.match(registry, /loadPractice: \(\) => import\('\.\/music\/PracticeEntry'\)/);
  assert.match(registry, /export function practiceEntryFor/);
  assert.doesNotMatch(host, /import\('\.\/acts\/music\/PracticeEntry'\)/);
});
