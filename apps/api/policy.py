"""Pure Act policy resolution.

Facts in, decisions out. No session and no per-item query: detail, summaries,
discovery and editor readiness share this module, and publication remains the
owner of role eligibility.
"""
from dataclasses import dataclass

from . import acts, publication


@dataclass(frozen=True)
class Capability:
    support: str
    available: bool
    reason_code: str
    explanation: str

    def as_dict(self) -> dict:
        return {'support': self.support, 'available': self.available,
                'reasonCode': self.reason_code, 'explanation': self.explanation}


def _cap(support='supported', available=True, reason='available', explanation='Available.'):
    return Capability(support, available, reason, explanation)


def _reviewed(manifest) -> bool:
    return manifest.get('schema_version') != 2 or bool(manifest.get('reference_reviewed'))


def _has_pose_reference(descriptor, manifest, roles=None, public=False) -> bool:
    """Playable *interactive* content, not merely a watchable video."""
    if descriptor.experience_family == 'music':
        return bool(manifest.get('reference'))
    if descriptor.experience_family == 'visual':
        return bool(manifest.get('steps'))
    if public:
        # A public video projection is watch-only unless an approved interactive
        # role was actually published.
        return 'interactive_data' in set(roles or ()) and bool(manifest.get('animation'))
    return bool(manifest.get('animation') or manifest.get('landmarks'))


def action_set(descriptor, manifest, *, roles=None, public=False,
               music_challenge_enabled=True) -> dict:
    """Shared watch/practice/challenge decision for detail, cards and discovery."""
    manifest = manifest or {}
    reviewed = _reviewed(manifest)
    pose = _has_pose_reference(descriptor, manifest, roles, public)
    practice = 'practice' in descriptor.practice_modes and pose
    challenge = ('challenge' in descriptor.practice_modes and pose and reviewed
                 and bool(descriptor.assessment_adapters)
                 and manifest.get('feedback_enabled') is not False)
    if descriptor.experience_family == 'music' and not music_challenge_enabled:
        challenge = False
    return {'watch': True, 'practice': practice, 'challenge': challenge}


def capabilities(descriptor, manifest, *, owner, reasons=(), settings=None,
                 roles=None, public=False) -> dict[str, Capability]:
    """Server capability ceilings. Device/learner restrictions are client-side."""
    manifest = manifest or {}
    reviewed = _reviewed(manifest)
    feedback = manifest.get('feedback_enabled') is not False
    pose = _has_pose_reference(descriptor, manifest, roles, public)
    action = action_set(descriptor, manifest, roles=roles, public=public,
                        music_challenge_enabled=bool(getattr(settings, 'music_challenge_enabled', False)))
    owner_view = owner or 'owner' in reasons

    can_edit = _cap(explanation='You can edit this lesson.') if owner_view else \
        _cap('supported', False, 'not_owner', 'Only the owner can edit this lesson.')

    if 'practice' not in descriptor.practice_modes:
        can_practice = _cap('unsupported', False, 'act_unsupported', 'This Act has no practice mode.')
    elif not pose:
        can_practice = _cap('unavailable', False, 'missing_source',
                            'This lesson has no approved playable reference.')
    else:
        can_practice = _cap(explanation='Practice is available.')

    if 'challenge' not in descriptor.practice_modes:
        can_challenge = _cap('unsupported', False, 'act_unsupported', 'This Act has no challenge mode.')
    elif descriptor.experience_family == 'music' and not getattr(settings, 'music_challenge_enabled', False):
        can_challenge = _cap('unavailable', False, 'deployment_disabled',
                             'Challenge is disabled on this deployment.')
    elif not reviewed:
        can_challenge = _cap('unavailable', False, 'not_reviewed',
                             'Review the reference before starting a challenge.')
    elif not feedback:
        can_challenge = _cap('unavailable', False, 'creator_disabled',
                             'The creator turned assessment feedback off for this lesson.')
    elif not pose:
        can_challenge = _cap('unavailable', False, 'watch_only',
                             'A challenge needs an approved pose reference.')
    else:
        can_challenge = _cap(explanation='Challenge is available.')

    if not descriptor.assessment_adapters:
        can_assess = _cap('unsupported', False, 'act_unsupported',
                          'This Act has no assessment adapter.')
    elif not pose:
        can_assess = _cap('unsupported', False, 'no_assessment_adapter',
                          'This video-only release has no approved pose reference.')
    elif not reviewed:
        can_assess = _cap('unavailable', False, 'not_reviewed',
                          'Assessment needs a reviewed reference.')
    elif not feedback:
        can_assess = _cap('supported', False, 'creator_disabled',
                          'The creator turned assessment feedback off for this lesson.')
    else:
        can_assess = _cap(explanation='Assessment is available.')

    capture = set(descriptor.practice_inputs) & {'camera', 'uploaded_recording'}
    can_record = _cap(explanation='Recording is available.') if capture else \
        _cap('unsupported', False, 'act_unsupported', 'This Act records no learner evidence.')

    policy = acts.publication_policy(descriptor.id)
    available_roles = publication.role_assets(manifest, policy.allowed_roles)
    if not (policy.public and descriptor.publication_representations):
        can_publish = _cap('unsupported', False, 'act_not_public',
                           policy.private_reason or 'This Act has no approved public representation.')
    elif not available_roles:
        can_publish = _cap('unavailable', False, 'missing_public_representation',
                           'Add an approved public representation before listing this lesson.')
    else:
        can_publish = _cap(explanation='This revision can be published publicly.')

    inputs = {name: _cap(explanation='Declared by the Act; device readiness is checked by the client.')
              for name in descriptor.practice_inputs}
    return {'canEdit': can_edit, 'canReview': can_edit,
            'canPractice': can_practice, 'canChallenge': can_challenge,
            'canAssess': can_assess, 'canRecord': can_record,
            'canPublishPublicly': can_publish, 'inputs': inputs,
            'actions': action}
