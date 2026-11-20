import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {actSupportFor} from '../src/acts/registry';
import {musicFeedBadge, practiceCta} from '../src/app/capability-labels';
import {resolveCapabilities} from '../../../packages/learning-engine/act-capabilities';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the guitar practice entry does not import the review editor', () => {
  const entry = source('../src/acts/music/PracticeEntry.tsx');
  assert.ok(entry.includes("from '../../music/workspace/PianoPracticeWorkspace'"));
  assert.ok(!/from ['"][^'"]*PianoWorkspaceHarness/.test(entry),
    'practice must not import the correction editor');
  assert.ok(!/from ['"][^'"]*(save-payload|verification)/.test(entry),
    'practice must not import editor save/verification code');
});

test('the Act dispatch boundary sends practice to the practice entry, not the harness', () => {
  const host = source('../src/LessonExperienceHost.tsx');
  assert.ok(!/from ['"][^'"]*PianoWorkspaceHarness/.test(host),
    'host must not import the editor bundle');
  assert.ok(host.includes("practiceEntryFor('piano')"),
    'host invokes the registry practice loader');
  assert.ok(host.includes('context={context}'), 'the loaded context is passed to the Act entry');
});

test('practice surfaces import no extracted editor controller or review panel', () => {
  const surfaces = [
    '../src/PracticeWorkspace.tsx',
    '../src/MimicInterface.tsx',
    '../src/music/workspace/PianoPracticeWorkspace.tsx',
  ];
  const editorOwners = [
    'PianoWorkspaceHarness', 'useMusicReviewLoad', 'useMusicReviewSave',
    'useMusicWorkspaceDocument', 'useMusicEditorSelection', 'useMusicAlignmentEditor',
    'useMusicVerificationController', 'useMusicEditorPlayback', 'MusicReviewHeader',
    'MusicNoteInspector', 'MusicVerificationPanel', 'MusicReviewSettings',
  ];
  for (const path of surfaces) {
    const text = source(path);
    for (const owner of editorOwners) {
      assert.ok(!new RegExp(`from ['"][^'"]*${owner}`).test(text),
        `${path} must not import the review editor owner ${owner}`);
    }
  }
});

test('the registry maps both instruments to the practice entry and keeps the editor separate', () => {
  const registry = source('../src/acts/registry.ts');
  assert.equal(
    (registry.match(/loadPractice: \(\) => import\('\.\/music\/PracticeEntry'\)/g) ?? []).length, 2);
  const review = source('../src/music/MusicReviewRoute.tsx');
  assert.ok(review.includes('PianoWorkspaceHarness'), 'review still owns the editor entry');
});

test('guitar capabilities and labels are accurate', () => {
  const support = actSupportFor('guitar');
  assert.ok(support);
  assert.ok(!support.practiceModes.includes('challenge'));
  const guitar = resolveCapabilities({
    act: support,
    assets: {playable: true, reviewed: true, publicRepresentation: false},
    creator: {feedbackEnabled: true},
    learner: {feedback: 'unset'},
    device: {availableInputs: ['midi', 'microphone']},
    audience: {canView: true, isOwner: true},
    deployment: {actEnabled: true, practiceEnabled: true, challengeEnabled: true},
  });
  assert.equal(musicFeedBadge({subject: 'guitar', challengeEnabled: true}), 'Practice');
  assert.equal(practiceCta(guitar).label, 'Practice');
  assert.equal(practiceCta(guitar).disabled, false);
  assert.equal(guitar.canChallenge.support, 'unsupported');

  assert.equal(musicFeedBadge({subject: 'piano', challengeEnabled: true}), 'Practice + challenge');
  assert.equal(musicFeedBadge({subject: 'piano', challengeEnabled: false}), 'Practice');
});

test('a lesson without a playable source is labelled watch-only, not practice', () => {
  const support = actSupportFor('full_body');
  assert.ok(support);
  const caps = resolveCapabilities({
    act: support,
    assets: {playable: false, reviewed: true, publicRepresentation: false},
    creator: {feedbackEnabled: true},
    learner: {feedback: 'unset'},
    device: {availableInputs: ['camera']},
    audience: {canView: true, isOwner: true},
    deployment: {actEnabled: true, practiceEnabled: true, challengeEnabled: true},
  });
  assert.deepEqual(practiceCta(caps), {
    label: 'Watch only', disabled: true, reason: 'This lesson has no playable source.',
  });
  assert.equal(practiceCta(null).label, 'Practice');
});

test('an unknown Act has no registry support and no fallback', () => {
  assert.equal(actSupportFor('violin'), null);
  assert.equal(actSupportFor(null), null);
});
