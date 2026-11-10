# Music worker packaging and operation

10 November 2026. **Prepared, not built or deployed.** No model is included, downloaded or
approved. The image carries only the transport, profile verifier and fixture adapter
scaffolding; production needs an operator-supplied adapter and pinned artifacts.

## Image

`infra/docker/music-worker.Dockerfile`:

- Python 3.12 slim base; pin its digest for a real release.
- Installs only `music-requirements-lock.txt` and `ffmpeg` from the distribution.
- Runs as UID 10001; no body pipeline, database or bucket credentials.
- Copies the worker, profile verifier and fixture transcription adapter. The fixture
  adapter must never be enabled for production.

Build:

```powershell
docker build -f infra/docker/music-worker.Dockerfile -t form-music-worker:local .
```

The build was not executed here; record the base-image digest and dependency lock in the
release record before using it.

## Mounts and runtime contract

| Path | Mode | Contents |
| --- | --- | --- |
| `/profile` | read-only | run profile JSON, code bundle/lock digest file, commercial approval |
| `/models` | read-only | approved weights/checkpoint; no download at runtime |
| `/config` | read-only | inference configuration referenced by `config_sha256` |
| `/work` | writable volume | attempt-local downloads, extraction and adapter outputs |

The examples are in `infra/docker/music-worker-compose.example.yml`: read-only root,
dropped capabilities, no-new-privileges, a token file mount, CPU/memory/PID limits and an
outbound-only API URL. Replace the placeholder image digest, hostnames, artifact digests and
token path before any staging run.

## Startup and refusal behavior

The worker requires either:

- `--profile ... --weights ... --code ... --config ... --approval ...`, with every file
  matching the declared digest; or
- explicit `--fixture` for tests only.

A missing/mismatched profile or artifact, model identity in fixture mode, or unsupported
preprocessing fails at startup. The worker never downloads a checkpoint and never falls
back to the fixture engine. `MUSIC_REQUIRE_RUN_PROFILE` and
`MUSIC_ALLOWED_RUN_PROFILES` server-side can require an operator-approved profile digest
and reject fixture provenance.

## Adapter

The adapter receives the analysis WAV, original source, job JSON and output directory; it
must honour `MUSIC_RUN_PROFILE` (checkpoint path, sample rate, preprocessing, thresholds)
and return a draft with `provenance` matching the profile's model/version and the actual
analysis audio hash. The worker verifies the profile again in the adapter environment and
records the profile digest in the draft.

## Operating notes

- One worker credential per pipeline; separate capacity and work volume.
- No inbound ports; outbound HTTPS to the API only.
- Cancellation/lease loss terminates the adapter process; attempt files are removed.
- Log the image digest, profile digest, artifact digests and adapter version per attempt.
- Do not bake recordings, model weights, tokens or approval evidence into the image.

## Remaining before a real run

- Build and scan the image; pin the base digest.
- Install the approved model/code/weights and adapter; retain commercial evidence.
- Configure a staging worker token and profile allowlist.
- Verify real inference with a rights-cleared recording, then record sanitized evidence.
