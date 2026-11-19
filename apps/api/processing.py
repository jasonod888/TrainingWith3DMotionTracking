"""Versioned routing contract; hosting never selects the inference provider."""
from typing import Literal

Provider = Literal['local', 'replicate', 'fal']

# The SAM 3D Body route stays the default during rollout. Its engine version pins the
# upstream checkpoint so a completion receipt can never describe another model.
ENGINE_VERSION = 'b5c765a0d89d789985e186d396315e7590887b94'
PIPELINE_VERSION = 'sam-3d-body-v1'

# The CPU-capable MediaPipe route. It is a separate pipeline version, a separate worker
# credential scope and a separate completion contract: no GLB, no avatar, no
# Mixamo retarget. Enabling it is an explicit operator choice (BODY_PIPELINE=mediapipe).
MEDIAPIPE_PIPELINE_VERSION = 'body-mediapipe-v1'
MEDIAPIPE_ENGINE_VERSION = 'mediapipe-pose-heavy-v1'


def processing_status(settings):
    """Legacy shape kept for older clients: describes the default (SAM) provider."""
    provider = settings.conversion_provider
    enabled = provider == 'local' or (provider in ('replicate', 'fal') and settings.remote_conversion_enabled and bool(settings.conversion_target))
    return {'provider': provider, 'available': enabled, 'pipeline_version': PIPELINE_VERSION,
            'external_processing': provider in ('replicate', 'fal')}
