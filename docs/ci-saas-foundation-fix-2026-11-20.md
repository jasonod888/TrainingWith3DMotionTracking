# SaaS foundation CI fix — 2026-11-20

Run: GitHub Actions `cpu-checks`, run 44648419518 — 7 failed, 1026 passed, 40 skipped. The workflow stopped at `python -m pytest`; `npm test`, build and Docker were never reached.

## Diagnosis and fixes

### 1. Missing TSX loader (test infrastructure, not production)

`tests/api/test_client_contract.py` invokes `node --import ./apps/web/node_modules/tsx/dist/loader.mjs ...`, but the workflow ran `python -m pytest` before `npm ci`, so `apps/web/node_modules` did not exist in CI.

Fix: `.github/workflows/saas-checks.yml` now installs web dependencies before pytest. No test was skipped or weakened.

### 2. Missing `cv2` (test environment, not production)

Two CPU avatar tests failed at `import cv2`. The test requirements/lock did not include OpenCV even though the MediaPipe script tests exercise it.

Fix: pinned `opencv-python-headless==4.14.0.94` in:

- `tests/requirements.txt`
- `tests/requirements-lock.txt`

The pin uses the same OpenCV release as the existing root lock (`opencv-python==4.14.0.94`) but the headless distribution, avoiding GUI system libraries in CI. No version range or unpinned dependency was added.

### 3. Owned discovery subject filter returned `[]` (production bug)

`PATCH /lessons/{id}/subject` updates the lesson's current metadata without creating a revision. The owned summaries endpoint filtered and built facets from `LessonRevision.subject`, so after a relabel the current `dance` filter returned nothing even though the response rebuilt the card with the current label.

Fix in `apps/api/lessons.py`: owned summaries/facets now use the current `Lesson.subject`. Shared/public release-label filtering remains on the released revision, preserving the release-aware contract.

### 4. Music attempts returned 409 instead of 201/422 (production policy bug)

The save path required the stored policy's `input_modes` to equal the subject-wide default exactly. A valid reviewed lesson with MIDI-only feedback was therefore rejected, and the range-invalid request returned 409 before reaching its 422 range validation.

Fix: `apps/api/music_assessment.py` now exposes `note_feedback_policy_valid()`, shared by summary and challenge attempts. It accepts a non-empty **subset** of the qualified modes, while still requiring:

- a reviewed reference,
- `assessment == 'notes'`,
- the exact pitch/timing dimensions,
- the exact expected rubric and request rubric,
- no unknown or empty input modes.

The MIDI-only fixture is a valid narrower creator choice, not an outdated expectation. A new regression test confirms valid MIDI-only saves and rejects an unknown mode.

### 5. Latent avatar tests exposed by installing `cv2` (outdated fixture + lifecycle)

Once OpenCV was available, additional previously skipped/blocked tests ran:

- `test_scale_flow_rescales_reduced_vectors_to_full_resolution` expected no spatial resize, contradicting `scale_flow()` and its caller. The fixture now verifies both full-resolution spatial resize and vector scaling with a small fixed example.
- `process_video_mediapipe.run()` did not close an injected test landmarker even though the run already closes the landmarker it uses. Cleanup now closes the landmarker it used on every exit path. The only callers are the CLI/run path and tests; no production caller supplies a reusable external landmarker, so this matches the existing lifetime contract.
- The avatar contract fixture had a 1e-6 fps tolerance against timestamps measured from the 15 fps clip; the actual value differed by ~5.4e-6. The tolerance is now 1e-5, still a tight timestamp-precision assertion.

### 6. Full web-suite follow-up (three distinct failures)

The elevated root cross-language contract passed (1 test, 6.59 s), and production `npm run build` passed. The completed logged full web run was **930 total: 927 passed, 3 failed**. The three distinct blocks were:

- `music-challenge-hook.test.tsx`: the whole-piece challenge legitimately keeps capture open for the 1-second guide/tail window, but the test's `waitFor` timeout was exactly 1000 ms. It observed `capturing` at the boundary. The wait now allows 2000 ms for the existing capture contract to finish; no timer, capture-tail or assertion semantics changed.
- `music-practice-runtime.test.tsx`: the test read the obsolete unscoped preference key. Practice preferences are scoped by account/guest, so the actual persisted key is `form-practice-v2:guest:preferences:guitar-fixture:rev-1`. The test now asserts the real scoped contract and still requires speed `1.25`.
- `practice-policy-wiring.test.ts`: the source assertion still looked for the retired local name `submitPracticeAttempt(`. Production correctly imports and calls the shared `submitAttempt()` owner in `PracticeWorkspace.tsx` and `DrawingPracticeEntry.tsx`. The test now asserts the actual shared import/call, the `completed`/`unassessed` neutral status, and forwarding of the session access guard; the drawing check uses the same shared owner and unassessed status.

All three are fixture/boundary corrections. The production challenge, preference and attempt-submission paths were already correct and were not changed for these failures.

## Verification

Executed locally:

```text
.venv-saas\Scripts\python.exe -m pytest -q tests/api/test_discovery_filters.py tests/api/test_music_attempts.py tests/api/test_music_challenge_attempts.py
14 passed, 2 warnings in 28.40s

.venv-saas\Scripts\python.exe -m pytest -q tests/api/test_music_attempts.py::test_note_feedback_policy_accepts_a_narrower_qualified_input_and_rejects_unknown_inputs
1 passed, 2 warnings in 3.75s

.venv-saas\Scripts\python.exe [pytest.main for tests/avatar/test_mediapipe_pipeline_scripts.py with locally available cv2]
18 passed, 2 warnings in 0.83s

.venv-saas\Scripts\python.exe -m pytest -q tests/api/test_policy_consolidation.py tests/api/test_universal_feedback.py
12 passed, 1 warning in 0.89s

npx tsc --noEmit (apps/web)
exit 0, 12.14s

python -c "yaml.safe_load(open('.github/workflows/saas-checks.yml'))"
yaml-ok
```

The avatar run used the locally installed system OpenCV 4.12.0 through a scoped `sys.path.append`; the committed CI pin is 4.14.0.94. The focused tests exercise the same OpenCV APIs and all assertions pass.

Elevated root results (recorded from the previously unreached CI steps):

```text
tests/api/test_client_contract.py::test_workspace_payload_round_trips_through_the_real_endpoints
1 passed in 6.59s

npm run build (apps/web)
PASSED
```

Focused web follow-up (existing runner directly, after the three fixture corrections):

```text
node --import ./tests/runner/register.mjs tests/music-challenge-hook.test.tsx
5 passed in 4.74s

node --import ./tests/runner/register.mjs tests/music-practice-runtime.test.tsx
3 passed in 5.97s

node --import ./tests/runner/register.mjs tests/practice-policy-wiring.test.ts
3 passed in 0.02s
```

The full web run was not repeated by this agent. The completed root 930-suite run was **927 passed / 3 failed** before these focused corrections.

## Not verified locally / limitations

- This agent's confined harness still cannot run the full web runner (`spawn EPERM`) or production build (`copyfile`/esbuild `spawn EPERM`). The elevated root results above are the build/contract evidence; no local rerun of the 930-suite suite was performed.
- Docker build was not verified.
- No production database was mutated. No commits, pushes, workflow reruns, global installs, security changes or remote operations were performed.
- No claim of full CI, browser, PostgreSQL, Docker, CPU MediaPipe qualification or real-device acceptance.

## Files changed

- `.github/workflows/saas-checks.yml`
- `apps/api/lessons.py`
- `apps/api/music_assessment.py`
- `apps/api/music_attempts.py`
- `scripts/process_video_mediapipe.py`
- `tests/api/test_music_attempts.py`
- `tests/avatar/test_mediapipe_pipeline_scripts.py`
- `apps/web/tests/music-challenge-hook.test.tsx`
- `apps/web/tests/music-practice-runtime.test.tsx`
- `apps/web/tests/practice-policy-wiring.test.ts`
- `tests/requirements.txt`
- `tests/requirements-lock.txt`
- `docs/ci-saas-foundation-fix-2026-11-20.md`


## Final independent review

Root reviewed workflow dependency ordering, current-subject filtering, qualified-input subset policy, and the corrected fixtures. Elevated cross-language contract passed (1 test, 6.59s); production web build passed. Final existing-runner check of all three corrected web files passed together: 11/11, zero failures, 17.10s. The completed diagnostic full web run was 927/930 before these corrections; a full post-fix run was not repeated. Docker, the pinned CI OpenCV version, and remote GitHub acceptance remain unverified. Changes remain uncommitted and unpushed.
