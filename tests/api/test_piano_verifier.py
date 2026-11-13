"""Piano verification diagnostics: evidence, report contract and bounded changes."""
import copy
import hashlib
import math
from pathlib import Path

import numpy as np
import pytest

from scripts.piano_verifier import (
    CORRECTION_CATEGORIES,
    DEFAULT_SETTINGS,
    VERIFIER_VERSION,
    Verifier,
    _merge,
    analyze_audio,
    apply_edits,
    proposal_digest,
    validate_correction_policy,
    verify_piano_transcription,
)

SR = 22050


def tone(pitch, onset, duration=1.2, amplitude=0.4):
    count = int(duration * SR)
    times = np.arange(count) / SR
    frequency = 440.0 * 2.0 ** ((pitch - 69) / 12.0)
    values = np.zeros(count)
    for harmonic in range(1, 9):
        values += (amplitude / harmonic) * np.exp(-times / 1.2) * np.sin(
            2.0 * math.pi * frequency * harmonic * times + 0.3 * harmonic)
    return values, int(round(onset * SR))


def mix(notes, length=3.0):
    audio = np.zeros(int(length * SR))
    for pitch, onset, duration, amplitude in notes:
        values, start = tone(pitch, onset, duration, amplitude)
        stop = min(len(audio), start + len(values))
        audio[start:stop] += values[:stop - start]
    return audio + np.random.default_rng(7).normal(0, 0.0004, len(audio))


def event(identifier, onset, pitch, duration=0.8, velocity=0.5):
    return {'id': identifier, 'onset': onset, 'duration': duration,
            'pitch': pitch, 'velocity': velocity}


def run(audio, events, **kwargs):
    return verify_piano_transcription(audio=audio, events=events, sample_rate=SR,
                                     duration=len(audio) / SR, **kwargs)


def test_report_contract_and_proposal_is_not_modified():
    audio = mix([(60, 0.2, 1.2, 0.4), (64, 0.5, 1.2, 0.4), (67, 0.8, 1.2, 0.4)])
    events = [event('a', 0.2, 60), event('b', 0.5, 64), event('c', 0.8, 67)]
    before = copy.deepcopy(events)
    report = run(audio, events)
    assert events == before
    assert report['schema_version'] == 1
    assert report['verifier_version'] == VERIFIER_VERSION
    assert report['mode'] == 'diagnostic'
    assert report['status'] in ('complete', 'partial')
    assert report['source']['proposal_sha256'] == proposal_digest(events)
    assert report['source']['note_count'] == 3
    assert report['summary']['finding_count'] == len(report['findings'])
    assert report['summary']['edit_count'] == len(report['edits'])
    assert all(edit['op'] in {'set_onset', 'add_note', 'delete_note', 'set_pitch', 'merge', 'split_note'}
               for edit in report['edits'])
    assert all(isinstance(finding['ambiguous'], bool) for finding in report['findings'])
    assert report['settings_sha256']
    # A correct proposal must not be rewritten by this diagnostic stage.
    assert report['summary']['suggested_count'] == 0


def test_correct_proposal_never_proposes_an_edit():
    audio = mix([(48, 0.15, 1.5, 0.35), (55, 0.15, 1.5, 0.35), (64, 0.15, 1.5, 0.35),
                 (72, 0.6, 1.2, 0.3)])
    events = [event('a', 0.15, 48), event('b', 0.15, 55), event('c', 0.15, 64),
              event('d', 0.6, 72)]
    report = run(audio, events)
    assert report['summary']['suggested_count'] == 0


def policy(enabled=(), evidence='human', heldout=40, suggestions=20):
    categories = {
        category: {'enabled': category in enabled, 'reason': 'test fixture',
                   'attempts': heldout, 'suggestions': suggestions, 'precision': 1.0,
                   'damage_rate': 0.0, 'heldout_cases': heldout}
        for category in CORRECTION_CATEGORIES
    }
    implementation = {
        'verifier_code_sha256': hashlib.sha256(
            (Path(__file__).resolve().parents[2] / 'scripts/piano_verifier.py').read_bytes()).hexdigest(),
        'settings_sha256': 'a' * 64, 'weights_sha256': 'b' * 64,
        'model': 'basic-pitch', 'model_version': '0.4.0',
        'decoder': 'basic-pitch-0.4.0/piano-peaks-v1',
        'decoder_sha256': 'd' * 64,
        'application_code_sha256': 'c' * 64,
    }
    return validate_correction_policy({
        'policy_version': 'piano-corrections-1', 'generated_at': '2026-11-11T00:00:00Z',
        'status': 'qualified' if enabled else 'insufficient-evidence',
        'scope': 'test policy',
        'benchmark': {'report_sha256': 'a' * 64, 'evidence_kind': evidence,
                      'heldout_cases': heldout, 'source': 'test'},
        'thresholds': {'min_heldout_cases': 1, 'min_suggestions': 1,
                       'min_correction_precision': 0.9, 'max_damage_rate': 0.0},
        'categories': categories,
        'implementation': implementation,
    })


def test_qualified_mode_withholds_categories_without_qualification():
    audio = mix([(60, 0.5, 1.5, 0.5)])
    diagnostic = run(audio, [event('late', 0.63, 60)])
    assert any(finding['status'] == 'suggested' for finding in diagnostic['findings'])
    report = run(audio, [event('late', 0.63, 60)], correction_mode='qualified',
                 correction_policy=policy())
    assert report['mode'] == 'qualified'
    assert report['correction_policy']['enabled_categories'] == []
    assert report['summary']['suggested_count'] == 0
    assert report['summary']['withheld_count'] >= 1
    withheld = [finding for finding in report['findings']
                if finding['correction_status'] == 'withheld']
    assert withheld and all(finding['status'] == 'unresolved' for finding in withheld)
    assert report['edits'] == []


def test_qualified_mode_exposes_only_the_enabled_category():
    audio = mix([(60, 0.5, 1.5, 0.5)])
    report = run(audio, [event('late', 0.63, 60)], correction_mode='qualified',
                 correction_policy=policy(['onset_shift']))
    shifts = [finding for finding in report['findings'] if finding['kind'] == 'onset_shift']
    assert shifts
    assert shifts[0]['status'] == 'suggested'
    assert shifts[0]['correction_status'] == 'qualified'
    assert report['summary']['qualified_count'] >= 1
    assert report['edits']


def test_rendered_evidence_cannot_enable_a_correction_category():
    with pytest.raises(ValueError, match='human-performance'):
        policy(['duplicate_event'], evidence='rendered')
    enabled = policy(['duplicate_event'])
    with pytest.raises(ValueError, match='qualified evidence'):
        validate_correction_policy({**enabled, 'status': 'insufficient-evidence'})
    without = dict(enabled)
    without.pop('implementation')
    with pytest.raises(ValueError, match='implementation fingerprint'):
        validate_correction_policy(without)


def test_late_proposed_onset_is_reported_near_the_recording_attack():
    audio = mix([(60, 0.5, 1.5, 0.5)])
    report = run(audio, [event('late', 0.63, 60)])
    shifts = [finding for finding in report['findings'] if finding['kind'] == 'onset_shift']
    assert shifts, report['findings']
    shift = shifts[0]
    assert shift['event_ids'] == ['late']
    assert abs(shift['proposed_edits'][0]['after']['onset'] - 0.5) <= 0.06
    assert shift['evidence']['attack_strength'] > 0.5


def test_missing_chord_pitch_is_flagged_with_its_pitch():
    audio = mix([(60, 0.3, 1.5, 0.4), (64, 0.3, 1.5, 0.4), (67, 0.3, 1.5, 0.4)])
    report = run(audio, [event('a', 0.3, 60), event('b', 0.3, 64)])
    missing = [finding for finding in report['findings']
               if finding['kind'] == 'missing_pitch' and finding['pitch'] == 67]
    assert missing
    assert all(finding['status'] in ('suggested', 'unresolved') for finding in missing)


def test_duplicate_strike_is_suggested_for_one_attack():
    audio = mix([(60, 0.4, 1.5, 0.55)])
    report = run(audio, [event('first', 0.4, 60, 0.9), event('second', 0.46, 60, 0.5)])
    duplicates = [finding for finding in report['findings'] if finding['kind'] == 'duplicate_event']
    assert duplicates
    assert set(duplicates[0]['event_ids']) == {'first', 'second'}
    assert duplicates[0]['status'] == 'suggested'


def test_duplicate_edit_preserves_full_precision_preconditions():
    from scripts.piano_corrections import apply_finding
    audio = mix([(60, 0.4, 1.5, 0.55)])
    events = [event('first', 0.400012345, 60, 0.912345678, 0.612345678),
              event('second', 0.460012345, 60, 0.512345678, None)]
    report = run(audio, events)
    duplicate = next(f for f in report['findings'] if f['kind'] == 'duplicate_event'
                     and f['status'] == 'suggested')
    applied = apply_finding(events, duplicate, len(audio) / SR)
    assert len(applied) == 1
    assert events[0]['onset'] == 0.400012345
    assert events[1]['velocity'] is None


def test_unmatched_attack_is_reported_as_a_time_not_a_certainty():
    audio = mix([(72, 0.6, 1.2, 0.5)])
    report = run(audio, [])
    attacks = [finding for finding in report['findings'] if finding['kind'] == 'unmatched_attack']
    assert attacks
    finding = attacks[0]
    assert finding['time_range'][0] == pytest.approx(0.6, abs=0.1)
    if finding['pitch'] is None:
        assert finding['ambiguous']


def test_report_is_deterministic():
    audio = mix([(60, 0.4, 1.2, 0.4)])
    events = [event('a', 0.4, 60)]
    first = run(audio, events)
    second = run(audio, events)
    assert first['findings'] == second['findings']
    assert first['edits'] == second['edits']
    assert first['source']['proposal_sha256'] == second['source']['proposal_sha256']


def test_non_finite_or_incomplete_events_are_rejected():
    audio = mix([(60, 0.4, 1.2, 0.4)])
    with pytest.raises(ValueError):
        run(audio, [{'id': 'a', 'onset': float('nan'), 'duration': 1.0, 'pitch': 60}])
    with pytest.raises(ValueError):
        run(audio, [{'id': 'a', 'onset': 0.4, 'pitch': 60}])


def test_silence_produces_no_invented_notes():
    audio = np.random.default_rng(3).normal(0, 0.0002, int(2.0 * SR))
    report = run(audio, [])
    assert report['summary']['suggested_count'] == 0
    assert all(finding['kind'] in ('timeline',) for finding in report['findings'])


def test_apply_edits_builds_an_alternative_without_mutating_the_proposal():
    events = [event('a', 0.4, 60), event('b', 0.5, 64), event('c', 0.6, 67)]
    before = copy.deepcopy(events)
    edits = [
        {'op': 'set_onset', 'event_ids': ['a'], 'before': {'onset': 0.4}, 'after': {'onset': 0.42}},
        {'op': 'merge', 'event_ids': ['b', 'c'], 'before': None,
         'after': {'onset': 0.5, 'duration': 1.0, 'pitch': 64}},
        {'op': 'add_note', 'event_ids': [], 'before': None,
         'after': {'onset': 0.7, 'duration': 0.4, 'pitch': 72, 'velocity': 0.5}},
    ]
    revised = apply_edits(events, edits)
    assert events == before
    assert len(revised) == 3
    assert next(item for item in revised if item['pitch'] == 60)['onset'] == 0.42
    assert next(item for item in revised if item['pitch'] == 72)['onset'] == 0.7
    assert any(item['id'].startswith('vf-edit-') for item in revised)
    assert all(item['id'] != 'a' or item['onset'] == 0.42 for item in revised)


def test_apply_edits_splits_and_deletes_and_rejects_unknown_operations():
    events = [event('a', 0.4, 60)]
    revised = apply_edits(events, [{'op': 'split_note', 'event_ids': ['a'], 'before': None,
                                    'after': [{'onset': 0.4, 'duration': 0.2, 'pitch': 60},
                                              {'onset': 0.6, 'duration': 0.2, 'pitch': 60}]}])
    assert [item['onset'] for item in revised] == [0.4, 0.6]
    revised = apply_edits(revised, [{'op': 'delete_note', 'event_ids': [revised[0]['id']]}])
    assert len(revised) == 1 and revised[0]['onset'] == 0.6
    with pytest.raises(ValueError):
        apply_edits(events, [{'op': 'rewrite_everything', 'event_ids': ['a']}])


def test_continuous_music_is_split_into_bounded_regions():
    events = [event(f'e{index}', round(0.2 + index * 0.2, 3), 60 + index % 12) for index in range(60)]
    audio = np.zeros(int(12 * SR))
    settings = _merge(DEFAULT_SETTINGS, {'regions': {'max_region_notes': 6, 'max_region_seconds': 2.0}})
    analysis = analyze_audio(audio, SR, settings)
    verifier = Verifier(analysis, events, None, settings, {'duration': 12.0})
    regions = verifier._regions()
    assert len(regions) > 1
    assert all(len(region['focus']) <= 6 for region in regions)
    assert all(region['end'] - region['start'] <= 4.5 for region in regions)


def test_region_limit_and_silence_are_reported_as_partial_and_unusable():
    events = [event(f'e{index}', round(0.2 + index * 0.2, 3), 60) for index in range(20)]
    audio = np.zeros(int(4.5 * SR))
    report = run(audio, events, settings={'regions': {'max_regions': 1, 'max_region_notes': 2}})
    assert report['status'] == 'partial'
    assert report['coverage']['truncated_regions'] is True
    assert report['analysis']['usable'] is False
    assert report['warnings']


def test_long_held_note_remains_in_later_analysis_windows():
    events = [event('long', 0.0, 48, duration=10.0), event('later', 5.0, 64)]
    audio = np.zeros(int(6 * SR))
    settings = _merge(DEFAULT_SETTINGS, None)
    analysis = analyze_audio(audio, SR, settings)
    verifier = Verifier(analysis, events, None, settings, {'duration': 6.0})
    assert 'long' in {item['id'] for item in verifier._window_notes(5.0, 6.0)}


def test_separable_solver_checks_workspace_instead_of_a_dense_dictionary():
    from scripts.piano_verifier import RegionModel
    notes = [event(f'n{i}', 0.2 + i * 0.025, 48 + i) for i in range(12)]
    audio = mix([(n['pitch'], n['onset'], 1.2, 0.04) for n in notes])
    settings = _merge(DEFAULT_SETTINGS, None)
    analysis = analyze_audio(audio, SR, settings)
    verifier = Verifier(analysis, notes, None, settings, {'duration': 3.0})
    frames = slice(0, 180)
    atoms = verifier._base_atoms(frames, 0, 2.0)
    assert len(atoms) * len(analysis.freqs) * 180 > settings['limits']['max_region_matrix']
    model = RegionModel(analysis, frames, atoms, settings)
    residual, _ = model.solve(model.keys)
    assert math.isfinite(residual)
    with pytest.raises(ValueError, match='decomposition memory'):
        RegionModel(analysis, frames, atoms,
                    _merge(settings, {'limits': {'max_region_matrix': 1000}}))


def test_single_strike_does_not_gain_unmatched_insertions():
    audio = mix([(60, 0.4, 1.5, 0.55)])
    report = run(audio, [event('a', 0.4, 60, duration=1.5)])
    assert report['summary']['suggested_count'] == 0
    assert not [finding for finding in report['findings']
                if finding['kind'] == 'unmatched_attack' and finding['status'] == 'suggested']


def test_repetition_needs_a_separate_decoder_onset(monkeypatch):
    from types import SimpleNamespace
    note = event('held', 0.2, 60, duration=1.4)
    audio = mix([(60, 0.2, 1.5, 0.4), (60, 0.8, 1.2, 0.4)])
    settings = _merge(DEFAULT_SETTINGS, None)
    analysis = analyze_audio(audio, SR, settings)
    analysis.novelty[:] = 1.0
    raw = {'onset': np.zeros((300, 88))}
    verifier = Verifier(analysis, [note], raw, settings, {'duration': 3.0})
    monkeypatch.setattr(verifier, '_sharp_repetition', lambda *args: (0.8, 3.0))
    model = SimpleNamespace(keys=[('attack', ('candidate', 60, 0.8, 'repetition'))],
                            solve=lambda keys: (0.0, 0.0))
    verifier._check_repetition(note, model, [], 1.0, 1.0, [], 0.0, 2.0, slice(0, 180))
    assert verifier.findings[0]['status'] == 'unresolved'
    assert verifier.findings[0]['proposed_edits'] == []
    raw['onset'][int(round(0.8 * SR / 256)), 60 - 21] = 0.9
    verifier.findings.clear()
    verifier._check_repetition(note, model, [], 1.0, 1.0, [], 0.0, 2.0, slice(0, 180))
    assert verifier.findings[0]['status'] == 'suggested'
    verifier.events.append(event('already-detected', 0.8, 60))
    verifier.findings.clear()
    verifier._check_repetition(note, model, [], 1.0, 1.0, [], 0.0, 2.0, slice(0, 180))
    assert verifier.findings == []


def test_unmatched_attack_inside_a_region_is_flagged_without_a_pitch():
    events = [event('a', 0.2, 60)]
    audio = np.zeros(int(2.0 * SR))
    settings = _merge(DEFAULT_SETTINGS, None)
    analysis = analyze_audio(audio, SR, settings)
    verifier = Verifier(analysis, events, None, settings, {'duration': 2.0})
    verifier._check_region_attacks([1.0], [], 2.0)
    attacks = [finding for finding in verifier.findings if finding['kind'] == 'unmatched_attack']
    assert len(attacks) == 1
    assert attacks[0]['status'] == 'flagged' and attacks[0]['pitch'] is None
