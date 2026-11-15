"""Proposed 5,000-occurrence interactive limit policy (not activated).

This module is the server-side reviewable implementation of the read-only
capability and mutation guard. It is not imported by any route and
INTERACTIVE_LIMIT_APPROVED is False until the owner explicitly approves the
product restriction.
"""
from __future__ import annotations

from typing import Any

INTERACTIVE_OCCURRENCE_LIMIT = 5000
INTERACTIVE_LIMIT_APPROVED = False


def resolve_interaction(occurrence_count: int, approved: bool | None = None) -> dict[str, Any]:
    if not isinstance(occurrence_count, int) or occurrence_count < 0:
        raise ValueError('The occurrence count must be a non-negative whole number.')
    approved = INTERACTIVE_LIMIT_APPROVED if approved is None else approved
    if not approved or occurrence_count <= INTERACTIVE_OCCURRENCE_LIMIT:
        return {
            'mode': 'editing',
            'limit': INTERACTIVE_OCCURRENCE_LIMIT,
            'occurrence_count': occurrence_count,
            'approved': approved,
        }
    return {
        'mode': 'read-only',
        'limit': INTERACTIVE_OCCURRENCE_LIMIT,
        'occurrence_count': occurrence_count,
        'approved': approved,
        'capabilities': ['view', 'playback', 'selection', 'export-reference', 'export-recovery'],
    }


def mutation_error(policy: dict[str, Any]) -> dict[str, str] | None:
    if policy.get('mode') == 'editing':
        return None
    return {
        'code': 'interactive-limit-read-only',
        'message': (
            f"This lesson has {policy['occurrence_count']} occurrences; editing is limited to "
            f"{INTERACTIVE_OCCURRENCE_LIMIT}. This edit was not applied."
        ),
    }


def export_reference(notation: Any, title: str, occurrence_count: int,
                     recovery: Any | None = None) -> dict[str, Any]:
    """Lossless export; the notation document is copied verbatim, never truncated."""
    if not isinstance(occurrence_count, int) or occurrence_count < 0:
        raise ValueError('The occurrence count must be a non-negative whole number.')
    return {
        'kind': 'piano-workspace-export-v1',
        'title': title,
        'occurrence_count': occurrence_count,
        'document': notation,
        'recovery': recovery,
    }
