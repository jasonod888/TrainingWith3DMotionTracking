"""Validate expression reference data before it can be scored.

This is the annotation contract described in docs/expression-reference-data.md. It does
not qualify anything; it only prevents key-release, written-duration or uncalibrated-gain
values from being treated as audible-ending/velocity references.
"""
import argparse
import json
import math
import re
from pathlib import Path

HEX = re.compile(r'^[a-f0-9]{64}$')


def validate_document(value):
    if not isinstance(value, dict) or value.get('reference_version') != 1:
        raise ValueError('Expression reference must use reference_version 1.')
    for key in ('performance_id', 'piece_id', 'instrument', 'split', 'audio_sha256', 'notes'):
        if key not in value:
            raise ValueError(f'Expression reference is missing {key}.')
    if value['split'] not in ('development', 'calibration', 'holdout'):
        raise ValueError('Expression reference has an invalid split.')
    if not isinstance(value['audio_sha256'], str) or not HEX.match(value['audio_sha256']):
        raise ValueError('Expression reference audio hash is invalid.')
    if not isinstance(value['notes'], list) or not value['notes']:
        raise ValueError('Expression reference has no notes.')
    seen = set()
    normalized = []
    for note in value['notes']:
        if not isinstance(note, dict):
            raise ValueError('An expression reference note is invalid.')
        identifier = note.get('event_id')
        if not isinstance(identifier, str) or not identifier or identifier in seen:
            raise ValueError('Expression reference note identities must be unique.')
        seen.add(identifier)
        pitch = note.get('pitch')
        onset = note.get('onset_seconds')
        if isinstance(pitch, bool) or not isinstance(pitch, int) or not 0 <= pitch <= 127 or isinstance(onset, bool) \
                or not isinstance(onset, (int, float)) or not math.isfinite(onset) or onset < 0:
            raise ValueError(f'Reference note {identifier} has an invalid pitch/onset.')
        end = note.get('audible_end')
        if not isinstance(end, dict):
            raise ValueError(f'Reference note {identifier} has no audible_end interval.')
        if end.get('unscorable') is True:
            normalized.append({'event_id': identifier, 'pitch': pitch, 'onset_seconds': onset,
                               'unscorable': True, 'reason': end.get('reason') or 'masked'})
            continue
        earliest, latest = end.get('earliest'), end.get('latest')
        if isinstance(earliest, bool) or isinstance(latest, bool) \
                or not isinstance(earliest, (int, float)) or not isinstance(latest, (int, float)) \
                or not math.isfinite(earliest) or not math.isfinite(latest) or earliest < onset or latest < earliest:
            raise ValueError(f'Reference note {identifier} has an invalid audible interval.')
        calibration = note.get('calibration_id')
        normalized.append({'event_id': identifier, 'pitch': pitch, 'onset_seconds': onset,
                           'audible_interval': [float(earliest), float(latest)],
                           'key_release_seconds': note.get('key_release_seconds'),
                           'calibration_id': calibration, 'unscorable': False})
    return {**value, 'notes': normalized}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    args = parser.parse_args()
    value = validate_document(json.loads(args.reference.read_text(encoding='utf-8')))
    print(json.dumps({'performance_id': value['performance_id'],
                      'split': value['split'], 'notes': len(value['notes'])}, indent=2))


if __name__ == '__main__':
    main()
