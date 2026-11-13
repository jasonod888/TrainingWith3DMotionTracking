"""Phase-4 expression estimates are conservative and bound to corrected working notes."""
import hashlib
import json
import tempfile
import wave
from pathlib import Path

import numpy as np
import pytest

import apps.api.music_verification as verification
from apps.api.music_corrections import file_sha256
from apps.api.music_verification import automatic_expression_document, proposal_sha256
import scripts.piano_expression as expression_module
from scripts.piano_expression_identity import estimator_sha256, measurement_sha256
from scripts.piano_expression import analyze, estimate_duration, estimate_dynamics
from scripts.validate_expression_reference import validate_document
from scripts.piano_verifier import (DEFAULT_SETTINGS, analyze_audio,
                                   validate_expression_policy)
from scripts.qualify_piano_expression import build_policy

SR = 22050


def tone(pitch, onset, duration, amplitude=0.4, tau=0.4, clip=3.0):
    times = np.arange(int(clip * SR)) / SR
    local = times - onset
    values = np.zeros(len(times))
    active = (local >= 0) & (local < duration)
    values[active] = amplitude * np.sin(2 * np.pi * 440 * 2 ** ((pitch - 69) / 12) * local[active])
    values[active] *= np.exp(-local[active] / tau)
    return values


def event(identifier, onset, pitch, duration=0.2, velocity=0.5):
    return {'id': identifier, 'onset': onset, 'duration': duration,
            'pitch': pitch, 'velocity': velocity}


def implementation():
    return {'estimator_code_sha256': estimator_sha256(),
            'verifier_code_sha256': file_sha256(Path('scripts/piano_verifier.py')),
            'settings_sha256': hashlib.sha256(
                json.dumps(DEFAULT_SETTINGS, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'weights_sha256': 'a' * 64, 'model': 'basic-pitch', 'model_version': '0.4.0',
            'decoder': 'basic-pitch-0.4.0/piano-peaks-v1',
            'decoder_sha256': 'd' * 64,
            'application_code_sha256': file_sha256(Path('apps/api/music_verification.py'))}


def document(events):
    return {'draft_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'},
            'duration': 3.0,
            'reference': {'key': 'reference.json', 'mime': 'application/json', 'bytes': 10,
                          'sha256': 'a' * 64},
            'events': events, 'spans': [{'start': 0.1, 'end': 2.8}], 'guitar_chords': [],
            'provenance': {'adapter': 'test', 'engine': 'local', 'model': None,
                           'model_version': None, 'code_version': 'test',
                           'audio_sha256': 'b' * 64}, 'warnings': []}


def report(events, proposals, *, enabled=('audible_duration', 'relative_dynamics'),
           before_ok=True, ambiguous=False, candidate_status='qualified'):
    impl = implementation()
    categories = {
        'audible_duration': {'enabled': 'audible_duration' in enabled, 'implemented': True},
        'relative_dynamics': {'enabled': 'relative_dynamics' in enabled, 'implemented': True},
        'pedal': {'enabled': False, 'implemented': False},
        'key_release': {'enabled': False, 'implemented': False},
        'written_rhythm': {'enabled': False, 'implemented': False},
    }
    policy = {'policy_version': 'piano-expression-1', 'status': 'qualified',
              'categories': categories, 'implementation': impl}
    payload = []
    for note, item in zip(events, proposals):
        payload.append({**item, 'event_id': note['id'], 'decision': 'change',
                        'target_kind': 'audible_end_seconds', 'units': 'seconds',
                        'scope': 'isolated',
                        'baseline': item.get('before'), 'proposed': item.get('value'),
                        'status': candidate_status, 'proposal_status': 'suggested',
                        'correction_status': 'qualified', 'application': 'automatic',
                        'ambiguous': ambiguous, 'candidate_interval': [item['value'] - .04,
                                                                      item['value'] + .04]})
    return {'schema_version': 2, 'schema': 'piano-expression-report-2',
            'version': 'piano-expression-1', 'mode': 'qualified',
            'source': {'working_sha256': proposal_sha256(events), 'audio_sha256': 'b' * 64,
                       **{key: impl[key] for key in ('weights_sha256', 'decoder_sha256',
                                                    'model', 'model_version', 'decoder')}},
            'status': 'complete', 'working_sha256': proposal_sha256(events),
            'settings_sha256': impl['settings_sha256'], 'policy': {**policy,
                                                                    'enabled_categories': list(enabled),
                                                                    'policy_sha256': hashlib.sha256(
                                                                        json.dumps(policy, sort_keys=True,
                                                                                   separators=(',', ':')).encode()).hexdigest()},
            'candidates': payload}


def test_diagnostic_candidates_are_reported_without_an_enabled_policy(tmp_path):
    audio = tone(60, 0.2, 1.2, tau=0.25)
    path = tmp_path / 'analysis.wav'
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(SR)
        stream.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
    events = [event('e', 0.2, 60, 0.2)]
    report = analyze(path, events, 3.0, DEFAULT_SETTINGS, None, 'qualified',
                     analyze_dynamics=True)
    assert report['schema_version'] == 2
    assert report['status'] == 'complete'
    assert report['candidates']
    assert report['proposals'] == []
    assert report['coverage']['duration_considered'] == 1
    assert report['analysis_switches']['audible_duration'] is True


def test_reference_validator_requires_intervals_not_key_release():
    base = {'reference_version': 1, 'performance_id': 'p', 'piece_id': 'piece',
            'instrument': 'piano', 'split': 'holdout', 'audio_sha256': 'a' * 64,
            'notes': [{'event_id': 'n1', 'pitch': 60, 'onset_seconds': 0.2,
                       'audible_end': {'earliest': 0.5, 'latest': 0.9},
                       'key_release_seconds': 0.7}]}
    parsed = validate_document(base)
    assert parsed['notes'][0]['audible_interval'] == [0.5, 0.9]
    bad = {**base, 'notes': [{**base['notes'][0],
                               'audible_end': {'earliest': 0.9, 'latest': 0.5}}]}
    with pytest.raises(ValueError, match='interval'):
        validate_document(bad)


def test_polyphonic_candidates_are_diagnostic_and_shared_partials_abstain():
    audio = tone(60, 0.2, 1.2, tau=0.25) + tone(67, 0.2, 1.2, 0.3, tau=0.25)
    analysis = analyze_audio(audio, SR, DEFAULT_SETTINGS)
    note = event('e', 0.2, 60, 0.2)
    unrelated = event('other', 0.2, 67, 1.2)
    candidate = expression_module._duration_candidate(analysis, note, 3.0, [note, unrelated])
    assert candidate['scope'] == 'polyphonic'
    assert candidate['status'] in ('diagnostic', 'withheld', 'no_change')
    shared = event('shared', 0.2, 72, 1.2)
    blocked = expression_module._duration_candidate(analysis, note, 3.0, [note, shared])
    assert blocked['reason'] == 'shared_partials'
    assert blocked['decision'] == 'no_change'


def test_short_note_in_noise_is_not_extended_into_the_noise_floor():
    audio = tone(60, 0.2, 0.2) + np.random.default_rng(1).normal(0, 0.0015, int(3 * SR))
    analysis = analyze_audio(audio, SR, DEFAULT_SETTINGS)
    assert estimate_duration(analysis, event('e', 0.2, 60, 0.2), 3.0,
                             [event('e', 0.2, 60, 0.2)]) is None


def test_duration_failure_does_not_erase_dynamics_coverage(tmp_path, monkeypatch):
    audio = tone(60, 0.2, 1.2, tau=0.25)
    path = tmp_path / 'analysis.wav'
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(SR)
        stream.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
    events = [event('e', 0.2, 60, 0.2)]

    def fail(*_args, **_kwargs):
        raise RuntimeError('synthetic duration failure')

    monkeypatch.setattr(expression_module, '_duration_candidate', fail)
    report = analyze(path, events, 3.0, DEFAULT_SETTINGS, None, 'diagnostic',
                     analyze_dynamics=True)
    durations = [c for c in report['candidates'] if c['attribute'] == 'audible_duration']
    dynamics = [c for c in report['candidates'] if c['attribute'] == 'relative_dynamics']
    assert durations and durations[0]['reason'] == 'estimator_failure'
    assert report['coverage']['dynamics_considered'] == 1
    assert dynamics


def test_decaying_note_gets_a_release_bound_and_clip_is_uncertain():
    # A piano attack supplies multiple partial groups; a pure sine does not.
    piano = sum(tone(60 + 12 * np.log2(h), 0.2, 1.2, amplitude=.3 / h, tau=2.0)
                for h in range(1, 9))
    analysis = analyze_audio(piano, SR, DEFAULT_SETTINGS)
    value = estimate_duration(analysis, event('e', 0.2, 60, 0.2), 3.0,
                              [event('e', 0.2, 60, 0.2)])
    assert value is not None and 0.5 < value < 2.0
    clipped = analyze_audio(tone(60, 0.2, 2.8, tau=4.0, clip=3.0), SR, DEFAULT_SETTINGS)
    assert estimate_duration(clipped, event('e', 0.2, 60, 0.2), 3.0,
                             [event('e', 0.2, 60, 0.2)]) is None


def test_known_shared_tail_regression_is_not_extended():
    # A correct ending must not be lengthened because a second sounding note keeps
    # energy high after the target attack.
    audio = tone(60, 0.2, 2.18, tau=3.0) + tone(72, 0.2, 2.5, 0.7, tau=4.0)
    analysis = analyze_audio(audio, SR, DEFAULT_SETTINGS)
    note = event('e', 0.2, 60, 2.184)
    other = event('other', 0.2, 72, 2.5)
    assert estimate_duration(analysis, note, 3.0, [note, other]) is None


def test_correct_isolated_reference_is_left_unchanged():
    analysis = analyze_audio(tone(60, 0.2, 0.55), SR, DEFAULT_SETTINGS)
    assert estimate_duration(analysis, event('e', 0.2, 60, 0.55), 3.0,
                             [event('e', 0.2, 60, 0.55)]) is None


def test_repeated_notes_and_ringing_accompaniment_bound_the_tail():
    repeated = analyze_audio(tone(60, 0.2, 0.5, tau=0.3) + tone(60, 0.8, 0.5, tau=0.3),
                             SR, DEFAULT_SETTINGS)
    events = [event('a', 0.2, 60, 0.2), event('b', 0.8, 60, 0.2)]
    repeated_value = estimate_duration(repeated, events[0], 3.0, events)
    assert repeated_value is None or 0.2 + repeated_value < 0.8
    ringing = analyze_audio(tone(48, 0.0, 2.8, 0.6, tau=6.0, clip=3.0), SR, DEFAULT_SETTINGS)
    assert estimate_duration(ringing, event('e', 0.2, 48, 0.2), 3.0,
                             [event('e', 0.2, 48, 0.2)]) is None


def test_dynamics_does_not_follow_overlapping_accompaniment():
    audio = tone(60, 0.2, 0.8, 0.5) + tone(40, 0.2, 1.0, 0.8)
    analysis = analyze_audio(audio, SR, DEFAULT_SETTINGS)
    events = [event('a', 0.2, 60, 0.8), event('b', 0.8, 60, 0.8)]
    assert estimate_dynamics(analysis, events) == {}


def test_expression_application_preserves_notation_and_rejects_bad_preconditions():
    events = [{'id': 'e', 'onset': 0.2, 'duration': 0.2, 'pitch': 60,
               'velocity': 0.5, 'notation_duration': 0.2}]
    base = document(events)
    value = report(events, [{'attribute': 'audible_duration', 'value': 1.2, 'before': 0.2}])
    working, history = automatic_expression_document(base, value)
    assert working is not None and working['events'][0]['duration'] == 1.2
    assert working['events'][0]['notation_duration'] == 0.2
    assert history[0]['before'] == 0.2
    bad = report(events, [{'attribute': 'audible_duration', 'value': 1.2, 'before': 0.9}])
    assert automatic_expression_document(base, bad)[0] is None
    ambiguous = report(events, [{'attribute': 'audible_duration', 'value': 1.2,
                                 'before': 0.2}], ambiguous=True)
    assert automatic_expression_document(base, ambiguous)[0] is None
    disabled = report(events, [{'attribute': 'audible_duration', 'value': 1.2,
                                'before': 0.2}], enabled=())
    assert automatic_expression_document(base, disabled)[0] is None
    diagnostic = report(events, [{'attribute': 'audible_duration', 'value': 1.2,
                                  'before': 0.2}], candidate_status='diagnostic')
    assert automatic_expression_document(base, diagnostic)[0] is None
    stale = report(events, [{'attribute': 'audible_duration', 'value': 1.2,
                             'before': 0.2}])
    stale['policy']['implementation'] = {**stale['policy']['implementation'],
                                         'estimator_code_sha256': '0' * 64}
    assert automatic_expression_document(base, stale)[0] is None
    different_decoder = report(events, [{'attribute': 'audible_duration', 'value': 1.2,
                                        'before': 0.2}])
    different_decoder['source']['working_sha256'] = '0' * 64
    assert automatic_expression_document(base, different_decoder)[0] is None


def expression_trials(category, count, *, correct=True, damaged=0, prefix='performance'):
    target = ('audible_release_seconds' if category == 'audible_duration'
              else 'reference_velocity')
    return [{'trial_id': f'{prefix}-{category}-{index}',
             'performance_id': f'{prefix}-{index}', 'piece_id': f'piece-{index}',
             'instrument': 'piano', 'split': 'holdout', 'category': category,
             'source': 'natural_decoder', 'target': target, 'tolerance': .08,
             'reference_value': 1.0, 'before': 1.2, 'proposed': 1.02,
             'calibration_id': 'cal-1', 'suggested': True, 'scope': 'isolated', 'scorable': True}
            for index in range(count)]


def test_expression_qualifier_requires_distinct_individual_targets():
    impl = implementation()
    policy = build_policy({'evidence_kind': 'human', 'implementation': impl,
                           'expression_trials': expression_trials('audible_duration', 40)},
                          b'expression', evidence_kind='human')
    assert policy['status'] == 'qualified'
    assert policy['categories']['audible_duration']['enabled'] is True
    repeated = [dict(row, performance_id='one')
                for row in expression_trials('audible_duration', 40)]
    blocked = build_policy({'evidence_kind': 'human', 'implementation': impl,
                            'expression_trials': repeated}, b'expression',
                           evidence_kind='human')
    assert blocked['categories']['audible_duration']['enabled'] is False


def test_expression_qualifier_supports_audible_end_intervals():
    rows = expression_trials('audible_duration', 40)
    for row in rows:
        row.pop('reference_value')
        row['reference_interval'] = [.99, 1.01]
    policy = build_policy({'evidence_kind': 'human',
                           'implementation': implementation(),
                           'expression_trials': rows},
                          b'expression', evidence_kind='human')
    assert policy['categories']['audible_duration']['enabled'] is True


def test_expression_qualifier_ignores_manually_supplied_success_flags():
    rows = expression_trials('audible_duration', 40)
    for row in rows:
        row['correct'] = False
        row['improved'] = False
        row['damaged_correct_values'] = 99
    policy = build_policy({'evidence_kind': 'human',
                           'implementation': implementation(),
                           'expression_trials': rows},
                          b'expression', evidence_kind='human')
    assert policy['categories']['audible_duration']['enabled'] is True


def test_expression_qualifier_rejects_missing_damage_and_pedal():
    impl = implementation()
    rows = expression_trials('audible_duration', 40)
    del rows[0]['reference_value']
    try:
        build_policy({'evidence_kind': 'human', 'implementation': impl,
                      'expression_trials': rows}, b'expression', evidence_kind='human')
    except ValueError as error:
        assert 'reference value or interval' in str(error)
    else:
        raise AssertionError('missing reference evidence was accepted')
    pedal = build_policy({'evidence_kind': 'human', 'implementation': impl,
                          'expression_trials': expression_trials('pedal', 40)},
                         b'expression', evidence_kind='human')
    assert pedal['categories']['pedal']['enabled'] is False


def test_expression_qualifier_rejects_duplicate_trials_and_split_leakage():
    rows = expression_trials('audible_duration', 40)
    report = {'evidence_kind': 'human', 'implementation': implementation(),
              'expression_trials': rows + [dict(rows[0])]}
    with pytest.raises(ValueError, match='unique'):
        build_policy(report, b'expression', evidence_kind='human')
    report['expression_trials'][-1].update(trial_id='development-copy', split='development')
    with pytest.raises(ValueError, match='both development and holdout'):
        build_policy(report, b'expression', evidence_kind='human')


def test_expression_policy_rejects_impossible_metrics_and_false_implementation():
    policy = build_policy({'evidence_kind': 'human', 'implementation': implementation(),
                           'expression_trials': expression_trials('audible_duration', 40)},
                          b'expression', evidence_kind='human')
    bad = {**policy, 'categories': {
        **policy['categories'],
        'audible_duration': {**policy['categories']['audible_duration'], 'precision': 1.5}}}
    try:
        validate_expression_policy(bad)
    except ValueError as error:
        assert '0..1' in str(error)
    else:
        raise AssertionError('impossible precision was accepted')
    false_impl = {**policy, 'categories': {
        **policy['categories'],
        'pedal': {**policy['categories']['pedal'], 'enabled': True, 'implemented': True}}}
    try:
        validate_expression_policy(false_impl)
    except ValueError as error:
        assert 'implementation flag' in str(error)
    else:
        raise AssertionError('unimplemented pedal was accepted')


def test_qualification_does_not_credit_wrong_scope_unscorable_or_only_corruptions():
    for overrides in ({'scope': 'polyphonic'}, {'scorable': False}, {'source': 'corruption'}):
        rows = [{**row, **overrides} for row in expression_trials('audible_duration', 40)]
        policy = build_policy({'evidence_kind': 'human', 'implementation': implementation(),
                               'expression_trials': rows}, b'test', evidence_kind='human')
        assert not policy['categories']['audible_duration']['enabled']


@pytest.mark.parametrize('field', ['before', 'proposed', 'tolerance', 'reference_value'])
@pytest.mark.parametrize('value', [float('nan'), float('inf')])
def test_qualification_rejects_nonfinite_evidence(field, value):
    rows = expression_trials('audible_duration', 40)
    rows[0][field] = value
    with pytest.raises(ValueError):
        build_policy({'evidence_kind': 'human', 'implementation': implementation(),
                      'expression_trials': rows}, b'test', evidence_kind='human')


def test_application_rejects_unbound_identity_and_modified_policy():
    notes = [event('e', .2, 60)]
    for field in ('decoder_sha256', 'weights_sha256', 'audio_sha256'):
        value = report(notes, [{'attribute': 'audible_duration', 'value': 1.2, 'before': .2}])
        value['source'].pop(field)
        assert automatic_expression_document(document(notes), value) == (None, [])
    value = report(notes, [{'attribute': 'audible_duration', 'value': 1.2, 'before': .2}])
    value['policy']['categories']['audible_duration']['scopes'] = ['polyphonic']
    assert automatic_expression_document(document(notes), value) == (None, [])


def test_audio_identity_is_measured_and_mismatches_rejected(tmp_path):
    import soundfile as sf
    path = tmp_path / 'audio.wav'
    sf.write(path, tone(60, .2, .5), SR)
    notes = [event('e', .2, 60)]
    value = analyze(path, notes, 3., DEFAULT_SETTINGS)
    assert value['source']['audio_sha256'] == file_sha256(path)
    with pytest.raises(ValueError, match='audio identity'):
        analyze(path, notes, 3., DEFAULT_SETTINGS, provenance={'audio_sha256': '0' * 64})


def test_short_proposal_does_not_hide_a_ringing_preceding_note():
    prior = event('prior', .2, 60, .1)
    target = event('target', .8, 67, .3)
    analysis = analyze_audio(tone(60, .2, 1.5, tau=3.) + tone(67, .8, .5), SR, DEFAULT_SETTINGS)
    assert expression_module._ring_end(analysis, prior, target['onset']) > target['onset']
    candidate = expression_module._duration_candidate(analysis, target, 3., [prior, target])
    assert candidate['scope'] == 'polyphonic'


def test_dynamics_measurements_are_not_velocity_edits_or_unit_mismatches():
    analysis = analyze_audio(tone(60, .4, .8), SR, DEFAULT_SETTINGS)
    for velocity in (None, .5):
        note = event('e', .4, 60, .8, velocity)
        result = expression_module._dynamics_candidate(analysis, note, [note])
        assert result['baseline'] is None and result['baseline_velocity'] == velocity
        assert result['decision'] == 'no_change' and result['proposed'] is None


def test_calibrated_velocity_application_preserves_duration_and_rejects_wrong_domain():
    from scripts.piano_velocity_calibration import fit, digest
    from test_piano_attribution import calibration_rows
    calibration = fit(calibration_rows(), 'known-domain', measurement_sha256(digest(DEFAULT_SETTINGS)))
    notes = [event('e', .2, 60, .4, .2)]
    value = report(notes, [{'attribute': 'relative_dynamics', 'value': 72 / 127, 'before': .2}],
                   enabled=('relative_dynamics',))
    value.update(calibration=calibration, calibration_sha256=digest(calibration), calibration_domain='known-domain')
    candidate = value['candidates'][0]
    candidate.update(target_kind='reference_velocity', units='normalized_midi_velocity',
                     calibration_id=calibration['calibration_id'], calibration_domain='known-domain',
                     candidate_interval=[71 / 127, 73 / 127])
    policy = value['policy']
    policy['implementation']['calibration_sha256'] = digest(calibration)
    body = {key: item for key, item in policy.items() if key not in ('policy_sha256', 'enabled_categories')}
    policy['policy_sha256'] = digest(body)
    working, history = automatic_expression_document(document(notes), value)
    assert working['events'][0]['velocity'] == 72 / 127
    assert working['events'][0]['duration'] == .4
    assert history[0]['attribute'] == 'relative_dynamics'
    value['calibration_domain'] = 'another-domain'
    assert automatic_expression_document(document(notes), value) == (None, [])


def test_polyphonic_qualification_requires_its_own_evidence():
    rows = expression_trials('audible_duration', 40)
    value = {'evidence_kind': 'human', 'implementation': implementation(), 'expression_trials': rows}
    assert not build_policy(value, b'test', evidence_kind='human', scope='polyphonic')['categories']['audible_duration']['enabled']
    for row in rows:
        row['scope'] = 'polyphonic'
    policy = build_policy(value, b'test', evidence_kind='human', scope='polyphonic')
    assert policy['categories']['audible_duration']['enabled']
    assert policy['categories']['audible_duration']['scopes'] == ['polyphonic']


def test_qualification_rejects_mislabeled_time_and_velocity_units():
    rows = expression_trials('audible_duration', 40)
    rows[0]['tolerance'] = 80
    with pytest.raises(ValueError, match='80 ms'):
        build_policy({'evidence_kind': 'human', 'implementation': implementation(),
                      'expression_trials': rows}, b'test', evidence_kind='human')
    rows = expression_trials('relative_dynamics', 40)
    with pytest.raises(ValueError, match='normalized MIDI'):
        build_policy({'evidence_kind': 'human', 'implementation': implementation(),
                      'expression_trials': rows}, b'test', evidence_kind='human')
