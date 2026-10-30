"""The API is the source of truth for the versioned lesson contract."""
from enum import StrEnum
from math import isfinite
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Section(Contract):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    start: float = Field(ge=0)
    end: float = Field(gt=0)

class SectionSet(Contract):
    id: str
    revision: int = Field(ge=1)
    duration: float = Field(gt=0)
    sections: list[Section] = Field(min_length=1)

    @model_validator(mode='after')
    def contiguous(self):
        previous = 0.0
        ids = set()
        for section in self.sections:
            if section.id in ids or abs(section.start - previous) > 1e-6 or section.end - section.start < .05 - 1e-9:
                raise ValueError('Sections must have unique IDs and cover the animation without gaps or overlaps; minimum 0.05 seconds.')
            ids.add(section.id)
            previous = section.end
        if abs(previous - self.duration) > 1e-6:
            raise ValueError('Sections must end at the animation duration.')
        return self

class Asset(Contract):
    key: str = Field(pattern=r'^[a-zA-Z0-9][a-zA-Z0-9_./-]*$')
    mime: str
    bytes: int = Field(ge=0)
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')

    @model_validator(mode='after')
    def safe_key(self):
        if any(part in ('', '.', '..') for part in self.key.split('/')):
            raise ValueError('Asset must use a relative object key.')
        return self

class LessonManifest(Contract):
    schema_version: Literal[1] = 1
    lesson_id: str
    revision_id: str
    title: str
    duration: float = Field(gt=0)
    source_start: float = Field(ge=0)
    engine: Literal['sam-3d-body', 'mediapipe', 'synthetic']
    engine_version: str
    units: Literal['metres'] = 'metres'
    landmark_axes: Literal['x-right/y-down/z-forward'] = 'x-right/y-down/z-forward'
    root_motion: Literal['estimated-camera-relative', 'hip-relative', 'in-place']
    confidence: Literal['unmeasured', 'measured']
    standing_time: float = Field(ge=0)
    animation: Asset
    landmarks: Asset
    source_video: Asset | None = None
    thumbnail: Asset | None = None
    section_set: SectionSet
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def timeline(self):
        if self.standing_time > self.duration or abs(self.section_set.duration-self.duration) > 1e-6:
            raise ValueError('Reference and sections must use the animation timeline.')
        return self

class Discovery(StrEnum):
    PRIVATE = 'private'
    UNLISTED = 'unlisted'

class Access(StrEnum):
    OWNER = 'owner'
    INVITE = 'invite'
    LINK = 'link'

class JobState(StrEnum):
    UPLOADING = 'uploading'
    VALIDATING = 'validating'
    QUEUED = 'queued'
    PROCESSING = 'processing'
    EXPORTING = 'exporting'
    VERIFYING = 'verifying'
    READY = 'ready_for_review'
    FAILED = 'failed'
    CANCELLED = 'cancelled'

TRANSITIONS = {
    JobState.UPLOADING: {JobState.VALIDATING, JobState.CANCELLED},
    JobState.VALIDATING: {JobState.QUEUED, JobState.FAILED, JobState.CANCELLED},
    JobState.QUEUED: {JobState.PROCESSING, JobState.CANCELLED},
    JobState.PROCESSING: {JobState.EXPORTING, JobState.FAILED, JobState.CANCELLED},
    JobState.EXPORTING: {JobState.VERIFYING, JobState.FAILED, JobState.CANCELLED},
    JobState.VERIFYING: {JobState.READY, JobState.FAILED, JobState.CANCELLED},
}

def can_transition(current: JobState, target: JobState) -> bool:
    return target in TRANSITIONS.get(current, set())
