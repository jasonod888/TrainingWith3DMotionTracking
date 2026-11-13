"""Fit a recording-domain calibration from measured captured-MIDI training rows.

This does not qualify the calibration or register a production worker profile.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.piano_velocity_calibration import fit, digest
from scripts.piano_expression_identity import measurement_sha256
from scripts.piano_settings import DEFAULT_SETTINGS, merge_settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--measurements', type=Path, required=True)
    parser.add_argument('--domain', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--settings', type=Path)
    args = parser.parse_args()
    payload = json.loads(args.measurements.read_text())
    rows = payload.get('rows') if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        parser.error('Supply measured rows with independent training/calibration performance identities.')
    settings = merge_settings(DEFAULT_SETTINGS, json.loads(args.settings.read_text()) if args.settings else None)
    artifact = fit(rows, args.domain, measurement_sha256(digest(settings)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2) + '\n')
    print(json.dumps({'calibration_id': artifact['calibration_id'], 'domain': artifact['domain'],
                      'supported_pitches': len(artifact['pitch_offsets']),
                      'qualification_status': artifact['qualification_status']}, indent=2))


if __name__ == '__main__': main()
