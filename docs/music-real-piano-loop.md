# Real private piano loop: status and next implementation

10 November 2026. Follow-up review of `be1fcfe`. The transport, private release and
run-profile foundation are implemented. No real inference, model accuracy, commercial
approval or deployed worker is claimed. Physical keyboard testing is not a prerequisite
for a watch-only instructor-to-learner lesson.

## Review corrections

The original profile hashed files but did not establish that those files/settings were
used: the bundled adapter ignored the profile, selected its bundled model and onset 0.5;
extraction always used 22050 Hz; the worker replaced draft model labels unconditionally.
The server's profile switch checked only whether a hash was supplied.

The follow-up now:

- Matches configuration JSON to profile settings, rejects non-finite numbers and supports
  only the implemented `mono-pcm-s16le` preprocessing.
- Retains verified local artifact paths, requires the code artifact to be the actual
  adapter entry point, and rechecks bytes/settings before claiming and running jobs.
- Extracts analysis WAV at the profile sample rate and passes the pinned weights path.
- Makes the bundled Basic Pitch adapter verify its own code, checkpoint and PCM format,
  require its installed package version to match, and use the pinned checkpoint/onset.
  Its current supported subset is 22050 Hz and one `onset` threshold in [0, 1]; other
  settings fail explicitly rather than being ignored.
- Requires a matching adapter profile/model/audio receipt instead of stamping model
  identity on arbitrary output. A fixture cannot be submitted as profiled inference.
- Requires `MUSIC_ALLOWED_RUN_PROFILES` when `MUSIC_REQUIRE_RUN_PROFILE=true`; missing,
  unknown and fixture profiles are rejected. With enforcement off, explicit test-fixture
  operation remains available.

The synthetic private-loop test now uses explicit fixture mode. It proves wiring only.
A separate stub-adapter test verifies actual sample-rate/path/receipt transport without
claiming to execute a real model. Mocked Basic Pitch tests verify pinned prediction args.

## Run-profile format and operator boundary

The profile retains model/version, weights/code/config/commercial-evidence digests,
sample rate, preprocessing, thresholds and a deterministic calculated profile digest.
The configuration file must contain exactly `sample_rate`, `preprocessing`, `thresholds`
with values matching the profile. For the bundled adapter:

```json
{"sample_rate":22050,"preprocessing":"mono-pcm-s16le","thresholds":{"onset":0.5}}
```

The code digest identifies the executed adapter file, **not all imported dependencies**.
A retained evidence-file hash is **not commercial approval**. Before real staging use,
bind the runtime image/dependency lock and completed commercial qualification evidence to
that deployment, then explicitly register its approved profile digest on the API.
The receipt and allowlist are checks within the trusted worker boundary, not independent
execution attestation or a cryptographic signature by an approving authority.

Example command after the actual artifacts/evidence have been supplied and reviewed:

```powershell
python scripts/music_worker.py --pipeline music-piano-v1 --work-dir outputs/music-jobs `
  --profile model-profile.json --weights model.onnx --code scripts/music_transcription.py `
  --config inference.json --approval commercial-evidence.json `
  --adapter-command .venv-music/Scripts/python.exe scripts/music_transcription.py --engine basic-pitch
```

The API operator enables `MUSIC_REQUIRE_RUN_PROFILE` and sets
`MUSIC_ALLOWED_RUN_PROFILES` to the approved digest(s), separated by commas. Both music
processing routes remain default-off. No model is installed or downloaded by these changes.

## Next software slice: normal reviewed-reference editing (Phase 5)

Develop this now while recordings/model approval are being obtained; no physical device,
model inference or staging deployment is needed:

1. Add **Edit lesson** for an owner of a reviewed music lesson, reusing the existing
   review screen. Start an editable draft from the reviewed reference without rerunning
   transcription or changing the published reference.
2. Support note/timing/section corrections and watch-only versus supported MIDI policy.
3. Add explicit assessable passage controls with start/end times. Clearly separate
   playing from explanation; persist validated, ordered, non-overlapping in-clip spans.
4. Save a new immutable reviewed revision with audit identity and idempotent retry.
   Reject conflicting stale edits; never replace another saved revision silently.
5. Keep existing recipients and historical summaries on their exact released/reference
   identities. Use the explicit **Update shared version** action to release changes.
6. Make feedback respect assessed passages. Excluded passages and incomplete comparison
   windows must not generate missing/extra-note corrections; keep results unscored.

Acceptance: edit an existing reviewed lesson, exclude an explanation passage, save/retry,
confirm the learner still sees the old version, explicitly release, then confirm the new
reference/policy and retained old history. Movement creation/practice stays unchanged.

## Parallel software: isolated worker packaging and deployment preparation

Provide a reproducible dedicated music-worker image/dependency lock, profile mount and
startup validation, least-scope worker credentials, health/runbook, storage cleanup and
resource limits. Prepare an isolated staging configuration with only piano enabled.
These deployment assets can be developed locally; an actual hosted worker and its run
still require infrastructure access. Keep model files out of ordinary application bundles.

## Actual lesson evidence still needed

1. Obtain an exact model/code/weights package and accountable commercial-use evidence.
2. Use a rights-cleared short acoustic piano recording and real browser preparation/upload.
3. Run actual transcription on the isolated worker, correct and save a watch-only lesson.
4. Invite a separate learner and verify video/guide timing, release update and revocation.
5. Exercise cancellation/retry/cleanup and retain a sanitized run record.
6. Add at least three distinct reviewed real-audio benchmark cases. This is the harness
   floor, not a universal accuracy guarantee.

Browser creation uses real encoding with a mocked upload API; the synthetic API loop and
separate browser scripts do not collectively establish a real browser-to-model run.
No physical keyboard is required for these watch-only steps. MIDI quality/scoring and
microphone/full guitar capabilities retain their separate qualification milestones.


## Follow-up verification

- Full configured API/avatar suite: **322 passed, 13 skipped**.
- Final targeted profile/adapter/worker/private-loop/conversion suite: **34 passed**,
  including the direct-completion guard added after the full suite started.
- Schema drift: **3 artifacts current**; diff whitespace check passes.
- No frontend files changed; frontend/browser checks were not repeated for this slice.
- No real model was installed, no deployment settings changed, and no commit or push
  was made by this review. Changes remain local for the next checkpoint.


## Lifecycle transport evidence (10 November 2026)

A local Docker network ran the built image against a stdlib mock API:

- **Complete:** claim → source download → ffmpeg extraction → fixture adapter → reference
  upload → draft handoff; work directory empty; mock recorded the draft.
- **Lease loss:** heartbeat 409 during a slow adapter; worker terminated it, posted no
  draft and removed the attempt directory.

This is transport/lifecycle evidence, not real inference. The candidate dossier is still
empty; see [`music-transcription-candidate.md`](music-transcription-candidate.md).
