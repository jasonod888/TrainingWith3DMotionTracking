"""Qualify a transcription artifact and benchmark its proposals against a reviewed reference.

This harness installs nothing and downloads nothing. It scores note proposals against a
reviewed reference, records the artifact identity and licence, and refuses an artifact
whose terms are not explicitly approved. A score is evidence for review, never approval.
"""
import argparse
import hashlib
import json
import math
import statistics
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

APPROVED_LICENSES = {'Apache-2.0', 'MIT', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'CC-BY-4.0'}
REQUIRED = ('name', 'version', 'license', 'sha256', 'source_url', 'code_license', 'weights_license', 'license_source_url')
COMMERCIAL = ('commercial_use', 'redistribution', 'attribution', 'approval')


def load_events(document: dict) -> list[dict]:
    if not isinstance(document,dict):raise ValueError('Expected a note document.')
    events = document.get('events')
    if not isinstance(events, list):
        raise ValueError('The document has no note events.')
    if len(events)>20000:raise ValueError('Too many note events.')
    result = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            raise ValueError(f'Note {index + 1} is not an object.')
        onset, pitch = event.get('onset'), event.get('pitch')
        if isinstance(onset,bool) or not isinstance(onset, (int, float)) or not math.isfinite(onset) or onset<0 or type(pitch) is not int or not 0<=pitch<=127:
            raise ValueError(f'Note {index + 1} has no onset or pitch.')
        length=event.get('duration')
        if length is not None and (isinstance(length,bool) or not isinstance(length,(int,float)) or not math.isfinite(length) or length<=0):
            raise ValueError('A note has an invalid duration.')
        result.append({'onset': float(onset), 'pitch': pitch, 'duration': event.get('duration')})
    return sorted(result, key=lambda note: (note['onset'], note['pitch']))


def score_events(reference: list[dict], proposal: list[dict], tolerance: float = 0.05) -> dict:
    """Maximum-cardinality ordered matching per pitch; MAE describes those pairs."""
    if not math.isfinite(tolerance) or not 0<=tolerance<=1:raise ValueError('Onset tolerance must be between zero and one second.')
    reference=load_events({'events':reference});proposal=load_events({'events':proposal})
    matched = []
    for pitch in range(128):
        expected=[note['onset'] for note in reference if note['pitch']==pitch]
        actual=[note['onset'] for note in proposal if note['pitch']==pitch]
        i=j=0
        while i<len(expected) and j<len(actual):
            delta=actual[j]-expected[i]
            if abs(delta)<=tolerance+1e-9:matched.append(abs(delta));i+=1;j+=1
            elif delta<0:j+=1
            else:i+=1
    missing = len(reference) - len(matched)
    extra = len(proposal) - len(matched)
    precision = len(matched) / len(proposal) if proposal else 1.0
    recall = len(matched) / len(reference) if reference else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        'reference_notes': len(reference), 'proposed_notes': len(proposal), 'matched': len(matched),
        'missing': missing, 'extra': extra, 'precision': round(precision, 4), 'recall': round(recall, 4),
        'f1': round(f1, 4), 'onset_mae_seconds': round(statistics.fmean(matched), 4) if matched else None,
        'tolerance_seconds': tolerance,
        'matching_policy':'maximum-cardinality ordered onset pairs per exact pitch; MAE is not globally minimized',
    }


def validate_artifact(value: dict, use: str = 'internal-evaluation') -> dict:
    if use not in ('internal-evaluation', 'commercial'):
        raise ValueError('Unknown qualification use.')
    if not isinstance(value,dict):raise ValueError('Expected artifact metadata.')
    missing = [key for key in REQUIRED if not value.get(key)]
    if missing:
        raise ValueError('Artifact metadata is missing ' + ', '.join(missing) + '.')
    licence = str(value['license'])
    if licence not in APPROVED_LICENSES:
        raise ValueError(f'Artifact licence {licence!r} is not approved for qualification.')
    if any(value[key] not in APPROVED_LICENSES for key in ('code_license','weights_license')):
        raise ValueError('Code and weights licences must both be eligible; a code licence alone is insufficient.')
    if any(urlparse(str(value[key])).scheme!='https' or not urlparse(str(value[key])).netloc for key in ('source_url','license_source_url')):
        raise ValueError('Artifact and licence sources must be HTTPS URLs.')
    digest = str(value['sha256']).lower()
    if len(digest) != 64 or any(character not in '0123456789abcdef' for character in digest):
        raise ValueError('Artifact sha256 must be a hex digest.')
    result = {'code_license':value['code_license'],'weights_license':value['weights_license'],'license_source_url':value['license_source_url'],
              'name': str(value['name']), 'version': str(value['version']), 'license': licence,
              'sha256': digest, 'source_url': str(value['source_url']), 'use': use}
    if use == 'commercial':
        missing = [key for key in COMMERCIAL if not value.get(key)]
        if missing:
            raise ValueError('Commercial use is missing ' + ', '.join(missing) + '.')
        if value['commercial_use'] != 'allowed' or value['redistribution'] != 'allowed':
            raise ValueError('Commercial deployment requires allowed commercial use and redistribution.')
        if not isinstance(value['attribution'], str) or not value['attribution'].strip():
            raise ValueError('Commercial use requires an attribution statement.')
        approval = value['approval']
        if not isinstance(approval, dict):
            raise ValueError('Commercial use requires a recorded approval object.')
        if any(not approval.get(key) for key in ('reviewer_id','approved_at','scope','evidence_sha256')):
            raise ValueError('Approval must record reviewer, date, scope and evidence sha256.')
        if approval.get('decision') != 'approved':
            raise ValueError('Approval decision must be approved.')
        try:
            datetime.fromisoformat(str(approval['approved_at']).replace('Z','+00:00'))
        except ValueError as error:
            raise ValueError('Approval date is invalid.') from error
        evidence = str(approval['evidence_sha256']).lower()
        if len(evidence) != 64 or any(character not in '0123456789abcdef' for character in evidence):
            raise ValueError('Approval evidence must be a sha256 digest.')
        result['commercial'] = {key: value[key] for key in COMMERCIAL}
    else:
        result['commercial'] = None
    return result

def corpus_cases(root: Path, tolerance: float, minimum: int) -> dict:
    """Score a local real-audio corpus. Cases declare their own reviewed reference/proposal."""
    if not root.is_dir():
        raise ValueError('Corpus directory does not exist.')
    cases = []
    for folder in sorted(path for path in root.iterdir() if path.is_dir()):
        metadata_path = folder/'case.json'
        if not metadata_path.is_file():raise ValueError(f'{folder.name} has no case.json.')
        metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
        if not isinstance(metadata,dict):raise ValueError(f'{folder.name} metadata is invalid.')
        if metadata.get('real_audio') is not True:
            raise ValueError(f'{folder.name} is not declared real audio; synthetic cases cannot be accuracy evidence.')
        if metadata.get('reviewed') is not True:
            raise ValueError(f'{folder.name} reference is not declared reviewed.')
        audio = folder/str(metadata.get('audio',''))
        if not audio.is_file() or file_digest(audio)!=str(metadata.get('audio_sha256','')).lower():
            raise ValueError(f'{folder.name} audio is missing or does not match its digest.')
        reference = validate_reviewed_reference(json.loads((folder/str(metadata.get('reference',''))).read_text(encoding='utf-8')))
        proposal = load_events(json.loads((folder/str(metadata.get('proposal',''))).read_text(encoding='utf-8')))
        cases.append({'case':folder.name,'metrics':score_events(reference,proposal,tolerance)})
    if len(cases)<minimum:
        raise ValueError(f'At least {minimum} real-audio cases are required for an accuracy claim.')
    def mean(key):return round(statistics.fmean(case['metrics'][key] for case in cases),4)
    return {'cases':cases,'case_count':len(cases),'real_audio_cases':len(cases),'reviewed_cases':len(cases),
            'aggregate':{'precision':mean('precision'),'recall':mean('recall'),'f1':mean('f1'),
                         'onset_mae_seconds':round(statistics.fmean(case['metrics']['onset_mae_seconds'] for case in cases),4)},
            'evidence_class':'real-audio-reviewed','not_a_licence_or_model_approval':True}


def file_digest(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()


def validate_reviewed_reference(document):
    if not isinstance(document,dict):raise ValueError('Expected a reviewed reference.')
    if document.get('reference_version')!=1 or document.get('subject') not in ('piano','guitar'):
        raise ValueError('A reviewed reference document is required.')
    review=document.get('review')
    if not isinstance(review,dict) or not all(review.get(key) for key in ('reviewer_id','draft_id','reviewed_at','source_reference_sha256')):
        raise ValueError('The reference needs complete review evidence.')
    digest=review['source_reference_sha256']
    if not isinstance(digest,str) or len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest):raise ValueError('Review source identity is invalid.')
    datetime.fromisoformat(review['reviewed_at'].replace('Z','+00:00'))
    duration=document.get('duration')
    if type(duration) not in (float,int) or not math.isfinite(duration) or duration<=0:raise ValueError('Reference duration is invalid.')
    events=load_events(document)
    if any(note['onset']+(note['duration'] or 0)>duration+1e-6 for note in events):raise ValueError('Reference notes exceed the clip.')
    return events


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--artifact-file',type=Path,required=True,help='Local artifact bytes; never downloaded by this harness')
    parser.add_argument('--license-file',type=Path,required=True,help='Retained licence evidence applying to the code/weights')
    parser.add_argument('--approval-file',type=Path,help='Retained commercial approval evidence; required for --use commercial')
    parser.add_argument('--use',choices=('internal-evaluation','commercial'),default='internal-evaluation')
    parser.add_argument('--reference', type=Path, help='Reviewed reference JSON')
    parser.add_argument('--proposal', type=Path, help='Draft/proposal JSON')
    parser.add_argument('--corpus', type=Path, help='Directory of real-audio cases (audio + reviewed reference + proposal)')
    parser.add_argument('--min-cases', type=int, default=3)
    parser.add_argument('--tolerance', type=float, default=0.05)
    parser.add_argument('--output', type=Path)
    arguments = parser.parse_args()
    if bool(arguments.corpus) == bool(arguments.reference or arguments.proposal):
        print('Provide either --corpus or both --reference and --proposal.', file=sys.stderr)
        return 2
    if arguments.corpus and (arguments.reference or arguments.proposal):
        print('Do not mix a corpus with a single reference/proposal.', file=sys.stderr)
        return 2
    if arguments.min_cases < 1:
        print('--min-cases must be positive.', file=sys.stderr)
        return 2
    try:
        artifact = validate_artifact(json.loads(arguments.artifact.read_text(encoding='utf-8')), arguments.use)
        if file_digest(arguments.artifact_file)!=artifact['sha256']:raise ValueError('Artifact bytes do not match the declared sha256.')
        if not arguments.license_file.read_text(encoding='utf-8').strip():raise ValueError('Licence evidence is empty.')
        artifact['license_evidence_sha256']=file_digest(arguments.license_file)
        if arguments.use == 'commercial':
            if not arguments.approval_file:raise ValueError('Commercial qualification requires --approval-file.')
            evidence=arguments.approval_file.read_bytes()
            if not evidence.strip():raise ValueError('Approval evidence is empty.')
            if file_digest(arguments.approval_file)!=artifact['commercial']['approval']['evidence_sha256']:
                raise ValueError('Approval evidence does not match the recorded sha256.')
            artifact['approval_evidence_sha256']=file_digest(arguments.approval_file)
        if arguments.corpus:
            metrics=corpus_cases(arguments.corpus, arguments.tolerance, arguments.min_cases)
            report = {'artifact': artifact, 'corpus': metrics,'artifact_bytes_verified':True,
                      'deployment_eligibility':('commercial-evidence-complete-not-an-approval' if arguments.use=='commercial' else 'internal-evaluation-only'),
                      'qualification_status':'evidence_only_not_model_or_licence_approval'}
        else:
            reference = validate_reviewed_reference(json.loads(arguments.reference.read_text(encoding='utf-8')))
            proposal = load_events(json.loads(arguments.proposal.read_text(encoding='utf-8')))
            metrics=score_events(reference,proposal,arguments.tolerance)
            report = {'artifact': artifact, 'metrics': metrics,'artifact_bytes_verified':True,
                      'deployment_eligibility':('commercial-evidence-complete-not-an-approval' if arguments.use=='commercial' else 'internal-evaluation-only'),
                      'qualification_status':'evidence_only_not_model_or_licence_approval'}
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 2
    text = json.dumps(report, indent=2)
    if arguments.output:
        arguments.output.write_text(text, encoding='utf-8')
    print(text)
    if arguments.corpus:
        aggregate=report['corpus']['aggregate']
        print(f"\n{report['corpus']['case_count']} real-audio reviewed cases: precision {aggregate['precision']:.3f}, recall {aggregate['recall']:.3f}, F1 {aggregate['f1']:.3f}.")
    else:
        metrics = report['metrics']
        print(f"\n{metrics['matched']}/{metrics['reference_notes']} reference notes matched"
              f" (precision {metrics['precision']:.3f}, recall {metrics['recall']:.3f}, F1 {metrics['f1']:.3f}).")
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
