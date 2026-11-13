"""The harness binds source, performance, renderer, codec and objective into one report."""
import json

import numpy as np
import pytest

import scripts.piano_performance as performance
import scripts.piano_reconstruction_harness as harness
import scripts.piano_render as render

SR = 22050
SPEC = render.OutputSpec(sample_rate=SR, channels=2, tail_seconds=0.0)


def build_document(duration=2.0, sustain=True):
    source = {'sha256': None, 'duration_seconds': duration, 'sample_rate': SR, 'channels': 2}
    built = performance.new_document(performance_id='harness-test', source=source)
    performance.add_note(built, note_id='n1', pitch_midi=60, onset_seconds=0.25,
                         key_release_seconds=0.9, velocity_midi=80)
    performance.add_note(built, note_id='n2', pitch_midi=67, onset_seconds=1.0,
                         key_release_seconds=1.6, velocity_midi=70)
    if sustain:
        performance.add_pedal(built, pedal_id='s1', pedal_type='sustain',
                              onset_seconds=0.0, value=1.0)
    return built


def write_case(directory, document_value=None):
    document_value = document_value or build_document()
    result = render.get_renderer().render(document_value, SPEC)
    wav = harness.write_wav(directory / 'source.wav', result.audio, result.sample_rate)
    document_value['source']['sha256'] = harness.file_sha256(wav)
    document_value['source']['duration_seconds'] = result.duration_seconds
    path = directory / 'performance.json'
    path.write_text(performance.to_json(document_value), encoding='utf-8')
    return wav, path, document_value


class FixedRenderer:
    """A renderer with an explicit latency, so latency handling can be observed."""

    asset_sha256 = None
    approximate = False

    def __init__(self, seconds=2.0, latency=0):
        self.seconds = seconds
        self.latency = latency

    def render(self, document, output_spec=None, *, strict=True):
        # A real latency-emitting renderer produces its delay before the audio, so the
        # declared interval is still covered once the latency is removed.
        frames = int(round(self.seconds * output_spec.sample_rate)) + self.latency
        audio = np.zeros((frames, 2), dtype=np.float32)
        audio[100 + self.latency:200 + self.latency] = 0.2
        return render.RenderResult(
            audio=audio, identity='f' * 64, latency_samples=self.latency,
            control_support=render.ControlSupport(True, True, True, False, False, False, False),
            renderer='fixed', renderer_version='1', sample_rate=output_spec.sample_rate,
            release_sources={'measured': 2, 'legacy': 0, 'assumed': 0})


class AttributedRenderer(FixedRenderer):
    """A non-approximate renderer with recorded assets, so qualification can be probed.

    Its audio is synthetic; it exists only to exercise guards that must not depend on the
    additive renderer being approximate.
    """

    approximate = False

    def __init__(self, asset='c' * 64):
        super().__init__(2.0)
        self.asset_sha256 = asset

    def render(self, document, output_spec=None, *, strict=True):
        frames = int(round(document['source']['duration_seconds'] * output_spec.sample_rate))
        times = np.arange(frames) / output_spec.sample_rate
        audio = (0.15 * np.sin(2 * np.pi * 220.0 * times)).astype(np.float32)
        stereo = np.stack([audio, audio], axis=1)
        return render.RenderResult(
            audio=stereo, identity='a' * 64, latency_samples=0,
            control_support=render.ControlSupport(True, True, True, False, False, False,
                                                  False),
            renderer='attributed', renderer_version='1',
            sample_rate=output_spec.sample_rate, asset_sha256=self.asset_sha256,
            release_sources={'measured': len(document['notes']), 'legacy': 0, 'assumed': 0})


def test_report_covers_every_required_identity(tmp_path):
    wav, doc_path, document_value = write_case(tmp_path)
    report = harness.run(wav, doc_path, tmp_path / 'out', output_spec=SPEC)

    assert report['schema'] == harness.SCHEMA
    assert report['source']['sha256'] == harness.file_sha256(wav)
    assert report['source']['header']['sample_rate'] == SR
    assert report['performance']['sha256'] == performance.document_sha256(document_value)
    assert report['performance']['semantics_version'] == performance.SEMANTICS_VERSION
    assert report['objective']['version']
    assert report['objective']['weights_sha256']
    assert report['objective']['implementation_sha256']
    assert report['determinism'] == {'renders': 2, 'stable': True}
    assert report['output']['float_sha256']
    assert report['output']['delivered']['sha256']
    assert report['output']['delivered']['bit_depth'] == 24


def test_rendered_audio_against_itself_is_near_identical(tmp_path):
    wav, doc_path, _document = write_case(tmp_path)
    report = harness.run(wav, doc_path, None, output_spec=SPEC)
    assert report['objective']['float']['normalized']['objective'] < 1e-3
    assert report['objective']['delivered']['normalized']['objective'] < 1e-3
    assert report['objective']['float']['normalized']['gain_db'] == pytest.approx(0.0, abs=0.05)


def test_delivered_audio_is_scored_separately_from_the_float_render(tmp_path):
    wav, doc_path, _document = write_case(tmp_path)
    lossy = harness.run(wav, doc_path, None, output_spec=SPEC, delivered_bit_depth=16)
    precise = harness.run(wav, doc_path, None, output_spec=SPEC, delivered_bit_depth=24)
    assert lossy['output']['delivered']['bit_depth'] == 16
    assert precise['output']['delivered']['bit_depth'] == 24
    assert lossy['objective']['delivered']['normalized']['objective'] > \
        precise['objective']['delivered']['normalized']['objective']
    assert lossy['output']['float_sha256'] == precise['output']['float_sha256']


def test_artifacts_are_written_and_readable(tmp_path):
    wav, doc_path, _document = write_case(tmp_path)
    output = tmp_path / 'out'
    report = harness.run(wav, doc_path, output, output_spec=SPEC)
    assert set(report['artifacts']) == {'wav', 'floats', 'performance', 'report'}
    assert (output / 'render.wav').is_file()
    assert (output / 'render.f32.npy').is_file()
    assert (output / 'performance.json').is_file()
    assert (output / 'report.json').is_file()
    reloaded, rate = harness.read_wav(output / 'render.wav')
    assert rate == SR and reloaded.shape[1] == 2
    stored = json.loads((output / 'report.json').read_text(encoding='utf-8'))
    assert stored['objective']['delivered']['normalized']['objective'] == \
        pytest.approx(report['objective']['delivered']['normalized']['objective'], abs=1e-9)
    saved = performance.from_json((output / 'performance.json').read_text(encoding='utf-8'))
    assert render.request_identity(saved, SPEC) == report['performance']['render_identity']


def test_a_different_source_is_refused(tmp_path):
    wav, doc_path, _document = write_case(tmp_path)
    other = tmp_path / 'other.wav'
    audio, rate = harness.read_wav(wav)
    harness.write_wav(other, audio * 0.5, rate)
    with pytest.raises(harness.HarnessError, match='different source'):
        harness.run(other, doc_path, None, output_spec=SPEC)


def test_undocumented_source_hash_is_a_warning(tmp_path):
    wav, doc_path, document_value = write_case(tmp_path)
    document_value['source']['sha256'] = None
    doc_path.write_text(performance.to_json(document_value), encoding='utf-8')
    report = harness.run(wav, doc_path, None, output_spec=SPEC)
    assert any('does not declare a source hash' in warning for warning in report['warnings'])


def test_trimmed_source_duration_is_disclosed(tmp_path):
    wav, doc_path, document_value = write_case(tmp_path)
    document_value['source']['duration_seconds'] = 1.0
    doc_path.write_text(performance.to_json(document_value), encoding='utf-8')
    report = harness.run(wav, doc_path, None, output_spec=SPEC)
    assert any('differs from the file' in warning for warning in report['warnings'])


def test_render_rate_must_match_the_source(tmp_path):
    wav, doc_path, _document = write_case(tmp_path)
    with pytest.raises(harness.HarnessError, match='must match the source rate'):
        harness.run(wav, doc_path, None,
                    output_spec=render.OutputSpec(sample_rate=44100, tail_seconds=0.0))


def test_coverage_discloses_unmeasured_attributes():
    built = build_document()
    performance.add_note(built, note_id='n3', pitch_midi=72, onset_seconds=1.4)
    reported = harness.coverage(built)
    assert reported['notes'] == 3
    assert reported['notes_without_key_release'] == 1
    assert reported['notes_without_velocity'] == 1
    assert reported['notes_without_audible_end'] == 3
    assert reported['pedal_events'] == 1
    assert reported['pedal_value_semantics']['sustain'] == 'binary'


def test_latency_comes_from_the_renderer_by_default(tmp_path):
    wav, doc_path, _document = write_case(tmp_path, build_document(sustain=False))
    report = harness.run(wav, doc_path, None, output_spec=SPEC,
                         renderer=FixedRenderer(2.0, latency=128))
    assert report['renderer']['latency_samples'] == 128
    assert report['renderer']['latency_source'] == 'renderer'
    assert report['objective']['delivered']['normalized']['latency_samples'] == 128


def test_latency_override_is_recorded(tmp_path):
    wav, doc_path, _document = write_case(tmp_path, build_document(sustain=False))
    report = harness.run(wav, doc_path, None, output_spec=SPEC,
                         renderer=FixedRenderer(2.0, latency=128), latency_samples=0)
    assert report['renderer']['latency_samples'] == 0
    assert report['renderer']['latency_source'] == 'override'
    assert any('latency overridden' in warning for warning in report['warnings'])


def test_an_incomplete_candidate_is_rejected_unless_explicitly_allowed(tmp_path):
    wav, doc_path, _document = write_case(tmp_path, build_document(sustain=False))
    with pytest.raises(harness.HarnessError, match='cannot qualify|missing'):
        harness.run(wav, doc_path, None, output_spec=SPEC, renderer=FixedRenderer(1.0))
    report = harness.run(wav, doc_path, None, output_spec=SPEC,
                         renderer=FixedRenderer(1.0), require_complete=False)
    assert report['objective']['delivered']['normalized']['complete'] is False
    assert any('incomplete' in reason
               for reason in report['qualification']['blocking_reasons'])
    assert report['qualification']['valid_for_qualification'] is False


def measured_document(end_status='scorable'):
    """A document where every attribute has a measurement, for qualification probes."""
    source = {'sha256': None, 'duration_seconds': 2.0, 'sample_rate': SR, 'channels': 2}
    built = performance.new_document(performance_id='measured', source=source)
    for index, pitch in enumerate((60, 67)):
        audible = ({'earliest': 1.0 + index, 'latest': 1.2 + index, 'status': 'scorable'}
                   if end_status == 'scorable'
                   else {'earliest': None, 'latest': None, 'status': 'uncertain'})
        performance.add_note(built, note_id=f'n{index}', pitch_midi=pitch,
                             onset_seconds=0.25 + index, key_release_seconds=0.9 + index,
                             velocity_midi=80, audible_end=audible)
    performance.add_pedal(built, pedal_id='s1', pedal_type='sustain',
                          onset_seconds=0.0, value=1.0)
    return built


def test_missing_source_identity_blocks_every_target(tmp_path):
    wav, doc_path, document_value = write_case(tmp_path, measured_document())
    document_value['source']['sha256'] = None
    doc_path.write_text(performance.to_json(document_value), encoding='utf-8')
    renderer = AttributedRenderer()
    report = harness.run(wav, doc_path, None, output_spec=SPEC, renderer=renderer)
    flags = report['qualification']
    assert flags['identity'] == {'declared': False, 'verified': False,
                                 'source_sha256': report['source']['sha256']}
    assert flags['valid_for_qualification'] is False
    assert flags['diagnostic_only'] is True
    assert set(flags['blocked_targets']) == set(harness.QUALIFICATION_TARGETS)
    assert flags['qualified_targets'] == []
    assert any('does not declare' in reason for reason in flags['blocking_reasons'])


def test_uncertain_audible_ends_block_only_that_target(tmp_path):
    wav, doc_path, _document = write_case(tmp_path, measured_document(end_status='uncertain'))
    report = harness.run(wav, doc_path, None, output_spec=SPEC,
                         renderer=AttributedRenderer())
    flags = report['qualification']
    assert flags['blocked_targets'] == ['audible_end', 'stereo_room_fidelity']
    assert 'audible_end' not in flags['qualified_targets']
    assert 'release' in flags['qualified_targets']
    assert 'velocity' in flags['qualified_targets']
    assert any('uncertain' in reason
               for reason in flags['targets']['audible_end']['reasons'])


def test_measured_attributes_leave_their_targets_qualified(tmp_path):
    wav, doc_path, _document = write_case(tmp_path, measured_document())
    report = harness.run(wav, doc_path, None, output_spec=SPEC,
                         renderer=AttributedRenderer())
    flags = report['qualification']
    assert flags['identity']['verified'] is True
    assert flags['qualified_targets'] == ['audible_end', 'audio_fidelity', 'pedal',
                                          'release', 'velocity']
    assert flags['blocked_targets'] == ['stereo_room_fidelity']
    assert flags['valid_for_qualification'] is True
    assert flags['diagnostic_only'] is False


def test_a_fidelity_renderer_without_asset_identity_blocks_fidelity_only(tmp_path):
    wav, doc_path, _document = write_case(tmp_path, measured_document())
    report = harness.run(wav, doc_path, None, output_spec=SPEC,
                         renderer=AttributedRenderer(asset=None))
    flags = report['qualification']
    assert 'audio_fidelity' in flags['blocked_targets']
    assert 'audio_fidelity' not in flags['qualified_targets']
    assert 'velocity' in flags['qualified_targets']
    assert any('asset identity' in reason
               for reason in flags['targets']['audio_fidelity']['reasons'])


def test_skipping_repeat_render_does_not_claim_verified_determinism(tmp_path):
    wav, doc_path, _document = write_case(tmp_path, measured_document())
    report = harness.run(wav, doc_path, None, output_spec=SPEC,
                         renderer=AttributedRenderer(), verify_determinism=False)
    assert report['determinism'] == {'renders': 1, 'stable': None}
    assert 'audio_fidelity' in report['qualification']['blocked_targets']


def test_absent_pedal_data_does_not_qualify_a_pedal_target(tmp_path):
    document = measured_document()
    document['pedal'] = []
    wav, doc_path, _document = write_case(tmp_path, document)
    report = harness.run(wav, doc_path, None, output_spec=SPEC, renderer=AttributedRenderer())
    assert 'pedal' in report['qualification']['blocked_targets']


def test_qualification_flags_mark_an_approximate_renderer_diagnostic(tmp_path):
    wav, doc_path, _document = write_case(tmp_path)
    report = harness.run(wav, doc_path, None, output_spec=SPEC)
    flags = report['qualification']
    assert flags['diagnostic_only'] is True
    assert flags['valid_for_qualification'] is False
    assert 'audio_fidelity' in flags['blocked_targets']
    assert any('approximate' in reason
               for reason in flags['targets']['audio_fidelity']['reasons'])


def test_unsupported_control_stops_the_comparison(tmp_path):
    wav, doc_path, document_value = write_case(tmp_path)
    performance.add_pedal(document_value, pedal_id='soft', pedal_type='soft',
                          onset_seconds=0.1, value=1.0)
    doc_path.write_text(performance.to_json(document_value), encoding='utf-8')
    with pytest.raises(render.UnsupportedControl):
        harness.run(wav, doc_path, None, output_spec=SPEC)
    report = harness.run(wav, doc_path, None, output_spec=SPEC, strict=False)
    assert any('not a valid fidelity candidate' in warning
               for warning in report['renderer']['warnings'])
    assert 'pedal' in report['qualification']['blocked_targets']


def test_non_deterministic_renderer_is_rejected(tmp_path):
    wav, doc_path, _document = write_case(tmp_path)

    class FlipRenderer(FixedRenderer):
        def __init__(self):
            super().__init__(2.0)
            self.calls = 0

        def render(self, document, output_spec=None, *, strict=True):
            self.calls += 1
            frames = int(round(self.seconds * output_spec.sample_rate))
            audio = np.full((frames, 2), 0.1 + 0.05 * (self.calls % 2), dtype=np.float32)
            return render.RenderResult(
                audio=audio, identity='f' * 64, latency_samples=0,
                control_support=render.ControlSupport(True, True, True, False, False, False,
                                                      False),
                renderer='flip', renderer_version='1', sample_rate=output_spec.sample_rate,
                release_sources={'measured': 0, 'legacy': 0, 'assumed': 0})

    with pytest.raises(harness.HarnessError, match='not deterministic'):
        harness.run(wav, doc_path, None, output_spec=SPEC, renderer=FlipRenderer())


def test_cli_prints_a_summary_and_exits_zero(tmp_path, capsys):
    wav, doc_path, _document = write_case(tmp_path)
    code = harness.main(['--source', str(wav), '--performance', str(doc_path),
                         '--tail-seconds', '0'])
    assert code == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary['deterministic'] is True
    assert summary['delivered_objective'] < 1e-3
    assert summary['valid_for_qualification'] is False


def test_cli_reports_errors_without_a_traceback(tmp_path, capsys):
    wav, doc_path, _document = write_case(tmp_path)
    bad = tmp_path / 'bad.json'
    bad.write_text('{"schema": "nope"}', encoding='utf-8')
    code = harness.main(['--source', str(wav), '--performance', str(bad)])
    assert code == 2
    assert 'error:' in capsys.readouterr().err


def test_read_wav_rejects_a_non_wav(tmp_path):
    path = tmp_path / 'not-a.wav'
    path.write_bytes(b'not audio at all')
    with pytest.raises(harness.HarnessError, match='not a readable PCM WAV'):
        harness.read_wav(path)


def test_header_preflight_rejects_unsupported_channels(tmp_path):
    path = tmp_path / 'three.wav'
    import wave as wave_module
    with wave_module.open(str(path), 'wb') as handle:
        handle.setnchannels(3)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(b'\x00' * 30)
    with pytest.raises(harness.HarnessError, match='unsupported channel count'):
        harness.inspect_wav(path)


def test_24_bit_reference_round_trips_without_raising_the_measurement_floor(tmp_path):
    times = np.arange(int(0.5 * SR)) / SR
    mono = (0.5 * np.sin(2 * np.pi * 440.0 * times)).astype(np.float32)
    audio = np.stack([mono, mono * 0.5], axis=1)
    path = harness.write_wav(tmp_path / 'reference.wav', audio, SR, bit_depth=24)
    restored, rate = harness.read_wav(path)
    assert rate == SR
    assert np.max(np.abs(restored - audio)) < 1e-6
    with pytest.raises(harness.HarnessError, match='bit_depth'):
        harness.write_wav(tmp_path / 'bad.wav', audio, SR, bit_depth=32)


def test_16_bit_output_is_still_available(tmp_path):
    audio = np.zeros((256, 1), dtype=np.float32)
    audio[10, 0] = 0.5
    path = harness.write_wav(tmp_path / 'sixteen.wav', audio, SR, bit_depth=16)
    restored, _rate = harness.read_wav(path)
    assert restored[10] == pytest.approx(0.5, abs=1e-4)
