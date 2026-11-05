# Isolated music worker transport

This is the Phase 3 transport/extraction boundary, not a shipped transcription model.
Keep both music processing providers disabled until the model, draft/review handoff and
browser/device preparation path are qualified. The movement worker is unchanged.

## Isolation and operation

`scripts/music_worker.py` imports no application database/storage modules, body pipeline,
SAM, avatar tools, transcription library or model weights. It uses only the API worker
credential, a local ffmpeg installation and an explicit adapter subprocess. It has no
bucket or database credentials. Provision a distinct credential per music pipeline with
`scripts/manage_saas_worker.py --pipeline music-piano-v1` or `music-guitar-v1`, using a
distinct `--output` path. The existing default is still the movement pipeline.

Create a separate environment using `infra/docker/music-requirements-lock.txt`, whose
transport versions match the existing API lock. This slice did not install that environment
or any transcription dependency. The integration tests use the existing test environment.
The ffmpeg binary and adapter are operator-provided dependencies; deployment must record
their versions and applicable notices. No downloaded model has been approved by this work.

Run after loading the provisioned API URL and worker token into the environment:

```powershell
.venv-music/Scripts/python.exe scripts/music_worker.py --pipeline music-piano-v1 --work-dir outputs/music-jobs --adapter-command .venv-music/Scripts/python.exe path/to/approved_adapter.py
```

`--adapter-command` must be last. It is a required, operator-configured command, not input
from an instructor. No command is installed or selected automatically. Do not point this
at the test fixture adapter for real work. Use a separate host/process capacity allocation;
the worker hides CUDA from subprocesses, bounds ffmpeg to one thread and sets CPU thread
hints. An actual model's memory/CPU profile remains Phase 4 work.

## Adapter contract

The adapter receives `--input` (22,050 Hz mono PCM16 WAV), `--source` (the original uploaded
clip), `--job` (subject, instrument, duration and pipeline metadata) and `--output` (an
attempt-local directory). It must return before the 30-minute command limit and must not
daemonize work. The original source retains its audio; analysis does not replace it.

Write `result.json` in the output directory with one of:

- `draft`: an unreviewed proposal (`draft_version: 1`, subject, instrument, duration,
  events, spans, provenance, warnings). The worker uploads the `reference` role and posts
  the document to `/api/worker/jobs/{id}/draft`;
- `manifest`: a reviewed music manifest, completed through `/finish`. This remains for a
  future review-finalisation step and is not what a transcription adapter emits.

Both shapes use `files`: a mapping from asset role to a relative file path, for example
`reference` to `reference.json`.

The worker checks roles against the leased server contract, refuses paths outside its
result directory, uploads within the current attempt and uses the API's returned asset
identities. The worker and adapter never set `reference_reviewed`. The server stores an
accepted draft in `music_drafts`, apart from lesson revisions: the lesson has no manifest
until review, `GET /api/lessons/{id}` returns a conflict to its owner, publishing is
refused, and only the owner can read `GET /api/lessons/{id}/music-draft`.

## Lease, cancellation and cleanup

- Source size and SHA-256 must match the leased upload.
- Piano/guitar pipelines and subjects must match the credential's claimed work; no body
  completion or body asset upload is accepted on a music attempt.
- Heartbeats continue during download, extraction and adapter processing. Lease loss,
  cancellation or shutdown stops further work and terminates the active subprocess.
- Stages advance through validating, processing, exporting and verifying. Asset uploads
  and completion retain the attempt token. Expired/previous tokens cannot upload or finish.
- Only idempotent completion is retried after an uncertain transport response. A lost
  response after commit cannot create a second lesson.
- Attempt-local inputs, extracted audio, results and logs are removed in `finally`, after
  verifying the resolved directory remains inside the configured work root.
- The API deletes accepted attempt assets/source after completion. Cancelled staged
  assets use the existing retention cleanup, `scripts/cleanup_saas_conversions.py`; they
  are not claimed to disappear immediately. The operator must schedule that cleanup.

Tests cover real extraction and API completion, an uncertain finish response, owner
cancellation during a running adapter, stale-token and wrong-role rejection, and
staged-asset removal by retention cleanup. Draft tests cover the worker handoff, server
validation, owner-only proposal reading, refusal to publish and cross-account isolation.

## Transcription adapter

`scripts/music_transcription.py` implements the adapter contract and emits a draft:

```powershell
python scripts/music_transcription.py --engine fixture --input analysis.wav --source source.media --job job.json --output result
```

`--engine fixture` produces deterministic events for transport and handoff tests and is
labelled as a fixture, not a model result. `--engine basic-pitch` uses the optional Basic
Pitch package, which is **not installed** in this checkout and is never downloaded
automatically; without it the adapter exits with an explicit message. No model, weights or
transcription dependency is installed by this slice, and no production engine is selected.


## Owner review continuation

Owner review now finalises a stored draft through
`POST /api/lessons/{lesson_id}/music-draft/review`. The worker still only proposes: it
never sets the reviewer or accepts a draft. Handoff retains uniquely named private source
video/reference assets before upload cleanup, and the owner review creates a separate
immutable reviewed reference. See `docs/music-review-finalisation.md`. Music providers
remain disabled and the optional Basic Pitch package has not been installed or qualified.
