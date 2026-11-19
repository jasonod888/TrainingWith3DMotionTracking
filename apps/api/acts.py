"""Server-owned Act catalogue: identity, descriptors and publication policy.

An Act is the product experience (``full_body``, ``piano``, ``guitar``). It is
deliberately separate from:

* ``subject`` — the search/browse classification (dance, taekwondo, piano, ...);
* ``experience_family`` — the legacy body/music implementation hint;
* ``instrument`` — the instrument a music reference was generated for;
* ``schema_version`` — the stored manifest format.

The mapping below is explicit and deterministic. Nothing here infers an Act from
a title, tag, filename, thumbnail, GLB presence, worker availability or schema
version. An unknown subject or Act raises ``unsupported_act``; it never falls
back to ``full_body``.

Descriptors are frozen, data-only and versioned. The server never returns an
executable module path: the frontend keeps its own static registry.
"""
from dataclasses import dataclass
from typing import Literal

ActId = Literal['full_body', 'piano', 'guitar', 'drawing']
ACT_IDS: tuple[ActId, ...] = ('full_body', 'piano', 'guitar', 'drawing')

# Bump only with a negotiated contract change. Readers that do not understand the
# version must receive an explicit unsupported response, never another Act.
ACT_DESCRIPTOR_VERSION = 1

CreationInput = Literal['video', 'audio', 'image']
PracticeInput = Literal['camera', 'midi', 'microphone', 'uploaded_recording', 'pointer_stylus']
PracticeMode = Literal['watch', 'practice', 'challenge']
PublicationRepresentation = Literal['interactive_3d', 'video', 'audio', 'interactive_notation', 'poster']

PRACTICE_INPUTS: tuple[PracticeInput, ...] = (
    'camera', 'midi', 'microphone', 'uploaded_recording', 'pointer_stylus')
PRACTICE_MODES: tuple[PracticeMode, ...] = ('watch', 'practice', 'challenge')
PUBLICATION_REPRESENTATIONS: tuple[PublicationRepresentation, ...] = (
    'interactive_3d', 'video', 'audio', 'interactive_notation', 'poster')


class ActError(ValueError):
    """Base class for a refused Act request. ``code`` is safe for API responses."""

    code = 'unsupported_act'


class UnsupportedAct(ActError):
    """The subject or Act id is not one this deployment knows."""


class UnsupportedActVersion(ActError):
    """The caller asked for a descriptor version this server does not serve."""


@dataclass(frozen=True)
class PublicationPolicy:
    """Act-level publication eligibility.

    ``allowed_roles`` is the explicit public representation allowlist. A release
    names the roles it exposes; the projection never falls back to private media.
    """

    public: bool
    representations: tuple[PublicationRepresentation, ...]
    requires_animation: bool
    private_reason: str = ''
    allowed_roles: tuple[str, ...] = ()
    default_roles: tuple[str, ...] = ()


@dataclass(frozen=True)
class ActDescriptor:
    """A frozen, data-only description of one product experience.

    ``processing_routes`` lists route ids, not models or providers. A route can be
    added or retired without changing an Act's identity, and an offline worker
    never changes what an existing lesson can play or accept as input.
    """

    id: ActId
    label: str
    # Legacy implementation family this Act uses. Recorded so a reader can explain
    # the current document format without deriving the Act from it.
    experience_family: Literal['body', 'music', 'visual']
    subjects: tuple[str, ...]
    creation_inputs: tuple[CreationInput, ...]
    processing_routes: tuple[str, ...]
    editor_capabilities: tuple[str, ...]
    review_capabilities: tuple[str, ...]
    practice_inputs: tuple[PracticeInput, ...]
    practice_modes: tuple[PracticeMode, ...]
    assessment_adapters: tuple[str, ...]
    publication_representations: tuple[PublicationRepresentation, ...]
    description: str

    def as_public(self) -> dict:
        """Serialisable descriptor. Keys are stable within a descriptor version."""
        return {
            'id': self.id,
            'label': self.label,
            'descriptor_version': ACT_DESCRIPTOR_VERSION,
            'experience_family': self.experience_family,
            'subjects': list(self.subjects),
            'creation_inputs': list(self.creation_inputs),
            'processing_routes': list(self.processing_routes),
            'editor_capabilities': list(self.editor_capabilities),
            'review_capabilities': list(self.review_capabilities),
            'practice_inputs': list(self.practice_inputs),
            'practice_modes': list(self.practice_modes),
            'assessment_adapters': list(self.assessment_adapters),
            'publication_representations': list(self.publication_representations),
            'description': self.description,
        }


DESCRIPTORS: dict[str, ActDescriptor] = {
    'full_body': ActDescriptor(
        id='full_body',
        label='Full Body',
        experience_family='body',
        subjects=('dance', 'taekwondo', 'boxing', 'movement_other'),
        creation_inputs=('video',),
        processing_routes=('body-default', 'body-mediapipe'),
        editor_capabilities=('trim', 'sections', 'feedback-policy', 'warnings'),
        review_capabilities=('movement-check', 'section-edits'),
        practice_inputs=('camera', 'microphone'),
        practice_modes=('watch', 'practice', 'challenge'),
        assessment_adapters=('pose-v1',),
        publication_representations=('interactive_3d', 'video'),
        description='Movement lesson with a 3D reference or a video-only MediaPipe reference.',
    ),
    'piano': ActDescriptor(
        id='piano',
        label='Piano',
        experience_family='music',
        subjects=('piano',),
        creation_inputs=('video', 'audio'),
        processing_routes=('music-piano', 'music-piano-kong'),
        editor_capabilities=('notes', 'hands', 'notation', 'alignment', 'velocity', 'pedal',
                             'sections', 'feedback-policy'),
        review_capabilities=('reference-review',),
        practice_inputs=('midi', 'microphone', 'uploaded_recording'),
        practice_modes=('watch', 'practice', 'challenge'),
        assessment_adapters=('piano-midi-v1',),
        publication_representations=('video', 'audio', 'interactive_notation', 'poster'),
        description='Reviewed piano reference with local note feedback and an optional challenge.',
    ),
    'guitar': ActDescriptor(
        id='guitar',
        label='Guitar',
        experience_family='music',
        subjects=('guitar',),
        creation_inputs=('video', 'audio'),
        processing_routes=('music-guitar',),
        editor_capabilities=('notes', 'positions', 'tab', 'chords', 'tuning', 'capo',
                             'sections', 'feedback-policy'),
        review_capabilities=('reference-review',),
        practice_inputs=('midi', 'microphone'),
        practice_modes=('watch', 'practice'),
        assessment_adapters=('guitar-notes-v1',),
        publication_representations=('video', 'audio', 'interactive_notation', 'poster'),
        description='Reviewed guitar reference with TAB, chord shapes and unscored practice.',
    ),
    'drawing': ActDescriptor(
        id='drawing',
        label='Drawing',
        experience_family='visual',
        subjects=('drawing',),
        creation_inputs=('image', 'video'),
        # No AI processing route: drawing authoring is explicit ordered steps.
        processing_routes=(),
        editor_capabilities=('steps', 'instructions', 'reference-guide'),
        review_capabilities=('step-review',),
        # Pointer/stylus drives step navigation; no camera, MIDI or microphone.
        practice_inputs=('pointer_stylus',),
        practice_modes=('watch', 'practice'),
        # Explicitly unassessed: no score is produced or fabricated.
        assessment_adapters=(),
        publication_representations=('interactive_notation', 'poster'),
        description='Ordered drawing steps with unassessed, step-by-step practice.',
    ),
}

SUBJECT_TO_ACT: dict[str, ActId] = {
    'dance': 'full_body',
    'taekwondo': 'full_body',
    'boxing': 'full_body',
    'movement_other': 'full_body',
    'piano': 'piano',
    'guitar': 'guitar',
    'drawing': 'drawing',
}

PUBLICATION_POLICIES: dict[str, PublicationPolicy] = {
    # 3D movement has a legacy public representation (the GLB); a video-only
    # movement may publish only an explicitly selected prepared preview.
    'full_body': PublicationPolicy(public=True, representations=('interactive_3d', 'video'),
                                   requires_animation=False,
                                   allowed_roles=('playable_preview', 'interactive_data'),
                                   default_roles=('interactive_data',)),
    # Music publishes only an explicitly chosen approved representation; the
    # reviewed reference is not automatically public.
    'piano': PublicationPolicy(public=True,
                               representations=('video', 'audio', 'interactive_notation', 'poster'),
                               requires_animation=False,
                               allowed_roles=('poster', 'playable_preview', 'reference')),
    'guitar': PublicationPolicy(public=True,
                                representations=('video', 'audio', 'interactive_notation', 'poster'),
                                requires_animation=False,
                                allowed_roles=('poster', 'playable_preview', 'reference')),
    # Drawing publishes its ordered steps as the interactive reference, and/or a
    # designed poster. The private source guide is never a public role.
    'drawing': PublicationPolicy(public=True,
                                 representations=('interactive_notation', 'poster'),
                                 requires_animation=False,
                                 allowed_roles=('poster', 'reference')),
}


def require_version(version: int | None) -> int:
    """Refuse a descriptor version this server cannot serve.

    ``None`` means the caller did not negotiate and receives the current version.
    """
    if version is None:
        return ACT_DESCRIPTOR_VERSION
    if version != ACT_DESCRIPTOR_VERSION:
        raise UnsupportedActVersion(
            f'Act descriptor version {version} is not supported; '
            f'this server serves version {ACT_DESCRIPTOR_VERSION}.')
    return version


def descriptor_for(act_id: str | None) -> ActDescriptor:
    """Resolve an Act id, or raise ``unsupported_act``. Never defaults."""
    if not act_id or act_id not in DESCRIPTORS:
        raise UnsupportedAct(f'Unknown Act {act_id!r}.')
    return DESCRIPTORS[act_id]


def act_for_subject(subject: str | None) -> ActDescriptor:
    """Deterministic subject -> Act mapping. Never infers from content."""
    act_id = SUBJECT_TO_ACT.get(subject or '')
    if act_id is None:
        raise UnsupportedAct(f'Subject {subject!r} has no supported Act.')
    return DESCRIPTORS[act_id]


def resolve_act(act_id: str | None, subject: str | None) -> ActDescriptor:
    """Resolve a stored lesson's Act.

    A persisted ``act_id`` wins. Otherwise the deterministic compatibility adapter
    maps the stored subject. Missing or unknown identity is refused rather than
    guessed, so a legacy row can never silently become ``full_body``.
    """
    if act_id:
        return descriptor_for(act_id)
    if subject:
        return act_for_subject(subject)
    raise UnsupportedAct('This lesson does not declare a supported Act.')


def publication_policy(act_id: str | None) -> PublicationPolicy:
    descriptor = descriptor_for(act_id)
    try:
        return PUBLICATION_POLICIES[descriptor.id]
    except KeyError:  # pragma: no cover - descriptor and policy tables must agree
        raise UnsupportedAct(f'Act {descriptor.id!r} has no publication policy.') from None


def catalogue() -> list[dict]:
    """Every active Act descriptor, in stable id order."""
    return [DESCRIPTORS[act_id].as_public() for act_id in ACT_IDS]


def supports(act_id: str | None, capability: str) -> bool:
    """Whether the Act declares a capability, without consulting deployment state."""
    try:
        descriptor = descriptor_for(act_id)
    except ActError:
        return False
    if capability == 'challenge':
        return 'challenge' in descriptor.practice_modes
    if capability == 'assessment':
        return bool(descriptor.assessment_adapters)
    return True
