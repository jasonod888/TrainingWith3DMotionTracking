"""Artifact gate and benchmark metrics for music transcription qualification."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.qualify_music_model import score_events, validate_artifact

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = {'name': 'fixture-transcriber', 'version': '1.0.0', 'license': 'Apache-2.0',
            'sha256': 'a' * 64, 'source_url': 'https://example.test/artifact'}


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
    reference.write_text(json.dumps({'events': [note(0.5, 60)]}))
    proposal.write_text(json.dumps({'events': [note(0.51, 60)]}))
    artifact.write_text(json.dumps(ARTIFACT))
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/qualify_music_model.py'),
                             '--artifact', str(artifact), '--reference', str(reference),
                             '--proposal', str(proposal), '--output', str(output)],
                            capture_output=True, text=True, cwd=ROOT)
    assert result.returncode == 0, result.stderr
    assert json.loads(output.read_text())['metrics']['matched'] == 1
    artifact.write_text(json.dumps({**ARTIFACT, 'license': 'unknown-proprietary'}))
    refused = subprocess.run([sys.executable, str(ROOT / 'scripts/qualify_music_model.py'),
                              '--artifact', str(artifact), '--reference', str(reference),
                              '--proposal', str(proposal)], capture_output=True, text=True, cwd=ROOT)
    assert refused.returncode == 2 and 'not approved' in refused.stderr
