"""Subject catalogue: the single source of subject identifiers, labels and families.

The catalogue is deliberately server-owned. Clients receive labels from the API
instead of keeping a second table that can drift. `movement_other` stays the
compatibility identifier for every lesson created before subjects existed; it is
displayed as "Full Body Movement" and is never inferred into a specific movement
subject from a title, tag, filename or thumbnail.
"""
from dataclasses import dataclass
from typing import Literal

ExperienceFamily = Literal['body', 'music']
Instrument = Literal['piano', 'guitar']

# The literal set is part of the versioned contracts, so keep it in one place.
SubjectId = Literal['dance', 'taekwondo', 'boxing', 'piano', 'guitar', 'movement_other']


@dataclass(frozen=True)
class Subject:
    id: str
    label: str
    family: ExperienceFamily
    instrument: Instrument | None = None
    movement: bool = True


SUBJECTS: dict[str, Subject] = {
    'movement_other': Subject('movement_other', 'Full Body Movement', 'body'),
    'dance': Subject('dance', 'Dance', 'body'),
    'taekwondo': Subject('taekwondo', 'Taekwondo', 'body'),
    'boxing': Subject('boxing', 'Boxing', 'body'),
    'piano': Subject('piano', 'Piano', 'music', 'piano', movement=False),
    'guitar': Subject('guitar', 'Guitar', 'music', 'guitar', movement=False),
}

DEFAULT_SUBJECT = 'movement_other'
MOVEMENT_SUBJECTS = tuple(item for item, spec in SUBJECTS.items() if spec.movement)
MUSIC_SUBJECTS = tuple(item for item, spec in SUBJECTS.items() if not spec.movement)


class SubjectError(ValueError):
    """A selection the server refuses, with a message safe to show a person."""


def subject_spec(subject: str | None) -> Subject:
    if subject is None:
        return SUBJECTS[DEFAULT_SUBJECT]
    try:
        return SUBJECTS[subject]
    except KeyError:
        raise SubjectError('Choose one of the available lesson subjects.') from None


def label_for(subject: str | None) -> str:
    return subject_spec(subject).label


def family_for(subject: str | None) -> ExperienceFamily:
    return subject_spec(subject).family


def instrument_for(subject: str | None) -> Instrument | None:
    return subject_spec(subject).instrument


def is_music(subject: str | None) -> bool:
    return subject_spec(subject).family == 'music'


def default_subject_for(family: str) -> str:
    """The catalogue default used when a caller only knows the family."""
    if family == 'music':
        raise SubjectError('Choose piano or guitar, not music in general.')
    return DEFAULT_SUBJECT


def validate_selection(subject: str | None, instrument: str | None) -> tuple[str, ExperienceFamily, Instrument | None]:
    """Resolve a client selection into the canonical triple, or refuse it.

    An absent subject means the legacy movement default, which keeps old upload
    clients working without a subject field. A body selection cannot carry an
    instrument, and a music selection cannot omit or invent one.
    """
    spec = subject_spec(subject)
    if spec.family == 'body':
        if instrument:
            raise SubjectError('A movement lesson does not take an instrument.')
        return spec.id, 'body', None
    if instrument is None:
        return spec.id, 'music', spec.instrument
    if instrument != spec.instrument:
        raise SubjectError(f'{spec.label} lessons use {spec.instrument}.')
    return spec.id, 'music', spec.instrument


def catalogue() -> list[dict]:
    """Serialisable catalogue for capability and creation responses."""
    return [
        {
            'id': spec.id,
            'label': spec.label,
            'experience_family': spec.family,
            'instrument': spec.instrument,
            'movement': spec.movement,
        }
        for spec in SUBJECTS.values()
    ]
