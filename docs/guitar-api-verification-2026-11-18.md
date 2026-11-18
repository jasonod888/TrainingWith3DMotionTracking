# Guitar and shared music API verification

18 November 2026. Interpreter: `.venv-saas/Scripts/python.exe` (Python 3.12.2, FastAPI 0.119.1).

**Result: 40 tests passed, zero failed or skipped.** No application code was changed during verification.

## Existing API checks

39 tests passed in 133.35 seconds across:

- `tests/api/test_music_edit.py`
- `tests/api/test_music_review.py`
- `tests/api/test_guitar_tab_solver.py`
- `tests/api/test_music_contract.py`
- `tests/api/test_music_alignment.py`
- `tests/api/test_music_playback_settings.py`

These cover immutable revisions, draft review and retries, notation/performance binding, chord/position persistence, malformed contracts, solver behavior, alignment/offset persistence, ownership checks, and stale/finalized draft restrictions.

## Additional guitar HTTP probe

`outputs/guitar_api_setup_probe_test.py`: 1 passed in 13.57 seconds. The probe exercises the actual FastAPI routes with the repository's isolated test fixtures:

- Upload a guitar clip and hand off a guitar draft.
- Refuse malformed tuning arrays, objects, booleans, and invalid capo values with HTTP 422.
- Review with Drop D and capo 2, preserving notation and guitar chords.
- Check synchronized tuning/capo in the returned instrument metadata.
- Create successive revisions with Standard/capo 0, Half-Step Down/capo 2, DADGAD/capo 12, and Drop D/capo 0.
- Check saved notation positions against sounding pitches, preserve chords, and retain unpositioned top-level events.
- Refuse malformed tuning through the revision route as well as draft review.

## Environment diagnosis and limits

The initial sandboxed HTTP test run hung in Python's local `socketpair` setup used by the asynchronous test client. The tests completed successfully outside the sandbox. Missing FastAPI was an earlier interpreter-selection error: `.venv` is not the backend environment.

Both successful runs emitted one Starlette/AnyIO deprecation warning about `BlockingPortal`; it did not fail the tests.

These tests use isolated SQLite databases and mocked object storage/email, with generated local media for the relevant upload/review paths. They do not certify a running PostgreSQL/S3 deployment, real AI transcription quality, or live browser/audio behavior. The prior frontend verification separately passed 101 tests and TypeScript checking.

This result supersedes the earlier reports' statement that the relevant API integration could not be verified.
