"""A preview is reusable only while the rendered performance is unchanged."""
from .contracts import MusicEvent

def performance_changed(before, events, pedal=None):
    normalized = [MusicEvent.model_validate(event).model_dump() for event in before.get('events', [])]
    after = [event.model_dump() if isinstance(event, MusicEvent) else MusicEvent.model_validate(event).model_dump()
             for event in events]
    return normalized != after or (pedal is not None and before.get('pedal', []) != pedal)

def invalidate_preview(proposal):
    proposal.piano_preview = None
    proposal.preview_identity = None
    warning = 'Piano audio is unavailable because the notes were edited. Original audio remains available.'
    if warning not in proposal.warnings:
        proposal.warnings.append(warning)
