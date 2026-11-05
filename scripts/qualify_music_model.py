"""Qualify a transcription artifact and benchmark its proposals against a reviewed reference.

This harness installs nothing and downloads nothing. It scores note proposals against a
reviewed reference, records the artifact identity and licence, and refuses an artifact
whose terms are not explicitly approved. A score is evidence for review, never approval.
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

APPROVED_LICENSES = {'Apache-2.0', 'MIT', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'CC-BY-4.0'}
REQUIRED = ('name', 'version', 'license', 'sha256', 'source_url')


def load_events(document: dict) -> list[dict]:
    events = document.get('events')
    if not isinstance(events, list):
        raise ValueError('The document has no note events.')
    result = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            raise ValueError(f'Note {index + 1} is not an object.')
        onset, pitch = event.get('onset'), event.get('pitch')
        if not isinstance(onset, (int, float)) or not isinstance(pitch, int):
            raise ValueError(f'Note {index + 1} has no onset or pitch.')
        result.append({'onset': float(onset), 'pitch': pitch, 'duration': event.get('duration')})
    return sorted(result, key=lambda note: (note['onset'], note['pitch']))


def score_events(reference: list[dict], proposal: list[dict], tolerance: float = 0.05) -> dict:
    """Greedy one-to-one matching by pitch and onset tolerance."""
    unused = list(proposal)
    matched = []
    for expected in reference:
        candidates = [note for note in unused
                      if note['pitch'] == expected['pitch'] and abs(note['onset'] - expected['onset']) <= tolerance]
        if not candidates:
            continue
        best = min(candidates, key=lambda note: abs(note['onset'] - expected['onset']))
        unused.remove(best)
        matched.append(abs(best['onset'] - expected['onset']))
    missing = len(reference) - len(matched)
    extra = len(proposal) - len(matched)
    precision = len(matched) / len(proposal) if proposal else 0.0
    recall = len(matched) / len(reference) if reference else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        'reference_notes': len(reference), 'proposed_notes': len(proposal), 'matched': len(matched),
        'missing': missing, 'extra': extra, 'precision': round(precision, 4), 'recall': round(recall, 4),
        'f1': round(f1, 4), 'onset_mae_seconds': round(statistics.fmean(matched), 4) if matched else None,
        'tolerance_seconds': tolerance,
    }


def validate_artifact(value: dict) -> dict:
    missing = [key for key in REQUIRED if not value.get(key)]
    if missing:
        raise ValueError('Artifact metadata is missing ' + ', '.join(missing) + '.')
    licence = str(value['license'])
    if licence not in APPROVED_LICENSES:
        raise ValueError(f'Artifact licence {licence!r} is not approved for qualification.')
    digest = str(value['sha256']).lower()
    if len(digest) != 64 or any(character not in '0123456789abcdef' for character in digest):
        raise ValueError('Artifact sha256 must be a hex digest.')
    return {'name': str(value['name']), 'version': str(value['version']), 'license': licence,
            'sha256': digest, 'source_url': str(value['source_url'])}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--reference', type=Path, required=True, help='Reviewed reference JSON')
    parser.add_argument('--proposal', type=Path, required=True, help='Draft/proposal JSON')
    parser.add_argument('--tolerance', type=float, default=0.05)
    parser.add_argument('--output', type=Path)
    arguments = parser.parse_args()
    try:
        artifact = validate_artifact(json.loads(arguments.artifact.read_text(encoding='utf-8')))
        reference = load_events(json.loads(arguments.reference.read_text(encoding='utf-8')))
        proposal = load_events(json.loads(arguments.proposal.read_text(encoding='utf-8')))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 2
    report = {'artifact': artifact, 'metrics': score_events(reference, proposal, arguments.tolerance)}
    text = json.dumps(report, indent=2)
    if arguments.output:
        arguments.output.write_text(text, encoding='utf-8')
    print(text)
    metrics = report['metrics']
    print(f"\n{metrics['matched']}/{metrics['reference_notes']} reference notes matched"
          f" (precision {metrics['precision']:.3f}, recall {metrics['recall']:.3f}, F1 {metrics['f1']:.3f}).")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
