import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const SOCIAL_SURFACES = [
  '../src/social/discovery.ts',
  '../src/social/LikeButton.tsx',
  '../src/PracticeFeed.tsx',
  '../src/FeedCard.tsx',
  '../src/Public.tsx',
  '../src/Studio.tsx',
];

const FORBIDDEN_IN_SOCIAL = [
  'editor/', 'PianoWorkspaceHarness', 'PianoWorkspaceHarness.tsx',
  'MoveCheck', 'SectionEditor', 'pose-capture', 'MimicInterface',
  'usePracticeRecording', 'prepareClip', 'prepareAudioClip',
  'useUploadAssessment', 'music-feedback',
];

test('ordinary social browsing imports no editor, capture or assessment module', () => {
  for (const path of SOCIAL_SURFACES) {
    const text = source(path);
    for (const forbidden of FORBIDDEN_IN_SOCIAL) {
      assert.ok(!text.includes(forbidden), `${path} must not import ${forbidden}`);
    }
  }
});

test('the social module stays independent of specialized Act code', () => {
  for (const path of ['../src/social/discovery.ts', '../src/social/LikeButton.tsx']) {
    const text = source(path);
    for (const forbidden of ['music/workspace', 'music/MusicLessonHome', 'editor/',
      'apps/api', 'PracticeWorkspace', 'PianoPracticeWorkspace']) {
      assert.ok(!text.includes(forbidden), `${path} must not import ${forbidden}`);
    }
  }
});

test('PracticeEntry keeps the practice seam and never imports the review editor', () => {
  const entry = source('../src/acts/music/PracticeEntry.tsx');
  assert.ok(entry.includes("from '../../music/workspace/PianoPracticeWorkspace'"));
  // Comments may name the harness; only real import/export/require statements count.
  assert.ok(!/from ['"][^'"]*PianoWorkspaceHarness/.test(entry),
    'PracticeEntry must not import PianoWorkspaceHarness');
  for (const forbidden of ['editor/', 'MoveCheck', 'SectionEditor',
    'verification', 'save-payload']) {
    assert.ok(!entry.includes(forbidden), `PracticeEntry must not import ${forbidden}`);
  }
});

test('the Act dispatch boundary does not statically import the review harness', () => {
  const host = source('../src/LessonExperienceHost.tsx');
  assert.ok(!/from ['"][^'"]*PianoWorkspaceHarness/.test(host));
  assert.ok(host.includes("practiceEntryFor('piano')"));
  assert.ok(source('../src/acts/registry.ts').includes("import('./music/PracticeEntry')"));
});
