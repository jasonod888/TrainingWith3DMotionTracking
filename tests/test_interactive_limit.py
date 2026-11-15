from apps.api.interactive_limit import (
    INTERACTIVE_OCCURRENCE_LIMIT, export_reference, mutation_error, resolve_interaction, write_error,
)


def test_unapproved_limit_is_inactive():
    policy = resolve_interaction(INTERACTIVE_OCCURRENCE_LIMIT + 1)
    assert policy['mode'] == 'editing'
    assert mutation_error(policy) is None


def test_boundary_and_read_only_guard():
    boundary = resolve_interaction(INTERACTIVE_OCCURRENCE_LIMIT, approved=True)
    assert boundary['mode'] == 'editing'
    over = resolve_interaction(INTERACTIVE_OCCURRENCE_LIMIT + 1, approved=True)
    assert over['mode'] == 'read-only'
    error = mutation_error(over)
    assert error and error['code'] == 'interactive-limit-read-only'
    assert 'view' in over['capabilities'] and 'export-reference' in over['capabilities']


def test_lossless_export_preserves_document():
    document = {'notation_version': 1, 'performance': [{'id': 'a'}], 'events': []}
    exported = export_reference(document, 'Boundary', 5001, {'identity': {'lessonId': 'x'}})
    assert exported['document'] is document
    assert exported['occurrence_count'] == 5001
    assert exported['recovery'] == {'identity': {'lessonId': 'x'}}


def test_server_write_guard_only_when_approved():
    assert write_error(INTERACTIVE_OCCURRENCE_LIMIT + 1, False) is None
    assert write_error(INTERACTIVE_OCCURRENCE_LIMIT, True) is None
    message = write_error(INTERACTIVE_OCCURRENCE_LIMIT + 1, True)
    assert message and 'limited to' in message

