"""Server-owned processing route catalogue.

The server chooses the pipeline from the subject; a client never names a model,
provider or pipeline version. The body route keeps its existing configuration and
credentials as the default. Availability is reported per capability so a missing
or offline music worker can never mark movement conversion unavailable.

Two body routes exist. ``body-default`` is the SAM 3D Body + SAM 2 + MHR-to-GLB
pipeline and stays the configured default during rollout. ``body-mediapipe`` is the
CPU-capable video-only route; it is selected only by ``BODY_PIPELINE=mediapipe``.
A route owns its required/optional assets, so completion, storage, delivery and the
public projection never consult a second filename allowlist.
"""
from dataclasses import dataclass
from typing import Literal

from . import acts, subjects
from .processing import MEDIAPIPE_PIPELINE_VERSION, PIPELINE_VERSION

Family = Literal['body', 'music']
CompletionContract = Literal['body-v1', 'music-v2']

# Asset roles are declared per route instead of being appended to scattered
# filename allowlists in the completion, storage, delivery and public paths.
BODY_REQUIRED_ASSETS = ('reference.glb', 'reference.json', 'preview.mp4', 'thumbnail.jpg')
BODY_OPTIONAL_ASSETS = ('instructor.mp4', 'instructor-alpha.webm')
# A video-only movement has no GLB: the person watches the normalised clip and the
# landmarks describe it. Both instructor derivatives stay optional.
MEDIAPIPE_REQUIRED_ASSETS = ('reference.json', 'preview.mp4', 'thumbnail.jpg')
MEDIAPIPE_OPTIONAL_ASSETS = ('instructor.mp4', 'instructor-alpha.webm')
MUSIC_REQUIRED_ASSETS = ('reference.json',)
MUSIC_OPTIONAL_ASSETS = ('source.mp4', 'preview.mp4', 'preview.wav', 'waveform.json', 'midi.mid', 'poster.png', 'analysis.zip')


@dataclass(frozen=True)
class ProcessingRoute:
    id: str
    family: Family
    # The Act this route implements. Several routes may implement one Act (the two
    # body pipelines, or the piano basic-pitch and Kong routes), and an Act keeps
    # its identity when a route is added, retired or offline.
    act_id: str
    subjects: tuple[str, ...]
    pipeline_version: str
    capability: str
    completion: CompletionContract
    required_assets: tuple[str, ...]
    optional_assets: tuple[str, ...] = ()
    provider_setting: str = 'conversion_provider'
    target_setting: str = 'conversion_target'
    remote_setting: str = 'remote_conversion_enabled'
    model: str | None = None
    raw_model: bool = False
    # MediaPipe inference is CPU-only by contract, so a remote provider cannot
    # serve this route until its transport has been reviewed and added.
    local_only: bool = False

    @property
    def work_assets(self) -> tuple[str, ...]:
        """Everything this route may upload for one attempt, required first."""
        return self.required_assets + self.optional_assets


ROUTES: dict[str, ProcessingRoute] = {
    'body-default': ProcessingRoute(
        id='body-default',
        family='body',
        act_id='full_body',
        subjects=subjects.MOVEMENT_SUBJECTS,
        pipeline_version=PIPELINE_VERSION,
        capability='conversion',
        completion='body-v1',
        required_assets=BODY_REQUIRED_ASSETS,
        optional_assets=BODY_OPTIONAL_ASSETS,
    ),
    'body-mediapipe': ProcessingRoute(
        id='body-mediapipe',
        family='body',
        act_id='full_body',
        subjects=subjects.MOVEMENT_SUBJECTS,
        pipeline_version=MEDIAPIPE_PIPELINE_VERSION,
        capability='conversion',
        completion='body-v1',
        required_assets=MEDIAPIPE_REQUIRED_ASSETS,
        optional_assets=MEDIAPIPE_OPTIONAL_ASSETS,
        local_only=True,
    ),
    'music-piano': ProcessingRoute(
        id='music-piano',
        family='music',
        act_id='piano',
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
    'music-piano-kong': ProcessingRoute(
        id='music-piano-kong',
        family='music',
        act_id='piano',
        subjects=('piano',),
        pipeline_version='music-piano-kong-v1',
        capability='music_piano',
        completion='music-v2',
        required_assets=('reference.json', 'preview.wav'),
        optional_assets=tuple(name for name in MUSIC_OPTIONAL_ASSETS if name!='preview.wav'),
        model='kong', raw_model=True,
        provider_setting='music_piano_conversion_provider',
        target_setting='music_piano_conversion_target',
        remote_setting='music_remote_conversion_enabled',
    ),
    'music-guitar': ProcessingRoute(
        id='music-guitar',
        family='music',
        act_id='guitar',
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

BODY_ROUTES: dict[str, ProcessingRoute] = {
    'sam-3d-body': ROUTES['body-default'],
    'mediapipe': ROUTES['body-mediapipe'],
}

DEFAULT_ROUTE = ROUTES['body-default']


def body_route(settings) -> ProcessingRoute:
    """The configured body route. SAM is the default until an operator opts in."""
    return BODY_ROUTES.get(getattr(settings, 'body_pipeline', 'sam-3d-body'), DEFAULT_ROUTE)


def route_for(subject: str | None, instrument: str | None = None, *,
              piano_model: str | None = None,
              settings=None) -> ProcessingRoute:
    """Select the route for a validated subject. Body is the default on purpose.

    A body subject resolves through the configured body route before the generic
    subject loop, so `BODY_PIPELINE=mediapipe` changes every body upload rather than
    only the ones that happen to match first.
    """
    resolved, family, _instrument = subjects.validate_selection(subject, instrument)
    if resolved == 'piano' and piano_model == 'kong':
        return ROUTES['music-piano-kong']
    if family == 'body' and settings is not None:
        return body_route(settings)
    for route in ROUTES.values():
        if resolved in route.subjects:
            # The route's declared Act must agree with the catalogue mapping, so a
            # future route cannot silently implement the wrong product experience.
            if route.act_id != acts.act_for_subject(resolved).id:
                raise subjects.SubjectError('The processing route does not match this lesson Act.')
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
    if route.local_only:
        # Reporting this route as available on a remote provider would promise work
        # no worker can perform. The SAM route keeps its remote support unchanged.
        return False
    if provider in ('replicate', 'fal'):
        return bool(getattr(settings, route.remote_setting, False) and getattr(settings, route.target_setting, ''))
    return False


def online(route: ProcessingRoute, settings, online_routes: set[tuple[str, str]]) -> bool:
    """Whether a worker currently claims this route.

    Credentials are scoped to the exact `(provider, pipeline_version)` pair, so a SAM
    worker never claims MediaPipe work (or the reverse).
    """
    return (provider_for(route, settings), route.pipeline_version) in online_routes


def routes_for_act(act_id: str) -> tuple[ProcessingRoute, ...]:
    """Every route that can implement one Act, in registry order."""
    return tuple(route for route in ROUTES.values() if route.act_id == act_id)


def status(settings, online_routes: set[tuple[str, str]] | None = None) -> dict[str, dict]:
    online_routes = online_routes or set()
    return {
        route.id: {
            'id': route.id,
            'act_id': route.act_id,
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


def body_status(settings, online_routes: set[tuple[str, str]] | None = None) -> dict:
    """The active body route, so clients never guess which pipeline is configured."""
    route = body_route(settings)
    return {'id': route.id, 'pipeline_version': route.pipeline_version,
            'available': available(route, settings),
            'worker_online': online(route, settings, online_routes or set())}


def capability_flags(settings, online_routes: set[tuple[str, str]] | None = None) -> dict[str, bool]:
    """Per-capability availability: never one boolean for the whole product."""
    flags = {'conversion': available(body_route(settings), settings)}
    for route in ROUTES.values():
        if route.family == 'music':
            flags[route.capability] = available(route, settings)
    return flags


def public_catalogue() -> list[dict]:
    """Route metadata for clients: no provider names, credentials or targets."""
    return [
        {
            'id': route.id,
            'act_id': route.act_id,
            'experience_family': route.family,
            'subjects': list(route.subjects),
            'capability': route.capability,
            'completion': route.completion,
        }
        for route in ROUTES.values()
    ]
