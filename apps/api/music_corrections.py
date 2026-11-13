"""Compatibility import for the shared correction application module.

The implementation lives in ``scripts/piano_corrections.py`` so the worker bundle and
the server use exactly the same code.
"""
from scripts.piano_corrections import (APPLICATION_PATH, CORRECTION_POLICY_VERSION,
                                       EligibilityError, PreconditionError,
                                       SUPPORTED_OPERATIONS, VERIFIER_PATH,
                                       apply_finding, apply_qualified_corrections,
                                       current_application_sha256, eligible_findings,
                                       file_sha256, policy_sha256, report_sha256,
                                       validate_events_basic)

__all__ = [
    'APPLICATION_PATH', 'CORRECTION_POLICY_VERSION', 'EligibilityError',
    'PreconditionError', 'SUPPORTED_OPERATIONS', 'VERIFIER_PATH', 'apply_finding',
    'apply_qualified_corrections', 'current_application_sha256', 'eligible_findings',
    'file_sha256', 'policy_sha256', 'report_sha256', 'validate_events_basic',
]
