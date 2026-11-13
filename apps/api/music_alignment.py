"""Server-side validation for the versioned source-to-score alignment.

The client owns the editing model, but a saved reference must not contain a map that
disagrees with its clip, skips or overlaps time, or reverses score order. Anchors are
authored points; their application is reproduced by the client from the same list, so
the server checks the list itself rather than a derived rendering.
"""
from __future__ import annotations

from typing import Any

MAX_PASSAGES = 2000
MAX_ANCHORS = 2000
MODES = {'estimated', 'anchored'}
BASES = {'tempo', 'passages'}
KINDS = {'timed', 'held'}


def _fail(message: str) -> None:
    raise ValueError(message)


def _number(value: Any, name: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not float('-inf') < float(value) < float('inf'):
        _fail(f'The alignment has an invalid {name}.')
    return float(value)


def _integer(value: Any, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        _fail(f'The alignment has an invalid {name}.')
    return value


def validate_alignment(value: Any, duration: float) -> dict[str, Any]:
    """Return a normalised alignment; raises ValueError when it cannot be saved."""
    if not isinstance(value, dict):
        _fail('The alignment is not an object.')
    if value.get('alignment_version') != 1:
        _fail('This alignment version is unsupported.')
    mode = value.get('mode')
    if mode not in MODES:
        _fail('The alignment mode is unsupported.')
    if value.get('basis') not in BASES:
        _fail('The alignment basis is unsupported.')

    anchors = value.get('anchors', [])
    if not isinstance(anchors, list) or len(anchors) > MAX_ANCHORS:
        _fail('The alignment has too many anchors.')
    normalised_anchors = []
    previous_seconds = -1.0
    previous_anchor_tick = -1
    for index, anchor in enumerate(anchors):
        if not isinstance(anchor, dict):
            _fail('The alignment has an invalid anchor.')
        seconds = _number(anchor.get('seconds'), f'anchor {index + 1} time')
        tick = _integer(anchor.get('tick'), f'anchor {index + 1} tick')
        if seconds < 0 or seconds > duration:
            _fail('An alignment anchor leaves the clip.')
        if tick < 0:
            _fail('An alignment anchor has a negative tick.')
        if seconds <= previous_seconds:
            _fail('Alignment anchors must be ordered and distinct.')
        if tick <= previous_anchor_tick:
            _fail('Alignment anchor ticks must increase with their times.')
        previous_seconds = seconds
        previous_anchor_tick = tick
        normalised_anchors.append({'seconds': seconds, 'tick': tick})

    offset = value.get('offset_seconds', 0)
    offset = _number(offset, 'offset')
    if offset < -10 or offset > 10:
        _fail('The sync offset is out of range.')

    passages = value.get('passages')
    if not isinstance(passages, list) or not passages or len(passages) > MAX_PASSAGES:
        _fail('The alignment has no passages.')
    expected_start = 0.0
    previous_tick = 0
    last_end = 0.0
    last_tick = 0
    normalised = []
    for index, passage in enumerate(passages):
        if not isinstance(passage, dict):
            _fail('The alignment has an invalid passage.')
        kind = passage.get('kind')
        if kind not in KINDS:
            _fail('An alignment passage has an unsupported kind.')
        seconds = passage.get('source_seconds')
        if not isinstance(seconds, list) or len(seconds) != 2:
            _fail('An alignment passage needs a start and an end.')
        start = _number(seconds[0], 'passage start')
        end = _number(seconds[1], 'passage end')
        if start < -1e-9 or end > duration + 1e-9:
            _fail('An alignment passage leaves the clip.')
        if end <= start + 1e-9:
            _fail('An alignment passage has no duration.')
        if abs(start - expected_start) > 1e-6:
            _fail('Alignment passages must tile the clip without gaps or overlaps.')
        if kind == 'timed':
            ticks = passage.get('ticks')
            if not isinstance(ticks, list) or len(ticks) != 2:
                _fail('A timed passage needs two ticks.')
            tick_start = _integer(ticks[0], 'passage start tick')
            tick_end = _integer(ticks[1], 'passage end tick')
            if tick_start != previous_tick:
                _fail('The alignment jumps in score time.')
            if tick_end <= tick_start:
                _fail('A timed passage needs increasing ticks.')
            previous_tick = tick_end
            normalised.append({'kind': 'timed', 'source_seconds': [start, end], 'ticks': [tick_start, tick_end]})
        else:
            tick = _integer(passage.get('tick'), 'held tick')
            if tick != previous_tick:
                _fail('A held passage jumps in score time.')
            normalised.append({'kind': 'held', 'source_seconds': [start, end], 'tick': tick})
        expected_start = end
        last_end = end
        last_tick = previous_tick
    if abs(last_end - duration) > 1e-6:
        _fail('The alignment must reach the end of the clip.')
    # The authored points must describe the saved map, not a different timeline.
    for anchor in normalised_anchors:
        expected = None
        for passage in normalised:
            start, end = passage['source_seconds']
            if anchor['seconds'] < start - 1e-9 or anchor['seconds'] > end + 1e-9:
                continue
            if passage['kind'] == 'timed':
                tick_start, tick_end = passage['ticks']
                fraction = 0.0 if end <= start else (anchor['seconds'] - start) / (end - start)
                expected = round(tick_start + fraction * (tick_end - tick_start))
            else:
                expected = passage['tick']
            break
        if expected is None or abs(expected - anchor['tick']) > 1:
            _fail('An alignment anchor does not agree with the saved passage map.')
    if mode == 'anchored' and not normalised_anchors:
        _fail('An anchored alignment needs at least one authored point.')
    if mode == 'estimated' and normalised_anchors:
        _fail('An estimated alignment cannot carry authored points.')

    return {
        'alignment_version': 1,
        'mode': mode,
        'basis': value['basis'],
        'offset_seconds': offset,
        'score_ticks': last_tick,
        'anchors': normalised_anchors,
        'passages': normalised,
    }
