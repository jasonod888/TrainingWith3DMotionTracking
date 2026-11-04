"""Server-owned processing route catalogue.

The server chooses the pipeline from the subject; a client never names a model,
provider or pipeline version. The body route keeps its existing configuration and
credentials as the default. Availability is reported per capability so a missing
or offline music worker can never mark movement conversion unavailable.
"""
from dataclasses import dataclass
from typing import Literal

from . import subjects
from .processing import PIPELINE_VERSION

Family = Literal['body', 'music']
CompletionContract = Literal['body-v1', 'music-v2']

# Asset roles are declared per route instead of being appended to scattered
# filename allowlists in the completion, storage, delivery and public paths.
BODY_REQUIRED_ASSETS = ('reference.glb', 'reference.json', 'preview.mp4', 'thumbnail.jpg')
BODY_OPTIONAL_ASSETS = ('instructor.mp4', 'instructor-alpha.webm')
MUSIC_REQUIRED_ASSETS = ('reference.json',)
MUSIC_OPTIONAL_ASSETS = ('source.mp4', 'preview.mp4', 'waveform.json', 'midi.mid', 'poster.png')


@dataclass(frozen=True)
class ProcessingRoute:
    id: str
    family: Family
    subjects: tuple[str, ...]
    pipeline_version: str
    capability: str
    completion: CompletionContract
    required_assets: tuple[str, ...]
    optional_assets: tuple[str, ...] = ()
    provider_setting: str = 'conversion_provider'
    target_setting: str = 'conversion_target'
    remote_setting: str = 'remote_conversion_enabled'

    @property
    def work_assets(self) -> tuple[str, ...]:
        """Everything this route may upload for one attempt, required first."""
        return self.required_assets + self.optional_assets


ROUTES: dict[str, ProcessingRoute] = {
    'body-default': ProcessingRoute(
        id='body-default',
        family='body',
        subjects=subjects.MOVEMENT_SUBJECTS,
        pipeline_version=PIPELINE_VERSION,
        capability='conversion',
        completion='body-v1',
        required_assets=BODY_REQUIRED_ASSETS,
        optional_assets=BODY_OPTIONAL_ASSETS,
    ),
    'music-piano': ProcessingRoute(
        id='music-piano',
        family='music',
        subjects=('piano',),
        pipeline_version='music-piano-v1',
        capability='music_piano',
        completion='music-v2',
        required_assets=MUSIC_REQUIRED_ASSETS,
        optional_assets=MUSIC_OPTIONAL_ASSETS,
        provider_setting='music_piano_conversion_provider',
        target_setting='music_piano_conversion_target',
        remote_setting='music_remote_conversion_enabled',
    ),
    'music-guitar': ProcessingRoute(
        id='music-guitar',
        family='music',
        subjects=('guitar',),
        pipeline_version='music-guitar-v1',
        capability='music_guitar',
        completion='music-v2',
        required_assets=MUSIC_REQUIRED_ASSETS,
        optional_assets=MUSIC_OPTIONAL_ASSETS,
        provider_setting='music_guitar_conversion_provider',
        target_setting='music_guitar_conversion_target',
        remote_setting='music_remote_conversion_enabled',
    ),
}

DEFAULT_ROUTE = ROUTES['body-default']


def route_for(subject: str | None, instrument: str | None = None) -> ProcessingRoute:
    """Select the route for a validated subject. Body is the default on purpose."""
    resolved, _family, _instrument = subjects.validate_selection(subject, instrument)
    for route in ROUTES.values():
        if resolved in route.subjects:
            return route
    raise subjects.SubjectError('No processing route is configured for this subject.')


def route_for_pipeline(pipeline_version: str) -> ProcessingRoute | None:
    for route in ROUTES.values():
        if route.pipeline_version == pipeline_version:
            return route
    return None


def provider_for(route: ProcessingRoute, settings) -> str:
    return getattr(settings, route.provider_setting, 'disabled')


def available(route: ProcessingRoute, settings) -> bool:
    """Whether new work may be created for this route on this deployment."""
    provider = provider_for(route, settings)
    if provider == 'disabled':
        return False
    if provider == 'local':
        return True
    if provider in ('replicate', 'fal'):
        return bool(getattr(settings, route.remote_setting, False) and getattr(settings, route.target_setting, ''))
    return False


def online(route: ProcessingRoute, settings, online_routes: set[tuple[str, str]]) -> bool:
    """Whether a worker currently claims this route. Body keeps its existing meaning."""
    return (provider_for(route, settings), route.pipeline_version) in online_routes


def status(settings, online_routes: set[tuple[str, str]] | None = None) -> dict[str, dict]:
    online_routes = online_routes or set()
    return {
        route.id: {
            'id': route.id,
            'experience_family': route.family,
            'subjects': list(route.subjects),
            'pipeline_version': route.pipeline_version,
            'capability': route.capability,
            'completion': route.completion,
            'assets': list(route.required_assets),
            'optional_assets': list(route.optional_assets),
            'available': available(route, settings),
            'worker_online': online(route, settings, online_routes),
        }
        for route in ROUTES.values()
    }


def capability_flags(settings, online_routes: set[tuple[str, str]] | None = None) -> dict[str, bool]:
    """Per-capability availability: never one boolean for the whole product."""
    flags = {'conversion': available(DEFAULT_ROUTE, settings)}
    for route in ROUTES.values():
        if route.family == 'music':
            flags[route.capability] = available(route, settings)
    return flags


def public_catalogue() -> list[dict]:
    """Route metadata for clients: no provider names, credentials or targets."""
    return [
        {
            'id': route.id,
            'experience_family': route.family,
            'subjects': list(route.subjects),
            'capability': route.capability,
            'completion': route.completion,
        }
        for route in ROUTES.values()
    ]
