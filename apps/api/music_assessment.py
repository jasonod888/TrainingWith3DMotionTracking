"""Lesson feedback compatibility and creator-controlled availability.

Stored lesson revisions are immutable. ``feedback_enabled`` is part of a new revision
when a creator saves one; legacy revisions have no such field and keep their prior
availability. This module derives a delivery value without rewriting stored JSON,
reference hashes, acceptances, or published revisions.
"""
from __future__ import annotations

from typing import Any

RUBRIC_BY_SUBJECT = {'piano': 'piano-midi-v1', 'guitar': 'guitar-notes-v1'}


def assessment_for_subject(subject: str | None) -> dict[str, Any] | None:
    rubric = RUBRIC_BY_SUBJECT.get(subject or '')
    if rubric is None:
        return None
    return {
        'assessment': 'notes',
        'input_modes': ['midi', 'microphone'],
        'dimensions': ['pitch', 'timing'],
        'rubric_version': rubric,
    }


def note_feedback_policy_valid(manifest: dict[str, Any] | None, rubric_version: str) -> bool:
    """Whether a reviewed music policy can record note-feedback summaries.

    A creator may enable only a subset of the qualified inputs (for example MIDI
    only). Requiring the policy to equal the full subject default would reject that
    valid narrower choice; accepting unknown or empty inputs would weaken policy.
    """
    expected = assessment_for_subject((manifest or {}).get('subject'))
    if expected is None or not (manifest or {}).get('reference_reviewed'):
        return False
    policy = (manifest or {}).get('assessment') or {}
    modes = policy.get('input_modes') or []
    return (policy.get('assessment') == 'notes'
            and bool(modes)
            and set(modes).issubset(expected['input_modes'])
            and set(policy.get('dimensions') or []) == {'pitch', 'timing'}
            and policy.get('rubric_version') == expected['rubric_version']
            and rubric_version == expected['rubric_version'])


def effective_feedback_enabled(manifest: dict[str, Any] | None) -> bool:
    """Return the creator's effective lesson-level switch.

    An explicit boolean always wins. Legacy music revisions without the field follow
    their actual assessment policy (watch-only stays disabled); legacy body revisions
    keep the availability they had before the switch existed. This is deliberately not
    a subject/genre guess.
    """
    value = (manifest or {}).get('feedback_enabled')
    if isinstance(value, bool):
        return value
    if (manifest or {}).get('experience_family') == 'music' or (manifest or {}).get('schema_version') == 2:
        policy = (manifest or {}).get('assessment') or {}
        return policy.get('assessment') not in (None, '', 'none')
    return True


def with_effective_feedback(manifest: dict[str, Any]) -> dict[str, Any]:
    """Copy a manifest for delivery with the effective switch resolved.

    The stored revision, its reference asset and all hash-bound data are untouched.
    """
    projected = dict(manifest)
    projected['feedback_enabled'] = effective_feedback_enabled(manifest)
    return projected
