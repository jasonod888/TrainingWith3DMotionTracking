"""Production correction application semantics shared with the benchmark.

This module deliberately has no FastAPI/database dependency. The server and the
benchmark use the same eligibility checks, preconditions, all-or-nothing application and
deterministic generated IDs.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

CORRECTION_POLICY_VERSION = 'piano-corrections-1'
SUPPORTED_OPERATIONS = {'set_onset', 'set_pitch', 'delete_note', 'merge', 'split_note', 'add_note'}
CATEGORY_OPERATIONS = {
    'onset_shift': {'set_onset'}, 'duplicate_event': {'merge'},
    'missed_repetition': {'split_note'}, 'unmatched_attack': {'add_note'},
    'missing_pitch': {'add_note'}, 'extra_pitch': {'delete_note'},
    'octave_ambiguity': {'set_pitch'},
}
FLOAT_FIELDS = {'onset', 'duration', 'velocity'}
APPLICATION_PATH = Path(__file__).resolve()
VERIFIER_PATH = APPLICATION_PATH.with_name('piano_verifier.py')


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def current_application_sha256():
    return file_sha256(APPLICATION_PATH)


def decoder_sha256(configuration, adapter_path):
    """Identity of the input decoder, including code and every preprocessing choice."""
    payload = {key: configuration.get(key) for key in
               ('sample_rate', 'preprocessing', 'thresholds', 'decoding')}
    payload['adapter_code_sha256'] = file_sha256(adapter_path)
    return hashlib.sha256(canonical(payload).encode('utf-8')).hexdigest()


class PreconditionError(ValueError):
    """An edit no longer matches the state it was generated from."""


class EligibilityError(ValueError):
    """A finding is not eligible under the policy that accompanies it."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def report_sha256(report):
    return hashlib.sha256(canonical(report).encode('utf-8')).hexdigest()


def policy_sha256(policy):
    return hashlib.sha256(canonical(policy).encode('utf-8')).hexdigest()


def _matches(item, before):
    if not isinstance(before, dict):
        return False
    if 'id' in before and str(item.get('id')) != str(before['id']):
        return False
    for key, expected in before.items():
        if key == 'id':
            continue
        actual = item.get(key)
        if key in FLOAT_FIELDS:
            if expected is None or actual is None:
                if expected is not actual:
                    return False
            elif abs(float(actual) - float(expected)) > 1e-6:
                return False
        elif actual != expected:
            return False
    return True


def _new_note(identifier, onset, duration, pitch, velocity):
    return {'id': identifier, 'onset': float(onset), 'duration': float(duration),
            'pitch': int(pitch), 'velocity': None if velocity is None else float(velocity),
            'confidence': None, 'optional': False, 'string': None, 'fret': None}


def _clamped_duration(onset, duration, clip_duration):
    if onset < -1e-9 or onset > clip_duration + 1e-9:
        raise ValueError('The proposed note lies outside the clip.')
    length = min(float(duration), float(clip_duration) - float(onset))
    if length <= 0.001:
        raise ValueError('The proposed note lies outside the clip.')
    return length


def apply_finding(events, finding, clip_duration, enforce_preconditions=True):
    result = [dict(event) for event in events]
    finding_id = str(finding.get('id', 'finding'))

    def locate(identifier):
        for item in result:
            if str(item['id']) == str(identifier):
                return item
        raise PreconditionError('Edit references an unknown event.')

    for edit in finding.get('proposed_edits') or []:
        operation = edit.get('op')
        identifiers = [str(value) for value in edit.get('event_ids') or []]
        before = edit.get('before')
        after = edit.get('after')
        if operation == 'set_onset':
            for identifier in identifiers:
                item = locate(identifier)
                if enforce_preconditions and isinstance(before, dict) and 'onset' in before:
                    if abs(float(item['onset']) - float(before['onset'])) > 1e-6:
                        raise PreconditionError('The onset changed since this suggestion was generated.')
                onset = float(after['onset'])
                if onset < 0 or onset > clip_duration + 1e-9:
                    raise ValueError('The proposed onset is outside the clip.')
                item['onset'] = onset
        elif operation == 'set_pitch':
            for identifier in identifiers:
                item = locate(identifier)
                if enforce_preconditions and isinstance(before, dict) and 'pitch' in before:
                    if int(item['pitch']) != int(before['pitch']):
                        raise PreconditionError('The pitch changed since this suggestion was generated.')
                pitch = int(after['pitch'])
                if not 0 <= pitch <= 127:
                    raise ValueError('The proposed pitch is outside the MIDI range.')
                item['pitch'] = pitch
        elif operation == 'delete_note':
            if enforce_preconditions:
                for identifier in identifiers:
                    if not _matches(locate(identifier), before if isinstance(before, dict) else {}):
                        raise PreconditionError('The note changed since this suggestion was generated.')
            else:
                for identifier in identifiers:
                    locate(identifier)
            result = [item for item in result if str(item['id']) not in identifiers]
        elif operation == 'merge':
            if len(identifiers) != 2:
                raise ValueError('A merge needs two events.')
            matches = [locate(value) for value in identifiers]
            if enforce_preconditions:
                snapshots = before if isinstance(before, list) else []
                for item in matches:
                    if not any(_matches(item, snapshot) for snapshot in snapshots):
                        raise PreconditionError('A merged event changed since this suggestion was generated.')
            onset = float(after['onset'])
            length = _clamped_duration(onset, after['duration'], clip_duration)
            merged = _new_note(f'vf-{finding_id}-m', onset, length, after['pitch'],
                               max(float(item.get('velocity') or 0.0) for item in matches))
            result = [item for item in result if str(item['id']) not in identifiers] + [merged]
        elif operation == 'split_note':
            if len(identifiers) != 1:
                raise ValueError('A split needs one event.')
            original = locate(identifiers[0])
            if enforce_preconditions and isinstance(before, dict):
                if not _matches(original, before):
                    raise PreconditionError('The split event changed since this suggestion was generated.')
            pieces = []
            for index, piece in enumerate(after):
                onset = float(piece['onset'])
                length = _clamped_duration(onset, piece['duration'], clip_duration)
                pieces.append(_new_note(f'vf-{finding_id}-{index + 1}', onset, length,
                                        piece['pitch'], original.get('velocity')))
            result = [item for item in result if str(item['id']) != identifiers[0]] + pieces
        elif operation == 'add_note':
            note = after
            onset = float(note['onset'])
            length = _clamped_duration(onset, note['duration'], clip_duration)
            result.append(_new_note(f'vf-{finding_id}-a', onset, length,
                                    note['pitch'], note.get('velocity')))
        else:
            raise ValueError('Unsupported verification edit operation.')
    result.sort(key=lambda item: (float(item['onset']), int(item['pitch']), str(item['id'])))
    return result


def _category_for(kind):
    return kind if kind in {'onset_shift', 'duplicate_event', 'missed_repetition',
                            'unmatched_attack', 'missing_pitch', 'extra_pitch',
                            'octave_ambiguity'} else None


def eligible_findings(report):
    """Validate policy consistency and return eligible findings, or raise."""
    policy_meta = report.get('correction_policy') or {}
    policy = policy_meta.get('policy')
    if report.get('mode') != 'qualified' or policy_meta.get('mode') != 'qualified':
        raise EligibilityError('The report is not in qualified correction mode.')
    if not isinstance(policy, dict) or policy.get('policy_version') != CORRECTION_POLICY_VERSION:
        raise EligibilityError('The correction policy is missing or unsupported.')
    if policy.get('status') != 'qualified':
        raise EligibilityError('The correction policy is not qualified.')
    if policy_meta.get('policy_sha256') != policy_sha256(policy):
        raise EligibilityError('The correction policy digest does not match.')
    implementation = policy.get('implementation') or {}
    if implementation.get('application_code_sha256') != current_application_sha256():
        raise EligibilityError('The correction application changed after qualification.')
    source = report.get('source') or {}
    if implementation.get('verifier_code_sha256') != source.get('verifier_code_sha256'):
        raise EligibilityError('The verifier changed after qualification.')
    if implementation.get('settings_sha256') != report.get('settings_sha256'):
        raise EligibilityError('Verifier settings changed after qualification.')
    for key in ('weights_sha256', 'decoder_sha256'):
        if not isinstance(implementation.get(key), str) or implementation[key] != source.get(key):
            raise EligibilityError('Model weights or decoder configuration changed after qualification.')
    for key in ('model', 'model_version', 'decoder'):
        if implementation.get(key) != source.get(key):
            raise EligibilityError('Verification model/decoder changed after qualification.')
    categories = policy.get('categories') or {}
    enabled = {name for name, item in categories.items()
               if isinstance(item, dict) and item.get('enabled') is True}
    if enabled != set(policy_meta.get('enabled_categories') or []):
        raise EligibilityError('The enabled-category list is inconsistent.')
    selected = []
    for finding in report.get('findings') or []:
        if finding.get('status') != 'suggested':
            continue
        if finding.get('correction_status') != 'qualified':
            continue
        if finding.get('ambiguous'):
            raise EligibilityError('An ambiguous finding cannot be applied automatically.')
        category = _category_for(finding.get('kind'))
        if category not in enabled:
            raise EligibilityError('A finding category is not enabled by the approved policy.')
        edits = finding.get('proposed_edits') or []
        if not edits:
            raise EligibilityError('A qualified finding has no edits.')
        for edit in edits:
            if edit.get('op') not in CATEGORY_OPERATIONS[category]:
                raise EligibilityError('A finding operation is not qualified for its category.')
        selected.append(finding)
    return selected


def apply_qualified_corrections(events, report, clip_duration):
    """Apply every eligible finding all-or-nothing and return events plus history."""
    findings = eligible_findings(report)
    policy = report['correction_policy']['policy']
    digest = report_sha256(report)
    applied = [dict(event) for event in events]
    history = []
    for finding in findings:
        applied = apply_finding(applied, finding, clip_duration)
        history.append({
            'source': 'automatic',
            'finding_id': str(finding['id']),
            'kind': finding.get('kind'),
            'pitch': finding.get('pitch'),
            'time_range': finding.get('time_range'),
            'edits': [dict(edit) for edit in finding.get('proposed_edits') or []],
            'applied_at': datetime.now(timezone.utc).isoformat(),
            'policy_sha256': report['correction_policy'].get('policy_sha256'),
            'report_sha256': digest,
            'correction_status': 'qualified',
            'reverted_at': None,
        })
    validate_events_basic(applied, clip_duration)
    return applied, history, policy


def validate_events_basic(events, clip_duration):
    identifiers = set()
    for event in events:
        identifier = str(event.get('id'))
        if not identifier or identifier in identifiers:
            raise ValueError('The working proposal has duplicate or missing event IDs.')
        identifiers.add(identifier)
        onset = float(event.get('onset'))
        duration = float(event.get('duration') or 0.0)
        pitch = int(event.get('pitch'))
        if onset < 0 or onset > clip_duration + 1e-9 or duration <= 0 or onset + duration > clip_duration + 1e-6:
            raise ValueError('The working proposal has an event outside the clip.')
        if not 0 <= pitch <= 127:
            raise ValueError('The working proposal has an invalid pitch.')

