"""M5: listening inference is performance-nested and stereo stays diagnostic."""
import hashlib
import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

import scripts.analyze_listening_study as analysis
import scripts.build_listening_study as listening
import scripts.piano_reconstruction_metrics as metrics
from scripts.piano_reconstruction_harness import write_wav

RATE = 8000
SECONDS = 12.0


def tone(frequency=220.0, amplitude=0.3):
    times = np.arange(int(SECONDS * RATE)) / RATE
    return (amplitude * np.sin(2 * np.pi * frequency * times)).astype(np.float32)


def corpus(directory):
    directory.mkdir(parents=True, exist_ok=True)
    write_wav(directory / 'reference.wav', tone(), RATE, bit_depth=16)
    write_wav(directory / 'model.wav', tone(223.0), RATE, bit_depth=16)
    write_wav(directory / 'refined.wav', tone(219.0), RATE, bit_depth=16)
    return directory


def spec(directory, excerpts):
    performances = {}
    for _identifier, performance in excerpts:
        performances.setdefault(performance, {
            'recording_id': performance.split('-')[0],
            'performer_id': f'performer-{performance.split("-")[1]}'})
    return {'title': 'Hierarchy pilot', 'seed': 'hierarchy',
            'performances': performances,
            'excerpts': [{'id': identifier, 'title': identifier,
                          'performance_id': performance,
                          'recording_id': performance.split('-')[0],
                          'reference': str(directory / 'reference.wav'),
                          'interval': [0.5, 10.5],
                          'candidates': [
                              {'role': 'model_only', 'path': str(directory / 'model.wav')},
                              {'role': 'refinement', 'path': str(directory / 'refined.wav')}],
                          'attribution': 'Synthetic development material'}
                         for identifier, performance in excerpts]}


def build(tmp_path, excerpts):
    directory = corpus(tmp_path / 'audio')
    spec_path = tmp_path / 'spec.json'
    spec_path.write_text(json.dumps(spec(directory, excerpts)), encoding='utf-8')
    output = tmp_path / 'study'
    study = listening.build(spec_path, output, created_at='2026-11-12T10:00:00Z')
    return output, study


def study_sha(output):
    return hashlib.sha256((output / 'study.json').read_bytes()).hexdigest()


def label_index_for(study, rotation, item, role):
    order = rotation['label_order'][item['item_id']]
    return next(index for index, candidate_index in enumerate(order)
                if item['candidates'][candidate_index]['role'] == role)


def session(study, listener_id, score_for, *, sha):
    rotation = study['rotations'][listening.rotation_index(listener_id,
                                                           study['rotation_count'])]
    started = datetime(2026, 11, 12, 10, 0, tzinfo=timezone.utc)
    ratings = []
    for item in study['items']:
        scores = score_for(item)
        for role, value in scores.items():
            index = label_index_for(study, rotation, item, role)
            ratings.append({'item_id': item['item_id'], 'label': chr(65 + index),
                            'label_index': index, 'score': value, 'confidence': 3})
    return {'schema': 'piano-listening-ratings-1', 'listener_id': listener_id,
            'study_sha256': sha, 'rotation': rotation['index'],
            'started_at': started.isoformat(),
            'finished_at': (started + timedelta(minutes=20)).isoformat(),
            'equipment': 'synthetic', 'ratings': ratings}


def paired_study(tmp_path, p1_excerpts=2):
    excerpts = [(f'ex0{index + 1}', 'perf-1') for index in range(p1_excerpts)]
    excerpts += [('ex10', 'perf-2'), ('ex11', 'perf-2')]
    output, study = build(tmp_path, excerpts)
    return output, study


def analyse(study, output, per_item_scores):
    sha = study_sha(output)
    sessions = [session(study, f'L{index:02d}', per_item_scores, sha=sha)
                for index in range(1, 6)]
    return analysis.summarise(study, sessions, study_sha256=sha, iterations=200)


def scores_by_performance(item):
    if item['performance_id'] == 'perf-1':
        return {'model_only': 50, 'refinement': 70, 'hidden_reference': 95,
                'degraded_reference': 20}
    return {'model_only': 50, 'refinement': 50, 'hidden_reference': 95,
            'degraded_reference': 20}


def test_items_carry_a_parent_performance():
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as directory:
        tmp = Path(directory)
        output, study = paired_study(tmp)
        assert study['analysis']['version'] == analysis.ANALYSIS_VERSION
        assert study['analysis']['performance_mapping_verified'] is True
        assert {item['performance_id'] for item in study['items']} == {'perf-1', 'perf-2'}
        assert len(study['items']) == 4


def test_excerpts_default_to_legacy_mapping_and_report_it(tmp_path):
    directory = corpus(tmp_path / 'audio')
    spec_value = {'title': 'Legacy', 'seed': 'legacy',
                  'excerpts': [{'id': 'ex01', 'reference': str(directory / 'reference.wav'),
                                'interval': [0.5, 10.5],
                                'candidates': [
                                    {'role': 'model_only', 'path': str(directory / 'model.wav')}],
                                'attribution': 'Synthetic'}]}
    spec_path = tmp_path / 'spec.json'
    spec_path.write_text(json.dumps(spec_value), encoding='utf-8')
    output = tmp_path / 'study'
    study = listening.build(spec_path, output, created_at='2026-11-12T10:00:00Z')
    assert study['analysis']['performance_mapping_verified'] is False
    assert study['items'][0]['performance_mapping'] == 'excerpt-default'

    sha = study_sha(output)
    sessions = [session(study, f'L{index:02d}', lambda item: {'model_only': 50}, sha=sha)
                for index in range(1, 7)]
    report = analysis.summarise(study, sessions, study_sha256=sha, iterations=50)
    assert report['legacy_diagnostic'] is True
    assert report['coverage']['performances'] is None
    assert report['coverage']['adequate'] is False
    assert report['conclusion'] is None


def test_performances_are_weighted_equally_not_by_excerpt_count(tmp_path):
    output, study = paired_study(tmp_path, p1_excerpts=4)
    report = analyse(study, output, scores_by_performance)
    comparison = report['comparisons'][0]
    # perf-1 contributes +20, perf-2 contributes 0, so the performance-equal mean is +10.
    # An excerpt-weighted mean would be (4*20 + 2*0)/6 = 13.33.
    assert comparison['mean_gain_points'] == pytest.approx(10.0, abs=1e-6)
    assert comparison['performances'] == 2
    assert comparison['listeners'] == 5
    assert report['coverage']['performances'] == 2
    assert report['coverage']['adequate'] is True


def test_duplicating_windows_does_not_increase_independent_units(tmp_path):
    small = paired_study(tmp_path / 'small', p1_excerpts=1)
    large = paired_study(tmp_path / 'large', p1_excerpts=5)
    small_report = analyse(small[1], small[0], scores_by_performance)
    large_report = analyse(large[1], large[0], scores_by_performance)
    assert small_report['coverage']['performances'] == 2
    assert large_report['coverage']['performances'] == 2          # more windows, same units
    assert large_report['comparisons'][0]['excerpts'] > \
        small_report['comparisons'][0]['excerpts']
    assert large_report['comparisons'][0]['mean_gain_points'] == pytest.approx(
        small_report['comparisons'][0]['mean_gain_points'], abs=1e-6)


def test_within_performance_dependence_does_not_narrow_the_interval(tmp_path):
    """Identical windows of one performance must not behave like extra performances."""
    one = paired_study(tmp_path / 'one', p1_excerpts=1)
    many = paired_study(tmp_path / 'many', p1_excerpts=5)
    one_report = analyse(one[1], one[0], scores_by_performance)
    many_report = analyse(many[1], many[0], scores_by_performance)
    one_width = (one_report['comparisons'][0]['ci_high']
                 - one_report['comparisons'][0]['ci_low'])
    many_width = (many_report['comparisons'][0]['ci_high']
                  - many_report['comparisons'][0]['ci_low'])
    assert many_width <= one_width + 1e-6


def test_a_verified_study_keeps_a_predeclared_comparison_non_exploratory(tmp_path):
    output, study = paired_study(tmp_path)
    study['comparisons'] = [{'candidate': 'refinement', 'baseline': 'model_only'}]
    report = analyse(study, output, scores_by_performance)
    assert report['comparisons'][0]['candidate'] == 'refinement'
    assert report['comparisons'][0]['exploratory'] is False
    assert report['comparisons'][0]['legacy_diagnostic'] is False \
        if 'legacy_diagnostic' in report['comparisons'][0] else True
    assert report['coverage']['performance_mapping_verified'] is True


def test_performer_hierarchy_preserves_performance_weighting(tmp_path):
    """Review P1: two performances in one performer with 4 and 2 excerpts must give +10."""
    directory = corpus(tmp_path / 'audio')
    excerpts = [('ex01', 'perf-1'), ('ex02', 'perf-1'), ('ex03', 'perf-1'),
                ('ex04', 'perf-1'), ('ex05', 'perf-2'), ('ex06', 'perf-2')]
    spec_value = spec(directory, excerpts)
    spec_value['performances'] = {
        'perf-1': {'recording_id': 'recording-a', 'performer_id': 'performer-shared'},
        'perf-2': {'recording_id': 'recording-b', 'performer_id': 'performer-shared'},
    }
    for item in spec_value['excerpts']:
        item['recording_id'] = ('recording-a' if item['performance_id'] == 'perf-1'
                                else 'recording-b')
    spec_path = tmp_path / 'spec.json'
    spec_path.write_text(json.dumps(spec_value), encoding='utf-8')
    output = tmp_path / 'study'
    study = listening.build(spec_path, output, created_at='2026-11-12T10:00:00Z')
    report = analyse(study, output, scores_by_performance)
    comparison = report['comparisons'][0]
    # perf-1 contributes +20 over four excerpts, perf-2 contributes 0 over two.
    # Excerpt-weighted would be 13.33; performance-equal within the performer is 10.0.
    assert comparison['mean_gain_points'] == pytest.approx(10.0, abs=1e-6)
    assert comparison['performances'] == 2
    assert comparison['performers'] == 1
    assert comparison['weighting'].startswith('excerpt -> performance -> performer')


def test_performer_hierarchy_is_used_when_registered(tmp_path):
    """Two performances from one performer provide one top-level unit, not two."""
    directory = corpus(tmp_path / 'audio')
    spec_value = spec(directory, [('ex01', 'perf-1'), ('ex02', 'perf-2')])
    spec_value['performances'] = {
        'perf-1': {'recording_id': 'recording-a', 'performer_id': 'performer-shared'},
        'perf-2': {'recording_id': 'recording-b', 'performer_id': 'performer-shared'},
    }
    spec_value['excerpts'][0]['recording_id'] = 'recording-a'
    spec_value['excerpts'][1]['recording_id'] = 'recording-b'
    spec_path = tmp_path / 'spec.json'
    spec_path.write_text(json.dumps(spec_value), encoding='utf-8')
    output = tmp_path / 'study'
    study = listening.build(spec_path, output, created_at='2026-11-12T10:00:00Z')
    assert study['analysis']['performance_mapping_verified'] is True
    assert {item['performer_id'] for item in study['items']} == {'performer-shared'}
    report = analyse(study, output, scores_by_performance)
    assert report['coverage']['performances'] == 2
    assert report['coverage']['performers'] == 1
    assert report['coverage']['top_unit'] == 'performer'
    assert report['comparisons'][0]['top_unit'] == 'performer'
    # One performer cannot establish generalisation, so the study is not adequate.
    assert report['coverage']['adequate'] is False
    assert report['conclusion'] is None


def test_a_registry_recording_mismatch_is_rejected(tmp_path):
    directory = corpus(tmp_path / 'audio')
    spec_value = spec(directory, [('ex01', 'perf-1')])
    spec_value['performances'] = {'perf-1': {'recording_id': 'recording-a',
                                             'performer_id': 'performer-1'}}
    spec_value['excerpts'][0]['recording_id'] = 'different-recording'
    spec_path = tmp_path / 'spec.json'
    spec_path.write_text(json.dumps(spec_value), encoding='utf-8')
    with pytest.raises(listening.StudyError, match='does not match the registered recording'):
        listening.build(spec_path, tmp_path / 'study')


def test_stereo_diagnostics_are_always_diagnostic():
    times = np.arange(int(0.5 * RATE)) / RATE
    mono = (0.3 * np.sin(2 * np.pi * 220 * times)).astype(np.float32)
    unavailable = metrics.stereo_diagnostics(mono, mono, RATE)
    assert unavailable['status'] == 'unavailable'
    assert unavailable['supported_for_qualification'] is False

    stereo = np.stack([mono, mono], axis=1)
    result = metrics.stereo_diagnostics(stereo, stereo, RATE)
    assert result['status'] == 'diagnostic_only'
    assert result['supported_for_qualification'] is False
    assert result['reference']['balance_db'] == pytest.approx(0.0, abs=1e-6)
    assert result['reference']['correlation'] == pytest.approx(1.0, abs=1e-6)
    assert result['reference']['width_db'] < -50


def test_stereo_balance_changes_are_visible():
    times = np.arange(int(0.5 * RATE)) / RATE
    left = (0.3 * np.sin(2 * np.pi * 220 * times)).astype(np.float32)
    right = (0.15 * np.sin(2 * np.pi * 220 * times)).astype(np.float32)
    reference = np.stack([left, right], axis=1)
    candidate = np.stack([left, left], axis=1)
    result = metrics.stereo_diagnostics(reference, candidate, RATE)
    assert result['reference']['balance_db'] > 3.0
    assert abs(result['candidate']['balance_db']) < 1e-6
