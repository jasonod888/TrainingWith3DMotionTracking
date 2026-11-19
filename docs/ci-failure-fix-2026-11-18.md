# CI foundation failure fix — 18 November 2026

Remote baseline: `main` at `67c3ea2`. Local practice/inference work remains
uncommitted and was not altered by this CI fix.

## Failure categories from run 44318378046

`38 failed, 866 passed, 37 skipped` in 386.32 s.

- **31 failures: missing `ffmpeg`/`ffprobe`.** Ubuntu runners in this workflow had
  no media system package. Tests that construct real audio/video fixtures raised
  `FileNotFoundError: ffmpeg`. The module-level skip in
  `test_music_media_validation.py` did not protect other modules that import its
  shared `real_media_app`/`media` helpers.
- **1 failure: missing `soundfile`.** `test_piano_expression.py` imports it directly
  to write a verification WAV; it was absent from the test dependency lock.
- **5 failures: optional real hand model unavailable.** `test_music_hands.py` needs
  the ignored `tools/midi2hands/model.onnx` artifact and a Python interpreter with
  `onnxruntime`; neither is provisioned in CI. These are meaningful real-model tests,
  not tests to skip or delete.
- **1 failure: Windows-only interpreter expectation.** `scripts/run_piano_comparison.py`
  hardcoded `.venv*/Scripts/python.exe`, and the test asserted `python.exe` on Linux.
- **Frontend/Docker fresh-checkout risk (not reached in this failed run):**
  `apps/web/prepare-ort.mjs` requires the ignored
  `music-candidate-run/basic-pitch-0.4.0/model.onnx`. A fresh checkout and the Docker
  build did not contain it, so browser build preparation would fail or depend on a
  developer’s local machine.

## Fixes applied

- `.github/workflows/saas-checks.yml`
  - Installs `ffmpeg` and `libsndfile1` before Python tests.
  - Installs pinned test dependencies including `onnxruntime` and `soundfile`.
  - Fetches/verifies the pinned midi2hands model and points the tests at the CI
    interpreter and artifact.
  - Before the frontend build, downloads `basic-pitch==0.4.0` and extracts the
    checksum-verified browser model into the ignored local path.
- `tests/requirements-lock.txt`, `tests/requirements.txt`
  - `onnxruntime==1.31.1`
  - `soundfile==0.14.0`
- `scripts/fetch_midi2hands_model.py`
  - Pinned, size/SHA-256 verified download of the 252,047-byte midi2hands ONNX
    artifact; reuses an already verified file. No binary is committed.
- `scripts/fetch_basic_pitch_browser_model.py`
  - Extracts the browser ONNX model from the pinned Basic Pitch 0.4.0 wheel/sdist,
    verifies 230,444 bytes and SHA-256
    `2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec`,
    and writes only the verified artifact. No binary is committed.
- `scripts/run_piano_comparison.py`
  - Platform-aware venv interpreter layout (`Scripts/python.exe` on Windows,
    `bin/python` on POSIX), with an injectable platform for tests.
- `tests/api/test_run_piano_comparison.py`
  - Tests both platform layouts and monkeypatches temporary interpreter paths, so
    the test no longer depends on a developer venv or Windows.
- `infra/docker/Dockerfile`
  - New pinned `music-model` stage downloads Basic Pitch 0.4.0, extracts and verifies
    the ONNX artifact, then copies it to the expected ignored build path. The final
    image still contains only generated build output, never a committed model.

## Verification completed locally

- `tools/midi2hands/model.onnx` identity verified: 252,047 bytes, SHA-256
  `6b7a7858a881e9e231bb3aeeecc1480c9b43a816f4ea2cac2182dc34b44e18dd`.
- `scripts/fetch_midi2hands_model.py` reuse/verification path succeeded.
- Synthetic wheel extraction via `scripts/fetch_basic_pitch_browser_model.py`
  produced 230,444 bytes with the pinned SHA-256.
- `tests/api/test_run_piano_comparison.py`: **16 passed**, exit 0, 0.26 s.
- `tests/api/test_music_hands.py`: **9 passed**, exit 0, 5.73 s, using the locally
  verified model and `.venv-music` runtime.

## Not yet verified / limits

- No remote CI run has been made; **do not claim remote green**.
- The Docker image was not built.
- The workflow’s `apt-get`, PyPI Basic Pitch download, GitHub hand-model download and
  `soundfile==0.14.0` install were not exercised in this environment.
- `test_piano_expression.py` was not run locally because `soundfile` is absent from
  the local `.venv-saas`; it is covered by CI dependency provisioning.
- A combined ffmpeg-dependent pytest subset was attempted locally but the command was
  interrupted and its result is unknown; it is not counted as a pass.
- The optional hand model remains fetched at CI/runtime, not committed.
