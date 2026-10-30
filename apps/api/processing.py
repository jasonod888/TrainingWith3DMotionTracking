"""Versioned routing contract; hosting never selects the inference provider."""
from typing import Literal

Provider = Literal['local', 'replicate', 'fal']
ENGINE_VERSION = 'b5c765a0d89d789985e186d396315e7590887b94'
PIPELINE_VERSION = 'sam-3d-body-v1'


def processing_status(settings):
    provider = settings.conversion_provider
    enabled = provider == 'local' or (provider in ('replicate', 'fal') and settings.remote_conversion_enabled and bool(settings.conversion_target))
    return {'provider': provider, 'available': enabled, 'pipeline_version': PIPELINE_VERSION,
            'external_processing': provider in ('replicate', 'fal')}
