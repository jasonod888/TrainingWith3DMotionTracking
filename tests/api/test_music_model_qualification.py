"""Artifact gate and benchmark metrics for music transcription qualification."""
import json
import hashlib
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.qualify_music_model import score_events, validate_artifact, load_events, validate_reviewed_reference

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = {'name': 'fixture-transcriber', 'version': '1.0.0', 'license': 'Apache-2.0',
            'sha256': 'a' * 64, 'source_url': 'https://example.test/artifact',
            'code_license':'Apache-2.0','weights_license':'Apache-2.0','license_source_url':'https://example.test/license'}


def note(onset, pitch, duration=0.4):
    return {'onset': onset, 'pitch': pitch, 'duration': duration}


def test_perfect_proposal_scores_one():
    reference = [note(0.5, 60), note(1.0, 64), note(1.5, 67)]
    metrics = score_events(reference, reference)
    assert metrics['matched'] == 3 and metrics['missing'] == 0 and metrics['extra'] == 0
    assert metrics['precision'] == 1 and metrics['recall'] == 1 and metrics['f1'] == 1
    assert metrics['onset_mae_seconds'] == 0


def test_onset_tolerance_and_extra_notes_are_reported():
    reference = [note(0.5, 60), note(1.0, 64)]
    proposal = [note(0.53, 60), note(1.4, 64), note(2.0, 70)]
    metrics = score_events(reference, proposal, tolerance=0.05)
    assert metrics['matched'] == 1 and metrics['missing'] == 1 and metrics['extra'] == 2
    assert metrics['onset_mae_seconds'] == pytest.approx(0.03)
    assert metrics['precision'] < 1 and metrics['recall'] == 0.5


def test_a_wrong_pitch_never_matches():
    metrics = score_events([note(0.5, 60)], [note(0.5, 61)])
    assert metrics['matched'] == 0 and metrics['missing'] == 1 and metrics['extra'] == 1


def test_matching_maximizes_pairs_instead_of_consuming_the_nearest_note_too_early():
    metrics=score_events([note(.04,60),note(.1,60)],[note(0,60),note(.05,60)])
    assert metrics['matched']==2
    assert score_events([],[])['f1']==1
    for tolerance in (-1,float('nan'),float('inf')):
        with pytest.raises(ValueError):score_events([],[],tolerance)
    with pytest.raises(ValueError):load_events({'events':[note(float('nan'),60)]})
    with pytest.raises(ValueError):validate_reviewed_reference({'events':[]})


def test_synthetic_symbolic_corpus_has_valid_reviewed_references_and_known_counts():
    corpus=ROOT/'packages/lesson-schema/fixtures/music-corpus'
    index=json.loads((corpus/'index.json').read_text())
    assert index['kind']=='authored-synthetic-symbolic' and len(index['cases'])==6
    for case in index['cases']:
        reference=validate_reviewed_reference(json.loads((corpus/case['reference']).read_text()))
        proposal=load_events(json.loads((corpus/case['proposal']).read_text()))
        metrics=score_events(reference,proposal)
        assert {key:metrics[key] for key in case['expected']}==case['expected']


def test_artifact_metadata_is_required_and_licence_gated():
    assert validate_artifact(ARTIFACT)['license'] == 'Apache-2.0'
    with pytest.raises(ValueError, match='missing'):
        validate_artifact({**ARTIFACT, 'sha256': ''})
    with pytest.raises(ValueError, match='not approved'):
        validate_artifact({**ARTIFACT, 'license': 'unknown-proprietary'})
    with pytest.raises(ValueError, match='sha256'):
        validate_artifact({**ARTIFACT, 'sha256': 'xyz'})


def test_cli_writes_a_report_and_refuses_an_unapproved_artifact(tmp_path):
    reference = tmp_path / 'reference.json'
    proposal = tmp_path / 'proposal.json'
    artifact = tmp_path / 'artifact.json'
    output = tmp_path / 'report.json'
    reference.write_text(json.dumps({'reference_version':1,'subject':'piano','duration':2,'review':{'reviewer_id':'fixture','draft_id':'fixture','reviewed_at':'2026-11-05T12:00:00Z','source_reference_sha256':'a'*64},'events': [note(0.5, 60)]}))
    proposal.write_text(json.dumps({'events': [note(0.51, 60)]}))
    binary=tmp_path/'fixture.bin';binary.write_bytes(b'fixture-not-a-model')
    licence=tmp_path/'LICENSE';licence.write_text('Synthetic test evidence, not a model licence approval.')
    artifact.write_text(json.dumps({**ARTIFACT,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}))
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/qualify_music_model.py'),
                             '--artifact', str(artifact), '--artifact-file',str(binary),'--license-file',str(licence),'--reference', str(reference),
                             '--proposal', str(proposal), '--output', str(output)],
                            capture_output=True, text=True, cwd=ROOT)
    assert result.returncode == 0, result.stderr
    report=json.loads(output.read_text())
    assert report['metrics']['matched'] == 1 and report['artifact_bytes_verified'] is True
    assert report['qualification_status']=='evidence_only_not_model_or_licence_approval'
    binary.write_bytes(b'wrong-model-bytes')
    mismatch=subprocess.run([sys.executable,str(ROOT/'scripts/qualify_music_model.py'),
        '--artifact',str(artifact),'--artifact-file',str(binary),'--license-file',str(licence),
        '--reference',str(reference),'--proposal',str(proposal)],capture_output=True,text=True,cwd=ROOT)
    assert mismatch.returncode==2 and 'do not match' in mismatch.stderr
    artifact.write_text(json.dumps({**ARTIFACT, 'license': 'unknown-proprietary'}))
    refused = subprocess.run([sys.executable, str(ROOT / 'scripts/qualify_music_model.py'),
                              '--artifact', str(artifact), '--artifact-file',str(binary),'--license-file',str(licence),'--reference', str(reference),
                              '--proposal', str(proposal)], capture_output=True, text=True, cwd=ROOT)
    assert refused.returncode == 2 and 'not approved' in refused.stderr
