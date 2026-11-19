import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {
  SOCIAL_POLICY, actionSummary, actLabel, actForSubject, dedupeById, discoveryFromApi,
  discoveryFromSummary, filterDiscovery, openTarget, unsupportedModeMessage,
  type DiscoveryItem,
} from '../src/social/discovery';

function item(overrides: Partial<DiscoveryItem> = {}): DiscoveryItem {
  return {
    lessonId: 'lesson-1', releaseRevision: 'rev-1', actId: 'full_body', title: 'Lesson',
    creator: {id: 'creator-1', displayName: 'Ari'}, subjects: [{id: 'dance', label: 'Dance'}],
    tags: ['kick'], poster: null, duration: 10, sections: 2, roles: ['interactive_data'],
    representations: ['interactive_3d'],
    actions: {watch: true, practice: true, challenge: true}, audience: 'public',
    likeCount: 0, likedByViewer: false, ...overrides,
  };
}

const SAM = {
  lesson_id: 'sam', release_revision: 'r1', act_id: 'full_body', title: 'Kick',
  creator: {id: 'c1', display_name: 'Ari'}, subjects: [{id: 'taekwondo', label: 'Taekwondo'}],
  tags: ['kick'], roles: ['interactive_data'], representations: ['interactive_3d'],
  effective_actions: {watch: true, practice: true, challenge: true},
  content: {sections: 3}, like_count: 4, liked_by_viewer: true,
};
const VIDEO = {...SAM, lesson_id: 'video', act_id: 'full_body',
  roles: ['playable_preview'], representations: ['video'],
  effective_actions: {watch: true, practice: true, challenge: false}};
const PIANO = {...SAM, lesson_id: 'piano', act_id: 'piano',
  subjects: [{id: 'piano', label: 'Piano'}], roles: ['reference'],
  representations: ['interactive_notation'],
  effective_actions: {watch: true, practice: true, challenge: false}};
const GUITAR = {...PIANO, lesson_id: 'guitar', act_id: 'guitar',
  subjects: [{id: 'guitar', label: 'Guitar'}]};

test('all four current Acts map to neutral items and honest labels', () => {
  const sam = discoveryFromApi(SAM);
  assert.equal(sam.actId, 'full_body');
  assert.equal(sam.actions.challenge, true);
  assert.equal(actionSummary(sam), 'Practice + challenge');
  assert.equal(actLabel(sam.actId), 'Full body');
  assert.equal(sam.likeCount, 4);
  assert.equal(sam.likedByViewer, true);

  const video = discoveryFromApi(VIDEO);
  assert.equal(actionSummary(video), 'Practice');
  assert.equal(openTarget(video), 'practice');

  for (const raw of [PIANO, GUITAR]) {
    const mapped = discoveryFromApi(raw);
    assert.equal(actionSummary(mapped), 'Practice');
    assert.equal(mapped.roles[0], 'reference');
    assert.equal(actForSubject(mapped.subjects[0].id), mapped.actId);
  }
});

test('a watch-only item never pretends practice is supported', () => {
  const watchOnly = discoveryFromApi({...VIDEO,
    effective_actions: {watch: true, practice: false, challenge: false}});
  assert.equal(actionSummary(watchOnly), 'Watch only');
  assert.equal(openTarget(watchOnly), 'watch');
  assert.match(unsupportedModeMessage(watchOnly.actId, 'practice'), /no playable source/);
});

test('an unknown Act gets an honest message and is never a body fallback', () => {
  const unknown = discoveryFromApi({...SAM, act_id: 'violin', roles: [], representations: [],
    effective_actions: {watch: false, practice: false, challenge: false}});
  assert.equal(unknown.actId, 'violin');
  assert.equal(actLabel('violin'), 'Lesson');
  const message = unsupportedModeMessage('violin', 'practice');
  assert.match(message, /cannot open/);
  assert.doesNotMatch(message, /3D|body/i);
});

test('summaries map to the same shape with Act-derived actions', () => {
  const piano = discoveryFromSummary({lesson_id: 'p', revision_id: 'r', title: 'Piano',
    subject: 'piano', subject_label: 'Piano', duration: 8, section_count: 2}, true);
  assert.equal(piano.actId, 'piano');
  assert.equal(actionSummary(piano), 'Practice + challenge');
  const guitar = discoveryFromSummary({lesson_id: 'g', revision_id: 'r', title: 'Guitar',
    subject: 'guitar', subject_label: 'Guitar', duration: 8, section_count: 2}, true);
  // Guitar has no challenge even when the deployment flag is on.
  assert.equal(actionSummary(guitar), 'Practice');
  const body = discoveryFromSummary({lesson_id: 'b', revision_id: 'r', title: 'Move',
    subject: 'dance', subject_label: 'Dance', duration: 2, section_count: 2});
  assert.equal(body.actId, 'full_body');
});

test('dedupe and pre-pagination filters are stable', () => {
  const items = [
    item({lessonId: 'a', tags: ['kick'], title: 'Kick basics'}),
    item({lessonId: 'a', tags: ['kick'], title: 'Duplicate'}),
    item({lessonId: 'b', actId: 'piano', subjects: [{id: 'piano', label: 'Piano'}],
      tags: ['scale'], title: 'Scale'}),
    item({lessonId: 'c', tags: ['spin'], title: 'Spin'}),
  ];
  assert.deepEqual(dedupeById(items).map(value => value.lessonId), ['a', 'b', 'c']);
  assert.deepEqual(filterDiscovery(items, {tag: 'kick'}).map(value => value.lessonId), ['a', 'a']);
  assert.deepEqual(filterDiscovery(items, {act: 'piano'}).map(value => value.lessonId), ['b']);
  assert.deepEqual(filterDiscovery(items, {subject: 'piano'}).map(value => value.lessonId), ['b']);
  assert.deepEqual(filterDiscovery(items, {q: 'scale'}).map(value => value.lessonId), ['b']);
});

test('the social module imports no editor or assessment code', () => {
  const directory = new URL('../src/social/', import.meta.url);
  const files = readdirSync(directory).filter(name => /\.(ts|tsx)$/.test(name));
  assert.ok(files.length >= 2);
  for (const name of files) {
    const source = readFileSync(new URL(name, directory), 'utf8');
    for (const forbidden of ['editor/', 'music/workspace', 'PianoWorkspaceHarness',
      'MoveCheck', 'SectionEditor', 'music-feedback', 'verification', 'audio-assessment']) {
      assert.ok(!source.includes(forbidden), `${name} must not import ${forbidden}`);
    }
  }
  assert.equal(SOCIAL_POLICY, 'deterministic-social-v1');
});
