"""Server-side integrity checks for the editable piano notation document.

The browser owns the rich editor model, but the server must not persist a reference
whose notation disagrees with its performance events or whose measures are malformed.
Derived segments and ties are rebuilt by the client reader; this module checks the
editable core and the performance binding.
"""
from __future__ import annotations

import re
from typing import Any

from . import interactive_limit

PPQ = 480
GRID = 120
MAX_MEASURES = 512
MAX_EVENTS = 20000
MAX_NOTES = 40000
STAFFS = {'treble', 'bass'}


def _fail(message: str) -> None:
    raise ValueError(message)


def _number(value: Any, name: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not float('-inf') < float(value) < float('inf'):
        _fail(f'The notation has an invalid {name}.')
    return float(value)


def _integer(value: Any, name: str, low: int, high: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < low or value > high:
        _fail(f'The notation has an invalid {name}.')
    return value


def _text(value: Any, name: str, maximum: int = 80) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        _fail(f'The notation has an invalid {name}.')
    return value


def _performance_matches(notation: dict[str, Any], events: list[Any], duration: float) -> None:
    raw = notation.get('performance')
    if not isinstance(raw, list) or len(raw) != len(events):
        _fail('The notation performance must match the reviewed events.')
    by_id = {}
    for item in raw:
        if not isinstance(item, dict):
            _fail('The notation has an invalid performance event.')
        identifier = _text(item.get('id'), 'performance id')
        if identifier in by_id:
            _fail('The notation repeats a performance id.')
        by_id[identifier] = item
    seen = set()
    for event in events:
        identifier = event.id
        if identifier in seen or identifier not in by_id:
            _fail('The notation performance must match the reviewed events.')
        seen.add(identifier)
        item = by_id[identifier]
        if abs(_number(item.get('onset'), 'performance onset') - event.onset) > 1e-6:
            _fail('A notation performance onset does not match the reviewed event.')
        if item.get('pitch') != event.pitch:
            _fail('A notation performance pitch does not match the reviewed event.')
        if (item.get('duration') is None) != (event.duration is None):
            _fail('A notation performance duration does not match the reviewed event.')
        if event.duration is not None and abs(_number(item.get('duration'), 'performance duration') - event.duration) > 1e-6:
            _fail('A notation performance duration does not match the reviewed event.')
        if (item.get('velocity') is None) != (event.velocity is None):
            _fail('A notation performance velocity does not match the reviewed event.')
        if event.velocity is not None and abs(_number(item.get('velocity'), 'performance velocity') - event.velocity) > 1e-6:
            _fail('A notation performance velocity does not match the reviewed event.')
        if bool(item.get('optional')) != bool(event.optional):
            _fail('A notation performance optional flag does not match the reviewed event.')
    if any(item.onset + (item.duration or 0) > duration + 1e-6 for item in events):
        _fail('The notation performance leaves the clip.')


def _validate_hand_metadata(value: dict[str, Any], performance_ids: set[str]) -> None:
    version = value.get('hand_assignment_version')
    assignments = value.get('hand_assignments')
    if version is None and assignments is None:
        return
    if version != 1:
        _fail('The hand assignment metadata version is invalid.')
    if not isinstance(assignments, dict):
        _fail('The hand assignment metadata is invalid.')
    for occurrence_id, item in assignments.items():
        if occurrence_id not in performance_ids:
            _fail('A hand assignment references a missing performance note.')
        if not isinstance(item, dict):
            _fail('A hand assignment is invalid.')
        if item.get('hand') not in ('left', 'right', 'unassigned'):
            _fail('A hand assignment label is invalid.')
        if item.get('source') not in ('manual', 'baseline', 'midi2hands', 'hybrid'):
            _fail('A hand assignment source is invalid.')
        if item.get('confidence') not in ('clear', 'ambiguous', 'conflict'):
            _fail('A hand assignment confidence is invalid.')
        manual = item.get('manual')
        if not isinstance(manual, bool) or (item.get('source') == 'manual') != manual:
            _fail('A hand assignment manual flag is invalid.')
        reason = item.get('reason')
        if reason is not None and (not isinstance(reason, str) or len(reason) > 200):
            _fail('A hand assignment reason is invalid.')
        fingerprint = item.get('fingerprint')
        if not manual:
            if not isinstance(fingerprint, str) or not re.fullmatch(r'ph1:[0-9a-f]{64}', fingerprint):
                _fail('An automatic hand assignment has no valid performance fingerprint.')
        model = item.get('model')
        if model is not None:
            if (not isinstance(model, dict) or not isinstance(model.get('name'), str)
                    or not model.get('name') or not isinstance(model.get('version'), str)
                    or not model.get('version')):
                _fail('A hand assignment model identity is invalid.')
        if item.get('source') in ('midi2hands', 'hybrid') and model is None:
            _fail('A model hand assignment has no model identity.')


def validate_notation(value: Any, events: list[Any], duration: float) -> dict[str, Any]:
    """Return the document after checking its editable core; raises ValueError on refusal."""
    if not isinstance(value, dict):
        _fail('The notation is not a document.')
    if value.get('notation_version') != 1:
        _fail('This notation version is unsupported.')
    if value.get('subject') != 'piano':
        _fail('Notation editing is only available for piano lessons.')
    performance = value.get('performance')
    occurrence_count = len(performance) if isinstance(performance, list) else -1
    if occurrence_count >= 0:
        limit_error = interactive_limit.write_error(
            occurrence_count, interactive_limit.INTERACTIVE_LIMIT_APPROVED)
        if limit_error:
            _fail(limit_error)
    notated_duration = _number(value.get('duration'), 'duration')
    if notated_duration <= 0 or abs(notated_duration - duration) > 1e-6:
        _fail('The notation duration must match the reviewed clip.')
    if value.get('ppq') != PPQ:
        _fail('The notation tick resolution is unsupported.')

    tempo = value.get('tempo')
    if not isinstance(tempo, dict):
        _fail('The notation has no tempo.')
    bpm = _number(tempo.get('bpm'), 'tempo')
    if bpm < 20 or bpm > 300:
        _fail('The notation tempo is out of range.')
    if tempo.get('beat_unit') != 4 or tempo.get('mode') != 'notation':
        _fail('The notation tempo mode is unsupported.')
    if tempo.get('source') not in ('estimated', 'instructor'):
        _fail('The notation tempo source is invalid.')

    signature = value.get('time_signature')
    if not isinstance(signature, dict):
        _fail('The notation has no time signature.')
    numerator = _integer(signature.get('numerator'), 'time signature', 1, 32)
    denominator = _integer(signature.get('denominator'), 'time signature denominator', 1, 16)
    if denominator not in (1, 2, 4, 8, 16):
        _fail('The notation time signature is unsupported.')
    measure_ticks = round(PPQ * 4 * numerator / denominator)

    _text(value.get('key_signature'), 'key signature', 4)
    split = _integer(value.get('staff_split_pitch'), 'staff split', 0, 127)
    if split != value.get('staff_split_pitch'):
        _fail('The notation staff split is invalid.')

    measures = value.get('measures')
    if not isinstance(measures, list) or not measures or len(measures) > MAX_MEASURES:
        _fail('The notation has no valid measures.')
    for index, measure in enumerate(measures):
        if not isinstance(measure, dict):
            _fail('The notation has an invalid measure.')
        if _integer(measure.get('index'), 'measure index', 0, MAX_MEASURES - 1) != index:
            _fail('Measures must be ordered from zero.')
        if _integer(measure.get('start'), 'measure start', 0, 10_000_000) != index * measure_ticks:
            _fail('Measures must be contiguous from the start of the score.')
        if _integer(measure.get('duration'), 'measure duration', 1, 100_000) != measure_ticks:
            _fail('Every measure must have the current time signature length.')
        _text(measure.get('id'), 'measure id', 40)

    raw_events = value.get('events')
    if not isinstance(raw_events, list) or len(raw_events) > MAX_EVENTS:
        _fail('The notation has no valid events.')
    event_ids: set[str] = set()
    note_ids: set[str] = set()
    note_count = 0
    by_voice: dict[tuple[str, int], list[tuple[int, int, str]]] = {}
    performance_ids = {event.id for event in events}
    owned: dict[str, int] = {}
    last_measure_end = measures[-1]['start'] + measures[-1]['duration']
    for index, event in enumerate(raw_events):
        if not isinstance(event, dict):
            _fail('The notation has an invalid event.')
        identifier = _text(event.get('id'), f'event {index + 1} id')
        if identifier in event_ids:
            _fail('The notation repeats an event id.')
        event_ids.add(identifier)
        staff = event.get('staff')
        if staff not in STAFFS:
            _fail('A notation event has an invalid staff.')
        voice = event.get('voice')
        if voice not in (1, 2):
            _fail('A notation event has an invalid voice.')
        start = _integer(event.get('start'), f'event {index + 1} start', 0, 10_000_000)
        length = _integer(event.get('duration'), f'event {index + 1} duration', GRID, 1_000_000)
        if start % GRID or length % GRID:
            _fail('Notation events must sit on the sixteenth-note grid.')
        if start + length > last_measure_end:
            _fail('A notation event extends beyond the last measure.')
        rest = event.get('rest')
        if not isinstance(rest, bool):
            _fail('A notation event has an invalid rest flag.')
        notes = event.get('notes')
        if rest:
            if notes not in ([], None):
                _fail('A rest cannot contain notes.')
        else:
            if not isinstance(notes, list) or not notes:
                _fail('A note event needs at least one pitch.')
            pitches = set()
            for note in notes:
                if not isinstance(note, dict):
                    _fail('A notation event has an invalid note.')
                note_id = _text(note.get('id'), f'note id in event {index + 1}')
                if note_id in note_ids:
                    _fail('The notation repeats a note id.')
                note_ids.add(note_id)
                note_count += 1
                pitch = _integer(note.get('pitch'), 'note pitch', 0, 127)
                if pitch in pitches:
                    _fail('A chord repeats a pitch.')
                pitches.add(pitch)
                _text(note.get('spelling'), 'note spelling', 12)
                accidental = note.get('accidental')
                if accidental not in (None, 'sharp', 'flat', 'natural'):
                    _fail('A notation accidental is invalid.')
                links = note.get('performance_ids')
                if not isinstance(links, list) or len(links) > 64 or any(link not in performance_ids for link in links):
                    _fail('A notation note links to a missing performance event.')
                for link in links:
                    if link in owned:
                        _fail('A performance occurrence is linked to more than one written note.')
                    owned[link] = pitch
                note_ids.update([note_id])
        if note_count > MAX_NOTES:
            _fail('The notation has too many notes.')
        if event.get('source') not in ('performance', 'inserted', 'rest'):
            _fail('A notation event has an invalid source.')
        by_voice.setdefault((staff, voice), []).append((start, start + length, identifier))
    for values in by_voice.values():
        values.sort()
        for previous, current in zip(values, values[1:]):
            if current[0] < previous[1]:
                _fail('Notation events overlap in the same voice.')
    _performance_matches(value, events, duration)
    # Every recorded occurrence must be owned by exactly one written note, and the
    # written pitch must agree with the performance pitch it is linked to. Written and
    # recorded durations are deliberately allowed to differ.
    recorded = {event.id: event.pitch for event in events}
    missing = [identifier for identifier in recorded if identifier not in owned]
    if missing:
        _fail('Every recorded occurrence must be linked to a written note.')
    for identifier, written in owned.items():
        if recorded.get(identifier) != written:
            _fail('A written note pitch disagrees with the occurrence it is linked to.')
    _validate_hand_metadata(value, performance_ids)
    return value
