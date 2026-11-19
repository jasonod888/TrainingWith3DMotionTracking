import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedRoles, availableRoles, defaultRoles, readiness, readinessMessage, rolesSummary,
  type PublicationView,
} from '../src/sharing/publication-readiness';

const SAM: PublicationView = {
  actId: 'full_body', hasAnimation: true, hasPreviewVideo: false, hasReference: false,
  accepted: true,
};
const VIDEO_ONLY: PublicationView = {
  actId: 'full_body', hasAnimation: false, hasPreviewVideo: true, hasReference: false,
  accepted: true,
};
const PIANO: PublicationView = {
  actId: 'piano', hasAnimation: false, hasPreviewVideo: false, hasReference: true,
  accepted: true,
};
const GUITAR: PublicationView = {...PIANO, actId: 'guitar'};

test('full-body SAM keeps its approved 3D default', () => {
  assert.deepEqual(defaultRoles(SAM), ['interactive_data']);
  const state = readiness({view: SAM, audience: 'public', rightsAcknowledged: true});
  assert.equal(state.enabled, true);
  assert.deepEqual(state.roles, ['interactive_data']);
  assert.equal(state.reason, '');
});

test('a video-only movement needs an approved preview, not a silent fallback', () => {
  assert.deepEqual(defaultRoles(VIDEO_ONLY), []);
  const blocked = readiness({view: {...VIDEO_ONLY, hasPreviewVideo: false}, audience: 'public',
    rightsAcknowledged: true});
  assert.equal(blocked.enabled, false);
  assert.match(blocked.reason, /approved public representation/i);

  const missingPreview = readiness({view: {...VIDEO_ONLY, hasPreviewVideo: false}, audience: 'public',
    roles: ['playable_preview'], rightsAcknowledged: true});
  assert.equal(missingPreview.enabled, false);
  assert.match(missingPreview.reason, /video only|approved public representation/i);

  const ready = readiness({view: VIDEO_ONLY, audience: 'public',
    roles: ['playable_preview'], rightsAcknowledged: true});
  assert.equal(ready.enabled, true);
  assert.deepEqual(ready.roles, ['playable_preview']);
});

test('piano and guitar must choose a representation explicitly', () => {
  for (const view of [PIANO, GUITAR]) {
    assert.deepEqual(defaultRoles(view), []);
    const noChoice = readiness({view, audience: 'public', rightsAcknowledged: true});
    assert.equal(noChoice.enabled, false);
    assert.match(noChoice.reason, /Choose what people will see/);

    const reference = readiness({view, audience: 'public', roles: ['reference'],
      rightsAcknowledged: true});
    assert.equal(reference.enabled, true);
    assert.deepEqual(reference.roles, ['reference']);

    const preview = readiness({view: {...view, hasPreviewVideo: true}, audience: 'public',
      roles: ['playable_preview'], rightsAcknowledged: true});
    assert.equal(preview.enabled, true);
  }
  assert.deepEqual(allowedRoles(PIANO), ['poster', 'playable_preview', 'reference']);
  assert.ok(!allowedRoles(GUITAR).includes('interactive_data'));
  assert.deepEqual(availableRoles(PIANO), ['reference']);
});

test('rights are required for public release and not for private audiences', () => {
  const noRights = readiness({view: SAM, audience: 'public', rightsAcknowledged: false});
  assert.equal(noRights.enabled, false);
  assert.match(noRights.reason, /right/i);

  for (const audience of ['invited', 'link', 'group'] as const) {
    const state = readiness({view: SAM, audience, rightsAcknowledged: false});
    assert.equal(state.enabled, true, audience);
    assert.equal(state.reason, '');
  }
});

test('an unaccepted revision is not publishable to any audience', () => {
  for (const audience of ['invited', 'link', 'group', 'public'] as const) {
    const state = readiness({view: {...SAM, accepted: false}, audience,
      rightsAcknowledged: true});
    assert.equal(state.enabled, false, audience);
    assert.equal(state.reason, 'Check this revision before publishing it.');
  }
});

test('readiness messages are Act-specific and actionable', () => {
  assert.match(readinessMessage('full_body', ['missing_asset:playable_preview']), /video only/i);
  assert.match(readinessMessage('piano', ['missing_asset:playable_preview']), /preview video/i);
  assert.equal(readinessMessage('guitar', ['rights_not_acknowledged']),
    'Confirm you have the right to share this lesson publicly.');
  assert.match(readinessMessage('piano', ['missing_public_representation']),
    /Choose what people will see/);
  assert.equal(rolesSummary(['reference', 'playable_preview']),
    'reviewed score/notation + video preview');
});
