"""The API is the source of truth for the versioned lesson contract."""
from enum import StrEnum
from math import isfinite
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .acts import ActId

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
    # Finite fractional rates are required: a normalised 29.97 fps clip must be
    # described exactly, because trim and marker sampling divide by this value.
    # Integer SAM/synthetic manifests keep working (they coerce to a float).
    frame_rate: float = Field(default=15, ge=1, le=240, allow_inf_nan=False)
    engine: Literal['sam-3d-body', 'mediapipe', 'synthetic']
    engine_version: str
    units: Literal['metres'] = 'metres'
    landmark_axes: Literal['x-right/y-down/z-forward'] = 'x-right/y-down/z-forward'
    root_motion: Literal['estimated-camera-relative', 'hip-relative', 'in-place', 'floor-guided']
    confidence: Literal['unmeasured', 'measured']
    standing_time: float = Field(ge=0)
    # Nullable because the MediaPipe route is video-only. The engine-specific rule
    # below keeps a 3D lesson from losing its animation, so this is never a way to
    # publish a half-specified movement.
    animation: Asset | None = None
    landmarks: Asset
    source_video: Asset | None = None
    focused_video: Asset | None = None
    focused_video_start: float | None = Field(default=None,ge=0)
    focused_video_alpha: Asset | None = None
    thumbnail: Asset | None = None
    section_set: SectionSet
    warnings: list[str] = Field(default_factory=list)
    presentation: dict[Literal['male','female','report'], Asset] = Field(default_factory=dict)
    # Optional so legacy revisions keep their prior availability. New writes persist
    # an explicit boolean; None must never be treated as an explicit choice.
    feedback_enabled: bool | None = Field(default=None, strict=True)

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
        # Engine-specific completeness. A 3D lesson without its GLB, or a video-only
        # lesson without the clip the person actually watches, is not a lesson.
        if self.engine in ('sam-3d-body', 'synthetic') and self.animation is None:
            raise ValueError('A 3D lesson needs its animation.')
        if self.engine == 'mediapipe' and self.source_video is None:
            raise ValueError('A video-only lesson needs its source video.')
        if self.animation is not None and self.animation.mime != 'model/gltf-binary':
            raise ValueError('A 3D lesson animation must be a GLB.')
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


class MusicPedalEvent(Contract):
    """Sustain span predicted by the model; not written notation or audible-ending truth."""
    onset: float = Field(ge=0)
    offset: float = Field(gt=0)
    type: Literal['sustain'] = 'sustain'


class MusicPlaybackSettings(Contract):
    """Versioned lesson playback settings; a missing object means zero offset."""
    sync_offset_seconds: float = Field(default=0.0, ge=-10.0, le=10.0, allow_inf_nan=False)
    revision: int = Field(default=1, ge=1)


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
    piano_preview: Asset | None = None
    waveform: Asset | None = None
    midi_export: Asset | None = None
    public_poster: Asset | None = None
    playback: MusicPlaybackSettings | None = None
    pedal: list[MusicPedalEvent] = Field(default_factory=list, max_length=2000)
    preview_identity: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    warnings: list[str] = Field(default_factory=list)
    # Lesson-level availability, separate from the note rubric. Missing means legacy.
    feedback_enabled: bool | None = Field(default=None, strict=True)

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
        if self.piano_preview and self.piano_preview.mime != 'audio/wav':
            raise ValueError('A piano preview must be a WAV asset.')
        for span in self.pedal:
            if span.offset <= span.onset or span.offset > self.duration + 1e-6:
                raise ValueError('A pedal span must stay inside the clip.')
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


class DrawingStep(Contract):
    """One ordered drawing instruction. Visual only: no pose or note fields."""

    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    instruction: str = Field(min_length=1, max_length=1000)
    reference_guide: Asset | None = None
    media_role: Literal['reference_guide', 'example', 'detail'] | None = None


class DrawingLessonManifest(Contract):
    """Discriminated drawing document (`schema_version` 3, family `visual`).

    Deliberately carries no body animation/landmarks and no music reference/events.
    Assessment is explicitly `none`: practice is unassessed and never scored.
    """

    schema_version: Literal[3] = 3
    experience_family: Literal['visual'] = 'visual'
    lesson_id: str
    revision_id: str
    title: str
    subject: Literal['drawing'] = 'drawing'
    medium: Literal['pencil', 'charcoal', 'digital']
    steps: list[DrawingStep] = Field(min_length=1, max_length=200)
    assessment: Literal['none'] = 'none'
    reference_guide: Asset | None = None
    poster: Asset | None = None
    warnings: list[str] = Field(default_factory=list)
    feedback_enabled: bool | None = Field(default=None, strict=True)

    @model_validator(mode='after')
    def ordered_unique_steps(self):
        ids = [step.id for step in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError('Drawing step ids must be unique.')
        return self


class LessonSummary(Contract):
    """Card-sized projection: no body assets and no musical events."""

    summary_version: Literal[1] = 1
    lesson_id: str
    revision_id: str
    title: str
    subject: Literal['dance', 'taekwondo', 'boxing', 'piano', 'guitar', 'drawing', 'movement_other']
    subject_label: str
    experience_family: Literal['body', 'music', 'visual']
    instrument: Literal['piano', 'guitar'] | None = None
    duration: float = Field(gt=0)
    section_count: int = Field(ge=1)
    poster: Asset | None = None
    capabilities: SummaryCapabilities = Field(default_factory=SummaryCapabilities)


class CapabilityResult(Contract):
    """One resolved capability with a stable reason.

    ``support`` describes what the Act can ever do. ``available`` describes this
    lesson, audience, policy, choice and device right now. A learner switching a
    feature off is therefore ``supported`` but not ``available`` with reason
    ``learner_off`` — never the same as an unsupported or missing capability.
    """

    support: Literal['supported', 'unsupported', 'unavailable']
    available: bool
    reasonCode: str
    explanation: str


class EffectiveCapabilities(Contract):
    """Server-resolved capabilities. No capability is inferred from schema_version."""

    canEdit: CapabilityResult
    canReview: CapabilityResult
    canPractice: CapabilityResult
    canChallenge: CapabilityResult
    canAssess: CapabilityResult
    canRecord: CapabilityResult
    canPublishPublicly: CapabilityResult
    # A set of declared/available evidence inputs, not one exclusive live_input.
    inputs: dict[Literal['camera', 'midi', 'microphone', 'uploaded_recording', 'pointer_stylus'],
                 CapabilityResult] = Field(default_factory=dict)


class ActRef(Contract):
    """The Act identity carried by a negotiated envelope."""

    id: ActId
    label: str
    descriptor_version: int = Field(ge=1)


class SummaryCapabilitiesV2(Contract):
    """Card capabilities plus the full input set.

    ``live_input`` is retained so a v2 card can reuse v1 presentation, while
    ``inputs`` lists every declared input instead of forcing one exclusive value.
    """

    preview: bool = True
    practice: bool = True
    live_input: Literal['camera', 'midi', 'microphone', 'none'] = 'none'
    inputs: list[Literal['camera', 'midi', 'microphone', 'uploaded_recording', 'pointer_stylus']] = Field(
        default_factory=list)


class LessonSummaryV2(Contract):
    """Negotiated card contract. Only served when the caller advertises Act v1."""

    summary_version: Literal[2] = 2
    lesson_id: str
    revision_id: str
    title: str
    subject: Literal['dance', 'taekwondo', 'boxing', 'piano', 'guitar', 'drawing', 'movement_other']
    subject_label: str
    experience_family: Literal['body', 'music', 'visual']
    instrument: Literal['piano', 'guitar'] | None = None
    duration: float = Field(gt=0)
    section_count: int = Field(ge=1)
    poster: Asset | None = None
    capabilities: SummaryCapabilitiesV2 = Field(default_factory=SummaryCapabilitiesV2)
    act_id: ActId
    act: ActRef
    effective_capabilities: EffectiveCapabilities


class LessonContext(Contract):
    """Outer detail envelope. ``document`` stays the unmodified specialized payload."""

    context_version: Literal[1] = 1
    act_id: ActId
    act: ActRef
    # Why this reader can see the lesson. Coarse by design: 'invited' covers a
    # direct invite grant and 'link' a share-link grant.
    audience: Literal['owner', 'invited', 'link', 'group', 'public'] = 'invited'
    capabilities: EffectiveCapabilities
    document: dict


# The only union in the product: a validated loading boundary, never a body
# component's contract. Each member is disjoint by version field and forbids extras.
LessonDocument = LessonManifest | MusicLessonManifest | LessonSummary


class MusicEvent(Contract):
    """One proposed note attack in a draft reference. Never a reviewed requirement."""
    id: str = Field(min_length=1, max_length=80)
    onset: float = Field(ge=0)
    duration: float | None = Field(default=None, gt=0)
    # Written value is independent of audible decay and pedal-extended sound.
    notation_duration: float | None = Field(default=None, gt=0)
    pitch: int = Field(ge=0, le=127)
    velocity: float | None = Field(default=None, ge=0, le=1)
    confidence: float | None = Field(default=None, ge=0, le=1)
    optional: bool = False
    string: int | None = Field(default=None, ge=1, le=6)
    fret: int | None = Field(default=None, ge=0, le=24)

    @model_validator(mode='after')
    def positioned(self):
        if (self.string is None) != (self.fret is None):
            raise ValueError('A reviewed position needs both string and fret.')
        if self.string is not None:
            open_pitch = {1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}[self.string]
            if open_pitch + self.fret != self.pitch:
                raise ValueError('The reviewed position does not match the note pitch and standard tuning.')
        return self


class GuitarChord(Contract):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=40)
    start: float = Field(ge=0)
    frets: list[int] = Field(min_length=6, max_length=6)
    position: int = Field(default=1, ge=1, le=24)

    @model_validator(mode='after')
    def playable(self):
        if any(fret < -1 or fret > 24 for fret in self.frets):
            raise ValueError('Chord frets must be muted (-1), open (0) or 1-24.')
        if all(fret < 0 for fret in self.frets):
            raise ValueError('A chord needs at least one sounding string.')
        if any(fret > 0 and not (self.position <= fret <= self.position + 3) for fret in self.frets):
            raise ValueError('Chord frets must fit the four-fret window at the base position.')
        return self


class MusicSpan(Contract):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    kind: Literal['playing', 'explanation'] = 'playing'

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
    profile_sha256: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')


class MusicDraftDocument(Contract):
    """An unreviewed transcription proposal. It is not a publishable manifest."""
    draft_version: Literal[1] = 1
    subject: Literal['piano', 'guitar']
    instrument: InstrumentConfig
    duration: float = Field(gt=0)
    reference: Asset
    source_video: Asset | None = None
    piano_preview: Asset | None = None
    playback: MusicPlaybackSettings | None = None
    pedal: list[MusicPedalEvent] = Field(default_factory=list, max_length=2000)
    preview_identity: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    events: list[MusicEvent] = Field(default_factory=list, max_length=20000)
    spans: list[MusicSpan] = Field(default_factory=list, max_length=500)
    guitar_chords: list[GuitarChord] = Field(default_factory=list, max_length=100)
    analysis: Asset | None = None
    provenance: DraftProvenance
    warnings: list[str] = Field(default_factory=list, max_length=100)
    feedback_enabled: bool | None = Field(default=None, strict=True)

    @model_validator(mode='after')
    def bounded(self):
        if self.instrument.instrument != self.subject:
            raise ValueError('The draft instrument must match its subject.')
        if self.reference.mime != 'application/json':
            raise ValueError('A draft reference must be JSON.')
        if self.source_video and self.source_video.mime not in ('video/mp4','video/webm'):
            raise ValueError('A draft source must be a supported video.')
        if self.piano_preview and self.piano_preview.mime != 'audio/wav':
            raise ValueError('A piano preview must be a WAV asset.')
        for span in self.pedal:
            if span.offset <= span.onset or span.offset > self.duration + 1e-6:
                raise ValueError('A pedal span must stay inside the clip.')
        if len({event.id for event in self.events}) != len(self.events):
            raise ValueError('Draft event ids must be unique.')
        ordered = sorted(self.spans, key=lambda span: span.start)
        for previous, current in zip(ordered, ordered[1:]):
            if current.start < previous.end - 1e-6:
                raise ValueError('Draft passages must not overlap.')
        for span in self.spans:
            if span.end > self.duration + 1e-6:
                raise ValueError('A draft span must stay inside the clip.')
        for event in self.events:
            if event.onset > self.duration + 1e-6 or event.onset+(event.duration or 0)>self.duration+1e-6:
                raise ValueError('A draft event must stay inside the clip.')
        return self
