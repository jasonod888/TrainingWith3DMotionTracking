"""Artifact gate and benchmark metrics for music transcription qualification."""
import json
import hashlib
import subprocess
import sys
import wave
from pathlib import Path

import pytest

from scripts.qualify_music_model import corpus_cases, score_events, validate_artifact, load_events, validate_reviewed_reference, validate_commercial_files

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


COMMERCIAL = {**ARTIFACT, 'code_sha256':'c'*64,'terms_snapshot_sha256':'d'*64,
              'code_license_url':'https://example.test/code-terms','weights_license_url':'https://example.test/weights-terms', 'commercial_use': 'allowed', 'redistribution': 'allowed',
              'attribution': 'Attribution required.', 'approval': {
                  'reviewer_id': 'legal-reviewer', 'approved_at': '2026-11-10T00:00:00+00:00',
                  'decision': 'approved', 'scope': 'commercial deployment',
                  'evidence_sha256': 'b' * 64}}


def test_commercial_use_requires_allowed_terms_and_recorded_approval():
    result = validate_artifact(COMMERCIAL, 'commercial')
    assert result['use'] == 'commercial' and result['commercial']['approval']['reviewer_id'] == 'legal-reviewer'
    assert validate_artifact(ARTIFACT)['commercial'] is None
    with pytest.raises(ValueError, match='missing approval'):
        validate_artifact({**COMMERCIAL, 'approval': {}}, 'commercial')
    with pytest.raises(ValueError, match='allowed commercial use'):
        validate_artifact({**COMMERCIAL, 'commercial_use': 'restricted'}, 'commercial')
    with pytest.raises(ValueError, match='decision'):
        validate_artifact({**COMMERCIAL, 'approval': {**COMMERCIAL['approval'], 'decision': 'pending'}}, 'commercial')
    with pytest.raises(ValueError, match='date'):
        validate_artifact({**COMMERCIAL, 'approval': {**COMMERCIAL['approval'], 'approved_at': 'not-a-date'}}, 'commercial')


def reviewed_reference(events):
    return {'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'}, 'duration': 2,
            'events': events, 'spans': [{'start': 0, 'end': 2}],
            'review': {'reviewer_id': 'r', 'draft_id': 'd', 'reviewed_at': '2026-11-10T00:00:00+00:00',
                       'source_reference_sha256': 'c' * 64}}


def make_corpus(root, events=None):
    for index in range(3):
        case=root/f'case-{index}';case.mkdir()
        with wave.open(str(case/'clip.wav'),'wb') as audio:
            audio.setparams((1,2,16000,32000,'NONE','not compressed'))
            audio.writeframes(bytes([index,0])*32000)
        (case/'reference.json').write_text(json.dumps(reviewed_reference([note(.5,60),note(1,64)] if events is None else events)),encoding='utf-8')
        (case/'proposal.json').write_text(json.dumps({'events':[note(.51,60),note(1.02,64)] if events is None else events}),encoding='utf-8')
        identity={key+'_sha256':hashlib.sha256((case/file).read_bytes()).hexdigest() for key,file in
                  [('audio','clip.wav'),('reference','reference.json'),('proposal','proposal.json')]}
        metadata={'real_audio':True,'reviewed':True,'audio':'clip.wav','reference':'reference.json','proposal':'proposal.json',**identity,
                  'inference':{'artifact_sha256':ARTIFACT['sha256'],'audio_sha256':identity['audio_sha256'],
                               'proposal_sha256':identity['proposal_sha256'],'run_id':f'test-{index}','code_version':'test-fixture'}}
        (case/'case.json').write_text(json.dumps(metadata),encoding='utf-8')


def corpus(root):return corpus_cases(root,.05,3,ARTIFACT['sha256'])


def test_real_audio_corpus_scores_reviewed_cases_and_rejects_synthetic_claims(tmp_path):
    make_corpus(tmp_path)
    result=corpus(tmp_path)
    assert result['case_count']==3 and result['evidence_class']=='reviewed-audio-proposal-comparison'
    assert result['aggregate']['precision']==1 and result['inference_verified'] is False
    metadata_path=tmp_path/'case-0/case.json';metadata=json.loads(metadata_path.read_text())
    metadata['real_audio']=False;metadata_path.write_text(json.dumps(metadata))
    with pytest.raises(ValueError,match='not declared real audio'):corpus(tmp_path)


def test_corpus_handles_silence_and_zero_matches_without_inventing_onset_accuracy(tmp_path):
    make_corpus(tmp_path,events=[])
    result=corpus(tmp_path)
    assert result['aggregate']['f1']==1 and result['aggregate']['onset_mae_seconds'] is None
    assert result['aggregate']['onset_mae_cases']==0
    for case in tmp_path.iterdir():
        proposal=case/'proposal.json';proposal.write_text(json.dumps({'events':[note(.5,72)]}))
        metadata=json.loads((case/'case.json').read_text());metadata['proposal_sha256']=hashlib.sha256(proposal.read_bytes()).hexdigest()
        metadata['inference']['proposal_sha256']=metadata['proposal_sha256'];(case/'case.json').write_text(json.dumps(metadata))
    assert corpus(tmp_path)['aggregate']['onset_mae_seconds'] is None
    assert corpus(tmp_path)['aggregate']['precision']==0


def test_corpus_rejects_unsafe_paths_tampered_files_and_invalid_audio(tmp_path):
    make_corpus(tmp_path);case=tmp_path/'case-0';metadata_path=case/'case.json';metadata=json.loads(metadata_path.read_text())
    metadata_path.write_text(json.dumps({**metadata,'reference':'../outside.json'}))
    with pytest.raises(ValueError,match='unsafe'):corpus(tmp_path)
    metadata_path.write_text(json.dumps(metadata));reference=case/'reference.json';original=reference.read_bytes();reference.write_bytes(original+b' ')
    with pytest.raises(ValueError,match='digest'):corpus(tmp_path)
    reference.write_bytes(original);audio=case/'clip.wav';audio.write_bytes(b'not-wave')
    metadata['audio_sha256']=hashlib.sha256(audio.read_bytes()).hexdigest();metadata_path.write_text(json.dumps(metadata))
    with pytest.raises(ValueError,match='valid PCM WAV'):corpus(tmp_path)


def test_corpus_requires_three_distinct_cases_and_artifact_bound_declarations(tmp_path):
    make_corpus(tmp_path)
    with pytest.raises(ValueError,match='three'):corpus_cases(tmp_path,.05,1,ARTIFACT['sha256'])
    with pytest.raises(ValueError,match='inference declaration'):corpus_cases(tmp_path,.05,3,'b'*64)
    case=tmp_path/'case-1';(case/'clip.wav').write_bytes((tmp_path/'case-0/clip.wav').read_bytes())
    metadata=json.loads((case/'case.json').read_text());metadata['audio_sha256']=hashlib.sha256((case/'clip.wav').read_bytes()).hexdigest()
    (case/'case.json').write_text(json.dumps(metadata))
    with pytest.raises(ValueError,match='distinct'):corpus(tmp_path)


def test_commercial_approval_binds_actual_code_artifact_and_terms_bytes(tmp_path):
    code=tmp_path/'code.bin';code.write_bytes(b'synthetic-source-bundle')
    terms=tmp_path/'LICENSE';terms.write_text('Synthetic terms fixture, not a legal approval.')
    approval_file=tmp_path/'approval.json'
    metadata={**COMMERCIAL,'code_sha256':hashlib.sha256(code.read_bytes()).hexdigest(),
              'terms_snapshot_sha256':hashlib.sha256(terms.read_bytes()).hexdigest()}
    approval={key:metadata['approval'][key] for key in ('reviewer_id','approved_at','scope','decision')}
    approval.update(artifact_sha256=metadata['sha256'],code_sha256=metadata['code_sha256'],terms_snapshot_sha256=metadata['terms_snapshot_sha256'])
    approval_file.write_text(json.dumps(approval));metadata['approval']={**metadata['approval'],'evidence_sha256':hashlib.sha256(approval_file.read_bytes()).hexdigest()}
    artifact=validate_artifact(metadata,'commercial');validate_commercial_files(artifact,code,terms,approval_file)
    code.write_bytes(b'wrong-code')
    with pytest.raises(ValueError,match='code-file'):validate_commercial_files(artifact,code,terms,approval_file)
    code.write_bytes(b'synthetic-source-bundle');terms.write_text('Changed terms')
    with pytest.raises(ValueError,match='terms snapshot'):validate_commercial_files(artifact,code,terms,approval_file)
    terms.write_text('Synthetic terms fixture, not a legal approval.')
    approval_file.write_text(json.dumps({**approval,'artifact_sha256':'b'*64}))
    artifact['commercial']['approval']['evidence_sha256']=hashlib.sha256(approval_file.read_bytes()).hexdigest()
    with pytest.raises(ValueError,match='Approval contents'):validate_commercial_files(artifact,code,terms,approval_file)


def test_cli_refuses_incomplete_pair_and_lowered_case_floor_without_traceback(tmp_path):
    common=[sys.executable,str(ROOT/'scripts/qualify_music_model.py'),'--artifact','missing','--artifact-file','missing','--license-file','missing']
    for extra in (['--reference','missing'],['--corpus','missing','--min-cases','1']):
        result=subprocess.run(common+extra,capture_output=True,text=True,cwd=ROOT)
        assert result.returncode==2 and 'Traceback' not in result.stderr


def test_commercial_cli_verifies_the_complete_retained_evidence_chain(tmp_path):
    model=tmp_path/'model.bin';model.write_bytes(b'synthetic-model-not-a-checkpoint')
    code=tmp_path/'code.bin';code.write_bytes(b'synthetic-code-not-a-runtime')
    terms=tmp_path/'terms.txt';terms.write_text('Synthetic licensing test only, not an approval.')
    approval_file=tmp_path/'approval.json';metadata_file=tmp_path/'artifact.json'
    metadata={**COMMERCIAL,'sha256':hashlib.sha256(model.read_bytes()).hexdigest(),
        'code_sha256':hashlib.sha256(code.read_bytes()).hexdigest(),'terms_snapshot_sha256':hashlib.sha256(terms.read_bytes()).hexdigest()}
    approval={key:metadata['approval'][key] for key in ('reviewer_id','approved_at','scope','decision')}
    approval.update(artifact_sha256=metadata['sha256'],code_sha256=metadata['code_sha256'],terms_snapshot_sha256=metadata['terms_snapshot_sha256'])
    approval_file.write_text(json.dumps(approval));metadata['approval']={**metadata['approval'],'evidence_sha256':hashlib.sha256(approval_file.read_bytes()).hexdigest()}
    metadata_file.write_text(json.dumps(metadata))
    reference=tmp_path/'reference.json';reference.write_text(json.dumps(reviewed_reference([note(.5,60)])))
    proposal=tmp_path/'proposal.json';proposal.write_text(json.dumps({'events':[note(.5,60)]}))
    output=tmp_path/'result.json'
    args=[sys.executable,str(ROOT/'scripts/qualify_music_model.py'),'--use','commercial','--artifact',str(metadata_file),
        '--artifact-file',str(model),'--code-file',str(code),'--license-file',str(terms),'--approval-file',str(approval_file),
        '--reference',str(reference),'--proposal',str(proposal),'--output',str(output)]
    result=subprocess.run(args,capture_output=True,text=True,cwd=ROOT)
    assert result.returncode==0,result.stderr
    assert json.loads(output.read_text())['deployment_eligibility']=='commercial-evidence-complete-not-an-approval'
    approval['artifact_sha256']='b'*64;approval_file.write_text(json.dumps(approval))
    metadata['approval']['evidence_sha256']=hashlib.sha256(approval_file.read_bytes()).hexdigest();metadata_file.write_text(json.dumps(metadata))
    refused=subprocess.run(args,capture_output=True,text=True,cwd=ROOT)
    assert refused.returncode==2 and 'Approval contents' in refused.stderr
