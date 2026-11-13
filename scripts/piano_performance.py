"""Versioned piano performance document separating every timing and dynamics target.

The plan's central hazard is conflation: one number cannot mean physical key release,
pedal-extended activity, audible end, written duration, captured velocity, renderer
intensity and audio gain at once. This module therefore keeps them in separate fields,
never fills an unknown value with an invented measurement, and rejects unknown keys so
a strict consumer cannot silently drop a semantic.

Nothing here estimates anything. Estimation belongs to analysis stages; this module only
stores what a stage produced, with provenance, or ``None`` when nothing was produced.
"""
import hashlib
import json
import math
import re

SCHEMA = 'piano-performance-1'
SCHEMA_VERSION = 1
SEMANTICS_VERSION = 'piano-performance-semantics-1'

TIMELINE_ORIGINS = ('source_start',)
AUDIBLE_END_STATUS = ('scorable', 'uncertain')
PEDAL_TYPES = ('sustain', 'soft', 'sostenuto')
NOTE_KEYS = ('id', 'pitch_midi', 'onset_seconds', 'key_release_seconds',
             'release_provenance', 'audible_end', 'velocity_midi', 'velocity_provenance',
             'render_intensity', 'written', 'legacy', 'tags')
DOCUMENT_KEYS = ('schema', 'schema_version', 'semantics_version', 'performance_id',
                 'source', 'timeline', 'notes', 'pedal', 'sound_model', 'provenance')
SOURCE_KEYS = ('sha256', 'duration_seconds', 'sample_rate', 'channels', 'path_hint')
TIMELINE_KEYS = ('origin', 'sample_rate')
AUDIBLE_END_KEYS = ('earliest', 'latest', 'status')
WRITTEN_KEYS = ('duration_ticks', 'voice', 'tie')
PEDAL_KEYS = ('id', 'type', 'onset_seconds', 'value')
SOUND_MODEL_KEYS = ('renderer', 'version', 'asset_sha256', 'profile', 'channels')
PROVENANCE_KEYS = ('origin', 'baseline_id', 'model', 'decoder', 'changes', 'policy', 'notes')
LEGACY_KEYS = ('duration_seconds', 'velocity_amplitude', 'semantics')
HEX64 = re.compile(r'^[0-9a-f]{64}$')


class PerformanceError(ValueError):
    """A performance document violates the contract."""

    def __init__(self, message, path=''):
        super().__init__(f'{path}: {message}' if path else message)
        self.path = path


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def new_document(*, performance_id, source, timeline=None, sound_model=None,
                 origin='model', baseline_id=None):
    """Create an empty, valid document. Unknown values stay ``None``."""
    document = {
        'schema': SCHEMA,
        'schema_version': SCHEMA_VERSION,
        'semantics_version': SEMANTICS_VERSION,
        'performance_id': performance_id,
        'source': dict(source),
        'timeline': dict(timeline or {'origin': 'source_start',
                                      'sample_rate': int(source.get('sample_rate') or 44100)}),
        'notes': [],
        'pedal': [],
        'sound_model': dict(sound_model or {'renderer': None, 'version': None,
                                            'asset_sha256': None, 'profile': {},
                                            'channels': 2}),
        'provenance': {'origin': origin, 'baseline_id': baseline_id, 'model': None,
                       'decoder': None, 'changes': [], 'policy': None, 'notes': []},
    }
    validate(document)
    return document


def add_note(document, *, note_id, pitch_midi, onset_seconds, key_release_seconds=None,
             velocity_midi=None, render_intensity=None, audible_end=None, written=None,
             legacy=None, release_provenance=None, velocity_provenance=None, tags=None):
    """Append a note. Every unmeasured attribute must be passed as ``None``.

    The candidate is validated before it is committed, so a rejected edit cannot leave
    the document in an invalid state.
    """
    note = {'id': note_id, 'pitch_midi': pitch_midi, 'onset_seconds': onset_seconds,
            'key_release_seconds': key_release_seconds,
            'release_provenance': release_provenance,
            'audible_end': audible_end,
            'velocity_midi': velocity_midi, 'velocity_provenance': velocity_provenance,
            'render_intensity': render_intensity, 'written': written, 'legacy': legacy,
            'tags': list(tags or [])}
    validate({**document, 'notes': list(document['notes']) + [note]})
    document['notes'].append(note)
    return note


def add_pedal(document, *, pedal_id, pedal_type, onset_seconds, value,
              confidence=None, provenance=None):
    event = {'id': pedal_id, 'type': pedal_type,
             'onset_seconds': onset_seconds, 'value': value,
             'confidence': confidence, 'provenance': provenance}
    validate({**document, 'pedal': list(document['pedal']) + [event]})
    document['pedal'].append(event)
    return event


def from_legacy_events(events, *, source, performance_id, written=None, policy=None):
    """Adapt legacy ``{id, onset, duration, pitch, velocity}`` events without reinterpreting them.

    The legacy duration is preserved as ``legacy.duration_seconds``. It is *not* promoted
    to ``key_release_seconds`` and the amplitude is *not* promoted to ``velocity_midi``,
    because neither has been measured as that quantity.
    """
    document = new_document(performance_id=performance_id, source=source, origin='legacy')
    document['provenance']['policy'] = policy
    for index, event in enumerate(events):
        identifier = str(event.get('id') or f'legacy-{index}')
        duration = event.get('duration')
        amplitude = event.get('velocity')
        add_note(
            document,
            note_id=identifier,
            pitch_midi=int(event['pitch']),
            onset_seconds=float(event['onset']),
            key_release_seconds=None,
            velocity_midi=None,
            audible_end=None,
            written=(written or {}).get(identifier),
            legacy={'duration_seconds': None if duration is None else float(duration),
                    'velocity_amplitude': None if amplitude is None else float(amplitude),
                    'semantics': 'legacy-not-release'},
        )
    return document


def note_off_seconds(note, *, fallback_seconds=None):
    """Note-off for MIDI export, and whether it is measured.

    A measured key release is exported as-is. Otherwise the legacy duration is used when
    present, and only then a documented fallback. The caller must disclose ``estimated``
    rather than presenting the result as a measured release.
    """
    release = note.get('key_release_seconds')
    if release is not None:
        return float(release), False
    legacy = note.get('legacy') or {}
    duration = legacy.get('duration_seconds')
    if duration is not None:
        return float(note['onset_seconds']) + float(duration), True
    if fallback_seconds is not None:
        return float(note['onset_seconds']) + float(fallback_seconds), True
    raise PerformanceError(
        'note has no key release and no legacy duration; a release estimate must be '
        'chosen explicitly and disclosed as estimated', f'notes[{note.get("id")}]')


def sorted_notes(document):
    return sorted(document['notes'],
                  key=lambda note: (float(note['onset_seconds']), int(note['pitch_midi']),
                                    str(note['id'])))


def notes_active_at(document, seconds):
    """Notes whose key is plausibly down at ``seconds``; unknown release cannot be active."""
    active = []
    for note in document['notes']:
        onset = float(note['onset_seconds'])
        release = note.get('key_release_seconds')
        if onset <= seconds and (release is not None and float(release) > seconds):
            active.append(note)
    return active


def validate(document):
    """Validate structure, ranges and cross-field invariants. Returns the document."""
    _object(document, 'document', required=DOCUMENT_KEYS, optional=())
    if document['schema'] != SCHEMA:
        raise PerformanceError(f'unsupported schema {document["schema"]!r}', 'schema')
    if document['schema_version'] != SCHEMA_VERSION:
        raise PerformanceError(f'unsupported version {document["schema_version"]!r}',
                               'schema_version')
    if document['semantics_version'] != SEMANTICS_VERSION:
        raise PerformanceError(
            f'unsupported semantics {document["semantics_version"]!r}; a different '
            'semantics version needs an explicit migration', 'semantics_version')
    _text(document['performance_id'], 'performance_id')
    _source(document['source'])
    _timeline(document['timeline'])
    _sound_model(document['sound_model'])
    _provenance(document['provenance'])

    if not isinstance(document['notes'], list):
        raise PerformanceError('must be a list', 'notes')
    identifiers = set()
    for index, note in enumerate(document['notes']):
        _note(note, f'notes[{index}]', identifiers)

    if not isinstance(document['pedal'], list):
        raise PerformanceError('must be a list', 'pedal')
    pedal_ids = set()
    for index, event in enumerate(document['pedal']):
        _pedal(event, f'pedal[{index}]', pedal_ids)
    return document


def _source(source):
    _object(source, 'source', required=('sha256', 'duration_seconds'), optional=('sample_rate',
                                                                               'channels',
                                                                               'path_hint'))
    if source.get('sha256') is not None and not HEX64.match(str(source['sha256'])):
        raise PerformanceError('must be a 64-character lowercase hex digest', 'source.sha256')
    duration = _finite(source['duration_seconds'], 'source.duration_seconds')
    if duration <= 0:
        raise PerformanceError('must be positive', 'source.duration_seconds')
    if source.get('sample_rate') is not None:
        _integer(source['sample_rate'], 'source.sample_rate', minimum=1)
    if source.get('channels') is not None:
        _integer(source['channels'], 'source.channels', minimum=1)


def _timeline(timeline):
    _object(timeline, 'timeline', required=TIMELINE_KEYS)
    if timeline['origin'] not in TIMELINE_ORIGINS:
        raise PerformanceError(f'unsupported origin {timeline["origin"]!r}', 'timeline.origin')
    _integer(timeline['sample_rate'], 'timeline.sample_rate', minimum=1)


def _sound_model(sound_model):
    _object(sound_model, 'sound_model', required=SOUND_MODEL_KEYS)
    for key in ('renderer', 'version'):
        if sound_model[key] is not None:
            _text(sound_model[key], f'sound_model.{key}')
    asset = sound_model.get('asset_sha256')
    if asset is not None and not HEX64.match(str(asset)):
        raise PerformanceError('must be a 64-character lowercase hex digest',
                               'sound_model.asset_sha256')
    if not isinstance(sound_model.get('profile'), dict):
        raise PerformanceError('must be an object', 'sound_model.profile')
    try:
        canonical(sound_model['profile'])
    except (TypeError, ValueError) as error:
        raise PerformanceError(f'profile is not serializable: {error}',
                               'sound_model.profile') from error
    _integer(sound_model['channels'], 'sound_model.channels', minimum=1)


def _provenance(provenance):
    _object(provenance, 'provenance', required=PROVENANCE_KEYS)
    if provenance['origin'] not in ('model', 'legacy', 'manual', 'refined'):
        raise PerformanceError(f'unsupported origin {provenance["origin"]!r}',
                               'provenance.origin')
    for key in ('baseline_id', 'policy'):
        if provenance[key] is not None:
            _text(provenance[key], f'provenance.{key}')
    if not isinstance(provenance['changes'], list):
        raise PerformanceError('must be a list', 'provenance.changes')
    if not isinstance(provenance['notes'], list):
        raise PerformanceError('must be a list', 'provenance.notes')


def _note(note, path, identifiers):
    _object(note, path, required=NOTE_KEYS)
    identifier = _text(note['id'], f'{path}.id')
    if identifier in identifiers:
        raise PerformanceError(f'duplicate note id {identifier!r}', f'{path}.id')
    identifiers.add(identifier)

    pitch = _integer(note['pitch_midi'], f'{path}.pitch_midi')
    if not 0 <= pitch <= 127:
        raise PerformanceError('must be within 0..127', f'{path}.pitch_midi')
    onset = _finite(note['onset_seconds'], f'{path}.onset_seconds')
    if onset < 0:
        raise PerformanceError('must not be negative', f'{path}.onset_seconds')

    release = note['key_release_seconds']
    if release is not None:
        release = _finite(release, f'{path}.key_release_seconds')
        if release <= onset:
            raise PerformanceError('must be after the onset', f'{path}.key_release_seconds')
    _audible_end(note['audible_end'], f'{path}.audible_end', onset)

    velocity = note['velocity_midi']
    if velocity is not None:
        velocity = _integer(velocity, f'{path}.velocity_midi')
        if not 1 <= velocity <= 127:
            raise PerformanceError('must be within 1..127', f'{path}.velocity_midi')
    intensity = note['render_intensity']
    if intensity is not None:
        _unit(intensity, f'{path}.render_intensity')

    _written(note['written'], f'{path}.written')
    _legacy(note['legacy'], f'{path}.legacy')
    _provenance_block(note['release_provenance'], f'{path}.release_provenance')
    _provenance_block(note['velocity_provenance'], f'{path}.velocity_provenance')
    if not isinstance(note['tags'], list) or not all(isinstance(tag, str) for tag in note['tags']):
        raise PerformanceError('must be a list of strings', f'{path}.tags')


def _audible_end(audible_end, path, onset):
    if audible_end is None:
        return
    _object(audible_end, path, required=AUDIBLE_END_KEYS, optional=('provenance',))
    status = audible_end['status']
    if status not in AUDIBLE_END_STATUS:
        raise PerformanceError(f'unsupported status {status!r}', f'{path}.status')
    earliest, latest = audible_end['earliest'], audible_end['latest']
    if earliest is None and latest is None:
        if status == 'scorable':
            raise PerformanceError('a scorable audible end needs an interval', path)
        return
    if earliest is None or latest is None:
        raise PerformanceError('earliest and latest must both be set or both be null', path)
    earliest = _finite(earliest, f'{path}.earliest')
    latest = _finite(latest, f'{path}.latest')
    if earliest < onset:
        raise PerformanceError('cannot precede the onset', f'{path}.earliest')
    if latest < earliest:
        raise PerformanceError('latest must not precede earliest', f'{path}.latest')


def _written(written, path):
    if written is None:
        return
    _object(written, path, required=('duration_ticks',), optional=('voice', 'tie'))
    _integer(written['duration_ticks'], f'{path}.duration_ticks', minimum=1)
    if written.get('voice') is not None:
        _integer(written['voice'], f'{path}.voice', minimum=1)
    if written.get('tie') is not None and not isinstance(written['tie'], bool):
        raise PerformanceError('must be a boolean', f'{path}.tie')


def _legacy(legacy, path):
    if legacy is None:
        return
    _object(legacy, path, required=LEGACY_KEYS)
    if legacy['semantics'] != 'legacy-not-release':
        raise PerformanceError(
            'legacy values must be labelled "legacy-not-release"; they are not a '
            'physical release or a captured velocity', f'{path}.semantics')
    for key in ('duration_seconds', 'velocity_amplitude'):
        if legacy[key] is not None:
            _finite(legacy[key], f'{path}.{key}')


def _provenance_block(block, path):
    if block is None:
        return
    if not isinstance(block, dict):
        raise PerformanceError('must be an object or null', path)
    for key, value in block.items():
        if value is None or isinstance(value, (str, bool)):
            continue
        if isinstance(value, (int, float)):
            _finite(value, f'{path}.{key}')
            continue
        if isinstance(value, (list, dict)):
            try:
                canonical(value)
            except (TypeError, ValueError) as error:
                raise PerformanceError(f'{key} is not serializable', path) from error
            continue
        raise PerformanceError(f'{key} has an unsupported type', path)


def _pedal(event, path, identifiers):
    _object(event, path, required=PEDAL_KEYS, optional=('confidence', 'provenance'))
    identifier = _text(event['id'], f'{path}.id')
    if identifier in identifiers:
        raise PerformanceError(f'duplicate pedal id {identifier!r}', f'{path}.id')
    identifiers.add(identifier)
    if event['type'] not in PEDAL_TYPES:
        raise PerformanceError(f'unsupported pedal {event["type"]!r}', f'{path}.type')
    onset = _finite(event['onset_seconds'], f'{path}.onset_seconds')
    if onset < 0:
        raise PerformanceError('must not be negative', f'{path}.onset_seconds')
    _unit(event['value'], f'{path}.value')
    if event.get('confidence') is not None:
        _unit(event['confidence'], f'{path}.confidence')
    _provenance_block(event.get('provenance'), f'{path}.provenance')


def _object(value, path, required, optional=()):
    if not isinstance(value, dict):
        raise PerformanceError('must be an object', path)
    missing = [key for key in required if key not in value]
    if missing:
        raise PerformanceError(f'missing required field(s) {missing}', path)
    allowed = set(required) | set(optional)
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise PerformanceError(
            f'unknown field(s) {unknown}; a semantic must not be added silently', path)


def _text(value, path):
    if not isinstance(value, str) or not value.strip():
        raise PerformanceError('must be a non-empty string', path)
    return value


def _finite(value, path):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PerformanceError('must be a number', path)
    if not math.isfinite(float(value)):
        raise PerformanceError('must be finite', path)
    return float(value)


def _unit(value, path):
    number = _finite(value, path)
    if not 0.0 <= number <= 1.0:
        raise PerformanceError('must be within 0..1', path)
    return number


def _integer(value, path, minimum=None):
    if isinstance(value, bool) or not isinstance(value, int):
        raise PerformanceError('must be an integer', path)
    if minimum is not None and value < minimum:
        raise PerformanceError(f'must be at least {minimum}', path)
    return value


def document_sha256(document):
    return hashlib.sha256(canonical(document).encode('utf-8')).hexdigest()


def to_json(document, *, indent=2):
    validate(document)
    return json.dumps(document, indent=indent, sort_keys=True, allow_nan=False)


def from_json(text):
    try:
        document = json.loads(text)
    except json.JSONDecodeError as error:
        raise PerformanceError(f'document is not valid JSON: {error}') from error
    return validate(document)
