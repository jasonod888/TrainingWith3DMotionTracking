"""Rendering is deterministic, honours declared controls and refuses to fake the rest.

The identity regressions here cover the review's P0 finding: every effective audio input —
resolved note-off, its estimation source, pedal-derived sounding end, output extent and
renderer settings — must be inside the hashed request.
"""
import numpy as np
import pytest

import scripts.piano_performance as performance
import scripts.piano_render as render

SOURCE = {'sha256': 'a' * 64, 'duration_seconds': 2.0, 'sample_rate': 22050, 'channels': 2}
SPEC = render.OutputSpec(sample_rate=22050, channels=2, tail_seconds=0.5)


def document(*notes, pedals=()):
    built = performance.new_document(performance_id='render-test', source=dict(SOURCE))
    for note in notes:
        performance.add_note(built, **note)
    for pedal in pedals:
        performance.add_pedal(built, **pedal)
    return built


def note(note_id='n1', pitch=60, onset=0.25, release=0.75, velocity=90, **rest):
    payload = {'note_id': note_id, 'pitch_midi': pitch, 'onset_seconds': onset,
               'key_release_seconds': release, 'velocity_midi': velocity}
    payload.update(rest)
    return payload


def legacy_note(note_id='n1', pitch=60, onset=0.25, duration=0.5, **rest):
    payload = {'note_id': note_id, 'pitch_midi': pitch, 'onset_seconds': onset,
               'key_release_seconds': None,
               'legacy': {'duration_seconds': duration, 'velocity_amplitude': 0.5,
                          'semantics': 'legacy-not-release'}}
    payload.update(rest)
    return payload


def pedal(pedal_id='p1', value=1.0, onset=0.0, kind='sustain'):
    return {'pedal_id': pedal_id, 'pedal_type': kind, 'onset_seconds': onset, 'value': value}


def renderer(**options):
    return render.AdditiveReferenceRenderer(**options)


def energy(result, start, stop):
    audio = result.audio
    first = int(start * result.sample_rate)
    last = int(stop * result.sample_rate)
    block = audio[first:last]
    return float(np.sqrt(np.mean(np.square(block.astype(np.float64))))) if block.size else 0.0


# ------------------------------------------------------------------ determinism / shape

def test_render_is_deterministic():
    document_value = document(note())
    first = renderer().render(document_value, SPEC)
    second = renderer().render(document_value, SPEC)
    assert render.render_sha256(first) == render.render_sha256(second)
    assert first.identity == second.identity
    assert first.latency_samples == 0


def test_output_shape_and_tail():
    result = renderer().render(document(note()), SPEC)
    expected = int(round((SOURCE['duration_seconds'] + SPEC.tail_seconds) * SPEC.sample_rate))
    assert result.frames == expected
    assert result.audio.shape[1] == 2
    assert result.audio.dtype == np.float32
    mono = renderer().render(document(note()), render.OutputSpec(sample_rate=22050,
                                                                 channels=1,
                                                                 tail_seconds=0.5))
    assert mono.audio.shape[1] == 1


def test_silence_renders_silence():
    result = renderer().render(document(), SPEC)
    assert result.peak() == 0.0
    assert result.warnings == ()


def test_onset_lands_on_the_declared_time():
    result = renderer().render(document(note(onset=0.5, release=1.0)), SPEC)
    loud = np.abs(result.audio[:, 0])
    first = int(np.argmax(loud > 1e-3))
    assert first / SPEC.sample_rate == pytest.approx(0.5, abs=0.012)


def test_velocity_changes_level_not_timing():
    quiet = renderer().render(document(note(velocity=40)), SPEC)
    loud = renderer().render(document(note(velocity=120)), SPEC)
    assert loud.peak() > quiet.peak() * 1.5
    assert render.render_sha256(quiet) != render.render_sha256(loud)


# ---------------------------------------------------------------------- release / pedal

def test_key_release_damps_the_string():
    short = renderer().render(document(note(release=0.35)), SPEC)
    long = renderer().render(document(note(release=1.6)), SPEC)
    assert energy(short, 0.6, 1.0) < energy(long, 0.6, 1.0) * 0.2


def test_sustain_pedal_extends_the_note():
    without = renderer().render(document(note(release=0.35)), SPEC)
    with_pedal = renderer().render(document(note(release=0.35), pedals=[pedal()]), SPEC)
    assert energy(with_pedal, 0.6, 1.0) > energy(without, 0.6, 1.0) * 5


def test_pedal_lift_damps_the_note():
    released = renderer().render(
        document(note(release=0.35), pedals=[pedal('s1', 1.0, 0.0), pedal('s2', 0.0, 0.5)]),
        SPEC)
    held = renderer().render(document(note(release=0.35), pedals=[pedal()]), SPEC)
    assert energy(released, 0.9, 1.2) < energy(held, 0.9, 1.2)


def test_pedal_helpers_report_contiguous_spans():
    built = document(note(), pedals=[pedal('s1', 1.0, 0.0), pedal('s2', 0.0, 1.0)])
    assert render.pedal_intervals(built) == ((0.0, 1.0),)
    assert render.pedal_down(built, 0.5)
    assert not render.pedal_down(built, 1.5)
    assert render.pedal_release_time(built, 0.5) == 1.0
    assert render.pedal_release_time(built, 1.5) is None


# ------------------------------------------------------- capability and value semantics

def test_unsupported_soft_pedal_is_refused_by_default():
    with pytest.raises(render.UnsupportedControl) as caught:
        renderer().render(document(note(), pedals=[pedal('p1', 1.0, 0.0, 'soft')]), SPEC)
    assert 'soft_pedal' in str(caught.value)


def test_continuous_pedal_requires_half_pedal_support():
    """A fractional stored value must not be silently thresholded on a fidelity path."""
    built = document(note(), pedals=[pedal('p1', 0.4, 0.0)])
    assert render.pedal_semantics(built)['sustain'] == 'continuous'
    assert render.used_controls(built)['half_pedal'] is True
    with pytest.raises(render.UnsupportedControl) as caught:
        renderer().render(built, SPEC)
    assert 'half_pedal' in str(caught.value)


def test_binary_pedal_does_not_require_half_pedal_support():
    built = document(note(), pedals=[pedal('p1', 1.0, 0.0)])
    assert render.pedal_semantics(built)['sustain'] == 'binary'
    assert render.used_controls(built)['half_pedal'] is False
    renderer().render(built, SPEC)


def test_downgraded_render_labels_the_ignored_control():
    result = renderer().render(document(note(), pedals=[pedal('p1', 0.4, 0.0)]), SPEC,
                               strict=False)
    assert any('ignored unsupported control' in warning for warning in result.warnings)
    assert any('not a valid fidelity candidate' in warning for warning in result.warnings)


def test_control_support_is_declared_honestly():
    support = renderer().controls()
    assert support.velocity and support.key_release and support.sustain_pedal
    assert not support.soft_pedal and not support.sostenuto_pedal
    assert not support.half_pedal and not support.resonance
    assert support.to_dict()['resonance'] is False


# ------------------------------------------------------------------------- release sources

def test_missing_release_is_an_assumption_that_is_disclosed():
    built = document(note(release=None))
    result = renderer().render(built, SPEC)
    assert result.release_sources['assumed'] == 1
    assert any('release assumed' in warning for warning in result.warnings)
    other = renderer(release_assumption_seconds=0.9).render(built, SPEC)
    assert other.identity != result.identity


def test_legacy_release_is_an_estimate_and_is_disclosed():
    built = document(legacy_note())
    result = renderer().render(built, SPEC)
    assert result.release_sources['legacy'] == 1
    assert any('estimated from legacy duration' in warning for warning in result.warnings)
    assert not any('release assumed' in warning for warning in result.warnings)


# ------------------------------------------------------------------------------ identity

def test_identity_ignores_provenance_and_notation_only_edits():
    built = document(note(written={'duration_ticks': 240}))
    base = render.request_identity(built, SPEC)

    built['provenance']['notes'].append('reviewed')
    built['performance_id'] = 'renamed'
    assert render.request_identity(built, SPEC) == base

    built['notes'][0]['written'] = {'duration_ticks': 960}
    assert render.request_identity(built, SPEC) == base


def test_identity_tracks_every_effective_control():
    built = document(note())
    base = render.request_identity(built, SPEC)

    built['notes'][0]['velocity_midi'] = 91
    after_velocity = render.request_identity(built, SPEC)
    assert after_velocity != base

    performance.add_pedal(built, pedal_id='p1', pedal_type='sustain',
                          onset_seconds=0.0, value=1.0)
    assert render.request_identity(built, SPEC) != after_velocity

    assert render.request_identity(built, SPEC) == render.request_identity(built, SPEC)
    assert render.request_identity(built, render.OutputSpec(sample_rate=22050,
                                                            channels=1,
                                                            tail_seconds=0.5)) != \
        render.request_identity(built, SPEC)
    assert render.request_identity(built, render.OutputSpec(sample_rate=22050,
                                                            channels=2,
                                                            tail_seconds=4.0)) != \
        render.request_identity(built, SPEC)


def test_legacy_duration_changes_audio_and_invalidates_identity():
    """Review P0: a legacy release changed the samples behind an unchanged key."""
    built = document(legacy_note(duration=0.2))
    first = renderer().render(built, SPEC)
    built['notes'][0]['legacy']['duration_seconds'] = 0.6
    second = renderer().render(built, SPEC)
    assert not np.array_equal(first.audio, second.audio)
    assert first.identity != second.identity


def test_legacy_amplitudes_preserve_relative_intensity_without_claiming_midi_velocity():
    built = document(legacy_note())
    quiet = renderer().render(built, SPEC)
    built['notes'][0]['legacy']['velocity_amplitude'] = .9
    loud = renderer().render(built, SPEC)
    assert energy(loud, .3, .6) > energy(quiet, .3, .6)
    assert loud.identity != quiet.identity
    assert built['notes'][0]['velocity_midi'] is None
    assert any('uncalibrated render intensities' in warning for warning in loud.warnings)


def test_source_extent_changes_output_length_and_identity():
    """Review P0: the output extent is an effective input and must be hashed."""
    built = document()
    narrow = renderer().render(built, SPEC)
    built['source']['duration_seconds'] = 4.0
    wide = renderer().render(built, SPEC)
    assert (narrow.frames, wide.frames) == (int(round(2.5 * 22050)), int(round(4.5 * 22050)))
    assert narrow.identity != wide.identity


def test_renderer_and_asset_identity_participate():
    built = document(note())
    plain = renderer()
    resolved = render.request_identity(built, SPEC, plain)

    plain.asset_sha256 = 'b' * 64
    assert render.request_identity(built, SPEC, plain) != resolved

    different = renderer(release_assumption_seconds=1.0)
    assert render.request_identity(built, SPEC, different) != resolved


def test_render_result_identity_is_the_request_identity():
    built = document(note())
    result = renderer().render(built, SPEC)
    assert result.identity == render.request_identity(built, SPEC)


# --------------------------------------------------------------------- specs / registry

def test_output_spec_is_validated():
    with pytest.raises(render.RenderError, match='sample_rate'):
        render.OutputSpec(sample_rate=100)
    with pytest.raises(render.RenderError, match='channels'):
        render.OutputSpec(channels=4)
    with pytest.raises(render.RenderError, match='tail_seconds'):
        render.OutputSpec(tail_seconds=-1)
    with pytest.raises(render.RenderError, match='tail_seconds'):
        render.OutputSpec(tail_seconds=float('nan'))


def test_unknown_renderer_is_rejected():
    with pytest.raises(render.RenderError, match='unknown renderer'):
        render.get_renderer('mystery-piano')


def test_sfizz_is_unavailable_and_says_why():
    probe = render.SfizzRenderer.probe()
    assert probe['available'] is False
    assert probe['blockers']
    with pytest.raises(render.RendererUnavailable, match='not configured|not found'):
        render.SfizzRenderer().render(document(note()), SPEC)


def test_sfizz_probe_reports_missing_assets(tmp_path):
    probe = render.SfizzRenderer.probe(engine_path=tmp_path / 'sfizz.dll',
                                       asset_path=tmp_path / 'piano.sfz')
    assert any('not found' in blocker for blocker in probe['blockers'])


def test_sfizz_declares_only_probed_capabilities():
    """No blanket round-robin or half-pedal requirement: support comes from measurements."""
    capabilities = {'features': {'velocity layers': {'supported': True},
                                 'release samples': {'supported': False},
                                 'sustain pedal behaviour': {'supported': True}},
                    'unsupported_mandatory': ['release samples']}
    renderer = render.SfizzRenderer(capabilities=capabilities)
    support = renderer.controls()
    assert support.velocity is False  # Raw or failed feature claims are not bound evidence.
    assert support.sustain_pedal is False
    assert support.key_release is False
    assert support.half_pedal is False
    assert support.resonance is False

    probe = render.SfizzRenderer.probe(capabilities=capabilities)
    assert probe['available'] is False
    assert any('unsupported' in blocker for blocker in probe['blockers'])

    untested = render.SfizzRenderer.probe()
    assert any('untested' in blocker for blocker in untested['blockers'])


def test_rendering_a_sixty_note_chord_stays_finite():
    notes = [note(note_id=f'n{index}', pitch=36 + index, onset=0.1, velocity=100)
             for index in range(60)]
    result = renderer().render(document(*notes), SPEC)
    assert np.all(np.isfinite(result.audio))
    assert result.peak() <= 1.0
