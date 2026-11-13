"""Package 5: one common renderer, complete note coverage and recorded level."""
import json
from pathlib import Path

import pytest

import scripts.piano_performance as performance
import scripts.piano_render as render
import scripts.render_piano_comparison as previews


def document(count=3, *, velocity=90, duration=2.0):
    value = performance.new_document(
        performance_id='model-run',
        source={'sha256': 'b' * 64, 'duration_seconds': duration,
                'sample_rate': 22050, 'channels': 1})
    for index in range(count):
        performance.add_note(
            value, note_id=f'n{index}', pitch_midi=60 + index % 12,
            onset_seconds=0.2 + index * 0.2, velocity_midi=velocity)
    return value


def test_both_modes_are_rendered_with_one_policy(tmp_path):
    manifest = previews.render_run(document(), tmp_path)
    assert set(manifest['previews']) == {'as_transcribed', 'notes_only'}
    for entry in manifest['previews'].values():
        assert Path(tmp_path / entry['file']).is_file()
        assert entry['rendered_notes'] == 3
        assert entry['note_count'] == 3
        assert entry['gain_policy'] == {'common_gain_db': 0.0, 'normalization': 'none',
                                        'headroom_db': previews.COMMON_HEADROOM_DB}
        assert entry['sample_rate'] == 22050
        assert entry['seconds'] >= 2.0
    assert manifest['common']['renderer'] == render.get_renderer().name


def test_as_transcribed_uses_velocity_and_notes_only_does_not(tmp_path):
    loud = previews.render_preview(document(velocity=120), tmp_path / 'loud.wav')
    quiet = previews.render_preview(document(velocity=40), tmp_path / 'quiet.wav')
    assert loud['peak_dbfs'] > quiet['peak_dbfs']
    fixed_loud = previews.render_preview(document(velocity=120), tmp_path / 'fixed-loud.wav',
                                         notes_only=True)
    fixed_quiet = previews.render_preview(document(velocity=40),
                                          tmp_path / 'fixed-quiet.wav', notes_only=True)
    assert fixed_loud['peak_dbfs'] == fixed_quiet['peak_dbfs']
    assert fixed_loud['notes_only_convention'] == {
        'intensity': previews.NOTES_ONLY_INTENSITY,
        'duration_seconds': previews.NOTES_ONLY_DURATION_SECONDS}


def test_notes_only_removes_pedal_and_velocity(tmp_path):
    value = document()
    performance.add_pedal(value, pedal_id='p1', pedal_type='sustain',
                          onset_seconds=0.1, value=1.0)
    derived = previews.notes_only_document(value)
    assert derived['pedal'] == []
    assert all(note['velocity_midi'] is None for note in derived['notes'])
    assert all(note['render_intensity'] == previews.NOTES_ONLY_INTENSITY
               for note in derived['notes'])
    assert derived['notes'][0]['key_release_seconds'] == pytest.approx(0.7)


def test_more_than_a_thousand_notes_are_all_rendered(tmp_path):
    count = 1001
    value = document(count=count, duration=30.0)
    for note in value['notes']:
        note['onset_seconds'] = 0.1 + int(note['id'][1:]) * 0.025
    performance.validate(value)
    entry = previews.render_preview(value, tmp_path / 'many.wav', sample_rate=8000)
    assert entry['rendered_notes'] == count
    assert entry['note_count'] == count
    assert entry['seconds'] >= 25.0


def test_dense_preview_has_headroom_and_does_not_clip(tmp_path):
    value = document(count=40, velocity=127, duration=2.0)
    for index, note in enumerate(value['notes']):
        note['onset_seconds'] = 0.1 + index * 0.002
    performance.validate(value)
    entry = previews.render_preview(value, tmp_path / 'clip.wav')
    assert entry['clipping'] is False
    assert entry['gain_policy']['headroom_db'] == previews.COMMON_HEADROOM_DB
    assert entry['peak_dbfs'] < 0.0
    # Without the common headroom the same material still reports clipping honestly.
    raw = render.AdditiveReferenceRenderer(headroom_db=0.0)
    clipped = previews.render_preview(value, tmp_path / 'raw.wav', renderer=raw)
    assert clipped['clipping'] is True


def test_native_offsets_drive_preview_duration_and_identity(tmp_path):
    value = document(count=2, velocity=90)
    native = {'schema': 'piano-model-native-1', 'variant': 'model-run',
              'offset_convention': 'basic-pitch-native/offset',
              'events': [
                  {'id': 'n0', 'pitch': 60, 'onset_seconds': 0.2,
                   'offset_seconds': 0.9, 'amplitude': 0.5},
                  {'id': 'n1', 'pitch': 61, 'onset_seconds': 0.4,
                   'offset_seconds': 0.6, 'amplitude': 0.5}]}
    entry = previews.render_preview(value, tmp_path / 'native.wav', native=native)
    mapping = entry['mapping']['native_offsets']
    assert mapping['notes'] == 2
    assert mapping['convention'] == 'basic-pitch-native/offset'
    assert mapping['sidecar_sha256']
    assert any('native predicted offsets' in warning for warning in entry['warnings'])
    derived, _ = previews.preview_document(value, native=native)
    assert derived['notes'][0]['legacy']['duration_seconds'] == pytest.approx(0.7)
    assert derived['notes'][0]['legacy']['semantics'] == previews.NATIVE_OFFSET_SEMANTICS
    assert derived['notes'][0]['key_release_seconds'] is None
    # Identical starts with different native lengths must produce a different preview.
    longer = json.loads(json.dumps(native))
    longer['events'][1]['offset_seconds'] = 0.95
    other = previews.render_preview(value, tmp_path / 'longer.wav', native=longer)
    assert other['identity'] != entry['identity']
    assert other['preview_identity'] != entry['preview_identity']
    assert other['sha256'] != entry['sha256']
    renamed = json.loads(json.dumps(native))
    renamed['offset_convention'] = 'another/offset'
    third = previews.render_preview(value, tmp_path / 'renamed.wav', native=renamed)
    assert third['identity'] == entry['identity']
    assert third['preview_identity'] != entry['preview_identity']


def test_amplitude_proxy_drives_default_intensity_only(tmp_path):
    def amplitude_document(amplitude):
        value = performance.new_document(
            performance_id='bp', source={'sha256': 'b' * 64, 'duration_seconds': 1.0,
                                         'sample_rate': 22050, 'channels': 1})
        performance.add_note(
            value, note_id='n0', pitch_midi=60, onset_seconds=0.2,
            velocity_midi=None, velocity_provenance={'kind': 'amplitude_proxy',
                                                     'amplitude': amplitude})
        return value
    soft = previews.render_preview(amplitude_document(0.1), tmp_path / 'soft.wav')
    loud = previews.render_preview(amplitude_document(0.9), tmp_path / 'loud.wav')
    assert soft['mapping']['amplitude_to_intensity']['notes'] == 1
    assert soft['mapping']['amplitude_to_intensity']['calibrated_midi_velocity'] is False
    assert loud['peak_dbfs'] > soft['peak_dbfs']
    fixed_soft = previews.render_preview(amplitude_document(0.1),
                                         tmp_path / 'fixed-soft.wav', notes_only=True)
    fixed_loud = previews.render_preview(amplitude_document(0.9),
                                         tmp_path / 'fixed-loud.wav', notes_only=True)
    assert fixed_soft['peak_dbfs'] == fixed_loud['peak_dbfs']


def test_notes_only_ignores_native_offsets(tmp_path):
    value = document(count=1)
    native = {'variant': 'model-run', 'offset_convention': 'test/offset',
              'events': [{'id': 'n0', 'pitch': 60, 'onset_seconds': 0.2,
                          'offset_seconds': 1.5, 'amplitude': 0.9}]}
    derived, mapping = previews.preview_document(value, native=native, notes_only=True)
    assert derived['notes'][0]['legacy'] is None
    assert derived['notes'][0]['key_release_seconds'] == pytest.approx(0.7)
    assert mapping == {'native_offsets': None, 'amplitude_to_intensity': None}


def test_unsupported_soft_pedal_is_refused_not_dropped(tmp_path):
    value = document()
    performance.add_pedal(value, pedal_id='soft', pedal_type='soft',
                          onset_seconds=0.1, value=1.0)
    with pytest.raises(render.UnsupportedControl):
        previews.render_preview(value, tmp_path / 'soft.wav')


def test_manifest_records_identity_and_release_sources(tmp_path):
    manifest = previews.render_run(document(), tmp_path)
    as_transcribed = manifest['previews']['as_transcribed']
    assert as_transcribed['identity']
    assert as_transcribed['release_sources']['assumed'] == 3
    assert as_transcribed['controls']['sustain_pedal'] is True
    assert Path(tmp_path / 'preview.json').is_file()
    assert json.loads((tmp_path / 'preview.json').read_text(encoding='utf-8'))[
        'schema'] == previews.SCHEMA


def test_preview_refuses_a_document_the_renderer_would_truncate(tmp_path):
    class Dropping:
        name = 'dropping'
        version = '0'
        asset_sha256 = None

        def resolve(self, document, output_spec):
            class Request:
                notes = ()
            return Request()

        def render(self, document, output_spec, *, strict=True):
            raise AssertionError('must not synthesize a truncated preview')
    with pytest.raises(previews.PreviewError, match='dropped notes'):
        previews.render_preview(document(), tmp_path / 'x.wav', renderer=Dropping())
