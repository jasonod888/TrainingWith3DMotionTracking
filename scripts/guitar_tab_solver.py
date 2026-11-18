"""Deterministic MIDI-to-TAB solver and guitar chord/strum detection.

The solver is a small beam/Viterbi search over standard-tuning positions. It is
deliberately model-free: the same transcribed events always produce the same TAB,
so fixtures, CLI runs and the guitar adapter agree.

Application string convention matches the API contracts: string 1 is the high E4
and string 6 is the low E2. ``tuning`` is still supplied low-to-high because that is
how guitarists and the model checkpoints describe it.
"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Iterable

MAX_FRET_DEFAULT = 24
STRUM_WINDOW_SECONDS = 0.055
BEAM_WIDTH = 48
MAX_GROUP_ASSIGNMENTS = 256

NOTE_NAMES = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')
QUALITIES = (
    ('', (0, 4, 7)),
    ('m', (0, 3, 7)),
    ('7', (0, 4, 7, 10)),
    ('m7', (0, 3, 7, 10)),
    ('maj7', (0, 4, 7, 11)),
    ('dim', (0, 3, 6)),
    ('aug', (0, 4, 8)),
    ('sus4', (0, 5, 7)),
    ('sus2', (0, 2, 7)),
    ('5', (0, 7)),
)


def _get(event: Any, name: str, default: Any = None) -> Any:
    if isinstance(event, dict):
        return event.get(name, default)
    return getattr(event, name, default)


def event_dict(event: Any) -> dict[str, Any]:
    """Copy an event to the draft's field set, dropping model-only metadata."""
    result: dict[str, Any] = {'onset': _get(event, 'onset'), 'pitch': _get(event, 'pitch')}
    for name in ('id', 'duration', 'notation_duration', 'velocity', 'confidence', 'string', 'fret'):
        value = _get(event, name)
        if value is not None:
            result[name] = value
    result['optional'] = bool(_get(event, 'optional', False))
    return result


GUITAR_TUNING_NAMES: dict[str, tuple[int, ...]] = {
    'standard': (40, 45, 50, 55, 59, 64),
    'drop_d': (38, 45, 50, 55, 59, 64),
    'half_step_down': (39, 44, 49, 54, 58, 63),
    'dadgad': (38, 45, 50, 55, 57, 62),
}


def open_strings(tuning: Sequence[int] | str = (40, 45, 50, 55, 59, 64)) -> dict[int, int]:
    """Map canonical string number (1 = high E) to its open-string MIDI pitch.

    ``tuning`` may be a tuning id string or a low-to-high sequence of six MIDI pitches.
    Invalid values raise ``ValueError`` (never ``TypeError``).
    """
    if isinstance(tuning, str):
        if tuning not in GUITAR_TUNING_NAMES:
            raise ValueError(f'Unknown guitar tuning: {tuning}.')
        values = GUITAR_TUNING_NAMES[tuning]
    else:
        if isinstance(tuning, (dict, bool)) or not isinstance(tuning, Sequence):
            raise ValueError('Guitar tuning must be a tuning id or six open-string pitches.')
        values = tuple(tuning)
        if len(values) != 6 or any(not isinstance(pitch, int) or isinstance(pitch, bool) for pitch in values):
            raise ValueError('Guitar tuning needs six integer open-string pitches.')
    return {6 - index: int(pitch) for index, pitch in enumerate(values)}


def positions_for_pitch(pitch: int, open_map: dict[int, int] | None = None,
                        max_fret: int = MAX_FRET_DEFAULT) -> list[tuple[int, int]]:
    """Every playable (string, fret) for a pitch, low string first, open preferred."""
    if not isinstance(pitch, int) or isinstance(pitch, bool):
        return []
    open_map = open_map or open_strings()
    found = []
    for string in sorted(open_map, reverse=True):  # 6 -> 1, low to high
        fret = pitch - open_map[string]
        if 0 <= fret <= max_fret:
            found.append((string, fret))
    found.sort(key=lambda item: (item[1], -item[0]))
    return found


def _clusters(events: Sequence[Any], window: float = STRUM_WINDOW_SECONDS) -> list[list[int]]:
    ordered = sorted(range(len(events)), key=lambda index: (float(_get(events[index], 'onset') or 0.0), index))
    groups: list[list[int]] = []
    group_start = None
    for index in ordered:
        onset = float(_get(events[index], 'onset') or 0.0)
        if group_start is None or onset - group_start > window:
            groups.append([index])
            group_start = onset
        else:
            groups[-1].append(index)
    return groups


def _group_assignments(
    indices: Sequence[int], events: Sequence[Any], open_map: dict[int, int], max_fret: int,
) -> list[tuple[tuple[int, int, int], ...]]:
    """Playable assignments for one onset cluster as (event index, string, fret)."""
    playable: list[tuple[int, list[tuple[int, int]]]] = []
    for index in indices:
        options = positions_for_pitch(int(_get(events[index], 'pitch')), open_map, max_fret)
        if options:
            playable.append((index, options))
    if not playable:
        return [()]
    if len(playable) > 6:
        # More notes than strings cannot all sound on one guitar; keep the highest
        # notes, which is what a player would actually finger.
        playable = sorted(playable, key=lambda item: int(_get(events[item[0]], 'pitch')), reverse=True)[:6]

    results: list[tuple[tuple[int, int, int], ...]] = []

    def walk(position: int, used: set[int], chosen: list[tuple[int, int, int]]) -> None:
        if len(results) >= MAX_GROUP_ASSIGNMENTS:
            return
        if position == len(playable):
            frets = [fret for _, _, fret in chosen if fret > 0]
            if frets and max(frets) - min(frets) > 3:
                return
            results.append(tuple(chosen))
            return
        index, options = playable[position]
        for string, fret in options:
            if string in used:
                continue
            used.add(string)
            chosen.append((index, string, fret))
            walk(position + 1, used, chosen)
            chosen.pop()
            used.discard(string)

    walk(0, set(), [])
    results.sort(key=lambda assignment: (
        sum(fret for _, _, fret in assignment),
        tuple(-string for _, string, _ in assignment),
    ))
    return results


def _assignment_cost(assignment: tuple[tuple[int, int, int], ...], hand: float | None) -> tuple[float, float]:
    frets = [fret for _, _, fret in assignment if fret > 0]
    center = float(sorted(frets)[len(frets) // 2]) if frets else 0.0
    opened = sum(1 for _, _, fret in assignment if fret == 0)
    movement = abs(center - hand) if hand is not None else 0.0
    span = (max(frets) - min(frets)) if frets else 0
    cost = sum(fret for _, _, fret in assignment) * 0.12
    cost += movement * 1.65
    cost += span * 0.25
    # Open strings are cheap in low positions and slightly less so up the neck.
    cost -= opened * (0.45 if center <= 2 else 0.15)
    return cost, center


def assign_guitar_tab(
    events: Sequence[Any],
    tuning: Sequence[int] | str = (40, 45, 50, 55, 59, 64),
    max_fret: int = MAX_FRET_DEFAULT,
) -> list[dict[str, Any]]:
    """Assign a playable (string, fret) to every event with a deterministic DP.

    The search minimises fret-hand movement between onset clusters, prefers open
    strings in low positions, keeps each chord inside a four-fret span and never
    places two simultaneous notes on the same string.
    """
    open_map = open_strings(tuning)
    copied = [event_dict(event) for event in events]
    groups = _clusters(copied)
    # states: (total cost, hand centre, path of assignments)
    states: list[tuple[float, float | None, tuple[tuple[tuple[int, int, int], ...], ...]]] = [(0.0, None, ())]
    for indices in groups:
        candidates = _group_assignments(indices, copied, open_map, max_fret)
        if not candidates:
            candidates = [()]
        next_states: list[tuple[float, float | None, tuple[tuple[tuple[int, int, int], ...], ...]]] = []
        for cost, hand, path in states:
            for candidate in candidates:
                step, center = _assignment_cost(candidate, hand)
                next_states.append((cost + step, center if candidate else hand, path + (candidate,)))
        next_states.sort(key=lambda state: (state[0], tuple(
            tuple((index, string, fret) for index, string, fret in assignment) for assignment in state[2])))
        states = next_states[:BEAM_WIDTH]
    _, _, best_path = min(states, key=lambda state: (state[0], len(state[2])))
    assigned: dict[int, tuple[int, int]] = {}
    for group, assignment in zip(groups, best_path):
        chosen = {index: (string, fret) for index, string, fret in assignment}
        for index in group:
            if index in chosen:
                assigned[index] = chosen[index]
            else:
                assigned[index] = (-1, -1)
    result = []
    for index, event in enumerate(copied):
        string, fret = assigned.get(index, (-1, -1))
        event['string'] = string if string >= 1 else None
        event['fret'] = fret if fret >= 0 else None
        result.append(event)
    return result


def name_chord(pitches: Iterable[int]) -> str:
    classes = sorted({int(pitch) % 12 for pitch in pitches})
    if not classes:
        return ''
    if len(classes) < 2:
        return NOTE_NAMES[classes[0]]
    for root in range(12):
        if root not in classes:
            continue
        intervals = tuple(sorted((pitch - root) % 12 for pitch in classes))
        for suffix, quality in QUALITIES:
            if intervals == quality:
                return f'{NOTE_NAMES[root]}{suffix}'
    return f'{NOTE_NAMES[classes[0]]}?'


def strum_direction(events: Sequence[Any]) -> str | None:
    """'down' when the attacks read low string to high (6 -> 1), 'up' otherwise."""
    ordered = sorted(events, key=lambda event: (float(_get(event, 'onset') or 0.0), int(_get(event, 'pitch') or 0)))
    strings = [_get(event, 'string') for event in ordered if _get(event, 'string') is not None]
    if len(strings) < 2:
        return None
    if strings[0] >= strings[-1]:
        return 'down'
    return 'up'


def _chord_shape(cluster: Sequence[Any]) -> tuple[list[int], int] | None:
    frets = [-1, -1, -1, -1, -1, -1]
    for event in cluster:
        string = _get(event, 'string')
        fret = _get(event, 'fret')
        if not isinstance(string, int) or isinstance(string, bool) or not 1 <= string <= 6:
            continue
        if not isinstance(fret, int) or isinstance(fret, bool) or not 0 <= fret <= MAX_FRET_DEFAULT:
            continue
        # GuitarChord.frets is ordered low E to high E, while strings number high to low.
        frets[6 - string] = fret
    sounding = [fret for fret in frets if fret >= 0]
    if len(sounding) < 3:
        return None
    positive = [fret for fret in sounding if fret > 0]
    if positive and max(positive) - min(positive) > 3:
        return None  # cannot fit the reviewed four-fret window
    position = min(positive) if positive else 1
    return frets, position


def detect_guitar_chords_and_strums(events: Sequence[Any], duration: float) -> list[dict[str, Any]]:
    """Detect 3+ string chord clusters inside a 55 ms window and validate their shapes."""
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
        raise ValueError('A clip duration is required to detect guitar chords.')
    clusters = _clusters(events)
    chords: list[dict[str, Any]] = []
    for cluster in clusters:
        if len(chords) >= 100:
            break
        grouped = [events[index] for index in cluster]
        distinct = {_get(event, 'string') for event in grouped if _get(event, 'string') is not None}
        if len(distinct) < 3:
            continue
        shape = _chord_shape(grouped)
        if shape is None:
            continue
        frets, position = shape
        start = max(0.0, min(float(duration), float(_get(grouped[0], 'onset') or 0.0)))
        chords.append({
            'id': f'guitar-chord-{len(chords) + 1}',
            'name': name_chord(int(_get(event, 'pitch') or 0) for event in grouped if _get(event, 'pitch') is not None),
            'start': round(start, 3),
            'frets': frets,
            'position': max(1, min(24, position)),
        })
    return chords


def validate_guitar_chord(chord: dict[str, Any]) -> None:
    """Raise ValueError when a chord would be refused by the API contract."""
    frets = chord.get('frets')
    name = chord.get('name')
    position = chord.get('position', 1)
    if not isinstance(frets, list) or len(frets) != 6:
        raise ValueError('A guitar chord needs six string frets.')
    if not isinstance(name, str) or not name or len(name) > 40:
        raise ValueError('A guitar chord needs a name.')
    if any(not isinstance(fret, int) or isinstance(fret, bool) or fret < -1 or fret > 24 for fret in frets):
        raise ValueError('Guitar chord frets must be muted (-1), open (0) or 1-24.')
    if not any(fret >= 0 for fret in frets):
        raise ValueError('A guitar chord needs at least one sounding string.')
    if not isinstance(position, int) or isinstance(position, bool) or not 1 <= position <= 24:
        raise ValueError('A guitar chord base position must be 1-24.')
    if any(fret > 0 and not position <= fret <= position + 3 for fret in frets):
        raise ValueError('Guitar chord frets must fit the four-fret window at the base position.')


def enrich_events(events: Sequence[Any], duration: float | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Assign TAB positions and detect chord shapes for a guitar transcription."""
    assigned = assign_guitar_tab(events)
    chords = detect_guitar_chords_and_strums(assigned, float(duration)) if duration else []
    for chord in chords:
        validate_guitar_chord(chord)
    return assigned, chords


__all__ = [
    'OPEN_STRING',
    'MAX_FRET_DEFAULT',
    'STRUM_WINDOW_SECONDS',
    'assign_guitar_tab',
    'detect_guitar_chords_and_strums',
    'enrich_events',
    'open_strings',
    'positions_for_pitch',
    'strum_direction',
    'validate_guitar_chord',
]

OPEN_STRING = open_strings()
