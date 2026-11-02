import io
import json
import zipfile
import zlib

import pytest

from apps.api.silhouettes import (
    ArchiveError,
    Binding,
    Chunk,
    ContractError,
    MAX_CANVAS_LONG_SIDE,
    QualityFlags,
    Review,
    ReviewStatus,
    Selection,
    SilhouetteManifest,
    SilhouetteState,
    SourceClip,
    MaskTransform,
    Timeline,
    build_transform,
    can_review,
    can_transition,
    chunk_manifest,
    decode_mask_png,
    encode_mask_png,
    generation_prefix,
    verify_chunk_archive,
    write_chunk_archive,
    _png_chunk,
)

CONVERSION = 'conv-1'
GENERATION = 'a' * 24
PREVIEW_HASH = 'b' * 64
CHECKPOINT = 'c' * 64


def mask(width=32, height=24, on=True):
    value = 255 if on else 0
    return bytes([value]) * (width * height)


def manifest(**overrides):
    transform = build_transform(64, 48, 32)
    timestamps = [round(i / 15, 6) for i in range(6)]
    blobs = [b'a' * 100, b'b' * 60]
    chunks = [chunk_manifest(0, 0, 4, blobs[0], CONVERSION, GENERATION),
              chunk_manifest(1, 4, 2, blobs[1], CONVERSION, GENERATION)]
    values = dict(
        generation_id=GENERATION,
        attempt=1,
        source=SourceClip(conversion_id=CONVERSION, preview_sha256=PREVIEW_HASH,
                          preview_bytes=2048, width=64, height=48, decoded_frames=6),
        model={'family': 'sam2', 'name': 'sam2.1-hiera-small', 'checkpoint_sha256': CHECKPOINT,
               'settings': {'threshold': 0.0, 'chunk_seconds': 10}},
        selection=Selection(source='owner', frame_index=0, timestamp=timestamps[0],
                            box=[2.0, 2.0, 40.0, 44.0], positive_points=[(10.0, 10.0)]),
        transform=transform,
        timeline=Timeline(timestamps=timestamps, final_frame_duration=1 / 15),
        chunks=chunks,
    )
    values.update(overrides)
    return SilhouetteManifest(**values)


def test_transform_letterboxes_a_wide_source():
    transform = build_transform(1920, 1080, 512)
    assert (transform.canvas_width, transform.canvas_height) == (512, 288)
    assert transform.offset_x == pytest.approx(0, abs=1e-9)
    assert transform.offset_y == pytest.approx(0, abs=1e-9)
    assert transform.contains_source(1920, 1080)
    x, y = transform.to_canvas(960, 540)
    assert (x, y) == pytest.approx((256, 144))


def test_transform_letterboxes_a_tall_source():
    transform = build_transform(1080, 1920, 512)
    assert (transform.canvas_width, transform.canvas_height) == (288, 512)
    assert transform.contains_source(1080, 1920)
    assert not transform.contains_source(1920, 1080)


def test_transform_rejects_a_canvas_that_crops_the_source():
    cropped = MaskTransform(canvas_width=32, canvas_height=32, scale=0.5, offset_x=0, offset_y=0)
    assert not cropped.contains_source(64, 48)
    with pytest.raises(ValueError, match='transform does not match'):
        manifest(transform=cropped)


def test_complete_generation_is_valid():
    value = manifest()
    assert value.frame_count == 6
    assert value.byte_size == 160
    assert value.chunk_for_frame(0).index == 0
    assert value.chunk_for_frame(4).index == 1


def test_chunks_must_be_contiguous():
    transform = build_transform(64, 48, 32)
    timestamps = [round(i / 15, 6) for i in range(6)]
    chunks = [chunk_manifest(0, 0, 3, b'a' * 100, CONVERSION, GENERATION),
              chunk_manifest(1, 4, 3, b'b' * 60, CONVERSION, GENERATION)]
    with pytest.raises(ValueError, match='gaps or overlap'):
        manifest(chunks=chunks)


def test_chunks_must_cover_every_frame():
    transform = build_transform(64, 48, 32)
    chunks = [chunk_manifest(0, 0, 5, b'a' * 100, CONVERSION, GENERATION)]
    with pytest.raises(ValueError, match='whole decoded timeline'):
        manifest(chunks=chunks)


def test_quality_flags_must_stay_inside_the_timeline():
    from apps.api.silhouettes import QualityFlags
    with pytest.raises(ValueError, match='outside the timeline'):
        manifest(quality=QualityFlags(absent_frames=[6]))


def test_selection_timestamp_must_match_its_frame():
    selection = Selection(source='owner', frame_index=2, timestamp=0.5, box=[1, 1, 20, 20])
    with pytest.raises(ValueError, match='selection frame time'):
        manifest(selection=selection)


def test_selection_box_must_lie_inside_the_source():
    selection = Selection(source='owner', frame_index=0, timestamp=0.0, box=[1, 1, 300, 20])
    with pytest.raises(ValueError, match='inside the source frame'):
        manifest(selection=selection)


def test_reused_sam3d_detector_box_requires_evidence():
    with pytest.raises(ValueError, match='detector evidence'):
        Selection(source='sam3d-detector', frame_index=0, timestamp=0.0, box=[2, 2, 40, 44])


def test_decoded_frames_must_match_the_timeline():
    source = SourceClip(conversion_id=CONVERSION, preview_sha256=PREVIEW_HASH, preview_bytes=10,
                        width=64, height=48, decoded_frames=7)
    with pytest.raises(ValueError, match='Decoded frame count'):
        manifest(source=source)


def test_bind_verifies_the_preview_hash():
    value = manifest()
    with pytest.raises(ContractError, match='does not match'):
        value.bind('lesson-1', 'revision-1', 'd' * 64)
    bound = value.bind('lesson-1', 'revision-1', PREVIEW_HASH)
    assert bound.binding.lesson_id == 'lesson-1'
    assert bound.binding.preview_sha256_verified is True
    assert value.binding is None
    assert bound.bind('lesson-1', 'revision-1', PREVIEW_HASH) is bound


def test_binding_requires_a_verified_hash():
    with pytest.raises(ValueError, match='verified preview hash'):
        Binding(lesson_id='lesson-1', revision_id='revision-1',
                preview_sha256_verified=False, bound_at='2026-10-31T00:00:00Z')


def test_publication_requires_a_binding():
    with pytest.raises(ContractError, match='only after binding'):
        manifest().assert_publishable(PREVIEW_HASH)
    manifest().bind('lesson-1', 'revision-1', PREVIEW_HASH).assert_publishable(PREVIEW_HASH)


def test_publication_rejects_a_replacement_preview():
    bound = manifest().bind('lesson-1', 'revision-1', PREVIEW_HASH)
    with pytest.raises(ContractError, match='different preview bytes'):
        bound.assert_publishable('d' * 64)


def test_suspected_identity_switch_requires_owner_review():
    value = manifest(quality=QualityFlags(identity_switch_suspected=True)).bind(
        'lesson-1', 'revision-1', PREVIEW_HASH)
    # Publication stays open so the owner can inspect the result and decide.
    value.assert_publishable(PREVIEW_HASH)
    assert value.requires_review
    accepted = value.model_copy(update={'review': Review(
        status=ReviewStatus.ACCEPTED, decided_at='2026-10-31T00:00:00Z', note='Checked every frame.')})
    assert not accepted.requires_review


def test_unflagged_generation_does_not_require_review():
    assert not manifest().requires_review
    uncertain = manifest(quality=QualityFlags(uncertain_frames=[1]))
    assert uncertain.requires_review


def test_a_decided_review_records_when():
    with pytest.raises(ValueError, match='when it was decided'):
        Review(status=ReviewStatus.ACCEPTED)


def test_png_round_trip_is_lossless_and_binary():
    pixels = bytes([255] * 10 + [0] * 22)
    blob = encode_mask_png(32, 1, pixels)
    assert decode_mask_png(blob) == (32, 1, pixels)
    assert len(blob) < 200


def test_png_rejects_intermediate_values():
    with pytest.raises(ContractError, match='0 or 255'):
        encode_mask_png(2, 2, bytes([0, 128, 255, 0]))


def test_png_rejects_a_foreign_grey_level():
    width = height = 4
    rows = b''.join(b'\x00' + bytes([128] * width) for _ in range(height))
    header = b'\x89PNG\r\n\x1a\n'
    header += _png_chunk(b'IHDR', (width).to_bytes(4, 'big') + (height).to_bytes(4, 'big')
                         + bytes([8, 0, 0, 0, 0]))
    header += _png_chunk(b'IDAT', zlib.compress(rows, 9)) + _png_chunk(b'IEND', b'')
    with pytest.raises(ArchiveError, match='0 and 255'):
        decode_mask_png(header)


def test_png_rejects_a_filtered_row():
    width = height = 2
    rows = b'\x01' + bytes([255, 0]) + b'\x00' + bytes([0, 255])
    blob = b'\x89PNG\r\n\x1a\n'
    blob += _png_chunk(b'IHDR', (width).to_bytes(4, 'big') + (height).to_bytes(4, 'big')
                       + bytes([8, 0, 0, 0, 0]))
    blob += _png_chunk(b'IDAT', zlib.compress(rows, 9)) + _png_chunk(b'IEND', b'')
    with pytest.raises(ArchiveError, match='filter 0'):
        decode_mask_png(blob)


def test_png_rejects_oversized_row_data():
    width = height = 4
    rows = b'\x00' * (height * (width + 1) + 40)
    blob = b'\x89PNG\r\n\x1a\n'
    blob += _png_chunk(b'IHDR', (width).to_bytes(4, 'big') + (height).to_bytes(4, 'big')
                       + bytes([8, 0, 0, 0, 0]))
    blob += _png_chunk(b'IDAT', zlib.compress(rows, 9)) + _png_chunk(b'IEND', b'')
    with pytest.raises(ArchiveError, match='wrong size'):
        decode_mask_png(blob)


def test_png_rejects_a_corrupt_checksum():
    blob = bytearray(encode_mask_png(4, 4, mask(4, 4)))
    blob[30] ^= 0xFF
    with pytest.raises(ArchiveError, match='checksum'):
        decode_mask_png(bytes(blob))


def test_chunk_archive_verifies(tmp_path):
    transform = build_transform(64, 48, 32)
    blob_path = tmp_path / 'chunk.zip'
    size, digest = write_chunk_archive(blob_path, [(0, mask()), (1, mask(on=False))],
                                       transform.canvas_width, transform.canvas_height)
    chunk = chunk_manifest(0, 0, 2, blob_path.read_bytes(), CONVERSION, GENERATION)
    assert chunk.bytes == size and chunk.sha256 == digest
    assert verify_chunk_archive(blob_path.read_bytes(), chunk, transform) == 2


def test_chunk_archive_rejects_a_tampered_byte(tmp_path):
    transform = build_transform(64, 48, 32)
    blob_path = tmp_path / 'chunk.zip'
    write_chunk_archive(blob_path, [(0, mask())], transform.canvas_width, transform.canvas_height)
    chunk = chunk_manifest(0, 0, 1, blob_path.read_bytes(), CONVERSION, GENERATION)
    tampered = bytearray(blob_path.read_bytes())
    tampered[-30] ^= 0xFF
    with pytest.raises(ArchiveError):
        verify_chunk_archive(bytes(tampered), chunk, transform)


def test_chunk_archive_rejects_a_path_like_entry(tmp_path):
    transform = build_transform(64, 48, 32)
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, 'w') as archive:
        archive.writestr('../000000.png', encode_mask_png(32, 24, mask()))
    blob = payload.getvalue()
    chunk = chunk_manifest(0, 0, 1, blob, CONVERSION, GENERATION)
    with pytest.raises(ArchiveError, match='decoded frame index'):
        verify_chunk_archive(blob, chunk, transform)


def test_chunk_archive_rejects_wrong_dimensions(tmp_path):
    transform = build_transform(64, 48, 32)
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, 'w') as archive:
        archive.writestr('000000.png', encode_mask_png(8, 8, mask(8, 8)))
    blob = payload.getvalue()
    chunk = chunk_manifest(0, 0, 1, blob, CONVERSION, GENERATION)
    with pytest.raises(ArchiveError, match='canvas'):
        verify_chunk_archive(blob, chunk, transform)


def test_chunk_archive_rejects_wrong_entry_count(tmp_path):
    transform = build_transform(64, 48, 32)
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, 'w') as archive:
        archive.writestr('000000.png', encode_mask_png(32, 24, mask()))
    blob = payload.getvalue()
    chunk = Chunk(index=0, first_frame=0, frame_count=2, entries=2,
                  key=chunk_manifest(0, 0, 2, blob, CONVERSION, GENERATION).key,
                  bytes=len(blob), sha256=chunk_manifest(0, 0, 1, blob, CONVERSION, GENERATION).sha256)
    with pytest.raises(ArchiveError, match='entry count'):
        verify_chunk_archive(blob, chunk, transform)


def test_state_machine_has_no_review_state():
    assert {state.value for state in SilhouetteState} == {
        'queued', 'processing', 'needs_selection', 'ready', 'failed', 'cancelled'}
    assert can_transition(SilhouetteState.PROCESSING, SilhouetteState.READY)
    assert can_transition(SilhouetteState.PROCESSING, SilhouetteState.NEEDS_SELECTION)
    assert can_transition(SilhouetteState.NEEDS_SELECTION, SilhouetteState.QUEUED)
    assert not can_transition(SilhouetteState.READY, SilhouetteState.PROCESSING)
    assert can_transition(SilhouetteState.READY, SilhouetteState.CANCELLED)
    assert not can_transition(SilhouetteState.CANCELLED, SilhouetteState.QUEUED)
    assert can_review(ReviewStatus.PENDING, ReviewStatus.ACCEPTED)
    assert not can_review(ReviewStatus.PENDING, ReviewStatus.PENDING)


def test_dedupe_key_is_bound_to_source_prompt_and_model():
    value = manifest()
    assert len(value.dedupe_key()) == 64
    assert value.dedupe_key() == manifest().dedupe_key()
    moved = manifest(selection=Selection(source='owner', frame_index=0, timestamp=0.0,
                                         box=[4.0, 4.0, 40.0, 44.0]))
    assert moved.dedupe_key() != value.dedupe_key()
    retuned = manifest(model={'family': 'sam2', 'name': 'sam2.1-hiera-small',
                              'checkpoint_sha256': CHECKPOINT, 'settings': {'threshold': 0.1}})
    assert retuned.dedupe_key() != value.dedupe_key()


def test_generation_prefix_is_attempt_specific():
    assert generation_prefix(CONVERSION, GENERATION) == f'silhouettes/{CONVERSION}/{GENERATION}/'
    with pytest.raises(ContractError):
        generation_prefix('../escape', GENERATION)


def test_manifest_json_round_trip_keeps_the_timeline_and_binding():
    bound = manifest().bind('lesson-1', 'revision-1', PREVIEW_HASH)
    again = SilhouetteManifest.from_json(bound.to_json())
    assert again == bound
    assert again.timeline.timestamps == bound.timeline.timestamps
    assert again.binding.revision_id == 'revision-1'
    assert json.loads(bound.to_json())['schema_version'] == 1


def test_manifest_rejects_unknown_fields():
    with pytest.raises(ValueError):
        manifest(needs_review=True)


def test_silhouette_capability_migration_preserves_workers():
    from importlib import import_module

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text

    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE worker_credentials '
                                '(id VARCHAR PRIMARY KEY, provider VARCHAR, pipeline_version VARCHAR, active BOOLEAN)'))
        connection.execute(text("INSERT INTO worker_credentials (id, provider, pipeline_version, active) "
                                "VALUES ('worker-1', 'local', 'sam-3d-body-v1', 1)"))
        migration = import_module('apps.api.migrations.versions.0014_silhouette_capability')
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        row = connection.execute(text('SELECT provider, active, silhouettes FROM worker_credentials')).one()
        assert tuple(row) == ('local', 1, 0)
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        assert 'silhouettes' not in {column['name']
                                     for column in inspect(connection).get_columns('worker_credentials')}
    engine.dispose()
