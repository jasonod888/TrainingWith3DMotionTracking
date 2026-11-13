"""M0/M1a: the `piano-quality-reference-1` contract and its preparation tooling.

A reference is a frozen record of what is independently known about a recording. Each attribute
carries its own status, provenance and uncertainty, because a reference may know pitch and onset
while knowing nothing about physical key release or captured velocity. "Unknown" is a real state
and never becomes a zero, an estimate or a pass.

The timeline records how original-video time maps to the extracted analysis audio, with an
explicit verification flag: duration agreement alone does not verify alignment.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

SCHEMA = 'piano-quality-reference-1'
SCHEMA_VERSION = 1
CONFIG_VERSION = 'piano-quality-config-1'

# Frozen before any scoring. Changing a tolerance requires a new config version and re-scoring.
TOLERANCES = {
    'onset_match_seconds': 0.050,
    'onset_within_seconds': 0.020,
    'onset_diagnostic_seconds': 0.050,
    'release_seconds': 0.080,
    'velocity_units': 8,
    'velocity_wide_units': 16,
    'pedal_seconds': 0.050,
}
METRIC_VERSIONS = {
    'events': 'piano-event-metrics-2',
    'expression': 'piano-expression-metrics-1',
    'audio': 'piano-reconstruction-objective-2',
    'listening': 'piano-listening-analysis-2',
    'scorecard': 'piano-quality-scorecard-1',
}
ATTRIBUTES = ('pitch_onset', 'key_release', 'audible_end', 'velocity', 'pedal')
STATUSES = ('verified', 'uncertain', 'unavailable')
SPLITS = ('development', 'calibration', 'holdout')
RIGHTS_STATUS = ('approved', 'unresolved')
PEDAL_TYPES = ('sustain', 'soft', 'sostenuto')
TIMING_ATTRIBUTES = ('pitch_onset', 'key_release', 'audible_end', 'pedal')


class ReferenceError(ValueError):
    """The reference violates the contract."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def sha256_of(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def new_reference(*, reference_id, source, performance, scored_interval, rights,
                  split='development', timeline=None, attributes=None, notes=(),
                  created_at=None):
    reference = {
        'schema': SCHEMA,
        'schema_version': SCHEMA_VERSION,
        'config_version': CONFIG_VERSION,
        'metric_versions': dict(METRIC_VERSIONS),
        'reference_id': reference_id,
        'version': 1,
        'created_at': created_at or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'source': dict(source),
        'timeline': dict(timeline or default_timeline()),
        'scored_interval': [float(scored_interval[0]), float(scored_interval[1])],
        'performance': dict(performance),
        'rights': dict(rights),
        'split': split,
        'attributes': dict(attributes or unavailable_attributes()),
        'notes': list(notes),
    }
    validate(reference)
    return reference


def default_timeline():
    return {'origin': 'source_start',
            'video_to_analysis': {'trim_start_seconds': 0.0, 'resample': None,
                                  'method': 'unverified-default', 'offset_seconds': 0.0,
                                  'drift_ppm': None, 'uncertainty_seconds': 0.0,
                                  'verified': False}}


def unavailable_attributes(reason='no independent reference was prepared'):
    return {name: {'status': 'unavailable', 'provenance': reason, 'events': []}
            for name in ATTRIBUTES}


def attribute(status, events, provenance, receipts=None):
    payload = {'status': status, 'provenance': provenance, 'events': list(events)}
    if receipts is not None:
        payload['receipts'] = list(receipts)
    return payload


def validate(reference):
    """Validate the whole contract and return it. Raises ReferenceError on any defect."""
    _object(reference, 'reference', required=(
        'schema', 'schema_version', 'config_version', 'metric_versions', 'reference_id',
        'version', 'created_at', 'source', 'timeline', 'scored_interval', 'performance',
        'rights', 'split', 'attributes', 'notes'))
    if reference['schema'] != SCHEMA:
        raise ReferenceError(f'unsupported schema {reference["schema"]!r}')
    if reference['schema_version'] != SCHEMA_VERSION:
        raise ReferenceError('unsupported schema version')
    if reference['config_version'] != CONFIG_VERSION:
        raise ReferenceError('reference was built with a different tolerance configuration')
    _text(reference['reference_id'], 'reference_id')
    if not isinstance(reference['version'], int) or reference['version'] < 1:
        raise ReferenceError('version must be a positive integer')
    if reference['split'] not in SPLITS:
        raise ReferenceError(f'unsupported split {reference["split"]!r}')

    source = reference['source']
    _object(source, 'source', required=('sha256', 'seconds', 'sample_rate', 'channels'),
            optional=('path_hint',))
    if not isinstance(source['sha256'], str) or len(source['sha256']) != 64:
        raise ReferenceError('source.sha256 must be a 64-character digest')
    seconds = _finite(source['seconds'], 'source.seconds')
    if seconds <= 0:
        raise ReferenceError('source.seconds must be positive')
    if source['channels'] not in (1, 2):
        raise ReferenceError('source.channels must be 1 or 2')
    _integer(source['sample_rate'], 'source.sample_rate', minimum=1)

    interval = reference['scored_interval']
    if not isinstance(interval, list) or len(interval) != 2:
        raise ReferenceError('scored_interval must be [start, end]')
    start, end = _finite(interval[0], 'scored_interval[0]'), _finite(interval[1], 'scored_interval[1]')
    if not 0.0 <= start < end:
        raise ReferenceError('scored_interval must be an increasing non-negative interval')
    if end > seconds + 1.0 / source['sample_rate']:
        raise ReferenceError('scored_interval ends beyond the source duration')

    _timeline(reference['timeline'])

    performance = reference['performance']
    _object(performance, 'performance',
            required=('performance_id', 'performer_id', 'recording_id', 'work_id'))
    for key in ('performance_id', 'performer_id', 'recording_id', 'work_id'):
        _text(performance[key], f'performance.{key}')

    rights = reference['rights']
    _object(rights, 'rights', required=('license', 'status'),
            optional=('receipt_id', 'dataset_revision'))
    if rights['status'] not in RIGHTS_STATUS:
        raise ReferenceError(f'unsupported rights status {rights["status"]!r}')
    _text(rights['license'], 'rights.license')

    attributes = reference['attributes']
    if not isinstance(attributes, dict) or set(attributes) != set(ATTRIBUTES):
        raise ReferenceError(f'attributes must declare exactly {sorted(ATTRIBUTES)}')
    note_ids = set()
    for name in ATTRIBUTES:
        _attribute(attributes[name], name, start, end)
        if name == 'pitch_onset':
            note_ids = {event['id'] for event in attributes[name]['events']}
    for name in ATTRIBUTES:
        if name == 'pitch_onset':
            continue
        for event in attributes[name]['events']:
            if 'note_id' in event and note_ids and event['note_id'] not in note_ids:
                raise ReferenceError(
                    f'{name}: event refers to unknown note {event["note_id"]!r}')

    note_onsets = {event['id']: event['onset_seconds']
                   for event in attributes['pitch_onset']['events']}
    for event in attributes['key_release']['events']:
        onset = note_onsets.get(event['note_id'])
        if onset is not None and event['release_seconds'] <= onset:
            raise ReferenceError(
                f'key_release: release for {event["note_id"]!r} must follow its note onset')
    for event in attributes['audible_end']['events']:
        onset = note_onsets.get(event['note_id'])
        if onset is not None and event['earliest'] < onset:
            raise ReferenceError(
                f'audible_end: earliest for {event["note_id"]!r} must not precede its onset')
    if not isinstance(reference['notes'], list):
        raise ReferenceError('notes must be a list')
    return reference


def _timeline(timeline):
    _object(timeline, 'timeline', required=('origin', 'video_to_analysis'))
    if timeline['origin'] != 'source_start':
        raise ReferenceError('unsupported timeline origin')
    mapping = timeline['video_to_analysis']
    _object(mapping, 'timeline.video_to_analysis',
            required=('trim_start_seconds', 'resample', 'method', 'offset_seconds',
                      'drift_ppm', 'uncertainty_seconds', 'verified'))
    trim = _finite(mapping['trim_start_seconds'], 'trim_start_seconds')
    if trim < 0:
        raise ReferenceError('trim_start_seconds must not be negative')
    _finite(mapping['offset_seconds'], 'offset_seconds')
    _finite(mapping['uncertainty_seconds'], 'uncertainty_seconds')
    if mapping['drift_ppm'] is not None:
        _finite(mapping['drift_ppm'], 'drift_ppm')
    if not isinstance(mapping['verified'], bool):
        raise ReferenceError('timeline verification must be explicit')
    _text(mapping['method'], 'timeline method')
    if mapping['resample'] is not None:
        _object(mapping['resample'], 'resample', required=('from_rate', 'to_rate'),
                optional=('method',))
        _integer(mapping['resample']['from_rate'], 'resample.from_rate', minimum=1)
        _integer(mapping['resample']['to_rate'], 'resample.to_rate', minimum=1)


def _attribute(value, name, interval_start, interval_end):
    _object(value, f'attributes.{name}', required=('status', 'provenance', 'events'),
            optional=('receipts',))
    if value['status'] not in STATUSES:
        raise ReferenceError(f'{name}: unsupported status {value["status"]!r}')
    _text(value['provenance'], f'{name}.provenance')
    receipts = value.get('receipts') or []
    if not isinstance(receipts, list):
        raise ReferenceError(f'{name}.receipts must be a list')
    for index, receipt in enumerate(receipts):
        _object(receipt, f'{name}.receipts[{index}]', required=('reviewer', 'input_sha256'),
                optional=('events',))
        _text(receipt['reviewer'], f'{name}.receipts[{index}].reviewer')
        digest = receipt['input_sha256']
        if not isinstance(digest, str) or len(digest) != 64:
            raise ReferenceError(f'{name}.receipts[{index}].input_sha256 must be a digest')
    events = value['events']
    if not isinstance(events, list):
        raise ReferenceError(f'{name}: events must be a list')
    if value['status'] == 'unavailable' and events:
        raise ReferenceError(f'{name}: unavailable attributes must not carry events')
    identifiers = set()
    for index, event in enumerate(events):
        path = f'{name}.events[{index}]'
        if not isinstance(event, dict):
            raise ReferenceError(f'{path}: must be an object')
        if event.get('status', 'verified') not in ('verified', 'uncertain'):
            raise ReferenceError(f'{path}: event status must be verified or uncertain')
        identifier = _text(event.get('id'), f'{path}.id')
        if identifier in identifiers:
            raise ReferenceError(f'{path}: duplicate event id {identifier!r}')
        identifiers.add(identifier)
        if name == 'pitch_onset':
            _pitch_event(event, path, interval_start, interval_end)
        elif name == 'key_release':
            _release_event(event, path, interval_start, interval_end)
        elif name == 'audible_end':
            _ending_event(event, path, interval_start, interval_end)
        elif name == 'velocity':
            _velocity_event(event, path)
        else:
            _pedal_event(event, path, interval_start, interval_end)


def _pitch_event(event, path, start, end):
    _object(event, path, required=('id', 'pitch', 'onset_seconds'),
            optional=('status', 'onset_uncertainty_seconds'))
    pitch = _integer(event['pitch'], f'{path}.pitch')
    if not 0 <= pitch <= 127:
        raise ReferenceError(f'{path}.pitch must be within 0..127')
    onset = _finite(event['onset_seconds'], f'{path}.onset_seconds')
    if not start <= onset <= end:
        raise ReferenceError(f'{path}.onset_seconds is outside the scored interval')
    if event.get('onset_uncertainty_seconds') is not None:
        uncertainty = _finite(event['onset_uncertainty_seconds'],
                              f'{path}.onset_uncertainty_seconds')
        if uncertainty < 0:
            raise ReferenceError(f'{path}.onset_uncertainty_seconds must not be negative')


def _release_event(event, path, start, end):
    _object(event, path, required=('id', 'note_id', 'release_seconds'),
            optional=('status', 'uncertainty_seconds'))
    _text(event['note_id'], f'{path}.note_id')
    release = _finite(event['release_seconds'], f'{path}.release_seconds')
    if not start <= release <= end:
        raise ReferenceError(f'{path}.release_seconds is outside the scored interval')


def _ending_event(event, path, start, end):
    _object(event, path, required=('id', 'note_id', 'earliest', 'latest'),
            optional=('status',))
    _text(event['note_id'], f'{path}.note_id')
    earliest = _finite(event['earliest'], f'{path}.earliest')
    latest = _finite(event['latest'], f'{path}.latest')
    if earliest < start or latest > end:
        raise ReferenceError(f'{path}: ending interval is outside the scored interval')
    if latest < earliest:
        raise ReferenceError(f'{path}: latest precedes earliest')


def _velocity_event(event, path):
    _object(event, path, required=('id', 'note_id', 'velocity_midi'),
            optional=('status',))
    _text(event['note_id'], f'{path}.note_id')
    velocity = _integer(event['velocity_midi'], f'{path}.velocity_midi')
    if not 1 <= velocity <= 127:
        raise ReferenceError(f'{path}.velocity_midi must be within 1..127')


def _pedal_event(event, path, start, end):
    _object(event, path, required=('id', 'type', 'onset_seconds', 'value'),
            optional=('status', 'carried_in'))
    if event['type'] not in PEDAL_TYPES:
        raise ReferenceError(f'{path}.type is not a supported pedal')
    onset = _finite(event['onset_seconds'], f'{path}.onset_seconds')
    if not start <= onset <= end:
        raise ReferenceError(f'{path}.onset_seconds is outside the scored interval')
    value = _finite(event['value'], f'{path}.value')
    if not 0.0 <= value <= 1.0:
        raise ReferenceError(f'{path}.value must be within 0..1')
    if event.get('carried_in') is not None and not isinstance(event['carried_in'], bool):
        raise ReferenceError(f'{path}.carried_in must be a boolean')


def _object(value, path, required, optional=()):
    if not isinstance(value, dict):
        raise ReferenceError(f'{path} must be an object')
    missing = [key for key in required if key not in value]
    if missing:
        raise ReferenceError(f'{path} is missing {missing}')
    unknown = sorted(set(value) - set(required) - set(optional))
    if unknown:
        raise ReferenceError(f'{path} has unknown field(s) {unknown}')


def _text(value, path):
    if not isinstance(value, str) or not value.strip():
        raise ReferenceError(f'{path} must be a non-empty string')
    return value


def _finite(value, path):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ReferenceError(f'{path} must be a number')
    if not math.isfinite(float(value)):
        raise ReferenceError(f'{path} must be finite')
    return float(value)


def _integer(value, path, minimum=None):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ReferenceError(f'{path} must be an integer')
    if minimum is not None and value < minimum:
        raise ReferenceError(f'{path} must be at least {minimum}')
    return value


def reference_sha256(reference):
    payload = {key: value for key, value in reference.items() if key != 'created_at'}
    return sha256_of(payload)


def attribute_events(reference, name, *, scorable_only=True):
    """Events for one attribute; uncertain events are excluded unless explicitly requested."""
    events = reference['attributes'][name]['events']
    if not scorable_only:
        return list(events)
    return [event for event in events if event.get('status', 'verified') == 'verified']


def is_qualified(reference, name):
    """Whether this attribute may support qualification rather than diagnosis."""
    status = reference['attributes'][name]['status']
    if status != 'verified':
        return False
    if reference['rights']['status'] != 'approved':
        return False
    if name in TIMING_ATTRIBUTES and not reference['timeline']['video_to_analysis']['verified']:
        return False
    return True


def qualification_reasons(reference, name):
    reasons = []
    if reference['attributes'][name]['status'] != 'verified':
        reasons.append(f'{name} reference is {reference["attributes"][name]["status"]}')
    if reference['rights']['status'] != 'approved':
        reasons.append('rights clearance is unresolved')
    if name in TIMING_ATTRIBUTES and not reference['timeline']['video_to_analysis']['verified']:
        reasons.append('video-to-analysis alignment is not verified')
    return reasons


# ------------------------------------------------------------------ captured MIDI import

def _pedal_events_in_interval(events, start, end):
    """Keep controller events in the interval and carry the state known at its start."""
    carried = []
    for pedal_type in PEDAL_TYPES:
        subset = sorted((event for event in events if event['type'] == pedal_type),
                        key=lambda event: event['onset_seconds'])
        before = [event for event in subset if event['onset_seconds'] < start]
        inside = [event for event in subset if start <= event['onset_seconds'] <= end]
        if before:
            carried.append({'id': f'carry-{pedal_type}-in', 'type': pedal_type,
                            'onset_seconds': start,
                            'value': 1.0 if before[-1]['value'] >= 0.5 else 0.0,
                            'carried_in': True})
        carried.extend({'id': event['id'], 'type': event['type'],
                        'onset_seconds': event['onset_seconds'], 'value': event['value']}
                       for event in inside)
    return sorted(carried, key=lambda event: (event['onset_seconds'], event['type']))


def from_captured_midi(path, *, reference_id, source, performance, rights, scored_interval=None,
                       split='development', timeline=None, velocity_status='verified',
                       pitch_status='verified', provenance=None):
    """Build a reference from synchronized instrument capture.

    Captured note-off becomes a physical key release, never an audible ending. Velocity is the
    captured MIDI value, not a renderer intensity.
    """
    try:
        from scripts import prepare_vienna_dataset as capture
    except ImportError:  # pragma: no cover
        import prepare_vienna_dataset as capture

    events = capture.performance_events(path)
    interval = scored_interval or [0.0, float(source['seconds'])]
    start, end = interval

    notes = [note for note in events['notes'] if start <= note['onset_seconds'] <= end]
    pitch_events = [{'id': note['id'], 'pitch': note['pitch'],
                     'onset_seconds': note['onset_seconds'],
                     'status': 'verified' if pitch_status == 'verified' else 'uncertain'}
                    for note in notes]
    release_events = [{'id': f'release-{note["id"]}', 'note_id': note['id'],
                       'release_seconds': note['release_seconds']}
                      for note in notes if start <= note['release_seconds'] <= end]
    velocity_events = [{'id': f'velocity-{note["id"]}', 'note_id': note['id'],
                        'velocity_midi': note['velocity_midi'],
                        'status': 'verified' if velocity_status == 'verified' else 'uncertain'}
                       for note in notes]
    pedal_events = _pedal_events_in_interval(events['pedal'], start, end)
    pedal_status = 'verified' if pedal_events else 'unavailable'
    attributes = {
        'pitch_onset': attribute(pitch_status, pitch_events,
                                 provenance or f'captured MIDI {Path(path).name}'),
        'key_release': attribute('verified', release_events,
                                 f'captured key release from {Path(path).name}'),
        'audible_end': attribute('unavailable', [],
                                 'captured note-off is not an audible-ending annotation'),
        'velocity': attribute(velocity_status, velocity_events,
                              f'captured MIDI velocity from {Path(path).name}'),
        'pedal': attribute(pedal_status, pedal_events,
                           (f'captured controller trajectory from {Path(path).name}'
                            if pedal_events else
                            'the capture contains no controller events; pedal is unavailable, '
                            'not a verified pedal-off')),
    }
    return new_reference(reference_id=reference_id, source=source, performance=performance,
                         scored_interval=interval, rights=rights, split=split,
                         timeline=timeline, attributes=attributes,
                         notes=[f'capture sha256 {events["sha256"]}',
                                f'captured notes in interval {len(notes)}'])


def from_audio_only(*, reference_id, source, performance, rights, scored_interval=None,
                    split='development', timeline=None, reason='no independent annotation yet'):
    """A reference with every attribute explicitly unavailable; annotations arrive later."""
    interval = scored_interval or [0.0, float(source['seconds'])]
    return new_reference(reference_id=reference_id, source=source, performance=performance,
                         scored_interval=interval, rights=rights, split=split,
                         timeline=timeline, attributes=unavailable_attributes(reason))


def source_from_audio(path):
    """Source identity for an extracted analysis WAV."""
    try:
        from scripts import piano_reconstruction_harness as audio
    except ImportError:  # pragma: no cover
        import piano_reconstruction_harness as audio
    header = audio.inspect_wav(path)
    exact_seconds = header['frames'] / float(header['sample_rate'])
    return {'sha256': file_sha256(path), 'seconds': exact_seconds,
            'sample_rate': header['sample_rate'], 'channels': header['channels'],
            'path_hint': str(path)}


# --------------------------------------------------------- annotation and adjudication

def annotation_template(reference, name='pitch_onset'):
    """Reviewer template: known events plus empty columns for independent entry."""
    if name != 'pitch_onset':
        raise ReferenceError('annotation templates are produced for pitch_onset')
    rows = []
    for event in reference['attributes']['pitch_onset']['events']:
        rows.append({'id': event['id'], 'pitch': event['pitch'],
                     'onset_seconds': event['onset_seconds'], 'reviewer': '',
                     'review_note': '', 'agree': ''})
    return rows


def merge_annotations(reference, first_rows, second_rows, *, tolerance=None,
                      adjudicated=None, provenance='two-reviewer adjudication'):
    """Turn two independent reviewer lists into a verified/uncertain attribute.

    Notes agreed within the onset tolerance become verified; unresolved disagreements become
    uncertain and stay visible instead of being silently averaged.
    """
    tolerance = TOLERANCES['onset_match_seconds'] if tolerance is None else float(tolerance)
    try:
        from scripts import piano_quality_events as events_module
    except ImportError:  # pragma: no cover
        import piano_quality_events as events_module

    first, first_reviewers = _reviewer_events(first_rows, 'a')
    second, second_reviewers = _reviewer_events(second_rows, 'b')
    if not first or not second:
        raise ReferenceError('both reviewers must submit at least one annotation')
    if len(first_reviewers) != 1 or len(second_reviewers) != 1:
        raise ReferenceError('each annotation list must come from exactly one reviewer')
    if first_reviewers & second_reviewers:
        raise ReferenceError('the two reviews must come from distinct reviewers')
    correspondence = events_module.match_events(first, second, tolerance=tolerance)
    merged = []
    used_second = set()
    for pair in correspondence['pairs']:
        left = next(event for event in first if event['id'] == pair['reference_id'])
        right = next(event for event in second if event['id'] == pair['candidate_id'])
        used_second.add(right['id'])
        merged.append({'id': f'adjudicated-{len(merged) + 1:04d}',
                       'pitch': left['pitch'],
                       'onset_seconds': round((left['onset_seconds'] +
                                               right['onset_seconds']) / 2.0, 6),
                       'status': 'verified',
                       'onset_uncertainty_seconds': round(
                           abs(left['onset_seconds'] - right['onset_seconds']) / 2.0, 6)})
    used_first = {pair['reference_id'] for pair in correspondence['pairs']}
    for side, events, used in (('a', first, used_first), ('b', second, used_second)):
        for event in events:
            if event['id'] in used:
                continue
            merged.append({'id': f'uncertain-{side}-{event["id"]}',
                           'pitch': event['pitch'],
                           'onset_seconds': event['onset_seconds'],
                           'status': 'uncertain'})
    if adjudicated:
        merged = _apply_adjudication(merged, adjudicated)
    merged.sort(key=lambda event: (event['onset_seconds'], event['pitch'], event['id']))
    receipts = [
        {'reviewer': sorted(first_reviewers)[0],
         'input_sha256': sha256_of(first_rows), 'events': len(first)},
        {'reviewer': sorted(second_reviewers)[0],
         'input_sha256': sha256_of(second_rows), 'events': len(second)},
    ]
    if adjudicated:
        receipts.append({'reviewer': 'adjudicator', 'input_sha256': sha256_of(adjudicated),
                         'events': len(adjudicated)})
    result = attribute('verified' if any(event['status'] == 'verified' for event in merged)
                       else 'uncertain', merged, provenance, receipts=receipts)
    reference['attributes']['pitch_onset'] = result
    validate(reference)
    return reference


def _reviewer_events(rows, side):
    """Validate one reviewer's list, including the reviewer identity."""
    events = []
    reviewers = set()
    for index, row in enumerate(rows):
        reviewer = str(row.get('reviewer') or '').strip()
        if not reviewer:
            raise ReferenceError(f'{side}[{index}] has no reviewer identity')
        reviewers.add(reviewer)
        pitch = _integer(int(row['pitch']), f'{side}[{index}].pitch')
        if not 0 <= pitch <= 127:
            raise ReferenceError(f'{side}[{index}].pitch must be within 0..127')
        onset = _finite(float(row['onset_seconds']), f'{side}[{index}].onset_seconds')
        events.append({'id': f'{side}-{index:04d}', 'pitch': pitch,
                       'onset_seconds': onset})
    return sorted(events, key=lambda event: (event['onset_seconds'], event['pitch'],
                                             event['id'])), reviewers


def _apply_adjudication(merged, adjudicated):
    """Adjudicator decisions keyed by merged event id: keep, drop or re-time."""
    decisions = {str(item['id']): item for item in adjudicated}
    final = []
    for event in merged:
        decision = decisions.get(event['id'])
        if decision is None:
            final.append(event)
            continue
        if decision.get('decision') == 'drop':
            continue
        updated = dict(event)
        if decision.get('decision') == 'keep':
            updated['status'] = 'verified'
        if decision.get('onset_seconds') is not None:
            updated['onset_seconds'] = float(decision['onset_seconds'])
            updated['status'] = 'verified'
        final.append(updated)
    return final


def main(argv=None):
    parser = argparse.ArgumentParser(description='Validate or inspect a piano quality reference.')
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--validate', action='store_true')
    parser.add_argument('--summary', action='store_true')
    parser.add_argument('--template', choices=('pitch_onset',))
    arguments = parser.parse_args(argv)
    if not arguments.reference:
        parser.error('--reference is required')
    try:
        reference = json.loads(arguments.reference.read_text(encoding='utf-8'))
        validate(reference)
    except (ReferenceError, json.JSONDecodeError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    if arguments.template:
        print(json.dumps(annotation_template(reference, arguments.template), indent=2))
        return 0
    summary = {'reference_id': reference['reference_id'],
               'sha256': reference_sha256(reference),
               'split': reference['split'],
               'scored_interval': reference['scored_interval'],
               'alignment_verified': reference['timeline']['video_to_analysis']['verified'],
               'attributes': {name: {'status': reference['attributes'][name]['status'],
                                     'events': len(reference['attributes'][name]['events']),
                                     'qualified': is_qualified(reference, name),
                                     'reasons': qualification_reasons(reference, name)}
                              for name in ATTRIBUTES}}
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
