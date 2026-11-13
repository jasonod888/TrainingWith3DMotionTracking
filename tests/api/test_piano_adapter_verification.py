"""The optional verifier must never block or rewrite a profiled draft."""
import hashlib
import json
import math
import subprocess
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

pytest.importorskip('basic_pitch')
from scripts.music_basic_pitch_adapter import _verification_summary

SR = 22050
ROOT = Path(__file__).resolve().parents[2]


def wav(path, duration=2.0, start=0.0, note_duration=1.5):
    import wave
    times = np.arange(int(duration * SR)) / SR
    values = np.zeros(len(times))
    low = int(round(start * SR))
    local = times[low:] - start
    values[low:] = 0.5 * np.sin(2 * math.pi * 261.63 * local) * np.exp(-local / 1.2)
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(SR)
        stream.writeframes((values * 32767).astype('<i2').tobytes())


def profile(verifier_sha=None):
    return {'model': 'basic-pitch', 'model_version': '0.4.0', 'profile_sha256': 'a' * 64,
            'decoding': {'decoding_version': 'basic-pitch-0.4.0/piano-peaks-v1'},
            'verification': {'enabled': True, 'mode': 'diagnostic', 'version': 'piano-verifier-1',
                             'code_sha256': verifier_sha or hashlib.sha256(
                                 (ROOT / 'scripts/piano_verifier.py').read_bytes()).hexdigest(),
                             'settings': {}, 'settings_sha256': 'b' * 64}}


def correction_policy():
    return {'policy_version': 'piano-corrections-1', 'generated_at': '2026-11-11T00:00:00Z',
            'status': 'insufficient-evidence', 'scope': 'test',
            'benchmark': {'report_sha256': 'a' * 64, 'evidence_kind': 'human',
                          'heldout_cases': 40, 'source': 'test'},
            'thresholds': {'min_heldout_cases': 1, 'min_suggestions': 1,
                           'min_correction_precision': 0.9, 'max_damage_rate': 0.0},
            'categories': {}}


def policy_digest(policy):
    return hashlib.sha256(json.dumps(policy, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def expression_policy():
    return {'policy_version': 'piano-expression-1', 'generated_at': '2026-11-11T00:00:00Z',
            'status': 'insufficient-evidence', 'scope': 'test',
            'benchmark': {'report_sha256': 'a' * 64, 'evidence_kind': 'human',
                          'heldout_cases': 40, 'source': 'test'},
            'thresholds': {'min_heldout_cases': 1, 'min_suggestions': 1,
                           'min_correction_precision': 0.9, 'max_damage_rate': 0.0},
            'categories': {
                'audible_duration': {'enabled': False, 'implemented': True, 'reason': 'test',
                                     'attempts': 0, 'suggestions': 0, 'precision': 0.0,
                                     'damage_rate': 0.0, 'heldout_cases': 0},
            }}


def test_verifier_runs_and_reports_without_touching_the_draft(tmp_path):
    audio = tmp_path / 'analysis.wav'; wav(audio)
    reference = tmp_path / 'reference.json'
    reference.write_text(json.dumps({'events': [
        {'id': 'a', 'onset': 0.2, 'duration': 0.8, 'pitch': 60, 'velocity': 0.5}]}))
    events = [{'id': 'a', 'onset': 0.2, 'duration': 0.8, 'pitch': 60, 'velocity': 0.5}]
    before = [dict(event) for event in events]
    activations = {'onset': np.zeros((200, 88), dtype=np.float32),
                   'note': np.zeros((200, 88), dtype=np.float32)}
    summary, report, revised = _verification_summary(
        profile(), audio, events, activations, 2.0, reference,
        hashlib.sha256(audio.read_bytes()).hexdigest())
    assert summary['status'] in ('complete', 'partial')
    assert report is not None and report['mode'] == 'diagnostic'
    assert revised is None
    assert events == before
    assert report['source']['audio_sha256'] == hashlib.sha256(audio.read_bytes()).hexdigest()
    assert report['source']['proposal_sha256']


@pytest.mark.parametrize('correction_mode', ['diagnostic', 'qualified'])
def test_expression_policy_is_passed_without_blocking_phase_three(tmp_path, correction_mode):
    audio = tmp_path / 'analysis.wav'; wav(audio)
    reference = tmp_path / 'reference.json'
    events = [{'id': 'a', 'onset': 0.2, 'duration': 0.8, 'pitch': 60, 'velocity': 0.5}]
    reference.write_text(json.dumps({'events': events}))
    block = profile()['verification']
    if correction_mode == 'qualified':
        correction = correction_policy()
        block.update(mode='qualified', correction_policy=correction,
                     correction_policy_sha256=policy_digest(correction))
    expression = expression_policy()
    block.update(expression_enabled=True, expression_mode='qualified',
                 expression_version='piano-expression-1', expression_policy=expression,
                 expression_policy_sha256=policy_digest(expression))
    summary, report, revised = _verification_summary(
        {'model': 'basic-pitch', 'model_version': '0.4.0', 'profile_sha256': 'a' * 64,
         'decoding': {'decoding_version': 'basic-pitch-0.4.0/piano-peaks-v1'},
         'verification': block},
        audio, events, {'onset': np.zeros((10, 88))}, 2.0, reference,
        hashlib.sha256(audio.read_bytes()).hexdigest())
    assert summary['status'] in ('complete', 'partial')
    assert summary['expression_status'] in ('complete', 'partial')
    expression_report = summary['_expression_report_value']
    assert expression_report['schema_version'] == 2
    assert expression_report['coverage']['events'] == 1
    assert expression_report['analysis_switches']['audible_duration'] is True
    assert report['expression']['status'] == 'disabled'


def test_expression_policy_failure_preserves_the_phase_three_report(tmp_path):
    audio = tmp_path / 'analysis.wav'; wav(audio)
    reference = tmp_path / 'reference.json'
    events = [{'id': 'a', 'onset': 0.2, 'duration': 0.8, 'pitch': 60, 'velocity': 0.5}]
    reference.write_text(json.dumps({'events': events}))
    block = profile()['verification']
    block.update(expression_enabled=True, expression_mode='qualified',
                 expression_version='piano-expression-1',
                 expression_policy=expression_policy(),
                 expression_policy_sha256='c' * 64)
    summary, report, revised = _verification_summary(
        {'model': 'basic-pitch', 'model_version': '0.4.0', 'profile_sha256': 'a' * 64,
         'decoding': {'decoding_version': 'basic-pitch-0.4.0/piano-peaks-v1'},
         'verification': block},
        audio, events, {'onset': np.zeros((10, 88))}, 2.0, reference,
        hashlib.sha256(audio.read_bytes()).hexdigest())
    assert summary['status'] in ('complete', 'partial')
    assert summary['expression_status'] == 'unavailable'
    assert summary['expression_reason'] == 'expression-policy-digest-mismatch'
    assert report is not None and report['summary']['finding_count'] >= 0


def test_expression_timeout_returns_the_completed_phase_three_report(tmp_path):
    audio = tmp_path / 'analysis.wav'; wav(audio)
    reference = tmp_path / 'reference.json'
    events = [{'id': 'a', 'onset': 0.2, 'duration': 0.8, 'pitch': 60, 'velocity': 0.5}]
    reference.write_text(json.dumps({'events': events}))
    block = profile()['verification']
    expression = expression_policy()
    block.update(expression_enabled=True, expression_mode='qualified',
                 expression_version='piano-expression-1', expression_policy=expression,
                 expression_policy_sha256=policy_digest(expression))
    real_run = subprocess.run

    def timed(command, *args, **kwargs):
        if any('piano_expression.py' in str(part) for part in command):
            raise subprocess.TimeoutExpired(command, 90)
        return real_run(command, *args, **kwargs)

    with patch('scripts.music_basic_pitch_adapter.subprocess.run', side_effect=timed):
        summary, report, revised = _verification_summary(
            {'model': 'basic-pitch', 'model_version': '0.4.0', 'profile_sha256': 'a' * 64,
             'decoding': {'decoding_version': 'basic-pitch-0.4.0/piano-peaks-v1'},
             'verification': block},
            audio, events, {'onset': np.zeros((10, 88))}, 2.0, reference,
            hashlib.sha256(audio.read_bytes()).hexdigest())
    assert summary['status'] in ('complete', 'partial')
    assert summary['expression_status'] == 'unavailable'
    assert summary['expression_reason'] == 'expression-timeout'
    assert report is not None and report['summary']['finding_count'] >= 0


def test_qualified_profile_runs_and_withholds_unqualified_edits(tmp_path):
    audio = tmp_path / 'analysis.wav'; wav(audio, start=0.5)
    reference = tmp_path / 'reference.json'
    events = [{'id': 'late', 'onset': 0.63, 'duration': 1.0, 'pitch': 60, 'velocity': 0.5}]
    reference.write_text(json.dumps({'events': events}))
    block = profile()['verification']
    block['mode'] = 'qualified'
    block['correction_policy'] = correction_policy()
    block['correction_policy_sha256'] = policy_digest(block['correction_policy'])
    summary, report, revised = _verification_summary(
        profile() | {'verification': block}, audio, events,
        {'onset': np.zeros((200, 88)), 'note': np.zeros((200, 88))},
        2.0, reference, hashlib.sha256(audio.read_bytes()).hexdigest())
    assert summary['status'] in ('complete', 'partial')
    assert summary['mode'] == 'qualified'
    assert summary['withheld_count'] >= 1
    assert report['mode'] == 'qualified' and report['edits'] == []
    assert revised is None


def test_qualified_profile_requires_a_matching_policy(tmp_path):
    audio = tmp_path / 'analysis.wav'; wav(audio)
    reference = tmp_path / 'reference.json'; reference.write_text('{"events": []}')
    missing = profile()
    missing['verification']['mode'] = 'qualified'
    summary, report, revised = _verification_summary(
        missing, audio, [], {'onset': np.zeros((10, 88))}, 2.0, reference, 'd' * 64)
    assert summary['status'] == 'unavailable'
    assert summary['reason'] == 'correction-policy-missing'
    mismatch = profile()
    mismatch['verification']['mode'] = 'qualified'
    mismatch['verification']['correction_policy'] = correction_policy()
    mismatch['verification']['correction_policy_sha256'] = 'c' * 64
    summary, report, revised = _verification_summary(
        mismatch, audio, [], {'onset': np.zeros((10, 88))}, 2.0, reference, 'd' * 64)
    assert summary['status'] == 'unavailable'
    assert summary['reason'] == 'correction-policy-digest-mismatch'


def test_verifier_produces_a_separate_revised_proposal(tmp_path):
    audio = tmp_path / 'analysis.wav'; wav(audio, start=0.5, note_duration=1.5)
    reference = tmp_path / 'reference.json'
    events = [{'id': 'late', 'onset': 0.63, 'duration': 1.0, 'pitch': 60, 'velocity': 0.5}]
    reference.write_text(json.dumps({'events': events}))
    summary, report, revised = _verification_summary(
        profile(), audio, events, {'onset': np.zeros((200, 88)), 'note': np.zeros((200, 88))},
        2.0, reference, hashlib.sha256(audio.read_bytes()).hexdigest())
    assert report is not None and report['edits']
    assert revised is not None
    assert revised['derived_from_proposal_sha256'] == report['source']['proposal_sha256']
    assert abs(revised['events'][0]['onset'] - 0.5) <= 0.07
    assert events[0]['onset'] == 0.63
    assert summary['revised_note_count'] == len(revised['events'])


def test_verifier_timeout_leaves_the_baseline_usable(tmp_path):
    audio = tmp_path / 'analysis.wav'; wav(audio)
    reference = tmp_path / 'reference.json'; reference.write_text('{"events": []}')
    events = [{'id': 'a', 'onset': 0.2, 'duration': 0.8, 'pitch': 60, 'velocity': 0.5}]
    with patch('scripts.music_basic_pitch_adapter.subprocess.run',
               side_effect=subprocess.TimeoutExpired('verifier', 120)):
        summary, report, revised = _verification_summary(
            profile(), audio, events, {'onset': np.zeros((10, 88))},
            2.0, reference, hashlib.sha256(audio.read_bytes()).hexdigest())
    assert summary['status'] == 'unavailable'
    assert summary['reason'] == 'verifier-timeout'
    assert report is None and revised is None
    assert events[0]['onset'] == 0.2


def test_verifier_code_mismatch_leaves_the_baseline_usable(tmp_path):
    audio = tmp_path / 'analysis.wav'; wav(audio)
    reference = tmp_path / 'reference.json'; reference.write_text('{"events": []}')
    summary, report, revised = _verification_summary(profile('c' * 64), audio, [], {'onset': np.zeros((10, 88))},
                                            2.0, reference, 'd' * 64)
    assert summary['status'] == 'unavailable'
    assert summary['reason'] == 'verifier-code-mismatch'
    assert report is None


def test_verifier_is_optional_and_can_be_disabled(tmp_path):
    audio = tmp_path / 'analysis.wav'; wav(audio)
    reference = tmp_path / 'reference.json'; reference.write_text('{"events": []}')
    disabled = profile()
    disabled['verification']['enabled'] = False
    summary, report, revised = _verification_summary(disabled, audio, [], {'onset': np.zeros((10, 88))},
                                            2.0, reference, 'd' * 64)
    assert summary['status'] == 'disabled' and report is None
    summary, report, revised = _verification_summary({'model': 'basic-pitch'}, audio, [], {}, 2.0,
                                            reference, 'd' * 64)
    assert summary['status'] == 'not-configured' and report is None


def test_real_subprocess_report_applies_a_qualified_correction(tmp_path):
    """Do not fabricate the decoder metadata as the handoff-only fixtures do."""
    from scripts.piano_verifier import DEFAULT_SETTINGS
    from scripts.piano_corrections import (apply_qualified_corrections,
                                           current_application_sha256, decoder_sha256)
    audio = tmp_path / 'analysis.wav'; wav(audio, start=0.5)
    events = [{'id': 'late', 'onset': 0.63, 'duration': 1.0, 'pitch': 60, 'velocity': 0.5}]
    reference = tmp_path / 'reference.json'
    reference.write_text(json.dumps({'events': events, 'provenance': {
        'model': 'basic-pitch', 'model_version': '0.4.0'}}))
    bound = profile()
    bound.update(weights_sha256='d' * 64, sample_rate=SR, preprocessing='mono-pcm-s16le',
                 thresholds={'onset_threshold': 0.6})
    policy = correction_policy()
    policy.update(status='qualified', categories={'onset_shift': {
        'enabled': True, 'reason': 'Synthetic plumbing test only', 'attempts': 40,
        'suggestions': 40, 'heldout_cases': 40, 'precision': 1.0, 'damage_rate': 0.0}},
        implementation={
            'verifier_code_sha256': bound['verification']['code_sha256'],
            'settings_sha256': policy_digest(DEFAULT_SETTINGS),
            'weights_sha256': bound['weights_sha256'], 'model': 'basic-pitch',
            'model_version': '0.4.0', 'decoder': bound['decoding']['decoding_version'],
            'decoder_sha256': decoder_sha256(bound, ROOT / 'scripts/music_basic_pitch_adapter.py'),
            'application_code_sha256': current_application_sha256()})
    bound['verification'].update(mode='qualified', correction_policy=policy,
                                 correction_policy_sha256=policy_digest(policy))
    summary, report, _ = _verification_summary(bound, audio, events,
        {'onset': np.zeros((200, 88)), 'note': np.zeros((200, 88))},
        2.0, reference, hashlib.sha256(audio.read_bytes()).hexdigest())
    assert report is not None, summary
    assert report['source']['decoder'] == bound['decoding']['decoding_version']
    applied, history, _ = apply_qualified_corrections(events, report, 2.0)
    assert history and abs(applied[0]['onset'] - 0.5) <= 0.07
    assert events[0]['onset'] == 0.63


def test_decoder_identity_changes_with_code_or_thresholds(tmp_path):
    from scripts.piano_corrections import decoder_sha256
    code = tmp_path / 'adapter.py'; code.write_text('version 1')
    config = {'sample_rate': SR, 'preprocessing': 'mono-pcm-s16le',
              'thresholds': {'onset_threshold': 0.6}, 'decoding': {'decoding_version': 'v1'}}
    original = decoder_sha256(config, code)
    assert decoder_sha256({**config, 'thresholds': {'onset_threshold': 0.5}}, code) != original
    code.write_text('version 2')
    assert decoder_sha256(config, code) != original
