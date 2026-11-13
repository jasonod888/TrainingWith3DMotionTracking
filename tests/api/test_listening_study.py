"""W3: the builder applies one common treatment and the analyser guards every submission."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

import scripts.analyze_listening_study as analysis
import scripts.build_listening_study as listening
from scripts.piano_reconstruction_harness import write_wav

RATE = 8000
SECONDS = 12.0


def tone(seconds=SECONDS, rate=RATE, frequency=220.0, amplitude=0.3):
    times = np.arange(int(seconds * rate)) / rate
    return (amplitude * np.sin(2 * np.pi * frequency * times)).astype(np.float32)


def corpus(directory, rate=RATE):
    directory.mkdir(parents=True, exist_ok=True)
    write_wav(directory / 'reference.wav', tone(seconds=SECONDS, rate=rate), rate, bit_depth=16)
    write_wav(directory / 'model.wav', tone(seconds=SECONDS, rate=rate, frequency=223.0), rate,
              bit_depth=16)
    write_wav(directory / 'refined.wav', tone(seconds=SECONDS, rate=rate, frequency=219.0), rate,
              bit_depth=16)
    return directory


def spec(directory, interval=(0.5, 10.5), excerpts=2):
    return {
        'title': 'Pilot',
        'seed': 'test-seed',
        'blinding_key': 'fixed-private-test-key',
        'excerpts': [
            {'id': f'ex{index + 1:02d}', 'title': f'Excerpt {index + 1}',
             'reference': str(directory / 'reference.wav'),
             'interval': list(interval),
             'candidates': [
                 {'role': 'model_only', 'path': str(directory / 'model.wav')},
                 {'role': 'refinement', 'path': str(directory / 'refined.wav')},
             ],
             'attribution': 'Synthetic development material'}
            for index in range(excerpts)
        ],
    }


def build(tmp_path, **overrides):
    directory = corpus(tmp_path / 'audio')
    spec_path = tmp_path / 'spec.json'
    spec_path.write_text(json.dumps(spec(directory, **overrides)), encoding='utf-8')
    output = tmp_path / 'study'
    study = listening.build(spec_path, output, created_at='2026-11-12T10:00:00Z')
    return output, study


def study_sha(output):
    return hashlib.sha256((output / 'study.json').read_bytes()).hexdigest()


def label_index_for(study, rotation, item, role):
    order = rotation['label_order'][item['item_id']]
    return next(index for index, candidate_index in enumerate(order)
                if item['candidates'][candidate_index]['role'] == role)


def session(study, listener_id, scores, *, sha, omit=None, minutes=30, extra=None):
    rotation = study['rotations'][listening.rotation_index(listener_id,
                                                           study['rotation_count'])]
    started = datetime(2026, 11, 12, 10, 0, tzinfo=timezone.utc)
    ratings = []
    for item in study['items']:
        for role, score in scores.items():
            if omit and (item['item_id'], role) == omit:
                continue
            index = label_index_for(study, rotation, item, role)
            ratings.append({'item_id': item['item_id'], 'label': chr(65 + index),
                            'label_index': index, 'score': score, 'confidence': 3})
    if extra:
        ratings.extend(extra)
    return {'schema': 'piano-listening-ratings-1', 'listener_id': listener_id,
            'study_sha256': sha, 'rotation': rotation['index'],
            'started_at': started.isoformat(),
            'finished_at': (started + timedelta(minutes=minutes)).isoformat(),
            'equipment': 'synthetic', 'ratings': ratings}


SCORES = {'hidden_reference': 95, 'degraded_reference': 20,
          'model_only': 50, 'refinement': 70}


def sessions_for(study, sha, count=5, scores=None):
    return [session(study, f'L{index:02d}', scores or SCORES, sha=sha)
            for index in range(1, count + 1)]


# ------------------------------------------------------------------------------- builder

def test_build_writes_reference_candidates_and_controls(tmp_path):
    output, study = build(tmp_path)
    assert study['schema'] == listening.SCHEMA
    assert study['question'] == listening.QUESTION
    assert [anchor['value'] for anchor in study['scale']] == [0, 25, 50, 75, 100]
    assert len(study['items']) == 2
    for item in study['items']:
        roles = sorted(candidate['role'] for candidate in item['candidates'])
        assert roles == ['degraded_reference', 'hidden_reference', 'model_only', 'refinement']
        assert (output / item['reference']['file']).is_file()
        for candidate in item['candidates']:
            assert (output / candidate['file']).is_file()
    assert study['warnings'] == []
    assert (output / 'instructions.md').is_file()
    assert (output / 'consent.md').is_file()
    assert (output / 'ratings.template.csv').is_file()


def test_build_is_deterministic_for_a_seed(tmp_path):
    directory = corpus(tmp_path / 'audio')
    spec_path = tmp_path / 'spec.json'
    spec_path.write_text(json.dumps(spec(directory)), encoding='utf-8')
    first = listening.build(spec_path, tmp_path / 'one', created_at='2026-11-12T10:00:00Z')
    second = listening.build(spec_path, tmp_path / 'two', created_at='2026-11-12T10:00:00Z')
    assert first == second


def test_interval_bounds_are_enforced(tmp_path):
    with pytest.raises(listening.StudyError, match='8-15s'):
        build(tmp_path / 'short', interval=(0.0, 5.0))
    with pytest.raises(listening.StudyError, match='8-15s'):
        build(tmp_path / 'long', interval=(0.0, 20.0))


def test_sample_rate_mismatch_is_refused(tmp_path):
    directory = corpus(tmp_path / 'audio')
    write_wav(directory / 'model.wav', tone(seconds=SECONDS, rate=16000), 16000, bit_depth=16)
    spec_path = tmp_path / 'spec.json'
    spec_path.write_text(json.dumps(spec(directory)), encoding='utf-8')
    with pytest.raises(listening.StudyError, match='resampling'):
        listening.build(spec_path, tmp_path / 'study')


def test_silent_reference_is_refused(tmp_path):
    directory = corpus(tmp_path / 'audio')
    write_wav(directory / 'reference.wav', np.zeros(int(SECONDS * RATE), dtype=np.float32),
              RATE, bit_depth=16)
    spec_path = tmp_path / 'spec.json'
    spec_path.write_text(json.dumps(spec(directory)), encoding='utf-8')
    with pytest.raises(listening.StudyError, match='silent'):
        listening.build(spec_path, tmp_path / 'study')


def test_a_built_study_is_immutable(tmp_path):
    output, _study = build(tmp_path)
    spec_path = tmp_path / 'spec.json'
    with pytest.raises(listening.StudyError, match='immutable'):
        listening.build(spec_path, output)


def test_verify_detects_a_modified_stimulus(tmp_path):
    output, study = build(tmp_path)
    assert listening.verify(output / 'study.json')['ok'] is True
    target = output / study['items'][0]['candidates'][0]['file']
    write_wav(target, tone(seconds=SECONDS), RATE, bit_depth=16)
    result = listening.verify(output / 'study.json')
    assert result['ok'] is False
    assert any(issue['problem'] == 'hash mismatch' for issue in result['issues'])


def test_rotations_are_permutations_and_labels_vary_by_listener(tmp_path):
    _output, study = build(tmp_path)
    item = study['items'][0]
    orders = {tuple(rotation['label_order'][item['item_id']])
              for rotation in study['rotations']}
    assert len(orders) > 1
    for rotation in study['rotations']:
        order = rotation['label_order'][item['item_id']]
        assert sorted(order) == list(range(len(item['candidates'])))
        assert sorted(rotation['item_order']) == list(range(len(study['items'])))


def test_rotation_rule_matches_the_documented_sum_of_code_units():
    assert listening.rotation_index('L01', 24) == sum(ord(c) for c in 'L01') % 24
    assert listening.rotation_index('L01', 24) == listening.rotation_index('L01', 24)


def test_common_gain_is_derived_from_the_reference_only():
    reference = tone(amplitude=0.2)
    loud = tone(amplitude=0.8)
    gain = listening.gain_for(reference)
    assert listening.gain_for(reference) == pytest.approx(gain)
    assert listening.gain_for(reference) != pytest.approx(listening.gain_for(loud))


def test_degradation_changes_the_signal():
    source = tone()
    degraded = listening.degrade(source, RATE)
    assert not np.array_equal(source, degraded)
    assert np.count_nonzero(degraded[:int(0.1 * RATE)]) == 0


def test_browser_manifest_hides_roles_and_uses_opaque_names(tmp_path):
    output, study = build(tmp_path)
    browser = json.loads((output / 'study.browser.json').read_text(encoding='utf-8'))
    assert browser['schema'] == 'piano-listening-browser-1'
    assert browser['analyst_manifest_sha256'] == study_sha(output)
    text = json.dumps(browser)
    for role in ('hidden_reference', 'degraded_reference', 'model_only', 'refinement'):
        assert role not in text
    for item in browser['items']:
        for candidate in item['candidates']:
            assert candidate['file'].endswith('.wav')
            assert 'hidden' not in candidate['file']
            assert 'model' not in candidate['file']
    assert all('role' not in candidate for item in browser['items']
               for candidate in item['candidates'])


# ------------------------------------------------------------------------------ analysis

def test_analysis_decodes_roles_and_reports_paired_gain(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    report = analysis.summarise(study, sessions_for(study, sha), iterations=200,
                                study_sha256=sha)
    roles = report['roles']
    assert roles['hidden_reference']['mean'] == pytest.approx(95.0)
    assert roles['degraded_reference']['mean'] == pytest.approx(20.0)
    assert roles['model_only']['mean'] == pytest.approx(50.0)
    refinement = next(item for item in report['comparisons']
                      if item['candidate'] == 'refinement')
    assert refinement['baseline'] == 'model_only'
    assert refinement['mean_gain_points'] == pytest.approx(20.0)
    assert refinement['ci_low'] <= 20.0 <= refinement['ci_high']
    assert refinement['cells'] == 2 * 5
    assert refinement['exploratory'] is True
    assert report['attention']['hidden_reference_ok'] is True
    assert report['attention']['degraded_reference_ok'] is True
    assert report['sessions']['included'] == 5


def test_paired_interval_reflects_listener_disagreement(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    sessions = []
    for index in range(1, 7):
        scores = dict(SCORES)
        scores['refinement'] = 55 + index * 5      # spread from 60 to 85
        sessions.append(session(study, f'L{index:02d}', scores, sha=sha))
    report = analysis.summarise(study, sessions, iterations=400, study_sha256=sha)
    refinement = next(item for item in report['comparisons']
                      if item['candidate'] == 'refinement')
    assert refinement['ci_high'] > refinement['ci_low']
    assert refinement['ci_low'] <= refinement['mean_gain_points'] <= refinement['ci_high']


def test_legacy_study_cannot_make_a_comparison_non_exploratory(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    study['comparisons'] = [{'candidate': 'refinement', 'baseline': 'model_only'}]
    report = analysis.summarise(study, sessions_for(study, sha), iterations=100,
                                study_sha256=sha)
    assert [item['candidate'] for item in report['comparisons']] == ['refinement']
    # Without a verified parent-performance mapping the study stays legacy diagnostic.
    assert report['comparisons'][0]['exploratory'] is True
    assert report['comparisons'][0]['legacy_diagnostic'] is True


def test_a_required_study_identity_is_enforced(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    with pytest.raises(analysis.AnalysisError, match='study identity'):
        analysis.summarise(study, sessions_for(study, sha), study_sha256=None)

    missing = session(study, 'L01', SCORES, sha=None)
    report = analysis.summarise(study, [missing], study_sha256=sha, iterations=50)
    assert report['sessions']['excluded'] == 1
    assert 'identity missing' in report['exclusions'][0]['reasons'][0]


def test_a_session_from_another_study_build_is_excluded(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    report = analysis.summarise(study, [session(study, 'L01', SCORES, sha='f' * 64)],
                                study_sha256=sha, iterations=50)
    assert report['sessions']['excluded'] == 1
    assert 'different study build' in report['exclusions'][0]['reasons'][0]


def test_duplicate_ratings_within_one_submission_are_excluded(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    good = session(study, 'L01', SCORES, sha=sha)
    duplicate = dict(good['ratings'][0])
    good['ratings'].append(duplicate)
    report = analysis.summarise(study, [good], study_sha256=sha, iterations=50)
    assert report['sessions']['excluded'] == 1
    assert any('more than once' in reason for reason in report['exclusions'][0]['reasons'])


def test_duplicate_submissions_are_quarantined_not_double_counted(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    first = session(study, 'L01', SCORES, sha=sha)
    second = session(study, 'L01', SCORES, sha=sha)
    report = analysis.summarise(study, [first, second], study_sha256=sha, iterations=50)
    assert report['sessions']['included'] == 0
    assert report['duplicate_listeners'] == ['L01']
    assert all('duplicate submissions' in reason
               for item in report['exclusions'] for reason in item['reasons'])


def test_keep_first_policy_retains_one_submission(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    first = session(study, 'L01', SCORES, sha=sha)
    second = session(study, 'L01', SCORES, sha=sha)
    report = analysis.summarise(study, [first, second], study_sha256=sha, iterations=50,
                                duplicate_policy='keep_first')
    assert report['sessions']['included'] == 1
    assert any('later duplicate' in reason
               for item in report['exclusions'] for reason in item['reasons'])


def test_invalid_or_missing_timestamps_are_excluded(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    broken = session(study, 'L01', SCORES, sha=sha)
    broken['finished_at'] = 'not a timestamp'
    report = analysis.summarise(study, [broken], study_sha256=sha, iterations=50)
    assert report['sessions']['excluded'] == 1
    assert any('timestamps' in reason for reason in report['exclusions'][0]['reasons'])


def test_negative_session_duration_is_excluded(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    backwards = session(study, 'L01', SCORES, sha=sha, minutes=-5)
    report = analysis.summarise(study, [backwards], study_sha256=sha, iterations=50)
    assert report['sessions']['excluded'] == 1
    assert any('precedes its start' in reason for reason in report['exclusions'][0]['reasons'])


def test_overlong_and_straight_lined_sessions_are_excluded(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    flat = {role: 50 for role in SCORES}
    sessions = [session(study, 'L01', flat, sha=sha),
                session(study, 'L02', SCORES, sha=sha, minutes=95)]
    report = analysis.summarise(study, sessions, study_sha256=sha, iterations=50)
    reasons = ' '.join(' '.join(item['reasons']) for item in report['exclusions'])
    assert 'straight-lined' in reasons
    assert 'min cap' in reasons


def test_incomplete_session_is_excluded_with_a_reason(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    sessions = [session(study, 'L01', SCORES, sha=sha),
                session(study, 'L02', SCORES, sha=sha, omit=('ex01', 'model_only'))]
    report = analysis.summarise(study, sessions, study_sha256=sha, iterations=50)
    assert report['sessions']['included'] == 1
    assert report['sessions']['excluded'] == 1
    assert 'missing' in report['exclusions'][0]['reasons'][0]


def test_conclusions_are_suppressed_with_too_few_listeners(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    report = analysis.summarise(study, [session(study, 'L01', SCORES, sha=sha)],
                                study_sha256=sha, iterations=50)
    assert report['coverage']['adequate'] is False
    assert report['conclusion'] is None
    assert 'suppressed' in analysis.markdown(report)


def test_report_markdown_states_the_scale_boundary(tmp_path):
    output, study = build(tmp_path)
    sha = study_sha(output)
    report = analysis.summarise(study, sessions_for(study, sha), iterations=50,
                                study_sha256=sha)
    text = analysis.markdown(report)
    assert '95% CI' in text
    assert 'not an indistinguishability probability' in text
    assert 'predeclared' in text or 'exploratory' in text


def test_cli_rejects_a_session_with_the_wrong_schema(tmp_path, capsys):
    output, study = build(tmp_path)
    sha = study_sha(output)
    good = session(study, 'L01', SCORES, sha=sha)
    path = tmp_path / 'session.json'
    path.write_text(json.dumps(dict(good, schema='nope')), encoding='utf-8')
    code = analysis.main(['--study', str(output / 'study.json'),
                          '--ratings', str(path)])
    assert code == 2
    assert 'schema' in capsys.readouterr().err


def test_instrument_page_uses_the_browser_manifest_and_rotation_rule():
    root = Path('tools/listening-instrument')
    assert (root / 'index.html').is_file()
    page = (root / 'index.html').read_text(encoding='utf-8')
    script = (root / 'app.js').read_text(encoding='utf-8')
    protocol = (root / 'protocol.js').read_text(encoding='utf-8')
    assert 'app.js' in page and 'styles.css' in page
    assert 'type="module"' in page
    assert 'piano-listening-ratings-1' in protocol
    assert 'sumCodeUnits' in protocol
    assert 'rotation_count' in protocol
    assert 'rotationFor' in script
    assert 'study.browser.json' in script
    assert 'analyst_manifest_sha256' in script
    assert "from './protocol.js'" in script


def test_cli_refuses_a_study_whose_stimulus_changed(tmp_path, capsys):
    output, study = build(tmp_path)
    sha = study_sha(output)
    good = session(study, 'L01', SCORES, sha=sha)
    path = tmp_path / 'session.json'
    path.write_text(json.dumps(good), encoding='utf-8')
    assert analysis.main(['--study', str(output / 'study.json'),
                          '--ratings', str(path), '--iterations', '10']) == 0
    capsys.readouterr()

    write_wav(output / study['items'][0]['candidates'][0]['file'], tone(), RATE, bit_depth=16)
    code = analysis.main(['--study', str(output / 'study.json'), '--ratings', str(path)])
    assert code == 2
    assert 'verification failed' in capsys.readouterr().err


def test_instrument_protocol_selftest_passes():
    """The resume/export logic is tested directly with node."""
    import subprocess
    script = Path('tools/listening-instrument/selftest.mjs')
    result = subprocess.run([node_binary(), str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert 'selftest: ok' in result.stdout


def node_binary():
    import shutil
    binary = shutil.which('node')
    if not binary:
        pytest.skip('node is not available in this environment')
    return binary
