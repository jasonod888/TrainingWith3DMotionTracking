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
    animation_start: float = Field(default=0, ge=0)
    animation_duration: float | None = Field(default=None, gt=0)
    frame_rate: int = Field(default=15, ge=1, le=240)
    engine: Literal['sam-3d-body', 'mediapipe', 'synthetic']
    engine_version: str
    units: Literal['metres'] = 'metres'
    landmark_axes: Literal['x-right/y-down/z-forward'] = 'x-right/y-down/z-forward'
    root_motion: Literal['estimated-camera-relative', 'hip-relative', 'in-place', 'floor-guided']
    confidence: Literal['unmeasured', 'measured']
    standing_time: float = Field(ge=0)
    animation: Asset
    landmarks: Asset
    source_video: Asset | None = None
    focused_video: Asset | None = None
    focused_video_start: float | None = Field(default=None,ge=0)
    focused_video_alpha: Asset | None = None
    thumbnail: Asset | None = None
    section_set: SectionSet
    warnings: list[str] = Field(default_factory=list)
    presentation: dict[Literal['male','female','report'], Asset] = Field(default_factory=dict)

    @model_validator(mode='after')
    def timeline(self):
        if self.animation_duration is not None and self.animation_start + self.duration > self.animation_duration + 1e-6:
            raise ValueError('Trim must remain inside the original animation.')
        if self.focused_video and (not self.source_video or self.focused_video.mime != 'video/mp4'):
            raise ValueError('A focused instructor video needs its source video and MP4 encoding.')
        if self.focused_video_alpha and (not self.focused_video or self.focused_video_alpha.mime != 'video/webm'):
            raise ValueError('A transparent instructor video needs the focused video and WebM encoding.')
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


class InstrumentConfig(Contract):
    """Instrument settings that a music reference was generated against."""

    instrument: Literal['piano', 'guitar']
    tuning: str | None = Field(default=None, max_length=40)
    capo: int | None = Field(default=None, ge=0, le=12)
    handedness: Literal['right', 'left'] | None = None
    reference_pitch_hz: float | None = Field(default=None, gt=0)


class AssessmentPolicy(Contract):
    """Which evidence dimensions a reviewed music reference may be scored on."""

    rubric_version: str = Field(pattern=r'^[a-z0-9]+(-[a-z0-9]+)*-v[0-9]+$')
    assessment: Literal['notes', 'chords', 'melody', 'none'] = 'notes'
    input_modes: list[Literal['midi', 'microphone', 'none']] = Field(default_factory=lambda: ['none'])
    dimensions: list[Literal['pitch', 'timing', 'release', 'coverage']] = Field(
        default_factory=lambda: ['pitch', 'timing'])

    @model_validator(mode='after')
    def consistent(self):
        if self.assessment == 'none' and self.dimensions:
            raise ValueError('An unassessed reference cannot declare scoring dimensions.')
        if len(set(self.dimensions)) != len(self.dimensions):
            raise ValueError('Scoring dimensions must be unique.')
        if self.assessment != 'none' and 'pitch' not in self.dimensions:
            raise ValueError('Note or chord assessment requires the pitch dimension.')
        return self


class MusicLessonManifest(Contract):
    """Manifest v2 for a reviewed music reference.

    Deliberately separate from the body manifest: no coordinates, standing time,
    GLB animation or landmarks. The reference is already reviewed, so a draft can
    never be published as a manifest.
    """

    schema_version: Literal[2] = 2
    experience_family: Literal['music'] = 'music'
    lesson_id: str
    revision_id: str
    title: str = Field(min_length=1, max_length=200)
    subject: Literal['piano', 'guitar']
    duration: float = Field(gt=0)
    instrument: InstrumentConfig
    section_set: SectionSet
    reference: Asset
    reference_reviewed: Literal[True] = True
    assessment: AssessmentPolicy
    source_video: Asset | None = None
    preview_video: Asset | None = None
    waveform: Asset | None = None
    midi_export: Asset | None = None
    public_poster: Asset | None = None
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def music_timeline(self):
        if self.instrument.instrument != self.subject:
            raise ValueError('The instrument configuration must match the music subject.')
        if abs(self.section_set.duration - self.duration) > 1e-6:
            raise ValueError('Teaching sections must cover the whole lesson.')
        if self.reference.mime != 'application/json':
            raise ValueError('A music reference must be JSON.')
        for name in ('source_video', 'preview_video'):
            asset = getattr(self, name)
            if asset and asset.mime not in ('video/mp4', 'video/webm'):
                raise ValueError('Music video must be MP4 or WebM.')
        if self.waveform and self.waveform.mime != 'application/json':
            raise ValueError('Waveform data must be JSON.')
        if self.midi_export and self.midi_export.mime not in ('audio/midi', 'audio/mid', 'application/x-midi'):
            raise ValueError('A MIDI export must use a MIDI media type.')
        if self.public_poster and not self.public_poster.mime.startswith('image/'):
            raise ValueError('A public poster must be an image.')
        return self


class SummaryCapabilities(Contract):
    preview: bool = True
    practice: bool = True
    live_input: Literal['camera', 'midi', 'microphone', 'none'] = 'none'


class LessonSummary(Contract):
    """Card-sized projection: no body assets and no musical events."""

    summary_version: Literal[1] = 1
    lesson_id: str
    revision_id: str
    title: str
    subject: Literal['dance', 'taekwondo', 'boxing', 'piano', 'guitar', 'movement_other']
    subject_label: str
    experience_family: Literal['body', 'music']
    instrument: Literal['piano', 'guitar'] | None = None
    duration: float = Field(gt=0)
    section_count: int = Field(ge=1)
    poster: Asset | None = None
    capabilities: SummaryCapabilities = Field(default_factory=SummaryCapabilities)


# The only union in the product: a validated loading boundary, never a body
# component's contract. Each member is disjoint by version field and forbids extras.
LessonDocument = LessonManifest | MusicLessonManifest | LessonSummary


class MusicEvent(Contract):
    """One proposed note attack in a draft reference. Never a reviewed requirement."""
    id: str = Field(min_length=1, max_length=80)
    onset: float = Field(ge=0)
    duration: float | None = Field(default=None, gt=0)
    pitch: int = Field(ge=0, le=127)
    velocity: float | None = Field(default=None, ge=0, le=1)
    confidence: float | None = Field(default=None, ge=0, le=1)
    optional: bool = False


class MusicSpan(Contract):
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode='after')
    def ordered(self):
        if self.end <= self.start:
            raise ValueError('A draft span must end after it starts.')
        return self


class DraftProvenance(Contract):
    adapter: str = Field(min_length=1, max_length=80)
    engine: str = Field(min_length=1, max_length=80)
    model: str | None = Field(default=None, max_length=120)
    model_version: str | None = Field(default=None, max_length=80)
    code_version: str = Field(min_length=1, max_length=80)
    audio_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')


class MusicDraftDocument(Contract):
    """An unreviewed transcription proposal. It is not a publishable manifest."""
    draft_version: Literal[1] = 1
    subject: Literal['piano', 'guitar']
    instrument: InstrumentConfig
    duration: float = Field(gt=0)
    reference: Asset
    events: list[MusicEvent] = Field(default_factory=list, max_length=20000)
    spans: list[MusicSpan] = Field(default_factory=list, max_length=500)
    provenance: DraftProvenance
    warnings: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def bounded(self):
        if self.instrument.instrument != self.subject:
            raise ValueError('The draft instrument must match its subject.')
        if self.reference.mime != 'application/json':
            raise ValueError('A draft reference must be JSON.')
        for span in self.spans:
            if span.end > self.duration + 1e-6:
                raise ValueError('A draft span must stay inside the clip.')
        for event in self.events:
            if event.onset > self.duration + 1e-6:
                raise ValueError('A draft event must stay inside the clip.')
        return self
