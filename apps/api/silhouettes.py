"""Versioned silhouette contract.

A silhouette is generated from the exact normalized ``preview.mp4`` bytes that
the conversion worker also passes to SAM 3D.  It is keyed by
``(conversion_id, preview_sha256)``; the generation itself never mints a motion
revision.  A generation becomes reachable from a lesson only after conversion
finalization has created the immutable revision and verified that its recorded
preview hash equals the hash this generation was produced from.

Generation status and owner review are separate.  ``ready`` means the archive
verified and every referenced chunk is readable; it never means the owner
accepted the result.  Review is an independent ``pending | accepted |
rejected`` value.  ``needs_selection`` is the only blocking state, because a
track cannot be initialised without knowing which person is the subject.

Mask master semantics (schema 1): one canonical PNG per decoded frame,
8-bit greyscale, no colour or alpha, background 0 and foreground 255, on a
fixed canvas with the source aspect ratio.  Frames are indexed by their
position in the decoded preview, not by a nominal frame rate.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import struct
import zipfile
import zlib
from datetime import datetime, timezone
from enum import StrEnum
from math import isfinite
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = 1
PROCESSING_VERSION = 'silhouette-v1'

# Bounds are contract limits, not tuning knobs: changing them changes the schema.
CANVAS_LONG_SIDE = 512
MAX_CANVAS_LONG_SIDE = 2048
MAX_SOURCE_LONG_SIDE = 4096
MAX_FRAMES = 12000
CHUNK_SECONDS = 10.0
MAX_CHUNKS = 400
MAX_CHUNK_BYTES = 32 * 1024 * 1024
MAX_TOTAL_MASK_BYTES = 1024 * 1024 * 1024
MAX_CHUNK_UNCOMPRESSED = 256 * 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024

MASK_ENCODING = 'png-gray8-0-255'
FRAME_NAME = re.compile(r'^(\d{6})\.png$')
HEX64 = re.compile(r'^[a-f0-9]{64}$')
HEX24 = re.compile(r'^[a-f0-9]{24}$')
IDENT = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$')

PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


class ArchiveError(ValueError):
    """A mask archive failed structural verification."""


class ContractError(ValueError):
    """A manifest violates the silhouette contract."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class SilhouetteState(StrEnum):
    QUEUED = 'queued'
    PROCESSING = 'processing'
    NEEDS_SELECTION = 'needs_selection'
    READY = 'ready'
    FAILED = 'failed'
    CANCELLED = 'cancelled'


class ReviewStatus(StrEnum):
    PENDING = 'pending'
    ACCEPTED = 'accepted'
    REJECTED = 'rejected'


class FailureCategory(StrEnum):
    INVALID_SOURCE = 'invalid_source'
    SOURCE_EXPIRED = 'source_expired'
    SEGMENTATION_FAILED = 'segmentation_failed'
    VERIFICATION_FAILED = 'verification_failed'
    WORKER_INTERRUPTED = 'worker_interrupted'
    CANCELLED = 'cancelled'


# A finished generation is never re-opened for processing; a retry is a new
# generation with its own id, so no transition leaves READY except deletion.
SILHOUETTE_TRANSITIONS: dict[SilhouetteState, set[SilhouetteState]] = {
    SilhouetteState.QUEUED: {SilhouetteState.PROCESSING, SilhouetteState.NEEDS_SELECTION,
                             SilhouetteState.CANCELLED, SilhouetteState.FAILED},
    SilhouetteState.PROCESSING: {SilhouetteState.NEEDS_SELECTION, SilhouetteState.READY,
                                 SilhouetteState.FAILED, SilhouetteState.CANCELLED},
    SilhouetteState.NEEDS_SELECTION: {SilhouetteState.QUEUED, SilhouetteState.PROCESSING,
                                      SilhouetteState.FAILED, SilhouetteState.CANCELLED},
    SilhouetteState.READY: {SilhouetteState.CANCELLED},
    SilhouetteState.FAILED: {SilhouetteState.QUEUED, SilhouetteState.CANCELLED},
    SilhouetteState.CANCELLED: set(),
}

REVIEW_TRANSITIONS: dict[ReviewStatus, set[ReviewStatus]] = {
    ReviewStatus.PENDING: {ReviewStatus.ACCEPTED, ReviewStatus.REJECTED},
    ReviewStatus.ACCEPTED: {ReviewStatus.REJECTED},
    ReviewStatus.REJECTED: {ReviewStatus.ACCEPTED},
}


def can_transition(current: SilhouetteState, target: SilhouetteState) -> bool:
    return target in SILHOUETTE_TRANSITIONS.get(current, set())


def can_review(current: ReviewStatus, target: ReviewStatus) -> bool:
    return target in REVIEW_TRANSITIONS.get(current, set())


def generation_prefix(conversion_id: str, generation_id: str) -> str:
    """Attempt-specific private prefix.  A retry writes under a new generation."""
    if not IDENT.match(conversion_id) or not HEX24.match(generation_id):
        raise ContractError('Invalid conversion or generation identity.')
    return f'silhouettes/{conversion_id}/{generation_id}/'


def chunk_key(conversion_id: str, generation_id: str, index: int) -> str:
    if not 0 <= index < MAX_CHUNKS:
        raise ContractError('Chunk index outside the contract range.')
    return f'{generation_prefix(conversion_id, generation_id)}masks-{index:05d}.zip'


def manifest_key(conversion_id: str, generation_id: str) -> str:
    return f'{generation_prefix(conversion_id, generation_id)}silhouette.json'


def preview_key(conversion_id: str, generation_id: str) -> str:
    return f'{generation_prefix(conversion_id, generation_id)}silhouette-preview.mp4'


def frame_name(index: int) -> str:
    if not 0 <= index < 10_000_000:
        raise ContractError('Frame index outside the contract range.')
    return f'{index:06d}.png'


class MaskTransform(Contract):
    """Source pixel rectangle -> fixed canvas, expressed as scale and centring offset.

    A source mask pixel ``(x, y)`` maps to canvas ``(x * scale + offset_x,
    y * scale + offset_y)``.  ``canvas_width - 2 * offset_x`` equals
    ``width * scale`` within half a pixel, so vertical letterboxing is explicit
    rather than implied.  Resampling is nearest-neighbour so no foreground value
    other than 0 or 255 can be introduced.
    """

    canvas_width: int = Field(gt=0, le=MAX_CANVAS_LONG_SIDE)
    canvas_height: int = Field(gt=0, le=MAX_CANVAS_LONG_SIDE)
    scale: float = Field(gt=0, le=8)
    offset_x: float = Field(ge=0, lt=4)
    offset_y: float = Field(ge=0, lt=4)
    interpolation: Literal['nearest'] = 'nearest'
    encoding: Literal['png-gray8-0-255'] = MASK_ENCODING

    def to_canvas(self, x: float, y: float) -> tuple[float, float]:
        return x * self.scale + self.offset_x, y * self.scale + self.offset_y

    def contains_source(self, width: int, height: int) -> bool:
        if not (0 < width <= MAX_SOURCE_LONG_SIDE and 0 < height <= MAX_SOURCE_LONG_SIDE):
            return False
        tolerance = 0.51
        return (abs(self.canvas_width - 2 * self.offset_x - width * self.scale) <= tolerance
                and abs(self.canvas_height - 2 * self.offset_y - height * self.scale) <= tolerance)


def build_transform(width: int, height: int, long_side: int = CANVAS_LONG_SIDE) -> MaskTransform:
    """Fit ``width`` x ``height`` into a fixed canvas, letterboxing the short axis."""
    if not (0 < width <= MAX_SOURCE_LONG_SIDE and 0 < height <= MAX_SOURCE_LONG_SIDE):
        raise ContractError('Source dimensions are outside the contract range.')
    if not (16 <= long_side <= MAX_CANVAS_LONG_SIDE):
        raise ContractError('Mask canvas is outside the contract range.')
    if width >= height:
        canvas_width, canvas_height = long_side, max(1, round(long_side * height / width))
    else:
        canvas_width, canvas_height = max(1, round(long_side * width / height)), long_side
    scale = min(canvas_width / width, canvas_height / height)
    return MaskTransform(canvas_width=canvas_width, canvas_height=canvas_height, scale=scale,
                         offset_x=(canvas_width - width * scale) / 2,
                         offset_y=(canvas_height - height * scale) / 2)


class SourceClip(Contract):
    """The exact normalized preview bytes, never a re-encode."""

    conversion_id: str = Field(pattern=r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$')
    preview_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    preview_bytes: int = Field(gt=0, le=2 * 1024**3)
    width: int = Field(gt=0, le=MAX_SOURCE_LONG_SIDE)
    height: int = Field(gt=0, le=MAX_SOURCE_LONG_SIDE)
    rotation: Literal[0, 90, 180, 270] = 0
    mirrored: bool = False
    decoded_frames: int = Field(gt=0, le=MAX_FRAMES)
    nominal_fps: float = Field(gt=0, le=240, default=15.0)

    @model_validator(mode='after')
    def upright(self):
        if self.rotation not in (0, 90, 180, 270):
            raise ValueError('Rotation must be a right angle.')
        return self


class DetectorEvidence(Contract):
    """A selection *candidate*, never proof of identity.

    Recorded so a reviewer can see which detector box produced a track: the
    detector identity and checkpoint, its score, the frame and timestamp it was
    measured at, and the coordinate transform applied to reach source pixels.
    """

    name: str = Field(min_length=1, max_length=80)
    checkpoint_sha256: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    score: float = Field(ge=0, le=1)
    frame_index: int = Field(ge=0)
    timestamp: float = Field(ge=0)
    box: list[float] = Field(min_length=4, max_length=4)
    transform: str = Field(min_length=1, max_length=120)
    accepted: bool = False

    @model_validator(mode='after')
    def usable_box(self):
        x1, y1, x2, y2 = self.box
        if not all(isfinite(v) for v in self.box) or not (x1 < x2 and y1 < y2):
            raise ValueError('Detector box must be a nonempty rectangle.')
        return self


class Selection(Contract):
    """How the subject was chosen before tracking starts."""

    source: Literal['owner', 'detector', 'sam3d-detector']
    frame_index: int = Field(ge=0)
    timestamp: float = Field(ge=0)
    box: list[float] = Field(min_length=4, max_length=4)
    positive_points: list[tuple[float, float]] = Field(default_factory=list)
    negative_points: list[tuple[float, float]] = Field(default_factory=list)
    detector: DetectorEvidence | None = None

    @model_validator(mode='after')
    def consistent_evidence(self):
        x1, y1, x2, y2 = self.box
        if not all(isfinite(v) for v in self.box) or not (x1 < x2 and y1 < y2):
            raise ValueError('Selection box must be a nonempty rectangle.')
        if self.source in ('detector', 'sam3d-detector') and self.detector is None:
            raise ValueError('A detector selection must record its detector evidence.')
        if self.detector is not None and self.detector.frame_index != self.frame_index:
            raise ValueError('Detector evidence must come from the selection frame.')
        return self


class ModelRef(Contract):
    family: Literal['sam2', 'mediapipe']
    name: str = Field(min_length=1, max_length=80)
    checkpoint_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    processing_version: str = Field(default=PROCESSING_VERSION, pattern=r'^[a-z0-9][a-z0-9.-]{0,39}$')
    # Flat, JSON-safe settings only: thresholds, prompts, chunking, offload flags.
    settings: dict[str, bool | int | float | str] = Field(default_factory=dict)

    @model_validator(mode='after')
    def flat_settings(self):
        if any(not isinstance(v, (bool, int, float, str)) for v in self.settings.values()):
            raise ValueError('Model settings must be flat and JSON-safe.')
        if len(self.settings) > 40:
            raise ValueError('Too many model settings for a versioned record.')
        return self


class Timeline(Contract):
    """Decoded presentation times, one entry per decoded frame.

    ``coverage_end`` is the end of the last frame's display interval and is
    therefore later than the last timestamp.  ``duration`` in the motion
    manifest uses the last timestamp, so masks and animation must be joined by
    timestamps, not by duration.
    """

    timestamps: list[float] = Field(min_length=1)
    final_frame_duration: float = Field(gt=0, le=2)

    @model_validator(mode='after')
    def monotonic(self):
        if len(self.timestamps) > MAX_FRAMES:
            raise ValueError('Frame count exceeds the contract limit.')
        previous = None
        for value in self.timestamps:
            if not isfinite(value) or value < 0:
                raise ValueError('Timestamps must be finite and nonnegative.')
            if previous is not None and value <= previous:
                raise ValueError('Timestamps must be strictly increasing.')
            previous = value
        return self

    @property
    def frame_count(self) -> int:
        return len(self.timestamps)

    @property
    def coverage_start(self) -> float:
        return self.timestamps[0]

    @property
    def coverage_end(self) -> float:
        return self.timestamps[-1] + self.final_frame_duration

    def time_of(self, index: int) -> float:
        if not 0 <= index < self.frame_count:
            raise IndexError(index)
        return self.timestamps[index]


class Chunk(Contract):
    index: int = Field(ge=0, lt=MAX_CHUNKS)
    first_frame: int = Field(ge=0, lt=MAX_FRAMES)
    frame_count: int = Field(gt=0, le=MAX_FRAMES)
    entries: int = Field(gt=0, le=MAX_FRAMES)
    key: str = Field(pattern=r'^[a-zA-Z0-9][a-zA-Z0-9_./-]*$')
    bytes: int = Field(gt=0, le=MAX_CHUNK_BYTES)
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')

    @model_validator(mode='after')
    def entries_match(self):
        if self.entries != self.frame_count:
            raise ValueError('Archive entry count must equal the declared frame count.')
        if any(part in ('', '.', '..') for part in self.key.split('/')):
            raise ValueError('Chunk key must be a relative object key.')
        return self


class QualityFlags(Contract):
    absent_frames: list[int] = Field(default_factory=list)
    uncertain_frames: list[int] = Field(default_factory=list)
    identity_switch_suspected: bool = False
    subject_count_observed: int | None = Field(default=None, ge=0, le=64)
    chunk_seam_iou: list[float] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)

    @model_validator(mode='after')
    def ordered(self):
        for values, name in ((self.absent_frames, 'absent'), (self.uncertain_frames, 'uncertain')):
            if values != sorted(set(values)):
                raise ValueError(f'{name.capitalize()} frames must be sorted and unique.')
            if any(v < 0 for v in values):
                raise ValueError(f'{name.capitalize()} frames cannot be negative.')
        if any(not 0 <= v <= 1 for v in self.chunk_seam_iou):
            raise ValueError('Chunk seam IoU must be a fraction.')
        return self


class Review(Contract):
    status: ReviewStatus = ReviewStatus.PENDING
    decided_at: datetime | None = None
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode='after')
    def decided(self):
        if self.status is not ReviewStatus.PENDING and self.decided_at is None:
            raise ValueError('A decided review must record when it was decided.')
        return self


class Binding(Contract):
    """The immutable motion revision this generation was attached to."""

    lesson_id: str = Field(min_length=1, max_length=80)
    revision_id: str = Field(min_length=1, max_length=80)
    preview_sha256_verified: bool
    bound_at: datetime

    @model_validator(mode='after')
    def verified(self):
        if not self.preview_sha256_verified:
            raise ValueError('A binding requires a verified preview hash.')
        return self


class SilhouetteManifest(Contract):
    schema_version: Literal[1] = SCHEMA_VERSION
    generation_id: str = Field(pattern=r'^[a-f0-9]{24}$')
    attempt: int = Field(ge=1, le=20)
    source: SourceClip
    model: ModelRef
    selection: Selection
    transform: MaskTransform
    timeline: Timeline
    chunks: list[Chunk] = Field(min_length=1)
    quality: QualityFlags = Field(default_factory=QualityFlags)
    review: Review = Field(default_factory=Review)
    binding: Binding | None = None
    created_at: datetime = Field(default_factory=_utcnow)

    @model_validator(mode='after')
    def coherent(self):
        frames = self.timeline.frame_count
        if frames != self.source.decoded_frames:
            raise ValueError('Decoded frame count and timeline length must agree.')
        if self.selection.frame_index >= frames:
            raise ValueError('Selection frame is outside the decoded timeline.')
        if not self.transform.contains_source(self.source.width, self.source.height):
            raise ValueError('Mask transform does not match the source dimensions.')
        if abs(self.selection.timestamp - self.timeline.timestamps[self.selection.frame_index]) > 1e-3:
            raise ValueError('Selection timestamp must be the selection frame time.')
        x1, y1, x2, y2 = self.selection.box
        if not (0 <= x1 < x2 <= self.source.width and 0 <= y1 < y2 <= self.source.height):
            raise ValueError('Selection box must lie inside the source frame.')
        expected = 0
        total_bytes = 0
        for position, chunk in enumerate(self.chunks):
            if chunk.index != position:
                raise ValueError('Chunks must be ordered and densely indexed.')
            if chunk.first_frame != expected:
                raise ValueError('Chunks must cover every decoded frame without gaps or overlap.')
            if not chunk.key.startswith(generation_prefix(self.source.conversion_id, self.generation_id)):
                raise ValueError('Chunk key is outside this generation.')
            expected += chunk.frame_count
            total_bytes += chunk.bytes
        if expected != frames:
            raise ValueError('Chunks do not cover the whole decoded timeline.')
        if total_bytes > MAX_TOTAL_MASK_BYTES:
            raise ValueError('Mask storage exceeds the contract limit.')
        if len(self.chunks) > 1 and len(self.quality.chunk_seam_iou) not in (0, len(self.chunks) - 1):
            raise ValueError('Chunk seam records must match the chunk boundaries.')
        for values in (self.quality.absent_frames, self.quality.uncertain_frames):
            if values and values[-1] >= frames:
                raise ValueError('Quality flags reference a frame outside the timeline.')
        return self

    @property
    def frame_count(self) -> int:
        return self.timeline.frame_count

    @property
    def byte_size(self) -> int:
        return sum(chunk.bytes for chunk in self.chunks)

    def chunk_for_frame(self, index: int) -> Chunk:
        if not 0 <= index < self.frame_count:
            raise IndexError(index)
        for chunk in self.chunks:
            if chunk.first_frame <= index < chunk.first_frame + chunk.frame_count:
                return chunk
        raise IndexError(index)  # pragma: no cover - coherence prevents this

    def dedupe_key(self) -> str:
        """Duplicate suppression: same source bytes, prompt, model and settings."""
        material = {
            'source': self.source.preview_sha256,
            'conversion': self.source.conversion_id,
            'selection': self.selection.model_dump(mode='json'),
            'model': self.model.model_dump(mode='json'),
            'transform': self.transform.model_dump(mode='json'),
        }
        canonical = json.dumps(material, sort_keys=True, separators=(',', ':')).encode()
        return hashlib.sha256(canonical).hexdigest()

    def bind(self, lesson_id: str, revision_id: str, preview_sha256: str,
             when: datetime | None = None) -> 'SilhouetteManifest':
        """Attach to an immutable revision after the conversion verified the preview hash."""
        if preview_sha256 != self.source.preview_sha256:
            raise ContractError('The revision preview hash does not match this generation.')
        if self.binding is not None:
            if (self.binding.lesson_id, self.binding.revision_id) != (lesson_id, revision_id):
                raise ContractError('This generation is already bound to a different revision.')
            return self
        return self.model_copy(update={'binding': Binding(
            lesson_id=lesson_id, revision_id=revision_id,
            preview_sha256_verified=True, bound_at=when or _utcnow())})

    @property
    def requires_review(self) -> bool:
        """A generation that needs an owner decision before it is used for anything.

        Publication is not blocked: the owner must be able to retrieve the asset
        to review it.  Consumers that show or compare silhouettes must check this
        together with ``review.status``.
        """
        return (self.review.status is ReviewStatus.PENDING
                and (self.quality.identity_switch_suspected or bool(self.quality.uncertain_frames)))

    def assert_publishable(self, preview_sha256: str) -> None:
        if self.binding is None:
            raise ContractError('A silhouette is published only after binding to a revision.')
        if self.source.preview_sha256 != preview_sha256:
            raise ContractError('The bound revision was produced from different preview bytes.')

    def to_json(self) -> str:
        return json.dumps(self.model_dump(mode='json'), separators=(',', ':'))

    @classmethod
    def from_json(cls, data: str | bytes) -> 'SilhouetteManifest':
        if len(data) > MAX_MANIFEST_BYTES:
            raise ContractError('Manifest exceeds the contract size limit.')
        try:
            return cls.model_validate_json(data)
        except ValueError as exc:
            raise ContractError(f'Invalid silhouette manifest: {exc}') from exc


# --- canonical mask PNG -----------------------------------------------------


def _png_chunk(tag: bytes, payload: bytes) -> bytes:
    return (struct.pack('>I', len(payload)) + tag + payload
            + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))


def encode_mask_png(width: int, height: int, pixels: bytes) -> bytes:
    """Encode a binary mask as a canonical 8-bit greyscale PNG.

    Only 0 and 255 are accepted, so downstream consumers never have to guess
    whether an intermediate value is alpha, antialiasing or a model score.
    """
    if not (0 < width <= MAX_CANVAS_LONG_SIDE and 0 < height <= MAX_CANVAS_LONG_SIDE):
        raise ContractError('Mask dimensions are outside the contract range.')
    if len(pixels) != width * height:
        raise ContractError('Mask pixel buffer does not match its dimensions.')
    if any(value not in (0, 255) for value in set(pixels)):
        raise ContractError('Mask values must be exactly 0 or 255.')
    rows = b''.join(b'\x00' + pixels[y * width:(y + 1) * width] for y in range(height))
    header = struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0)
    return (PNG_SIGNATURE + _png_chunk(b'IHDR', header)
            + _png_chunk(b'IDAT', zlib.compress(rows, 9)) + _png_chunk(b'IEND', b''))


def decode_mask_png(data: bytes, max_pixels: int | None = None) -> tuple[int, int, bytes]:
    """Strict decoder for the canonical form; rejects anything else.

    Accepting a general PNG would mean trusting size declarations and filter
    types chosen by an untrusted archive entry, so the verifier accepts only
    what the exporter writes: signature, one IHDR, one IDAT, IEND, filter 0,
    no interlace, greyscale 8-bit, values 0/255.
    """
    limit = max_pixels if max_pixels is not None else MAX_CANVAS_LONG_SIDE ** 2
    if len(data) < len(PNG_SIGNATURE) + 25 or not data.startswith(PNG_SIGNATURE):
        raise ArchiveError('Not a canonical mask PNG.')
    position = len(PNG_SIGNATURE)
    header = None
    compressed = None
    while position + 12 <= len(data):
        length = struct.unpack('>I', data[position:position + 4])[0]
        tag = data[position + 4:position + 8]
        if length > len(data) or position + 12 + length > len(data):
            raise ArchiveError('PNG chunk length exceeds the file.')
        payload = data[position + 8:position + 8 + length]
        crc = struct.unpack('>I', data[position + 8 + length:position + 12 + length])[0]
        if crc != zlib.crc32(tag + payload) & 0xFFFFFFFF:
            raise ArchiveError('PNG chunk checksum mismatch.')
        position += 12 + length
        if tag == b'IHDR':
            if header is not None or position - length - 12 != len(PNG_SIGNATURE):
                raise ArchiveError('IHDR must appear exactly once, first.')
            if len(payload) != 13:
                raise ArchiveError('Invalid IHDR length.')
            header = struct.unpack('>IIBBBBB', payload)
        elif tag == b'IDAT':
            if header is None or compressed is not None:
                raise ArchiveError('IDAT must follow IHDR and appear once.')
            compressed = payload
        elif tag == b'IEND':
            if length or compressed is None or position != len(data):
                raise ArchiveError('IEND must be empty and last.')
            break
        else:
            raise ArchiveError('Unexpected PNG chunk for a canonical mask.')
    else:
        raise ArchiveError('PNG is truncated or missing IEND.')
    if header is None or compressed is None:
        raise ArchiveError('PNG is missing required chunks.')
    width, height, depth, colour, compression, filter_method, interlace = header
    if depth != 8 or colour != 0 or compression != 0 or filter_method != 0 or interlace != 0:
        raise ArchiveError('Mask PNG must be non-interlaced 8-bit greyscale.')
    if not (0 < width <= MAX_CANVAS_LONG_SIDE and 0 < height <= MAX_CANVAS_LONG_SIDE):
        raise ArchiveError('Mask dimensions are outside the contract range.')
    if width * height > limit:
        raise ArchiveError('Mask pixel count exceeds the verification bound.')
    expected = height * (width + 1)
    try:
        engine = zlib.decompressobj()
        rows = engine.decompress(compressed, expected + 1)
    except zlib.error as exc:
        raise ArchiveError('Mask PNG data is not a valid deflate stream.') from exc
    if len(rows) != expected or engine.unconsumed_tail or engine.unused_data or not engine.eof:
        raise ArchiveError('Mask PNG row data has the wrong size.')
    pixels = bytearray(height * width)
    for y in range(height):
        start = y * (width + 1)
        if rows[start] != 0:
            raise ArchiveError('Mask PNG must use filter 0.')
        line = rows[start + 1:start + 1 + width]
        if any(value not in (0, 255) for value in set(line)):
            raise ArchiveError('Mask PNG contains values other than 0 and 255.')
        pixels[y * width:(y + 1) * width] = line
    return width, height, bytes(pixels)


# --- chunk archives ---------------------------------------------------------


def write_chunk_archive(path, frames, width: int, height: int) -> tuple[int, bytes]:
    """Write PNG entries with ``ZIP_STORED``; returns ``(bytes, sha256)``.

    ``frames`` is an iterable of ``(global_frame_index, pixel_bytes)`` and must
    already be ordered.  PNG data is already compressed, so deflating it again
    only spends CPU.
    """
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, 'w', compression=zipfile.ZIP_STORED) as archive:
        for index, pixels in frames:
            archive.writestr(frame_name(index), encode_mask_png(width, height, pixels))
    blob = payload.getvalue()
    with open(path, 'wb') as handle:
        handle.write(blob)
    return len(blob), hashlib.sha256(blob).hexdigest()


def verify_chunk_archive(blob: bytes | bytearray | memoryview, chunk: Chunk,
                         transform: MaskTransform) -> int:
    """Validate a chunk against its declaration and the canvas; returns frame count.

    The archive is treated as untrusted: entry names must be exactly the frame
    names implied by ``first_frame``, no entry may be a directory, decompressed
    sizes are bounded before reading, and each PNG is decoded by the strict
    canonical decoder rather than a general-purpose image reader.
    """
    data = bytes(blob)
    if len(data) > MAX_CHUNK_BYTES:
        raise ArchiveError('Chunk archive exceeds the contract size limit.')
    if len(data) != chunk.bytes:
        raise ArchiveError('Chunk byte size does not match its declaration.')
    if hashlib.sha256(data).hexdigest() != chunk.sha256:
        raise ArchiveError('Chunk checksum does not match its declaration.')
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ArchiveError('Chunk is not a readable zip archive.') from exc
    with archive:
        infos = archive.infolist()
        if len(infos) != chunk.entries:
            raise ArchiveError('Chunk entry count does not match its declaration.')
        total = 0
        seen = set()
        for offset, info in enumerate(infos):
            if info.is_dir() or info.filename in seen:
                raise ArchiveError('Chunk contains a directory or duplicate entry.')
            seen.add(info.filename)
            match = FRAME_NAME.match(info.filename)
            expected = chunk.first_frame + offset
            if not match or int(match.group(1)) != expected:
                raise ArchiveError('Chunk entries must be named by their decoded frame index.')
            if info.file_size > transform.canvas_width * transform.canvas_height + 4096:
                raise ArchiveError('Chunk entry declares an impossible size.')
            total += info.file_size
            if total > MAX_CHUNK_UNCOMPRESSED:
                raise ArchiveError('Chunk decompressed size exceeds the contract limit.')
            try:
                pixels = archive.read(info.filename)
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
                raise ArchiveError('Chunk entry could not be read safely.') from exc
            width, height, values = decode_mask_png(pixels,
                                                    max_pixels=transform.canvas_width * transform.canvas_height)
            if (width, height) != (transform.canvas_width, transform.canvas_height):
                raise ArchiveError('Mask dimensions do not match the canvas.')
            del values
        return len(infos)


def chunk_manifest(index: int, first_frame: int, frame_count: int, blob: bytes,
                   conversion_id: str, generation_id: str) -> Chunk:
    """Build a verified-shape chunk record from exact archive bytes."""
    return Chunk(index=index, first_frame=first_frame, frame_count=frame_count,
                 entries=frame_count, key=chunk_key(conversion_id, generation_id, index),
                 bytes=len(blob), sha256=hashlib.sha256(blob).hexdigest())
